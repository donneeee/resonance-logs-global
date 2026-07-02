use crate::database::{EncounterMetadata, PlayerNameEntry, now_ms, save_encounter};
use crate::live::bootstrap_snapshot::MonitorRuntimeSnapshot;
use crate::live::buff_monitor::{
    ActiveBuff, BuffChangeEvent, BuffChangeType, BuffMonitor, BuffTargetKind, BuffWatchProfile,
    EntityBuffMonitorConfig, EntityBuffMonitors,
};
use crate::live::commands_models::{
    BossDbmEvent, BuffUpdateState, CounterUpdateState, DeathRecord, FightResourceEntry,
    FightResourceState, HateEntry, MinimapSkillCast, PanelAttrState, ShieldDetailEntry,
    SkillCdState, StunEntry, TeammateFantasyState, TrainingDummyState,
};
use crate::live::counter_tracker::{BuffCounterTracker, CounterRule};
use crate::live::dungeon_log::{BattleStateMachine, EncounterResetReason};
use crate::live::entity_attr_store::EntityAttrStore;
use crate::live::entity_id::{
    canonical_player_uuid, entity_key_from_uuid_or_uid, entity_uuid_string, uid_from_uuid,
};
use crate::live::event_manager::EventManager;
use crate::live::factor_trace;
use crate::live::opcodes_models::{
    AttrType, AttrValue, Encounter, Entity, ObservedActiveBuff, ObservedCombatTimelineBucket,
    ObservedDamageHit, ObservedEffectBuff, ObservedEffectSource, ObservedEquippedItem,
    ObservedFactorBuff, ObservedFactorItem, ObservedModifierHitBucket, ObservedModifierReplayHit,
    ObservedModifierReplaySource, ObservedModifierWindow, ObservedProfessionSkill,
    ObservedSkillCastEvent, ObservedSkillCooldownEvent, attr_type,
};
use crate::live::opcodes_process::ParsedSkillCd;
use crate::live::season_cultivate::{FactorCounterTemplate, SeasonCultivateRuntimeState};
use crate::live::seasonal_factor_selector::{
    FactorSelectorDirtyNode, SELECTED_FACTOR_TRANSITION_RUNTIME_SOURCE,
};
use crate::live::skill_cd_monitor::{
    SkillCdMonitor, SkillCdRuntimeSnapshot, buff_changes_affect_skill_cd, calculate_skill_cd,
};
use crate::live::skill_lifecycle::{
    ClientSkillCast, ServerSkillEnd, SkillId, SkillLifecycleOutput, SkillLifecycleRuntime,
};
use crate::live::team::{TeamEquipmentItem, TeamEvent, TeamMemberEquipment, TeamRuntimeState};
use crate::live::training_dummy::{CombatGate, TrainingDummyRuntime, inspect_aoi_delta};
use blueprotobuf_lib::blueprotobuf;
use blueprotobuf_lib::blueprotobuf::AoiSyncDelta;
use blueprotobuf_lib::blueprotobuf::EEntityType;
use log::{debug, info, warn};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::time::{Duration, Instant};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};

const MAX_SKILL_TIMING_EVENTS: usize = 2_000;
const COMBAT_TIMELINE_BUCKET_MS: i64 = 1_000;
const MAX_COMBAT_TIMELINE_BUCKETS_PER_ENTITY: usize = 20_000;
const ACTIVE_EFFECT_BUFF_SOURCE_RUNTIME_PREFIX: &str = "activeEffectBuffs.";
const SELECTED_FACTOR_RUNTIME_PREFIX: &str = "SyncContainerDirtyData.v_data.dirty_tree.";
const EQUIPPED_FACTOR_RUNTIME_PREFIX: &str = "selfItemInstance:CharSerialize.equip.";
const MAX_FACTOR_SELECTOR_ZERO_SLOTS: usize = 128;
const FACTOR_SELECTOR_ZERO_SLOT_TTL: Duration = Duration::from_secs(120);
const OVERLAY_IDENTITY_RESEND_INTERVAL: Duration = Duration::from_secs(1);
const WORLD_EVENT_TYPE_BOSS_DBM: i32 = 29;

/// Represents the possible events that can be handled by the state manager.
#[derive(Debug, Clone)]
pub enum StateEvent {
    /// An enter scene event.
    EnterScene(blueprotobuf::EnterScene),
    /// A sync scene events packet.
    SyncSceneEvents(blueprotobuf::SyncSceneEvents),
    /// A sync near entities event.
    SyncNearEntities(blueprotobuf::SyncNearEntities),
    /// A sync container data event.
    SyncContainerData(blueprotobuf::SyncContainerData),
    /// A sync container dirty data event.
    SyncContainerDirtyData(blueprotobuf::SyncContainerDirtyData),
    /// A sync server time event.
    SyncServerTime(blueprotobuf::SyncServerTime),
    /// A sync dungeon data event.
    SyncDungeonData(blueprotobuf::SyncDungeonData),
    /// A sync dungeon dirty data event.
    SyncDungeonDirtyData(blueprotobuf::SyncDungeonDirtyData),
    /// A sync to me delta info event.
    SyncToMeDeltaInfo(blueprotobuf::SyncToMeDeltaInfo),
    /// A sync near delta info event.
    SyncNearDeltaInfo(blueprotobuf::SyncNearDeltaInfo),
    /// A team service notification.
    Team(TeamEvent),
    /// A reset encounter event. Contains whether this was a manual reset by the user.
    #[allow(dead_code)]
    ResetEncounter {
        /// Whether this was a manual reset by the user (true) vs automatic (false).
        is_manual: bool,
    },
    /// A local client skill cast request.
    ClientSkillCast(ClientSkillCast),
    /// A server skill end notification.
    ServerSkillEnd(ServerSkillEnd),
}

/// Represents the state of the application.
#[derive(Debug)]
pub struct AppState {
    /// The current encounter.
    pub encounter: Encounter,
    /// The event manager.
    pub event_manager: EventManager,
    /// Monitoring context for the local player.
    pub local_monitor: EntityMonitor,
    /// Player buff state observed from nearby-player deltas for modifier history.
    pub modifier_buff_monitor: BuffMonitor,
    /// Whether WIP modifier evidence capture is enabled for live/history reports.
    pub modifier_capture_enabled: bool,
    /// Raw all-entity buff state used by DBM and teammate overlay views.
    pub entity_buff_monitors: EntityBuffMonitors,
    /// Buff watch lists split by target kind.
    pub entity_buff_config: EntityBuffMonitorConfig,
    /// Non-player/proxy source UIDs observed acting on behalf of the local player.
    pub local_owned_source_uids: HashSet<i64>,
    /// Non-player/proxy source UUIDs observed acting on behalf of the local player.
    pub local_owned_source_uuids: HashSet<i64>,
    /// Source config IDs observed through local-owned proxy buff sources.
    pub local_owned_source_config_ids: HashSet<i32>,
    /// Selected Deep-Slumber/Phantom Factor items observed from local loadout dirty packets.
    pub local_selected_factor_items: Vec<ObservedFactorItem>,
    /// Whether selected-factor packet state has been observed and should override active tree fallback.
    pub selected_factor_selection_observed: bool,
    /// Set when packet-proven selected factor grades need to be saved to disk.
    pub selected_factor_cache_dirty: bool,
    /// Recently emptied factor-selector slots, used to prove later zero-to-grade selections.
    local_factor_selector_zero_slots: Vec<FactorSelectorZeroSlot>,
    /// Factor item ids explicitly removed from selector packets during this session.
    suppressed_factor_item_ids: HashSet<i32>,
    /// Factor selector slots explicitly cleared during this session.
    suppressed_factor_selector_slot_keys: HashSet<String>,
    /// Whether we've already handled the first scene change after startup.
    pub initial_scene_change_handled: bool,
    /// Event update rate in milliseconds (default: 200ms). Controls how often events are emitted to frontend.
    pub event_update_rate_ms: u64,
    /// Whether the meter auto-saves and clears the encounter when the game scene/server changes.
    pub auto_clear_on_scene_change: bool,
    /// Centralized store for all parsed Attr / TempAttr values.
    pub attr_store: EntityAttrStore,
    /// Estimated offset: local_ms - server_ms. Used to convert server buff
    /// timestamps into local time domain for clock-skew-safe rendering.
    pub server_clock_offset: i64,
    /// battle state machine for objective/state driven resets.
    pub battle_state: BattleStateMachine,
    /// If set, automatic reset can execute only after this timestamp.
    pub pending_auto_reset: Option<Instant>,
    /// Runtime state for training dummy mode.
    pub training_dummy: TrainingDummyRuntime,
    /// UIDs whose display names have already been pushed to the monster overlay.
    pub sent_overlay_uids: HashSet<i64>,
    /// Last entity names pushed to the monster overlay by display UID.
    pub sent_overlay_uid_names: HashMap<i64, String>,
    /// Last entity names pushed to the monster overlay by stable entity key.
    pub sent_overlay_identity_names: HashMap<String, String>,
    /// Last monster IDs pushed to the overlay identity maps by stable entity key.
    pub sent_overlay_monster_ids: HashMap<String, i32>,
    /// Last time the current monster-overlay target identity was resent.
    pub last_overlay_identity_resend: Option<Instant>,
    /// Last monster-overlay hate list snapshot signature emitted to the frontend.
    pub last_overlay_hate_lists_signature: Option<String>,
    /// Last monster-overlay boss buff snapshot signature emitted to the frontend.
    pub last_overlay_boss_buffs_signature: Option<String>,
    /// Last monster-overlay teammate buff snapshot signature emitted to the frontend.
    pub last_overlay_teammate_buffs_signature: Option<String>,
    /// Last monster-overlay stun snapshot signature emitted to the frontend.
    pub last_overlay_stun_signature: Option<String>,
    /// Set after a new death replay record is appended and cleared after the next frontend emit.
    pub death_snapshot_dirty: bool,
    /// Runtime state from GrpcTeamNtf packets, keyed by canonical player UUID.
    pub team: TeamRuntimeState,
    /// One-shot skill casts waiting for the minimap overlay emit cycle.
    pub pending_minimap_skill_casts: Vec<MinimapSkillCast>,
    /// Whether the minimap overlay currently has a live scene snapshot.
    pub minimap_snapshot_active: bool,
}

#[derive(Debug, Clone)]
struct FactorSelectorZeroSlot {
    path: String,
    tree_signature: String,
    offset: usize,
    observed_at: Instant,
}

#[derive(Debug)]
pub struct EntityMonitor {
    pub uid: i64,
    pub buff_monitor: BuffMonitor,
    pub skill_cd_monitor: SkillCdMonitor,
    pub skill_lifecycle: SkillLifecycleRuntime,
    pub monitored_panel_attr_ids: Vec<i32>,
    pub fight_res_state: Option<FightResourceState>,
    pub counter_tracker: BuffCounterTracker,
    pub factor_counter_tracker: BuffCounterTracker,
    pub season_cultivate: SeasonCultivateRuntimeState,
}

impl EntityMonitor {
    fn new(uid: i64) -> Self {
        Self {
            uid,
            buff_monitor: BuffMonitor::new(),
            skill_cd_monitor: SkillCdMonitor::new(),
            skill_lifecycle: SkillLifecycleRuntime::default(),
            monitored_panel_attr_ids: Vec::new(),
            fight_res_state: None,
            counter_tracker: BuffCounterTracker::default(),
            factor_counter_tracker: BuffCounterTracker::default(),
            season_cultivate: SeasonCultivateRuntimeState::default(),
        }
    }

    fn clear_runtime_state(&mut self) {
        self.buff_monitor.active_buffs.clear();
        self.skill_cd_monitor.skill_cd_map.clear();
        self.skill_lifecycle.reset();
        self.fight_res_state = None;
        self.counter_tracker.reset_counts();
        self.factor_counter_tracker.reset_counts();
        self.season_cultivate.clear_data();
    }
}

#[derive(Debug, Clone)]
pub enum LiveControlCommand {
    StateEvent(StateEvent),
    TogglePauseEncounter,
    ApplyMonitorRuntimeSnapshot(MonitorRuntimeSnapshot),
    StartTrainingDummy {
        duration_seconds: Option<u64>,
    },
    StopTrainingDummy,
    SetEventUpdateRateMs(u64),
    SetAutoClearOnSceneChange(bool),
    SetModifierCaptureEnabled(bool),
    SetMonitoredBuffs(Vec<i32>),
    SetBossMonitoredBuffs {
        global_ids: Vec<i32>,
        self_applied_ids: Vec<i32>,
        monitor_all_self_applied: bool,
    },
    SetTeammateMonitoredBuffs {
        any_source_ids: Vec<i32>,
        local_player_source_ids: Vec<i32>,
        target_self_source_ids: Vec<i32>,
        monitor_all: bool,
    },
    SetMonitoredPanelAttrs(Vec<i32>),
    SetMonitoredSkills(Vec<i32>),
    SetMonitorAllBuff(bool),
    SetBuffCounterRules(Vec<CounterRule>),
    SetSeasonCultivateFactorTemplates(Vec<FactorCounterTemplate>),
}

impl AppState {
    /// Creates a new `AppState`.
    ///
    /// # Arguments
    ///
    pub fn new() -> Self {
        Self {
            encounter: Encounter::default(),
            event_manager: EventManager::new(),
            local_monitor: EntityMonitor::new(0),
            modifier_buff_monitor: BuffMonitor::new(),
            modifier_capture_enabled: false,
            entity_buff_monitors: EntityBuffMonitors::new(),
            entity_buff_config: EntityBuffMonitorConfig::default(),
            local_owned_source_uids: HashSet::new(),
            local_owned_source_uuids: HashSet::new(),
            local_owned_source_config_ids: HashSet::new(),
            local_selected_factor_items: Vec::new(),
            selected_factor_selection_observed: false,
            selected_factor_cache_dirty: false,
            local_factor_selector_zero_slots: Vec::new(),
            suppressed_factor_item_ids: HashSet::new(),
            suppressed_factor_selector_slot_keys: HashSet::new(),
            initial_scene_change_handled: false,
            event_update_rate_ms: 200,
            auto_clear_on_scene_change: true,
            attr_store: EntityAttrStore::with_capacity(256),
            server_clock_offset: 0,
            battle_state: BattleStateMachine::default(),
            pending_auto_reset: None,
            training_dummy: TrainingDummyRuntime::default(),
            sent_overlay_uids: HashSet::new(),
            sent_overlay_uid_names: HashMap::new(),
            sent_overlay_identity_names: HashMap::new(),
            sent_overlay_monster_ids: HashMap::new(),
            last_overlay_identity_resend: None,
            last_overlay_hate_lists_signature: None,
            last_overlay_boss_buffs_signature: None,
            last_overlay_teammate_buffs_signature: None,
            last_overlay_stun_signature: None,
            death_snapshot_dirty: false,
            team: TeamRuntimeState::default(),
            pending_minimap_skill_casts: Vec::new(),
            minimap_snapshot_active: false,
        }
    }

    /// Returns whether the encounter is paused.
    pub fn is_encounter_paused(&self) -> bool {
        self.encounter.is_encounter_paused
    }

    /// Sets whether the encounter is paused.
    ///
    /// # Arguments
    ///
    /// * `paused` - Whether the encounter is paused.
    pub fn set_encounter_paused(&mut self, paused: bool) {
        self.encounter.is_encounter_paused = paused;
        self.event_manager.emit_encounter_pause(paused);
    }
}

fn emit_skill_cd_update_if_needed(state: &mut AppState, payload: Vec<SkillCdState>) {
    if payload.is_empty() {
        return;
    }
    debug!(
        "[skill-cd] emit update for {} skills (monitored_count={})",
        payload.len(),
        state
            .local_monitor
            .skill_cd_monitor
            .monitored_skill_ids
            .len()
    );
    debug!("[skill-cd] payload={:?}", payload);
    let published = payload
        .iter()
        .map(|cd| {
            format!(
                "{}:begin={} duration={} valid={} received={} calc={} accel={:.3} observed={:.3}",
                cd.skill_level_id,
                cd.begin_time,
                cd.duration,
                cd.valid_cd_time,
                cd.received_at,
                cd.calculated_duration,
                cd.cd_accelerate_rate,
                cd.observed_progress_rate
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    debug!("[skill-cd-publish] {}", published);
    state.event_manager.emit_skill_cd_update(payload);
}

fn skill_cd_matches_monitored(skill_id: i32, monitored_skill_id: i32) -> bool {
    skill_id == monitored_skill_id || skill_id / 100 == monitored_skill_id
}

fn emit_panel_attr_update_if_needed(state: &mut AppState, payload: Vec<PanelAttrState>) {
    if payload.is_empty() {
        return;
    }
    state.event_manager.emit_panel_attr_update(payload);
}

fn emit_local_buff_update_snapshot(state: &mut AppState) {
    let payload = state
        .local_monitor
        .buff_monitor
        .build_update_payload(state.server_clock_offset)
        .unwrap_or_default();
    state.event_manager.emit_buff_update(payload);
}

fn emit_boss_buff_update_snapshot(state: &mut AppState) {
    let mut payload = build_monster_buff_snapshots(state);
    payload.retain(|&entity_uuid, _| !state.attr_store.is_dead(entity_uuid));
    let mut identity_names = HashMap::new();
    let mut monster_ids = HashMap::new();
    for &entity_uuid in payload.keys() {
        let entity = state.encounter.entity_by_uuid(entity_uuid);
        let display_uid = entity
            .map(|entity| state.encounter.display_uid_for_entity(entity_uuid, entity))
            .unwrap_or_else(|| uid_from_uuid(entity_uuid));
        if let Some(name) =
            known_entity_display_name(display_uid, Some(entity_uuid), entity, &state.attr_store)
        {
            queue_overlay_identity_name(
                &mut state.sent_overlay_identity_names,
                &mut identity_names,
                entity_uuid_string(entity_uuid),
                name,
                false,
            );
        }
        if let Some(monster_id) = monster_id_for_uuid(state, entity_uuid, entity) {
            queue_overlay_monster_id(
                &mut state.sent_overlay_monster_ids,
                &mut monster_ids,
                entity_uuid_string(entity_uuid),
                monster_id,
                false,
            );
            if display_uid > 0 {
                queue_overlay_monster_id(
                    &mut state.sent_overlay_monster_ids,
                    &mut monster_ids,
                    display_uid.to_string(),
                    monster_id,
                    false,
                );
            }
        }
    }
    if !identity_names.is_empty() || !monster_ids.is_empty() {
        state
            .event_manager
            .emit_entity_identity_map(identity_names, monster_ids);
    }
    let boss_buff_snapshot: HashMap<String, Vec<BuffUpdateState>> = payload
        .into_iter()
        .map(|(entity_uuid, buffs)| (entity_uuid_string(entity_uuid), buffs))
        .collect();
    if should_emit_overlay_signature(
        &mut state.last_overlay_boss_buffs_signature,
        buff_snapshot_signature(&boss_buff_snapshot),
    ) {
        state
            .event_manager
            .emit_boss_buff_update(boss_buff_snapshot);
    }
}

fn emit_shield_detail_update_if_needed(state: &mut AppState, mut entries: Vec<ShieldDetailEntry>) {
    let entity_uuid = state.attr_store.local_player_uuid();
    let current_hp = state
        .attr_store
        .attr(entity_uuid, AttrType::CurrentHp)
        .and_then(AttrValue::as_int)
        .unwrap_or(0);
    let max_hp = state
        .attr_store
        .attr(entity_uuid, AttrType::MaxHp)
        .and_then(AttrValue::as_int)
        .unwrap_or(0);
    let clock_offset = state.server_clock_offset;

    for entry in &mut entries {
        if let Some(active_buff) = state
            .local_monitor
            .buff_monitor
            .active_buffs
            .get(&(entry.buff_uuid as i32))
        {
            entry.base_id = active_buff.base_id;
            if active_buff.duration > 0 {
                entry.expire_time_ms = active_buff
                    .create_time
                    .saturating_add(clock_offset)
                    .saturating_add(active_buff.duration as i64);
            }
        }
    }

    state
        .event_manager
        .emit_shield_detail_update(current_hp, max_hp, entries);
}

fn emit_buff_counter_update_if_needed(state: &mut AppState, payload: Vec<CounterUpdateState>) {
    state.event_manager.emit_buff_counter_update(payload);
}

fn emit_season_cultivate_factor_counter_update(state: &mut AppState) {
    let selected_item_ids = season_cultivate_factor_counter_item_ids(state);
    let selection = state
        .local_monitor
        .season_cultivate
        .selected_factor_selection(&selected_item_ids, state.selected_factor_selection_observed);
    let snapshot = state
        .local_monitor
        .season_cultivate
        .active_snapshot()
        .clone();
    let counters = state.local_monitor.factor_counter_tracker.build_payload(
        &state.attr_store,
        current_local_player_uuid(&state.encounter),
    );
    factor_trace::record(
        "factor-counter",
        "counter-update",
        json!({
            "selectedItemIds": selected_item_ids,
            "selection": &selection,
            "snapshot": &snapshot,
            "counters": &counters,
        }),
    );
    state
        .event_manager
        .emit_season_cultivate_factor_counter_update(selection, snapshot, counters);
}

fn skill_lifecycle_output_trace(output: SkillLifecycleOutput) -> (&'static str, i32) {
    match output {
        SkillLifecycleOutput::CastStarted(skill_id) => ("castStarted", skill_id.get()),
        SkillLifecycleOutput::DurationStarted(skill_id) => ("durationStarted", skill_id.get()),
        SkillLifecycleOutput::DurationEnded(skill_id) => ("durationEnded", skill_id.get()),
        SkillLifecycleOutput::CastCompleted(skill_id) => ("castCompleted", skill_id.get()),
    }
}

fn apply_skill_lifecycle_outputs(
    state: &mut AppState,
    outputs: Vec<SkillLifecycleOutput>,
) -> (bool, bool) {
    let mut counter_dirty = false;
    let mut factor_counter_dirty = false;
    for output in outputs {
        let (output_kind, skill_id) = skill_lifecycle_output_trace(output);
        let counter_changed = state
            .local_monitor
            .counter_tracker
            .on_skill_lifecycle_output(output);
        let factor_counter_changed = state
            .local_monitor
            .factor_counter_tracker
            .on_skill_lifecycle_output(output);
        counter_dirty |= counter_changed;
        factor_counter_dirty |= factor_counter_changed;
        factor_trace::record(
            "factor-input",
            "skill-lifecycle-output",
            json!({
                "output": output_kind,
                "skillId": skill_id,
                "counterChanged": counter_changed,
                "factorCounterChanged": factor_counter_changed,
            }),
        );
    }
    (counter_dirty, factor_counter_dirty)
}

fn should_drop_event_while_paused(state: &AppState, event: &StateEvent) -> bool {
    state.is_encounter_paused()
        && matches!(
            event,
            StateEvent::SyncNearEntities(_)
                | StateEvent::SyncContainerData(_)
                | StateEvent::SyncContainerDirtyData(_)
                | StateEvent::SyncToMeDeltaInfo(_)
                | StateEvent::SyncNearDeltaInfo(_)
        )
}

fn tick_counter_trackers(state: &mut AppState) -> (bool, bool) {
    let tick_now_ms = now_ms();
    let local_player_uuid = current_local_player_uuid(&state.encounter);
    let counter_dirty = state.local_monitor.counter_tracker.tick_counters(
        tick_now_ms,
        &state.attr_store,
        local_player_uuid,
    );
    let factor_counter_dirty = state.local_monitor.factor_counter_tracker.tick_counters(
        tick_now_ms,
        &state.attr_store,
        local_player_uuid,
    );
    (counter_dirty, factor_counter_dirty)
}

fn minimap_monster_id_of(state: &AppState, entity_uuid: i64) -> Option<i32> {
    state
        .attr_store
        .attr(entity_uuid, AttrType::MonsterId)
        .and_then(AttrValue::as_int)
        .or_else(|| {
            state
                .encounter
                .entity_uuid_to_entity
                .get(&entity_uuid)
                .and_then(|entity| entity.monster_type_id.map(i64::from))
        })
        .and_then(|id| i32::try_from(id).ok())
        .filter(|id| *id > 0)
}

fn entity_has_minimap_mechanic_buff(
    state: &AppState,
    entity_uuid: i64,
    config: &crate::live::minimap::scene::SceneConfig,
) -> bool {
    state
        .entity_buff_monitors
        .monitors
        .get(&entity_uuid)
        .is_some_and(|monitor| {
            monitor
                .active_buffs
                .values()
                .any(|buff| config.mechanic_buff_ids.contains(&buff.base_id))
        })
}

fn is_minimap_relevant_entity(state: &AppState, entity_uuid: i64, scene_id: i32) -> bool {
    if entity_uuid == state.encounter.local_player_uuid || state.team.members.contains(&entity_uuid)
    {
        return true;
    }

    let Some(config) = crate::live::minimap::scene::scene_config_for(scene_id) else {
        return false;
    };
    if entity_has_minimap_mechanic_buff(state, entity_uuid, config) {
        return true;
    }
    minimap_monster_id_of(state, entity_uuid)
        .is_some_and(|monster_id| config.relevant_monster_ids.contains(&monster_id))
}

fn process_entity_buff_effect_bytes(
    state: &mut AppState,
    target_uuid: i64,
    raw_bytes: &[u8],
) -> Option<(BuffTargetKind, crate::live::buff_monitor::BuffProcessResult)> {
    // Match CN's ownership model: classify the target first, then let the
    // per-entity monitor ingest the server-issued buff packet.
    let kind = classify_buff_effect_target(state, target_uuid).or_else(|| {
        let scene_id = state.encounter.current_scene_id.unwrap_or_default();
        (crate::live::minimap::scene::is_minimap_scene(scene_id)).then_some(BuffTargetKind::Monster)
    })?;
    let result = state.entity_buff_monitors.process_buff_effect_bytes(
        target_uuid,
        raw_bytes,
        &mut state.server_clock_offset,
    );
    Some((kind, result))
}

fn sample_actor_state_for_lifecycle(state: &mut AppState) -> (bool, bool) {
    let outputs = state.local_monitor.skill_lifecycle.on_actor_state_sample(
        &state.attr_store,
        current_local_player_uuid(&state.encounter),
    );
    apply_skill_lifecycle_outputs(state, outputs)
}

fn emit_counter_updates_if_dirty(
    state: &mut AppState,
    counter_dirty: bool,
    factor_counter_dirty: bool,
) {
    if counter_dirty {
        let payload = state.local_monitor.counter_tracker.build_payload(
            &state.attr_store,
            current_local_player_uuid(&state.encounter),
        );
        emit_buff_counter_update_if_needed(state, payload);
    }
    if factor_counter_dirty {
        emit_season_cultivate_factor_counter_update(state);
    }
}

fn collect_dungeon_player_equipment(
    v_data: &blueprotobuf::DungeonSyncData,
) -> Vec<TeamMemberEquipment> {
    let Some(player_list) = v_data.dungeon_player_list.as_ref() else {
        return Vec::new();
    };

    let mut equipment = Vec::new();
    let mut player_infos: Vec<_> = player_list.player_infos.iter().collect();
    player_infos.sort_by_key(|(key, _)| **key);

    for (_, player_info) in player_infos {
        let social_data = player_info.social_data.as_ref();
        let char_id = player_info
            .char_id
            .or_else(|| social_data.and_then(|data| data.char_id));
        let member_uuid = canonical_player_uuid(char_id.unwrap_or_default());
        if member_uuid == 0 {
            continue;
        }

        let Some(equip_data) = social_data.and_then(|data| data.equip_data.as_ref()) else {
            continue;
        };

        let mut items: Vec<_> = equip_data
            .equip_infos
            .iter()
            .filter_map(|item| {
                let slot = item.slot.filter(|slot| *slot > 0)?;
                let item_config_id = item.equip_id.filter(|equip_id| *equip_id > 0)?;
                Some(TeamEquipmentItem {
                    slot,
                    item_config_id,
                })
            })
            .collect();

        if items.is_empty() {
            continue;
        }

        items.sort_by_key(|item| (item.slot, item.item_config_id));
        equipment.push(TeamMemberEquipment {
            member_uuid,
            runtime_source: "SyncDungeonData.v_data.dungeon_player_list.social_data.equip_data",
            items,
        });
    }

    equipment
}

fn upsert_remote_equipped_items<I>(target: &mut Vec<ObservedEquippedItem>, incoming: I)
where
    I: IntoIterator<Item = ObservedEquippedItem>,
{
    for item in incoming {
        if let Some(existing) = target
            .iter_mut()
            .find(|existing| existing.slot == item.slot)
        {
            *existing = item;
        } else {
            target.push(item);
        }
    }
    target.sort_by_key(|item| (item.slot, item.item_config_id, item.item_uuid.unwrap_or(0)));
}

fn refresh_season_cultivate_factor_rules(state: &mut AppState) {
    let selected_item_ids = season_cultivate_factor_counter_item_ids(state);
    let rules = state
        .local_monitor
        .season_cultivate
        .build_factor_counter_rules_for_selected_items(
            &selected_item_ids,
            state.selected_factor_selection_observed,
        );
    log::debug!(
        target: "app::live",
        "season cultivate factor rules refreshed selected_observed={} selected_item_ids={:?} active_item_ids={:?} rule_count={}",
        state.selected_factor_selection_observed,
        selected_item_ids,
        state
            .local_monitor
            .season_cultivate
            .active_snapshot()
            .active_item_ids,
        rules.len()
    );
    factor_trace::record(
        "factor-counter",
        "rules-refreshed",
        json!({
            "selectedObserved": state.selected_factor_selection_observed,
            "selectedItemIds": selected_item_ids,
            "activeSnapshot": state.local_monitor.season_cultivate.active_snapshot(),
            "rules": &rules,
        }),
    );
    state.local_monitor.factor_counter_tracker.set_rules(rules);
}

fn reset_season_cultivate_factor_counters(state: &mut AppState) {
    state.local_monitor.factor_counter_tracker.reset_counts();
    factor_trace::record(
        "factor-counter",
        "counters-reset",
        json!({
            "selectedItemIds": season_cultivate_factor_counter_item_ids(state),
            "activeSnapshot": state.local_monitor.season_cultivate.active_snapshot(),
        }),
    );
    emit_season_cultivate_factor_counter_update(state);
}

fn selected_factor_rule_item_ids(items: &[ObservedFactorItem]) -> Vec<i32> {
    let mut ids: Vec<i32> = items
        .iter()
        .map(|item| item.item_config_id)
        .filter(|item_id| *item_id > 0)
        .collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}

fn selected_factor_rule_gate_signature(state: &AppState) -> (Vec<i32>, Vec<String>) {
    let mut suppressed_item_ids: Vec<i32> =
        state.suppressed_factor_item_ids.iter().copied().collect();
    suppressed_item_ids.sort_unstable();

    let mut suppressed_slot_keys: Vec<String> = state
        .suppressed_factor_selector_slot_keys
        .iter()
        .cloned()
        .collect();
    suppressed_slot_keys.sort();

    (suppressed_item_ids, suppressed_slot_keys)
}

fn selected_factor_item_is_suppressed(state: &AppState, item: &ObservedFactorItem) -> bool {
    if state
        .suppressed_factor_item_ids
        .contains(&item.item_config_id)
    {
        return true;
    }
    let Some(slot_key) = selected_factor_item_slot_key(item) else {
        return false;
    };
    state
        .suppressed_factor_selector_slot_keys
        .contains(&slot_key)
}

fn season_cultivate_factor_counter_item_ids(state: &AppState) -> Vec<i32> {
    let mut ids: HashSet<i32> = state
        .local_selected_factor_items
        .iter()
        .filter(|item| !selected_factor_item_is_suppressed(state, item))
        .map(|item| item.item_config_id)
        .filter(|item_id| *item_id > 0)
        .collect();

    let active_selection = state.local_monitor.season_cultivate.active_selection();
    let can_use_active_source_fallback = !state.selected_factor_selection_observed
        && state.local_selected_factor_items.is_empty()
        && state.suppressed_factor_item_ids.is_empty()
        && state.suppressed_factor_selector_slot_keys.is_empty();
    if can_use_active_source_fallback {
        for item_id in &active_selection.source_item_ids {
            if *item_id > 0 && !state.suppressed_factor_item_ids.contains(item_id) {
                ids.insert(*item_id);
            }
        }
    }

    for item_id in &active_selection.slot_item_ids {
        if *item_id > 0 && !state.suppressed_factor_item_ids.contains(item_id) {
            ids.insert(*item_id);
        }
    }

    let mut ids: Vec<i32> = ids.into_iter().collect();
    ids.sort_unstable();
    ids
}

fn prune_selected_factor_items_to_active_snapshot(state: &mut AppState) -> bool {
    let active_item_ids = &state
        .local_monitor
        .season_cultivate
        .active_snapshot()
        .active_item_ids;
    if active_item_ids.is_empty() || state.local_selected_factor_items.is_empty() {
        return false;
    }

    let before = state.local_selected_factor_items.len();
    state
        .local_selected_factor_items
        .retain(|item| active_item_ids.binary_search(&item.item_config_id).is_ok());
    let changed = state.local_selected_factor_items.len() != before;
    if changed {
        state.selected_factor_cache_dirty = true;
        log::debug!(
            target: "app::live",
            "pruned stale selected factor item(s) against active season cultivate snapshot remaining_ids={:?}",
            selected_factor_rule_item_ids(&state.local_selected_factor_items)
        );
    }
    changed
}

fn replace_selected_factor_items_from_equipped_snapshot(state: &mut AppState) -> bool {
    let Some(entity) = local_player_entity(&state.encounter) else {
        return false;
    };

    let mut equipped_items: Vec<ObservedFactorItem> = entity
        .active_factor_items
        .iter()
        .filter(|item| observed_factor_item_is_equipped_snapshot(item))
        .cloned()
        .collect();
    equipped_items.sort_by_key(|item| {
        (
            item.factor_buff_id,
            item.grade.unwrap_or(0),
            item.item_config_id,
            item.item_uuid.unwrap_or(0),
        )
    });
    if equipped_items.is_empty() {
        return false;
    }

    let before_ids = selected_factor_rule_item_ids(&state.local_selected_factor_items);
    let after_ids = selected_factor_rule_item_ids(&equipped_items);
    let observed_before = state.selected_factor_selection_observed;
    let had_suppressed_items = !state.suppressed_factor_item_ids.is_empty()
        || !state.suppressed_factor_selector_slot_keys.is_empty();
    let changed = before_ids != after_ids || !observed_before || had_suppressed_items;
    if !changed {
        return false;
    }

    state.local_selected_factor_items = equipped_items;
    state.selected_factor_selection_observed = true;
    state.selected_factor_cache_dirty = true;
    state.suppressed_factor_item_ids.clear();
    state.suppressed_factor_selector_slot_keys.clear();
    log::debug!(
        target: "app::live",
        "selected factor items replaced from equipped snapshot selected_item_ids={:?}",
        selected_factor_rule_item_ids(&state.local_selected_factor_items)
    );
    true
}

fn hydrate_entities_from_attr_store(state: &mut AppState) {
    for (&uuid, entity) in state.encounter.entity_uuid_to_entity.iter_mut() {
        if uuid > 0 {
            state.attr_store.hydrate_entity(uuid, entity);
        }
    }
}

pub(crate) fn resolve_entity_display_name(
    uid: i64,
    entity: &Entity,
    attr_store: &EntityAttrStore,
) -> String {
    if let Some(name) = entity
        .uuid
        .filter(|uuid| *uuid > 0)
        .and_then(|uuid| attr_store.attr(uuid, AttrType::Name))
        .and_then(|value| value.as_string())
    {
        return name.to_string();
    }
    if let Some(name) = attr_store
        .attr(uid, AttrType::Name)
        .and_then(|value| value.as_string())
    {
        return name.to_string();
    }
    if !entity.name.is_empty() {
        return entity.name.clone();
    }
    format!("目标 {uid}")
}

fn known_entity_display_name(
    uid: i64,
    uuid: Option<i64>,
    entity: Option<&Entity>,
    attr_store: &EntityAttrStore,
) -> Option<String> {
    if let Some(name) = entity
        .and_then(|entity| entity.uuid)
        .or(uuid)
        .filter(|uuid| *uuid > 0)
        .and_then(|uuid| attr_store.attr(uuid, AttrType::Name))
        .and_then(|value| value.as_string())
    {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if let Some(name) = attr_store
        .attr(uid, AttrType::Name)
        .and_then(|value| value.as_string())
    {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if let Some(entity) = entity {
        let trimmed = entity.name.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
        if let Some(packet_name) = &entity.monster_name_packet {
            let trimmed = packet_name.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn queue_overlay_uid_name(
    sent_names: &mut HashMap<i64, String>,
    queued_names: &mut HashMap<i64, String>,
    uid: i64,
    name: String,
) {
    if uid <= 0
        || sent_names
            .get(&uid)
            .is_some_and(|previous| previous == &name)
    {
        return;
    }
    sent_names.insert(uid, name.clone());
    queued_names.insert(uid, name);
}

fn queue_overlay_identity_name(
    sent_names: &mut HashMap<String, String>,
    queued_names: &mut HashMap<String, String>,
    entity_key: String,
    name: String,
    force: bool,
) {
    if entity_key.trim().is_empty()
        || (!force
            && sent_names
                .get(&entity_key)
                .is_some_and(|previous| previous == &name))
    {
        return;
    }
    sent_names.insert(entity_key.clone(), name.clone());
    queued_names.insert(entity_key, name);
}

fn queue_overlay_monster_id(
    sent_monster_ids: &mut HashMap<String, i32>,
    queued_monster_ids: &mut HashMap<String, i32>,
    entity_key: String,
    monster_id: i32,
    force: bool,
) {
    if entity_key.trim().is_empty()
        || monster_id <= 0
        || (!force
            && sent_monster_ids
                .get(&entity_key)
                .is_some_and(|previous| *previous == monster_id))
    {
        return;
    }
    sent_monster_ids.insert(entity_key.clone(), monster_id);
    queued_monster_ids.insert(entity_key, monster_id);
}

fn should_resend_overlay_identity_names(state: &mut AppState) -> bool {
    let now = Instant::now();
    let should_resend = state
        .last_overlay_identity_resend
        .map(|last| now.duration_since(last) >= OVERLAY_IDENTITY_RESEND_INTERVAL)
        .unwrap_or(true);
    if should_resend {
        state.last_overlay_identity_resend = Some(now);
    }
    should_resend
}

fn buff_snapshot_signature(snapshot: &HashMap<String, Vec<BuffUpdateState>>) -> String {
    let mut keys: Vec<&String> = snapshot.keys().collect();
    keys.sort();

    let mut signature = String::new();
    for key in keys {
        let _ = write!(signature, "{}=", key);
        let mut buffs = snapshot.get(key).cloned().unwrap_or_default();
        buffs.sort_by(|left, right| {
            left.base_id
                .cmp(&right.base_id)
                .then_with(|| left.host_key.cmp(&right.host_key))
                .then_with(|| left.source_key.cmp(&right.source_key))
                .then_with(|| left.host_uid.cmp(&right.host_uid))
                .then_with(|| left.source_uid.cmp(&right.source_uid))
                .then_with(|| left.create_time_ms.cmp(&right.create_time_ms))
                .then_with(|| left.duration_ms.cmp(&right.duration_ms))
                .then_with(|| left.layer.cmp(&right.layer))
        });
        for buff in buffs {
            let _ = write!(
                signature,
                "{}:{}:{}:{}:{}:{}:{:?}:{:?}|",
                buff.base_id,
                buff.layer,
                buff.duration_ms,
                buff.create_time_ms,
                buff.host_uid,
                buff.source_uid,
                buff.host_key,
                buff.source_key
            );
        }
        signature.push(';');
    }

    signature
}

fn hate_snapshot_signature(snapshot: &HashMap<String, Vec<HateEntry>>) -> String {
    let mut keys: Vec<&String> = snapshot.keys().collect();
    keys.sort();

    let mut signature = String::new();
    for key in keys {
        let _ = write!(signature, "{}=", key);
        let mut entries = snapshot.get(key).cloned().unwrap_or_default();
        entries.sort_by(|left, right| {
            left.uid
                .cmp(&right.uid)
                .then_with(|| left.entity_uuid_string.cmp(&right.entity_uuid_string))
                .then_with(|| left.entity_key.cmp(&right.entity_key))
                .then_with(|| left.hate_val.cmp(&right.hate_val))
        });
        for entry in entries {
            let _ = write!(
                signature,
                "{}:{}:{:?}:{:?}|",
                entry.uid, entry.hate_val, entry.entity_uuid_string, entry.entity_key
            );
        }
        signature.push(';');
    }

    signature
}

fn stun_snapshot_signature(snapshot: &[StunEntry]) -> String {
    let mut entries = snapshot.to_vec();
    entries.sort_by(|left, right| {
        left.boss_entity_uuid
            .cmp(&right.boss_entity_uuid)
            .then_with(|| left.monster_id.cmp(&right.monster_id))
            .then_with(|| left.current.cmp(&right.current))
            .then_with(|| left.max.cmp(&right.max))
    });

    let mut signature = String::new();
    for entry in entries {
        let _ = write!(
            signature,
            "{}:{}:{}:{}|",
            entry.boss_entity_uuid, entry.monster_id, entry.current, entry.max
        );
    }
    signature
}

fn should_emit_overlay_signature(
    last_signature: &mut Option<String>,
    next_signature: String,
) -> bool {
    if last_signature.as_deref() == Some(next_signature.as_str()) {
        return false;
    }

    *last_signature = Some(next_signature);
    true
}

fn clear_overlay_snapshot_signatures(state: &mut AppState) {
    state.last_overlay_hate_lists_signature = None;
    state.last_overlay_boss_buffs_signature = None;
    state.last_overlay_teammate_buffs_signature = None;
    state.last_overlay_stun_signature = None;
}

fn resolve_player_display_name(
    uid: i64,
    entity: Option<&Entity>,
    attr_store: &EntityAttrStore,
) -> String {
    if let Some(name) = entity
        .and_then(|entity| entity.uuid.filter(|uuid| *uuid > 0))
        .and_then(|uuid| attr_store.attr(uuid, AttrType::Name))
        .and_then(|value| value.as_string())
    {
        return name.to_string();
    }
    if let Some(name) = attr_store
        .attr(uid, AttrType::Name)
        .and_then(|value| value.as_string())
    {
        return name.to_string();
    }
    if let Some(entity) = entity {
        if !entity.name.is_empty() {
            return entity.name.clone();
        }
    }
    format!("UID {uid}")
}

fn collect_player_names(encounter: &Encounter) -> Vec<PlayerNameEntry> {
    let mut player_names: Vec<PlayerNameEntry> =
        Vec::with_capacity(encounter.entity_uuid_to_entity.len());
    player_names.extend(
        encounter
            .entity_uuid_to_entity
            .iter()
            .filter_map(|(&uuid, entity)| {
                if uuid <= 0 {
                    return None;
                }
                let uid = uid_from_uuid(uuid);
                entity_has_player_identity_surface(uuid, entity, encounter.local_player_uuid).then(
                    || PlayerNameEntry {
                        uid,
                        uuid: Some(uuid),
                        name: if entity.name.trim().is_empty() {
                            format!("#{uid}")
                        } else {
                            entity.name.clone()
                        },
                        class_id: entity.class_id,
                        class_spec: entity.class_spec,
                    },
                )
            }),
    );
    player_names.sort_by(|a, b| a.name.cmp(&b.name));
    player_names.dedup_by(|a, b| a.name == b.name);
    player_names
}

fn entity_has_player_identity_surface(
    entity_uuid: i64,
    entity: &Entity,
    local_player_uuid: i64,
) -> bool {
    entity.entity_type == EEntityType::EntChar
        && (entity_uuid == local_player_uuid
            || !entity.name.trim().is_empty()
            || entity.class_id > 0
            || entity.ability_score > 0
            || entity.level > 0
            || entity.season_strength > 0
            || entity.damage.hits > 0
            || entity.healing.hits > 0
            || entity.taken.hits > 0)
}

fn is_known_character_entity(state: &AppState, entity_uuid: i64) -> bool {
    state
        .encounter
        .entity_uuid_to_entity
        .get(&entity_uuid)
        .is_some_and(|entity| entity.entity_type == EEntityType::EntChar)
}

fn is_known_monster_entity(state: &AppState, entity_uuid: i64) -> bool {
    let entity = state.encounter.entity_uuid_to_entity.get(&entity_uuid);
    entity.is_some_and(|entity| entity.entity_type == EEntityType::EntMonster)
        || monster_id_for_uuid(state, entity_uuid, entity).is_some()
        || EEntityType::from(entity_uuid) == EEntityType::EntMonster
}

fn classify_buff_effect_target(state: &AppState, target_uuid: i64) -> Option<BuffTargetKind> {
    if target_uuid == current_local_player_uuid(&state.encounter) && target_uuid != 0 {
        return Some(BuffTargetKind::LocalPlayer);
    }
    if is_known_monster_entity(state, target_uuid) {
        return Some(BuffTargetKind::Monster);
    }
    if is_known_character_entity(state, target_uuid) {
        return Some(BuffTargetKind::Teammate);
    }
    None
}

fn classify_buff_snapshot_target(state: &AppState, target_uuid: i64) -> Option<BuffTargetKind> {
    if target_uuid == current_local_player_uuid(&state.encounter) && target_uuid != 0 {
        return Some(BuffTargetKind::LocalPlayer);
    }
    if current_attack_target_uuid(state) == Some(target_uuid) {
        return Some(BuffTargetKind::Monster);
    }
    if state.team.members.contains(&target_uuid) || is_known_character_entity(state, target_uuid) {
        return Some(BuffTargetKind::Teammate);
    }
    None
}

fn current_local_player_uuid(encounter: &Encounter) -> i64 {
    encounter.local_player_uuid
}

fn local_player_entity(encounter: &Encounter) -> Option<&Entity> {
    encounter.entity_by_uuid(encounter.local_player_uuid)
}

fn local_player_entity_mut(encounter: &mut Encounter) -> Option<&mut Entity> {
    encounter.entity_mut_by_uuid(encounter.local_player_uuid)
}

fn current_attack_target_uuid(state: &AppState) -> Option<i64> {
    let local_player_uuid = current_local_player_uuid(&state.encounter);
    if local_player_uuid == 0 {
        return None;
    }

    let target_uuid = state
        .attr_store
        .attr(local_player_uuid, AttrType::TargetId)
        .and_then(AttrValue::as_int)
        .filter(|uuid| *uuid > 0)?;

    let is_monster = is_known_monster_entity(state, target_uuid);
    if !is_monster || state.attr_store.is_dead(target_uuid) {
        return None;
    }

    Some(target_uuid)
}

fn monster_id_for_uuid(state: &AppState, entity_uuid: i64, entity: Option<&Entity>) -> Option<i32> {
    entity
        .and_then(|entity| entity.monster_type_id)
        .or_else(|| {
            state
                .attr_store
                .attr(entity_uuid, AttrType::MonsterId)
                .and_then(AttrValue::as_int)
                .and_then(|value| i32::try_from(value).ok())
                .filter(|monster_id| *monster_id > 0)
        })
}

#[allow(dead_code)]
fn encounter_entity_for_identity_mut(
    encounter: &mut Encounter,
    uid: i64,
    uuid: Option<i64>,
    entity_type: EEntityType,
) -> &mut Entity {
    encounter.entity_by_identity_or_insert_with(uid, uuid, || Entity {
        entity_type,
        ..Default::default()
    })
}

fn encounter_entity_for_uuid_mut(
    encounter: &mut Encounter,
    uuid: Option<i64>,
    entity_type: EEntityType,
) -> Option<&mut Entity> {
    let uuid = uuid.filter(|uuid| *uuid != 0)?;
    Some(encounter.entity_by_uuid_or_insert_with(uuid, || Entity {
        entity_type,
        ..Default::default()
    }))
}

fn infer_scene_id_from_scene_uuid(scene_uuid: i64) -> Option<i32> {
    if scene_uuid <= 0 {
        return None;
    }

    let mut candidates = Vec::new();
    for candidate in [
        i32::try_from(scene_uuid).ok(),
        i32::try_from(scene_uuid >> 16).ok(),
        i32::try_from(scene_uuid & 0xffff).ok(),
    ]
    .into_iter()
    .flatten()
    {
        if candidate > 0
            && crate::live::scene_names::contains(candidate)
            && !candidates.contains(&candidate)
        {
            candidates.push(candidate);
        }
    }

    match candidates.as_slice() {
        [scene_id] => Some(*scene_id),
        _ => None,
    }
}

fn encounter_has_stats(encounter: &Encounter) -> bool {
    encounter.total_dmg > 0
        || encounter.total_heal > 0
        || encounter
            .entities()
            .any(|e| e.damage.hits > 0 || e.healing.hits > 0 || e.taken.hits > 0)
}

fn build_training_dummy_state(runtime: &TrainingDummyRuntime) -> TrainingDummyState {
    TrainingDummyState {
        phase: runtime.phase,
        duration_ms: runtime.duration_ms(),
        remaining_ms: runtime.remaining_ms(),
    }
}

fn is_known_other_player_source(state: &AppState, source_uuid: Option<i64>) -> bool {
    let local_player_uuid = current_local_player_uuid(&state.encounter);
    if source_uuid.is_some_and(|uuid| uuid != 0 && uuid == local_player_uuid) {
        return false;
    }

    if let Some(source_uuid) = source_uuid.filter(|uuid| *uuid > 0) {
        return state
            .encounter
            .entity_uuid_to_entity
            .get(&source_uuid)
            .map(|entity| entity.entity_type == EEntityType::EntChar)
            .unwrap_or(false);
    }

    false
}

fn known_other_player_sources(state: &AppState) -> (HashSet<i64>, HashSet<i64>) {
    let local_player_uuid = current_local_player_uuid(&state.encounter);
    let mut uids = HashSet::new();
    let mut uuids = HashSet::new();

    for (&uuid, entity) in &state.encounter.entity_uuid_to_entity {
        if uuid <= 0 || uuid == local_player_uuid {
            continue;
        }
        if entity.entity_type != EEntityType::EntChar {
            continue;
        }
        let uid = uid_from_uuid(uuid);
        if uid > 0 {
            uids.insert(uid);
        }
        uuids.insert(uuid);
    }

    for &uuid in &state.team.members {
        if uuid == 0 || uuid == local_player_uuid {
            continue;
        }
        uuids.insert(uuid);
        let uid = uid_from_uuid(uuid);
        if uid > 0 {
            uids.insert(uid);
        }
    }

    (uids, uuids)
}

fn remember_local_owned_source(state: &mut AppState, source_uuid: Option<i64>) -> bool {
    let local_player_uuid = current_local_player_uuid(&state.encounter);
    let source_is_local_uuid =
        source_uuid.is_some_and(|uuid| uuid != 0 && uuid == local_player_uuid);
    if source_uuid.is_none_or(|uuid| uuid <= 0) {
        return false;
    }
    if source_is_local_uuid {
        return false;
    }
    if is_known_other_player_source(state, source_uuid) {
        return false;
    }
    let mut inserted = false;
    if let Some(source_uuid) = source_uuid.filter(|uuid| *uuid > 0) {
        inserted |= state.local_owned_source_uuids.insert(source_uuid);
        let derived_uid = uid_from_uuid(source_uuid);
        if derived_uid > 0 {
            inserted |= state.local_owned_source_uids.insert(derived_uid);
        }
    }
    inserted
}

fn remember_local_owned_sources_from_buff_changes(
    state: &mut AppState,
    changes: &[BuffChangeEvent],
) {
    let local_player_uuid = current_local_player_uuid(&state.encounter);
    if local_player_uuid == 0 {
        return;
    }

    for change in changes {
        if !matches!(
            change.change_type,
            BuffChangeType::Added | BuffChangeType::Changed
        ) {
            continue;
        }
        let has_host_identity = change.host_uuid.is_some_and(|uuid| uuid != 0);
        let host_is_local = change.host_uuid == Some(local_player_uuid);
        if has_host_identity && !host_is_local {
            continue;
        }

        let source_is_proxy = remember_local_owned_source(state, change.source_uuid);
        if source_is_proxy {
            if let Some(source_config_id) = change.source_config_id.filter(|id| *id > 0) {
                state.local_owned_source_config_ids.insert(source_config_id);
            }
            if change.base_id > 0 {
                state.local_owned_source_config_ids.insert(change.base_id);
            }
        }
    }
}

fn remember_local_owned_sources_from_damage_events(
    state: &mut AppState,
    events: &[crate::live::opcodes_process::LocalDamageEvent],
) {
    let local_player_uuid = current_local_player_uuid(&state.encounter);
    if local_player_uuid == 0 {
        return;
    }

    for event in events {
        let is_local_source = local_player_uuid != 0
            && (event.attacker_uuid == Some(local_player_uuid)
                || event.top_summoner_uuid == Some(local_player_uuid));
        if !is_local_source {
            continue;
        }
        remember_local_owned_source(state, event.original_attacker_uuid);
    }
}

fn monster_buff_source_matches_local(
    source_uuid: Option<i64>,
    source_config_id: Option<i32>,
    local_player_uuid: i64,
    local_owned_source_uids: &HashSet<i64>,
    local_owned_source_uuids: &HashSet<i64>,
    local_owned_source_config_ids: &HashSet<i32>,
) -> bool {
    let source_display_uid = source_uuid
        .filter(|uuid| *uuid > 0)
        .map(uid_from_uuid)
        .unwrap_or(0);
    (local_player_uuid != 0 && source_uuid == Some(local_player_uuid))
        || source_uuid
            .filter(|uuid| *uuid > 0)
            .is_some_and(|uuid| local_owned_source_uuids.contains(&uuid))
        || (source_display_uid > 0 && local_owned_source_uids.contains(&source_display_uid))
        || (source_display_uid <= 0
            && source_config_id
                .filter(|id| *id > 0)
                .is_some_and(|id| local_owned_source_config_ids.contains(&id)))
}

fn monster_buff_source_allowed_for_self_monitor(
    source_uuid: Option<i64>,
    source_config_id: Option<i32>,
    local_player_uuid: i64,
    local_owned_source_uids: &HashSet<i64>,
    local_owned_source_uuids: &HashSet<i64>,
    local_owned_source_config_ids: &HashSet<i32>,
    known_other_source_uids: &HashSet<i64>,
    known_other_source_uuids: &HashSet<i64>,
) -> bool {
    if monster_buff_source_matches_local(
        source_uuid,
        source_config_id,
        local_player_uuid,
        local_owned_source_uids,
        local_owned_source_uuids,
        local_owned_source_config_ids,
    ) {
        return true;
    }

    let source_display_uid = source_uuid
        .filter(|uuid| *uuid > 0)
        .map(uid_from_uuid)
        .unwrap_or(0);
    if source_display_uid > 0 && known_other_source_uids.contains(&source_display_uid) {
        return false;
    }
    if source_uuid
        .filter(|uuid| *uuid > 0)
        .is_some_and(|uuid| known_other_source_uuids.contains(&uuid))
    {
        return false;
    }

    true
}

fn build_monster_buff_snapshots(state: &AppState) -> HashMap<i64, Vec<BuffUpdateState>> {
    let local_player_uuid = current_local_player_uuid(&state.encounter);
    let local_owned_source_uids = state.local_owned_source_uids.clone();
    let local_owned_source_uuids = state.local_owned_source_uuids.clone();
    let local_owned_source_config_ids = state.local_owned_source_config_ids.clone();
    let (known_other_source_uids, known_other_source_uuids) = known_other_player_sources(state);

    state.entity_buff_monitors.build_snapshots_for_kind(
        BuffTargetKind::Monster,
        &state.entity_buff_config,
        local_player_uuid,
        state.server_clock_offset,
        |entity_uuid| classify_buff_snapshot_target(state, entity_uuid),
        |_, buff| {
            monster_buff_source_allowed_for_self_monitor(
                buff.source_uuid,
                buff.source_config_id,
                local_player_uuid,
                &local_owned_source_uids,
                &local_owned_source_uuids,
                &local_owned_source_config_ids,
                &known_other_source_uids,
                &known_other_source_uuids,
            )
        },
    )
}

fn build_teammate_buff_snapshots(state: &AppState) -> HashMap<i64, Vec<BuffUpdateState>> {
    let local_player_uuid = current_local_player_uuid(&state.encounter);
    state.entity_buff_monitors.build_snapshots_for_kind(
        BuffTargetKind::Teammate,
        &state.entity_buff_config,
        local_player_uuid,
        state.server_clock_offset,
        |entity_uuid| {
            if entity_uuid == local_player_uuid {
                return None;
            }
            classify_buff_snapshot_target(state, entity_uuid)
        },
        |_, _| true,
    )
}

fn emit_training_dummy_update_if_changed(state: &mut AppState, previous: TrainingDummyState) {
    let current = build_training_dummy_state(&state.training_dummy);
    if current != previous && state.event_manager.should_emit_events() {
        state.event_manager.emit_training_dummy_update(current);
    }
}

fn finish_training_dummy_if_due(state: &mut AppState, source: &str) -> bool {
    if !state.training_dummy.is_active() {
        return false;
    }

    let previous = build_training_dummy_state(&state.training_dummy);
    if !state.training_dummy.maybe_finish() {
        return false;
    }

    persist_segment_unless_saved(state, false, "training_dummy_segment");
    state.training_dummy.segment_saved = true;
    if !state.encounter.is_encounter_paused {
        state.set_encounter_paused(true);
    }
    emit_training_dummy_update_if_changed(state, previous);
    info!(
        target: "app::live",
        "training_dummy_segment_finished source={}",
        source
    );
    true
}

fn emit_current_scene_change_boundary(state: &mut AppState, fallback_scene_name: &str) {
    if !state.event_manager.should_emit_events() {
        return;
    }

    let scene_name = state
        .encounter
        .current_scene_name
        .clone()
        .unwrap_or_else(|| fallback_scene_name.to_string());
    state.event_manager.emit_scene_change(
        state.encounter.current_scene_id,
        scene_name,
        state.encounter.current_dungeon_difficulty,
    );
}

fn clear_combat_runtime_silently(state: &mut AppState) {
    state.encounter.reset_combat_state();
    sync_selected_factor_items_to_local_entity(state);
    reset_season_cultivate_factor_counters(state);
    state.modifier_buff_monitor.active_buffs.clear();
    state.entity_buff_monitors.clear();
    state.local_owned_source_uids.clear();
    state.local_owned_source_uuids.clear();
    state.local_owned_source_config_ids.clear();
    state.local_factor_selector_zero_slots.clear();
    state.death_snapshot_dirty = false;
    state.battle_state = BattleStateMachine::default();
    state.pending_auto_reset = None;
}

fn hold_active_encounter_for_scene_change(state: &mut AppState, source: &str) -> bool {
    let has_combat_stats = encounter_has_stats(&state.encounter);
    let has_active_meter = has_combat_stats || state.training_dummy.is_active();
    if !has_active_meter {
        info!(
            target: "app::live",
            "scene_change_auto_clear_disabled_no_active_meter source={}",
            source
        );
        return false;
    }

    info!(
        target: "app::live",
        "scene_change_auto_clear_disabled_holding_encounter source={}",
        source
    );
    persist_segment_unless_saved(state, false, source);

    state.encounter.dps_display_paused = has_combat_stats;
    let live_payload = crate::live::event_manager::generate_live_data_payload(
        &state.encounter,
        &state.attr_store,
        build_training_dummy_state(&state.training_dummy),
    );
    state.event_manager.emit_live_data(live_payload);

    let previous = build_training_dummy_state(&state.training_dummy);
    state.training_dummy.clear();
    emit_training_dummy_update_if_changed(state, previous);
    clear_combat_runtime_silently(state);
    true
}

fn build_encounter_metadata(
    encounter: &Encounter,
    boss_names: Vec<String>,
    player_names: Vec<PlayerNameEntry>,
    is_manual: bool,
) -> EncounterMetadata {
    let elapsed_ms = encounter
        .time_last_combat_packet_ms
        .saturating_sub(encounter.time_fight_start_ms);
    let active_combat_time_ms = encounter.active_combat_time_ms.min(elapsed_ms);

    EncounterMetadata {
        started_at_ms: encounter.time_fight_start_ms as i64,
        ended_at_ms: Some(now_ms()),
        local_player_id: Some(encounter.local_player_uid),
        total_dmg: encounter.total_dmg.min(i64::MAX as u128) as i64,
        total_heal: encounter.total_heal.min(i64::MAX as u128) as i64,
        scene_id: encounter.current_scene_id,
        scene_name: encounter.current_scene_name.clone(),
        duration: (elapsed_ms as f64) / 1000.0,
        active_combat_duration: Some(active_combat_time_ms as f64 / 1000.0),
        is_manually_reset: is_manual,
        boss_names,
        player_names,
    }
}

fn collect_observed_active_buffs(
    active_buffs: &HashMap<i32, ActiveBuff>,
    local_player_uuid: i64,
) -> Vec<ObservedActiveBuff> {
    let mut observed = Vec::new();

    for (&buff_uuid, buff) in active_buffs {
        let host_uuid = buff
            .host_uuid
            .or_else(|| (local_player_uuid != 0).then_some(local_player_uuid));
        let host_uid = if buff.host_uid != 0 {
            buff.host_uid
        } else {
            host_uuid.map(uid_from_uuid).unwrap_or(0)
        };
        observed.push(ObservedActiveBuff {
            buff_uuid,
            base_id: buff.base_id,
            buff_level: buff.buff_level,
            part_id: buff.part_id,
            count: buff.count,
            fight_source_type: buff.fight_source_type,
            source_config_id: buff.source_config_id,
            layer: buff.layer,
            duration: buff.duration,
            create_time: buff.create_time,
            received_time_ms: buff.received_time_ms,
            host_uuid,
            source_uuid: buff.source_uuid,
            host_uid,
            source_uid: buff.source_uid,
        });
    }

    observed.sort_by_key(|buff| (buff.base_id, buff.buff_uuid));
    observed
}

fn collect_observed_factor_buffs(
    active_buffs: &HashMap<i32, ActiveBuff>,
    local_player_uuid: i64,
) -> Vec<ObservedFactorBuff> {
    let mut by_key = HashMap::<(i32, i32), ObservedFactorBuff>::new();

    for buff in active_buffs.values() {
        let source_factor_id = buff
            .source_config_id
            .filter(|id| crate::live::season_phantom_factors::is_factor_buff_id(*id));
        let factor_buff_id = if crate::live::season_phantom_factors::is_factor_buff_id(buff.base_id)
        {
            Some(buff.base_id)
        } else {
            source_factor_id
        };
        let Some(factor_buff_id) = factor_buff_id else {
            continue;
        };
        let host_uuid = buff
            .host_uuid
            .or_else(|| (local_player_uuid != 0).then_some(local_player_uuid));
        let host_uid = if buff.host_uid != 0 {
            buff.host_uid
        } else {
            host_uuid.map(uid_from_uuid).unwrap_or(0)
        };

        by_key.insert(
            (factor_buff_id, buff.base_id),
            ObservedFactorBuff {
                factor_buff_id,
                observed_buff_id: buff.base_id,
                buff_level: buff.buff_level,
                part_id: buff.part_id,
                count: buff.count,
                fight_source_type: buff.fight_source_type,
                source_config_id: buff.source_config_id,
                layer: buff.layer,
                duration: buff.duration,
                create_time: buff.create_time,
                received_time_ms: buff.received_time_ms,
                host_uuid,
                source_uuid: buff.source_uuid,
                host_uid,
                source_uid: buff.source_uid,
            },
        );
    }

    let mut observed: Vec<_> = by_key.into_values().collect();
    observed.sort_by_key(|buff| (buff.factor_buff_id, buff.observed_buff_id));
    observed
}

fn collect_observed_effect_buffs(
    active_buffs: &HashMap<i32, ActiveBuff>,
    local_player_uuid: i64,
) -> Vec<ObservedEffectBuff> {
    let mut by_key = HashMap::<(i32, i32), ObservedEffectBuff>::new();

    for buff in active_buffs.values() {
        let source_effect_id = buff
            .source_config_id
            .filter(|id| crate::live::effect_sources::is_effect_buff_id(*id));
        let effect_source_buff_id = if crate::live::effect_sources::is_effect_buff_id(buff.base_id)
        {
            Some(buff.base_id)
        } else {
            source_effect_id
        };
        let Some(effect_source_buff_id) = effect_source_buff_id else {
            continue;
        };
        let host_uuid = buff
            .host_uuid
            .or_else(|| (local_player_uuid != 0).then_some(local_player_uuid));
        let host_uid = if buff.host_uid != 0 {
            buff.host_uid
        } else {
            host_uuid.map(uid_from_uuid).unwrap_or(0)
        };

        by_key.insert(
            (effect_source_buff_id, buff.base_id),
            ObservedEffectBuff {
                effect_source_buff_id,
                observed_buff_id: buff.base_id,
                buff_level: buff.buff_level,
                part_id: buff.part_id,
                count: buff.count,
                fight_source_type: buff.fight_source_type,
                source_config_id: buff.source_config_id,
                layer: buff.layer,
                duration: buff.duration,
                create_time: buff.create_time,
                received_time_ms: buff.received_time_ms,
                host_uuid,
                source_uuid: buff.source_uuid,
                host_uid,
                source_uid: buff.source_uid,
            },
        );
    }

    let mut observed: Vec<_> = by_key.into_values().collect();
    observed.sort_by_key(|buff| (buff.effect_source_buff_id, buff.observed_buff_id));
    observed
}

fn source_entity_id_from_effect_source_id(source_id: &str) -> Option<i32> {
    source_id
        .rsplit_once(':')
        .and_then(|(_, value)| value.parse::<i32>().ok())
}

fn season_talent_node_id_from_effect_source_id(source_id: &str) -> Option<u32> {
    source_id
        .strip_prefix("season-talent-node:")
        .and_then(|value| value.parse::<u32>().ok())
}

fn season_talent_tree_band_from_source_id(source_id: &str) -> Option<u32> {
    let node_id = season_talent_node_id_from_effect_source_id(source_id)?;
    (node_id >= 1_000).then_some(node_id / 100)
}

fn active_season_talent_tree_bands_from_buffs(
    active_effect_buffs: &[ObservedEffectBuff],
) -> HashSet<u32> {
    let mut bands = HashSet::new();

    for buff in active_effect_buffs {
        let mut buff_ids = vec![buff.effect_source_buff_id, buff.observed_buff_id];
        if let Some(source_config_id) = buff.source_config_id {
            buff_ids.push(source_config_id);
        }
        for buff_id in buff_ids {
            let source_ids = crate::live::effect_sources::effect_source_ids_for_buff_id(buff_id);
            let source_bands = source_ids
                .iter()
                .filter_map(|source_id| season_talent_tree_band_from_source_id(source_id))
                .collect::<HashSet<_>>();
            if source_bands.len() == 1 {
                bands.extend(source_bands);
            }
        }
    }

    bands
}

fn effect_source_ids_for_buff_id_scoped(
    buff_id: i32,
    active_tree_bands: &HashSet<u32>,
) -> Vec<String> {
    let source_ids = crate::live::effect_sources::effect_source_ids_for_buff_id(buff_id);
    if source_ids.is_empty() || active_tree_bands.is_empty() {
        return source_ids;
    }

    let source_bands = source_ids
        .iter()
        .filter_map(|source_id| season_talent_tree_band_from_source_id(source_id))
        .collect::<HashSet<_>>();
    if source_bands.len() <= 1 {
        return source_ids;
    }

    let filtered = source_ids
        .iter()
        .filter(|source_id| {
            season_talent_tree_band_from_source_id(source_id)
                .is_none_or(|band| active_tree_bands.contains(&band))
        })
        .cloned()
        .collect::<Vec<_>>();
    if filtered
        .iter()
        .any(|source_id| season_talent_tree_band_from_source_id(source_id).is_some())
    {
        filtered
    } else {
        source_ids
    }
}

fn push_observed_effect_sources_for_buff_id(
    rows: &mut Vec<(i64, Option<i64>, ObservedEffectSource)>,
    seen: &mut HashSet<(i64, Option<i64>, String)>,
    host_uid: i64,
    host_uuid: Option<i64>,
    buff_id: i32,
    runtime_source: &'static str,
    active_tree_bands: &HashSet<u32>,
) {
    for source_id in effect_source_ids_for_buff_id_scoped(buff_id, active_tree_bands) {
        if !seen.insert((host_uid, host_uuid, source_id.clone())) {
            continue;
        }
        rows.push((
            host_uid,
            host_uuid,
            ObservedEffectSource {
                source_entity_id: source_entity_id_from_effect_source_id(&source_id),
                node_id: season_talent_node_id_from_effect_source_id(&source_id),
                source_id,
                runtime_source: runtime_source.to_string(),
                node_level: None,
                slot: None,
            },
        ));
    }
}

fn collect_observed_effect_sources_from_buffs(
    active_effect_buffs: &[ObservedEffectBuff],
    local_player_uuid: i64,
) -> Vec<(i64, Option<i64>, ObservedEffectSource)> {
    let mut rows = Vec::new();
    let mut seen = HashSet::<(i64, Option<i64>, String)>::new();
    let active_tree_bands = active_season_talent_tree_bands_from_buffs(active_effect_buffs);

    for buff in active_effect_buffs {
        let host_uuid = buff
            .host_uuid
            .or_else(|| (local_player_uuid != 0).then_some(local_player_uuid));
        let host_uid = if buff.host_uid > 0 {
            buff.host_uid
        } else {
            host_uuid.map(uid_from_uuid).unwrap_or(0)
        };
        if host_uid <= 0 {
            continue;
        }

        push_observed_effect_sources_for_buff_id(
            &mut rows,
            &mut seen,
            host_uid,
            host_uuid,
            buff.effect_source_buff_id,
            "activeEffectBuffs.effect_source_buff_id",
            &active_tree_bands,
        );
        push_observed_effect_sources_for_buff_id(
            &mut rows,
            &mut seen,
            host_uid,
            host_uuid,
            buff.observed_buff_id,
            "activeEffectBuffs.observed_buff_id",
            &active_tree_bands,
        );
        if let Some(source_config_id) = buff.source_config_id {
            push_observed_effect_sources_for_buff_id(
                &mut rows,
                &mut seen,
                host_uid,
                host_uuid,
                source_config_id,
                "activeEffectBuffs.source_config_id",
                &active_tree_bands,
            );
        }
    }

    rows.sort_by(
        |(left_uid, left_uuid, left), (right_uid, right_uuid, right)| {
            (*left_uid, *left_uuid, &left.source_id).cmp(&(
                *right_uid,
                *right_uuid,
                &right.source_id,
            ))
        },
    );
    rows
}

fn combined_modifier_active_buffs(state: &AppState) -> HashMap<i32, ActiveBuff> {
    let mut active_buffs = if state.modifier_capture_enabled {
        state.modifier_buff_monitor.active_buffs.clone()
    } else {
        HashMap::new()
    };
    for (&buff_uuid, buff) in &state.local_monitor.buff_monitor.active_buffs {
        active_buffs.insert(buff_uuid, buff.clone());
    }
    active_buffs
}

fn clear_modifier_capture_state(state: &mut AppState) {
    state.modifier_buff_monitor.active_buffs.clear();
    state.local_selected_factor_items.clear();
    state.selected_factor_selection_observed = false;
    state.selected_factor_cache_dirty = false;
    state.local_factor_selector_zero_slots.clear();
    state.suppressed_factor_item_ids.clear();
    state.suppressed_factor_selector_slot_keys.clear();
    for entity in state.encounter.entities_mut() {
        entity.active_factor_buffs.clear();
        entity.active_effect_buffs.clear();
        entity.active_effect_sources.clear();
        entity.active_factor_items.clear();
        entity.active_passive_skills.clear();
        entity.modifier_windows.clear();
        entity.modifier_hit_buckets.clear();
        entity.modifier_replay_hits.clear();
        entity.skill_cast_events.clear();
        entity.skill_cooldown_events.clear();
        entity.observed_damage_hits.clear();
    }
}

fn upsert_selected_factor_items(
    target: &mut Vec<ObservedFactorItem>,
    selected: &[ObservedFactorItem],
) {
    for item in selected {
        let incoming_slot_key = selected_factor_item_slot_key(item);
        target.retain(|existing| {
            if existing.factor_buff_id == item.factor_buff_id {
                return false;
            }
            if let (Some(incoming), Some(existing_key)) = (
                incoming_slot_key.as_ref(),
                selected_factor_item_slot_key(existing),
            ) {
                if existing_key == *incoming {
                    return false;
                }
            }
            if incoming_slot_key.is_some()
                && selected_factor_item_slot_key(existing).is_none()
                && observed_factor_item_is_packet_selected(existing)
            {
                return false;
            }
            true
        });
        target.push(item.clone());
    }
    target.sort_by_key(|item| {
        (
            item.factor_buff_id,
            item.grade.unwrap_or(0),
            item.item_config_id,
            item.item_uuid.unwrap_or(0),
        )
    });
}

fn unsuppress_selected_factor_items(state: &mut AppState, selected: &[ObservedFactorItem]) {
    for item in selected {
        if item.item_config_id > 0 {
            state
                .suppressed_factor_item_ids
                .remove(&item.item_config_id);
        }
        if let Some(slot_key) = selected_factor_item_slot_key(item) {
            state.suppressed_factor_selector_slot_keys.remove(&slot_key);
        }
    }
}

fn observed_factor_item_is_packet_selected(item: &ObservedFactorItem) -> bool {
    item.runtime_source
        .starts_with(SELECTED_FACTOR_RUNTIME_PREFIX)
}

fn observed_factor_item_is_equipped_snapshot(item: &ObservedFactorItem) -> bool {
    item.runtime_source
        .starts_with(EQUIPPED_FACTOR_RUNTIME_PREFIX)
}

fn selector_offset_as_i32(offset: usize) -> Option<i32> {
    i32::try_from(offset).ok()
}

fn selected_factor_slot_key(path: &str, tree_signature: &str, offset: Option<i32>) -> String {
    format!(
        "{}|{}|{}",
        tree_signature,
        path,
        offset
            .map(|value| value.to_string())
            .unwrap_or_else(|| "?".to_string())
    )
}

fn selected_factor_item_slot_key(item: &ObservedFactorItem) -> Option<String> {
    Some(selected_factor_slot_key(
        item.selector_path.as_ref()?,
        item.selector_signature.as_ref()?,
        item.selector_offset,
    ))
}

fn factor_selector_node_slot_key(node: &FactorSelectorDirtyNode) -> String {
    selected_factor_slot_key(
        &node.path,
        &node.tree_signature,
        selector_offset_as_i32(node.offset),
    )
}

fn remove_selected_factor_slot(
    target: &mut Vec<ObservedFactorItem>,
    node: &FactorSelectorDirtyNode,
) -> Vec<i32> {
    let slot_key = factor_selector_node_slot_key(node);
    let mut removed_factor_ids = HashSet::new();
    let mut removed_family_ids = HashSet::new();
    let mut removed_item_ids = HashSet::new();

    target.retain(|item| match selected_factor_item_slot_key(item) {
        Some(existing_key) if existing_key == slot_key => {
            if item.factor_buff_id > 0 {
                removed_factor_ids.insert(item.factor_buff_id);
            }
            if item.item_config_id > 0 {
                removed_item_ids.insert(item.item_config_id);
            }
            if let Some(family_id) = item.family_id.filter(|family_id| *family_id > 0) {
                removed_family_ids.insert(family_id);
            }
            false
        }
        _ => true,
    });

    if removed_factor_ids.is_empty() && removed_family_ids.is_empty() {
        return Vec::new();
    }

    target.retain(|item| {
        let same_factor = removed_factor_ids.contains(&item.factor_buff_id)
            || item
                .family_id
                .map(|family_id| removed_family_ids.contains(&family_id))
                .unwrap_or(false);
        if same_factor && item.item_config_id > 0 {
            removed_item_ids.insert(item.item_config_id);
        }
        !same_factor
    });
    let mut removed_item_ids: Vec<i32> = removed_item_ids.into_iter().collect();
    removed_item_ids.sort_unstable();
    removed_item_ids
}

fn prune_factor_selector_zero_slots(state: &mut AppState) {
    state
        .local_factor_selector_zero_slots
        .retain(|slot| slot.observed_at.elapsed() <= FACTOR_SELECTOR_ZERO_SLOT_TTL);
    if state.local_factor_selector_zero_slots.len() > MAX_FACTOR_SELECTOR_ZERO_SLOTS {
        let excess = state
            .local_factor_selector_zero_slots
            .len()
            .saturating_sub(MAX_FACTOR_SELECTOR_ZERO_SLOTS);
        state.local_factor_selector_zero_slots.drain(0..excess);
    }
}

fn remember_factor_selector_zero_slot(state: &mut AppState, node: &FactorSelectorDirtyNode) {
    prune_factor_selector_zero_slots(state);

    if let Some(slot) = state
        .local_factor_selector_zero_slots
        .iter_mut()
        .find(|slot| {
            slot.path == node.path
                && slot.tree_signature == node.tree_signature
                && slot.offset == node.offset
        })
    {
        slot.observed_at = Instant::now();
        return;
    }

    state
        .local_factor_selector_zero_slots
        .push(FactorSelectorZeroSlot {
            path: node.path.clone(),
            tree_signature: node.tree_signature.clone(),
            offset: node.offset,
            observed_at: Instant::now(),
        });
    prune_factor_selector_zero_slots(state);
}

fn take_factor_selector_zero_slot(state: &mut AppState, node: &FactorSelectorDirtyNode) -> bool {
    prune_factor_selector_zero_slots(state);
    let Some(index) = state
        .local_factor_selector_zero_slots
        .iter()
        .rposition(|slot| {
            slot.path == node.path
                && slot.tree_signature == node.tree_signature
                && slot.offset == node.offset
        })
    else {
        return false;
    };
    state.local_factor_selector_zero_slots.remove(index);
    true
}

fn selected_factor_item_from_transition_node(
    node: &FactorSelectorDirtyNode,
) -> Option<ObservedFactorItem> {
    Some(ObservedFactorItem {
        factor_buff_id: node.factor_buff_id?,
        item_config_id: node.item_config_id?,
        item_uuid: None,
        package_key: 0,
        package_type: None,
        grade: node.grade,
        family_id: node.family_id,
        runtime_source: SELECTED_FACTOR_TRANSITION_RUNTIME_SOURCE.to_string(),
        selector_path: Some(node.path.clone()),
        selector_signature: Some(node.tree_signature.clone()),
        selector_offset: selector_offset_as_i32(node.offset),
    })
}

fn selected_factor_items_from_dirty_transitions(
    state: &mut AppState,
    sync_container_dirty_data: &blueprotobuf::SyncContainerDirtyData,
) -> (Vec<ObservedFactorItem>, bool) {
    let nodes = crate::live::seasonal_factor_selector::factor_selector_dirty_nodes_from_dirty_data(
        sync_container_dirty_data,
    );
    if nodes.is_empty() {
        return (Vec::new(), false);
    }

    let mut selected = Vec::new();
    let mut seen_item_config_ids = HashSet::new();
    for node in nodes {
        if node.value == 0 {
            let slot_key = factor_selector_node_slot_key(&node);
            state
                .suppressed_factor_selector_slot_keys
                .insert(slot_key.clone());
            let removed_item_ids =
                remove_selected_factor_slot(&mut state.local_selected_factor_items, &node);
            if !removed_item_ids.is_empty() {
                for item_id in &removed_item_ids {
                    state.suppressed_factor_item_ids.insert(*item_id);
                }
                state.selected_factor_cache_dirty = true;
                log::debug!(
                    target: "app::live",
                    "suppressed removed factor item ids slot_key={} removed_item_ids={:?} suppressed_item_ids={:?}",
                    slot_key,
                    removed_item_ids,
                    state.suppressed_factor_item_ids,
                );
            } else {
                log::debug!(
                    target: "app::live",
                    "factor selector slot cleared without a known prior item id slot_key={} suppressed_slots={:?}",
                    slot_key,
                    state.suppressed_factor_selector_slot_keys,
                );
            }
            remember_factor_selector_zero_slot(state, &node);
            continue;
        }
        if node.item_config_id.is_none() || !take_factor_selector_zero_slot(state, &node) {
            continue;
        }
        let Some(item) = selected_factor_item_from_transition_node(&node) else {
            continue;
        };
        if !seen_item_config_ids.insert(item.item_config_id) {
            continue;
        }
        selected.push(item);
    }

    unsuppress_selected_factor_items(state, &selected);

    selected.sort_by_key(|item| {
        (
            item.factor_buff_id,
            item.grade.unwrap_or(0),
            item.item_config_id,
        )
    });
    (selected, true)
}

fn sync_selected_factor_items_to_local_entity(state: &mut AppState) {
    let local_player_uuid = current_local_player_uuid(&state.encounter);
    let Some(entity) = encounter_entity_for_uuid_mut(
        &mut state.encounter,
        Some(local_player_uuid).filter(|uuid| *uuid != 0),
        EEntityType::EntChar,
    ) else {
        return;
    };
    if state.local_selected_factor_items.is_empty() {
        entity
            .active_factor_items
            .retain(|item| !observed_factor_item_is_packet_selected(item));
        return;
    }
    upsert_selected_factor_items(
        &mut entity.active_factor_items,
        &state.local_selected_factor_items,
    );
}

fn sync_active_buffs_to_encounter(state: &mut AppState) {
    let local_player_uuid = current_local_player_uuid(&state.encounter);
    if local_player_uuid == 0 {
        return;
    }
    let active_buff_map = combined_modifier_active_buffs(state);

    let active_buffs = collect_observed_active_buffs(&active_buff_map, local_player_uuid);
    let active_factor_buffs = if state.modifier_capture_enabled {
        collect_observed_factor_buffs(&active_buff_map, local_player_uuid)
    } else {
        Vec::new()
    };
    let active_effect_buffs = if state.modifier_capture_enabled {
        collect_observed_effect_buffs(&active_buff_map, local_player_uuid)
    } else {
        Vec::new()
    };
    let active_effect_sources_from_buffs = if state.modifier_capture_enabled {
        collect_observed_effect_sources_from_buffs(&active_effect_buffs, local_player_uuid)
    } else {
        Vec::new()
    };

    for entity in state.encounter.entities_mut() {
        entity.active_buffs.clear();
        entity.active_factor_buffs.clear();
        entity.active_effect_buffs.clear();
        entity.active_effect_sources.retain(|source| {
            !source
                .runtime_source
                .starts_with(ACTIVE_EFFECT_BUFF_SOURCE_RUNTIME_PREFIX)
        });
    }

    for buff in active_buffs {
        let host_uuid = buff
            .host_uuid
            .or_else(|| (local_player_uuid != 0).then_some(local_player_uuid));
        let Some(entity) =
            encounter_entity_for_uuid_mut(&mut state.encounter, host_uuid, EEntityType::EntChar)
        else {
            continue;
        };
        entity.active_buffs.push(buff);
    }

    for buff in active_factor_buffs {
        let host_uuid = buff
            .host_uuid
            .or_else(|| (local_player_uuid != 0).then_some(local_player_uuid));
        let Some(entity) =
            encounter_entity_for_uuid_mut(&mut state.encounter, host_uuid, EEntityType::EntChar)
        else {
            continue;
        };
        entity.active_factor_buffs.push(buff);
    }

    for buff in active_effect_buffs {
        let host_uuid = buff
            .host_uuid
            .or_else(|| (local_player_uuid != 0).then_some(local_player_uuid));
        let Some(entity) =
            encounter_entity_for_uuid_mut(&mut state.encounter, host_uuid, EEntityType::EntChar)
        else {
            continue;
        };
        entity.active_effect_buffs.push(buff);
    }

    for (_, host_uuid, source) in active_effect_sources_from_buffs {
        let Some(entity) =
            encounter_entity_for_uuid_mut(&mut state.encounter, host_uuid, EEntityType::EntChar)
        else {
            continue;
        };
        if !entity
            .active_effect_sources
            .iter()
            .any(|existing| existing.source_id == source.source_id)
        {
            entity.active_effect_sources.push(source);
        }
        entity
            .active_effect_sources
            .sort_by(|left, right| left.source_id.cmp(&right.source_id));
    }

    sync_selected_factor_items_to_local_entity(state);
}

fn modifier_window_host(
    change: &BuffChangeEvent,
    fallback_host_uuid: Option<i64>,
) -> Option<(i64, i64)> {
    let host_uuid = change
        .host_uuid
        .or(fallback_host_uuid)
        .filter(|uuid| *uuid != 0)?;
    let host_uid = if change.host_uid > 0 {
        change.host_uid
    } else {
        uid_from_uuid(host_uuid)
    };
    Some((host_uid, host_uuid))
}

fn modifier_window_from_change(
    change: &BuffChangeEvent,
    start_time_ms: i64,
) -> ObservedModifierWindow {
    ObservedModifierWindow {
        buff_uuid: change.buff_uuid,
        base_id: change.base_id,
        buff_level: change.buff_level,
        part_id: change.part_id,
        count: change.count,
        fight_source_type: change.fight_source_type,
        source_config_id: change.source_config_id,
        layer: change.layer,
        duration: change.duration_ms.unwrap_or(0),
        start_time_ms,
        end_time_ms: None,
        host_uuid: change.host_uuid,
        source_uuid: change.source_uuid,
        host_uid: change.host_uid,
        source_uid: change.source_uid,
    }
}

fn close_open_modifier_window(
    entity: &mut Entity,
    buff_uuid: i32,
    host_uuid: i64,
    host_uid: i64,
    end_time_ms: i64,
) -> bool {
    if let Some(window) = entity.modifier_windows.iter_mut().rev().find(|window| {
        window.buff_uuid == buff_uuid
            && window.end_time_ms.is_none()
            && (window.host_uuid == Some(host_uuid)
                || (window.host_uuid.is_none() && window.host_uid == host_uid))
    }) {
        window.end_time_ms = Some(end_time_ms.max(window.start_time_ms));
        return true;
    }
    false
}

fn apply_modifier_buff_changes(
    state: &mut AppState,
    changes: &[BuffChangeEvent],
    fallback_host_uuid: Option<i64>,
) {
    if !state.modifier_capture_enabled {
        return;
    }
    let local_player_uuid = current_local_player_uuid(&state.encounter);
    let fallback_host_uuid =
        fallback_host_uuid.or_else(|| (local_player_uuid != 0).then_some(local_player_uuid));
    if fallback_host_uuid.is_none() || changes.is_empty() {
        return;
    }

    for change in changes {
        let Some((host_uid, host_uuid)) = modifier_window_host(change, fallback_host_uuid) else {
            continue;
        };
        if let Some(active_buff) = state
            .modifier_buff_monitor
            .active_buffs
            .get_mut(&change.buff_uuid)
        {
            if active_buff.host_uid <= 0 {
                active_buff.host_uid = host_uid;
            }
            if active_buff.host_uuid.is_none() {
                active_buff.host_uuid = Some(host_uuid);
            }
        }
        let Some(entity) = encounter_entity_for_uuid_mut(
            &mut state.encounter,
            Some(host_uuid),
            EEntityType::EntChar,
        ) else {
            continue;
        };
        match change.change_type {
            BuffChangeType::Added => {
                close_open_modifier_window(
                    entity,
                    change.buff_uuid,
                    host_uuid,
                    host_uid,
                    change.event_time_ms,
                );
                let mut window = modifier_window_from_change(
                    change,
                    change.create_time_ms.unwrap_or(change.event_time_ms),
                );
                window.host_uid = host_uid;
                window.host_uuid = Some(host_uuid);
                entity.modifier_windows.push(window);
            }
            BuffChangeType::Changed => {
                if let Some(window) = entity.modifier_windows.iter_mut().rev().find(|window| {
                    window.buff_uuid == change.buff_uuid
                        && window.end_time_ms.is_none()
                        && (window.host_uuid == Some(host_uuid)
                            || (window.host_uuid.is_none() && window.host_uid == host_uid))
                }) {
                    window.layer = change.layer;
                    window.duration = change.duration_ms.unwrap_or(window.duration);
                    window.buff_level = change.buff_level;
                    window.part_id = change.part_id;
                    window.count = change.count;
                    window.fight_source_type = change.fight_source_type;
                    window.source_config_id = change.source_config_id;
                    window.host_uuid = Some(host_uuid);
                    window.source_uuid = change.source_uuid;
                    window.source_uid = change.source_uid;
                }
            }
            BuffChangeType::Removed => {
                if !close_open_modifier_window(
                    entity,
                    change.buff_uuid,
                    host_uuid,
                    host_uid,
                    change.event_time_ms,
                ) {
                    let duration_ms = i64::from(change.duration_ms.unwrap_or(0).max(0));
                    let mut window = modifier_window_from_change(
                        change,
                        change.event_time_ms.saturating_sub(duration_ms),
                    );
                    window.host_uid = host_uid;
                    window.host_uuid = Some(host_uuid);
                    window.end_time_ms = Some(change.event_time_ms);
                    entity.modifier_windows.push(window);
                }
            }
        }
    }
}

fn temp_attr_modifier_buff_uuid(temp_attr_id: i32) -> i32 {
    -temp_attr_id.abs()
}

fn apply_temp_attr_modifier_changes(
    state: &mut AppState,
    changes: &[crate::live::opcodes_process::TempAttrModifierChange],
) {
    if !state.modifier_capture_enabled {
        return;
    }
    let host_uuid = current_local_player_uuid(&state.encounter);
    if host_uuid == 0 || changes.is_empty() {
        return;
    }
    let host_uid = uid_from_uuid(host_uuid);

    let Some(entity) =
        encounter_entity_for_uuid_mut(&mut state.encounter, Some(host_uuid), EEntityType::EntChar)
    else {
        return;
    };
    if !matches!(entity.entity_type, EEntityType::EntChar) {
        return;
    }

    for change in changes {
        let buff_uuid = temp_attr_modifier_buff_uuid(change.temp_attr_id);
        if change.value > 0 && change.previous_value <= 0 {
            close_open_modifier_window(
                entity,
                buff_uuid,
                host_uuid,
                host_uid,
                change.event_time_ms,
            );
            entity.modifier_windows.push(ObservedModifierWindow {
                buff_uuid,
                base_id: change.buff_id,
                buff_level: None,
                part_id: Some(change.temp_attr_id),
                count: Some(change.value),
                fight_source_type: None,
                source_config_id: None,
                layer: 1,
                duration: 0,
                start_time_ms: change.event_time_ms,
                end_time_ms: None,
                host_uuid: Some(host_uuid),
                source_uuid: Some(host_uuid),
                host_uid,
                source_uid: host_uid,
            });
        } else if change.value > 0 {
            if let Some(window) = entity.modifier_windows.iter_mut().rev().find(|window| {
                window.buff_uuid == buff_uuid
                    && window.end_time_ms.is_none()
                    && (window.host_uuid == Some(host_uuid)
                        || (window.host_uuid.is_none() && window.host_uid == host_uid))
            }) {
                window.count = Some(change.value);
                window.part_id = Some(change.temp_attr_id);
            }
        } else if change.previous_value > 0 {
            close_open_modifier_window(
                entity,
                buff_uuid,
                host_uuid,
                host_uid,
                change.event_time_ms,
            );
        }
    }
}

fn active_modifier_start_ms(
    buff: &ActiveBuff,
    encounter_start_ms: i64,
    encounter_end_ms: i64,
    server_clock_offset: i64,
) -> i64 {
    let adjusted_create_time = buff.create_time.saturating_add(server_clock_offset);
    let duration_start = if buff.duration > 0 {
        encounter_end_ms.saturating_sub(i64::from(buff.duration))
    } else {
        encounter_start_ms
    };
    let start = if adjusted_create_time > 0 {
        adjusted_create_time
    } else {
        duration_start
    };
    start.clamp(encounter_start_ms, encounter_end_ms)
}

fn seed_open_modifier_windows_from_active_buffs(
    state: &mut AppState,
    encounter_start_ms: i64,
    encounter_end_ms: i64,
) {
    if !state.modifier_capture_enabled {
        return;
    }
    let local_player_uuid = current_local_player_uuid(&state.encounter);
    if local_player_uuid == 0 {
        return;
    }
    let active_buffs = combined_modifier_active_buffs(state);
    for (&buff_uuid, buff) in &active_buffs {
        let host_uuid = buff
            .host_uuid
            .or_else(|| (local_player_uuid != 0).then_some(local_player_uuid));
        let Some(host_uuid) = host_uuid else {
            continue;
        };
        let host_uid = if buff.host_uid > 0 {
            buff.host_uid
        } else {
            uid_from_uuid(host_uuid)
        };
        let Some(entity) = encounter_entity_for_uuid_mut(
            &mut state.encounter,
            Some(host_uuid),
            EEntityType::EntChar,
        ) else {
            continue;
        };
        let has_open_window = entity.modifier_windows.iter().any(|window| {
            window.buff_uuid == buff_uuid
                && window.end_time_ms.is_none()
                && (window.host_uuid == Some(host_uuid)
                    || (window.host_uuid.is_none() && window.host_uid == host_uid))
        });
        if has_open_window {
            continue;
        }

        entity.modifier_windows.push(ObservedModifierWindow {
            buff_uuid,
            base_id: buff.base_id,
            buff_level: buff.buff_level,
            part_id: buff.part_id,
            count: buff.count,
            fight_source_type: buff.fight_source_type,
            source_config_id: buff.source_config_id,
            layer: buff.layer,
            duration: buff.duration,
            start_time_ms: active_modifier_start_ms(
                buff,
                encounter_start_ms,
                encounter_end_ms,
                state.server_clock_offset,
            ),
            end_time_ms: None,
            host_uuid: Some(host_uuid),
            source_uuid: buff.source_uuid,
            host_uid,
            source_uid: buff.source_uid,
        });
    }
}

fn finalize_modifier_windows_for_save(state: &mut AppState, encounter_end_ms: i64) {
    if !state.modifier_capture_enabled {
        for entity in state.encounter.entities_mut() {
            entity.modifier_windows.clear();
        }
        return;
    }
    let encounter_start_ms = if state.encounter.time_fight_start_ms > 0 {
        state.encounter.time_fight_start_ms as i64
    } else {
        encounter_end_ms
    };
    seed_open_modifier_windows_from_active_buffs(state, encounter_start_ms, encounter_end_ms);
    for entity in state.encounter.entities_mut() {
        for window in &mut entity.modifier_windows {
            if window.end_time_ms.is_none() {
                window.end_time_ms = Some(encounter_end_ms.max(window.start_time_ms));
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ModifierHitBucketKey {
    modifier_buff_uuid: i32,
    modifier_base_id: i32,
    modifier_buff_level: Option<i32>,
    modifier_part_id: Option<i32>,
    modifier_fight_source_type: Option<i32>,
    modifier_source_config_id: Option<i32>,
    modifier_host_uuid: Option<i64>,
    modifier_source_uuid: Option<i64>,
    modifier_host_uid: i64,
    modifier_source_uid: i64,
    skill_key: i64,
    damage_id: i64,
    owner_id: i32,
    owner_level: Option<i32>,
    hit_event_id: Option<i32>,
    damage_source: Option<i32>,
    property: Option<i32>,
    damage_mode: Option<i32>,
    attacker_uuid: Option<i64>,
    original_attacker_uuid: Option<i64>,
    top_summoner_uuid: Option<i64>,
    target_uuid: Option<i64>,
    attacker_uid: i64,
    original_attacker_uid: i64,
    top_summoner_uid: Option<i64>,
    target_uid: i64,
    target_monster_type_id: Option<i32>,
    is_heal: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ModifierHitSeenKey {
    modifier_base_id: i32,
    modifier_source_config_id: Option<i32>,
    skill_key: i64,
    damage_id: i64,
    owner_id: i32,
    owner_level: Option<i32>,
    hit_event_id: Option<i32>,
    damage_source: Option<i32>,
    property: Option<i32>,
    damage_mode: Option<i32>,
    attacker_uuid: Option<i64>,
    original_attacker_uuid: Option<i64>,
    top_summoner_uuid: Option<i64>,
    target_uuid: Option<i64>,
    attacker_uid: i64,
    original_attacker_uid: i64,
    top_summoner_uid: Option<i64>,
    target_uid: i64,
    target_monster_type_id: Option<i32>,
    is_heal: bool,
}

fn modifier_window_covers_hit(window: &ObservedModifierWindow, hit: &ObservedDamageHit) -> bool {
    if window.base_id <= 0 {
        return false;
    }
    let start = window.start_time_ms;
    let end = window.end_time_ms.unwrap_or(hit.timestamp_ms).max(start);
    hit.timestamp_ms >= start && hit.timestamp_ms <= end
}

fn modifier_hit_seen_key(
    window: &ObservedModifierWindow,
    hit: &ObservedDamageHit,
) -> ModifierHitSeenKey {
    ModifierHitSeenKey {
        modifier_base_id: window.base_id,
        modifier_source_config_id: window.source_config_id,
        skill_key: hit.skill_key,
        damage_id: hit.damage_id,
        owner_id: hit.owner_id,
        owner_level: hit.owner_level,
        hit_event_id: hit.hit_event_id,
        damage_source: hit.damage_source,
        property: hit.property,
        damage_mode: hit.damage_mode,
        attacker_uuid: hit.attacker_uuid,
        original_attacker_uuid: hit.original_attacker_uuid,
        top_summoner_uuid: hit.top_summoner_uuid,
        target_uuid: hit.target_uuid,
        attacker_uid: hit.attacker_uid,
        original_attacker_uid: hit.original_attacker_uid,
        top_summoner_uid: hit.top_summoner_uid,
        target_uid: hit.target_uid,
        target_monster_type_id: hit.target_monster_type_id,
        is_heal: hit.is_heal,
    }
}

fn modifier_hit_bucket_key(
    window: &ObservedModifierWindow,
    hit: &ObservedDamageHit,
) -> ModifierHitBucketKey {
    ModifierHitBucketKey {
        modifier_buff_uuid: window.buff_uuid,
        modifier_base_id: window.base_id,
        modifier_buff_level: window.buff_level,
        modifier_part_id: window.part_id,
        modifier_fight_source_type: window.fight_source_type,
        modifier_source_config_id: window.source_config_id,
        modifier_host_uuid: window.host_uuid,
        modifier_source_uuid: window.source_uuid,
        modifier_host_uid: window.host_uid,
        modifier_source_uid: window.source_uid,
        skill_key: hit.skill_key,
        damage_id: hit.damage_id,
        owner_id: hit.owner_id,
        owner_level: hit.owner_level,
        hit_event_id: hit.hit_event_id,
        damage_source: hit.damage_source,
        property: hit.property,
        damage_mode: hit.damage_mode,
        attacker_uuid: hit.attacker_uuid,
        original_attacker_uuid: hit.original_attacker_uuid,
        top_summoner_uuid: hit.top_summoner_uuid,
        target_uuid: hit.target_uuid,
        attacker_uid: hit.attacker_uid,
        original_attacker_uid: hit.original_attacker_uid,
        top_summoner_uid: hit.top_summoner_uid,
        target_uid: hit.target_uid,
        target_monster_type_id: hit.target_monster_type_id,
        is_heal: hit.is_heal,
    }
}

fn empty_modifier_hit_bucket(
    window: &ObservedModifierWindow,
    hit: &ObservedDamageHit,
) -> ObservedModifierHitBucket {
    ObservedModifierHitBucket {
        modifier_buff_uuid: window.buff_uuid,
        modifier_base_id: window.base_id,
        modifier_buff_level: window.buff_level,
        modifier_part_id: window.part_id,
        modifier_count: window.count,
        modifier_fight_source_type: window.fight_source_type,
        modifier_source_config_id: window.source_config_id,
        modifier_layer: window.layer,
        modifier_duration: window.duration,
        modifier_start_time_ms: window.start_time_ms,
        modifier_end_time_ms: window.end_time_ms,
        modifier_host_uuid: window.host_uuid,
        modifier_source_uuid: window.source_uuid,
        modifier_host_uid: window.host_uid,
        modifier_source_uid: window.source_uid,
        skill_key: hit.skill_key,
        damage_id: hit.damage_id,
        owner_id: hit.owner_id,
        owner_level: hit.owner_level,
        hit_event_id: hit.hit_event_id,
        damage_source: hit.damage_source,
        property: hit.property,
        damage_mode: hit.damage_mode,
        attacker_uuid: hit.attacker_uuid,
        original_attacker_uuid: hit.original_attacker_uuid,
        top_summoner_uuid: hit.top_summoner_uuid,
        target_uuid: hit.target_uuid,
        attacker_uid: hit.attacker_uid,
        original_attacker_uid: hit.original_attacker_uid,
        top_summoner_uid: hit.top_summoner_uid,
        target_uid: hit.target_uid,
        target_monster_type_id: hit.target_monster_type_id,
        is_heal: hit.is_heal,
        hits: 0,
        total_value: 0,
        effective_total_value: 0,
        crit_hits: 0,
        crit_total_value: 0,
        lucky_hits: 0,
        lucky_total_value: 0,
        hp_loss_total: 0,
        shield_loss_total: 0,
        first_hit_time_ms: hit.timestamp_ms,
        last_hit_time_ms: hit.timestamp_ms,
    }
}

fn add_hit_to_modifier_bucket(bucket: &mut ObservedModifierHitBucket, hit: &ObservedDamageHit) {
    bucket.hits += 1;
    bucket.total_value += hit.value;
    bucket.effective_total_value += hit.effective_value;
    if hit.is_crit {
        bucket.crit_hits += 1;
        bucket.crit_total_value += hit.value;
    }
    if hit.is_lucky {
        bucket.lucky_hits += 1;
        bucket.lucky_total_value += hit.value;
    }
    bucket.hp_loss_total += hit.hp_loss_value;
    bucket.shield_loss_total += hit.shield_loss_value;
    bucket.first_hit_time_ms = bucket.first_hit_time_ms.min(hit.timestamp_ms);
    bucket.last_hit_time_ms = bucket.last_hit_time_ms.max(hit.timestamp_ms);
}

fn modifier_host_identity(uid: i64, uuid: Option<i64>) -> CombatTimelineIdentityKey {
    CombatTimelineIdentityKey {
        uid,
        uuid: uuid.filter(|uuid| *uuid != 0),
    }
}

fn modifier_hit_host_identities(
    entity_uid: i64,
    entity_uuid: Option<i64>,
    hit: &ObservedDamageHit,
) -> Vec<CombatTimelineIdentityKey> {
    let mut identities = vec![modifier_host_identity(entity_uid, entity_uuid)];
    let target_identity = modifier_host_identity(hit.target_uid, hit.target_uuid);
    if (target_identity.uid > 0 || target_identity.uuid.is_some())
        && !identities.contains(&target_identity)
    {
        identities.push(target_identity);
    }
    identities
}

fn modifier_windows_for_host<'a>(
    windows_by_host_identity: &'a HashMap<CombatTimelineIdentityKey, Vec<ObservedModifierWindow>>,
    windows_by_host_uid: &'a HashMap<i64, Vec<ObservedModifierWindow>>,
    identity: CombatTimelineIdentityKey,
) -> Vec<&'a ObservedModifierWindow> {
    if let Some(windows) = windows_by_host_identity.get(&identity) {
        return windows.iter().collect();
    }
    if identity.uid > 0 {
        return windows_by_host_uid
            .get(&identity.uid)
            .map(|windows| windows.iter().collect())
            .unwrap_or_default();
    }
    Vec::new()
}

fn build_modifier_hit_buckets(
    entity_uid: i64,
    entity_uuid: Option<i64>,
    hits: &[ObservedDamageHit],
    windows_by_host_identity: &HashMap<CombatTimelineIdentityKey, Vec<ObservedModifierWindow>>,
    windows_by_host_uid: &HashMap<i64, Vec<ObservedModifierWindow>>,
) -> Vec<ObservedModifierHitBucket> {
    let mut buckets = HashMap::<ModifierHitBucketKey, ObservedModifierHitBucket>::new();
    for hit in hits {
        let mut seen_keys_for_hit = HashSet::<ModifierHitSeenKey>::new();
        for host_identity in modifier_hit_host_identities(entity_uid, entity_uuid, hit) {
            for window in modifier_windows_for_host(
                windows_by_host_identity,
                windows_by_host_uid,
                host_identity,
            ) {
                if !modifier_window_covers_hit(window, hit) {
                    continue;
                }
                let seen_key = modifier_hit_seen_key(window, hit);
                if !seen_keys_for_hit.insert(seen_key) {
                    continue;
                }
                let key = modifier_hit_bucket_key(window, hit);
                let bucket = buckets
                    .entry(key)
                    .or_insert_with(|| empty_modifier_hit_bucket(window, hit));
                add_hit_to_modifier_bucket(bucket, hit);
            }
        }
    }

    let mut rows: Vec<ObservedModifierHitBucket> = buckets.into_values().collect();
    rows.sort_by(|left, right| {
        right
            .total_value
            .cmp(&left.total_value)
            .then_with(|| right.hits.cmp(&left.hits))
            .then_with(|| left.modifier_base_id.cmp(&right.modifier_base_id))
            .then_with(|| left.skill_key.cmp(&right.skill_key))
    });
    rows
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ModifierReplaySourceKey {
    modifier_base_id: i32,
    modifier_source_config_id: Option<i32>,
    modifier_host_uuid: Option<i64>,
    modifier_source_uuid: Option<i64>,
    modifier_host_uid: i64,
    modifier_source_uid: i64,
}

fn replay_source_key(window: &ObservedModifierWindow) -> ModifierReplaySourceKey {
    ModifierReplaySourceKey {
        modifier_base_id: window.base_id,
        modifier_source_config_id: window.source_config_id,
        modifier_host_uuid: window.host_uuid,
        modifier_source_uuid: window.source_uuid,
        modifier_host_uid: window.host_uid,
        modifier_source_uid: window.source_uid,
    }
}

fn modifier_replay_source(window: &ObservedModifierWindow) -> ObservedModifierReplaySource {
    ObservedModifierReplaySource {
        modifier_base_id: window.base_id,
        modifier_source_config_id: window.source_config_id,
        modifier_buff_level: window.buff_level,
        modifier_count: window.count,
        modifier_layer: window.layer,
        modifier_host_uuid: window.host_uuid,
        modifier_source_uuid: window.source_uuid,
        modifier_host_uid: window.host_uid,
        modifier_source_uid: window.source_uid,
    }
}

fn build_modifier_replay_hits(
    entity_uid: i64,
    entity_uuid: Option<i64>,
    hits: &[ObservedDamageHit],
    windows_by_host_identity: &HashMap<CombatTimelineIdentityKey, Vec<ObservedModifierWindow>>,
    windows_by_host_uid: &HashMap<i64, Vec<ObservedModifierWindow>>,
) -> Vec<ObservedModifierReplayHit> {
    let mut rows = Vec::new();
    for hit in hits {
        let mut seen_sources = HashSet::<ModifierReplaySourceKey>::new();
        let mut active_modifiers = Vec::new();
        for host_identity in modifier_hit_host_identities(entity_uid, entity_uuid, hit) {
            for window in modifier_windows_for_host(
                windows_by_host_identity,
                windows_by_host_uid,
                host_identity,
            ) {
                if !modifier_window_covers_hit(window, hit) {
                    continue;
                }
                if !crate::live::modifier_recount::is_reportable_modifier_bucket(
                    window.base_id,
                    window.source_config_id,
                ) {
                    continue;
                }
                let key = replay_source_key(window);
                if !seen_sources.insert(key) {
                    continue;
                }
                active_modifiers.push(modifier_replay_source(window));
            }
        }
        if active_modifiers.is_empty() {
            continue;
        }
        active_modifiers.sort_by(|left, right| {
            left.modifier_base_id
                .cmp(&right.modifier_base_id)
                .then_with(|| {
                    left.modifier_source_config_id
                        .cmp(&right.modifier_source_config_id)
                })
                .then_with(|| left.modifier_source_uid.cmp(&right.modifier_source_uid))
                .then_with(|| left.modifier_host_uid.cmp(&right.modifier_host_uid))
        });
        rows.push(ObservedModifierReplayHit {
            timestamp_ms: hit.timestamp_ms,
            skill_key: hit.skill_key,
            damage_id: hit.damage_id,
            owner_id: hit.owner_id,
            owner_level: hit.owner_level,
            hit_event_id: hit.hit_event_id,
            damage_source: hit.damage_source,
            property: hit.property,
            damage_mode: hit.damage_mode,
            attacker_uuid: hit.attacker_uuid,
            original_attacker_uuid: hit.original_attacker_uuid,
            top_summoner_uuid: hit.top_summoner_uuid,
            target_uuid: hit.target_uuid,
            attacker_uid: hit.attacker_uid,
            original_attacker_uid: hit.original_attacker_uid,
            top_summoner_uid: hit.top_summoner_uid,
            target_uid: hit.target_uid,
            target_monster_type_id: hit.target_monster_type_id,
            is_heal: hit.is_heal,
            is_crit: hit.is_crit,
            is_lucky: hit.is_lucky,
            value: hit.value,
            effective_value: hit.effective_value,
            hp_loss_value: hit.hp_loss_value,
            shield_loss_value: hit.shield_loss_value,
            active_modifiers,
            attacker_attrs: hit.attacker_attrs.clone(),
            target_attrs: hit.target_attrs.clone(),
        });
    }

    rows.sort_by(|left, right| {
        left.timestamp_ms
            .cmp(&right.timestamp_ms)
            .then_with(|| left.damage_id.cmp(&right.damage_id))
            .then_with(|| left.target_uid.cmp(&right.target_uid))
    });
    rows
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct CombatTimelineIdentityKey {
    uid: i64,
    uuid: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct CombatTimelineBucketKey {
    timestamp_ms: i64,
    target_uid: i64,
    target_uuid: Option<i64>,
    target_monster_type_id: Option<i32>,
}

fn combat_timeline_bucket_timestamp(timestamp_ms: i64) -> i64 {
    if timestamp_ms <= 0 {
        return 0;
    }
    (timestamp_ms / COMBAT_TIMELINE_BUCKET_MS) * COMBAT_TIMELINE_BUCKET_MS
}

fn combat_timeline_bucket_key(hit: &ObservedDamageHit) -> CombatTimelineBucketKey {
    CombatTimelineBucketKey {
        timestamp_ms: combat_timeline_bucket_timestamp(hit.timestamp_ms),
        target_uid: hit.target_uid,
        target_uuid: hit.target_uuid,
        target_monster_type_id: hit.target_monster_type_id,
    }
}

fn empty_combat_timeline_bucket(key: CombatTimelineBucketKey) -> ObservedCombatTimelineBucket {
    ObservedCombatTimelineBucket {
        timestamp_ms: key.timestamp_ms,
        target_uid: key.target_uid,
        target_uuid: key.target_uuid,
        target_monster_type_id: key.target_monster_type_id,
        ..Default::default()
    }
}

fn combat_timeline_entry<'a>(
    timeline_by_entity: &'a mut HashMap<
        CombatTimelineIdentityKey,
        HashMap<CombatTimelineBucketKey, ObservedCombatTimelineBucket>,
    >,
    identity: CombatTimelineIdentityKey,
    key: CombatTimelineBucketKey,
) -> &'a mut ObservedCombatTimelineBucket {
    timeline_by_entity
        .entry(identity)
        .or_default()
        .entry(key)
        .or_insert_with(|| empty_combat_timeline_bucket(key))
}

fn finalize_combat_timeline_for_save(state: &mut AppState) {
    let mut timeline_by_entity = HashMap::<
        CombatTimelineIdentityKey,
        HashMap<CombatTimelineBucketKey, ObservedCombatTimelineBucket>,
    >::new();

    for (&entity_uuid, entity) in &state.encounter.entity_uuid_to_entity {
        if entity_uuid <= 0 {
            continue;
        }
        if entity.combat_timeline_hits.is_empty() {
            continue;
        }
        let entity_uid = uid_from_uuid(entity_uuid);
        let source_identity = CombatTimelineIdentityKey {
            uid: entity_uid,
            uuid: Some(entity_uuid),
        };

        for hit in &entity.combat_timeline_hits {
            let bucket_key = combat_timeline_bucket_key(hit);
            if hit.is_heal {
                let bucket =
                    combat_timeline_entry(&mut timeline_by_entity, source_identity, bucket_key);
                bucket.healing_value += hit.value;
                bucket.effective_healing_value += hit.effective_value;
            } else {
                let bucket =
                    combat_timeline_entry(&mut timeline_by_entity, source_identity, bucket_key);
                bucket.damage_value += hit.value;
                bucket.effective_damage_value += hit.effective_value;

                if hit.target_uid > 0 || hit.target_uuid.is_some_and(|uuid| uuid != 0) {
                    let target_identity = CombatTimelineIdentityKey {
                        uid: hit.target_uid,
                        uuid: hit.target_uuid,
                    };
                    let target_bucket =
                        combat_timeline_entry(&mut timeline_by_entity, target_identity, bucket_key);
                    target_bucket.hp_loss_value += hit.hp_loss_value;
                    target_bucket.shield_loss_value += hit.shield_loss_value;
                    target_bucket.taken_value +=
                        (hit.hp_loss_value + hit.shield_loss_value).max(hit.effective_value);
                }
            }
        }
    }

    for entity in state.encounter.entity_uuid_to_entity.values_mut() {
        entity.combat_timeline.clear();
    }

    for (identity, buckets) in timeline_by_entity {
        let Some(identity_uuid) = identity.uuid else {
            continue;
        };
        let Some(entity) = state
            .encounter
            .entity_uuid_to_entity
            .get_mut(&identity_uuid)
        else {
            continue;
        };
        let mut rows: Vec<_> = buckets.into_values().collect();
        rows.sort_by(|left, right| {
            left.timestamp_ms
                .cmp(&right.timestamp_ms)
                .then_with(|| left.target_uid.cmp(&right.target_uid))
                .then_with(|| left.target_uuid.cmp(&right.target_uuid))
                .then_with(|| {
                    left.target_monster_type_id
                        .cmp(&right.target_monster_type_id)
                })
        });
        if rows.len() > MAX_COMBAT_TIMELINE_BUCKETS_PER_ENTITY {
            let overflow = rows.len() - MAX_COMBAT_TIMELINE_BUCKETS_PER_ENTITY;
            rows.drain(0..overflow);
        }
        entity.combat_timeline = rows;
    }
}

fn finalize_modifier_hit_buckets_for_save(state: &mut AppState) {
    if !state.modifier_capture_enabled {
        for entity in state.encounter.entities_mut() {
            entity.modifier_hit_buckets.clear();
            entity.modifier_replay_hits.clear();
            entity.observed_damage_hits.clear();
            entity.combat_timeline_hits.clear();
        }
        return;
    }
    let mut windows_by_host_identity =
        HashMap::<CombatTimelineIdentityKey, Vec<ObservedModifierWindow>>::new();
    let mut windows_by_host_uid = HashMap::<i64, Vec<ObservedModifierWindow>>::new();
    for (&entity_uuid, entity) in &state.encounter.entity_uuid_to_entity {
        if entity_uuid <= 0 {
            continue;
        }
        let entity_uid = uid_from_uuid(entity_uuid);
        for window in &entity.modifier_windows {
            let mut window = window.clone();
            if window.host_uid <= 0 {
                window.host_uid = entity_uid;
            }
            if window.host_uuid.is_none() {
                window.host_uuid = Some(entity_uuid);
            }
            let host_identity = modifier_host_identity(window.host_uid, window.host_uuid);
            if host_identity.uuid.is_some() {
                windows_by_host_identity
                    .entry(host_identity)
                    .or_default()
                    .push(window.clone());
            }
            if window.host_uid > 0 {
                windows_by_host_uid
                    .entry(window.host_uid)
                    .or_default()
                    .push(window);
            }
        }
    }

    for (&entity_uuid, entity) in state.encounter.entity_uuid_to_entity.iter_mut() {
        if entity_uuid <= 0 {
            continue;
        }
        let entity_uid = uid_from_uuid(entity_uuid);
        entity.modifier_hit_buckets = build_modifier_hit_buckets(
            entity_uid,
            Some(entity_uuid),
            &entity.observed_damage_hits,
            &windows_by_host_identity,
            &windows_by_host_uid,
        );
        entity.modifier_replay_hits = build_modifier_replay_hits(
            entity_uid,
            Some(entity_uuid),
            &entity.observed_damage_hits,
            &windows_by_host_identity,
            &windows_by_host_uid,
        );
    }
}

fn trim_skill_timing_events(entity: &mut Entity) {
    if entity.skill_cast_events.len() > MAX_SKILL_TIMING_EVENTS {
        let overflow = entity.skill_cast_events.len() - MAX_SKILL_TIMING_EVENTS;
        entity.skill_cast_events.drain(0..overflow);
    }
    if entity.skill_cooldown_events.len() > MAX_SKILL_TIMING_EVENTS {
        let overflow = entity.skill_cooldown_events.len() - MAX_SKILL_TIMING_EVENTS;
        entity.skill_cooldown_events.drain(0..overflow);
    }
}

fn record_local_skill_cast_event(state: &mut AppState, skill_id: i32) {
    if skill_id <= 0 {
        return;
    }
    let skill_id = crate::live::skill_ids::normalize_skill_id(skill_id);
    let Some(entity) = local_player_entity_mut(&mut state.encounter) else {
        return;
    };
    entity.skill_cast_events.push(ObservedSkillCastEvent {
        timestamp_ms: now_ms(),
        skill_id,
        source: "attr-skill-id".to_string(),
    });
    trim_skill_timing_events(entity);
}

fn record_local_skill_cooldown_events(state: &mut AppState, skill_cds: &[ParsedSkillCd]) {
    if skill_cds.is_empty() {
        return;
    }

    let now = now_ms();
    let (attr_skill_cd, attr_skill_cd_pct, attr_cd_accelerate_pct) = state.attr_store.cd_inputs();
    let temp_attrs = state.attr_store.temp_attrs();
    let events: Vec<ObservedSkillCooldownEvent> = skill_cds
        .iter()
        .filter_map(|cd| {
            let skill_level_id = cd.skill_level_id?;
            if skill_level_id <= 0 {
                return None;
            }
            let duration = cd.duration.unwrap_or(0);
            let (calculated_duration, cd_accelerate_rate) = if duration > 0 {
                calculate_skill_cd(
                    duration as f32,
                    skill_level_id,
                    temp_attrs,
                    attr_skill_cd,
                    attr_skill_cd_pct,
                    attr_cd_accelerate_pct,
                )
            } else {
                (duration as f32, 0.0)
            };
            Some(ObservedSkillCooldownEvent {
                timestamp_ms: now,
                skill_level_id,
                skill_id: skill_level_id / 100,
                begin_time: cd.begin_time.unwrap_or(0),
                duration,
                calculated_duration: calculated_duration.round() as i32,
                cd_accelerate_rate,
                skill_cd_type: cd.skill_cd_type.unwrap_or(0),
                valid_cd_time: cd.valid_cd_time.unwrap_or(0),
                attr_skill_cd,
                attr_skill_cd_pct,
                attr_cd_accelerate_pct,
            })
        })
        .collect();
    if events.is_empty() {
        return;
    }

    let Some(entity) = local_player_entity_mut(&mut state.encounter) else {
        return;
    };
    entity.skill_cooldown_events.extend(events);
    trim_skill_timing_events(entity);
}

fn local_active_profession_talent_node_ids(state: &AppState) -> Vec<u32> {
    local_player_entity(&state.encounter)
        .map(|entity| {
            entity
                .active_profession_talents
                .iter()
                .map(|talent| talent.talent_node_id)
                .collect()
        })
        .unwrap_or_default()
}

fn local_active_profession_skills(
    state: &AppState,
) -> Vec<crate::live::opcodes_models::ObservedProfessionSkill> {
    local_player_entity(&state.encounter)
        .map(|entity| entity.active_profession_skills.clone())
        .unwrap_or_default()
}

fn observed_profession_skill_matches_id(skill: &ObservedProfessionSkill, skill_id: i32) -> bool {
    let normalized_skill_id = crate::live::skill_ids::normalize_skill_id(skill_id);
    skill.skill_id == skill_id
        || skill.skill_id == normalized_skill_id
        || skill.skill_level_id == Some(skill_id)
        || skill.skill_level_id == Some(normalized_skill_id)
        || skill.base_skill_id == Some(skill_id)
        || skill.base_skill_id == Some(normalized_skill_id)
        || skill.replace_skill_ids.contains(&skill_id)
        || skill.replace_skill_ids.contains(&normalized_skill_id)
}

fn canonical_profession_skill_id(skill: &ObservedProfessionSkill) -> Option<SkillId> {
    skill
        .base_skill_id
        .or_else(|| (skill.skill_id > 0).then_some(skill.skill_id))
        .map(crate::live::skill_ids::normalize_skill_id)
        .and_then(SkillId::new)
}

fn observed_profession_skill_slot_score(skill: &ObservedProfessionSkill) -> i32 {
    let mut score = 0;
    if skill.equipped == Some(true) {
        score += 40;
    }
    if skill.source_kind == "profession-skill" {
        score += 30;
    }
    if skill.base_skill_id.is_some() {
        score += 20;
    }
    if skill.skill_level_id.is_some() {
        score += 10;
    }
    if skill.skill_id >= 1000 {
        score += 5;
    }
    score
}

fn normalize_skill_id_from_table(skill_id: SkillId) -> SkillId {
    SkillId::new(crate::live::skill_ids::normalize_skill_id(skill_id.get())).unwrap_or(skill_id)
}

fn normalize_skill_lifecycle_id_from_active_skill(
    state: &AppState,
    skill_id: SkillId,
) -> Option<SkillId> {
    let raw_id = skill_id.get();
    let entity = local_player_entity(&state.encounter)?;

    entity
        .active_profession_skills
        .iter()
        .find(|skill| observed_profession_skill_matches_id(skill, raw_id))
        .and_then(canonical_profession_skill_id)
}

fn normalize_skill_lifecycle_id(state: &AppState, skill_id: SkillId) -> SkillId {
    normalize_skill_lifecycle_id_from_active_skill(state, skill_id)
        .unwrap_or_else(|| normalize_skill_id_from_table(skill_id))
}

fn normalize_client_skill_lifecycle_id(state: &AppState, event: &ClientSkillCast) -> SkillId {
    let table_skill_id = normalize_skill_id_from_table(event.skill_id);
    let direct_skill_id = normalize_skill_lifecycle_id_from_active_skill(state, event.skill_id);
    if let Some(skill_id) = direct_skill_id.filter(|skill_id| *skill_id != table_skill_id) {
        return skill_id;
    }

    if let (Some(entity), Some(slot_id)) = (local_player_entity(&state.encounter), event.slot_id) {
        let slot_skill_id = entity
            .active_profession_skills
            .iter()
            .filter(|skill| {
                skill.slot == Some(slot_id)
                    && skill.source_kind == "profession-skill"
                    && skill.equipped != Some(false)
            })
            .max_by_key(|skill| observed_profession_skill_slot_score(skill))
            .and_then(canonical_profession_skill_id);

        if let Some(skill_id) = slot_skill_id.filter(|skill_id| *skill_id != table_skill_id) {
            return skill_id;
        }
    }

    direct_skill_id.unwrap_or(table_skill_id)
}

fn local_active_effect_sources(
    state: &AppState,
) -> Vec<crate::live::opcodes_models::ObservedEffectSource> {
    local_player_entity(&state.encounter)
        .map(|entity| entity.active_effect_sources.clone())
        .unwrap_or_default()
}

fn local_active_gear_sets(state: &AppState) -> Vec<crate::live::opcodes_models::ObservedGearSet> {
    local_player_entity(&state.encounter)
        .map(|entity| entity.active_gear_sets.clone())
        .unwrap_or_default()
}

fn persist_and_save_encounter(state: &mut AppState, is_manual: bool, source: &str) {
    hydrate_entities_from_attr_store(state);
    sync_active_buffs_to_encounter(state);
    let defeated: Vec<String> = state
        .encounter
        .entities()
        .filter(|entity| entity.is_boss_metric_target())
        .filter_map(|entity| {
            if entity.name.is_empty() {
                None
            } else {
                Some(entity.name.clone())
            }
        })
        .collect();
    let player_names = collect_player_names(&state.encounter);
    let metadata = build_encounter_metadata(&state.encounter, defeated, player_names, is_manual);
    finalize_modifier_windows_for_save(
        state,
        metadata
            .ended_at_ms
            .unwrap_or_else(|| state.encounter.time_last_combat_packet_ms as i64),
    );
    finalize_combat_timeline_for_save(state);
    finalize_modifier_hit_buckets_for_save(state);

    if metadata.started_at_ms > 0 {
        info!(
            target: "app::live",
            "persist_encounter_on_{} started_at_ms={} ended_at_ms={:?} total_dmg={} total_heal={} scene_id={:?} players={} bosses={} is_manual={}",
            source,
            metadata.started_at_ms,
            metadata.ended_at_ms,
            metadata.total_dmg,
            metadata.total_heal,
            metadata.scene_id,
            metadata.player_names.len(),
            metadata.boss_names.len(),
            metadata.is_manually_reset
        );
        save_encounter(&state.encounter, &metadata);
    } else {
        warn!(
            target: "app::live",
            "persist_encounter_on_{}_skipped reason=time_fight_start_ms_zero total_dmg={} total_heal={} scene_id={:?}",
            source,
            metadata.total_dmg,
            metadata.total_heal,
            metadata.scene_id
        );
    }
}

fn persist_segment_unless_saved(state: &mut AppState, is_manual: bool, source: &str) {
    if state.training_dummy.segment_saved {
        return;
    }
    persist_and_save_encounter(state, is_manual, source);
}

/// Manages the state of the application.
#[derive(Clone)]
pub struct AppStateManager {
    control_tx: UnboundedSender<LiveControlCommand>,
}

impl AppStateManager {
    /// Creates a new `AppStateManager`.
    pub fn new() -> (Self, UnboundedReceiver<LiveControlCommand>) {
        let (control_tx, control_rx) = unbounded_channel();
        (Self { control_tx }, control_rx)
    }

    fn send_control(&self, command: LiveControlCommand) -> Result<(), String> {
        self.control_tx
            .send(command)
            .map_err(|_| "live runtime channel is unavailable".to_string())
    }

    pub fn handle_events_batch_with_state(&self, state: &mut AppState, events: Vec<StateEvent>) {
        if events.is_empty() {
            return;
        }
        let should_tick_runtime = events
            .iter()
            .any(|event| !should_drop_event_while_paused(state, event));
        let (mut counter_dirty, mut factor_counter_dirty) = if should_tick_runtime {
            tick_counter_trackers(state)
        } else {
            (false, false)
        };
        for event in events {
            let (next_counter_dirty, next_factor_counter_dirty) =
                self.apply_event_without_periodic_runtime(state, event);
            counter_dirty |= next_counter_dirty;
            factor_counter_dirty |= next_factor_counter_dirty;
        }
        if should_tick_runtime {
            let (next_counter_dirty, next_factor_counter_dirty) =
                sample_actor_state_for_lifecycle(state);
            counter_dirty |= next_counter_dirty;
            factor_counter_dirty |= next_factor_counter_dirty;
        }
        emit_counter_updates_if_dirty(state, counter_dirty, factor_counter_dirty);
        self.apply_attr_store_changes(state);
    }

    pub fn emit_minimap_if_active(&self, state: &mut AppState) {
        let scene_id = state.encounter.current_scene_id.unwrap_or_default();
        if !crate::live::minimap::scene::is_minimap_scene(scene_id) {
            state.pending_minimap_skill_casts.clear();
            state.attr_store.set_skill_cast_recording(false);
            if state.minimap_snapshot_active {
                state.event_manager.emit_minimap_update(None, Vec::new());
                state.minimap_snapshot_active = false;
            }
            return;
        }

        let skill_casts = std::mem::take(&mut state.pending_minimap_skill_casts);
        let snapshot = Some(crate::live::minimap::build_minimap_snapshot(state));
        state
            .event_manager
            .emit_minimap_update(snapshot, skill_casts);
        state.minimap_snapshot_active = true;
    }

    pub fn drain_control_commands(
        &self,
        state: &mut AppState,
        control_rx: &mut UnboundedReceiver<LiveControlCommand>,
    ) {
        loop {
            let Ok(command) = control_rx.try_recv() else {
                break;
            };
            self.apply_control_command(state, command);
        }
    }

    pub fn send_state_event(&self, event: StateEvent) -> Result<(), String> {
        self.send_control(LiveControlCommand::StateEvent(event))
    }

    pub fn send_toggle_pause_encounter(&self) -> Result<(), String> {
        self.send_control(LiveControlCommand::TogglePauseEncounter)
    }

    fn apply_event(&self, state: &mut AppState, event: StateEvent) {
        let (mut counter_dirty, mut factor_counter_dirty) =
            if should_drop_event_while_paused(state, &event) {
                debug!("packet dropped due to encounter paused");
                return;
            } else {
                tick_counter_trackers(state)
            };
        let (next_counter_dirty, next_factor_counter_dirty) =
            self.apply_event_without_periodic_runtime(state, event);
        counter_dirty |= next_counter_dirty;
        factor_counter_dirty |= next_factor_counter_dirty;
        let (next_counter_dirty, next_factor_counter_dirty) =
            sample_actor_state_for_lifecycle(state);
        counter_dirty |= next_counter_dirty;
        factor_counter_dirty |= next_factor_counter_dirty;
        emit_counter_updates_if_dirty(state, counter_dirty, factor_counter_dirty);
        self.apply_attr_store_changes(state);
    }

    fn apply_event_without_periodic_runtime(
        &self,
        state: &mut AppState,
        event: StateEvent,
    ) -> (bool, bool) {
        // Check if encounter is paused for events that should be dropped
        if should_drop_event_while_paused(state, &event) {
            debug!("packet dropped due to encounter paused");
            return (false, false);
        }

        let mut counter_dirty = false;
        let mut factor_counter_dirty = false;
        match event {
            StateEvent::EnterScene(data) => {
                self.process_enter_scene(state, data);
            }
            StateEvent::SyncSceneEvents(data) => {
                self.process_scene_events(state, data);
            }
            StateEvent::SyncNearEntities(data) => {
                self.process_sync_near_entities(state, data);
                // Note: Player names are automatically stored in the database via UpsertEntity tasks
                // No need to maintain a separate cache anymore
            }
            StateEvent::SyncContainerData(data) => {
                // store local_player copy
                state.encounter.local_player = data.clone();

                factor_counter_dirty |= self.process_sync_container_data(state, data);
                // Note: Player names are automatically stored in the database via UpsertEntity tasks
                // No need to maintain a separate cache anymore
            }
            StateEvent::SyncContainerDirtyData(data) => {
                factor_counter_dirty |= self.process_sync_container_dirty_data(state, data);
            }
            StateEvent::SyncServerTime(_data) => {
                // todo: this is skipped, not sure what info it has
            }
            StateEvent::SyncDungeonData(data) => {
                self.process_sync_dungeon_data(state, data);
                self.apply_battle_state_resets_if_needed(state);
            }
            StateEvent::SyncDungeonDirtyData(data) => {
                self.process_sync_dungeon_dirty_data(state, data);
                self.apply_battle_state_resets_if_needed(state);
            }
            StateEvent::SyncToMeDeltaInfo(data) => {
                let (next_counter_dirty, next_factor_counter_dirty) =
                    self.process_sync_to_me_delta_info(state, data);
                counter_dirty |= next_counter_dirty;
                factor_counter_dirty |= next_factor_counter_dirty;
                self.apply_battle_state_resets_if_needed(state);
                // Note: Player names are automatically stored in the database via UpsertEntity tasks
                // No need to maintain a separate cache anymore
            }
            StateEvent::SyncNearDeltaInfo(data) => {
                let (next_counter_dirty, next_factor_counter_dirty) =
                    self.process_sync_near_delta_info(state, data);
                counter_dirty |= next_counter_dirty;
                factor_counter_dirty |= next_factor_counter_dirty;
                // Note: Player names are automatically stored in the database via UpsertEntity tasks
                // No need to maintain a separate cache anymore
            }
            StateEvent::Team(event) => {
                self.process_team_event(state, event);
            }
            StateEvent::ResetEncounter { is_manual } => {
                info!(
                    target: "app::live",
                    "ResetEncounter state event received is_manual={}",
                    is_manual
                );
                state.pending_auto_reset = None;
                self.reset_encounter(state, is_manual);
            }
            StateEvent::ClientSkillCast(event) => {
                let skill_id = normalize_client_skill_lifecycle_id(state, &event);
                let event = ClientSkillCast { skill_id, ..event };
                let outputs = state
                    .local_monitor
                    .skill_lifecycle
                    .on_client_skill_cast(event);
                let (next_counter_dirty, next_factor_counter_dirty) =
                    apply_skill_lifecycle_outputs(state, outputs);
                counter_dirty |= next_counter_dirty;
                factor_counter_dirty |= next_factor_counter_dirty;
            }
            StateEvent::ServerSkillEnd(event) => {
                let event = ServerSkillEnd {
                    skill_id: normalize_skill_lifecycle_id(state, event.skill_id),
                };
                let outputs = state
                    .local_monitor
                    .skill_lifecycle
                    .on_server_skill_end(event);
                let (next_counter_dirty, next_factor_counter_dirty) =
                    apply_skill_lifecycle_outputs(state, outputs);
                counter_dirty |= next_counter_dirty;
                factor_counter_dirty |= next_factor_counter_dirty;
            }
        }
        (counter_dirty, factor_counter_dirty)
    }

    fn process_team_event(&self, state: &mut AppState, event: TeamEvent) {
        let local_player_uuid = current_local_player_uuid(&state.encounter);
        let equipment = match &event {
            TeamEvent::MemberInfoUpdated { equipment, .. }
            | TeamEvent::Joined { equipment, .. } => equipment.clone(),
            _ => Vec::new(),
        };
        info!(target: "app::live", "team event: {:?}", event);
        state.team.apply_event(event, local_player_uuid);
        self.merge_remote_player_equipment(state, equipment);
        info!(
            target: "app::live",
            "team state team_id={} leader_uuid={} members={:?}",
            state.team.team_id,
            state.team.leader_uuid,
            state.team.members
        );
    }

    fn merge_remote_player_equipment(
        &self,
        state: &mut AppState,
        equipment: Vec<TeamMemberEquipment>,
    ) {
        for member in equipment {
            let uid = uid_from_uuid(member.member_uuid);
            if uid <= 0 || member.items.is_empty() {
                continue;
            }

            let entity = state
                .encounter
                .entity_by_uuid_or_insert_with(member.member_uuid, || {
                    let mut entity = Entity::default();
                    entity.uuid = Some(member.member_uuid);
                    entity.entity_type = EEntityType::EntChar;
                    entity
                });
            entity.entity_type = EEntityType::EntChar;
            upsert_remote_equipped_items(
                &mut entity.equipped_items,
                member.items.into_iter().map(|item| ObservedEquippedItem {
                    slot: item.slot,
                    item_config_id: item.item_config_id,
                    item_uuid: None,
                    package_key: None,
                    package_type: None,
                    item_quality: None,
                    equip_slot_refine_level: None,
                    break_through_time: None,
                    perfection_level: None,
                    runtime_source: format!(
                        "remoteEquipConfig:{}.equip_infos.slot/equip_id",
                        member.runtime_source
                    ),
                }),
            );
        }
    }

    pub(crate) fn apply_control_command(&self, state: &mut AppState, command: LiveControlCommand) {
        match command {
            LiveControlCommand::StateEvent(event) => {
                self.apply_event(state, event);
            }
            LiveControlCommand::TogglePauseEncounter => {
                let paused = state.encounter.is_encounter_paused;
                state.set_encounter_paused(!paused);
            }
            LiveControlCommand::ApplyMonitorRuntimeSnapshot(snapshot) => {
                self.apply_monitor_runtime_snapshot_with_state(state, snapshot);
            }
            LiveControlCommand::StartTrainingDummy { duration_seconds } => {
                let previous = build_training_dummy_state(&state.training_dummy);
                info!(target: "app::live", "training_dummy_start requested duration_seconds={:?}", duration_seconds);
                if state.encounter.is_encounter_paused {
                    info!(
                        target: "app::live",
                        "training_dummy_start cleared paused state so parsing can resume"
                    );
                    state.set_encounter_paused(false);
                }
                state.training_dummy.arm_with_duration(duration_seconds);
                emit_training_dummy_update_if_changed(state, previous);
            }
            LiveControlCommand::StopTrainingDummy => {
                let previous = build_training_dummy_state(&state.training_dummy);
                if state.training_dummy.locked_target_uuid.is_some()
                    && encounter_has_stats(&state.encounter)
                {
                    info!(
                        target: "app::live",
                        "training_dummy_stop resetting active training dummy encounter"
                    );
                    self.reset_encounter(state, false);
                }
                if state.encounter.is_encounter_paused {
                    info!(
                        target: "app::live",
                        "training_dummy_stop cleared paused state so parsing can resume"
                    );
                    state.set_encounter_paused(false);
                }
                state.training_dummy.clear();
                emit_training_dummy_update_if_changed(state, previous);
            }
            LiveControlCommand::SetEventUpdateRateMs(rate_ms) => {
                state.event_update_rate_ms = rate_ms.clamp(50, 2_000);
            }
            LiveControlCommand::SetAutoClearOnSceneChange(enabled) => {
                state.auto_clear_on_scene_change = enabled;
            }
            LiveControlCommand::SetModifierCaptureEnabled(enabled) => {
                if state.modifier_capture_enabled != enabled {
                    state.modifier_capture_enabled = enabled;
                    if !enabled {
                        clear_modifier_capture_state(state);
                    }
                }
            }
            LiveControlCommand::SetMonitoredBuffs(buff_base_ids) => {
                state.entity_buff_config.local_player = BuffWatchProfile::from_any_source_ids(
                    buff_base_ids.clone(),
                    state.entity_buff_config.local_player.monitor_all,
                );
                state.local_monitor.buff_monitor.monitored_buff_ids =
                    buff_base_ids.into_iter().collect();
                emit_local_buff_update_snapshot(state);
            }
            LiveControlCommand::SetBossMonitoredBuffs {
                global_ids,
                self_applied_ids,
                monitor_all_self_applied,
            } => {
                state.entity_buff_config.monster =
                    BuffWatchProfile::from_any_and_local_player_source_ids(
                        global_ids,
                        self_applied_ids,
                        monitor_all_self_applied,
                    );
                emit_boss_buff_update_snapshot(state);
            }
            LiveControlCommand::SetTeammateMonitoredBuffs {
                any_source_ids,
                local_player_source_ids,
                target_self_source_ids,
                monitor_all,
            } => {
                state.entity_buff_config.teammate = BuffWatchProfile::from_all_sources(
                    any_source_ids,
                    local_player_source_ids,
                    target_self_source_ids,
                    monitor_all,
                );
            }
            LiveControlCommand::SetMonitoredPanelAttrs(attr_ids) => {
                state.local_monitor.monitored_panel_attr_ids = attr_ids;
                let payload: Vec<PanelAttrState> = state
                    .local_monitor
                    .monitored_panel_attr_ids
                    .iter()
                    .filter_map(|attr_id| {
                        state
                            .attr_store
                            .panel_attr_value(*attr_id)
                            .map(|value| PanelAttrState {
                                attr_id: *attr_id,
                                value,
                            })
                    })
                    .collect();
                emit_panel_attr_update_if_needed(state, payload);
            }
            LiveControlCommand::SetMonitoredSkills(skill_level_ids) => {
                state.local_monitor.skill_cd_monitor.monitored_skill_ids = skill_level_ids;
                let monitored_skill_ids = &state.local_monitor.skill_cd_monitor.monitored_skill_ids;
                let old_map =
                    std::mem::take(&mut state.local_monitor.skill_cd_monitor.skill_cd_map);
                state.local_monitor.skill_cd_monitor.skill_cd_map = old_map
                    .into_iter()
                    .filter(|(skill_level_id, _)| {
                        monitored_skill_ids.iter().any(|monitored_skill_id| {
                            skill_cd_matches_monitored(*skill_level_id, *monitored_skill_id)
                        })
                    })
                    .collect();
            }
            LiveControlCommand::SetMonitorAllBuff(monitor_all_buff) => {
                state.entity_buff_config.local_player.monitor_all = monitor_all_buff;
                state.entity_buff_config.local_player.enabled = monitor_all_buff
                    || !state
                        .entity_buff_config
                        .local_player
                        .any_source_ids
                        .is_empty()
                    || !state
                        .entity_buff_config
                        .local_player
                        .local_player_source_ids
                        .is_empty()
                    || !state
                        .entity_buff_config
                        .local_player
                        .target_self_source_ids
                        .is_empty();
                state.local_monitor.buff_monitor.monitor_all_buff = monitor_all_buff;
                emit_local_buff_update_snapshot(state);
            }
            LiveControlCommand::SetBuffCounterRules(rules) => {
                state.local_monitor.counter_tracker.set_rules(rules);
            }
            LiveControlCommand::SetSeasonCultivateFactorTemplates(templates) => {
                if state
                    .local_monitor
                    .season_cultivate
                    .set_templates(templates)
                {
                    refresh_season_cultivate_factor_rules(state);
                    emit_season_cultivate_factor_counter_update(state);
                }
            }
        }
    }

    pub(crate) fn apply_monitor_runtime_snapshot_with_state(
        &self,
        state: &mut AppState,
        snapshot: MonitorRuntimeSnapshot,
    ) {
        let MonitorRuntimeSnapshot {
            live,
            skill,
            monster,
            teammate,
        } = snapshot;

        info!(
            target: "app::live",
            "[runtime-monitor] applying snapshot: event_update_rate_ms={} auto_clear_on_scene_change={} modifier_reports_enabled={} skill_enabled={} monitored_skills={} monitored_buffs={} panel_attrs={} counter_rules={} season_cultivate_factor_templates={} monster_enabled={} monster_global={} monster_self_applied={} teammate_enabled={} teammate_any={} teammate_local={} teammate_self={}",
            live.event_update_rate_ms,
            live.auto_clear_on_scene_change,
            live.modifier_reports_enabled,
            skill.enabled,
            skill.monitored_skill_ids.len(),
            skill.monitored_buff_ids.len(),
            skill.monitored_panel_attr_ids.len(),
            skill.buff_counter_rules.len(),
            skill.season_cultivate_factor_templates.len(),
            monster.enabled,
            monster.global_ids.len(),
            monster.self_applied_ids.len(),
            teammate.enabled,
            teammate.any_source_ids.len(),
            teammate.local_player_source_ids.len(),
            teammate.target_self_source_ids.len()
        );
        debug!(
            target: "app::live",
            "[monitor-buff] set monitorAllBuff: {:?}",
            skill.monitor_all_buff
        );
        debug!(
            target: "app::live",
            "[skill-cd] set monitored skills: {:?}",
            skill.monitored_skill_ids
        );
        debug!(
            target: "app::live",
            "[buff] set monitored buffs: {:?}",
            skill.monitored_buff_ids
        );
        debug!(
            target: "app::live",
            "[panel-attr] set monitored attrs: {:?}",
            skill.monitored_panel_attr_ids
        );
        debug!(
            target: "app::live",
            "[buff-counter] set rules: {}",
            skill.buff_counter_rules.len()
        );
        debug!(
            target: "app::live",
            "[boss-buff] set monitored buffs: global={:?} self_applied={:?} monitor_all_self={:?}",
            monster.global_ids,
            monster.self_applied_ids,
            monster.monitor_all_self_applied
        );
        debug!(
            target: "app::live",
            "[teammate-buff] set monitored buffs: any={:?} local_player={:?} target_self={:?} monitor_all={:?}",
            teammate.any_source_ids,
            teammate.local_player_source_ids,
            teammate.target_self_source_ids,
            teammate.monitor_all
        );

        self.apply_control_command(
            state,
            LiveControlCommand::SetEventUpdateRateMs(live.event_update_rate_ms),
        );
        self.apply_control_command(
            state,
            LiveControlCommand::SetAutoClearOnSceneChange(live.auto_clear_on_scene_change),
        );
        self.apply_control_command(
            state,
            LiveControlCommand::SetModifierCaptureEnabled(live.modifier_reports_enabled),
        );
        self.apply_control_command(
            state,
            LiveControlCommand::SetMonitorAllBuff(skill.monitor_all_buff),
        );
        self.apply_control_command(
            state,
            LiveControlCommand::SetMonitoredSkills(skill.monitored_skill_ids),
        );
        self.apply_control_command(
            state,
            LiveControlCommand::SetMonitoredBuffs(skill.monitored_buff_ids),
        );
        self.apply_control_command(
            state,
            LiveControlCommand::SetMonitoredPanelAttrs(skill.monitored_panel_attr_ids),
        );
        self.apply_control_command(
            state,
            LiveControlCommand::SetBuffCounterRules(skill.buff_counter_rules),
        );
        self.apply_control_command(
            state,
            LiveControlCommand::SetSeasonCultivateFactorTemplates(
                skill.season_cultivate_factor_templates,
            ),
        );
        self.apply_control_command(
            state,
            LiveControlCommand::SetBossMonitoredBuffs {
                global_ids: monster.global_ids,
                self_applied_ids: monster.self_applied_ids,
                monitor_all_self_applied: monster.monitor_all_self_applied,
            },
        );
        self.apply_control_command(
            state,
            LiveControlCommand::SetTeammateMonitoredBuffs {
                any_source_ids: teammate.any_source_ids,
                local_player_source_ids: teammate.local_player_source_ids,
                target_self_source_ids: teammate.target_self_source_ids,
                monitor_all: teammate.monitor_all,
            },
        );
    }

    // all scene id extraction logic is here (its pretty rough)
    fn process_enter_scene(&self, state: &mut AppState, enter_scene: blueprotobuf::EnterScene) {
        use crate::live::opcodes_process::process_enter_scene as parse_enter_scene;
        use crate::live::scene_names;

        info!("EnterScene packet received");

        let parsed = parse_enter_scene(
            &mut state.encounter,
            &mut state.attr_store,
            &enter_scene,
            &state.local_monitor.monitored_panel_attr_ids,
            state.modifier_capture_enabled,
        );

        let was_initial_scene = !state.initial_scene_change_handled;
        if was_initial_scene {
            info!("Initial scene detected");
            state.initial_scene_change_handled = true;
        }
        if state.auto_clear_on_scene_change {
            let previous = build_training_dummy_state(&state.training_dummy);
            state.training_dummy.clear();
            emit_training_dummy_update_if_changed(state, previous);
        } else if !was_initial_scene {
            hold_active_encounter_for_scene_change(state, "enter_scene");
        } else {
            info!(
                target: "app::live",
                "enter_scene_auto_clear_disabled_initial_scene_no_pause"
            );
        }

        if let Some(scene_id) = parsed.scene_id {
            let scene_name = scene_names::lookup(scene_id);
            let previous_scene_id = state.encounter.current_scene_id;

            // Update encounter with scene info
            state.encounter.current_scene_id = Some(scene_id);
            state.encounter.current_scene_name = Some(scene_name.clone());
            state.encounter.current_dungeon_difficulty = None;
            if previous_scene_id != Some(scene_id) {
                state.encounter.markers.clear();
            }
            state
                .attr_store
                .set_skill_cast_recording(crate::live::minimap::scene::is_minimap_scene(scene_id));

            info!("Scene changed to: {} (ID: {})", scene_name, scene_id);

            // Emit scene change event
            if state.event_manager.should_emit_events() {
                info!("Emitting scene change event for: {}", scene_name);
                state
                    .event_manager
                    .emit_scene_change(Some(scene_id), scene_name, None);
            } else {
                warn!("Event manager not ready, skipping scene change emit");
            }
        } else {
            warn!("Could not extract scene_id from EnterScene packet");
        }
    }

    fn process_sync_near_entities(
        &self,
        state: &mut AppState,
        sync_near_entities: blueprotobuf::SyncNearEntities,
    ) {
        use crate::live::opcodes_process::process_sync_near_entities;
        let Some(result) = process_sync_near_entities(
            &mut state.encounter,
            &mut state.attr_store,
            sync_near_entities,
            state.modifier_capture_enabled,
        ) else {
            warn!("Error processing SyncNearEntities.. ignoring.");
            return;
        };

        let detected_at_ms = now_ms();
        let teammate_fantasies = result
            .teammate_fantasies
            .into_iter()
            .map(|fantasy| {
                let summoner_uid = match state.encounter.entity_by_uuid(fantasy.summoner_uuid) {
                    Some(entity) => state
                        .encounter
                        .display_uid_for_entity(fantasy.summoner_uuid, entity),
                    None => state.encounter.remember_entity_uuid(fantasy.summoner_uuid),
                };
                let summoner_entity = state.encounter.entity_by_uuid(fantasy.summoner_uuid);
                TeammateFantasyState {
                    summon_uuid: entity_uuid_string(fantasy.summon_uuid),
                    summoner_uuid: entity_uuid_string(fantasy.summoner_uuid),
                    summoner_name: Some(resolve_player_display_name(
                        summoner_uid,
                        summoner_entity,
                        &state.attr_store,
                    )),
                    monster_id: fantasy.monster_id,
                    remodel_level: fantasy.remodel_level,
                    detected_at_ms,
                }
            })
            .collect();
        state
            .event_manager
            .emit_teammate_fantasy_update(teammate_fantasies);

        for (target_uuid, buff_infos) in result.initial_buff_snapshots {
            state
                .entity_buff_monitors
                .monitor_for(target_uuid)
                .apply_buff_info_snapshot(&buff_infos);
        }

        for target_uuid in result.disappeared {
            state.entity_buff_monitors.remove(target_uuid);
        }
    }

    fn process_scene_events(
        &self,
        state: &mut AppState,
        sync_scene_events: blueprotobuf::SyncSceneEvents,
    ) {
        let Some(event_data_list) = sync_scene_events.evt else {
            return;
        };

        let received_at_ms = now_ms();
        let mut dbm_events = Vec::new();
        for event in event_data_list.events {
            if event.event_type != Some(WORLD_EVENT_TYPE_BOSS_DBM) {
                continue;
            }

            let Some(skill_effect_id) = event.int_params.first().copied() else {
                warn!("BossDbm event missing skill effect id");
                continue;
            };
            let Some(duration_sec) = event.int_params.get(1).copied() else {
                warn!("BossDbm event missing duration");
                continue;
            };

            let duration_ms = duration_sec.saturating_mul(1000);
            if duration_ms <= 0 {
                warn!(
                    "BossDbm event has non-positive duration: skill_effect_id={}, duration_sec={}",
                    skill_effect_id, duration_sec
                );
                continue;
            }

            dbm_events.push(BossDbmEvent {
                skill_effect_id,
                base_skill_id: skill_effect_id / 100,
                duration_ms,
                create_time_ms: received_at_ms,
                insertion: event.int_params.get(2).copied().unwrap_or_default(),
                server_timestamp_ms: event.long_params.first().copied(),
            });
        }

        state.event_manager.emit_boss_dbm_update(dbm_events);
    }

    fn process_sync_container_data(
        &self,
        state: &mut AppState,
        sync_container_data: blueprotobuf::SyncContainerData,
    ) -> bool {
        use crate::live::opcodes_process::process_sync_container_data;

        if state.auto_clear_on_scene_change {
            persist_segment_unless_saved(state, false, "container_data_resync");
            state.encounter.clear_entities();
            state.encounter.reset_combat_state();
        } else {
            if hold_active_encounter_for_scene_change(state, "container_data_resync") {
                emit_current_scene_change_boundary(state, "Container data resync");
            }
        }
        state.attr_store.clear_all_entities();
        state.local_monitor.clear_runtime_state();
        state.modifier_buff_monitor.active_buffs.clear();
        state.entity_buff_monitors.clear();
        state.event_manager.emit_teammate_fantasy_clear();
        state.encounter.markers.clear();
        state.pending_minimap_skill_casts.clear();
        state.minimap_snapshot_active = false;
        state.local_owned_source_uids.clear();
        state.local_owned_source_uuids.clear();
        state.local_owned_source_config_ids.clear();
        state.local_factor_selector_zero_slots.clear();
        state.sent_overlay_uids.clear();
        state.sent_overlay_uid_names.clear();
        state.sent_overlay_identity_names.clear();
        state.sent_overlay_monster_ids.clear();
        state.last_overlay_identity_resend = None;
        clear_overlay_snapshot_signatures(state);
        state.battle_state = BattleStateMachine::default();
        state.pending_auto_reset = None;
        if state.auto_clear_on_scene_change {
            let previous = build_training_dummy_state(&state.training_dummy);
            state.training_dummy.clear();
            emit_training_dummy_update_if_changed(state, previous);
        }

        let Some(result) = process_sync_container_data(
            &mut state.encounter,
            &mut state.attr_store,
            sync_container_data,
            state.modifier_capture_enabled,
        ) else {
            warn!("Error processing SyncContainerData.. ignoring.");
            return false;
        };

        let season_cultivate_changed = if let Some(data) = result.season_cultivate_line_data {
            state.local_monitor.season_cultivate.replace_data(data)
        } else {
            state.local_monitor.season_cultivate.clear_data()
        };
        let selected_factor_items_replaced = result.active_factor_items_authoritative
            && replace_selected_factor_items_from_equipped_snapshot(state);
        let selected_factor_items_pruned = prune_selected_factor_items_to_active_snapshot(state);
        if season_cultivate_changed
            || selected_factor_items_replaced
            || selected_factor_items_pruned
        {
            refresh_season_cultivate_factor_rules(state);
        }

        sync_selected_factor_items_to_local_entity(state);
        season_cultivate_changed || selected_factor_items_replaced || selected_factor_items_pruned
    }

    fn process_sync_container_dirty_data(
        &self,
        state: &mut AppState,
        sync_container_dirty_data: blueprotobuf::SyncContainerDirtyData,
    ) -> bool {
        use crate::live::opcodes_process::process_sync_container_dirty_data;
        let loadout_updates_allowed = !encounter_has_stats(&state.encounter);
        let selected_factor_selection_observed_before = state.selected_factor_selection_observed;
        let selected_factor_gate_signature_before = selected_factor_rule_gate_signature(state);
        let selected_factor_rule_item_ids_before =
            selected_factor_rule_item_ids(&state.local_selected_factor_items);
        let season_cultivate_dirty_bytes = sync_container_dirty_data
            .v_data
            .as_ref()
            .and_then(|v_data| v_data.buffer.as_deref());
        let mut selected_factor_items =
            crate::live::seasonal_factor_selector::selected_factor_items_from_dirty_data(
                &sync_container_dirty_data,
            );
        let selected_factor_values_seen = !selected_factor_items.is_empty();
        let (transition_selected_factor_items, selector_nodes_seen) =
            selected_factor_items_from_dirty_transitions(state, &sync_container_dirty_data);
        selected_factor_items.extend(transition_selected_factor_items);
        if selected_factor_values_seen || selector_nodes_seen || !selected_factor_items.is_empty() {
            state.selected_factor_selection_observed = true;
        }
        if !selected_factor_items.is_empty() {
            unsuppress_selected_factor_items(state, &selected_factor_items);
            upsert_selected_factor_items(
                &mut state.local_selected_factor_items,
                &selected_factor_items,
            );
            state.selected_factor_cache_dirty = true;
        }
        let selected_factor_items_changed =
            selected_factor_rule_item_ids(&state.local_selected_factor_items)
                != selected_factor_rule_item_ids_before;
        let selected_factor_selection_observed_changed =
            state.selected_factor_selection_observed != selected_factor_selection_observed_before;
        let Some(result) = process_sync_container_dirty_data(
            &mut state.encounter,
            &sync_container_dirty_data,
            state.modifier_capture_enabled,
            loadout_updates_allowed,
        ) else {
            warn!("Error processing SyncContainerDirtyData.. ignoring.");
            return false;
        };

        let mut season_cultivate_changed = false;
        let season_cultivate_dirty_bytes = result
            .season_cultivate_dirty_bytes
            .or(season_cultivate_dirty_bytes)
            .filter(|bytes| {
                crate::live::season_cultivate::dirty_bytes_may_touch_season_cultivate(bytes)
            });
        if let Some(bytes) = season_cultivate_dirty_bytes {
            season_cultivate_changed = state
                .local_monitor
                .season_cultivate
                .apply_dirty_bytes(bytes);
        }
        let selected_factor_items_pruned = prune_selected_factor_items_to_active_snapshot(state);
        let selected_factor_gate_changed =
            selected_factor_rule_gate_signature(state) != selected_factor_gate_signature_before;
        let should_refresh_factor_rules = season_cultivate_changed
            || selected_factor_items_changed
            || selected_factor_selection_observed_changed
            || selected_factor_gate_changed
            || selected_factor_items_pruned;
        if should_refresh_factor_rules {
            refresh_season_cultivate_factor_rules(state);
        }

        if should_refresh_factor_rules || !selected_factor_items.is_empty() {
            sync_selected_factor_items_to_local_entity(state);
        }
        season_cultivate_changed
            || selected_factor_items_changed
            || selected_factor_selection_observed_changed
            || selected_factor_gate_changed
            || selected_factor_items_pruned
    }

    fn process_sync_dungeon_data(
        &self,
        state: &mut AppState,
        sync_dungeon_data: blueprotobuf::SyncDungeonData,
    ) {
        use crate::live::opcodes_process::process_sync_dungeon_data;
        use crate::live::scene_names;

        let scene_uuid = sync_dungeon_data.v_data.as_ref().and_then(|v| v.scene_uuid);
        let difficulty = sync_dungeon_data
            .v_data
            .as_ref()
            .and_then(|v| v.dungeon_scene_info.as_ref())
            .and_then(|info| info.difficulty);
        let inferred_scene_id = scene_uuid.and_then(infer_scene_id_from_scene_uuid);

        if let Some(v_data) = sync_dungeon_data.v_data.as_ref() {
            let equipment = collect_dungeon_player_equipment(v_data);
            self.merge_remote_player_equipment(state, equipment);
        }

        if let Some(difficulty) = difficulty {
            state.encounter.current_dungeon_difficulty = Some(difficulty);
        }

        let scene_id_to_refresh = inferred_scene_id.or(state.encounter.current_scene_id);
        if let Some(scene_id) = scene_id_to_refresh {
            let scene_name = scene_names::lookup_with_difficulty(
                scene_id,
                state.encounter.current_dungeon_difficulty,
            );
            let should_emit = state
                .encounter
                .current_scene_name
                .as_ref()
                .map(|name| name != &scene_name)
                .unwrap_or(true);

            state.encounter.current_scene_id = Some(scene_id);
            state.encounter.current_scene_name = Some(scene_name.clone());

            if inferred_scene_id.is_some() {
                info!(
                    target: "app::live",
                    "Scene inferred from SyncDungeonData scene_uuid={:?}: {} (ID: {})",
                    scene_uuid,
                    scene_name,
                    scene_id
                );
            }

            if should_emit && state.event_manager.should_emit_events() {
                state.event_manager.emit_scene_change(
                    Some(scene_id),
                    scene_name.clone(),
                    state.encounter.current_dungeon_difficulty,
                );
            }
        } else if let Some(scene_uuid) = scene_uuid {
            info!(
                target: "app::live",
                "SyncDungeonData scene_uuid={} did not resolve to a known scene id",
                scene_uuid
            );
        }

        let encounter_has_stats = encounter_has_stats(&state.encounter);

        let result = process_sync_dungeon_data(
            &mut state.battle_state,
            sync_dungeon_data,
            encounter_has_stats,
        );

        if result.entered_playing {
            let now = now_ms();
            state
                .local_monitor
                .counter_tracker
                .on_mechanic_dungeon_started(now);
            state
                .local_monitor
                .factor_counter_tracker
                .on_mechanic_dungeon_started(now);
        }

        if let Some(reason) = result.reset_reason {
            info!(
                target: "app::live",
                "State layer applying reset from SyncDungeonData: {:?}",
                reason
            );
            self.apply_reset_reason(state, reason);
        }
    }

    fn process_sync_dungeon_dirty_data(
        &self,
        state: &mut AppState,
        sync_dungeon_dirty_data: blueprotobuf::SyncDungeonDirtyData,
    ) {
        use crate::live::opcodes_process::process_sync_dungeon_dirty_data;

        let encounter_has_stats = encounter_has_stats(&state.encounter);

        let result = process_sync_dungeon_dirty_data(
            &mut state.battle_state,
            sync_dungeon_dirty_data,
            encounter_has_stats,
        );

        if result.entered_playing {
            let now = now_ms();
            state
                .local_monitor
                .counter_tracker
                .on_mechanic_dungeon_started(now);
            state
                .local_monitor
                .factor_counter_tracker
                .on_mechanic_dungeon_started(now);
        }

        if let Some(reason) = result.reset_reason {
            info!(
                target: "app::live",
                "State layer applying reset from SyncDungeonDirtyData: {:?}",
                reason
            );
            self.apply_reset_reason(state, reason);
        }
    }

    fn process_sync_to_me_delta_info(
        &self,
        state: &mut AppState,
        sync_to_me_delta_info: blueprotobuf::SyncToMeDeltaInfo,
    ) -> (bool, bool) {
        use crate::live::opcodes_process::{
            aoi_delta_has_player_damage, process_sync_to_me_delta_info,
        };
        if state.pending_auto_reset.is_some() {
            let has_damage = sync_to_me_delta_info
                .delta_info
                .as_ref()
                .and_then(|d| d.base_delta.as_ref())
                .is_some_and(aoi_delta_has_player_damage);
            self.try_deferred_reset(state, has_damage, "SyncToMeDeltaInfo");
        }

        let combat_gate = sync_to_me_delta_info
            .delta_info
            .as_ref()
            .and_then(|delta| delta.base_delta.as_ref())
            .map(|base_delta| {
                let local_player_uuid = sync_to_me_delta_info
                    .delta_info
                    .as_ref()
                    .and_then(|delta| delta.uuid)
                    .map(|uuid| {
                        state.encounter.local_player_uuid = uuid;
                        state.attr_store.set_local_uuid(uuid);
                        state.encounter.remember_entity_uuid(uuid);
                        uuid
                    })
                    .unwrap_or_else(|| current_local_player_uuid(&state.encounter));
                self.prepare_training_dummy_for_delta(
                    state,
                    base_delta,
                    local_player_uuid,
                    "SyncToMeDeltaInfo",
                )
            })
            .unwrap_or_default();

        let result = process_sync_to_me_delta_info(
            &mut state.encounter,
            &mut state.attr_store,
            sync_to_me_delta_info,
            &state.local_monitor.monitored_panel_attr_ids,
            combat_gate,
            state.modifier_capture_enabled,
        );

        if state.modifier_capture_enabled {
            apply_temp_attr_modifier_changes(state, &result.temp_attr_modifier_changes);
        }

        if !result.skill_cds.is_empty() {
            debug!("[skill-cd] received {} cd entries", result.skill_cds.len());
        }

        let mut counter_dirty = false;
        let mut factor_counter_dirty = false;
        if let Some(ids) = result.fight_resource_ids {
            let _ = state
                .attr_store
                .set_fight_resource_ids(current_local_player_uuid(&state.encounter), ids);
        }
        if let Some(values) = result.fight_resources {
            let ids = state
                .attr_store
                .fight_resource_ids(current_local_player_uuid(&state.encounter));
            if !ids.is_empty() {
                let entries: Vec<FightResourceEntry> = ids
                    .iter()
                    .copied()
                    .zip(values)
                    .map(|(id, value)| FightResourceEntry { id, value })
                    .collect();
                let changed = state
                    .local_monitor
                    .fight_res_state
                    .as_ref()
                    .map(|previous| previous.entries != entries)
                    .unwrap_or(true);
                if changed {
                    let new_state = FightResourceState {
                        entries,
                        received_at: crate::database::now_ms(),
                    };
                    let counter_changed = state
                        .local_monitor
                        .counter_tracker
                        .on_fight_resource_update(&new_state.entries);
                    let factor_counter_changed = state
                        .local_monitor
                        .factor_counter_tracker
                        .on_fight_resource_update(&new_state.entries);
                    counter_dirty |= counter_changed;
                    factor_counter_dirty |= factor_counter_changed;
                    factor_trace::record(
                        "factor-input",
                        "fight-resource-update",
                        json!({
                            "entries": &new_state.entries,
                            "counterChanged": counter_changed,
                            "factorCounterChanged": factor_counter_changed,
                        }),
                    );
                    state.local_monitor.fight_res_state = Some(new_state.clone());
                    state.event_manager.emit_fight_resource_update(new_state);
                }
            }
        }

        if !result.local_damage_events.is_empty() {
            let local_player_uuid = current_local_player_uuid(&state.encounter);
            remember_local_owned_sources_from_damage_events(state, &result.local_damage_events);
            let counter_changed = state.local_monitor.counter_tracker.on_damage_events(
                &result.local_damage_events,
                local_player_uuid,
                &state.attr_store,
            );
            let factor_counter_changed =
                state.local_monitor.factor_counter_tracker.on_damage_events(
                    &result.local_damage_events,
                    local_player_uuid,
                    &state.attr_store,
                );
            counter_dirty |= counter_changed;
            factor_counter_dirty |= factor_counter_changed;
            factor_trace::record(
                "factor-input",
                "local-damage-events",
                json!({
                    "localPlayerUuid": local_player_uuid,
                    "eventCount": result.local_damage_events.len(),
                    "events": &result.local_damage_events,
                    "counterChanged": counter_changed,
                    "factorCounterChanged": factor_counter_changed,
                }),
            );
        }

        if !result.local_damage_taken_events.is_empty() {
            let local_player_uuid = current_local_player_uuid(&state.encounter);
            let counter_changed = state
                .local_monitor
                .counter_tracker
                .on_damage_taken_events(&result.local_damage_taken_events, local_player_uuid);
            let factor_counter_changed = state
                .local_monitor
                .factor_counter_tracker
                .on_damage_taken_events(&result.local_damage_taken_events, local_player_uuid);
            counter_dirty |= counter_changed;
            factor_counter_dirty |= factor_counter_changed;
            factor_trace::record(
                "factor-input",
                "local-damage-taken-events",
                json!({
                    "localPlayerUuid": local_player_uuid,
                    "eventCount": result.local_damage_taken_events.len(),
                    "events": &result.local_damage_taken_events,
                    "counterChanged": counter_changed,
                    "factorCounterChanged": factor_counter_changed,
                }),
            );
        }

        if let Some(skill_base_id) = result.attr_skill_id {
            factor_trace::record(
                "factor-input",
                "attr-skill-id",
                json!({
                    "skillBaseId": skill_base_id,
                    "modifierCaptureEnabled": state.modifier_capture_enabled,
                }),
            );
            if state.modifier_capture_enabled {
                record_local_skill_cast_event(state, skill_base_id);
            }
        }

        if !result.skill_cds.is_empty() {
            if state.modifier_capture_enabled {
                record_local_skill_cooldown_events(state, &result.skill_cds);
            }
            let active_talent_node_ids = local_active_profession_talent_node_ids(state);
            let active_profession_skills = local_active_profession_skills(state);
            let active_effect_sources = local_active_effect_sources(state);
            let active_gear_sets = local_active_gear_sets(state);
            state.attr_store.mark_cd_dirty();
            state.local_monitor.skill_cd_monitor.apply_skill_cd_updates(
                &result.skill_cds,
                &state.attr_store,
                &active_talent_node_ids,
                SkillCdRuntimeSnapshot::from_attr_store(
                    &state.local_monitor.buff_monitor.active_buffs,
                    &state.attr_store,
                )
                .with_active_profession_skills(&active_profession_skills)
                .with_active_effect_sources(&active_effect_sources)
                .with_active_gear_sets(&active_gear_sets),
            );
        }

        if let Some(raw_bytes) = result.buff_effect_bytes {
            let local_player_uuid = current_local_player_uuid(&state.encounter);
            if local_player_uuid != 0 {
                let _ = process_entity_buff_effect_bytes(state, local_player_uuid, &raw_bytes);
            }
            let buff_process_result = state.local_monitor.buff_monitor.process_buff_effect_bytes(
                &raw_bytes,
                &mut state.server_clock_offset,
                local_player_uuid,
            );
            remember_local_owned_sources_from_buff_changes(state, &buff_process_result.changes);
            if buff_changes_affect_skill_cd(&buff_process_result.changes) {
                state.attr_store.mark_cd_dirty();
            }
            if let Some(payload) = buff_process_result.update_payload {
                state.event_manager.emit_buff_update(payload);
            }
            if state.modifier_capture_enabled {
                apply_modifier_buff_changes(
                    state,
                    &buff_process_result.changes,
                    Some(local_player_uuid),
                );
            }
            let counter_buff_changed = state.local_monitor.counter_tracker.on_buff_changes(
                &buff_process_result.changes,
                &state.attr_store,
                local_player_uuid,
            );
            let counter_external_changed = state
                .local_monitor
                .counter_tracker
                .on_external_team_buff_changes(
                    &buff_process_result.changes,
                    &state.attr_store,
                    local_player_uuid,
                );
            let factor_buff_changed = state.local_monitor.factor_counter_tracker.on_buff_changes(
                &buff_process_result.changes,
                &state.attr_store,
                local_player_uuid,
            );
            let factor_external_changed = state
                .local_monitor
                .factor_counter_tracker
                .on_external_team_buff_changes(
                    &buff_process_result.changes,
                    &state.attr_store,
                    local_player_uuid,
                );
            counter_dirty |= counter_buff_changed || counter_external_changed;
            factor_counter_dirty |= factor_buff_changed || factor_external_changed;
            if !buff_process_result.changes.is_empty() {
                factor_trace::record(
                    "factor-input",
                    "buff-changes",
                    json!({
                        "localPlayerUuid": local_player_uuid,
                        "changeCount": buff_process_result.changes.len(),
                        "changes": &buff_process_result.changes,
                        "counterBuffChanged": counter_buff_changed,
                        "counterExternalChanged": counter_external_changed,
                        "factorBuffChanged": factor_buff_changed,
                        "factorExternalChanged": factor_external_changed,
                    }),
                );
            }
        }

        let local_player_uuid = current_local_player_uuid(&state.encounter);
        let counter_movement_changed = state
            .local_monitor
            .counter_tracker
            .on_movement_sample(&state.attr_store, local_player_uuid);
        let factor_movement_changed = state
            .local_monitor
            .factor_counter_tracker
            .on_movement_sample(&state.attr_store, local_player_uuid);
        counter_dirty |= counter_movement_changed;
        factor_counter_dirty |= factor_movement_changed;
        if counter_movement_changed || factor_movement_changed {
            factor_trace::record(
                "factor-input",
                "movement-sample",
                json!({
                    "localPlayerUuid": local_player_uuid,
                    "counterChanged": counter_movement_changed,
                    "factorCounterChanged": factor_movement_changed,
                }),
            );
        }

        (counter_dirty, factor_counter_dirty)
    }

    fn process_sync_near_delta_info(
        &self,
        state: &mut AppState,
        sync_near_delta_info: blueprotobuf::SyncNearDeltaInfo,
    ) -> (bool, bool) {
        use crate::live::opcodes_process::{aoi_delta_has_player_damage, process_aoi_sync_delta};
        if state.pending_auto_reset.is_some() {
            let has_damage = sync_near_delta_info
                .delta_infos
                .iter()
                .any(aoi_delta_has_player_damage);
            self.try_deferred_reset(state, has_damage, "SyncNearDeltaInfo");
        }

        let mut counter_dirty = false;
        let mut factor_counter_dirty = false;
        let mut aggregated_damage_events = Vec::new();
        let local_player_uuid = current_local_player_uuid(&state.encounter);
        for mut aoi_sync_delta in sync_near_delta_info.delta_infos {
            let target_uuid = aoi_sync_delta.uuid;
            let target_display_uid = target_uuid.map(uid_from_uuid);
            let target_entity_type = target_uuid.map(EEntityType::from);
            let buff_bytes = aoi_sync_delta.buff_effect.take();
            let combat_gate = self.prepare_training_dummy_for_delta(
                state,
                &aoi_sync_delta,
                local_player_uuid,
                "SyncNearDeltaInfo",
            );

            // Missing fields are normal, no need to log
            if let Some((events, _)) = process_aoi_sync_delta(
                &mut state.encounter,
                &mut state.attr_store,
                aoi_sync_delta,
                combat_gate,
                false,
                state.modifier_capture_enabled,
            ) {
                remember_local_owned_sources_from_damage_events(state, &events);
                aggregated_damage_events.extend(events);
            }

            if let (Some(target_uuid), Some(raw_bytes)) = (target_uuid, buff_bytes) {
                let target_display_uid =
                    target_display_uid.unwrap_or_else(|| uid_from_uuid(target_uuid));
                let is_local_target = local_player_uuid != 0 && target_uuid == local_player_uuid;
                let entity_buff_process_result =
                    process_entity_buff_effect_bytes(state, target_uuid, &raw_bytes);
                if state.modifier_capture_enabled
                    && is_local_target
                    && matches!(
                        entity_buff_process_result.as_ref().map(|(kind, _)| *kind),
                        Some(BuffTargetKind::LocalPlayer)
                    )
                {
                    let buff_process_result =
                        state.modifier_buff_monitor.process_buff_effect_bytes(
                            &raw_bytes,
                            &mut state.server_clock_offset,
                            current_local_player_uuid(&state.encounter),
                        );
                    apply_modifier_buff_changes(
                        state,
                        &buff_process_result.changes,
                        Some(target_uuid),
                    );
                }
                if let Some((kind, buff_process_result)) = entity_buff_process_result.as_ref() {
                    if matches!(kind, BuffTargetKind::LocalPlayer | BuffTargetKind::Teammate) {
                        counter_dirty |= state
                            .local_monitor
                            .counter_tracker
                            .on_external_team_buff_changes(
                                &buff_process_result.changes,
                                &state.attr_store,
                                local_player_uuid,
                            );
                        factor_counter_dirty |= state
                            .local_monitor
                            .factor_counter_tracker
                            .on_external_team_buff_changes(
                                &buff_process_result.changes,
                                &state.attr_store,
                                local_player_uuid,
                            );
                    }
                }
                if let Some((BuffTargetKind::Monster, buff_process_result)) =
                    entity_buff_process_result.as_ref()
                {
                    if !buff_process_result.changes.is_empty() {
                        debug!(
                            target: "app::live",
                            "[boss-buff] processed target_uid={} target_uuid={} changes={} entity_type={:?} kind={:?}",
                            target_display_uid,
                            target_uuid,
                            buff_process_result.changes.len(),
                            target_entity_type,
                            BuffTargetKind::Monster,
                        );
                    }
                }
            }
        }

        if !aggregated_damage_events.is_empty() {
            let local_player_uuid = current_local_player_uuid(&state.encounter);
            let counter_changed = state.local_monitor.counter_tracker.on_damage_events(
                &aggregated_damage_events,
                local_player_uuid,
                &state.attr_store,
            );
            let factor_counter_changed =
                state.local_monitor.factor_counter_tracker.on_damage_events(
                    &aggregated_damage_events,
                    local_player_uuid,
                    &state.attr_store,
                );
            counter_dirty |= counter_changed;
            factor_counter_dirty |= factor_counter_changed;
            factor_trace::record(
                "factor-input",
                "aggregated-damage-events",
                json!({
                    "localPlayerUuid": local_player_uuid,
                    "eventCount": aggregated_damage_events.len(),
                    "events": &aggregated_damage_events,
                    "counterChanged": counter_changed,
                    "factorCounterChanged": factor_counter_changed,
                }),
            );
        }

        let local_player_uuid = current_local_player_uuid(&state.encounter);
        let counter_movement_changed = state
            .local_monitor
            .counter_tracker
            .on_movement_sample(&state.attr_store, local_player_uuid);
        let factor_movement_changed = state
            .local_monitor
            .factor_counter_tracker
            .on_movement_sample(&state.attr_store, local_player_uuid);
        counter_dirty |= counter_movement_changed;
        factor_counter_dirty |= factor_movement_changed;
        if counter_movement_changed || factor_movement_changed {
            factor_trace::record(
                "factor-input",
                "movement-sample",
                json!({
                    "localPlayerUuid": local_player_uuid,
                    "counterChanged": counter_movement_changed,
                    "factorCounterChanged": factor_movement_changed,
                }),
            );
        }

        (counter_dirty, factor_counter_dirty)
    }

    fn try_deferred_reset(&self, state: &mut AppState, has_damage: bool, source: &str) {
        if !state
            .pending_auto_reset
            .is_some_and(|trigger_at| Instant::now() >= trigger_at)
        {
            return;
        }
        if !has_damage {
            return;
        }

        if state.encounter.total_dmg > 0 {
            info!(
                target: "app::live",
                "Deferred reset executing: damage in {}",
                source
            );
            self.reset_encounter(state, false);
        } else {
            info!(
                target: "app::live",
                "Deferred reset skipped: zero total_dmg in {} (total_heal={})",
                source,
                state.encounter.total_heal
            );
        }
        state.pending_auto_reset = None;
    }

    fn apply_reset_reason(&self, state: &mut AppState, reason: EncounterResetReason) {
        let encounter_has_stats = encounter_has_stats(&state.encounter);
        state.encounter.dps_display_paused = encounter_has_stats;
        info!(
            target: "app::live",
            "Applying encounter reset due to rule: {:?} (has_stats={}, total_dmg={}, total_heal={})",
            reason,
            encounter_has_stats,
            state.encounter.total_dmg,
            state.encounter.total_heal
        );
        match reason {
            EncounterResetReason::NewObjective | EncounterResetReason::Wipe => {
                let trigger_at = Instant::now() + Duration::from_secs(3);
                state.pending_auto_reset = Some(trigger_at);
                info!(
                    target: "app::live",
                    "Deferred auto-reset armed (3s): {:?}",
                    reason
                );
            }
        }
    }

    fn apply_attr_store_changes(&self, state: &mut AppState) {
        let changes = state.attr_store.drain_changes();

        if !changes.panel_dirty_attrs.is_empty() {
            emit_panel_attr_update_if_needed(state, changes.panel_dirty_attrs);
        }

        if changes.cd_dirty {
            let active_talent_node_ids = local_active_profession_talent_node_ids(state);
            let active_profession_skills = local_active_profession_skills(state);
            let active_effect_sources = local_active_effect_sources(state);
            let active_gear_sets = local_active_gear_sets(state);
            state
                .local_monitor
                .skill_cd_monitor
                .recalculate_cached_skill_cds(
                    &state.attr_store,
                    &active_talent_node_ids,
                    SkillCdRuntimeSnapshot::from_attr_store(
                        &state.local_monitor.buff_monitor.active_buffs,
                        &state.attr_store,
                    )
                    .with_active_profession_skills(&active_profession_skills)
                    .with_active_effect_sources(&active_effect_sources)
                    .with_active_gear_sets(&active_gear_sets),
                );
            let filtered = state
                .local_monitor
                .skill_cd_monitor
                .build_filtered_skill_cds();
            emit_skill_cd_update_if_needed(state, filtered);
        }

        if changes.shield_detail_dirty {
            emit_shield_detail_update_if_needed(state, changes.shield_detail_entries);
        }

        let scene_id = state.encounter.current_scene_id.unwrap_or_default();
        if crate::live::minimap::scene::is_minimap_scene(scene_id) {
            for cast in changes.skill_cast_events {
                if !is_minimap_relevant_entity(state, cast.entity_uuid, scene_id) {
                    continue;
                }
                let position = state
                    .attr_store
                    .attr_position_by_id(cast.entity_uuid, attr_type::ATTR_POS);
                let facing = state
                    .attr_store
                    .attr(cast.entity_uuid, AttrType::Facing)
                    .and_then(AttrValue::as_int)
                    .map(|value| value as f32 / 100.0);
                state.pending_minimap_skill_casts.push(MinimapSkillCast {
                    entity_uuid: entity_uuid_string(cast.entity_uuid),
                    skill_id: cast.skill_id,
                    time_ms: cast.timestamp_ms,
                    x: position.as_ref().map(|position| position.x),
                    z: position.as_ref().map(|position| position.z),
                    facing,
                });
            }
        }

        for death in changes.death_events {
            if let Some(entity) = state.encounter.entity_mut_by_uuid(death.entity_uuid) {
                let recent_damages: Vec<_> = entity.recent_taken_events.drain(..).collect();
                if recent_damages.is_empty() {
                    continue;
                }
                let victim_uid = uid_from_uuid(death.entity_uuid);
                entity.deaths.push(DeathRecord {
                    victim_entity_uuid: Some(entity_uuid_string(death.entity_uuid)),
                    victim_uid,
                    victim_uuid: Some(death.entity_uuid),
                    victim_key: entity_key_from_uuid_or_uid(Some(death.entity_uuid), victim_uid),
                    death_timestamp_ms: death.timestamp_ms,
                    recent_damages,
                });
                state.death_snapshot_dirty = true;
            }
        }
    }

    fn apply_battle_state_resets_if_needed(&self, state: &mut AppState) {
        if let Some(reason) = state.battle_state.check_deferred_calls() {
            self.apply_reset_reason(state, reason);
            return;
        }

        if let Some(reason) = state
            .battle_state
            .check_for_wipe(&mut state.local_monitor.buff_monitor.active_buffs)
        {
            self.apply_reset_reason(state, reason);
        }
    }

    fn reset_encounter(&self, state: &mut AppState, is_manual: bool) {
        persist_segment_unless_saved(state, is_manual, "reset");
        state.encounter.reset_combat_state();
        sync_selected_factor_items_to_local_entity(state);
        reset_season_cultivate_factor_counters(state);
        if is_manual && state.encounter.is_encounter_paused {
            info!(
                target: "app::live",
                "manual reset cleared paused state so parsing can resume"
            );
            state.encounter.is_encounter_paused = false;
            state.event_manager.emit_encounter_pause(false);
        }
        state.modifier_buff_monitor.active_buffs.clear();
        state.entity_buff_monitors.clear();
        state.event_manager.emit_teammate_fantasy_clear();
        state.pending_minimap_skill_casts.clear();
        state.minimap_snapshot_active = false;
        state.local_owned_source_uids.clear();
        state.local_owned_source_uuids.clear();
        state.local_owned_source_config_ids.clear();
        state.local_factor_selector_zero_slots.clear();
        state.death_snapshot_dirty = false;

        state.event_manager.emit_encounter_reset();

        // Reset is a user/control event, so do not gate it behind the normal live
        // update throttle. The frontend must clear immediately even if a combat
        // update was emitted a few milliseconds earlier.
        use crate::live::commands_models::HeaderInfo;
        let cleared_header = HeaderInfo {
            total_dps: 0.0,
            total_dmg: 0,
            elapsed_ms: 0,
            active_combat_time_ms: 0,
            fight_start_timestamp_ms: 0,
            dps_display_paused: false,
            local_player_uuid: (state.encounter.local_player_uuid > 0)
                .then(|| entity_uuid_string(state.encounter.local_player_uuid)),
            local_player_key: (state.encounter.local_player_uuid > 0)
                .then(|| entity_uuid_string(state.encounter.local_player_uuid)),
            bosses: vec![],
            scene_id: state.encounter.current_scene_id,
            scene_name: state.encounter.current_scene_name.clone(),
            training_dummy: build_training_dummy_state(&state.training_dummy),
        };
        state
            .event_manager
            .emit_encounter_update(cleared_header, state.encounter.is_encounter_paused);
        let cleared_live_data = crate::live::event_manager::generate_live_data_payload(
            &state.encounter,
            &state.attr_store,
            build_training_dummy_state(&state.training_dummy),
        );
        state.event_manager.emit_live_data(cleared_live_data);
        if is_manual {
            state.battle_state = BattleStateMachine::default();
            if state.training_dummy.is_active() {
                let previous = build_training_dummy_state(&state.training_dummy);
                state.training_dummy.rearm();
                emit_training_dummy_update_if_changed(state, previous);
            }
        }
    }

    /// Get player name by UID from database
    ///
    /// # Arguments
    ///
    /// * `uid` - The UID of the player.
    ///
    /// # Returns
    ///
    /// * `Option<String>` - The name of the player, or `None` if not found.
    #[allow(dead_code)]
    pub async fn get_player_name(&self, uid: i64) -> Option<String> {
        crate::database::commands::get_name_by_uid(uid)
            .ok()
            .flatten()
    }

    /// Get recent players ordered by last seen (most recent first)
    ///
    /// # Arguments
    ///
    /// * `limit` - The maximum number of players to return.
    ///
    /// # Returns
    ///
    /// * `Vec<(i64, String)>` - A list of recent players.
    #[allow(dead_code)]
    pub async fn get_recent_players(&self, limit: usize) -> Vec<(i64, String)> {
        crate::database::commands::get_recent_players(limit as i64).unwrap_or_default()
    }

    /// Get multiple names by UIDs (batch query for performance)
    ///
    /// # Arguments
    ///
    /// * `uids` - A slice of UIDs.
    ///
    /// # Returns
    ///
    /// * `std::collections::HashMap<i64, String>` - A map of UIDs to names.
    #[allow(dead_code)]
    pub async fn get_player_names(&self, uids: &[i64]) -> std::collections::HashMap<i64, String> {
        let mut result = std::collections::HashMap::new();
        for &uid in uids {
            if let Ok(Some(name)) = crate::database::commands::get_name_by_uid(uid) {
                result.insert(uid, name);
            }
        }
        result
    }

    /// Check if a player exists in the database
    ///
    /// # Arguments
    ///
    /// * `uid` - The UID of the player.
    ///
    /// # Returns
    ///
    /// * `bool` - Whether the player exists.
    #[allow(dead_code)]
    pub async fn contains_player(&self, uid: i64) -> bool {
        crate::database::commands::get_name_by_uid(uid)
            .ok()
            .flatten()
            .is_some()
    }

    pub fn apply_monitor_runtime_snapshot(
        &self,
        snapshot: MonitorRuntimeSnapshot,
    ) -> Result<(), String> {
        self.send_control(LiveControlCommand::ApplyMonitorRuntimeSnapshot(snapshot))
    }

    pub fn start_training_dummy(&self, duration_seconds: Option<u64>) -> Result<(), String> {
        self.send_control(LiveControlCommand::StartTrainingDummy { duration_seconds })
    }

    pub fn stop_training_dummy(&self) -> Result<(), String> {
        self.send_control(LiveControlCommand::StopTrainingDummy)
    }
}

impl AppStateManager {
    /// Updates and emits events.
    pub fn update_and_emit_events_with_state(&self, state: &mut AppState) {
        if !state.event_manager.should_emit_events() {
            return;
        }

        finish_training_dummy_if_due(state, "heartbeat");
        sync_active_buffs_to_encounter(state);
        let payload = crate::live::event_manager::generate_live_data_payload(
            &state.encounter,
            &state.attr_store,
            build_training_dummy_state(&state.training_dummy),
        );

        state.event_manager.emit_live_data(payload);

        if state.death_snapshot_dirty {
            let mut records: Vec<DeathRecord> = state
                .encounter
                .entities()
                .flat_map(|entity| entity.deaths.iter().cloned())
                .collect();
            records.sort_by_key(|record| record.death_timestamp_ms);
            state.event_manager.emit_death_replay(records);
            state.death_snapshot_dirty = false;
        }
        let current_target_uuid = current_attack_target_uuid(state);
        let raw_boss_buff_snapshot = build_monster_buff_snapshots(state);
        let raw_teammate_buff_snapshot = build_teammate_buff_snapshots(state);

        let mut boss_buff_snapshot = HashMap::new();
        let mut teammate_buff_snapshot = HashMap::new();
        let mut all_hate_lists = HashMap::new();
        let mut stun_entries = Vec::new();
        let mut new_names = HashMap::new();
        let mut player_names = HashMap::new();
        let mut monster_ids = HashMap::new();
        let force_identity_resend = should_resend_overlay_identity_names(state);

        for (&entity_uuid, buffs) in &raw_boss_buff_snapshot {
            if entity_uuid == 0 || buffs.is_empty() || state.attr_store.is_dead(entity_uuid) {
                continue;
            }

            let entity_key = entity_uuid_string(entity_uuid);
            boss_buff_snapshot.insert(entity_key.clone(), buffs.clone());

            let entity = state.encounter.entity_by_uuid(entity_uuid);
            let display_uid = entity
                .map(|entity| state.encounter.display_uid_for_entity(entity_uuid, entity))
                .unwrap_or_else(|| uid_from_uuid(entity_uuid));
            if let Some(name) =
                known_entity_display_name(display_uid, Some(entity_uuid), entity, &state.attr_store)
            {
                queue_overlay_identity_name(
                    &mut state.sent_overlay_identity_names,
                    &mut player_names,
                    entity_key.clone(),
                    name.clone(),
                    force_identity_resend,
                );
                if display_uid > 0 {
                    queue_overlay_uid_name(
                        &mut state.sent_overlay_uid_names,
                        &mut new_names,
                        display_uid,
                        name,
                    );
                }
            } else if let Some(entity) = entity {
                let name = resolve_entity_display_name(display_uid, entity, &state.attr_store);
                state.sent_overlay_uids.insert(display_uid);
                queue_overlay_uid_name(
                    &mut state.sent_overlay_uid_names,
                    &mut new_names,
                    display_uid,
                    name,
                );
            }
            if let Some(monster_id) = monster_id_for_uuid(state, entity_uuid, entity) {
                queue_overlay_monster_id(
                    &mut state.sent_overlay_monster_ids,
                    &mut monster_ids,
                    entity_key,
                    monster_id,
                    force_identity_resend,
                );
                if display_uid > 0 {
                    queue_overlay_monster_id(
                        &mut state.sent_overlay_monster_ids,
                        &mut monster_ids,
                        display_uid.to_string(),
                        monster_id,
                        force_identity_resend,
                    );
                }
            }
        }

        if let Some(target_uuid) = current_target_uuid {
            let target_display_uid = state
                .encounter
                .entity_by_uuid(target_uuid)
                .map(|entity| state.encounter.display_uid_for_entity(target_uuid, entity))
                .unwrap_or_else(|| uid_from_uuid(target_uuid));
            let target_key = entity_uuid_string(target_uuid);

            let target_entity = state.encounter.entity_by_uuid(target_uuid);
            if let Some(name) = known_entity_display_name(
                target_display_uid,
                Some(target_uuid),
                target_entity,
                &state.attr_store,
            ) {
                queue_overlay_identity_name(
                    &mut state.sent_overlay_identity_names,
                    &mut player_names,
                    target_key.clone(),
                    name.clone(),
                    force_identity_resend,
                );
                queue_overlay_uid_name(
                    &mut state.sent_overlay_uid_names,
                    &mut new_names,
                    target_display_uid,
                    name,
                );
            } else if let Some(entity) = target_entity {
                let name =
                    resolve_entity_display_name(target_display_uid, entity, &state.attr_store);
                state.sent_overlay_uids.insert(target_display_uid);
                queue_overlay_uid_name(
                    &mut state.sent_overlay_uid_names,
                    &mut new_names,
                    target_display_uid,
                    name,
                );
            }
            if let Some(monster_id) = monster_id_for_uuid(state, target_uuid, target_entity) {
                queue_overlay_monster_id(
                    &mut state.sent_overlay_monster_ids,
                    &mut monster_ids,
                    target_key.clone(),
                    monster_id,
                    force_identity_resend,
                );
                if target_display_uid > 0 {
                    queue_overlay_monster_id(
                        &mut state.sent_overlay_monster_ids,
                        &mut monster_ids,
                        target_display_uid.to_string(),
                        monster_id,
                        force_identity_resend,
                    );
                }
            }

            let entries = state
                .attr_store
                .hate_lists()
                .get(&target_uuid)
                .cloned()
                .or_else(|| {
                    state
                        .attr_store
                        .hate_lists()
                        .get(&target_display_uid)
                        .cloned()
                })
                .unwrap_or_default();

            for entry in &entries {
                if state.sent_overlay_uids.insert(entry.uid) {
                    let entity = entry
                        .entity_uuid
                        .and_then(|uuid| state.encounter.entity_by_uuid(uuid));
                    let name = state
                        .attr_store
                        .attr(entry.entity_uuid.unwrap_or(entry.uid), AttrType::Name)
                        .or_else(|| state.attr_store.attr(entry.uid, AttrType::Name))
                        .and_then(|value| value.as_string())
                        .map(ToString::to_string)
                        .unwrap_or_else(|| format!("UID {}", entry.uid));
                    new_names.insert(entry.uid, name);
                    let identity_key = entry
                        .entity_uuid
                        .map(entity_uuid_string)
                        .unwrap_or_else(|| entity_uuid_string(entry.uid));
                    if let Some(monster_id) = entity.and_then(|entity| entity.monster_type_id) {
                        queue_overlay_monster_id(
                            &mut state.sent_overlay_monster_ids,
                            &mut monster_ids,
                            identity_key,
                            monster_id,
                            force_identity_resend,
                        );
                    } else {
                        player_names.insert(
                            identity_key,
                            resolve_player_display_name(entry.uid, entity, &state.attr_store),
                        );
                    }
                }
            }

            if !entries.is_empty() {
                all_hate_lists.insert(target_key.clone(), entries);
            }

            let max_stun = state
                .attr_store
                .attr(target_uuid, AttrType::MaxStunned)
                .and_then(AttrValue::as_int)
                .unwrap_or(0);
            let current_stun = state
                .attr_store
                .attr(target_uuid, AttrType::CurrentStunned)
                .and_then(AttrValue::as_int)
                .unwrap_or(0);
            if max_stun > 0 {
                stun_entries.push(StunEntry {
                    boss_entity_uuid: target_key,
                    monster_id: minimap_monster_id_of(state, target_uuid).unwrap_or(0),
                    current: current_stun,
                    max: max_stun,
                });
            }
        }

        for (&teammate_uuid, buffs) in &raw_teammate_buff_snapshot {
            if teammate_uuid == 0
                || teammate_uuid == current_local_player_uuid(&state.encounter)
                || !state.team.members.contains(&teammate_uuid)
                || state.attr_store.is_dead(teammate_uuid)
                || buffs.is_empty()
            {
                continue;
            }

            let teammate_key = entity_uuid_string(teammate_uuid);
            teammate_buff_snapshot.insert(teammate_key.clone(), buffs.clone());
            if let Some(entity) = state.encounter.entity_by_uuid(teammate_uuid) {
                let display_uid = state
                    .encounter
                    .display_uid_for_entity(teammate_uuid, entity);
                queue_overlay_identity_name(
                    &mut state.sent_overlay_identity_names,
                    &mut player_names,
                    teammate_key,
                    resolve_player_display_name(display_uid, Some(entity), &state.attr_store),
                    false,
                );
            }
        }

        if should_emit_overlay_signature(
            &mut state.last_overlay_hate_lists_signature,
            hate_snapshot_signature(&all_hate_lists),
        ) {
            state.event_manager.emit_hate_list_update(all_hate_lists);
        }
        if should_emit_overlay_signature(
            &mut state.last_overlay_stun_signature,
            stun_snapshot_signature(&stun_entries),
        ) {
            state.event_manager.emit_stun_update(stun_entries);
        }

        if !new_names.is_empty() {
            state.event_manager.emit_entity_name_map(new_names);
        }
        if !player_names.is_empty() || !monster_ids.is_empty() {
            state
                .event_manager
                .emit_entity_identity_map(player_names, monster_ids);
        }
        if should_emit_overlay_signature(
            &mut state.last_overlay_boss_buffs_signature,
            buff_snapshot_signature(&boss_buff_snapshot),
        ) {
            state
                .event_manager
                .emit_boss_buff_update(boss_buff_snapshot);
        }
        if should_emit_overlay_signature(
            &mut state.last_overlay_teammate_buffs_signature,
            buff_snapshot_signature(&teammate_buff_snapshot),
        ) {
            state
                .event_manager
                .emit_teammate_buff_update(teammate_buff_snapshot);
        }
    }

    fn prepare_training_dummy_for_delta(
        &self,
        state: &mut AppState,
        delta: &AoiSyncDelta,
        local_player_uuid: i64,
        source: &str,
    ) -> CombatGate {
        if !state.training_dummy.is_active() {
            return CombatGate::AllowAll;
        }

        if finish_training_dummy_if_due(state, source) {
            return CombatGate::BlockAll;
        }

        let matched = inspect_aoi_delta(&state.encounter, delta, local_player_uuid);

        if let Some(matched) = matched {
            if state.training_dummy.should_lock_on_match(matched) {
                if encounter_has_stats(&state.encounter) {
                    info!(
                        target: "app::live",
                        "training_dummy_reset_before_lock source={} target_uid={} target_uuid={} monster_id={}",
                        source,
                        matched.target_uid,
                        matched.target_entity_uuid,
                        matched.monster_id.id()
                    );
                    self.reset_encounter(state, false);
                }
                let previous = build_training_dummy_state(&state.training_dummy);
                state.training_dummy.lock_target(matched);
                emit_training_dummy_update_if_changed(state, previous);
                info!(
                    target: "app::live",
                    "training_dummy_locked source={} target_uid={} target_uuid={} monster_id={}",
                    source,
                    matched.target_uid,
                    matched.target_entity_uuid,
                    matched.monster_id.id()
                );
            }
        }

        state.training_dummy.combat_gate()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live::counter_tracker::{
        CounterAction, CounterSource, EffectSlotConfig, ResetBuffTarget,
    };
    use crate::live::entity_id::entity_id_to_uuid;

    fn factor_item(item_config_id: i32) -> ObservedFactorItem {
        ObservedFactorItem {
            factor_buff_id: item_config_id + 10,
            item_config_id,
            item_uuid: None,
            package_key: 0,
            package_type: None,
            grade: Some(1),
            family_id: Some(item_config_id + 20),
            runtime_source: SELECTED_FACTOR_TRANSITION_RUNTIME_SOURCE.to_string(),
            selector_path: Some("slot.path".to_string()),
            selector_signature: Some("tree".to_string()),
            selector_offset: Some(8),
        }
    }

    fn area_with_middle_items(item_ids: Vec<i32>) -> blueprotobuf::CultivateAreaData {
        let mut area = blueprotobuf::CultivateAreaData {
            is_active: Some(true),
            ..Default::default()
        };
        for (idx, item_id) in item_ids.into_iter().enumerate() {
            area.cultivate_middle_node_map.insert(
                i32::try_from(idx + 1).unwrap(),
                blueprotobuf::CultivateMiddleNodeData {
                    item_id: Some(item_id),
                },
            );
        }
        area
    }

    fn season_cultivate_data_with_middle_items(
        item_ids: Vec<i32>,
    ) -> blueprotobuf::SeasonCultivateLineData {
        let mut data = blueprotobuf::SeasonCultivateLineData::default();
        let mut line = blueprotobuf::CultivateLineData::default();
        let mut sub_type = blueprotobuf::CultivateLineSubTypeData::default();
        sub_type
            .cultivate_line_data_map
            .insert(1, area_with_middle_items(item_ids));
        line.cultivate_line_map.insert(10, sub_type);
        data.season_cultivate_line_map.insert(20, line);
        data
    }

    fn set_local_active_profession_skills(
        state: &mut AppState,
        skills: Vec<ObservedProfessionSkill>,
    ) {
        let local_uuid = entity_id_to_uuid(3296036, EEntityType::EntChar, false, false);
        state.encounter.local_player_uuid = local_uuid;
        let entity = state
            .encounter
            .entity_by_uuid_or_insert_with(local_uuid, || Entity {
                uuid: Some(local_uuid),
                entity_type: EEntityType::EntChar,
                ..Default::default()
            });
        entity.active_profession_skills = skills;
    }

    #[test]
    fn client_skill_cast_normalizes_by_equipped_profession_slot() {
        let mut state = AppState::new();
        set_local_active_profession_skills(
            &mut state,
            vec![
                ObservedProfessionSkill {
                    skill_id: 35,
                    slot: Some(7),
                    equipped: Some(true),
                    source_kind: "profession-skill".to_string(),
                    runtime_source: "test.raw-active-skill".to_string(),
                    ..Default::default()
                },
                ObservedProfessionSkill {
                    skill_id: 1243,
                    base_skill_id: Some(1243),
                    skill_level_id: Some(124301),
                    slot: Some(7),
                    equipped: Some(true),
                    source_kind: "profession-skill".to_string(),
                    runtime_source: "test.profession-skill-map".to_string(),
                    ..Default::default()
                },
            ],
        );

        let event = ClientSkillCast {
            skill_id: SkillId::new(35).unwrap(),
            slot_id: Some(7),
            begin_time_ms: None,
            target_uuid: None,
        };

        assert_eq!(
            normalize_client_skill_lifecycle_id(&state, &event).get(),
            1243
        );
    }

    #[test]
    fn skill_lifecycle_normalization_keeps_level_table_fallback() {
        let state = AppState::new();

        assert_eq!(
            normalize_skill_lifecycle_id(&state, SkillId::new(124301).unwrap()).get(),
            1243
        );
    }

    #[test]
    fn selected_factor_slot_suppression_filters_cached_item() {
        let mut state = AppState::new();
        let item = factor_item(2001);
        let slot_key = selected_factor_item_slot_key(&item).unwrap();
        state.local_selected_factor_items.push(item);

        assert_eq!(season_cultivate_factor_counter_item_ids(&state), vec![2001]);

        state.suppressed_factor_selector_slot_keys.insert(slot_key);

        assert!(season_cultivate_factor_counter_item_ids(&state).is_empty());
    }

    #[test]
    fn factor_item_suppression_filters_active_fallback_item_ids() {
        let mut state = AppState::new();
        state.local_monitor.season_cultivate.set_templates(vec![
            FactorCounterTemplate {
                item_ids: vec![1001],
                uses_global_energy: false,
                sources: vec![CounterSource::AnyDamage {
                    increment: 1,
                    hits_required: None,
                    hit_filter: None,
                    required_type_flags: None,
                }],
                effect_slots: Vec::new(),
            },
            FactorCounterTemplate {
                item_ids: vec![2001],
                uses_global_energy: false,
                sources: Vec::new(),
                effect_slots: vec![EffectSlotConfig {
                    slot_id: 1,
                    threshold: Some(1),
                    reset_buff_id: 7001,
                    reset_source_config_id: None,
                    reset_buff_target: ResetBuffTarget::SelfPlayer,
                    on_buff_add: CounterAction::NoOp,
                    on_buff_change: CounterAction::NoOp,
                    on_buff_remove: CounterAction::NoOp,
                    freeze_duration_ms: None,
                    on_freeze_expire: CounterAction::NoOp,
                    alt_freeze: None,
                    threshold_modifier: None,
                    freeze_duration_modifier: None,
                    freeze_on_threshold: false,
                    count_threshold_procs: true,
                    count_reset_buff_procs: false,
                    reset_skill_keys: None,
                    on_reset_skill: CounterAction::NoOp,
                    dungeon_start_freeze_ms: None,
                }],
            },
        ]);
        state
            .local_monitor
            .season_cultivate
            .replace_data(season_cultivate_data_with_middle_items(vec![1001, 2001]));

        assert_eq!(
            season_cultivate_factor_counter_item_ids(&state),
            vec![1001, 2001]
        );

        state.suppressed_factor_item_ids.insert(2001);

        assert!(season_cultivate_factor_counter_item_ids(&state).is_empty());
    }

    #[test]
    fn cleared_selector_slot_disables_active_source_fallback() {
        let mut state = AppState::new();
        state.local_monitor.season_cultivate.set_templates(vec![
            FactorCounterTemplate {
                item_ids: vec![1001],
                uses_global_energy: false,
                sources: vec![CounterSource::AnyDamage {
                    increment: 51,
                    hits_required: None,
                    hit_filter: None,
                    required_type_flags: None,
                }],
                effect_slots: Vec::new(),
            },
            FactorCounterTemplate {
                item_ids: vec![2001],
                uses_global_energy: true,
                sources: Vec::new(),
                effect_slots: vec![EffectSlotConfig {
                    slot_id: 1,
                    threshold: Some(1),
                    reset_buff_id: 7001,
                    reset_source_config_id: None,
                    reset_buff_target: ResetBuffTarget::SelfPlayer,
                    on_buff_add: CounterAction::NoOp,
                    on_buff_change: CounterAction::NoOp,
                    on_buff_remove: CounterAction::NoOp,
                    freeze_duration_ms: None,
                    on_freeze_expire: CounterAction::NoOp,
                    alt_freeze: None,
                    threshold_modifier: None,
                    freeze_duration_modifier: None,
                    freeze_on_threshold: false,
                    count_threshold_procs: true,
                    count_reset_buff_procs: false,
                    reset_skill_keys: None,
                    on_reset_skill: CounterAction::NoOp,
                    dungeon_start_freeze_ms: None,
                }],
            },
        ]);
        state
            .local_monitor
            .season_cultivate
            .replace_data(season_cultivate_data_with_middle_items(vec![1001, 2001]));

        assert_eq!(
            season_cultivate_factor_counter_item_ids(&state),
            vec![1001, 2001]
        );

        state
            .suppressed_factor_selector_slot_keys
            .insert("tree|path|4".to_string());

        assert_eq!(season_cultivate_factor_counter_item_ids(&state), vec![2001]);
    }

    #[test]
    fn selected_factor_mode_does_not_borrow_active_source_item_ids() {
        let mut state = AppState::new();
        state.local_monitor.season_cultivate.set_templates(vec![
            FactorCounterTemplate {
                item_ids: vec![1001],
                uses_global_energy: false,
                sources: vec![CounterSource::AnyDamage {
                    increment: 51,
                    hits_required: None,
                    hit_filter: None,
                    required_type_flags: None,
                }],
                effect_slots: Vec::new(),
            },
            FactorCounterTemplate {
                item_ids: vec![3001],
                uses_global_energy: false,
                sources: vec![CounterSource::AnyDamage {
                    increment: 99,
                    hits_required: None,
                    hit_filter: None,
                    required_type_flags: None,
                }],
                effect_slots: Vec::new(),
            },
            FactorCounterTemplate {
                item_ids: vec![3001],
                uses_global_energy: false,
                sources: Vec::new(),
                effect_slots: vec![EffectSlotConfig {
                    slot_id: 1,
                    threshold: None,
                    reset_buff_id: 8001,
                    reset_source_config_id: None,
                    reset_buff_target: ResetBuffTarget::SelfPlayer,
                    on_buff_add: CounterAction::NoOp,
                    on_buff_change: CounterAction::NoOp,
                    on_buff_remove: CounterAction::NoOp,
                    freeze_duration_ms: None,
                    on_freeze_expire: CounterAction::NoOp,
                    alt_freeze: None,
                    threshold_modifier: None,
                    freeze_duration_modifier: None,
                    freeze_on_threshold: false,
                    count_threshold_procs: true,
                    count_reset_buff_procs: false,
                    reset_skill_keys: None,
                    on_reset_skill: CounterAction::NoOp,
                    dungeon_start_freeze_ms: None,
                }],
            },
            FactorCounterTemplate {
                item_ids: vec![2001],
                uses_global_energy: true,
                sources: Vec::new(),
                effect_slots: vec![EffectSlotConfig {
                    slot_id: 1,
                    threshold: Some(1),
                    reset_buff_id: 7001,
                    reset_source_config_id: None,
                    reset_buff_target: ResetBuffTarget::SelfPlayer,
                    on_buff_add: CounterAction::NoOp,
                    on_buff_change: CounterAction::NoOp,
                    on_buff_remove: CounterAction::NoOp,
                    freeze_duration_ms: None,
                    on_freeze_expire: CounterAction::NoOp,
                    alt_freeze: None,
                    threshold_modifier: None,
                    freeze_duration_modifier: None,
                    freeze_on_threshold: false,
                    count_threshold_procs: true,
                    count_reset_buff_procs: false,
                    reset_skill_keys: None,
                    on_reset_skill: CounterAction::NoOp,
                    dungeon_start_freeze_ms: None,
                }],
            },
        ]);
        state
            .local_monitor
            .season_cultivate
            .replace_data(season_cultivate_data_with_middle_items(vec![1001, 2001]));
        state.local_selected_factor_items.push(factor_item(3001));
        state.selected_factor_selection_observed = true;

        let selected_item_ids = season_cultivate_factor_counter_item_ids(&state);
        assert_eq!(selected_item_ids, vec![2001, 3001]);

        let rules = state
            .local_monitor
            .season_cultivate
            .build_factor_counter_rules_for_selected_items(&selected_item_ids, true);
        let global_rule = rules
            .iter()
            .find(|rule| rule.rule_id == crate::live::season_cultivate::factor_rule_id(2001))
            .expect("global energy rule exists");
        assert_eq!(global_rule.sources.len(), 1);
        assert!(matches!(
            global_rule.sources[0],
            CounterSource::AnyDamage { increment: 99, .. }
        ));
    }

    #[test]
    fn factor_gate_signature_tracks_suppressed_slots_and_items() {
        let mut state = AppState::new();

        assert_eq!(
            selected_factor_rule_gate_signature(&state),
            (Vec::<i32>::new(), Vec::<String>::new())
        );

        state.suppressed_factor_item_ids.insert(2001);
        state
            .suppressed_factor_selector_slot_keys
            .insert("tree|path|4".to_string());

        assert_eq!(
            selected_factor_rule_gate_signature(&state),
            (vec![2001], vec!["tree|path|4".to_string()])
        );
    }

    #[test]
    fn modifier_windows_match_target_uuid_before_uid_fallback() {
        let shared_target_uid = 77_777;
        let target_a_uuid =
            entity_id_to_uuid(shared_target_uid, EEntityType::EntMonster, false, false);
        let target_b_uuid =
            entity_id_to_uuid(shared_target_uid, EEntityType::EntMonster, true, false);
        let attacker_uid = 88_888;
        let attacker_uuid = entity_id_to_uuid(attacker_uid, EEntityType::EntChar, false, false);

        let window_a = ObservedModifierWindow {
            base_id: 101,
            host_uid: shared_target_uid,
            host_uuid: Some(target_a_uuid),
            start_time_ms: 0,
            end_time_ms: Some(1000),
            ..Default::default()
        };
        let window_b = ObservedModifierWindow {
            base_id: 202,
            host_uid: shared_target_uid,
            host_uuid: Some(target_b_uuid),
            start_time_ms: 0,
            end_time_ms: Some(1000),
            ..Default::default()
        };

        let mut windows_by_host_identity =
            HashMap::<CombatTimelineIdentityKey, Vec<ObservedModifierWindow>>::new();
        let mut windows_by_host_uid = HashMap::<i64, Vec<ObservedModifierWindow>>::new();
        for window in [window_a, window_b] {
            windows_by_host_identity
                .entry(modifier_host_identity(window.host_uid, window.host_uuid))
                .or_default()
                .push(window.clone());
            windows_by_host_uid
                .entry(window.host_uid)
                .or_default()
                .push(window);
        }

        let hit = ObservedDamageHit {
            timestamp_ms: 100,
            skill_key: 1,
            damage_id: 1,
            target_uid: shared_target_uid,
            target_uuid: Some(target_b_uuid),
            attacker_uid,
            attacker_uuid: Some(attacker_uuid),
            value: 100,
            effective_value: 100,
            ..Default::default()
        };

        let buckets = build_modifier_hit_buckets(
            attacker_uid,
            Some(attacker_uuid),
            &[hit],
            &windows_by_host_identity,
            &windows_by_host_uid,
        );

        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].modifier_base_id, 202);
        assert_eq!(buckets[0].modifier_host_uuid, Some(target_b_uuid));
    }
}
