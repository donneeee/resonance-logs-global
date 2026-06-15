use crate::live::commands_models::{HateEntry, PanelAttrState, ShieldDetailEntry};
use crate::live::opcodes_models::{AttrType, AttrValue, Entity, PositionAttr, attr_type};
use blueprotobuf_lib::blueprotobuf::EActorState;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct DeathEvent {
    pub entity_uuid: i64,
    pub timestamp_ms: u128,
}

#[derive(Debug, Default)]
pub struct EntityAttrStore {
    attrs: HashMap<i64, HashMap<AttrType, AttrValue>>,
    hate_lists: HashMap<i64, Vec<HateEntry>>,
    fight_resource_ids: HashMap<i64, Vec<i32>>,
    temp_attrs: HashMap<i32, i32>,
    local_player_uid: i64,
    local_player_uuid: i64,
    panel_attr_values: HashMap<i32, i32>,
    cd_dirty: bool,
    panel_dirty_attrs: Vec<PanelAttrState>,
    shield_detail_entries: Vec<ShieldDetailEntry>,
    shield_detail_dirty: bool,
    death_events: Vec<DeathEvent>,
}

#[derive(Debug, Default)]
pub struct AttrChanges {
    pub cd_dirty: bool,
    pub panel_dirty_attrs: Vec<PanelAttrState>,
    pub shield_detail_dirty: bool,
    pub shield_detail_entries: Vec<ShieldDetailEntry>,
    pub death_events: Vec<DeathEvent>,
}

impl EntityAttrStore {
    pub fn with_capacity(attr_entries: usize) -> Self {
        Self {
            attrs: HashMap::with_capacity(attr_entries),
            hate_lists: HashMap::new(),
            fight_resource_ids: HashMap::new(),
            temp_attrs: HashMap::new(),
            local_player_uid: 0,
            local_player_uuid: 0,
            panel_attr_values: HashMap::new(),
            cd_dirty: false,
            panel_dirty_attrs: Vec::with_capacity(8),
            shield_detail_entries: Vec::new(),
            shield_detail_dirty: false,
            death_events: Vec::new(),
        }
    }

    pub fn set_local_uid(&mut self, uid: i64) {
        self.local_player_uid = uid;
        self.sync_local_aliases();
    }

    pub fn local_player_uid(&self) -> i64 {
        self.local_player_uid
    }

    pub fn set_local_uuid(&mut self, uuid: i64) {
        self.local_player_uuid = uuid;
        self.sync_local_aliases();
    }

    pub fn local_player_uuid(&self) -> i64 {
        self.local_player_uuid
    }

    fn local_alias_for(&self, id: i64) -> Option<i64> {
        if self.local_player_uid <= 0 || self.local_player_uuid <= 0 {
            return None;
        }
        if id == self.local_player_uid && id != self.local_player_uuid {
            Some(self.local_player_uuid)
        } else if id == self.local_player_uuid && id != self.local_player_uid {
            Some(self.local_player_uid)
        } else {
            None
        }
    }

    fn sync_local_aliases(&mut self) {
        let uid = self.local_player_uid;
        let uuid = self.local_player_uuid;
        if uid <= 0 || uuid <= 0 || uid == uuid {
            return;
        }

        if let Some(uid_attrs) = self.attrs.get(&uid).cloned() {
            let uuid_attrs = self.attrs.entry(uuid).or_default();
            for (attr_type, value) in uid_attrs {
                uuid_attrs.entry(attr_type).or_insert(value);
            }
        }
        if let Some(uuid_attrs) = self.attrs.get(&uuid).cloned() {
            let uid_attrs = self.attrs.entry(uid).or_default();
            for (attr_type, value) in uuid_attrs {
                uid_attrs.entry(attr_type).or_insert(value);
            }
        }

        if let Some(ids) = self.fight_resource_ids.get(&uid).cloned() {
            self.fight_resource_ids.entry(uuid).or_insert(ids);
        }
        if let Some(ids) = self.fight_resource_ids.get(&uuid).cloned() {
            self.fight_resource_ids.entry(uid).or_insert(ids);
        }
    }

    fn local_attr_key(&self) -> i64 {
        if self.local_player_uuid > 0 && self.attrs.contains_key(&self.local_player_uuid) {
            self.local_player_uuid
        } else {
            self.local_player_uid
        }
    }

    pub fn set_attr(&mut self, uid: i64, attr_type: AttrType, value: AttrValue) -> bool {
        let was_dead = matches!(attr_type, AttrType::ActorState) && self.is_dead(uid);
        let changed = self
            .attrs
            .entry(uid)
            .or_default()
            .get(&attr_type)
            .is_none_or(|prev| *prev != value);
        if !changed {
            return false;
        }
        self.attrs
            .entry(uid)
            .or_default()
            .insert(attr_type, value.clone());
        if let Some(alias) = self.local_alias_for(uid) {
            self.attrs
                .entry(alias)
                .or_default()
                .insert(attr_type, value);
        }
        let is_local_player = uid == self.local_player_uid || uid == self.local_player_uuid;
        if is_local_player && attr_affects_skill_cd(attr_type) {
            self.cd_dirty = true;
        }
        if is_local_player && matches!(attr_type, AttrType::CurrentHp | AttrType::MaxHp) {
            self.shield_detail_dirty = true;
        }
        if matches!(attr_type, AttrType::ActorState) {
            let is_dead_now = self.is_dead(uid);
            if !was_dead && is_dead_now {
                let timestamp_ms = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis();
                self.death_events.push(DeathEvent {
                    entity_uuid: uid,
                    timestamp_ms,
                });
            }
        }
        true
    }

    pub fn set_panel_attr(&mut self, attr_id: i32, value: i32) -> bool {
        let prev = self.panel_attr_values.insert(attr_id, value);
        if prev == Some(value) {
            return false;
        }
        if panel_attr_affects_skill_cd(attr_id) {
            self.cd_dirty = true;
        }
        self.panel_dirty_attrs
            .push(PanelAttrState { attr_id, value });
        true
    }

    pub fn panel_attr_value(&self, attr_id: i32) -> Option<i32> {
        self.panel_attr_values.get(&attr_id).copied()
    }

    pub fn set_fight_resource_ids(&mut self, uid: i64, ids: Vec<i32>) -> bool {
        let changed = self
            .fight_resource_ids
            .get(&uid)
            .is_none_or(|prev| prev.as_slice() != ids.as_slice());
        if !changed {
            return false;
        }
        self.fight_resource_ids.insert(uid, ids.clone());
        if let Some(alias) = self.local_alias_for(uid) {
            self.fight_resource_ids.insert(alias, ids);
        }
        true
    }

    pub fn fight_resource_ids(&self, uid: i64) -> &[i32] {
        self.fight_resource_ids
            .get(&uid)
            .or_else(|| {
                self.local_alias_for(uid)
                    .and_then(|alias| self.fight_resource_ids.get(&alias))
            })
            .map_or(&[], std::vec::Vec::as_slice)
    }

    pub fn set_temp_attr(&mut self, attr_id: i32, value: i32) -> bool {
        let prev = self.temp_attrs.insert(attr_id, value);
        if prev == Some(value) {
            return false;
        }
        self.cd_dirty = true;
        true
    }

    pub fn temp_attr_value(&self, attr_id: i32) -> Option<i32> {
        self.temp_attrs.get(&attr_id).copied()
    }

    pub fn attr(&self, uid: i64, attr_type: AttrType) -> Option<&AttrValue> {
        self.attrs
            .get(&uid)
            .and_then(|entity_attrs| entity_attrs.get(&attr_type))
            .or_else(|| {
                self.local_alias_for(uid).and_then(|alias| {
                    self.attrs
                        .get(&alias)
                        .and_then(|entity_attrs| entity_attrs.get(&attr_type))
                })
            })
    }

    pub fn attr_int_by_id(&self, uid: i64, attr_id: i32) -> Option<i64> {
        let attr_type = AttrType::from_id(attr_id).unwrap_or(AttrType::Unknown(attr_id));
        self.attr(uid, attr_type).and_then(AttrValue::as_int)
    }

    pub fn attr_position_by_id(&self, uid: i64, attr_id: i32) -> Option<PositionAttr> {
        let attr_type = AttrType::from_id(attr_id).unwrap_or(AttrType::Unknown(attr_id));
        self.attr(uid, attr_type).and_then(AttrValue::as_position)
    }

    pub fn hate_list_mut(&mut self, uid: i64) -> &mut Vec<HateEntry> {
        self.hate_lists
            .entry(uid)
            .or_insert_with(|| Vec::with_capacity(8))
    }

    pub fn hate_lists(&self) -> &HashMap<i64, Vec<HateEntry>> {
        &self.hate_lists
    }

    pub fn is_dead(&self, uid: i64) -> bool {
        self.attr(uid, AttrType::ActorState)
            .and_then(AttrValue::as_int)
            .is_some_and(|value| value == i64::from(EActorState::ActorStateDead as i32))
    }

    pub fn hydrate_entity(&self, uid: i64, entity: &mut Entity) {
        if let Some(name) = self
            .attr(uid, AttrType::Name)
            .and_then(AttrValue::as_string)
        {
            if !name.is_empty() {
                entity.name = name.to_string();
            }
        }
        if let Some(value) = self
            .attr(uid, AttrType::ProfessionId)
            .and_then(AttrValue::as_int)
            .filter(|value| *value > 0)
        {
            entity.class_id = value as i32;
        }
        if let Some(value) = self
            .attr(uid, AttrType::FightPoint)
            .and_then(AttrValue::as_int)
            .filter(|value| *value > 0)
        {
            entity.ability_score = value as i32;
        }
        if let Some(value) = self
            .attr(uid, AttrType::Level)
            .and_then(AttrValue::as_int)
            .filter(|value| *value > 0)
        {
            entity.level = value as i32;
        }
        if let Some(value) = self
            .attr(uid, AttrType::SeasonStrength)
            .and_then(AttrValue::as_int)
            .filter(|value| *value > 0)
        {
            entity.season_strength = value as i32;
        }
    }

    pub fn temp_attrs(&self) -> &HashMap<i32, i32> {
        &self.temp_attrs
    }

    pub fn cd_inputs(&self) -> (f32, f32, f32) {
        let uid = self.local_attr_key();
        let attr_skill_cd = self
            .attr(uid, AttrType::SkillCd)
            .and_then(AttrValue::as_int)
            .unwrap_or(0) as f32;
        let attr_skill_cd_pct = self
            .attr(uid, AttrType::SkillCdPct)
            .and_then(AttrValue::as_int)
            .unwrap_or(0) as f32;
        let attr_cd_accelerate_pct = self
            .attr(uid, AttrType::CdAcceleratePct)
            .and_then(AttrValue::as_int)
            .unwrap_or(0) as f32;
        (attr_skill_cd, attr_skill_cd_pct, attr_cd_accelerate_pct)
    }

    pub fn local_attr_int(&self, attr_type: AttrType) -> Option<i64> {
        self.attr(self.local_attr_key(), attr_type)
            .and_then(AttrValue::as_int)
    }

    pub fn mark_cd_dirty(&mut self) {
        self.cd_dirty = true;
    }

    pub fn set_shield_detail(&mut self, entries: Vec<ShieldDetailEntry>) {
        self.shield_detail_entries = entries;
        self.shield_detail_dirty = true;
    }

    pub fn clear_all_entities(&mut self) {
        self.attrs.clear();
        self.hate_lists.clear();
        self.fight_resource_ids.clear();
        self.temp_attrs.clear();
        self.panel_dirty_attrs
            .extend(self.panel_attr_values.keys().map(|attr_id| PanelAttrState {
                attr_id: *attr_id,
                value: 0,
            }));
        self.panel_attr_values.clear();
        self.shield_detail_entries.clear();
        self.shield_detail_dirty = true;
        self.death_events.clear();
    }

    pub fn drain_changes(&mut self) -> AttrChanges {
        let shield_dirty = std::mem::take(&mut self.shield_detail_dirty);
        let shield_entries = if shield_dirty {
            self.shield_detail_entries.clone()
        } else {
            Vec::new()
        };
        AttrChanges {
            cd_dirty: std::mem::take(&mut self.cd_dirty),
            panel_dirty_attrs: std::mem::take(&mut self.panel_dirty_attrs),
            shield_detail_dirty: shield_dirty,
            shield_detail_entries: shield_entries,
            death_events: std::mem::take(&mut self.death_events),
        }
    }
}

fn attr_affects_skill_cd(attr_type: AttrType) -> bool {
    match attr_type {
        AttrType::SkillCd
        | AttrType::SkillCdPct
        | AttrType::CdAcceleratePct
        | AttrType::BaseStrength
        | AttrType::Endurance
        | AttrType::Crit
        | AttrType::Lucky
        | AttrType::Haste
        | AttrType::Mastery => true,
        AttrType::Unknown(attr_id) => panel_attr_affects_skill_cd(attr_id),
        _ => false,
    }
}

fn panel_attr_affects_skill_cd(attr_id: i32) -> bool {
    matches!(
        attr_id,
        attr_type::ATTR_PANEL_STRENGTH
            | attr_type::ATTR_PANEL_AGILITY
            | attr_type::ATTR_PANEL_CRIT_RATE
            | attr_type::ATTR_PANEL_ATTACK_SPEED
            | attr_type::ATTR_PANEL_CAST_SPEED
            | attr_type::ATTR_PANEL_LUCKY
            | attr_type::ATTR_PANEL_HASTE
            | attr_type::ATTR_PANEL_MASTERY
            | attr_type::ATTR_PANEL_VERSATILITY
            | attr_type::ATTR_SKILL_CD_PCT
            | attr_type::ATTR_CD_ACCELERATE_PCT
            | attr_type::ATTR_PANEL_CRIT_DAMAGE
            | attr_type::ATTR_PANEL_LUCKY_DAMAGE_MULTIPLIER
            | attr_type::ATTR_PANEL_BLOCK_DAMAGE_REDUCTION
    )
}
