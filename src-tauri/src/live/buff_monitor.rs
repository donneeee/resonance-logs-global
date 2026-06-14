use crate::database::now_ms;
use crate::live::commands_models::BuffUpdateState;
use crate::live::entity_id::uid_from_uuid;
use blueprotobuf_lib::blueprotobuf::{
    BuffChange, BuffEffectSync, BuffInfo, EBuffEffectLogicPbType, EBuffEventType,
};
use prost::Message;
use std::collections::{HashMap, HashSet};

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
    pub host_uid: i64,
    pub source_uid: i64,
    pub fight_source_type: Option<i32>,
    pub source_config_id: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BuffChangeType {
    Added,
    Changed,
    Removed,
}

#[derive(Debug, Clone)]
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

    pub(crate) fn process_buff_effect_bytes(
        &mut self,
        raw_bytes: &[u8],
        server_clock_offset: &mut i64,
        local_player_uid: i64,
        local_player_uuid: i64,
    ) -> BuffProcessResult {
        self.process_buff_effect_bytes_with_self_source_filter(
            raw_bytes,
            server_clock_offset,
            |_, source_uid, source_uuid, _, _| {
                (local_player_uuid != 0 && source_uuid == Some(local_player_uuid))
                    || (local_player_uid > 0 && source_uid == local_player_uid)
            },
        )
    }

    pub(crate) fn process_buff_effect_bytes_with_self_source_filter<F>(
        &mut self,
        raw_bytes: &[u8],
        server_clock_offset: &mut i64,
        mut is_self_source: F,
    ) -> BuffProcessResult
    where
        F: FnMut(i32, i64, Option<i64>, Option<i32>, Option<i32>) -> bool,
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

            for logic_effect in buff_effect.logic_effect {
                let Some(effect_type) = logic_effect.effect_type else {
                    continue;
                };
                let Some(raw) = logic_effect.raw_data else {
                    continue;
                };

                if effect_type == EBuffEffectLogicPbType::BuffEffectAddBuff as i32 {
                    if let Ok(buff_info) = BuffInfo::decode(raw.as_slice()) {
                        let Some(base_id) = buff_info.base_id else {
                            continue;
                        };
                        let host_uuid = buff_info.host_uuid.filter(|uuid| *uuid != 0);
                        let source_uuid = buff_info.fire_uuid.filter(|uuid| *uuid != 0);
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
                                host_uid,
                                source_uid,
                                fight_source_type,
                                source_config_id,
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
                    buff.source_uid,
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
                    host_uid: buff.host_uid,
                    source_uid: buff.source_uid,
                    source_config_id: buff.source_config_id,
                })
                .collect(),
        )
    }
}

#[derive(Debug, Default)]
pub struct BossBuffMonitors {
    pub monitors: HashMap<i64, BuffMonitor>,
    pub monitored_buff_ids: HashSet<i32>,
    pub self_applied_buff_ids: HashSet<i32>,
    pub monitor_all_buff: bool,
}

impl BossBuffMonitors {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn clear(&mut self) {
        self.monitors.clear();
    }

    pub(crate) fn set_config(&mut self, global_ids: Vec<i32>, self_applied_ids: Vec<i32>) {
        self.set_config_with_monitor_all(global_ids, self_applied_ids, false);
    }

    pub(crate) fn set_config_with_monitor_all(
        &mut self,
        global_ids: Vec<i32>,
        self_applied_ids: Vec<i32>,
        monitor_all: bool,
    ) {
        self.monitored_buff_ids = global_ids.into_iter().collect();
        self.self_applied_buff_ids = self_applied_ids.into_iter().collect();
        self.monitor_all_buff = monitor_all;

        for monitor in self.monitors.values_mut() {
            monitor.monitored_buff_ids = self.monitored_buff_ids.clone();
            monitor.self_applied_buff_ids = self.self_applied_buff_ids.clone();
            monitor.monitor_all_buff = self.monitor_all_buff;
        }
    }

    pub(crate) fn monitor_for(&mut self, boss_uid: i64) -> &mut BuffMonitor {
        let monitored_buff_ids = self.monitored_buff_ids.clone();
        let self_applied_buff_ids = self.self_applied_buff_ids.clone();
        let monitor_all_buff = self.monitor_all_buff;

        self.monitors.entry(boss_uid).or_insert_with(|| {
            let mut monitor = BuffMonitor::new();
            monitor.monitored_buff_ids = monitored_buff_ids;
            monitor.self_applied_buff_ids = self_applied_buff_ids;
            monitor.monitor_all_buff = monitor_all_buff;
            monitor
        })
    }

    pub(crate) fn build_all_buff_snapshots(
        &self,
        server_clock_offset: i64,
    ) -> HashMap<i64, Vec<BuffUpdateState>> {
        self.build_all_buff_snapshots_with_self_source_filter(server_clock_offset, |_, _| true)
    }

    pub(crate) fn build_all_buff_snapshots_with_self_source_filter<F>(
        &self,
        server_clock_offset: i64,
        mut is_self_source: F,
    ) -> HashMap<i64, Vec<BuffUpdateState>>
    where
        F: FnMut(i64, &ActiveBuff) -> bool,
    {
        let mut snapshots = HashMap::with_capacity(self.monitors.len());

        for (&boss_uid, monitor) in &self.monitors {
            let Some(buffs) = monitor
                .build_update_payload_with_self_source_filter(server_clock_offset, |buff| {
                    is_self_source(boss_uid, buff)
                })
            else {
                continue;
            };
            if !buffs.is_empty() {
                snapshots.insert(boss_uid, buffs);
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
            host_uid: 10,
            source_uid,
            fight_source_type: None,
            source_config_id: None,
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
