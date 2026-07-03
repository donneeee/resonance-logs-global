use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::process;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const DISCORD_RPC_VERSION: u8 = 1;
const DISCORD_IPC_HANDSHAKE: u32 = 0;
const DISCORD_IPC_FRAME: u32 = 1;
const DISCORD_CONNECT_RETRY_MS: u64 = 5_000;

static NEXT_NONCE: AtomicU64 = AtomicU64::new(1);
static RUNTIME: Lazy<Mutex<DiscordPresenceRuntime>> =
    Lazy::new(|| Mutex::new(DiscordPresenceRuntime::default()));

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiscordPresenceActivity {
    pub details: String,
    pub state: String,
    #[serde(default)]
    pub start_timestamp: Option<u64>,
    #[serde(default)]
    pub large_image: Option<String>,
    #[serde(default)]
    pub large_text: Option<String>,
    #[serde(default)]
    pub small_image: Option<String>,
    #[serde(default)]
    pub small_text: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiscordPresenceStatus {
    pub enabled: bool,
    pub connected: bool,
    pub client_id: String,
    pub last_error: Option<String>,
}

impl Default for DiscordPresenceStatus {
    fn default() -> Self {
        Self {
            enabled: false,
            connected: false,
            client_id: String::new(),
            last_error: None,
        }
    }
}

#[derive(Default)]
struct DiscordPresenceRuntime {
    enabled: bool,
    client_id: String,
    worker: Option<mpsc::Sender<PresenceWorkerCommand>>,
    status: Option<Arc<Mutex<DiscordPresenceStatus>>>,
    last_activity: Option<DiscordPresenceActivity>,
}

enum PresenceWorkerCommand {
    SetActivity(DiscordPresenceActivity),
    Clear,
    Shutdown,
}

#[tauri::command]
#[specta::specta]
pub fn discord_presence_set_config(
    enabled: bool,
    client_id: String,
) -> Result<DiscordPresenceStatus, String> {
    let client_id = client_id.trim().to_string();
    let mut runtime = RUNTIME
        .lock()
        .map_err(|_| "Discord presence runtime lock poisoned".to_string())?;

    if !enabled || client_id.is_empty() {
        runtime.shutdown_worker();
        runtime.enabled = false;
        runtime.client_id = client_id;
        runtime.last_activity = None;
        let status = DiscordPresenceStatus {
            enabled: false,
            connected: false,
            client_id: runtime.client_id.clone(),
            last_error: None,
        };
        runtime.status = Some(Arc::new(Mutex::new(status.clone())));
        return Ok(status);
    }

    if runtime.enabled && runtime.client_id == client_id && runtime.worker.is_some() {
        return Ok(runtime.current_status());
    }

    runtime.shutdown_worker();
    runtime.enabled = true;
    runtime.client_id = client_id.clone();
    let shared_status = Arc::new(Mutex::new(DiscordPresenceStatus {
        enabled: true,
        connected: false,
        client_id: client_id.clone(),
        last_error: None,
    }));
    let (tx, rx) = mpsc::channel();
    spawn_presence_worker(client_id, rx, Arc::clone(&shared_status));
    runtime.worker = Some(tx);
    runtime.status = Some(shared_status);
    runtime.last_activity = None;
    Ok(runtime.current_status())
}

#[tauri::command]
#[specta::specta]
pub fn discord_presence_update(
    activity: DiscordPresenceActivity,
) -> Result<DiscordPresenceStatus, String> {
    let mut runtime = RUNTIME
        .lock()
        .map_err(|_| "Discord presence runtime lock poisoned".to_string())?;
    runtime.last_activity = Some(activity.clone());
    if !runtime.enabled {
        return Ok(runtime.current_status());
    }
    if let Some(worker) = &runtime.worker {
        worker
            .send(PresenceWorkerCommand::SetActivity(activity))
            .map_err(|error| format!("Failed to queue Discord presence update: {error}"))?;
    }
    Ok(runtime.current_status())
}

#[tauri::command]
#[specta::specta]
pub fn discord_presence_clear() -> Result<DiscordPresenceStatus, String> {
    let mut runtime = RUNTIME
        .lock()
        .map_err(|_| "Discord presence runtime lock poisoned".to_string())?;
    runtime.last_activity = None;
    if let Some(worker) = &runtime.worker {
        let _ = worker.send(PresenceWorkerCommand::Clear);
    }
    Ok(runtime.current_status())
}

#[tauri::command]
#[specta::specta]
pub fn discord_presence_status() -> Result<DiscordPresenceStatus, String> {
    let runtime = RUNTIME
        .lock()
        .map_err(|_| "Discord presence runtime lock poisoned".to_string())?;
    Ok(runtime.current_status())
}

impl DiscordPresenceRuntime {
    fn shutdown_worker(&mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.send(PresenceWorkerCommand::Shutdown);
        }
    }

    fn current_status(&self) -> DiscordPresenceStatus {
        if let Some(shared) = &self.status {
            if let Ok(status) = shared.lock() {
                return status.clone();
            }
        }
        DiscordPresenceStatus {
            enabled: self.enabled,
            connected: false,
            client_id: self.client_id.clone(),
            last_error: None,
        }
    }
}

fn spawn_presence_worker(
    client_id: String,
    rx: mpsc::Receiver<PresenceWorkerCommand>,
    status: Arc<Mutex<DiscordPresenceStatus>>,
) {
    thread::spawn(move || {
        let mut pipe: Option<File> = None;
        let mut next_connect_after = Instant::now();

        while let Ok(command) = rx.recv() {
            match command {
                PresenceWorkerCommand::Shutdown => {
                    if let Some(mut file) = pipe.take() {
                        let _ = write_set_activity(&mut file, None);
                    }
                    set_status(&status, false, None);
                    break;
                }
                PresenceWorkerCommand::Clear => {
                    match ensure_connected(&client_id, &mut pipe, &mut next_connect_after, &status)
                    {
                        Ok(file) => {
                            if let Err(error) = write_set_activity(file, None) {
                                handle_write_error(&status, &mut pipe, error);
                            }
                        }
                        Err(error) => set_status(&status, false, Some(error)),
                    }
                }
                PresenceWorkerCommand::SetActivity(activity) => {
                    match ensure_connected(&client_id, &mut pipe, &mut next_connect_after, &status)
                    {
                        Ok(file) => {
                            if let Err(error) = write_set_activity(file, Some(activity)) {
                                handle_write_error(&status, &mut pipe, error);
                            }
                        }
                        Err(error) => set_status(&status, false, Some(error)),
                    }
                }
            }
        }
    });
}

fn ensure_connected<'a>(
    client_id: &str,
    pipe: &'a mut Option<File>,
    next_connect_after: &mut Instant,
    status: &Arc<Mutex<DiscordPresenceStatus>>,
) -> Result<&'a mut File, String> {
    if pipe.is_some() {
        return Ok(pipe.as_mut().expect("checked above"));
    }

    let now = Instant::now();
    if now < *next_connect_after {
        return Err("Discord IPC pipe is not available yet".to_string());
    }
    *next_connect_after = now + Duration::from_millis(DISCORD_CONNECT_RETRY_MS);

    match connect_discord(client_id) {
        Ok(file) => {
            *pipe = Some(file);
            set_status(status, true, None);
            Ok(pipe.as_mut().expect("pipe just connected"))
        }
        Err(error) => Err(error),
    }
}

fn connect_discord(client_id: &str) -> Result<File, String> {
    let mut last_error = String::new();
    for index in 0..10 {
        let pipe_name = format!(r"\\?\pipe\discord-ipc-{index}");
        match OpenOptions::new().read(true).write(true).open(&pipe_name) {
            Ok(mut file) => {
                let payload = json!({
                    "v": DISCORD_RPC_VERSION,
                    "client_id": client_id,
                });
                write_frame(&mut file, DISCORD_IPC_HANDSHAKE, &payload)
                    .map_err(|error| format!("Discord IPC handshake failed: {error}"))?;
                return Ok(file);
            }
            Err(error) => {
                last_error = error.to_string();
            }
        }
    }
    Err(format!("Discord IPC pipe was not found: {last_error}"))
}

fn write_set_activity(
    file: &mut File,
    activity: Option<DiscordPresenceActivity>,
) -> io::Result<()> {
    let activity_value = activity.map(activity_to_json);
    let payload = json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": process::id(),
            "activity": activity_value,
        },
        "nonce": next_nonce(),
    });
    write_frame(file, DISCORD_IPC_FRAME, &payload)
}

fn activity_to_json(activity: DiscordPresenceActivity) -> Value {
    let mut value = json!({
        "instance": false,
    });

    let details = activity.details.trim();
    if !details.is_empty() {
        value["details"] = json!(details);
    }

    let state = activity.state.trim();
    if !state.is_empty() {
        value["state"] = json!(state);
    }

    let large_image = activity.large_image.filter(|text| !text.trim().is_empty());
    let large_text = activity.large_text.filter(|text| !text.trim().is_empty());
    let small_image = activity.small_image.filter(|text| !text.trim().is_empty());
    let small_text = activity.small_text.filter(|text| !text.trim().is_empty());
    if large_image.is_some()
        || large_text.is_some()
        || small_image.is_some()
        || small_text.is_some()
    {
        let mut assets = json!({});
        if let Some(large_image) = large_image {
            assets["large_image"] = json!(large_image);
        }
        if let Some(large_text) = large_text {
            assets["large_text"] = json!(large_text);
        }
        if let Some(small_image) = small_image {
            assets["small_image"] = json!(small_image);
        }
        if let Some(small_text) = small_text {
            assets["small_text"] = json!(small_text);
        }
        value["assets"] = assets;
    }

    if let Some(start_timestamp) = activity.start_timestamp.filter(|timestamp| *timestamp > 0) {
        value["timestamps"] = json!({
            "start": start_timestamp,
        });
    }

    value
}

fn write_frame(file: &mut File, opcode: u32, payload: &Value) -> io::Result<()> {
    let bytes = serde_json::to_vec(payload)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
    file.write_all(&opcode.to_le_bytes())?;
    file.write_all(&(bytes.len() as u32).to_le_bytes())?;
    file.write_all(&bytes)?;
    file.flush()
}

fn next_nonce() -> String {
    NEXT_NONCE.fetch_add(1, Ordering::Relaxed).to_string()
}

fn handle_write_error(
    status: &Arc<Mutex<DiscordPresenceStatus>>,
    pipe: &mut Option<File>,
    error: io::Error,
) {
    *pipe = None;
    set_status(status, false, Some(error.to_string()));
}

fn set_status(
    status: &Arc<Mutex<DiscordPresenceStatus>>,
    connected: bool,
    last_error: Option<String>,
) {
    if let Ok(mut state) = status.lock() {
        state.enabled = true;
        state.connected = connected;
        state.last_error = last_error;
    }
}
