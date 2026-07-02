use crate::live::commands_models::{
    BossDbmEvent, BossHealth, BuffUpdateState, CounterUpdateState, DeathRecord, FightResourceState,
    HateEntry, HeaderInfo, LiveDataPayload, MinimapSkillCast, MinimapSnapshot, PanelAttrState,
    RawEntityData, ShieldDetailEntry, SkillCdState, StunEntry, TeammateFantasyState,
    TrainingDummyState, build_taken_per_source, to_active_buff_state, to_active_effect_buff_state,
    to_active_effect_source_state, to_active_factor_buff_state, to_active_factor_item_state,
    to_active_passive_skill_state, to_active_profession_skill_state,
    to_active_profession_talent_state, to_equipped_item_state, to_gear_set_state,
    to_modifier_window_state, to_raw_combat_stats, to_raw_skill_stats,
};
use crate::live::entity_attr_store::EntityAttrStore;
use crate::live::entity_id::{entity_key_from_uuid_or_uid, entity_uuid_string, uid_from_uuid};
use crate::live::opcodes_models::{AttrType, Encounter, class};
use crate::live::season_cultivate::{
    SeasonCultivateActiveSnapshot, SeasonCultivateFactorSelection,
};
use blueprotobuf_lib::blueprotobuf::EEntityType;
use log::{info, trace, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;

const WEBVIEW_EMIT_BACKOFF: Duration = Duration::from_secs(5);
const WEBVIEW_EMIT_QUOTA_BACKOFF: Duration = Duration::from_secs(15);
const WEBVIEW_EMIT_BUDGET_WINDOW: Duration = Duration::from_secs(1);
const WEBVIEW_EMIT_MAX_PER_WINDOW: usize = 40;
const WEBVIEW_EMIT_PRIORITY_MAX_PER_WINDOW: usize = 60;
const EVENT_PRESSURE_FLUSH_INTERVAL: Duration = Duration::from_secs(10);
const EVENT_PRESSURE_MAX_ROWS: usize = 12;

#[derive(Debug, Clone, Copy)]
struct WebviewEmitBudget {
    window_start: Instant,
    count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct EventPressureKey {
    target_label: String,
    event: String,
}

#[derive(Debug, Clone, Default)]
struct EventPressureStats {
    attempts: u64,
    emitted: u64,
    skipped_backoff: u64,
    skipped_budget: u64,
    missing_window: u64,
    hidden_window: u64,
    visibility_error: u64,
    serialize_error: u64,
    failed_emit: u64,
    payload_bytes: u64,
    serialize_ns: u128,
}

#[derive(Debug, Default)]
struct EventPressureState {
    stats: HashMap<EventPressureKey, EventPressureStats>,
    next_flush_at: Option<Instant>,
}

#[derive(Debug, Clone, Copy)]
enum EventPressureOutcome {
    Emitted,
    SkippedBackoff,
    SkippedBudget,
    MissingWindow,
    HiddenWindow,
    VisibilityError,
    SerializeError,
    FailedEmit,
}

fn webview_emit_backoff_until() -> &'static Mutex<HashMap<String, Instant>> {
    static WEBVIEW_EMIT_BACKOFF_UNTIL: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    WEBVIEW_EMIT_BACKOFF_UNTIL.get_or_init(|| Mutex::new(HashMap::new()))
}

fn webview_emit_budget() -> &'static Mutex<HashMap<String, WebviewEmitBudget>> {
    static WEBVIEW_EMIT_BUDGET: OnceLock<Mutex<HashMap<String, WebviewEmitBudget>>> =
        OnceLock::new();
    WEBVIEW_EMIT_BUDGET.get_or_init(|| Mutex::new(HashMap::new()))
}

fn event_pressure_state() -> &'static Mutex<EventPressureState> {
    static EVENT_PRESSURE_STATE: OnceLock<Mutex<EventPressureState>> = OnceLock::new();
    EVENT_PRESSURE_STATE.get_or_init(|| Mutex::new(EventPressureState::default()))
}

fn record_event_pressure(
    target_label: &str,
    event: &str,
    outcome: EventPressureOutcome,
    payload_bytes: usize,
    serialize_duration: Option<Duration>,
) {
    let now = Instant::now();
    let rows_to_log = {
        let Ok(mut state) = event_pressure_state().lock() else {
            return;
        };
        let stats = state
            .stats
            .entry(EventPressureKey {
                target_label: target_label.to_string(),
                event: event.to_string(),
            })
            .or_default();

        stats.attempts = stats.attempts.saturating_add(1);
        match outcome {
            EventPressureOutcome::Emitted => stats.emitted = stats.emitted.saturating_add(1),
            EventPressureOutcome::SkippedBackoff => {
                stats.skipped_backoff = stats.skipped_backoff.saturating_add(1)
            }
            EventPressureOutcome::SkippedBudget => {
                stats.skipped_budget = stats.skipped_budget.saturating_add(1)
            }
            EventPressureOutcome::MissingWindow => {
                stats.missing_window = stats.missing_window.saturating_add(1)
            }
            EventPressureOutcome::HiddenWindow => {
                stats.hidden_window = stats.hidden_window.saturating_add(1)
            }
            EventPressureOutcome::VisibilityError => {
                stats.visibility_error = stats.visibility_error.saturating_add(1)
            }
            EventPressureOutcome::SerializeError => {
                stats.serialize_error = stats.serialize_error.saturating_add(1)
            }
            EventPressureOutcome::FailedEmit => {
                stats.failed_emit = stats.failed_emit.saturating_add(1)
            }
        }
        stats.payload_bytes = stats.payload_bytes.saturating_add(payload_bytes as u64);
        if let Some(duration) = serialize_duration {
            stats.serialize_ns = stats.serialize_ns.saturating_add(duration.as_nanos());
        }

        let next_flush_at = state
            .next_flush_at
            .get_or_insert(now + EVENT_PRESSURE_FLUSH_INTERVAL);
        if now < *next_flush_at {
            None
        } else {
            *next_flush_at = now + EVENT_PRESSURE_FLUSH_INTERVAL;
            if state.stats.is_empty() {
                None
            } else {
                Some(std::mem::take(&mut state.stats))
            }
        }
    };

    if let Some(rows) = rows_to_log {
        log_event_pressure_rows(rows);
    }
}

fn log_event_pressure_rows(rows: HashMap<EventPressureKey, EventPressureStats>) {
    let mut rows: Vec<_> = rows
        .into_iter()
        .filter(|(_, stats)| stats.attempts > 0)
        .collect();
    if rows.is_empty() {
        return;
    }

    rows.sort_by(|left, right| right.1.attempts.cmp(&left.1.attempts));

    let total_attempts: u64 = rows.iter().map(|(_, stats)| stats.attempts).sum();
    let total_emitted: u64 = rows.iter().map(|(_, stats)| stats.emitted).sum();
    let total_failed: u64 = rows
        .iter()
        .map(|(_, stats)| stats.failed_emit + stats.visibility_error + stats.serialize_error)
        .sum();
    let total_skipped: u64 = rows
        .iter()
        .map(|(_, stats)| {
            stats.skipped_backoff
                + stats.skipped_budget
                + stats.missing_window
                + stats.hidden_window
        })
        .sum();
    let total_payload_bytes: u64 = rows.iter().map(|(_, stats)| stats.payload_bytes).sum();
    let total_serialize_ms: f64 = rows
        .iter()
        .map(|(_, stats)| stats.serialize_ns)
        .sum::<u128>() as f64
        / 1_000_000.0;

    info!(
        target: "app::event_pressure",
        "event_pressure_summary window_ms={} rows={} attempts={} emitted={} skipped={} failed={} payload_bytes={} serialize_ms={:.3}",
        EVENT_PRESSURE_FLUSH_INTERVAL.as_millis(),
        rows.len(),
        total_attempts,
        total_emitted,
        total_skipped,
        total_failed,
        total_payload_bytes,
        total_serialize_ms,
    );

    for (key, stats) in rows.iter().take(EVENT_PRESSURE_MAX_ROWS) {
        info!(
            target: "app::event_pressure",
            "event_pressure target={} event={} attempts={} emitted={} backoff={} budget={} unavailable={} hidden={} visibility_error={} serialize_error={} failed_emit={} payload_bytes={} serialize_ms={:.3}",
            key.target_label,
            key.event,
            stats.attempts,
            stats.emitted,
            stats.skipped_backoff,
            stats.skipped_budget,
            stats.missing_window,
            stats.hidden_window,
            stats.visibility_error,
            stats.serialize_error,
            stats.failed_emit,
            stats.payload_bytes,
            stats.serialize_ns as f64 / 1_000_000.0,
        );
    }

    if rows.len() > EVENT_PRESSURE_MAX_ROWS {
        info!(
            target: "app::event_pressure",
            "event_pressure_omitted rows={}",
            rows.len() - EVENT_PRESSURE_MAX_ROWS,
        );
    }
}

fn is_webview_state_error(error_msg: &str) -> bool {
    let normalized = error_msg.to_ascii_lowercase();
    normalized.contains("0x8007139f")
        || normalized.contains("0x80070718")
        || normalized.contains("not in the correct state")
        || normalized.contains("class not registered")
        || normalized.contains("failed to send message to the webview")
        || normalized.contains("postmessage failed")
        || normalized.contains("message queue")
        || normalized.contains("not enough quota")
}

fn should_skip_webview_emit(target_label: &str) -> bool {
    let now = Instant::now();
    let mut backoff = webview_emit_backoff_until().lock().unwrap();
    let Some(until) = backoff.get(target_label).copied() else {
        return false;
    };
    if now < until {
        return true;
    }
    backoff.remove(target_label);
    false
}

fn reserve_webview_emit_budget(target_label: &str, max_per_window: usize) -> bool {
    let now = Instant::now();
    let mut budgets = webview_emit_budget().lock().unwrap();
    let budget = budgets
        .entry(target_label.to_string())
        .or_insert(WebviewEmitBudget {
            window_start: now,
            count: 0,
        });

    if now.duration_since(budget.window_start) >= WEBVIEW_EMIT_BUDGET_WINDOW {
        budget.window_start = now;
        budget.count = 0;
    }

    if budget.count >= max_per_window {
        return false;
    }

    budget.count += 1;
    true
}

fn webview_emit_backoff_duration(error_msg: &str) -> Duration {
    let normalized = error_msg.to_ascii_lowercase();
    if normalized.contains("0x80070718")
        || normalized.contains("not enough quota")
        || normalized.contains("postmessage failed")
        || normalized.contains("message queue")
    {
        WEBVIEW_EMIT_QUOTA_BACKOFF
    } else {
        WEBVIEW_EMIT_BACKOFF
    }
}

fn mark_webview_emit_backoff(target_label: &str, duration: Duration) {
    webview_emit_backoff_until()
        .lock()
        .unwrap()
        .insert(target_label.to_string(), Instant::now() + duration);
}

/// Safely emits an event to the frontend, handling WebView2 state errors gracefully.
/// This prevents the app from freezing when the WebView is in an invalid state
/// (e.g., minimized, hidden, or transitioning).
///
/// Returns `true` if the event was emitted successfully, `false` otherwise.
#[allow(dead_code)]
pub(crate) fn safe_emit<S: Serialize + Clone>(
    app_handle: &AppHandle,
    event: &str,
    payload: S,
) -> bool {
    // First check if the live window exists and is valid
    let live_window = app_handle.get_webview_window(crate::WINDOW_LIVE_LABEL);
    let main_window = app_handle.get_webview_window(crate::WINDOW_MAIN_LABEL);

    // If no windows are available, skip emitting
    if live_window.is_none() && main_window.is_none() {
        trace!("Skipping emit for '{}': no windows available", event);
        return false;
    }

    // Try to emit the event, catching WebView2 errors
    match app_handle.emit(event, payload) {
        Ok(_) => true,
        Err(e) => {
            // Check if this is a WebView2 state error (0x8007139F)
            let error_msg = e.to_string();
            if is_webview_state_error(&error_msg) {
                // This is expected when windows are minimized/hidden - don't spam logs
                trace!(
                    "WebView2 not ready for '{}' (window may be minimized/hidden)",
                    event
                );
            } else {
                // Log other errors as warnings
                warn!("Failed to emit '{}': {}", event, e);
            }
            false
        }
    }
}

fn safe_emit_to_internal<S: Serialize + Clone>(
    app_handle: &AppHandle,
    target_label: &str,
    event: &str,
    payload: S,
    priority: bool,
) -> bool {
    if should_skip_webview_emit(target_label) {
        trace!(
            "Skipping emit for '{}': target window '{}' is in WebView backoff",
            event, target_label
        );
        record_event_pressure(
            target_label,
            event,
            EventPressureOutcome::SkippedBackoff,
            0,
            None,
        );
        return false;
    }
    let max_per_window = if priority {
        WEBVIEW_EMIT_PRIORITY_MAX_PER_WINDOW
    } else {
        WEBVIEW_EMIT_MAX_PER_WINDOW
    };
    if !reserve_webview_emit_budget(target_label, max_per_window) {
        trace!(
            "Skipping emit for '{}': target window '{}' exceeded WebView emit budget",
            event, target_label
        );
        record_event_pressure(
            target_label,
            event,
            EventPressureOutcome::SkippedBudget,
            0,
            None,
        );
        return false;
    }

    let Some(window) = app_handle.get_webview_window(target_label) else {
        trace!(
            "Skipping emit for '{}': target window '{}' unavailable",
            event, target_label
        );
        record_event_pressure(
            target_label,
            event,
            EventPressureOutcome::MissingWindow,
            0,
            None,
        );
        return false;
    };

    match window.is_visible() {
        Ok(true) => {}
        Ok(false) => {
            trace!(
                "Skipping emit for '{}': target window '{}' is hidden",
                event, target_label
            );
            record_event_pressure(
                target_label,
                event,
                EventPressureOutcome::HiddenWindow,
                0,
                None,
            );
            return false;
        }
        Err(e) => {
            let error_msg = e.to_string();
            mark_webview_emit_backoff(target_label, webview_emit_backoff_duration(&error_msg));
            if is_webview_state_error(&error_msg) {
                trace!(
                    "WebView2 not ready for visibility check on '{}' (window may be closing)",
                    target_label
                );
            } else {
                warn!(
                    "Failed to check visibility for '{}' on '{}': {}",
                    event, target_label, e
                );
            }
            record_event_pressure(
                target_label,
                event,
                EventPressureOutcome::VisibilityError,
                0,
                None,
            );
            return false;
        }
    }

    match window.emit(event, payload) {
        Ok(_) => {
            record_event_pressure(target_label, event, EventPressureOutcome::Emitted, 0, None);
            true
        }
        Err(e) => {
            let error_msg = e.to_string();
            mark_webview_emit_backoff(target_label, webview_emit_backoff_duration(&error_msg));
            if is_webview_state_error(&error_msg) {
                trace!(
                    "WebView2 not ready for '{}' on '{}' (window may be minimized/hidden)",
                    event, target_label
                );
            } else {
                warn!("Failed to emit '{}' to '{}': {}", event, target_label, e);
            }
            record_event_pressure(
                target_label,
                event,
                EventPressureOutcome::FailedEmit,
                0,
                None,
            );
            false
        }
    }
}

pub(crate) fn safe_emit_to<S: Serialize + Clone>(
    app_handle: &AppHandle,
    target_label: &str,
    event: &str,
    payload: S,
) -> bool {
    safe_emit_to_internal(app_handle, target_label, event, payload, false)
}

pub(crate) fn safe_emit_to_priority<S: Serialize + Clone>(
    app_handle: &AppHandle,
    target_label: &str,
    event: &str,
    payload: S,
) -> bool {
    safe_emit_to_internal(app_handle, target_label, event, payload, true)
}

fn safe_emit_json_to_internal_lazy<F>(
    app_handle: &AppHandle,
    target_label: &str,
    event: &str,
    build_payload_json: F,
    priority: bool,
) -> bool
where
    F: FnOnce() -> Result<String, serde_json::Error>,
{
    if should_skip_webview_emit(target_label) {
        trace!(
            "Skipping emit for '{}': target window '{}' is in WebView backoff",
            event, target_label
        );
        record_event_pressure(
            target_label,
            event,
            EventPressureOutcome::SkippedBackoff,
            0,
            None,
        );
        return false;
    }
    let max_per_window = if priority {
        WEBVIEW_EMIT_PRIORITY_MAX_PER_WINDOW
    } else {
        WEBVIEW_EMIT_MAX_PER_WINDOW
    };
    if !reserve_webview_emit_budget(target_label, max_per_window) {
        trace!(
            "Skipping emit for '{}': target window '{}' exceeded WebView emit budget",
            event, target_label
        );
        record_event_pressure(
            target_label,
            event,
            EventPressureOutcome::SkippedBudget,
            0,
            None,
        );
        return false;
    }

    let Some(window) = app_handle.get_webview_window(target_label) else {
        trace!(
            "Skipping emit for '{}': target window '{}' unavailable",
            event, target_label
        );
        record_event_pressure(
            target_label,
            event,
            EventPressureOutcome::MissingWindow,
            0,
            None,
        );
        return false;
    };

    match window.is_visible() {
        Ok(true) => {}
        Ok(false) => {
            trace!(
                "Skipping emit for '{}': target window '{}' is hidden",
                event, target_label
            );
            record_event_pressure(
                target_label,
                event,
                EventPressureOutcome::HiddenWindow,
                0,
                None,
            );
            return false;
        }
        Err(e) => {
            let error_msg = e.to_string();
            mark_webview_emit_backoff(target_label, webview_emit_backoff_duration(&error_msg));
            if is_webview_state_error(&error_msg) {
                trace!(
                    "WebView2 not ready for visibility check on '{}' (window may be closing)",
                    target_label
                );
            } else {
                warn!(
                    "Failed to check visibility for '{}' on '{}': {}",
                    event, target_label, e
                );
            }
            record_event_pressure(
                target_label,
                event,
                EventPressureOutcome::VisibilityError,
                0,
                None,
            );
            return false;
        }
    }

    let serialize_started_at = Instant::now();
    let payload_json = match build_payload_json() {
        Ok(payload_json) => payload_json,
        Err(error) => {
            let serialize_duration = serialize_started_at.elapsed();
            warn!(
                "Failed to serialize payload for '{}' to '{}': {}",
                event, target_label, error
            );
            record_event_pressure(
                target_label,
                event,
                EventPressureOutcome::SerializeError,
                0,
                Some(serialize_duration),
            );
            return false;
        }
    };
    let serialize_duration = serialize_started_at.elapsed();
    let payload_bytes = payload_json.len();

    match window.emit_str(event, payload_json) {
        Ok(_) => {
            record_event_pressure(
                target_label,
                event,
                EventPressureOutcome::Emitted,
                payload_bytes,
                Some(serialize_duration),
            );
            true
        }
        Err(e) => {
            let error_msg = e.to_string();
            mark_webview_emit_backoff(target_label, webview_emit_backoff_duration(&error_msg));
            if is_webview_state_error(&error_msg) {
                trace!(
                    "WebView2 not ready for '{}' on '{}' (window may be minimized/hidden)",
                    event, target_label
                );
            } else {
                warn!("Failed to emit '{}' to '{}': {}", event, target_label, e);
            }
            record_event_pressure(
                target_label,
                event,
                EventPressureOutcome::FailedEmit,
                payload_bytes,
                Some(serialize_duration),
            );
            false
        }
    }
}

pub(crate) fn safe_emit_json_to_lazy<F>(
    app_handle: &AppHandle,
    target_label: &str,
    event: &str,
    build_payload_json: F,
) -> bool
where
    F: FnOnce() -> Result<String, serde_json::Error>,
{
    safe_emit_json_to_internal_lazy(app_handle, target_label, event, build_payload_json, false)
}

pub(crate) fn safe_emit_json_to_lazy_priority<F>(
    app_handle: &AppHandle,
    target_label: &str,
    event: &str,
    build_payload_json: F,
) -> bool
where
    F: FnOnce() -> Result<String, serde_json::Error>,
{
    safe_emit_json_to_internal_lazy(app_handle, target_label, event, build_payload_json, true)
}

/// Manages events and emits them to the frontend.
#[derive(Debug)]
pub struct EventManager {
    outbound_events: Vec<OutboundEvent>,
}

#[derive(Debug, Clone)]
pub enum OutboundEvent {
    EncounterUpdate {
        header_info: HeaderInfo,
        is_paused: bool,
    },
    EncounterReset,
    EncounterPause(bool),
    SceneChange {
        scene_id: Option<i32>,
        scene_name: String,
        dungeon_difficulty: Option<i32>,
    },
    TrainingDummyUpdate(TrainingDummyState),
    LiveData(LiveDataPayload),
    BuffUpdate(Vec<BuffUpdateState>),
    BossBuffUpdate(HashMap<String, Vec<BuffUpdateState>>),
    TeammateBuffUpdate(HashMap<String, Vec<BuffUpdateState>>),
    TeammateFantasyUpdate(Vec<TeammateFantasyState>),
    TeammateFantasyClear,
    HateListUpdate(HashMap<String, Vec<HateEntry>>),
    StunUpdate(Vec<StunEntry>),
    EntityNameMap {
        names: HashMap<i64, String>,
    },
    EntityIdentityMap {
        player_names: HashMap<String, String>,
        monster_ids: HashMap<String, i32>,
    },
    BuffCounterUpdate(Vec<CounterUpdateState>),
    SeasonCultivateFactorCounterUpdate {
        selection: SeasonCultivateFactorSelection,
        snapshot: SeasonCultivateActiveSnapshot,
        counters: Vec<CounterUpdateState>,
    },
    SkillCdUpdate(Vec<SkillCdState>),
    PanelAttrUpdate(Vec<PanelAttrState>),
    FightResourceUpdate(FightResourceState),
    ShieldDetailUpdate {
        current_hp: i64,
        max_hp: i64,
        entries: Vec<ShieldDetailEntry>,
    },
    BossDbmUpdate(Vec<BossDbmEvent>),
    MinimapUpdate {
        snapshot: Option<MinimapSnapshot>,
        skill_casts: Vec<MinimapSkillCast>,
    },
    DeathReplay(Vec<DeathRecord>),
}

impl EventManager {
    /// Creates a new `EventManager`.
    pub fn new() -> Self {
        Self {
            outbound_events: Vec::with_capacity(16),
        }
    }

    fn push_coalesced<F>(&mut self, event: OutboundEvent, mut matches_event: F)
    where
        F: FnMut(&OutboundEvent) -> bool,
    {
        if let Some(pending) = self
            .outbound_events
            .iter_mut()
            .find(|pending| matches_event(pending))
        {
            *pending = event;
            return;
        }

        self.outbound_events.push(event);
    }

    fn clear_pending_snapshots(&mut self) {
        self.outbound_events.retain(|event| {
            !matches!(
                event,
                OutboundEvent::EncounterUpdate { .. }
                    | OutboundEvent::TrainingDummyUpdate(_)
                    | OutboundEvent::LiveData(_)
                    | OutboundEvent::BuffUpdate(_)
                    | OutboundEvent::BossBuffUpdate(_)
                    | OutboundEvent::TeammateBuffUpdate(_)
                    | OutboundEvent::TeammateFantasyUpdate(_)
                    | OutboundEvent::HateListUpdate(_)
                    | OutboundEvent::EntityNameMap { .. }
                    | OutboundEvent::EntityIdentityMap { .. }
                    | OutboundEvent::BuffCounterUpdate(_)
                    | OutboundEvent::SeasonCultivateFactorCounterUpdate { .. }
                    | OutboundEvent::SkillCdUpdate(_)
                    | OutboundEvent::PanelAttrUpdate(_)
                    | OutboundEvent::FightResourceUpdate(_)
                    | OutboundEvent::ShieldDetailUpdate { .. }
                    | OutboundEvent::MinimapUpdate { .. }
                    | OutboundEvent::DeathReplay(_)
            )
        });
    }

    /// Emits an encounter update event.
    ///
    /// # Arguments
    ///
    /// * `header_info` - The header information for the encounter.
    /// * `is_paused` - Whether the encounter is paused.
    pub fn emit_encounter_update(&mut self, header_info: HeaderInfo, is_paused: bool) {
        self.push_coalesced(
            OutboundEvent::EncounterUpdate {
                header_info,
                is_paused,
            },
            |event| matches!(event, OutboundEvent::EncounterUpdate { .. }),
        );
    }

    /// Emits an encounter reset event.
    pub fn emit_encounter_reset(&mut self) {
        self.clear_pending_snapshots();
        self.outbound_events.push(OutboundEvent::EncounterReset);
    }

    /// Emits a reset event specifically for player metrics when a new segment begins.
    /// This is intentionally separate from an encounter reset so the frontend can
    /// clear only player metrics without clearing the entire dungeon log.
    /// Emits a reset event specifically for player metrics when a new segment begins.
    /// Optionally include a segment name for displaying in UI toasts.

    /// Emits an encounter pause event.
    ///
    /// # Arguments
    ///
    /// * `is_paused` - Whether the encounter is paused.
    pub fn emit_encounter_pause(&mut self, is_paused: bool) {
        self.outbound_events
            .push(OutboundEvent::EncounterPause(is_paused));
    }

    /// Emits a scene change event.
    ///
    /// # Arguments
    ///
    /// * `scene_name` - The name of the new scene.
    pub fn emit_scene_change(
        &mut self,
        scene_id: Option<i32>,
        scene_name: String,
        dungeon_difficulty: Option<i32>,
    ) {
        self.outbound_events.push(OutboundEvent::SceneChange {
            scene_id,
            scene_name,
            dungeon_difficulty,
        });
    }

    pub fn emit_training_dummy_update(&mut self, training_dummy: TrainingDummyState) {
        self.push_coalesced(
            OutboundEvent::TrainingDummyUpdate(training_dummy),
            |event| matches!(event, OutboundEvent::TrainingDummyUpdate(_)),
        );
    }

    /// Returns whether the `EventManager` should emit events.
    pub fn should_emit_events(&self) -> bool {
        true
    }

    pub fn emit_live_data(&mut self, payload: LiveDataPayload) {
        self.push_coalesced(OutboundEvent::LiveData(payload), |event| {
            matches!(event, OutboundEvent::LiveData(_))
        });
    }

    pub fn emit_buff_update(&mut self, buffs: Vec<BuffUpdateState>) {
        self.push_coalesced(OutboundEvent::BuffUpdate(buffs), |event| {
            matches!(event, OutboundEvent::BuffUpdate(_))
        });
    }

    pub fn emit_boss_buff_update(&mut self, boss_buffs: HashMap<String, Vec<BuffUpdateState>>) {
        self.push_coalesced(OutboundEvent::BossBuffUpdate(boss_buffs), |event| {
            matches!(event, OutboundEvent::BossBuffUpdate(_))
        });
    }

    pub fn emit_teammate_buff_update(
        &mut self,
        teammate_buffs: HashMap<String, Vec<BuffUpdateState>>,
    ) {
        self.push_coalesced(OutboundEvent::TeammateBuffUpdate(teammate_buffs), |event| {
            matches!(event, OutboundEvent::TeammateBuffUpdate(_))
        });
    }

    pub fn emit_teammate_fantasy_update(&mut self, fantasies: Vec<TeammateFantasyState>) {
        if fantasies.is_empty() {
            return;
        }
        self.push_coalesced(OutboundEvent::TeammateFantasyUpdate(fantasies), |event| {
            matches!(event, OutboundEvent::TeammateFantasyUpdate(_))
        });
    }

    pub fn emit_teammate_fantasy_clear(&mut self) {
        self.push_coalesced(OutboundEvent::TeammateFantasyClear, |event| {
            matches!(event, OutboundEvent::TeammateFantasyClear)
        });
    }

    pub fn emit_hate_list_update(&mut self, hate_lists: HashMap<String, Vec<HateEntry>>) {
        self.push_coalesced(OutboundEvent::HateListUpdate(hate_lists), |event| {
            matches!(event, OutboundEvent::HateListUpdate(_))
        });
    }

    pub fn emit_stun_update(&mut self, entries: Vec<StunEntry>) {
        self.push_coalesced(OutboundEvent::StunUpdate(entries), |event| {
            matches!(event, OutboundEvent::StunUpdate(_))
        });
    }

    pub fn emit_entity_name_map(&mut self, names: HashMap<i64, String>) {
        if names.is_empty() {
            return;
        }

        if let Some(OutboundEvent::EntityNameMap { names: pending }) = self
            .outbound_events
            .iter_mut()
            .find(|event| matches!(event, OutboundEvent::EntityNameMap { .. }))
        {
            pending.extend(names);
            return;
        }

        self.outbound_events
            .push(OutboundEvent::EntityNameMap { names });
    }

    pub fn emit_entity_identity_map(
        &mut self,
        player_names: HashMap<String, String>,
        monster_ids: HashMap<String, i32>,
    ) {
        if player_names.is_empty() && monster_ids.is_empty() {
            return;
        }

        if let Some(OutboundEvent::EntityIdentityMap {
            player_names: pending_player_names,
            monster_ids: pending_monster_ids,
        }) = self
            .outbound_events
            .iter_mut()
            .find(|event| matches!(event, OutboundEvent::EntityIdentityMap { .. }))
        {
            pending_player_names.extend(player_names);
            pending_monster_ids.extend(monster_ids);
            return;
        }

        self.outbound_events.push(OutboundEvent::EntityIdentityMap {
            player_names,
            monster_ids,
        });
    }

    pub fn emit_buff_counter_update(&mut self, counters: Vec<CounterUpdateState>) {
        self.push_coalesced(OutboundEvent::BuffCounterUpdate(counters), |event| {
            matches!(event, OutboundEvent::BuffCounterUpdate(_))
        });
    }

    pub fn emit_season_cultivate_factor_counter_update(
        &mut self,
        selection: SeasonCultivateFactorSelection,
        snapshot: SeasonCultivateActiveSnapshot,
        counters: Vec<CounterUpdateState>,
    ) {
        self.push_coalesced(
            OutboundEvent::SeasonCultivateFactorCounterUpdate {
                selection,
                snapshot,
                counters,
            },
            |event| {
                matches!(
                    event,
                    OutboundEvent::SeasonCultivateFactorCounterUpdate { .. }
                )
            },
        );
    }

    pub fn emit_skill_cd_update(&mut self, cds: Vec<SkillCdState>) {
        self.push_coalesced(OutboundEvent::SkillCdUpdate(cds), |event| {
            matches!(event, OutboundEvent::SkillCdUpdate(_))
        });
    }

    pub fn emit_panel_attr_update(&mut self, attrs: Vec<PanelAttrState>) {
        self.push_coalesced(OutboundEvent::PanelAttrUpdate(attrs), |event| {
            matches!(event, OutboundEvent::PanelAttrUpdate(_))
        });
    }

    pub fn emit_fight_resource_update(&mut self, fight_res: FightResourceState) {
        self.push_coalesced(OutboundEvent::FightResourceUpdate(fight_res), |event| {
            matches!(event, OutboundEvent::FightResourceUpdate(_))
        });
    }

    pub fn emit_shield_detail_update(
        &mut self,
        current_hp: i64,
        max_hp: i64,
        entries: Vec<ShieldDetailEntry>,
    ) {
        self.push_coalesced(
            OutboundEvent::ShieldDetailUpdate {
                current_hp,
                max_hp,
                entries,
            },
            |event| matches!(event, OutboundEvent::ShieldDetailUpdate { .. }),
        );
    }

    pub fn emit_boss_dbm_update(&mut self, events: Vec<BossDbmEvent>) {
        if events.is_empty() {
            return;
        }
        if let Some(OutboundEvent::BossDbmUpdate(pending)) = self
            .outbound_events
            .iter_mut()
            .find(|event| matches!(event, OutboundEvent::BossDbmUpdate(_)))
        {
            pending.extend(events);
            return;
        }
        self.outbound_events
            .push(OutboundEvent::BossDbmUpdate(events));
    }

    pub fn emit_minimap_update(
        &mut self,
        snapshot: Option<MinimapSnapshot>,
        skill_casts: Vec<MinimapSkillCast>,
    ) {
        self.outbound_events.push(OutboundEvent::MinimapUpdate {
            snapshot,
            skill_casts,
        });
    }

    pub fn emit_death_replay(&mut self, records: Vec<DeathRecord>) {
        if records.is_empty() {
            return;
        }
        self.outbound_events
            .push(OutboundEvent::DeathReplay(records));
    }

    pub fn drain_outbound_events(&mut self) -> Vec<OutboundEvent> {
        std::mem::take(&mut self.outbound_events)
    }

    pub fn drain_outbound_events_matching<F>(&mut self, mut should_drain: F) -> Vec<OutboundEvent>
    where
        F: FnMut(&OutboundEvent) -> bool,
    {
        let mut drained = Vec::new();
        let mut pending = Vec::with_capacity(self.outbound_events.len());

        for event in std::mem::take(&mut self.outbound_events) {
            if should_drain(&event) {
                drained.push(event);
            } else {
                pending.push(event);
            }
        }

        self.outbound_events = pending;
        drained
    }
}

/// The payload for an encounter update event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncounterUpdatePayload {
    /// The header information for the encounter.
    pub header_info: HeaderInfo,
    /// Whether the encounter is paused.
    pub is_paused: bool,
}

/// The payload for a scene change event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneChangePayload {
    /// The id of the new scene, if known.
    pub scene_id: Option<i32>,
    /// The name of the new scene.
    pub scene_name: String,
    /// The dungeon difficulty for the scene, if known.
    pub dungeon_difficulty: Option<i32>,
}

impl Default for EventManager {
    fn default() -> Self {
        Self::new()
    }
}

#[allow(dead_code)]
pub type EventManagerMutex = RwLock<EventManager>;

const ACTIVE_BOSS_MIN_SCENE_TOP_HP_RATIO_NUM: i64 = 1;
const ACTIVE_BOSS_MIN_SCENE_TOP_HP_RATIO_DEN: i64 = 10;
const BOSS_DISPLAY_TIER_RATIO_NUM: i64 = 1;
const BOSS_DISPLAY_TIER_RATIO_DEN: i64 = 2;

fn boss_max_hp(boss: &BossHealth) -> Option<i64> {
    boss.max_hp.filter(|value| *value > 0)
}

fn boss_hp_is_damaged(boss: &BossHealth) -> bool {
    matches!(
        (boss.current_hp, boss.max_hp),
        (Some(current_hp), Some(max_hp)) if max_hp > 0 && current_hp < max_hp
    )
}

fn hp_at_least_ratio(value: i64, baseline: i64, numerator: i64, denominator: i64) -> bool {
    if value <= 0 || baseline <= 0 || numerator <= 0 || denominator <= 0 {
        return false;
    }

    i128::from(value) * i128::from(denominator) >= i128::from(baseline) * i128::from(numerator)
}

fn sort_boss_display(bosses: &mut [BossHealth]) {
    bosses.sort_by(|left, right| {
        boss_max_hp(right)
            .unwrap_or(0)
            .cmp(&boss_max_hp(left).unwrap_or(0))
            .then_with(|| left.uid.cmp(&right.uid))
    });
}

fn select_display_bosses(mut bosses: Vec<BossHealth>) -> Vec<BossHealth> {
    sort_boss_display(&mut bosses);

    if bosses.len() <= 1 {
        return bosses;
    }

    let Some(scene_top_max_hp) = bosses.iter().filter_map(boss_max_hp).max() else {
        return bosses;
    };

    let active_top_max_hp = bosses
        .iter()
        .filter(|boss| boss_hp_is_damaged(boss))
        .filter_map(boss_max_hp)
        .max()
        .filter(|active_top_max_hp| {
            hp_at_least_ratio(
                *active_top_max_hp,
                scene_top_max_hp,
                ACTIVE_BOSS_MIN_SCENE_TOP_HP_RATIO_NUM,
                ACTIVE_BOSS_MIN_SCENE_TOP_HP_RATIO_DEN,
            )
        });

    let mut selected: Vec<BossHealth> = if let Some(active_top_max_hp) = active_top_max_hp {
        bosses
            .iter()
            .filter(|boss| boss_hp_is_damaged(boss))
            .filter(|boss| {
                boss_max_hp(boss).map_or(false, |max_hp| {
                    hp_at_least_ratio(
                        max_hp,
                        active_top_max_hp,
                        BOSS_DISPLAY_TIER_RATIO_NUM,
                        BOSS_DISPLAY_TIER_RATIO_DEN,
                    )
                })
            })
            .cloned()
            .collect()
    } else {
        bosses
            .iter()
            .filter(|boss| boss_max_hp(boss) == Some(scene_top_max_hp))
            .cloned()
            .collect()
    };

    if selected.is_empty() {
        selected = bosses
            .iter()
            .filter(|boss| boss_max_hp(boss) == Some(scene_top_max_hp))
            .cloned()
            .collect();
    }

    sort_boss_display(&mut selected);
    selected
}

pub fn generate_live_data_payload(
    encounter: &Encounter,
    attr_store: &EntityAttrStore,
    training_dummy: TrainingDummyState,
) -> LiveDataPayload {
    let elapsed_ms = encounter
        .time_last_combat_packet_ms
        .saturating_sub(encounter.time_fight_start_ms);
    let active_combat_time_ms = encounter.active_combat_time_ms.min(elapsed_ms);
    let local_player_uuid =
        (encounter.local_player_uuid > 0).then(|| entity_uuid_string(encounter.local_player_uuid));
    let local_player_key = local_player_uuid.clone();

    let mut entities = Vec::with_capacity(encounter.entity_uuid_to_entity.len());
    for (&entity_uuid, entity) in &encounter.entity_uuid_to_entity {
        if entity_uuid <= 0 {
            continue;
        }
        if entity.entity_type != EEntityType::EntChar {
            continue;
        }

        let has_combat = entity.damage.hits > 0 || entity.healing.hits > 0 || entity.taken.hits > 0;
        if !has_combat {
            continue;
        }

        let uid = uid_from_uuid(entity_uuid);
        let is_local_player =
            encounter.local_player_uuid != 0 && entity_uuid == encounter.local_player_uuid;
        let attr_key = entity_uuid;
        let row_uuid = Some(entity_uuid);
        let row_entity_uuid = entity_uuid_string(entity_uuid);
        let display_uid = uid;

        entities.push(RawEntityData {
            entity_uuid: row_entity_uuid,
            display_uid,
            uid,
            uuid: row_uuid,
            entity_key: entity_key_from_uuid_or_uid(row_uuid, uid),
            name: attr_store
                .attr(attr_key, AttrType::Name)
                .or_else(|| attr_store.attr(uid, AttrType::Name))
                .and_then(|value| value.as_string())
                .unwrap_or(&entity.name)
                .to_string(),
            class_id: attr_store
                .attr(attr_key, AttrType::ProfessionId)
                .or_else(|| attr_store.attr(uid, AttrType::ProfessionId))
                .and_then(|value| value.as_int())
                .filter(|value| *value > 0)
                .map_or(entity.class_id, |value| value as i32),
            class_spec: entity.class_spec as i32,
            class_name: class::get_class_name(
                attr_store
                    .attr(attr_key, AttrType::ProfessionId)
                    .or_else(|| attr_store.attr(uid, AttrType::ProfessionId))
                    .and_then(|value| value.as_int())
                    .filter(|value| *value > 0)
                    .map_or(entity.class_id, |value| value as i32),
            ),
            class_spec_name: class::get_class_spec(entity.class_spec),
            ability_score: attr_store
                .attr(attr_key, AttrType::FightPoint)
                .or_else(|| attr_store.attr(uid, AttrType::FightPoint))
                .and_then(|value| value.as_int())
                .filter(|value| *value > 0)
                .map_or(entity.ability_score, |value| value as i32),
            season_strength: attr_store
                .attr(attr_key, AttrType::SeasonStrength)
                .or_else(|| attr_store.attr(uid, AttrType::SeasonStrength))
                .and_then(|value| value.as_int())
                .filter(|value| *value > 0)
                .map_or(entity.season_strength, |value| value as i32),
            damage: to_raw_combat_stats(&entity.damage),
            damage_boss_only: to_raw_combat_stats(&entity.damage_boss_only),
            healing: to_raw_combat_stats(&entity.healing),
            taken: to_raw_combat_stats(&entity.taken),
            dmg_skills: entity
                .skill_uid_to_dmg_skill
                .iter()
                .map(|(skill_id, stats)| (*skill_id, to_raw_skill_stats(stats)))
                .collect(),
            heal_skills: entity
                .skill_uid_to_heal_skill
                .iter()
                .map(|(skill_id, stats)| (*skill_id, to_raw_skill_stats(stats)))
                .collect(),
            taken_skills: entity
                .skill_uid_to_taken_skill
                .iter()
                .map(|(skill_id, stats)| (*skill_id, to_raw_skill_stats(stats)))
                .collect(),
            taken_per_source: build_taken_per_source(&entity.skill_taken_from_source),
            active_buffs: if is_local_player {
                entity
                    .active_buffs
                    .iter()
                    .map(to_active_buff_state)
                    .collect()
            } else {
                Vec::new()
            },
            active_factor_buffs: if is_local_player {
                entity
                    .active_factor_buffs
                    .iter()
                    .map(to_active_factor_buff_state)
                    .collect()
            } else {
                Vec::new()
            },
            active_effect_buffs: if is_local_player {
                entity
                    .active_effect_buffs
                    .iter()
                    .map(to_active_effect_buff_state)
                    .collect()
            } else {
                Vec::new()
            },
            modifier_windows: if is_local_player {
                entity
                    .modifier_windows
                    .iter()
                    .map(to_modifier_window_state)
                    .collect()
            } else {
                Vec::new()
            },
            // Exact hit buckets are save-time history data. Keeping them out of
            // live payloads avoids replaying a large encounter ledger every tick.
            modifier_hit_buckets: Vec::new(),
            modifier_replay_hits: Vec::new(),
            // Cooldown/cast ledgers are also history data; live cooldown state is emitted
            // separately through SkillCdUpdate.
            skill_cast_events: Vec::new(),
            skill_cooldown_events: Vec::new(),
            active_effect_sources: if is_local_player {
                entity
                    .active_effect_sources
                    .iter()
                    .map(to_active_effect_source_state)
                    .collect()
            } else {
                Vec::new()
            },
            active_factor_items: if is_local_player {
                entity
                    .active_factor_items
                    .iter()
                    .map(to_active_factor_item_state)
                    .collect()
            } else {
                Vec::new()
            },
            equipped_items: entity
                .equipped_items
                .iter()
                .map(to_equipped_item_state)
                .collect(),
            active_gear_sets: if is_local_player {
                entity
                    .active_gear_sets
                    .iter()
                    .map(to_gear_set_state)
                    .collect()
            } else {
                Vec::new()
            },
            active_passive_skills: if is_local_player {
                entity
                    .active_passive_skills
                    .iter()
                    .map(to_active_passive_skill_state)
                    .collect()
            } else {
                Vec::new()
            },
            active_profession_skills: entity
                .active_profession_skills
                .iter()
                .map(to_active_profession_skill_state)
                .collect(),
            active_profession_talents: if is_local_player {
                entity
                    .active_profession_talents
                    .iter()
                    .map(to_active_profession_talent_state)
                    .collect()
            } else {
                Vec::new()
            },
        });
    }

    let bosses: Vec<BossHealth> = encounter
        .entity_uuid_to_entity
        .iter()
        .filter_map(|(&entity_uuid, entity)| {
            if entity_uuid <= 0 {
                return None;
            }
            if !entity.is_boss_metric_target() {
                return None;
            }
            let uid = uid_from_uuid(entity_uuid);
            let attr_key = entity_uuid;

            if attr_store.is_dead(attr_key) || attr_store.is_dead(uid) {
                return None;
            }

            let current_hp = attr_store
                .attr(attr_key, AttrType::CurrentHp)
                .or_else(|| attr_store.attr(uid, AttrType::CurrentHp))
                .and_then(|value| value.as_int());
            let max_hp = attr_store
                .attr(attr_key, AttrType::MaxHp)
                .or_else(|| attr_store.attr(uid, AttrType::MaxHp))
                .and_then(|value| value.as_int());
            if current_hp.is_none() && max_hp.is_none() {
                return None;
            }

            let name = if let Some(attr_name) = attr_store
                .attr(attr_key, AttrType::Name)
                .or_else(|| attr_store.attr(uid, AttrType::Name))
                .and_then(|value| value.as_string())
            {
                attr_name.to_string()
            } else if !entity.name.is_empty() {
                entity.name.clone()
            } else if let Some(packet_name) = &entity.monster_name_packet {
                packet_name.clone()
            } else {
                format!("Boss {uid}")
            };

            let boss_uuid = Some(entity_uuid);
            let display_uid = uid;

            Some(BossHealth {
                entity_uuid: boss_uuid.map(entity_uuid_string).unwrap_or_default(),
                display_uid,
                uid,
                entity_key: entity_key_from_uuid_or_uid(boss_uuid, uid),
                name,
                current_hp,
                max_hp,
                is_dead: attr_store.is_dead(attr_key) || attr_store.is_dead(uid),
            })
        })
        .collect();
    let bosses = select_display_bosses(bosses);

    LiveDataPayload {
        elapsed_ms,
        active_combat_time_ms,
        fight_start_timestamp_ms: encounter.time_fight_start_ms,
        dps_display_paused: encounter.dps_display_paused,
        training_dummy,
        total_dmg: encounter.total_dmg,
        total_dmg_boss_only: encounter.total_dmg_boss_only,
        total_heal: encounter.total_heal,
        total_effective_heal: encounter.total_effective_heal,
        local_player_uid: encounter.local_player_uid,
        local_player_uuid,
        local_player_key,
        scene_id: encounter.current_scene_id,
        scene_name: encounter.current_scene_name.clone(),
        is_paused: encounter.is_encounter_paused,
        bosses,
        entities,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live::entity_id::{entity_id_to_uuid, entity_uuid_string};
    use crate::live::opcodes_models::{AttrValue, Entity};
    use std::collections::HashSet;

    const TEST_BOSS_MONSTER_ID: i32 = 103;

    fn boss_entity(name: &str) -> Entity {
        let mut entity = Entity {
            name: name.to_string(),
            entity_type: EEntityType::EntMonster,
            ..Default::default()
        };
        entity.set_monster_type(TEST_BOSS_MONSTER_ID);
        entity.name = name.to_string();
        entity
    }

    fn insert_boss(
        encounter: &mut Encounter,
        attr_store: &mut EntityAttrStore,
        uid: i64,
        name: &str,
        current_hp: i64,
        max_hp: i64,
    ) {
        encounter
            .entity_uid_to_entity
            .insert(uid, boss_entity(name));
        attr_store.set_attr(uid, AttrType::CurrentHp, AttrValue::Int(current_hp));
        attr_store.set_attr(uid, AttrType::MaxHp, AttrValue::Int(max_hp));
    }

    #[test]
    fn live_payload_keeps_same_uid_players_distinct_by_entity_key() {
        let uid = 77_777;
        let first_uuid = entity_id_to_uuid(uid, EEntityType::EntChar, false, false);
        let second_uuid = entity_id_to_uuid(uid, EEntityType::EntChar, true, false);
        let mut encounter = Encounter::default();

        {
            let entity = encounter.entity_by_uuid_or_insert_with(first_uuid, || Entity {
                uuid: Some(first_uuid),
                name: "first same uid player".to_string(),
                entity_type: EEntityType::EntChar,
                ..Default::default()
            });
            entity.damage.hits = 1;
            entity.damage.total = 100;
        }
        {
            let entity = encounter.entity_by_uuid_or_insert_with(second_uuid, || Entity {
                uuid: Some(second_uuid),
                name: "second same uid player".to_string(),
                entity_type: EEntityType::EntChar,
                ..Default::default()
            });
            entity.damage.hits = 1;
            entity.damage.total = 200;
        }

        let payload = generate_live_data_payload(
            &encounter,
            &EntityAttrStore::default(),
            TrainingDummyState::default(),
        );

        assert_eq!(payload.entities.len(), 2);
        let entity_keys: HashSet<_> = payload
            .entities
            .iter()
            .filter_map(|entity| entity.entity_key.as_deref())
            .collect();
        assert!(entity_keys.contains(entity_uuid_string(first_uuid).as_str()));
        assert!(entity_keys.contains(entity_uuid_string(second_uuid).as_str()));
        assert!(payload.entities.iter().all(|entity| entity.uid == uid));
    }

    #[test]
    fn live_payload_preserves_entity_season_strength_without_attr_store_value() {
        let uid = 42;
        let mut encounter = Encounter::default();
        let mut entity = Entity {
            name: "Seasoned Player".to_string(),
            entity_type: EEntityType::EntChar,
            ability_score: 42000,
            season_strength: 1234,
            ..Default::default()
        };
        entity.damage.hits = 1;
        entity.damage.total = 100;
        encounter.entity_uid_to_entity.insert(uid, entity);

        let payload = generate_live_data_payload(
            &encounter,
            &EntityAttrStore::default(),
            TrainingDummyState::default(),
        );

        assert_eq!(payload.entities.len(), 1);
        assert_eq!(payload.entities[0].season_strength, 1234);
    }

    #[test]
    fn live_payload_uses_fresher_attr_store_season_strength_when_available() {
        let uid = 42;
        let mut encounter = Encounter::default();
        let mut entity = Entity {
            name: "Seasoned Player".to_string(),
            entity_type: EEntityType::EntChar,
            ability_score: 42000,
            season_strength: 1234,
            ..Default::default()
        };
        entity.damage.hits = 1;
        entity.damage.total = 100;
        encounter.entity_uid_to_entity.insert(uid, entity);

        let mut attr_store = EntityAttrStore::default();
        attr_store.set_attr(uid, AttrType::SeasonStrength, AttrValue::Int(5678));

        let payload =
            generate_live_data_payload(&encounter, &attr_store, TrainingDummyState::default());

        assert_eq!(payload.entities.len(), 1);
        assert_eq!(payload.entities[0].season_strength, 5678);
    }

    #[test]
    fn live_payload_ignores_zero_attr_store_season_strength() {
        let uid = 42;
        let mut encounter = Encounter::default();
        let mut entity = Entity {
            name: "Seasoned Player".to_string(),
            entity_type: EEntityType::EntChar,
            ability_score: 42000,
            season_strength: 1234,
            ..Default::default()
        };
        entity.damage.hits = 1;
        entity.damage.total = 100;
        encounter.entity_uid_to_entity.insert(uid, entity);

        let mut attr_store = EntityAttrStore::default();
        attr_store.set_attr(uid, AttrType::SeasonStrength, AttrValue::Int(0));

        let payload =
            generate_live_data_payload(&encounter, &attr_store, TrainingDummyState::default());

        assert_eq!(payload.entities.len(), 1);
        assert_eq!(payload.entities[0].season_strength, 1234);
    }

    #[test]
    fn live_payload_prefers_damaged_high_hp_boss_over_full_mechanics() {
        let mut encounter = Encounter::default();
        let mut attr_store = EntityAttrStore::default();

        insert_boss(
            &mut encounter,
            &mut attr_store,
            101,
            "Divine Defense Tower",
            163_800,
            163_800,
        );
        insert_boss(
            &mut encounter,
            &mut attr_store,
            102,
            "Divine Defense Tower",
            163_800,
            163_800,
        );
        insert_boss(
            &mut encounter,
            &mut attr_store,
            200,
            "Bone-Xiolotl",
            46_600_000,
            56_600_000,
        );

        let payload =
            generate_live_data_payload(&encounter, &attr_store, TrainingDummyState::default());

        assert_eq!(payload.bosses.len(), 1);
        assert_eq!(payload.bosses[0].uid, 200);
        assert_eq!(payload.bosses[0].name, "Bone-Xiolotl");
    }

    #[test]
    fn live_payload_keeps_comparable_damaged_twin_bosses() {
        let mut encounter = Encounter::default();
        let mut attr_store = EntityAttrStore::default();

        insert_boss(
            &mut encounter,
            &mut attr_store,
            201,
            "Twin Boss A",
            45_000_000,
            50_000_000,
        );
        insert_boss(
            &mut encounter,
            &mut attr_store,
            202,
            "Twin Boss B",
            42_000_000,
            48_000_000,
        );
        insert_boss(
            &mut encounter,
            &mut attr_store,
            301,
            "Mechanic Add",
            500_000,
            1_000_000,
        );

        let payload =
            generate_live_data_payload(&encounter, &attr_store, TrainingDummyState::default());
        let displayed_uids: Vec<i64> = payload.bosses.iter().map(|boss| boss.uid).collect();

        assert_eq!(displayed_uids, vec![201, 202]);
    }

    #[test]
    fn live_payload_ignores_damaged_low_hp_mechanics_when_scene_boss_is_full() {
        let mut encounter = Encounter::default();
        let mut attr_store = EntityAttrStore::default();

        insert_boss(
            &mut encounter,
            &mut attr_store,
            101,
            "Divine Defense Tower",
            120_000,
            163_800,
        );
        insert_boss(
            &mut encounter,
            &mut attr_store,
            200,
            "Bone-Xiolotl",
            56_600_000,
            56_600_000,
        );

        let payload =
            generate_live_data_payload(&encounter, &attr_store, TrainingDummyState::default());

        assert_eq!(payload.bosses.len(), 1);
        assert_eq!(payload.bosses[0].uid, 200);
        assert_eq!(payload.bosses[0].name, "Bone-Xiolotl");
    }
}
