use crate::live::event_logger::EventLoggerBatchPayload;
use crate::live::event_manager::safe_emit_to;
use tauri::AppHandle;

pub const CUSTOM_TRIGGER_BATCH_EVENT: &str = "custom-trigger-batch";

pub fn emit_custom_trigger_entries(
    app_handle: &AppHandle,
    entries: Vec<crate::live::event_logger::EventLoggerEntry>,
) {
    if entries.is_empty() {
        return;
    }

    let payload = EventLoggerBatchPayload { entries };

    safe_emit_to(
        app_handle,
        crate::WINDOW_GAME_OVERLAY_LABEL,
        CUSTOM_TRIGGER_BATCH_EVENT,
        payload.clone(),
    );
    safe_emit_to(
        app_handle,
        crate::WINDOW_MAIN_LABEL,
        CUSTOM_TRIGGER_BATCH_EVENT,
        payload,
    );
}
