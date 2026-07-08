use crate::live::commands_models::{HateEntry, PanelAttrState, ShieldDetailEntry};
use crate::live::opcodes_models::{AttrType, AttrValue, Entity, PositionAttr, attr_type};
use blueprotobuf_lib::blueprotobuf::EActorState;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// View-state attributes that become stale once a stat-bearing entity leaves
/// view. They are re-synced when the entity re-appears, so they are dropped on
/// disappear while identity/stat attributes are preserved.
const TRANSIENT_VIEW_ATTRS: &[AttrType] = &[
    AttrType::CurrentHp,
    AttrType::MaxHp,
    AttrType::MaxStunned,
    AttrType::CurrentStunned,
    AttrType::Position,
];

#[derive(Debug, Clone)]
pub struct DeathEvent {
    pub entity_uuid: i64,
    pub timestamp_ms: u128,
}

#[derive(Debug, Clone)]
pub struct SkillCastEvent {
    pub entity_uuid: i64,
    pub skill_id: i32,
    pub timestamp_ms: i64,
}

#[derive(Debug, Default)]
pub struct EntityAttrStore {
    attrs: HashMap<i64, HashMap<AttrType, AttrValue>>,
    hate_lists: HashMap<i64, Vec<HateEntry>>,
    fight_resource_ids: HashMap<i64, Vec<i32>>,
    temp_attrs: HashMap<i32, i32>,
    local_player_uuid: i64,
    panel_attr_values: HashMap<i32, i32>,
    cd_dirty: bool,
    panel_dirty_attrs: Vec<PanelAttrState>,
    shield_detail_entries: Vec<ShieldDetailEntry>,
    shield_detail_dirty: bool,
    death_events: Vec<DeathEvent>,
    skill_cast_events: Vec<SkillCastEvent>,
    record_skill_casts: bool,
}

#[derive(Debug, Default)]
pub struct AttrChanges {
    pub cd_dirty: bool,
    pub panel_dirty_attrs: Vec<PanelAttrState>,
    pub shield_detail_dirty: bool,
    pub shield_detail_entries: Vec<ShieldDetailEntry>,
    pub death_events: Vec<DeathEvent>,
    pub skill_cast_events: Vec<SkillCastEvent>,
}

impl EntityAttrStore {
    pub fn with_capacity(attr_entries: usize) -> Self {
        Self {
            attrs: HashMap::with_capacity(attr_entries),
            hate_lists: HashMap::new(),
            fight_resource_ids: HashMap::new(),
            temp_attrs: HashMap::new(),
            local_player_uuid: 0,
            panel_attr_values: HashMap::new(),
            cd_dirty: false,
            panel_dirty_attrs: Vec::with_capacity(8),
            shield_detail_entries: Vec::new(),
            shield_detail_dirty: false,
            death_events: Vec::new(),
            skill_cast_events: Vec::new(),
            record_skill_casts: false,
        }
    }

    pub fn set_local_uuid(&mut self, uuid: i64) {
        self.local_player_uuid = uuid;
    }

    pub fn local_player_uuid(&self) -> i64 {
        self.local_player_uuid
    }

    pub fn set_attr(&mut self, uid: i64, attr_type: AttrType, value: AttrValue) -> bool {
        let was_dead = matches!(attr_type, AttrType::ActorState) && self.is_dead(uid);
        let mirrored_panel_attr = if uid == self.local_player_uuid {
            local_panel_attr_value(attr_type, &value)
        } else {
            None
        };
        let changed = self
            .attrs
            .entry(uid)
            .or_default()
            .get(&attr_type)
            .is_none_or(|prev| *prev != value);
        if !changed {
            return false;
        }
        self.attrs.entry(uid).or_default().insert(attr_type, value);
        let is_local_player = uid == self.local_player_uuid;
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
        if let Some((panel_attr_id, panel_value)) = mirrored_panel_attr {
            let _ = self.set_panel_attr(panel_attr_id, panel_value);
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
        true
    }

    pub fn fight_resource_ids(&self, uid: i64) -> &[i32] {
        self.fight_resource_ids
            .get(&uid)
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
        let uid = self.local_player_uuid;
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
        self.attr(self.local_player_uuid, attr_type)
            .and_then(AttrValue::as_int)
    }

    pub fn mark_cd_dirty(&mut self) {
        self.cd_dirty = true;
    }

    pub fn set_skill_cast_recording(&mut self, enabled: bool) {
        if self.record_skill_casts == enabled {
            return;
        }
        self.record_skill_casts = enabled;
        if !enabled {
            self.skill_cast_events.clear();
        }
    }

    pub fn push_skill_cast(&mut self, entity_uuid: i64, skill_id: i32) {
        if !self.record_skill_casts || entity_uuid == 0 || skill_id <= 0 {
            return;
        }
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(i64::MAX as u128) as i64;
        self.skill_cast_events.push(SkillCastEvent {
            entity_uuid,
            skill_id,
            timestamp_ms,
        });
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
        self.skill_cast_events.clear();
    }

    pub fn remove_entity(&mut self, uid: i64) {
        self.attrs.remove(&uid);
        self.hate_lists.remove(&uid);
        self.fight_resource_ids.remove(&uid);
    }

    pub fn clear_transient_attrs(&mut self, uid: i64) {
        if let Some(entity_attrs) = self.attrs.get_mut(&uid) {
            for attr_type in TRANSIENT_VIEW_ATTRS {
                entity_attrs.remove(attr_type);
            }
        }
        self.hate_lists.remove(&uid);
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
            skill_cast_events: std::mem::take(&mut self.skill_cast_events),
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

fn is_character_panel_attr(attr_id: i32) -> bool {
    matches!(
        attr_id,
        attr_type::ATTR_PANEL_STRENGTH
            | attr_type::ATTR_PANEL_INTELLIGENCE
            | attr_type::ATTR_PANEL_AGILITY
            | attr_type::ATTR_PANEL_PHYSICAL_ATTACK
            | attr_type::ATTR_PANEL_MAGIC_ATTACK
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
            | attr_type::ATTR_PANEL_BLOCK
    )
}

fn local_panel_attr_id(attr_type: AttrType) -> Option<i32> {
    match attr_type {
        AttrType::Unknown(attr_id) if is_character_panel_attr(attr_id) => Some(attr_id),
        // These packet IDs collide with named AttrType entries, but in the
        // character-panel stream they are displayed panel attributes.
        AttrType::MinEnergy => Some(attr_type::ATTR_PANEL_PHYSICAL_ATTACK),
        AttrType::SkillCdPct => Some(attr_type::ATTR_SKILL_CD_PCT),
        AttrType::CdAcceleratePct => Some(attr_type::ATTR_CD_ACCELERATE_PCT),
        _ => None,
    }
}

fn local_panel_attr_value(attr_type: AttrType, value: &AttrValue) -> Option<(i32, i32)> {
    let panel_attr_id = local_panel_attr_id(attr_type)?;
    let value = value.as_int().and_then(|value| i32::try_from(value).ok())?;
    Some((panel_attr_id, value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_unknown_panel_attr_updates_panel_cache() {
        let mut store = EntityAttrStore::default();
        store.set_local_uuid(42);

        assert!(store.set_attr(
            42,
            AttrType::Unknown(attr_type::ATTR_PANEL_HASTE),
            AttrValue::Int(1234),
        ));

        assert_eq!(
            store.panel_attr_value(attr_type::ATTR_PANEL_HASTE),
            Some(1234)
        );
        let changes = store.drain_changes();
        assert_eq!(changes.panel_dirty_attrs.len(), 1);
        assert_eq!(changes.panel_dirty_attrs[0].attr_id, attr_type::ATTR_PANEL_HASTE);
        assert_eq!(changes.panel_dirty_attrs[0].value, 1234);
    }

    #[test]
    fn local_colliding_panel_attr_updates_panel_cache() {
        let mut store = EntityAttrStore::default();
        store.set_local_uuid(42);

        assert!(store.set_attr(42, AttrType::MinEnergy, AttrValue::Int(9876)));

        assert_eq!(
            store.panel_attr_value(attr_type::ATTR_PANEL_PHYSICAL_ATTACK),
            Some(9876)
        );
        let changes = store.drain_changes();
        assert_eq!(changes.panel_dirty_attrs.len(), 1);
        assert_eq!(
            changes.panel_dirty_attrs[0].attr_id,
            attr_type::ATTR_PANEL_PHYSICAL_ATTACK
        );
        assert_eq!(changes.panel_dirty_attrs[0].value, 9876);
    }

    #[test]
    fn non_local_panel_attr_does_not_update_panel_cache() {
        let mut store = EntityAttrStore::default();
        store.set_local_uuid(42);

        assert!(store.set_attr(
            99,
            AttrType::Unknown(attr_type::ATTR_PANEL_HASTE),
            AttrValue::Int(1234),
        ));

        assert_eq!(store.panel_attr_value(attr_type::ATTR_PANEL_HASTE), None);
        assert!(store.drain_changes().panel_dirty_attrs.is_empty());
    }
}
