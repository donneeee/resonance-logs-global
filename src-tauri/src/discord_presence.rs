use once_cell::sync::Lazy;
use serde_json::{Value, json};
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::process;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::ffi::c_void;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;

const DISCORD_RPC_VERSION: u8 = 1;
const DISCORD_IPC_HANDSHAKE: u32 = 0;
const DISCORD_IPC_FRAME: u32 = 1;
const DISCORD_CONNECT_RETRY_MS: u64 = 5_000;

#[cfg(windows)]
unsafe extern "system" {
    fn PeekNamedPipe(
        h_named_pipe: *mut c_void,
        lp_buffer: *mut c_void,
        n_buffer_size: u32,
        lp_bytes_read: *mut u32,
        lp_total_bytes_avail: *mut u32,
        lp_bytes_left_this_message: *mut u32,
    ) -> i32;
}

static NEXT_NONCE: AtomicU64 = AtomicU64::new(1);
static NEXT_WORKER_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static RUNTIME: Lazy<Mutex<DiscordPresenceRuntime>> =
    Lazy::new(|| Mutex::new(DiscordPresenceRuntime::default()));

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
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
    SetActivity {
        activity: DiscordPresenceActivity,
        queued_at: Instant,
        sequence: u64,
    },
    Clear {
        queued_at: Instant,
        sequence: u64,
    },
    Shutdown,
}

#[tauri::command]
#[specta::specta]
pub fn discord_presence_set_config(
    enabled: bool,
    client_id: String,
) -> Result<DiscordPresenceStatus, String> {
    let client_id = client_id.trim().to_string();
    tracing::info!(
        target: "app::discord",
        enabled = enabled,
        client_id = %client_id,
        "discord_presence_config_requested"
    );
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
    if runtime.enabled
        && runtime.current_status().connected
        && runtime.last_activity.as_ref() == Some(&activity)
    {
        let summary = activity_trace_summary(&activity);
        tracing::debug!(
            target: "app::discord",
            details = %summary.details,
            state = %summary.state,
            large_image = %summary.large_image,
            large_text = %summary.large_text,
            small_image = %summary.small_image,
            small_text = %summary.small_text,
            "discord_presence_update_ignored_duplicate"
        );
        return Ok(runtime.current_status());
    }
    runtime.last_activity = Some(activity.clone());
    if !runtime.enabled {
        let summary = activity_trace_summary(&activity);
        tracing::info!(
            target: "app::discord",
            details = %summary.details,
            state = %summary.state,
            large_image = %summary.large_image,
            large_text = %summary.large_text,
            small_image = %summary.small_image,
            small_text = %summary.small_text,
            "discord_presence_update_ignored_disabled"
        );
        return Ok(runtime.current_status());
    }
    if let Some(worker) = &runtime.worker {
        let sequence = next_worker_sequence();
        let summary = activity_trace_summary(&activity);
        tracing::info!(
            target: "app::discord",
            sequence = sequence,
            details = %summary.details,
            state = %summary.state,
            large_image = %summary.large_image,
            large_text = %summary.large_text,
            small_image = %summary.small_image,
            small_text = %summary.small_text,
            "discord_presence_update_queued"
        );
        worker
            .send(PresenceWorkerCommand::SetActivity {
                activity,
                queued_at: Instant::now(),
                sequence,
            })
            .map_err(|error| format!("Failed to queue Discord presence update: {error}"))?;
    } else {
        let summary = activity_trace_summary(&activity);
        tracing::info!(
            target: "app::discord",
            details = %summary.details,
            state = %summary.state,
            large_image = %summary.large_image,
            large_text = %summary.large_text,
            small_image = %summary.small_image,
            small_text = %summary.small_text,
            "discord_presence_update_ignored_missing_worker"
        );
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
        let sequence = next_worker_sequence();
        tracing::info!(
            target: "app::discord",
            sequence = sequence,
            "discord_presence_clear_queued"
        );
        let _ = worker.send(PresenceWorkerCommand::Clear {
            queued_at: Instant::now(),
            sequence,
        });
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
            let (command, coalesced_count) = coalesce_presence_worker_command(command, &rx);
            match command {
                PresenceWorkerCommand::Shutdown => {
                    if let Some(mut file) = pipe.take() {
                        let _ =
                            write_set_activity(&mut file, None, 0, Instant::now(), coalesced_count);
                    }
                    set_status(&status, false, None);
                    break;
                }
                PresenceWorkerCommand::Clear {
                    queued_at,
                    sequence,
                } => {
                    match ensure_connected(&client_id, &mut pipe, &mut next_connect_after, &status)
                    {
                        Ok(file) => {
                            if let Err(error) =
                                write_set_activity(file, None, sequence, queued_at, coalesced_count)
                            {
                                handle_write_error(&status, &mut pipe, error);
                            }
                        }
                        Err(error) => set_status(&status, false, Some(error)),
                    }
                }
                PresenceWorkerCommand::SetActivity {
                    activity,
                    queued_at,
                    sequence,
                } => {
                    match ensure_connected(&client_id, &mut pipe, &mut next_connect_after, &status)
                    {
                        Ok(file) => {
                            if let Err(error) = write_set_activity(
                                file,
                                Some(activity),
                                sequence,
                                queued_at,
                                coalesced_count,
                            ) {
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

fn coalesce_presence_worker_command(
    initial: PresenceWorkerCommand,
    rx: &mpsc::Receiver<PresenceWorkerCommand>,
) -> (PresenceWorkerCommand, usize) {
    let mut command = initial;
    let mut coalesced_count = 0;
    while let Ok(next_command) = rx.try_recv() {
        if matches!(next_command, PresenceWorkerCommand::Shutdown) {
            return (PresenceWorkerCommand::Shutdown, coalesced_count + 1);
        }
        coalesced_count += 1;
        command = next_command;
    }
    (command, coalesced_count)
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
                let _ = drain_discord_pipe(&mut file);
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
    sequence: u64,
    queued_at: Instant,
    coalesced_count: usize,
) -> io::Result<()> {
    let drained_bytes = drain_discord_pipe(file)?;
    let activity_summary = activity
        .as_ref()
        .map(activity_trace_summary)
        .unwrap_or_else(DiscordActivityTraceSummary::clear);
    let nonce = next_nonce();
    let payload = json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": process::id(),
            "activity": activity.map(activity_to_json),
        },
        "nonce": nonce,
    });
    let queue_ms = queued_at.elapsed().as_millis();
    tracing::info!(
        target: "app::discord",
        sequence = sequence,
        nonce = %nonce,
        queue_ms = queue_ms,
        coalesced_count = coalesced_count,
        drained_bytes = drained_bytes,
        details = %activity_summary.details,
        state = %activity_summary.state,
        large_image = %activity_summary.large_image,
        large_text = %activity_summary.large_text,
        small_image = %activity_summary.small_image,
        small_text = %activity_summary.small_text,
        "discord_presence_ipc_write_start"
    );

    let write_started = Instant::now();
    let result = write_frame(file, DISCORD_IPC_FRAME, &payload);
    let write_ms = write_started.elapsed().as_millis();
    match &result {
        Ok(()) => tracing::info!(
            target: "app::discord",
            sequence = sequence,
            nonce = %nonce,
            write_ms = write_ms,
            "discord_presence_ipc_write_ok"
        ),
        Err(error) => tracing::warn!(
            target: "app::discord",
            sequence = sequence,
            nonce = %nonce,
            write_ms = write_ms,
            error = %error,
            "discord_presence_ipc_write_failed"
        ),
    }
    result
}

fn drain_discord_pipe(file: &mut File) -> io::Result<usize> {
    let mut buffer = [0_u8; 4096];
    let mut total_read = 0;
    loop {
        let available = discord_pipe_available(file)?;
        if available == 0 {
            return Ok(total_read);
        }

        let read_len = buffer.len().min(available as usize);
        match file.read(&mut buffer[..read_len]) {
            Ok(0) => return Ok(total_read),
            Ok(bytes_read) => {
                total_read += bytes_read;
                log_discord_pipe_bytes(&buffer[..bytes_read]);
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
}

#[cfg(windows)]
fn discord_pipe_available(file: &File) -> io::Result<u32> {
    let mut total_bytes_available = 0_u32;
    let ok = unsafe {
        PeekNamedPipe(
            file.as_raw_handle() as *mut c_void,
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            &mut total_bytes_available,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(total_bytes_available)
}

#[cfg(not(windows))]
fn discord_pipe_available(_file: &File) -> io::Result<u32> {
    Ok(0)
}

fn log_discord_pipe_bytes(bytes: &[u8]) {
    let mut offset = 0;
    let mut frame_count = 0;
    while offset + 8 <= bytes.len() {
        let opcode = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap_or([0; 4]));
        let payload_len =
            u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap_or([0; 4])) as usize;
        let payload_start = offset + 8;
        let payload_end = payload_start + payload_len;
        if payload_end > bytes.len() {
            tracing::info!(
                target: "app::discord",
                opcode = opcode,
                payload_len = payload_len,
                available_bytes = bytes.len() - offset,
                "discord_presence_ipc_response_partial"
            );
            return;
        }

        frame_count += 1;
        let payload_bytes = &bytes[payload_start..payload_end];
        match serde_json::from_slice::<Value>(payload_bytes) {
            Ok(payload) => {
                let cmd = payload.get("cmd").and_then(Value::as_str).unwrap_or("");
                let evt = payload.get("evt").and_then(Value::as_str).unwrap_or("");
                let nonce = payload.get("nonce").and_then(Value::as_str).unwrap_or("");
                let code = payload
                    .get("data")
                    .and_then(|data| data.get("code"))
                    .and_then(Value::as_i64)
                    .or_else(|| payload.get("code").and_then(Value::as_i64));
                let message = payload
                    .get("data")
                    .and_then(|data| data.get("message"))
                    .and_then(Value::as_str)
                    .or_else(|| payload.get("message").and_then(Value::as_str))
                    .unwrap_or("");
                tracing::info!(
                    target: "app::discord",
                    opcode = opcode,
                    frame_index = frame_count,
                    cmd = %cmd,
                    evt = %evt,
                    nonce = %nonce,
                    code = ?code,
                    message = %truncate_trace_text(message, 160),
                    payload = %truncate_trace_text(&payload.to_string(), 512),
                    "discord_presence_ipc_response"
                );
            }
            Err(error) => tracing::info!(
                target: "app::discord",
                opcode = opcode,
                frame_index = frame_count,
                payload_len = payload_len,
                error = %error,
                "discord_presence_ipc_response_parse_failed"
            ),
        }
        offset = payload_end;
    }

    if offset < bytes.len() {
        tracing::info!(
            target: "app::discord",
            trailing_bytes = bytes.len() - offset,
            "discord_presence_ipc_response_trailing_bytes"
        );
    }
}

struct DiscordActivityTraceSummary {
    details: String,
    state: String,
    large_image: String,
    large_text: String,
    small_image: String,
    small_text: String,
}

impl DiscordActivityTraceSummary {
    fn clear() -> Self {
        Self {
            details: "<clear>".to_string(),
            state: String::new(),
            large_image: String::new(),
            large_text: String::new(),
            small_image: String::new(),
            small_text: String::new(),
        }
    }
}

fn activity_trace_summary(activity: &DiscordPresenceActivity) -> DiscordActivityTraceSummary {
    DiscordActivityTraceSummary {
        details: truncate_trace_text(&activity.details, 160),
        state: truncate_trace_text(&activity.state, 220),
        large_image: truncate_trace_text(activity.large_image.as_deref().unwrap_or(""), 120),
        large_text: truncate_trace_text(activity.large_text.as_deref().unwrap_or(""), 160),
        small_image: truncate_trace_text(activity.small_image.as_deref().unwrap_or(""), 120),
        small_text: truncate_trace_text(activity.small_text.as_deref().unwrap_or(""), 160),
    }
}

fn truncate_trace_text(value: &str, max_len: usize) -> String {
    let normalized = value.replace(['\r', '\n', '\t'], " ").trim().to_string();
    if normalized.chars().count() <= max_len {
        return normalized;
    }

    let keep_len = max_len.saturating_sub(3);
    format!(
        "{}...",
        normalized.chars().take(keep_len).collect::<String>()
    )
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

fn next_worker_sequence() -> u64 {
    NEXT_WORKER_SEQUENCE.fetch_add(1, Ordering::Relaxed)
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
