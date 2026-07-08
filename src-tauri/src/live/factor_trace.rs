use crate::database::now_ms;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::sync::{
    OnceLock,
    atomic::{AtomicBool, Ordering},
};

const FACTOR_TRACE_ENTRY_LIMIT: usize = 5_000;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FactorTraceStatus {
    pub enabled: bool,
    pub started_at_ms: Option<i64>,
    pub entry_count: usize,
    pub dropped_entries: u64,
    pub entry_limit: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FactorTraceEntry {
    ts_ms: i64,
    category: String,
    action: String,
    payload: Value,
}

#[derive(Debug, Default)]
struct FactorTraceState {
    started_at_ms: Option<i64>,
    entries: VecDeque<FactorTraceEntry>,
    dropped_entries: u64,
}

fn trace_enabled() -> &'static AtomicBool {
    static ENABLED: OnceLock<AtomicBool> = OnceLock::new();
    ENABLED.get_or_init(|| AtomicBool::new(false))
}

fn trace_state() -> &'static Mutex<FactorTraceState> {
    static STATE: OnceLock<Mutex<FactorTraceState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(FactorTraceState::default()))
}

fn build_status(state: &FactorTraceState) -> FactorTraceStatus {
    FactorTraceStatus {
        enabled: trace_enabled().load(Ordering::Relaxed),
        started_at_ms: state.started_at_ms,
        entry_count: state.entries.len(),
        dropped_entries: state.dropped_entries,
        entry_limit: FACTOR_TRACE_ENTRY_LIMIT,
    }
}

pub fn start() -> FactorTraceStatus {
    let mut state = trace_state().lock();
    state.started_at_ms = Some(now_ms());
    state.entries.clear();
    state.dropped_entries = 0;
    trace_enabled().store(true, Ordering::Relaxed);
    build_status(&state)
}

pub fn stop() -> FactorTraceStatus {
    trace_enabled().store(false, Ordering::Relaxed);
    let state = trace_state().lock();
    build_status(&state)
}

pub fn status() -> FactorTraceStatus {
    let state = trace_state().lock();
    build_status(&state)
}

pub fn record<T>(category: &str, action: &str, payload: T)
where
    T: Serialize,
{
    if !trace_enabled().load(Ordering::Relaxed) {
        return;
    }

    let payload = serde_json::to_value(payload).unwrap_or_else(|error| {
        json!({
            "serializationError": error.to_string(),
        })
    });

    let mut state = trace_state().lock();
    if state.entries.len() >= FACTOR_TRACE_ENTRY_LIMIT {
        state.entries.pop_front();
        state.dropped_entries = state.dropped_entries.saturating_add(1);
    }
    state.entries.push_back(FactorTraceEntry {
        ts_ms: now_ms(),
        category: category.to_string(),
        action: action.to_string(),
        payload,
    });
}

pub fn record_lazy<T, F>(category: &str, action: &str, build_payload: F)
where
    T: Serialize,
    F: FnOnce() -> T,
{
    if !trace_enabled().load(Ordering::Relaxed) {
        return;
    }

    record(category, action, build_payload());
}

pub fn export_to_path(destination_path: &str) -> Result<String, String> {
    let path = Path::new(destination_path);
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create factor trace directory: {error}"))?;
    }

    let state = trace_state().lock();
    let document = json!({
        "schemaVersion": 1,
        "source": "temporary-factor-trace",
        "createdAtMs": now_ms(),
        "enabledAtExport": trace_enabled().load(Ordering::Relaxed),
        "startedAtMs": state.started_at_ms,
        "entryLimit": FACTOR_TRACE_ENTRY_LIMIT,
        "droppedEntries": state.dropped_entries,
        "entryCount": state.entries.len(),
        "entries": state.entries.iter().cloned().collect::<Vec<_>>(),
    });
    let body = serde_json::to_string_pretty(&document)
        .map_err(|error| format!("serialize factor trace: {error}"))?;
    fs::write(path, body).map_err(|error| format!("write factor trace: {error}"))?;
    Ok(path.to_string_lossy().into_owned())
}
