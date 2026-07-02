use crate::database::now_ms;
use crate::live::commands_models::BuffUpdateState;
use crate::live::entity_id::{EntityUuid, entity_uuid_string, uid_from_uuid};
use blueprotobuf_lib::blueprotobuf::{
    BuffChange, BuffEffectSync, BuffInfo, BuffInfoSync, EBuffEffectLogicPbType, EBuffEventType,
};
use prost::Message;
use std::collections::{HashMap, HashSet};

#[derive(Clone, PartialEq, Message)]
struct BuffEffectLogicPlayEffect {
    #[prost(int32, optional, tag = "1")]
    effect_id: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct ActiveBuff {
    pub base_id: i32,
    pub buff_level: Option<i32>,
    pub part_id: Option<i32>,
    pub count: Option<i32>,
    pub layer: i32,
    pub duration: i32,
    pub create_time: i64,
    pub received_time_ms: i64,
    pub host_uuid: Option<i64>,
    pub source_uuid: Option<i64>,
    pub fire_uuid: Option<i64>,
    pub host_uid: i64,
    pub source_uid: i64,
    pub fight_source_type: Option<i32>,
    pub source_config_id: Option<i32>,
    pub effect_ids: Vec<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuffTargetKind {
    LocalPlayer,
    Monster,
    Teammate,
}

#[derive(Debug, Clone, Default)]
pub struct BuffWatchProfile {
    pub enabled: bool,
    pub any_source_ids: HashSet<i32>,
    pub local_player_source_ids: HashSet<i32>,
    pub target_self_source_ids: HashSet<i32>,
    pub monitor_all: bool,
    pub monitor_all_local_source: bool,
}

impl BuffWatchProfile {
    pub(crate) fn from_any_source_ids(ids: Vec<i32>, monitor_all: bool) -> Self {
        let enabled = monitor_all || !ids.is_empty();
        Self {
            enabled,
            any_source_ids: ids.into_iter().collect(),
            local_player_source_ids: HashSet::new(),
            target_self_source_ids: HashSet::new(),
            monitor_all,
            monitor_all_local_source: false,
        }
    }

    pub(crate) fn from_any_and_local_player_source_ids(
        any_source_ids: Vec<i32>,
        local_player_source_ids: Vec<i32>,
        monitor_all_local_source: bool,
    ) -> Self {
        let enabled = monitor_all_local_source
            || !any_source_ids.is_empty()
            || !local_player_source_ids.is_empty();
        Self {
            enabled,
            any_source_ids: any_source_ids.into_iter().collect(),
            local_player_source_ids: local_player_source_ids.into_iter().collect(),
            target_self_source_ids: HashSet::new(),
            monitor_all: false,
            monitor_all_local_source,
        }
    }

    pub(crate) fn from_all_sources(
        any_source_ids: Vec<i32>,
        local_player_source_ids: Vec<i32>,
        target_self_source_ids: Vec<i32>,
        monitor_all: bool,
    ) -> Self {
        let enabled = monitor_all
            || !any_source_ids.is_empty()
            || !local_player_source_ids.is_empty()
            || !target_self_source_ids.is_empty();
        Self {
            enabled,
            any_source_ids: any_source_ids.into_iter().collect(),
            local_player_source_ids: local_player_source_ids.into_iter().collect(),
            target_self_source_ids: target_self_source_ids.into_iter().collect(),
            monitor_all,
            monitor_all_local_source: false,
        }
    }

    pub(crate) fn matches_with_source_filter<F>(
        &self,
        target_uuid: EntityUuid,
        buff: &ActiveBuff,
        mut is_local_source: F,
    ) -> bool
    where
        F: FnMut(&ActiveBuff) -> bool,
    {
        if !self.enabled {
            return false;
        }
        if self.monitor_all || self.any_source_ids.contains(&buff.base_id) {
            return true;
        }
        if self.monitor_all_local_source && is_local_source(buff) {
            return true;
        }
        if self.local_player_source_ids.contains(&buff.base_id) && is_local_source(buff) {
            return true;
        }
        self.target_self_source_ids.contains(&buff.base_id) && buff.source_uuid == Some(target_uuid)
    }
}

#[derive(Debug, Clone, Default)]
pub struct EntityBuffMonitorConfig {
    pub local_player: BuffWatchProfile,
    pub monster: BuffWatchProfile,
    pub teammate: BuffWatchProfile,
}

impl EntityBuffMonitorConfig {
    pub(crate) fn profile_for(&self, kind: BuffTargetKind) -> &BuffWatchProfile {
        match kind {
            BuffTargetKind::LocalPlayer => &self.local_player,
            BuffTargetKind::Monster => &self.monster,
            BuffTargetKind::Teammate => &self.teammate,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub enum BuffChangeType {
    Added,
    Changed,
    Removed,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BuffChangeEvent {
    pub base_id: i32,
    pub buff_uuid: i32,
    pub change_type: BuffChangeType,
    /// Local packet receive time used by counter tick logic.
    pub create_time_ms: Option<i64>,
    /// Local packet receive time for this specific add/change/remove event.
    pub event_time_ms: i64,
    pub duration_ms: Option<i32>,
    pub buff_level: Option<i32>,
    pub part_id: Option<i32>,
    pub count: Option<i32>,
    pub fight_source_type: Option<i32>,
    pub source_config_id: Option<i32>,
    pub layer: i32,
    pub previous_layer: Option<i32>,
    pub current_layer: Option<i32>,
    pub host_uuid: Option<i64>,
    pub source_uuid: Option<i64>,
    pub host_uid: i64,
    pub source_uid: i64,
}

#[derive(Debug, Default)]
pub struct BuffProcessResult {
    pub update_payload: Option<Vec<BuffUpdateState>>,
    pub changes: Vec<BuffChangeEvent>,
}

#[derive(Debug, Default)]
pub struct BuffMonitor {
    /// Monitored buff base IDs.
    pub monitored_buff_ids: HashSet<i32>,
    /// Self-applied buff base IDs.
    pub self_applied_buff_ids: HashSet<i32>,
    /// Active buffs keyed by buff UUID.
    pub active_buffs: HashMap<i32, ActiveBuff>,
    /// Monitor all buffs.
    pub monitor_all_buff: bool,
}

impl BuffMonitor {
    pub(crate) fn new() -> Self {
        Self {
            monitored_buff_ids: HashSet::new(),
            self_applied_buff_ids: HashSet::new(),
            active_buffs: HashMap::new(),
            monitor_all_buff: false,
        }
    }

    pub(crate) fn apply_buff_info_snapshot(&mut self, buff_info_sync: &BuffInfoSync) -> usize {
        let now = now_ms();
        let mut applied = 0;

        for buff_info in &buff_info_sync.buff_infos {
            let Some(buff_uuid) = buff_info.buff_uuid else {
                continue;
            };
            let Some(base_id) = buff_info.base_id else {
                continue;
            };
            let host_uuid = buff_info.host_uuid.filter(|uuid| *uuid != 0);
            let fire_uuid = buff_info.fire_uuid.filter(|uuid| *uuid != 0);
            let source_uuid = fire_uuid;
            let host_uid = host_uuid.map_or(0, uid_from_uuid);
            let source_uid = source_uuid.map_or(0, uid_from_uuid);
            let source_config_id = buff_info
                .fight_source_info
                .as_ref()
                .and_then(|info| info.source_config_id);
            let fight_source_type = buff_info
                .fight_source_info
                .as_ref()
                .and_then(|info| info.fight_source_type);

            self.active_buffs.insert(
                buff_uuid,
                ActiveBuff {
                    base_id,
                    buff_level: buff_info.level,
                    part_id: buff_info.part_id,
                    count: buff_info.count,
                    layer: buff_info.layer.unwrap_or(1),
                    duration: buff_info.duration.unwrap_or(0),
                    create_time: buff_info.create_time.unwrap_or(now),
                    received_time_ms: now,
                    host_uuid,
                    source_uuid,
                    fire_uuid,
                    host_uid,
                    source_uid,
                    fight_source_type,
                    source_config_id,
                    effect_ids: Vec::new(),
                },
            );
            applied += 1;
        }

        applied
    }

    pub(crate) fn process_buff_effect_bytes(
        &mut self,
        raw_bytes: &[u8],
        server_clock_offset: &mut i64,
        local_player_uuid: i64,
    ) -> BuffProcessResult {
        self.process_buff_effect_bytes_with_self_source_filter(
            raw_bytes,
            server_clock_offset,
            |_, source_uuid, _, _| local_player_uuid != 0 && source_uuid == Some(local_player_uuid),
        )
    }

    pub(crate) fn process_buff_effect_bytes_with_self_source_filter<F>(
        &mut self,
        raw_bytes: &[u8],
        server_clock_offset: &mut i64,
        mut is_self_source: F,
    ) -> BuffProcessResult
    where
        F: FnMut(i32, Option<i64>, Option<i32>, Option<i32>) -> bool,
    {
        let mut changes = Vec::new();
        let Ok(buff_effect_sync) = BuffEffectSync::decode(raw_bytes) else {
            return BuffProcessResult::default();
        };
        let now = now_ms();

        for buff_effect in buff_effect_sync.buff_effects {
            let buff_uuid = match buff_effect.buff_uuid {
                Some(id) => id,
                None => continue,
            };

            // CN's DBM rules use PlayEffect ids to distinguish several
            // mechanic displays that share buff ids. Store the last wire list
            // for this buff UUID; Add/Change processing below remains separate.
            let mut play_effect_ids: Vec<i32> = Vec::new();

            for logic_effect in buff_effect.logic_effect {
                let effect_type = logic_effect
                    .effect_type
                    .unwrap_or(EBuffEffectLogicPbType::PlayEffect as i32);

                if effect_type == EBuffEffectLogicPbType::PlayEffect as i32 {
                    let id = logic_effect
                        .raw_data
                        .as_ref()
                        .and_then(|raw| BuffEffectLogicPlayEffect::decode(raw.as_slice()).ok())
                        .and_then(|effect| effect.effect_id)
                        .unwrap_or(0);
                    play_effect_ids.push(id);
                    continue;
                }

                let Some(raw) = logic_effect.raw_data else {
                    continue;
                };

                if effect_type == EBuffEffectLogicPbType::BuffEffectAddBuff as i32 {
                    if let Ok(buff_info) = BuffInfo::decode(raw.as_slice()) {
                        let Some(base_id) = buff_info.base_id else {
                            continue;
                        };
                        let host_uuid = buff_info.host_uuid.filter(|uuid| *uuid != 0);
                        let fire_uuid = buff_info.fire_uuid.filter(|uuid| *uuid != 0);
                        let source_uuid = fire_uuid;
                        let host_uid = host_uuid.map_or(0, uid_from_uuid);
                        let source_uid = source_uuid.map_or(0, uid_from_uuid);
                        let source_config_id = buff_info
                            .fight_source_info
                            .as_ref()
                            .and_then(|info| info.source_config_id);
                        let fight_source_type = buff_info
                            .fight_source_info
                            .as_ref()
                            .and_then(|info| info.fight_source_type);
                        let layer = buff_info.layer.unwrap_or(1);
                        let duration = buff_info.duration.unwrap_or(0);
                        let create_time = buff_info.create_time.unwrap_or(now);
                        if buff_info.create_time.is_some() {
                            *server_clock_offset = now - create_time;
                        }

                        self.active_buffs.insert(
                            buff_uuid,
                            ActiveBuff {
                                base_id,
                                buff_level: buff_info.level,
                                part_id: buff_info.part_id,
                                count: buff_info.count,
                                layer,
                                duration,
                                create_time,
                                received_time_ms: now,
                                host_uuid,
                                source_uuid,
                                fire_uuid,
                                host_uid,
                                source_uid,
                                fight_source_type,
                                source_config_id,
                                effect_ids: Vec::new(),
                            },
                        );
                        changes.push(BuffChangeEvent {
                            base_id,
                            buff_uuid,
                            change_type: BuffChangeType::Added,
                            create_time_ms: Some(now),
                            event_time_ms: now,
                            duration_ms: Some(duration),
                            buff_level: buff_info.level,
                            part_id: buff_info.part_id,
                            count: buff_info.count,
                            fight_source_type,
                            source_config_id,
                            layer,
                            previous_layer: None,
                            current_layer: Some(layer),
                            host_uuid,
                            source_uuid,
                            host_uid,
                            source_uid,
                        });
                    }
                } else if effect_type == EBuffEffectLogicPbType::BuffEffectBuffChange as i32 {
                    if let Ok(change_info) = BuffChange::decode(raw.as_slice()) {
                        if let Some(entry) = self.active_buffs.get_mut(&buff_uuid) {
                            let base_id = entry.base_id;
                            let source_config_id = entry.source_config_id;
                            let previous_layer = change_info.layer.map(|_| entry.layer);
                            let current_layer = change_info.layer;
                            if let Some(layer) = current_layer {
                                entry.layer = layer;
                            }
                            if let Some(duration) = change_info.duration {
                                entry.duration = duration;
                            }
                            if let Some(create_time) = change_info.create_time {
                                entry.create_time = create_time;
                            }
                            changes.push(BuffChangeEvent {
                                base_id,
                                buff_uuid,
                                change_type: BuffChangeType::Changed,
                                create_time_ms: Some(entry.received_time_ms),
                                event_time_ms: now,
                                duration_ms: Some(entry.duration),
                                buff_level: entry.buff_level,
                                part_id: entry.part_id,
                                count: entry.count,
                                fight_source_type: entry.fight_source_type,
                                source_config_id,
                                layer: entry.layer,
                                previous_layer,
                                current_layer,
                                host_uuid: entry.host_uuid,
                                source_uuid: entry.source_uuid,
                                host_uid: entry.host_uid,
                                source_uid: entry.source_uid,
                            });
                        }
                    }
                }
            }

            if !play_effect_ids.is_empty()
                && let Some(entry) = self.active_buffs.get_mut(&buff_uuid)
            {
                entry.effect_ids = play_effect_ids;
            }

            if buff_effect.r#type == Some(EBuffEventType::BuffEventRemove as i32) {
                let removed_buff = self.active_buffs.remove(&buff_uuid);
                if let Some(removed_buff) = removed_buff {
                    changes.push(BuffChangeEvent {
                        base_id: removed_buff.base_id,
                        buff_uuid,
                        change_type: BuffChangeType::Removed,
                        create_time_ms: Some(removed_buff.received_time_ms),
                        event_time_ms: now,
                        duration_ms: Some(removed_buff.duration),
                        buff_level: removed_buff.buff_level,
                        part_id: removed_buff.part_id,
                        count: removed_buff.count,
                        fight_source_type: removed_buff.fight_source_type,
                        source_config_id: removed_buff.source_config_id,
                        layer: removed_buff.layer,
                        previous_layer: Some(removed_buff.layer),
                        current_layer: None,
                        host_uuid: removed_buff.host_uuid,
                        source_uuid: removed_buff.source_uuid,
                        host_uid: removed_buff.host_uid,
                        source_uid: removed_buff.source_uid,
                    });
                }
            }
        }

        let update_payload =
            self.build_update_payload_with_self_source_filter(*server_clock_offset, |buff| {
                is_self_source(
                    buff.base_id,
                    buff.source_uuid,
                    buff.source_config_id,
                    buff.fight_source_type,
                )
            });
        BuffProcessResult {
            update_payload,
            changes,
        }
    }

    pub(crate) fn build_update_payload(
        &self,
        server_clock_offset: i64,
    ) -> Option<Vec<BuffUpdateState>> {
        self.build_update_payload_with_self_source_filter(server_clock_offset, |_| true)
    }

    pub(crate) fn build_update_payload_for_profile<F>(
        &self,
        target_uuid: EntityUuid,
        profile: &BuffWatchProfile,
        server_clock_offset: i64,
        mut is_local_source: F,
    ) -> Vec<BuffUpdateState>
    where
        F: FnMut(&ActiveBuff) -> bool,
    {
        if !profile.enabled {
            return Vec::new();
        }

        self.active_buffs
            .values()
            .filter(|buff| {
                profile.matches_with_source_filter(target_uuid, buff, |buff| is_local_source(buff))
            })
            .map(|buff| BuffUpdateState {
                base_id: buff.base_id,
                layer: buff.layer,
                duration_ms: buff.duration,
                create_time_ms: buff.create_time.saturating_add(server_clock_offset),
                host_key: buff.host_uuid.map(entity_uuid_string),
                source_key: buff.source_uuid.map(entity_uuid_string),
                host_uid: buff.host_uid,
                source_uid: buff.source_uid,
                source_config_id: buff.source_config_id,
            })
            .collect()
    }

    pub(crate) fn build_update_payload_with_self_source_filter<F>(
        &self,
        server_clock_offset: i64,
        mut is_self_source: F,
    ) -> Option<Vec<BuffUpdateState>>
    where
        F: FnMut(&ActiveBuff) -> bool,
    {
        if self.monitored_buff_ids.is_empty()
            && self.self_applied_buff_ids.is_empty()
            && !self.monitor_all_buff
        {
            return None;
        }

        Some(
            self.active_buffs
                .values()
                .filter(|buff| {
                    self.monitor_all_buff
                        || self.monitored_buff_ids.contains(&buff.base_id)
                        || (self.self_applied_buff_ids.contains(&buff.base_id)
                            && is_self_source(buff))
                })
                .map(|buff| BuffUpdateState {
                    base_id: buff.base_id,
                    layer: buff.layer,
                    duration_ms: buff.duration,
                    create_time_ms: buff.create_time.saturating_add(server_clock_offset),
                    host_key: buff.host_uuid.map(entity_uuid_string),
                    source_key: buff.source_uuid.map(entity_uuid_string),
                    host_uid: buff.host_uid,
                    source_uid: buff.source_uid,
                    source_config_id: buff.source_config_id,
                })
                .collect(),
        )
    }
}

#[derive(Debug, Default)]
pub struct EntityBuffMonitors {
    pub monitors: HashMap<i64, BuffMonitor>,
}

impl EntityBuffMonitors {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn clear(&mut self) {
        self.monitors.clear();
    }

    pub(crate) fn remove(&mut self, entity_uuid: i64) {
        self.monitors.remove(&entity_uuid);
    }

    pub(crate) fn monitor_for(&mut self, entity_uuid: i64) -> &mut BuffMonitor {
        self.monitors
            .entry(entity_uuid)
            .or_insert_with(BuffMonitor::new)
    }

    pub(crate) fn process_buff_effect_bytes(
        &mut self,
        entity_uuid: i64,
        raw_bytes: &[u8],
        server_clock_offset: &mut i64,
    ) -> BuffProcessResult {
        self.monitor_for(entity_uuid)
            .process_buff_effect_bytes_with_self_source_filter(
                raw_bytes,
                server_clock_offset,
                |_, _, _, _| true,
            )
    }

    pub(crate) fn build_snapshots_for_kind<F, G>(
        &self,
        kind: BuffTargetKind,
        config: &EntityBuffMonitorConfig,
        local_player_uuid: EntityUuid,
        server_clock_offset: i64,
        mut classify: F,
        mut is_local_source: G,
    ) -> HashMap<i64, Vec<BuffUpdateState>>
    where
        F: FnMut(EntityUuid) -> Option<BuffTargetKind>,
        G: FnMut(EntityUuid, &ActiveBuff) -> bool,
    {
        let profile = config.profile_for(kind);
        if !profile.enabled {
            return HashMap::new();
        }

        let mut snapshots = HashMap::with_capacity(self.monitors.len());
        for (&entity_uuid, monitor) in &self.monitors {
            if classify(entity_uuid) != Some(kind) {
                continue;
            }

            let buffs = monitor.build_update_payload_for_profile(
                entity_uuid,
                profile,
                server_clock_offset,
                |buff| {
                    if local_player_uuid != 0 && buff.source_uuid == Some(local_player_uuid) {
                        return true;
                    }
                    is_local_source(entity_uuid, buff)
                },
            );
            if !buffs.is_empty() {
                snapshots.insert(entity_uuid, buffs);
            }
        }

        snapshots
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_buff(base_id: i32, source_uid: i64) -> ActiveBuff {
        ActiveBuff {
            base_id,
            buff_level: None,
            part_id: None,
            count: None,
            layer: 1,
            duration: 0,
            create_time: 1_000,
            received_time_ms: 1_000,
            host_uuid: Some(10),
            source_uuid: None,
            fire_uuid: None,
            host_uid: 10,
            source_uid,
            fight_source_type: None,
            source_config_id: None,
            effect_ids: Vec::new(),
        }
    }

    #[test]
    fn self_applied_payload_is_filtered_at_snapshot_time() {
        let mut monitor = BuffMonitor::new();
        monitor.self_applied_buff_ids.insert(100);
        monitor.active_buffs.insert(1, active_buff(100, 42));

        let hidden = monitor
            .build_update_payload_with_self_source_filter(0, |_| false)
            .expect("self-applied monitor should build a payload");
        assert!(hidden.is_empty());

        let visible = monitor
            .build_update_payload_with_self_source_filter(0, |_| true)
            .expect("self-applied monitor should build a payload");
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].base_id, 100);
    }

    #[test]
    fn global_payload_does_not_depend_on_self_source_filter() {
        let mut monitor = BuffMonitor::new();
        monitor.monitored_buff_ids.insert(100);
        monitor.active_buffs.insert(1, active_buff(100, 42));

        let visible = monitor
            .build_update_payload_with_self_source_filter(0, |_| false)
            .expect("global monitor should build a payload");
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].base_id, 100);
    }
}
