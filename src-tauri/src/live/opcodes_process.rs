// NOTE: opcodes_process works on Encounter directly; avoid importing opcodes_models at top-level.
use crate::database::{flush_playerdata, now_ms};
use crate::live::attribution_census::{self, AttributionDamageEvent, FormulaAttrSnapshot};
use crate::live::commands_models::{DamageSnapshot, HateEntry, ShieldDetailEntry};
use crate::live::damage_id;
use crate::live::dungeon_log::{BattleStateMachine, EncounterResetReason};
use crate::live::entity_attr_store::EntityAttrStore;
use crate::live::entity_id::{canonical_player_uuid, uid_from_uuid};
use crate::live::opcodes_models::class::{
    ClassSpec, get_class_id_from_spec, get_class_spec_from_runtime_id,
    get_class_spec_from_talent_node_id,
};
use crate::live::opcodes_models::{
    AttrType, AttrValue, Encounter, Entity, ObservedDamageHit, ObservedEffectSource,
    ObservedFormulaAttr, ObservedPassiveSkill, ObservedProfessionSkill, ObservedProfessionTalent,
    PositionAttr, Skill, attr_type, damage_type_flag,
};
use crate::live::training_dummy::CombatGate;
use blueprotobuf_lib::blueprotobuf;
use blueprotobuf_lib::blueprotobuf::{Attr, EDamageType, EEntityType};
use bytes::Buf;
use log::{info, warn};
use prost::Message;
use std::default::Default;

/// Attr ID for the shield display data (nested protobuf with current/max shield values).
const ATTR_SHIELD_DISPLAY: i32 = 60050;

/// Parses packed varints from ATTR_FIGHT_RESOURCES (50002) raw data.
/// The raw data is expected to be a protobuf message with field 1 containing packed varints.
/// Format: Tag (0x0A) | Length | Varint1 | Varint2 | ...
pub fn parse_fight_resources(raw_data: &[u8]) -> Option<Vec<i64>> {
    let mut buf = raw_data;

    // Attempt to decode the tag. Expect Field 1, WireType 2 (Length Delimited) -> (1 << 3) | 2 = 0x0A (10)
    if let Ok(tag) = prost::encoding::decode_varint(&mut buf) {
        if tag != 0x0A {
            return None;
        }
    } else {
        return None;
    }

    // Decode length of the packed field
    let len = match prost::encoding::decode_varint(&mut buf) {
        Ok(l) => l as usize,
        Err(_) => return None,
    };

    if buf.remaining() < len {
        return None;
    }

    // Take the slice containing the packed varints
    let mut packed_buf = buf.copy_to_bytes(len);
    let mut values = Vec::new();

    // Decode all varints in the slice
    while packed_buf.has_remaining() {
        match prost::encoding::decode_varint(&mut packed_buf) {
            Ok(val) => values.push(val as i64),
            Err(_) => break,
        }
    }

    Some(values)
}

#[derive(Debug, Default)]
pub struct SyncToMeDeltaResult {
    pub skill_cds: Vec<ParsedSkillCd>,
    pub buff_effect_bytes: Option<Vec<u8>>,
    pub fight_resource_ids: Option<Vec<i32>>,
    pub fight_resources: Option<Vec<i64>>,
    pub attr_skill_id: Option<i32>,
    pub local_damage_events: Vec<LocalDamageEvent>,
    pub local_damage_taken_events: Vec<LocalDamageTakenEvent>,
    pub temp_attr_modifier_changes: Vec<TempAttrModifierChange>,
}

#[derive(Debug, Default, Clone)]
pub struct LocalDamageEvent {
    pub skill_key: i64,
    pub target_uuid: Option<i64>,
    pub target_uid: i64,
    pub attacker_uuid: Option<i64>,
    pub attacker_uid: i64,
    pub original_attacker_uuid: Option<i64>,
    pub original_attacker_uid: i64,
    pub top_summoner_uuid: Option<i64>,
    pub top_summoner_uid: Option<i64>,
    pub is_crit: bool,
    pub is_lucky: bool,
}

#[derive(Debug, Default, Clone)]
pub struct LocalDamageTakenEvent {
    pub skill_key: i64,
    pub attacker_uuid: Option<i64>,
    pub attacker_uid: i64,
}

#[derive(Debug, Default, Clone)]
pub struct TempAttrModifierChange {
    pub temp_attr_id: i32,
    pub buff_id: i32,
    pub previous_value: i32,
    pub value: i32,
    pub event_time_ms: i64,
}

#[allow(clippy::too_many_arguments)]
fn apply_taken_skill_delta(
    skill: &mut Skill,
    effective_value: u128,
    is_crit: bool,
    is_lucky_bonus_only: bool,
    is_attacked_lucky_trigger: bool,
    is_block: bool,
    property: Option<i32>,
    damage_mode: Option<i32>,
) {
    if skill.property.is_none() {
        skill.property = property;
    }
    if skill.damage_mode.is_none() {
        skill.damage_mode = damage_mode;
    }
    if is_crit {
        skill.crit_hits += 1;
        skill.crit_total_value += effective_value;
    }
    if !is_lucky_bonus_only {
        skill.trigger_hits += 1;
        if is_attacked_lucky_trigger {
            skill.lucky_hits += 1;
        }
        if is_block {
            skill.block_hits += 1;
            if is_attacked_lucky_trigger {
                skill.lucky_block_hits += 1;
            }
        }
    } else {
        skill.lucky_total_value += effective_value;
    }
    skill.hits += 1;
    skill.total_value += effective_value;
}

const FORMULA_ATTACKER_ATTRS: &[(AttrType, &str)] = &[
    (AttrType::AttackPower, "AttackPower"),
    (AttrType::PhysicalAttack, "PhysicalAttack"),
    (AttrType::MagicAttack, "MagicAttack"),
    (AttrType::Unknown(11010), "PanelStrength"),
    (AttrType::Unknown(11020), "PanelIntelligence"),
    (AttrType::Unknown(11030), "PanelAgility"),
    (AttrType::MinEnergy, "PanelPhysicalAttack"),
    (AttrType::Unknown(11340), "PanelMagicAttack"),
    (AttrType::Unknown(11710), "PanelCritRate"),
    (AttrType::Unknown(11730), "PanelCastSpeed"),
    (AttrType::Unknown(11780), "PanelLucky"),
    (AttrType::Unknown(11930), "PanelHaste"),
    (AttrType::Unknown(11940), "PanelMastery"),
    (AttrType::Unknown(11950), "PanelVersatility"),
    (AttrType::Unknown(11970), "PanelBlock"),
    (AttrType::Unknown(12510), "PanelCritDamage"),
    (AttrType::Unknown(12530), "PanelLuckyDamageMultiplier"),
    (AttrType::Unknown(12540), "PanelBlockDamageReduction"),
    (AttrType::Crit, "Crit"),
    (AttrType::Lucky, "Lucky"),
    (AttrType::Haste, "Haste"),
    (AttrType::Mastery, "Mastery"),
    (AttrType::PhysicalPenetration, "PhysicalPenetration"),
    (AttrType::MagicPenetration, "MagicPenetration"),
    (AttrType::ElementFlag, "ElementFlag"),
    (AttrType::EnergyFlag, "EnergyFlag"),
    (AttrType::ReductionLevel, "ReductionLevel"),
    (AttrType::SkillCd, "SkillCd"),
    (AttrType::SkillCdPct, "SkillCdPct"),
    (AttrType::CdAcceleratePct, "CdAcceleratePct"),
    (AttrType::FightPoint, "FightPoint"),
    (AttrType::SeasonStrength, "SeasonStrength"),
    (AttrType::Level, "Level"),
];

const FORMULA_TARGET_ATTRS: &[(AttrType, &str)] = &[
    (AttrType::MonsterId, "MonsterId"),
    (AttrType::CurrentHp, "CurrentHp"),
    (AttrType::MaxHp, "MaxHp"),
    (AttrType::DefensePower, "DefensePower"),
    (AttrType::PhysicalPenetration, "PhysicalPenetration"),
    (AttrType::MagicPenetration, "MagicPenetration"),
    (AttrType::ElementalRes1, "ElementalRes1"),
    (AttrType::ElementalRes2, "ElementalRes2"),
    (AttrType::ElementalRes3, "ElementalRes3"),
    (AttrType::ElementFlag, "ElementFlag"),
    (AttrType::ReductionLevel, "ReductionLevel"),
    (AttrType::EliteStatus, "EliteStatus"),
    (AttrType::Level, "Level"),
];

const FORMULA_PANEL_ATTR_IDS: &[i32] = &[
    11010, 11020, 11030, 11330, 11340, 11710, 11720, 11730, 11780, 11930, 11940, 11950, 11970,
    12510, 12530, 12540,
];

fn formula_attr_snapshot(
    attr_store: &EntityAttrStore,
    uid: i64,
    attrs: &[(AttrType, &str)],
) -> Vec<FormulaAttrSnapshot> {
    attrs
        .iter()
        .filter_map(|(attr_type, attr_name)| {
            attr_store
                .attr(uid, *attr_type)
                .cloned()
                .map(|value| FormulaAttrSnapshot {
                    attr_id: attr_type.to_id(),
                    attr_name: (*attr_name).to_string(),
                    value,
                })
        })
        .collect()
}

fn formula_panel_attr_type(attr_id: i32) -> Option<AttrType> {
    if !FORMULA_PANEL_ATTR_IDS.contains(&attr_id) {
        return None;
    }
    Some(AttrType::from_id(attr_id).unwrap_or(AttrType::Unknown(attr_id)))
}

fn observed_formula_attrs(snapshots: Vec<FormulaAttrSnapshot>) -> Vec<ObservedFormulaAttr> {
    snapshots
        .into_iter()
        .filter_map(|snapshot| {
            let mut out = ObservedFormulaAttr {
                attr_id: snapshot.attr_id,
                value_int: None,
                value_float: None,
                value_bool: None,
            };
            match snapshot.value {
                AttrValue::Int(value) => out.value_int = Some(value),
                AttrValue::Float(value) => out.value_float = Some(value),
                AttrValue::Bool(value) => out.value_bool = Some(value),
                AttrValue::String(_) | AttrValue::Position(_) => return None,
            }
            Some(out)
        })
        .collect()
}

/// Entity type observations are not equally specific: `EntErrType` is an
/// unknown fallback, while `EntChar` and `EntMonster` are stable identities that
/// should not be downgraded or swapped by later UID-colliding observations.
pub(crate) fn should_overwrite_entity_type(existing: EEntityType, observed: EEntityType) -> bool {
    if existing == observed {
        return false;
    }

    if observed == EEntityType::EntErrType {
        return false;
    }

    if existing == EEntityType::EntErrType {
        return true;
    }

    false
}

#[allow(clippy::too_many_arguments)]
fn record_attribution_census_damage_event(
    timestamp_ms: u128,
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
    actual_value: u128,
    effective_value: u128,
    hp_loss_value: u128,
    shield_loss_value: u128,
    is_heal: bool,
    is_crit: bool,
    is_lucky: bool,
    attacker_attr_snapshot: Vec<FormulaAttrSnapshot>,
    target_attr_snapshot: Vec<FormulaAttrSnapshot>,
    attacker_entity: &Entity,
) {
    if !attribution_census::is_attribution_census_enabled() {
        return;
    }

    attribution_census::record_damage_event(AttributionDamageEvent {
        ts_ms: timestamp_ms.min(i64::MAX as u128) as i64,
        skill_key,
        damage_id,
        owner_id,
        owner_level,
        hit_event_id,
        damage_source,
        property,
        damage_mode,
        attacker_uuid,
        original_attacker_uuid,
        top_summoner_uuid,
        target_uuid,
        attacker_uid,
        original_attacker_uid,
        top_summoner_uid,
        target_uid,
        target_monster_type_id,
        value: actual_value,
        effective_value,
        hp_loss_value,
        shield_loss_value,
        is_heal,
        is_crit,
        is_lucky,
        attacker_class_id: attacker_entity.class_id,
        attacker_class_spec: format!("{:?}", attacker_entity.class_spec),
        active_buff_base_ids: attacker_entity
            .active_buffs
            .iter()
            .map(|buff| buff.base_id)
            .collect(),
        active_buff_source_uuids: attacker_entity
            .active_buffs
            .iter()
            .filter_map(|buff| buff.source_uuid)
            .collect(),
        active_buff_source_uids: attacker_entity
            .active_buffs
            .iter()
            .map(|buff| buff.source_uid)
            .collect(),
        active_factor_buff_ids: attacker_entity
            .active_factor_buffs
            .iter()
            .map(|buff| buff.factor_buff_id)
            .collect(),
        active_effect_buff_ids: attacker_entity
            .active_effect_buffs
            .iter()
            .map(|buff| buff.effect_source_buff_id)
            .collect(),
        active_effect_source_ids: attacker_entity
            .active_effect_sources
            .iter()
            .map(|source| source.source_id.clone())
            .collect(),
        active_factor_item_ids: attacker_entity
            .active_factor_items
            .iter()
            .map(|item| item.item_config_id)
            .collect(),
        active_factor_item_grades: attacker_entity
            .active_factor_items
            .iter()
            .filter_map(|item| item.grade)
            .collect(),
        active_passive_skill_ids: attacker_entity
            .active_passive_skills
            .iter()
            .filter_map(|skill| skill.skill_id)
            .collect(),
        active_passive_skill_uuids: attacker_entity
            .active_passive_skills
            .iter()
            .filter_map(|skill| skill.passive_uuid)
            .collect(),
        active_profession_talent_node_ids: attacker_entity
            .active_profession_talents
            .iter()
            .filter_map(|talent| i32::try_from(talent.talent_node_id).ok())
            .collect(),
        active_profession_talent_stage_cfg_ids: attacker_entity
            .active_profession_talents
            .iter()
            .filter_map(|talent| talent.talent_stage_cfg_id)
            .collect(),
        attacker_attr_snapshot,
        target_attr_snapshot,
    });
}

#[allow(clippy::too_many_arguments)]
fn record_observed_damage_hit(
    timestamp_ms: u128,
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
    value: u128,
    effective_value: u128,
    hp_loss_value: u128,
    shield_loss_value: u128,
    is_heal: bool,
    is_crit: bool,
    is_lucky: bool,
    attacker_attr_snapshot: Vec<FormulaAttrSnapshot>,
    target_attr_snapshot: Vec<FormulaAttrSnapshot>,
    attacker_entity: &mut Entity,
) {
    if attacker_entity.observed_damage_hits.len() >= MAX_OBSERVED_MODIFIER_DAMAGE_HITS {
        let overflow = attacker_entity
            .observed_damage_hits
            .len()
            .saturating_sub(MAX_OBSERVED_MODIFIER_DAMAGE_HITS)
            + 1;
        attacker_entity.observed_damage_hits.drain(0..overflow);
    }
    attacker_entity
        .observed_damage_hits
        .push(ObservedDamageHit {
            timestamp_ms: timestamp_ms.min(i64::MAX as u128) as i64,
            skill_key,
            damage_id,
            owner_id,
            owner_level,
            hit_event_id,
            damage_source,
            property,
            damage_mode,
            attacker_uuid,
            original_attacker_uuid,
            top_summoner_uuid,
            target_uuid,
            attacker_uid,
            original_attacker_uid,
            top_summoner_uid,
            target_uid,
            target_monster_type_id,
            value,
            effective_value,
            hp_loss_value,
            shield_loss_value,
            is_heal,
            is_crit,
            is_lucky,
            attacker_attrs: observed_formula_attrs(attacker_attr_snapshot),
            target_attrs: observed_formula_attrs(target_attr_snapshot),
        });
}

#[derive(Debug, Default, Clone, Copy)]
struct TargetHpState {
    current_hp: Option<u128>,
    max_hp: Option<u128>,
}

impl TargetHpState {
    fn from_attr_store(attr_store: &EntityAttrStore, target_uid: i64) -> Self {
        let current_hp = attr_store
            .attr(target_uid, AttrType::CurrentHp)
            .and_then(AttrValue::as_int)
            .and_then(|value| u128::try_from(value).ok());
        let max_hp = attr_store
            .attr(target_uid, AttrType::MaxHp)
            .and_then(AttrValue::as_int)
            .and_then(|value| u128::try_from(value).ok())
            .filter(|value| *value > 0);

        Self { current_hp, max_hp }
    }

    fn apply_damage(&mut self, hp_loss: u128, shield_loss: u128, fallback_damage: u128) {
        let hp_delta = if hp_loss > 0 {
            hp_loss
        } else if shield_loss == 0 {
            fallback_damage
        } else {
            0
        };

        if let (Some(current_hp), Some(max_hp)) = (&mut self.current_hp, self.max_hp) {
            *current_hp = (*current_hp).min(max_hp).saturating_sub(hp_delta);
        }
    }

    fn apply_heal(&mut self, raw_heal: u128) -> u128 {
        if let (Some(current_hp), Some(max_hp)) = (&mut self.current_hp, self.max_hp) {
            let clamped_current_hp = (*current_hp).min(max_hp);
            let missing_hp = max_hp.saturating_sub(clamped_current_hp);
            let effective_heal = raw_heal.min(missing_hp);
            *current_hp = clamped_current_hp
                .saturating_add(effective_heal)
                .min(max_hp);
            effective_heal
        } else {
            raw_heal
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct ParsedSkillCd {
    pub skill_level_id: Option<i32>,
    pub begin_time: Option<i64>,
    pub duration: Option<i32>,
    pub skill_cd_type: Option<i32>,
    pub valid_cd_time: Option<i32>,
}

#[derive(Debug, Default)]
pub(crate) struct EnterSceneResult {
    pub scene_id: Option<i32>,
}
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_OBSERVED_MODIFIER_DAMAGE_HITS: usize = 20_000;

fn is_local_identity(encounter: &Encounter, uid: i64, uuid: i64) -> bool {
    (encounter.local_player_uuid != 0 && uuid == encounter.local_player_uuid)
        || (encounter.local_player_uid > 0 && uid == encounter.local_player_uid)
}

/// Increment global active combat time used for True DPS calculations.
/// Adds a small grace window for single hits and ignores long idle gaps.
fn update_active_damage_time(encounter: &mut Encounter, timestamp_ms: u128) {
    const INACTIVITY_CUTOFF_MS: u128 = 3_000;
    const HIT_GRACE_MS: u128 = 500;

    let additional = if let Some(last) = encounter.last_combat_timestamp_ms {
        let delta = timestamp_ms.saturating_sub(last);
        if delta <= INACTIVITY_CUTOFF_MS {
            delta
        } else {
            HIT_GRACE_MS
        }
    } else {
        HIT_GRACE_MS
    };

    encounter.active_combat_time_ms = encounter.active_combat_time_ms.saturating_add(additional);
    encounter.last_combat_timestamp_ms = Some(timestamp_ms);
}

pub fn on_server_change(encounter: &mut Encounter) {
    info!("on server change");
    // Preserve entity identity and local player info; only reset combat state
    encounter.reset_combat_state();
}

pub fn process_sync_near_entities(
    encounter: &mut Encounter,
    attr_store: &mut EntityAttrStore,
    sync_near_entities: blueprotobuf::SyncNearEntities,
    capture_modifier_evidence: bool,
) -> Option<()> {
    for pkt_entity in sync_near_entities.appear {
        let target_uuid = pkt_entity.uuid?;
        let target_uid = encounter.remember_entity_uuid(target_uuid);
        let target_entity_type = EEntityType::from(target_uuid);
        let is_target_local_player = is_local_identity(encounter, target_uid, target_uuid);

        let target_entity = encounter.entity_by_uuid_or_insert_with(target_uuid, || Entity {
            entity_type: target_entity_type,
            ..Default::default()
        });
        let existing_type = target_entity.entity_type;
        if should_overwrite_entity_type(existing_type, target_entity_type) {
            target_entity.entity_type = target_entity_type;
        } else if existing_type != target_entity_type {
            info!(
                target: "app::live",
                "SyncNearEntities: blocked entity_type overwrite for uid={} from {:?} to {:?} (uuid=0x{:x}, low16={})",
                target_uid,
                existing_type,
                target_entity_type,
                target_uuid,
                target_uuid & 0xffff
            );
        }
        target_entity.uuid = Some(target_uuid);
        if let Some(passive_infos) = pkt_entity.passive_skill_infos.as_ref() {
            sync_entity_spec_from_passive_skill_infos(target_entity, passive_infos);
            if capture_modifier_evidence && is_target_local_player {
                observe_passive_skill_infos(
                    target_entity,
                    passive_infos,
                    "SyncNearEntities.appear.passive_skill_infos",
                );
            }
        }

        match target_entity_type {
            EEntityType::EntChar => {
                process_player_attrs(
                    target_entity,
                    target_uid,
                    pkt_entity.attrs?.attrs,
                    attr_store,
                );
            }
            EEntityType::EntMonster => {
                process_monster_attrs(
                    target_entity,
                    target_uid,
                    Some(target_uuid),
                    pkt_entity.attrs?.attrs,
                    attr_store,
                );
            }
            _ => {}
        }
    }

    // Track party members for wipe detection (collect data first to avoid borrow issues)
    Some(())
}

pub fn process_sync_container_data(
    encounter: &mut Encounter,
    attr_store: &mut EntityAttrStore,
    sync_container_data: blueprotobuf::SyncContainerData,
    capture_modifier_evidence: bool,
) -> Option<SyncContainerProcessResult> {
    let v_data = sync_container_data.v_data?;
    let season_cultivate_line_data = v_data.season_cultivate_line_data.clone();
    let player_uid = v_data.char_id?;
    let player_uuid = canonical_player_uuid(player_uid);
    encounter.local_player_uid = player_uid;
    encounter.local_player_uuid = player_uuid;
    encounter.remember_entity_uuid(player_uuid);
    attr_store.set_local_uid(player_uid);
    attr_store.set_local_uuid(player_uuid);

    let target_entity = encounter.entity_by_uuid_or_insert_with(player_uuid, Entity::default);
    target_entity.uuid = Some(player_uuid);
    let char_base = v_data.char_base.as_ref()?;
    let name = char_base.name.clone()?;
    target_entity.name = name;
    let _ = attr_store.set_attr(
        player_uid,
        AttrType::Name,
        AttrValue::String(target_entity.name.clone()),
    );

    // Player names are automatically stored in the database via UpsertEntity tasks
    // No need to maintain a separate cache anymore
    target_entity.entity_type = EEntityType::EntChar;
    let profession_list = v_data.profession_list.as_ref()?;
    let class_id = profession_list.cur_profession_id?;
    target_entity.class_id = class_id;
    let synced_spec = infer_class_spec_from_profession_list(profession_list, class_id);
    if synced_spec != ClassSpec::Unknown {
        target_entity.class_spec = synced_spec;
    }
    let _ = attr_store.set_attr(
        player_uid,
        AttrType::ProfessionId,
        AttrValue::Int(target_entity.class_id as i64),
    );

    target_entity.ability_score = char_base.fight_point?;
    let _ = attr_store.set_attr(
        player_uid,
        AttrType::FightPoint,
        AttrValue::Int(target_entity.ability_score as i64),
    );

    let role_level = v_data.role_level.as_ref()?;
    target_entity.level = role_level.level?;
    let _ = attr_store.set_attr(
        player_uid,
        AttrType::Level,
        AttrValue::Int(target_entity.level as i64),
    );
    if capture_modifier_evidence {
        target_entity.active_effect_sources = selected_season_medal_effect_sources(&v_data);
        target_entity.active_factor_items = observed_season_phantom_factor_items(&v_data);
        target_entity.active_profession_skills = selected_profession_skills(&v_data);
        target_entity.active_profession_talents = selected_profession_talents(&v_data);
    } else {
        target_entity.active_effect_sources.clear();
        target_entity.active_factor_items.clear();
        target_entity.active_profession_skills.clear();
        target_entity.active_profession_talents.clear();
    }

    // Note: HP data comes from attribute packets (ATTR_CURRENT_HP, ATTR_MAX_HP)
    // CharBaseInfo doesn't contain HP fields

    // Only store players in the database
    if matches!(target_entity.entity_type, EEntityType::EntChar) {
        // Persist detailed player data for the local player.
        let now = now_ms();

        // Serialize v_data to protobuf bytes
        let vdata_bytes = <blueprotobuf::CharSerialize as prost::Message>::encode_to_vec(&v_data);

        flush_playerdata(player_uid, now, vdata_bytes);
    }

    Some(SyncContainerProcessResult {
        season_cultivate_line_data,
    })
}

#[derive(Debug, Clone, Default)]
pub struct SyncContainerProcessResult {
    pub season_cultivate_line_data: Option<blueprotobuf::SeasonCultivateLineData>,
}

fn push_profession_skill_spec(specs: &mut Vec<ClassSpec>, class_id: i32, skill_id: i32) {
    if skill_id <= 0 {
        return;
    }

    let spec = get_class_spec_from_runtime_id(skill_id);
    if spec == ClassSpec::Unknown || get_class_id_from_spec(spec) != class_id {
        return;
    }

    if !specs.contains(&spec) {
        specs.push(spec);
    }
}

fn push_profession_talent_spec(specs: &mut Vec<ClassSpec>, class_id: i32, talent_node_id: u32) {
    let spec = get_class_spec_from_talent_node_id(talent_node_id);
    if spec == ClassSpec::Unknown || get_class_id_from_spec(spec) != class_id {
        return;
    }

    if !specs.contains(&spec) {
        specs.push(spec);
    }
}

fn push_passive_skill_spec(specs: &mut Vec<ClassSpec>, skill_id: i32) {
    if skill_id <= 0 {
        return;
    }

    let spec = get_class_spec_from_runtime_id(skill_id);
    if spec != ClassSpec::Unknown && !specs.contains(&spec) {
        specs.push(spec);
    }
}

fn sync_entity_spec_from_passive_skill_infos(
    entity: &mut Entity,
    passive_infos: &blueprotobuf::SeqPassiveSkillInfo,
) {
    let mut passive_specs = Vec::new();
    for info in &passive_infos.passive_infos {
        if let Some(skill_id) = info.skill_id {
            push_passive_skill_spec(&mut passive_specs, skill_id);
        }
    }

    let spec = single_synced_spec(&passive_specs);
    if spec == ClassSpec::Unknown {
        return;
    }

    let spec_class_id = get_class_id_from_spec(spec);
    if spec_class_id <= 0 {
        return;
    }

    if entity.class_id <= 0 || entity.class_id == spec_class_id {
        entity.class_id = spec_class_id;
        entity.class_spec = spec;
    }
}

fn single_synced_spec(specs: &[ClassSpec]) -> ClassSpec {
    if specs.len() == 1 {
        specs[0]
    } else {
        ClassSpec::Unknown
    }
}

fn infer_class_spec_from_profession_list(
    profession_list: &blueprotobuf::ProfessionList,
    class_id: i32,
) -> ClassSpec {
    let Some(profession_info) = profession_list.profession_list.get(&class_id) else {
        return ClassSpec::Unknown;
    };

    let mut equipped_specs = Vec::new();
    for skill_id in &profession_info.active_skill_ids {
        push_profession_skill_spec(&mut equipped_specs, class_id, *skill_id);
    }
    for skill_id in profession_info.slot_skill_info_map.values() {
        push_profession_skill_spec(&mut equipped_specs, class_id, *skill_id);
    }
    let equipped_spec = single_synced_spec(&equipped_specs);
    if equipped_spec != ClassSpec::Unknown {
        return equipped_spec;
    }

    if let Some(talent_info) = profession_list.talent_list.get(&class_id) {
        let mut talent_specs = Vec::new();
        for &talent_node_id in &talent_info.talent_node_ids {
            push_profession_talent_spec(&mut talent_specs, class_id, talent_node_id);
        }
        let talent_spec = single_synced_spec(&talent_specs);
        if talent_spec != ClassSpec::Unknown {
            return talent_spec;
        }
    }

    let mut known_specs = equipped_specs;
    for (skill_id, skill_info) in &profession_info.skill_info_map {
        push_profession_skill_spec(&mut known_specs, class_id, *skill_id);
        if let Some(base_skill_id) = skill_info.skill_id {
            push_profession_skill_spec(&mut known_specs, class_id, base_skill_id);
        }
        for replacement_skill_id in &skill_info.replace_skill_ids {
            push_profession_skill_spec(&mut known_specs, class_id, *replacement_skill_id);
        }
    }
    for (skill_id, skill_info) in &profession_list.aoyi_skill_info_map {
        push_profession_skill_spec(&mut known_specs, class_id, *skill_id);
        if let Some(base_skill_id) = skill_info.skill_id {
            push_profession_skill_spec(&mut known_specs, class_id, base_skill_id);
        }
        for replacement_skill_id in &skill_info.replace_skill_ids {
            push_profession_skill_spec(&mut known_specs, class_id, *replacement_skill_id);
        }
    }

    single_synced_spec(&known_specs)
}

fn canonical_season_medal_node_id(node_id: u32) -> u32 {
    if (100_000..=199_999).contains(&node_id) {
        node_id - 100_000
    } else {
        node_id
    }
}

fn selected_season_medal_effect_sources(
    v_data: &blueprotobuf::CharSerialize,
) -> Vec<ObservedEffectSource> {
    let Some(season_medal_info) = v_data.season_medal_info.as_ref() else {
        return Vec::new();
    };

    let mut sources = Vec::new();
    for node in season_medal_info.core_hole_node_infos.values() {
        if node.choose != Some(true) {
            continue;
        }
        let Some(node_id) = node.node_id else {
            continue;
        };
        let canonical_node_id = canonical_season_medal_node_id(node_id);
        let source_id = format!("season-talent-node:{canonical_node_id}");
        if !crate::live::effect_sources::is_effect_source_id(&source_id) {
            continue;
        }
        sources.push(ObservedEffectSource {
            source_id,
            runtime_source:
                "CharSerialize.season_medal_info.core_hole_node_infos.choose.normalized_node_id"
                    .to_string(),
            source_entity_id: Some(canonical_node_id as i32),
            node_id: Some(canonical_node_id),
            node_level: node.node_level,
            slot: node.slot,
        });
    }

    sources.sort_by_key(|source| (source.node_id.unwrap_or(0), source.slot.unwrap_or(0)));
    sources
}

fn selected_profession_talents(
    v_data: &blueprotobuf::CharSerialize,
) -> Vec<ObservedProfessionTalent> {
    let Some(profession_list) = v_data.profession_list.as_ref() else {
        return Vec::new();
    };
    let Some(current_profession_id) = profession_list.cur_profession_id else {
        return Vec::new();
    };
    let Some(info) = profession_list.talent_list.get(&current_profession_id) else {
        return Vec::new();
    };

    let mut talents = Vec::new();
    for &talent_node_id in &info.talent_node_ids {
        talents.push(ObservedProfessionTalent {
            profession_id: current_profession_id,
            talent_node_id,
            used_talent_points: info.used_talent_points,
            talent_stage_cfg_id: info.talent_stage_cfg_id,
            runtime_source: "CharSerialize.profession_list.cur_profession_id.talent_node_ids"
                .to_string(),
        });
    }

    talents.sort_by_key(|talent| (talent.profession_id, talent.talent_node_id));
    talents
}

fn selected_profession_skills(
    v_data: &blueprotobuf::CharSerialize,
) -> Vec<ObservedProfessionSkill> {
    let Some(profession_list) = v_data.profession_list.as_ref() else {
        return Vec::new();
    };
    let Some(current_profession_id) = profession_list.cur_profession_id else {
        return Vec::new();
    };
    let Some(info) = profession_list.profession_list.get(&current_profession_id) else {
        return Vec::new();
    };

    let mut skills = Vec::new();
    let mut seen_skill_ids = Vec::new();

    for (skill_id, skill_info) in &info.skill_info_map {
        seen_skill_ids.push(*skill_id);
        let slot = slot_for_profession_skill(info, *skill_id, skill_info);
        let equipped = Some(profession_skill_is_equipped(info, *skill_id, skill_info));
        skills.push(observed_profession_skill(
            *skill_id,
            skill_info,
            slot,
            equipped,
            "profession-skill",
            "CharSerialize.profession_list.cur_profession_id.profession_list.skill_info_map",
        ));
    }

    for skill_id in info
        .active_skill_ids
        .iter()
        .chain(info.slot_skill_info_map.values())
    {
        if seen_skill_ids.contains(skill_id) {
            continue;
        }
        skills.push(ObservedProfessionSkill {
            skill_id: *skill_id,
            base_skill_id: None,
            skill_level_id: None,
            level: None,
            remodel_level: None,
            slot: info
                .slot_skill_info_map
                .iter()
                .find_map(|(slot, slot_skill_id)| (*slot_skill_id == *skill_id).then_some(*slot)),
            equipped: Some(true),
            source_kind: "profession-skill".to_string(),
            replace_skill_ids: Vec::new(),
            runtime_source:
                "CharSerialize.profession_list.cur_profession_id.profession_list.active_skill_ids"
                    .to_string(),
        });
    }

    for (skill_id, skill_info) in &profession_list.aoyi_skill_info_map {
        skills.push(observed_profession_skill(
            *skill_id,
            skill_info,
            None,
            None,
            "battle-imagine",
            "CharSerialize.profession_list.aoyi_skill_info_map",
        ));
    }

    skills.sort_by_key(|skill| {
        (
            skill.source_kind.clone(),
            skill.skill_id,
            skill.slot.unwrap_or(-1),
        )
    });
    skills
}

fn observed_profession_skill(
    skill_id: i32,
    skill_info: &blueprotobuf::ProfessionSkillInfo,
    slot: Option<i32>,
    equipped: Option<bool>,
    source_kind: &str,
    runtime_source: &str,
) -> ObservedProfessionSkill {
    let level = skill_info.level.filter(|level| *level > 0);
    ObservedProfessionSkill {
        skill_id,
        base_skill_id: skill_info.skill_id.filter(|id| *id > 0),
        skill_level_id: level.and_then(|level| skill_id.checked_mul(100)?.checked_add(level)),
        level,
        remodel_level: skill_info.remodel_level.filter(|level| *level >= 0),
        slot,
        equipped,
        source_kind: source_kind.to_string(),
        replace_skill_ids: skill_info
            .replace_skill_ids
            .iter()
            .copied()
            .filter(|id| *id > 0)
            .collect(),
        runtime_source: runtime_source.to_string(),
    }
}

fn profession_skill_is_equipped(
    info: &blueprotobuf::ProfessionInfo,
    skill_id: i32,
    skill_info: &blueprotobuf::ProfessionSkillInfo,
) -> bool {
    info.active_skill_ids.contains(&skill_id)
        || skill_info
            .skill_id
            .is_some_and(|base_skill_id| info.active_skill_ids.contains(&base_skill_id))
        || skill_info
            .replace_skill_ids
            .iter()
            .any(|replacement| info.active_skill_ids.contains(replacement))
        || slot_for_profession_skill(info, skill_id, skill_info).is_some()
}

fn slot_for_profession_skill(
    info: &blueprotobuf::ProfessionInfo,
    skill_id: i32,
    skill_info: &blueprotobuf::ProfessionSkillInfo,
) -> Option<i32> {
    for (slot, slot_skill_id) in &info.slot_skill_info_map {
        if *slot_skill_id == skill_id
            || skill_info.skill_id == Some(*slot_skill_id)
            || skill_info
                .replace_skill_ids
                .iter()
                .any(|replacement| replacement == slot_skill_id)
        {
            return Some(*slot);
        }
    }
    None
}

fn observed_season_phantom_factor_items(
    v_data: &blueprotobuf::CharSerialize,
) -> Vec<crate::live::opcodes_models::ObservedFactorItem> {
    let Some(item_package) = v_data.item_package.as_ref() else {
        return Vec::new();
    };
    let Some(equip) = v_data.equip.as_ref() else {
        return Vec::new();
    };

    let mut items = Vec::new();
    for info in equip.equip_list.values() {
        let Some(equipped_uuid) = info.item_uuid else {
            continue;
        };
        for (package_key, package) in &item_package.packages {
            for item in package.items.values() {
                let Some(item_uuid) = item.uuid.and_then(|uuid| u64::try_from(uuid).ok()) else {
                    continue;
                };
                if item_uuid != equipped_uuid {
                    continue;
                }
                let Some(config_id) = item.config_id else {
                    continue;
                };
                let Some(factor_grade) =
                    crate::live::season_phantom_factors::factor_grade_item_for_config_id(config_id)
                else {
                    continue;
                };
                items.push(crate::live::opcodes_models::ObservedFactorItem {
                    factor_buff_id: factor_grade.factor_buff_id,
                    item_config_id: factor_grade.item_config_id,
                    item_uuid: item.uuid,
                    package_key: *package_key,
                    package_type: package.r#type,
                    grade: factor_grade.grade,
                    family_id: factor_grade.family_id,
                    runtime_source:
                        "CharSerialize.equip.equip_list.item_uuid->item_package.config_id"
                            .to_string(),
                    selector_path: None,
                    selector_signature: None,
                    selector_offset: None,
                });
            }
        }
    }

    items.sort_by_key(|item| {
        (
            item.factor_buff_id,
            item.grade.unwrap_or(0),
            item.item_config_id,
            item.item_uuid.unwrap_or(0),
        )
    });
    items
}

pub fn process_sync_container_dirty_data<'a>(
    encounter: &mut Encounter,
    sync_container_dirty_data: &'a blueprotobuf::SyncContainerDirtyData,
    capture_modifier_evidence: bool,
) -> Option<SyncContainerDirtyProcessResult<'a>> {
    let result = SyncContainerDirtyProcessResult {
        season_cultivate_dirty_bytes: sync_container_dirty_data
            .v_data
            .as_ref()
            .and_then(|v_data| v_data.buffer.as_deref()),
    };

    if !capture_modifier_evidence {
        return Some(result);
    }

    // SyncContainerDirtyData.v_data is a BufferStream (raw bytes)
    // Incremental attribute updates come through process_player_attrs via AoiSyncDelta
    // which handles attr packets with proper typing
    let selected_factor_items =
        crate::live::seasonal_factor_selector::selected_factor_items_from_dirty_data(
            &sync_container_dirty_data,
        );
    if selected_factor_items.is_empty() {
        return Some(result);
    }

    let local_player_uid = encounter.local_player_uid;
    if local_player_uid <= 0 {
        return Some(result);
    }

    let entity = encounter.entity_by_uid_or_insert_with(local_player_uid, || Entity {
        entity_type: EEntityType::EntChar,
        ..Default::default()
    });

    for item in selected_factor_items {
        entity
            .active_factor_items
            .retain(|existing| existing.factor_buff_id != item.factor_buff_id);
        entity.active_factor_items.push(item);
    }
    entity.active_factor_items.sort_by_key(|item| {
        (
            item.factor_buff_id,
            item.grade.unwrap_or(0),
            item.item_config_id,
            item.item_uuid.unwrap_or(0),
        )
    });

    Some(result)
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SyncContainerDirtyProcessResult<'a> {
    pub season_cultivate_dirty_bytes: Option<&'a [u8]>,
}

pub fn process_sync_dungeon_data(
    battle_state: &mut BattleStateMachine,
    sync_dungeon_data: blueprotobuf::SyncDungeonData,
    encounter_has_stats: bool,
) -> Option<EncounterResetReason> {
    let mut reset_reason = None;
    info!(
        target: "app::live",
        "Processing SyncDungeonData (encounter_has_stats={})",
        encounter_has_stats
    );
    if let Some(v_data) = sync_dungeon_data.v_data {
        if let Some(flow_info) = v_data.flow_info {
            if let Some(state) = flow_info.state {
                info!(target: "app::live", "SyncDungeonData flow_info.state={}", state);
            }
        }

        if let Some(target) = v_data.target {
            for (_, target_data) in target.target_data {
                let target_id = target_data.target_id.unwrap_or_default();
                let nums = target_data.nums.unwrap_or_default();
                let complete = target_data.complete.unwrap_or_default();
                info!(
                    target: "app::live",
                    "SyncDungeonData target entry target_id={} complete={} nums={}",
                    target_id,
                    complete,
                    nums
                );
                if let Some(reason) = battle_state.record_dungeon_target(target_id, nums, complete)
                {
                    reset_reason = Some(reason);
                }
            }
        }
    }

    if let Some(reason) = reset_reason {
        info!(target: "app::live", "SyncDungeonData produced reset reason: {:?}", reason);
    }
    reset_reason
}

pub fn process_sync_dungeon_dirty_data(
    battle_state: &mut BattleStateMachine,
    sync_dungeon_dirty_data: blueprotobuf::SyncDungeonDirtyData,
    encounter_has_stats: bool,
) -> Option<EncounterResetReason> {
    info!(
        target: "app::live",
        "Processing SyncDungeonDirtyData (encounter_has_stats={})",
        encounter_has_stats
    );
    let Some(v_data) = sync_dungeon_dirty_data.v_data else {
        warn!(target: "app::live", "SyncDungeonDirtyData missing v_data");
        return None;
    };
    let Some(bytes) = v_data.buffer else {
        warn!(target: "app::live", "SyncDungeonDirtyData missing buffer");
        return None;
    };
    info!(
        target: "app::live",
        "SyncDungeonDirtyData buffer length={} bytes",
        bytes.len()
    );
    let dirty_sync =
        match crate::live::dungeon_dirty_blob::parse_dirty_dungeon_data(bytes.as_slice()) {
            Ok(v) => v,
            Err(e) => {
                warn!(
                    target: "app::live",
                    "Failed to decode dirty dungeon blob from buffer: {}",
                    e
                );
                return None;
            }
        };

    let mut reset_reason = None;
    if let Some(state) = dirty_sync.flow_state {
        info!(
            target: "app::live",
            "SyncDungeonDirtyData flow_info.state={}",
            state
        );
    }

    for target_data in dirty_sync.targets {
        let target_id = target_data.target_id;
        let nums = target_data.nums;
        let complete = target_data.complete;
        info!(
            target: "app::live",
            "SyncDungeonDirtyData target entry target_id={} complete={} nums={}",
            target_id,
            complete,
            nums
        );
        if let Some(reason) = battle_state.record_dungeon_target(target_id, nums, complete) {
            reset_reason = Some(reason);
        }
    }

    if let Some(reason) = reset_reason {
        info!(
            target: "app::live",
            "SyncDungeonDirtyData produced reset reason: {:?}",
            reason
        );
    }
    reset_reason
}

pub fn process_sync_to_me_delta_info(
    encounter: &mut Encounter,
    attr_store: &mut EntityAttrStore,
    sync_to_me_delta_info: blueprotobuf::SyncToMeDeltaInfo,
    monitored_panel_attr_ids: &[i32],
    combat_gate: CombatGate,
    capture_modifier_evidence: bool,
) -> SyncToMeDeltaResult {
    use crate::live::opcodes_models::attr_type::{ATTR_FIGHT_RESOURCES, ATTR_SKILL_ID};

    let mut result = SyncToMeDeltaResult::default();
    let delta_info = match sync_to_me_delta_info.delta_info {
        Some(info) => info,
        None => {
            // This is normal during gameplay - packet may not always contain delta_info
            return result;
        }
    };

    if let Some(uuid) = delta_info.uuid {
        encounter.local_player_uuid = uuid;
        encounter.local_player_uid = encounter.remember_entity_uuid(uuid);
        attr_store.set_local_uid(encounter.local_player_uid);
        attr_store.set_local_uuid(uuid);
    }

    result.skill_cds = delta_info
        .sync_skill_c_ds
        .into_iter()
        .map(|cd| ParsedSkillCd {
            skill_level_id: cd.skill_level_id,
            begin_time: cd.begin_time,
            duration: cd.duration,
            skill_cd_type: cd.skill_cd_type,
            valid_cd_time: cd.valid_cd_time,
        })
        .collect();

    if let Some(mut base_delta) = delta_info.base_delta {
        result.buff_effect_bytes = base_delta.buff_effect.take();
        if let Some(attrs_collection) = base_delta.attrs.as_ref() {
            result.fight_resource_ids = attrs_collection
                .attrs
                .iter()
                .find(|a| a.id == Some(attr_type::ATTR_FIGHT_RESOURCE_IDS))
                .and_then(|a| a.raw_data.as_ref())
                .and_then(|raw| parse_fight_resources(raw))
                .map(|values| {
                    values
                        .into_iter()
                        .filter_map(|value| i32::try_from(value).ok())
                        .collect::<Vec<_>>()
                });
            result.fight_resources = attrs_collection
                .attrs
                .iter()
                .find(|a| a.id == Some(ATTR_FIGHT_RESOURCES))
                .and_then(|a| a.raw_data.as_ref())
                .and_then(|raw| parse_fight_resources(raw));
            result.attr_skill_id = attrs_collection
                .attrs
                .iter()
                .find(|attr| attr.id == Some(ATTR_SKILL_ID))
                .and_then(decode_single_attr_i32)
                .filter(|skill_id| *skill_id > 0);
            apply_panel_attrs(attr_store, attrs_collection, monitored_panel_attr_ids);
        }
        if let Some(temp_attr_collection) = base_delta.temp_attrs.as_ref() {
            for temp_attr in &temp_attr_collection.attrs {
                let Some(id) = temp_attr.id else {
                    continue;
                };
                let value = temp_attr.value.unwrap_or(0);
                let previous_value = attr_store.temp_attr_value(id).unwrap_or(0);
                let changed = attr_store.set_temp_attr(id, value);
                if capture_modifier_evidence && changed {
                    if let Some(buff_id) =
                        crate::live::temp_attr_sources::modifier_buff_id_for_temp_attr(id)
                    {
                        result
                            .temp_attr_modifier_changes
                            .push(TempAttrModifierChange {
                                temp_attr_id: id,
                                buff_id,
                                previous_value,
                                value,
                                event_time_ms: now_ms(),
                            });
                    }
                }
            }
        }
        if let Some((damage_events, damage_taken_events)) = process_aoi_sync_delta(
            encounter,
            attr_store,
            base_delta,
            combat_gate,
            true,
            capture_modifier_evidence,
        ) {
            result.local_damage_events = damage_events;
            result.local_damage_taken_events = damage_taken_events;
        }
    }

    result
}

pub(crate) fn extract_scene_id_from_attr_collection(
    attrs: &blueprotobuf::AttrCollection,
) -> Option<i32> {
    for attr in &attrs.attrs {
        if attr.id == Some(attr_type::ATTR_SCENE_BASIC_ID) {
            if let Some(raw) = &attr.raw_data {
                let mut buf = raw.as_slice();
                if let Ok(v) = prost::encoding::decode_varint(&mut buf) {
                    if v <= i32::MAX as u64 {
                        let scene_id = v as i32;
                        info!(
                            "Found scene_id {} from AttrSceneBasicId({})",
                            scene_id,
                            attr_type::ATTR_SCENE_BASIC_ID
                        );
                        return Some(scene_id);
                    }
                }
            }
        }
    }

    None
}

pub(crate) fn process_enter_scene(
    encounter: &mut Encounter,
    attr_store: &mut EntityAttrStore,
    enter_scene: &blueprotobuf::EnterScene,
    monitored_panel_attr_ids: &[i32],
    capture_modifier_evidence: bool,
) -> EnterSceneResult {
    if let Some(info) = enter_scene.enter_scene_info.as_ref() {
        if let Some(player_ent) = info.player_ent.as_ref() {
            if let Some(player_uuid) = player_ent.uuid.or_else(|| {
                player_ent
                    .passive_skill_infos
                    .as_ref()
                    .and_then(|passive_infos| passive_infos.actor_uuid)
            }) {
                encounter.local_player_uuid = player_uuid;
                encounter.local_player_uid = encounter.remember_entity_uuid(player_uuid);
                attr_store.set_local_uid(encounter.local_player_uid);
                attr_store.set_local_uuid(player_uuid);

                let entity = encounter.entity_by_uuid_or_insert_with(player_uuid, Entity::default);
                entity.uuid = Some(player_uuid);
                entity.entity_type = EEntityType::EntChar;
            }
            if let Some(passive_infos) = player_ent.passive_skill_infos.as_ref() {
                if let Some(player_uuid) = player_ent.uuid.or(passive_infos.actor_uuid) {
                    encounter.remember_entity_uuid(player_uuid);
                    let entity =
                        encounter.entity_by_uuid_or_insert_with(player_uuid, Entity::default);
                    entity.uuid = Some(player_uuid);
                    entity.entity_type = EEntityType::EntChar;
                    sync_entity_spec_from_passive_skill_infos(entity, passive_infos);
                    if capture_modifier_evidence {
                        observe_passive_skill_infos(
                            entity,
                            passive_infos,
                            "EnterScene.player_ent.passive_skill_infos",
                        );
                    }
                }
            }
            if let Some(attrs) = player_ent.attrs.as_ref() {
                apply_panel_attrs(attr_store, attrs, monitored_panel_attr_ids);
            }
        }
    }

    let scene_id = enter_scene
        .enter_scene_info
        .as_ref()
        .and_then(|info| info.scene_attrs.as_ref())
        .and_then(extract_scene_id_from_attr_collection);

    EnterSceneResult { scene_id }
}

fn observe_passive_skill_infos(
    entity: &mut Entity,
    passive_infos: &blueprotobuf::SeqPassiveSkillInfo,
    runtime_source: &str,
) {
    for info in &passive_infos.passive_infos {
        let observed = ObservedPassiveSkill {
            passive_uuid: info.uuid.map(i64::from),
            target_uid: info.target_uuid.map(uid_from_uuid),
            stage_begin_time: info.stage_begin_time,
            begin_time: info.begin_time,
            stage_play_num: info.stage_play_num,
            skill_id: info.skill_id,
            skill_level: info.skill_level,
            skill_stage: info.skill_stage,
            runtime_source: runtime_source.to_string(),
        };
        upsert_observed_passive_skill(&mut entity.active_passive_skills, observed);
    }

    entity
        .active_passive_skills
        .sort_by_key(|skill| (skill.skill_id.unwrap_or(0), skill.passive_uuid.unwrap_or(0)));
}

fn remove_passive_skill_infos(
    entity: &mut Entity,
    passive_end_infos: &blueprotobuf::SeqPassiveSkillEndInfo,
) {
    if passive_end_infos.uuids.is_empty() {
        return;
    }

    entity.active_passive_skills.retain(|skill| {
        skill
            .passive_uuid
            .is_none_or(|uuid| !passive_end_infos.uuids.contains(&uuid))
    });
}

fn upsert_observed_passive_skill(
    active_passive_skills: &mut Vec<ObservedPassiveSkill>,
    observed: ObservedPassiveSkill,
) {
    if let Some(index) = active_passive_skills.iter().position(|existing| {
        if existing.passive_uuid.is_some() && observed.passive_uuid.is_some() {
            existing.passive_uuid == observed.passive_uuid
        } else {
            existing.skill_id == observed.skill_id && existing.target_uid == observed.target_uid
        }
    }) {
        active_passive_skills[index] = observed;
    } else {
        active_passive_skills.push(observed);
    }
}

pub(crate) fn aoi_delta_has_player_damage(delta: &blueprotobuf::AoiSyncDelta) -> bool {
    delta
        .skill_effects
        .as_ref()
        .is_some_and(|effects| effects.damages.iter().any(is_valid_player_damage))
}

fn is_valid_player_damage(dmg: &blueprotobuf::SyncDamageInfo) -> bool {
    if dmg.r#type.unwrap_or(0) == EDamageType::Heal as i32 {
        return false;
    }
    if dmg.value.is_none() && dmg.lucky_value.is_none() {
        return false;
    }
    let attacker_uuid = match dmg.top_summoner_id.or(dmg.attacker_uuid) {
        Some(uuid) => uuid,
        None => return false,
    };
    if dmg.owner_id.is_none() {
        return false;
    }

    EEntityType::from(attacker_uuid) == EEntityType::EntChar
}

fn decode_single_attr_i32(attr: &blueprotobuf::Attr) -> Option<i32> {
    match attr.raw_data.as_ref() {
        None => Some(0),
        Some(raw) if raw.is_empty() => Some(0),
        Some(raw) => {
            let mut buf = raw.as_slice();
            prost::encoding::decode_varint(&mut buf)
                .ok()
                .and_then(|v| i32::try_from(v).ok())
        }
    }
}

pub fn apply_panel_attrs(
    attr_store: &mut EntityAttrStore,
    attrs: &blueprotobuf::AttrCollection,
    monitored_panel_attr_ids: &[i32],
) {
    for attr in &attrs.attrs {
        let Some(attr_id) = attr.id else {
            continue;
        };
        if attr_id == ATTR_SHIELD_DISPLAY {
            let detail_entries = match attr.raw_data.as_deref() {
                Some(raw) => decode_shield_detail_entries(raw),
                None => Vec::new(),
            };
            attr_store.set_shield_detail(detail_entries);
            continue;
        }
        let formula_attr_type = formula_panel_attr_type(attr_id);
        if !monitored_panel_attr_ids.contains(&attr_id) && formula_attr_type.is_none() {
            continue;
        }
        let Some(value) = decode_single_attr_i32(attr) else {
            continue;
        };
        if monitored_panel_attr_ids.contains(&attr_id) {
            let _ = attr_store.set_panel_attr(attr_id, value);
        }
        if let Some(attr_type) = formula_attr_type {
            let uid = attr_store.local_player_uid();
            if uid != 0 {
                let _ = attr_store.set_attr(uid, attr_type, AttrValue::Int(i64::from(value)));
            }
        }
    }
}

pub fn process_aoi_sync_delta(
    encounter: &mut Encounter,
    attr_store: &mut EntityAttrStore,
    aoi_sync_delta: blueprotobuf::AoiSyncDelta,
    combat_gate: CombatGate,
    collect_taken: bool,
    capture_modifier_evidence: bool,
) -> Option<(Vec<LocalDamageEvent>, Vec<LocalDamageTakenEvent>)> {
    let target_uuid = aoi_sync_delta.uuid?; // UUID =/= uid (have to >> 16)
    let target_uid = encounter.remember_entity_uuid(target_uuid);
    let is_target_local_player = is_local_identity(encounter, target_uid, target_uuid);
    let allow_combat = match combat_gate {
        CombatGate::AllowAll => true,
        CombatGate::Only(locked_target_uuid) => locked_target_uuid == target_uuid,
        CombatGate::BlockAll => false,
    };

    if let Some(passive_infos) = aoi_sync_delta.passive_skill_infos.as_ref() {
        let actor_uuid = passive_infos.actor_uuid.unwrap_or(target_uuid);
        encounter.remember_entity_uuid(actor_uuid);
        let entity = encounter.entity_by_uuid_or_insert_with(actor_uuid, Entity::default);
        entity.uuid = Some(actor_uuid);
        entity.entity_type = EEntityType::from(actor_uuid);
        sync_entity_spec_from_passive_skill_infos(entity, passive_infos);
        if capture_modifier_evidence && is_target_local_player {
            observe_passive_skill_infos(entity, passive_infos, "AoiSyncDelta.passive_skill_infos");
        }
    }

    if capture_modifier_evidence && is_target_local_player {
        if let Some(passive_end_infos) = aoi_sync_delta.passive_skill_end_infos.as_ref() {
            let actor_uuid = passive_end_infos.actor_uuid.unwrap_or(target_uuid);
            encounter.remember_entity_uuid(actor_uuid);
            if let Some(entity) = encounter.entity_mut_by_uuid(actor_uuid) {
                remove_passive_skill_infos(entity, passive_end_infos);
            }
        }
    }

    // Process attributes
    let target_entity_type = EEntityType::from(target_uuid);
    let mut target_entity = encounter.entity_by_uuid_or_insert_with(target_uuid, || Entity {
        entity_type: target_entity_type,
        ..Default::default()
    });
    target_entity.uuid = Some(target_uuid);
    if should_overwrite_entity_type(target_entity.entity_type, target_entity_type) {
        target_entity.entity_type = target_entity_type;
    } else if target_entity.entity_type != target_entity_type {
        info!(
            target: "app::live",
            "AoiSyncDelta: blocked entity_type overwrite for uid={} from {:?} to {:?} (uuid=0x{:x}, low16={})",
            target_uid,
            target_entity.entity_type,
            target_entity_type,
            target_uuid,
            target_uuid & 0xffff
        );
    }

    if let Some(attrs_collection) = aoi_sync_delta.attrs {
        match target_entity_type {
            EEntityType::EntChar => {
                process_player_attrs(
                    &mut target_entity,
                    target_uid,
                    attrs_collection.attrs,
                    attr_store,
                );
            }
            EEntityType::EntMonster => {
                process_monster_attrs(
                    &mut target_entity,
                    target_uid,
                    Some(target_uuid),
                    attrs_collection.attrs,
                    attr_store,
                );
            }
            _ => {}
        }
    }

    let Some(skill_effect) = aoi_sync_delta.skill_effects else {
        return Some((Vec::new(), Vec::new())); // return ok since this variable usually doesn't exist
    };

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let mut target_hp_state = TargetHpState::from_attr_store(attr_store, target_uid);
    let mut local_damage_events = Vec::new();
    let mut local_damage_taken_events = Vec::new();
    let mut had_player_damage = false;
    let mut had_allowed_combat = false;
    // Process Damage
    for sync_damage_info in skill_effect.damages {
        let non_lucky_dmg = sync_damage_info.value;
        let lucky_value = sync_damage_info.lucky_value;

        #[allow(clippy::cast_sign_loss)]
        let actual_value = if let Some(actual_dmg) = non_lucky_dmg.or(lucky_value) {
            actual_dmg as u128
        } else {
            continue; // skip this iteration
        };
        let hp_loss_value = sync_damage_info.hp_lessen_value.unwrap_or(0).max(0) as u128;
        let shield_loss_value = sync_damage_info.shield_lessen_value.unwrap_or(0).max(0) as u128;
        let is_heal = sync_damage_info.r#type.unwrap_or(0) == EDamageType::Heal as i32;
        let effective_heal_value = if allow_combat && is_heal {
            target_hp_state.apply_heal(actual_value)
        } else {
            0
        };

        let attacker_uuid = sync_damage_info
            .top_summoner_id
            .or(sync_damage_info.attacker_uuid)?;
        let attacker_uid = encounter.remember_entity_uuid(attacker_uuid);
        let original_attacker_uuid = sync_damage_info.attacker_uuid.unwrap_or(attacker_uuid);
        let original_attacker_uid = encounter.remember_entity_uuid(original_attacker_uuid);
        let is_self_inflicted_damage = attacker_uuid == target_uuid;
        let top_summoner_uid = sync_damage_info
            .top_summoner_id
            .map(|uuid| encounter.remember_entity_uuid(uuid));
        let is_local_damage_source = is_local_identity(encounter, attacker_uid, attacker_uuid);
        let capture_formula_evidence = attribution_census::is_attribution_census_enabled()
            || (capture_modifier_evidence
                && is_local_damage_source
                && EEntityType::from(attacker_uuid) == EEntityType::EntChar);
        let (attacker_formula_attrs, target_formula_attrs) = if capture_formula_evidence {
            (
                formula_attr_snapshot(attr_store, attacker_uid, FORMULA_ATTACKER_ATTRS),
                formula_attr_snapshot(attr_store, target_uid, FORMULA_TARGET_ATTRS),
            )
        } else {
            (Vec::new(), Vec::new())
        };

        // Local copies of fields needed later (avoid holding map borrows across operations)
        let owner_id = sync_damage_info.owner_id?;
        let damage_id = damage_id::compute_damage_id(
            sync_damage_info.damage_source,
            owner_id,
            sync_damage_info.owner_level,
            sync_damage_info.hit_event_id,
        );
        let skill_key = damage_id;
        let is_local_damage_target = is_target_local_player;
        if allow_combat && collect_taken && is_local_damage_target && !is_heal {
            local_damage_taken_events.push(LocalDamageTakenEvent {
                skill_key,
                attacker_uuid: Some(attacker_uuid),
                attacker_uid,
            });
        }
        let flag = sync_damage_info.type_flag.unwrap_or_default();
        // DPS boss aggregate columns count both boss and elite targets.
        let is_boss_target = encounter
            .entity_by_uuid(target_uuid)
            .map(|e| e.is_elite_or_boss_metric_target())
            .unwrap_or(false);
        let target_monster_type_id = encounter
            .entity_by_uuid(target_uuid)
            .and_then(|e| e.monster_type_id);

        let target_name_opt = encounter.entity_by_uuid(target_uuid).and_then(|e| {
            if e.name.is_empty() {
                None
            } else {
                Some(e.name.clone())
            }
        });

        let is_lucky_bonus_only = non_lucky_dmg.is_none() && lucky_value.is_some();
        let is_attacker_lucky_trigger = (flag & damage_type_flag::ATTACKER_LUCK) != 0;
        let is_attacked_lucky_trigger = (flag & damage_type_flag::ATTACKED_LUCK) != 0;
        let is_block = (flag & damage_type_flag::BLOCK) != 0;
        let is_crit = (flag & damage_type_flag::CRIT) != 0;
        if allow_combat && is_local_damage_source {
            local_damage_events.push(LocalDamageEvent {
                skill_key,
                target_uuid: Some(target_uuid),
                target_uid,
                attacker_uuid: Some(attacker_uuid),
                attacker_uid,
                original_attacker_uuid: Some(original_attacker_uuid),
                original_attacker_uid,
                top_summoner_uuid: sync_damage_info.top_summoner_id,
                top_summoner_uid,
                is_crit,
                is_lucky: is_attacker_lucky_trigger && !is_lucky_bonus_only,
            });
        }

        let mut total_heal_delta = 0;
        let mut total_effective_heal_delta = 0;
        let mut total_dmg_delta = 0;
        let mut total_dmg_boss_only_delta = 0;

        // First update attacker-side state in its own scope (single mutable borrow)
        let (attacker_entity_type_copy, was_heal_event) = {
            let attacker_entity =
                encounter.entity_by_uuid_or_insert_with(attacker_uuid, || Entity {
                    entity_type: EEntityType::from(attacker_uuid),
                    ..Default::default()
                });
            attacker_entity.uuid = Some(attacker_uuid);

            let determined_spec = get_class_spec_from_runtime_id(owner_id);
            if determined_spec != ClassSpec::Unknown {
                attacker_entity.class_id = get_class_id_from_spec(determined_spec);
                attacker_entity.class_spec = determined_spec;
            }

            if !allow_combat {
                (attacker_entity.entity_type, is_heal)
            } else if is_heal {
                had_allowed_combat = true;

                let skill = attacker_entity
                    .skill_uid_to_heal_skill
                    .entry(skill_key)
                    .or_insert_with(|| Skill::default());
                if is_crit {
                    attacker_entity.healing.crit_hits += 1;
                    attacker_entity.healing.crit_total += actual_value;
                    skill.crit_hits += 1;
                    skill.crit_total_value += actual_value;
                }
                if !is_lucky_bonus_only {
                    attacker_entity.healing.trigger_hits += 1;
                    skill.trigger_hits += 1;
                    if is_attacker_lucky_trigger {
                        attacker_entity.healing.lucky_hits += 1;
                        skill.lucky_hits += 1;
                    }
                } else {
                    attacker_entity.healing.lucky_total += actual_value;
                    skill.lucky_total_value += actual_value;
                }
                total_heal_delta = actual_value;
                total_effective_heal_delta = effective_heal_value;
                attacker_entity.healing.hits += 1;
                attacker_entity.healing.total += actual_value;
                attacker_entity.healing.effective_total += effective_heal_value;
                skill.hits += 1;
                skill.total_value += actual_value;
                skill.effective_total_value += effective_heal_value;

                // Track per-skill per-target stats for healing
                let key = (skill_key, target_uid);
                let stats = attacker_entity.skill_heal_to_target.entry(key).or_default();
                if stats.target_uuid.is_none() {
                    stats.target_uuid = Some(target_uuid);
                }

                stats.hits += 1;
                stats.total_value += actual_value;
                stats.effective_total_value += effective_heal_value;
                if is_crit {
                    stats.crit_hits += 1;
                    stats.crit_total += actual_value;
                }
                if !is_lucky_bonus_only {
                    stats.trigger_hits += 1;
                    if is_attacker_lucky_trigger {
                        stats.lucky_hits += 1;
                    }
                } else {
                    stats.lucky_total += actual_value;
                }
                stats.hp_loss_total = 0;
                stats.shield_loss_total = 0;

                record_attribution_census_damage_event(
                    timestamp_ms,
                    skill_key,
                    damage_id,
                    owner_id,
                    sync_damage_info.owner_level,
                    sync_damage_info.hit_event_id,
                    sync_damage_info.damage_source,
                    sync_damage_info.property,
                    sync_damage_info.damage_mode,
                    Some(attacker_uuid),
                    Some(original_attacker_uuid),
                    sync_damage_info.top_summoner_id,
                    Some(target_uuid),
                    attacker_uid,
                    original_attacker_uid,
                    top_summoner_uid,
                    target_uid,
                    target_monster_type_id,
                    actual_value,
                    effective_heal_value,
                    hp_loss_value,
                    shield_loss_value,
                    true,
                    is_crit,
                    is_attacker_lucky_trigger,
                    attacker_formula_attrs.clone(),
                    target_formula_attrs.clone(),
                    attacker_entity,
                );
                if capture_modifier_evidence
                    && is_local_damage_source
                    && attacker_entity.entity_type == EEntityType::EntChar
                {
                    record_observed_damage_hit(
                        timestamp_ms,
                        skill_key,
                        damage_id,
                        owner_id,
                        sync_damage_info.owner_level,
                        sync_damage_info.hit_event_id,
                        sync_damage_info.damage_source,
                        sync_damage_info.property,
                        sync_damage_info.damage_mode,
                        Some(attacker_uuid),
                        Some(original_attacker_uuid),
                        sync_damage_info.top_summoner_id,
                        Some(target_uuid),
                        attacker_uid,
                        original_attacker_uid,
                        top_summoner_uid,
                        target_uid,
                        target_monster_type_id,
                        actual_value,
                        effective_heal_value,
                        hp_loss_value,
                        shield_loss_value,
                        true,
                        is_crit,
                        is_attacker_lucky_trigger,
                        attacker_formula_attrs.clone(),
                        target_formula_attrs.clone(),
                        attacker_entity,
                    );
                }

                (attacker_entity.entity_type, true)
            } else {
                had_allowed_combat = true;
                let skill = attacker_entity
                    .skill_uid_to_dmg_skill
                    .entry(skill_key)
                    .or_insert_with(|| Skill::default());
                if is_crit {
                    attacker_entity.damage.crit_hits += 1;
                    attacker_entity.damage.crit_total += actual_value;
                    skill.crit_hits += 1;
                    skill.crit_total_value += actual_value;
                }
                if !is_lucky_bonus_only {
                    attacker_entity.damage.trigger_hits += 1;
                    skill.trigger_hits += 1;
                    if is_attacker_lucky_trigger {
                        attacker_entity.damage.lucky_hits += 1;
                        skill.lucky_hits += 1;
                    }
                } else {
                    attacker_entity.damage.lucky_total += actual_value;
                    skill.lucky_total_value += actual_value;
                }
                if attacker_entity.entity_type == EEntityType::EntChar {
                    total_dmg_delta = actual_value;
                }
                attacker_entity.damage.hits += 1;
                attacker_entity.damage.total += actual_value;
                skill.hits += 1;
                skill.total_value += actual_value;

                if is_boss_target {
                    if is_crit {
                        attacker_entity.damage_boss_only.crit_hits += 1;
                        attacker_entity.damage_boss_only.crit_total += actual_value;
                    }
                    if !is_lucky_bonus_only {
                        attacker_entity.damage_boss_only.trigger_hits += 1;
                        if is_attacker_lucky_trigger {
                            attacker_entity.damage_boss_only.lucky_hits += 1;
                        }
                    } else {
                        attacker_entity.damage_boss_only.lucky_total += actual_value;
                    }
                    if attacker_entity.entity_type == EEntityType::EntChar {
                        total_dmg_boss_only_delta = actual_value;
                    }
                    attacker_entity.damage_boss_only.hits += 1;
                    attacker_entity.damage_boss_only.total += actual_value;
                }

                // Track per-target totals
                use std::collections::hash_map::Entry;
                match attacker_entity.dmg_to_target.entry(target_uid) {
                    Entry::Occupied(mut e) => {
                        *e.get_mut() += actual_value;
                    }
                    Entry::Vacant(e) => {
                        e.insert(actual_value);
                    }
                }

                // Track per-skill per-target stats
                let key = (skill_key, target_uid);
                let stats = attacker_entity.skill_dmg_to_target.entry(key).or_default();
                if stats.target_uuid.is_none() {
                    stats.target_uuid = Some(target_uuid);
                }

                stats.hits += 1;
                stats.total_value += actual_value;
                if is_crit {
                    stats.crit_hits += 1;
                    stats.crit_total += actual_value;
                }
                if !is_lucky_bonus_only {
                    stats.trigger_hits += 1;
                    if is_attacker_lucky_trigger {
                        stats.lucky_hits += 1;
                    }
                } else {
                    stats.lucky_total += actual_value;
                }

                stats.hp_loss_total += hp_loss_value;
                stats.shield_loss_total += shield_loss_value;

                if stats.monster_name.is_none() {
                    stats.monster_name = target_name_opt.clone();
                }

                let effective_damage_value = if hp_loss_value + shield_loss_value > 0 {
                    hp_loss_value + shield_loss_value
                } else {
                    actual_value
                };
                record_attribution_census_damage_event(
                    timestamp_ms,
                    skill_key,
                    damage_id,
                    owner_id,
                    sync_damage_info.owner_level,
                    sync_damage_info.hit_event_id,
                    sync_damage_info.damage_source,
                    sync_damage_info.property,
                    sync_damage_info.damage_mode,
                    Some(attacker_uuid),
                    Some(original_attacker_uuid),
                    sync_damage_info.top_summoner_id,
                    Some(target_uuid),
                    attacker_uid,
                    original_attacker_uid,
                    top_summoner_uid,
                    target_uid,
                    target_monster_type_id,
                    actual_value,
                    effective_damage_value,
                    hp_loss_value,
                    shield_loss_value,
                    false,
                    is_crit,
                    is_attacker_lucky_trigger,
                    attacker_formula_attrs.clone(),
                    target_formula_attrs.clone(),
                    attacker_entity,
                );
                if capture_modifier_evidence
                    && is_local_damage_source
                    && attacker_entity.entity_type == EEntityType::EntChar
                {
                    record_observed_damage_hit(
                        timestamp_ms,
                        skill_key,
                        damage_id,
                        owner_id,
                        sync_damage_info.owner_level,
                        sync_damage_info.hit_event_id,
                        sync_damage_info.damage_source,
                        sync_damage_info.property,
                        sync_damage_info.damage_mode,
                        Some(attacker_uuid),
                        Some(original_attacker_uuid),
                        sync_damage_info.top_summoner_id,
                        Some(target_uuid),
                        attacker_uid,
                        original_attacker_uid,
                        top_summoner_uid,
                        target_uid,
                        target_monster_type_id,
                        actual_value,
                        effective_damage_value,
                        hp_loss_value,
                        shield_loss_value,
                        false,
                        is_crit,
                        is_attacker_lucky_trigger,
                        attacker_formula_attrs.clone(),
                        target_formula_attrs.clone(),
                        attacker_entity,
                    );
                }

                (attacker_entity.entity_type, false)
            }
        };

        encounter.total_heal += total_heal_delta;
        encounter.total_effective_heal += total_effective_heal_delta;
        encounter.total_dmg += total_dmg_delta;
        encounter.total_dmg_boss_only += total_dmg_boss_only_delta;

        if allow_combat && !was_heal_event && attacker_entity_type_copy == EEntityType::EntChar {
            had_player_damage = true;
        }

        if allow_combat && !was_heal_event {
            target_hp_state.apply_damage(hp_loss_value, shield_loss_value, actual_value);
        }

        // Track damage taken when a non-player attacks the defender, plus player self-damage.
        if allow_combat && !was_heal_event {
            let effective_value = if hp_loss_value + shield_loss_value > 0 {
                hp_loss_value + shield_loss_value
            } else {
                actual_value
            };

            let attacker_monster_type_id = encounter
                .entity_by_uuid(attacker_uuid)
                .and_then(|e| e.monster_type_id);

            let defender_entity = encounter.entity_by_uuid_or_insert_with(target_uuid, || Entity {
                entity_type: EEntityType::from(target_uuid),
                ..Default::default()
            });
            defender_entity.uuid = Some(target_uuid);

            if attacker_entity_type_copy != EEntityType::EntChar || is_self_inflicted_damage {
                if is_crit {
                    defender_entity.taken.crit_hits += 1;
                    defender_entity.taken.crit_total += effective_value;
                }
                if !is_lucky_bonus_only {
                    defender_entity.taken.trigger_hits += 1;
                    if is_attacked_lucky_trigger {
                        defender_entity.taken.lucky_hits += 1;
                    }
                    if is_block {
                        defender_entity.taken.block_hits += 1;
                        if is_attacked_lucky_trigger {
                            defender_entity.taken.lucky_block_hits += 1;
                        }
                    }
                } else {
                    defender_entity.taken.lucky_total += effective_value;
                }
                defender_entity.taken.hits += 1;
                defender_entity.taken.total += effective_value;

                let taken_skill = defender_entity
                    .skill_uid_to_taken_skill
                    .entry(skill_key)
                    .or_default();
                apply_taken_skill_delta(
                    taken_skill,
                    effective_value,
                    is_crit,
                    is_lucky_bonus_only,
                    is_attacked_lucky_trigger,
                    is_block,
                    sync_damage_info.property,
                    sync_damage_info.damage_mode,
                );

                let source_skill = defender_entity
                    .skill_taken_from_source
                    .entry((skill_key, attacker_monster_type_id.unwrap_or(0)))
                    .or_default();
                apply_taken_skill_delta(
                    source_skill,
                    effective_value,
                    is_crit,
                    is_lucky_bonus_only,
                    is_attacked_lucky_trigger,
                    is_block,
                    sync_damage_info.property,
                    sync_damage_info.damage_mode,
                );

                const REPLAY_WINDOW_MS: u128 = 2000;
                while defender_entity
                    .recent_taken_events
                    .front()
                    .is_some_and(|ev| {
                        timestamp_ms.saturating_sub(ev.timestamp_ms) > REPLAY_WINDOW_MS
                    })
                {
                    defender_entity.recent_taken_events.pop_front();
                }
                defender_entity
                    .recent_taken_events
                    .push_back(DamageSnapshot {
                        timestamp_ms,
                        attacker_uid,
                        attacker_monster_type_id,
                        skill_key,
                        value: actual_value,
                    });
            }
        }
    }

    if had_player_damage {
        update_active_damage_time(encounter, timestamp_ms);
    }

    if had_allowed_combat {
        if encounter.time_fight_start_ms == Default::default() {
            encounter.time_fight_start_ms = timestamp_ms;
        }

        encounter.time_last_combat_packet_ms = timestamp_ms;
    }
    Some((local_damage_events, local_damage_taken_events))
}

fn decode_varint_i64(raw: &[u8]) -> Option<i64> {
    let mut buf = raw;
    prost::encoding::decode_varint(&mut buf)
        .ok()
        .map(|v| v as i64)
}

#[derive(Clone, PartialEq, prost::Message)]
struct HateInfoWire {
    #[prost(int64, tag = "1")]
    uuid: i64,
    #[prost(uint32, tag = "2")]
    hate_val: u32,
}

fn parse_hate_list_into(raw: &[u8], entries: &mut Vec<HateEntry>) -> Option<()> {
    let mut buf = raw;
    entries.clear();

    while buf.has_remaining() {
        let tag = prost::encoding::decode_varint(&mut buf).ok()?;
        if tag != 0x0A {
            return None;
        }

        let entry = <HateInfoWire as prost::Message>::decode_length_delimited(&mut buf).ok()?;
        entries.push(HateEntry {
            entity_uuid: (entry.uuid != 0).then_some(entry.uuid),
            uid: uid_from_uuid(entry.uuid),
            hate_val: entry.hate_val,
        });
    }

    Some(())
}

fn decode_varint_i64_or_default(raw: Option<&[u8]>) -> i64 {
    raw.and_then(decode_varint_i64).unwrap_or(0)
}

/// Decodes attr 60050 shield display data into individual entries.
/// Each entry: field 1=buff_uuid, field 2=display_type, field 3=current, field 4=initial shield, field 5=max shield.
fn decode_shield_detail_entries(raw: &[u8]) -> Vec<ShieldDetailEntry> {
    let mut buf = raw;
    let mut entries = Vec::new();
    while buf.has_remaining() {
        let Some(tag) = prost::encoding::decode_varint(&mut buf).ok() else {
            break;
        };
        if tag != 0x0A {
            break;
        }
        let Some(entry_len) = prost::encoding::decode_varint(&mut buf)
            .ok()
            .map(|v| v as usize)
        else {
            break;
        };
        if buf.remaining() < entry_len {
            break;
        }
        let entry_bytes = &buf[..entry_len];
        buf.advance(entry_len);

        let mut entry_buf = entry_bytes;
        let mut buff_uuid: i64 = 0;
        let mut display_type: i32 = 0;
        let mut current: i64 = 0;
        let mut initial_shield: i64 = 0;
        let mut max_shield: i64 = 0;

        while entry_buf.has_remaining() {
            let Some(field_tag) = prost::encoding::decode_varint(&mut entry_buf).ok() else {
                break;
            };
            let field_num = field_tag >> 3;
            let wire_type = field_tag & 0x07;
            if wire_type != 0 {
                break;
            }
            let Some(val) = prost::encoding::decode_varint(&mut entry_buf).ok() else {
                break;
            };
            match field_num {
                1 => buff_uuid = val as i64,
                2 => display_type = val as i32,
                3 => current = val as i64,
                4 => initial_shield = val as i64,
                5 => max_shield = val as i64,
                _ => {}
            }
        }

        entries.push(ShieldDetailEntry {
            buff_uuid,
            display_type,
            current,
            initial_shield,
            max_shield,
            base_id: 0,
            expire_time_ms: 0,
        });
    }
    entries
}

fn decode_position_attr(raw: Option<&[u8]>) -> Option<PositionAttr> {
    let position = blueprotobuf::Position::decode(raw?).ok()?;
    Some(PositionAttr {
        x: position.x?,
        y: position.y?,
        z: position.z?,
    })
}

fn decode_prefixed_string(raw: &[u8]) -> Option<String> {
    let mut buf = raw;
    let len = prost::encoding::decode_varint(&mut buf).ok()? as usize;
    if buf.len() < len {
        return None;
    }
    String::from_utf8(buf[..len].to_vec()).ok()
}

fn decode_prefixed_string_or_default(raw: Option<&[u8]>) -> String {
    raw.and_then(decode_prefixed_string).unwrap_or_default()
}

fn decode_unknown_attr_value(attr_id: i32, raw: &[u8]) -> Option<(AttrType, AttrValue)> {
    if attr_id <= 0 || matches!(attr_id, attr_type::ATTR_ID | attr_type::ATTR_REDUCTION_ID) {
        return None;
    }
    if let Some(v) = decode_varint_i64(raw) {
        return Some((AttrType::Unknown(attr_id), AttrValue::Int(v)));
    }
    if let Some(s) = decode_prefixed_string(raw) {
        return Some((AttrType::Unknown(attr_id), AttrValue::String(s)));
    }
    let hex_str: String = raw
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<Vec<_>>()
        .join("");
    Some((
        AttrType::Unknown(attr_id),
        AttrValue::String(format!("0x{}", hex_str)),
    ))
}

fn retain_player_identity_attr(player_entity: &mut Entity, attr_type: AttrType, value: &AttrValue) {
    match attr_type {
        AttrType::Name => {
            if let Some(name) = value.as_string().filter(|name| !name.is_empty()) {
                player_entity.name = name.to_string();
            }
        }
        AttrType::ProfessionId => {
            if let Some(value) = value.as_int().filter(|value| *value > 0) {
                player_entity.class_id = value as i32;
            }
        }
        AttrType::FightPoint => {
            if let Some(value) = value.as_int().filter(|value| *value > 0) {
                player_entity.ability_score = value as i32;
            }
        }
        AttrType::SeasonStrength => {
            if let Some(value) = value.as_int().filter(|value| *value > 0) {
                player_entity.season_strength = value as i32;
            }
        }
        AttrType::Level => {
            if let Some(value) = value.as_int().filter(|value| *value > 0) {
                player_entity.level = value as i32;
            }
        }
        _ => {}
    }
}

fn process_player_attrs(
    player_entity: &mut Entity,
    target_uid: i64,
    attrs: Vec<Attr>,
    attr_store: &mut EntityAttrStore,
) {
    for attr in attrs {
        let Some(attr_id) = attr.id else { continue };
        let raw_bytes_opt = attr.raw_data.as_deref();

        if attr_id == attr_type::ATTR_FIGHT_RESOURCE_IDS {
            if let Some(ids) = raw_bytes_opt.and_then(parse_fight_resources).map(|values| {
                values
                    .into_iter()
                    .filter_map(|value| i32::try_from(value).ok())
                    .collect::<Vec<_>>()
            }) {
                let _ = attr_store.set_fight_resource_ids(target_uid, ids);
            }
            continue;
        }

        if attr_id == attr_type::ATTR_FIGHT_RESOURCES {
            if let Some(values) = raw_bytes_opt.and_then(parse_fight_resources) {
                log::debug!(
                    "Decoded ATTR_FIGHT_RESOURCES for UID {}: {:?}",
                    target_uid,
                    values
                );
            }
            continue;
        }

        if attr_id == ATTR_SHIELD_DISPLAY {
            let total_shield = raw_bytes_opt
                .map(|raw| {
                    decode_shield_detail_entries(raw)
                        .iter()
                        .map(|entry| entry.current)
                        .sum::<i64>()
                })
                .unwrap_or(0);
            attr_store.set_attr(
                target_uid,
                AttrType::CurrentShield,
                AttrValue::Int(total_shield),
            );
            continue;
        }

        if attr_id == attr_type::ATTR_POS {
            if let Some(position) = decode_position_attr(raw_bytes_opt) {
                let _ = attr_store.set_attr(
                    target_uid,
                    AttrType::Position,
                    AttrValue::Position(position),
                );
            }
            continue;
        }

        let decoded = if attr_id == attr_type::ATTR_NAME {
            let name = decode_prefixed_string_or_default(raw_bytes_opt);
            if !name.is_empty() {
                info!("Found player {} with UID {}", name, target_uid);
            }
            Some((AttrType::Name, AttrValue::String(name)))
        } else if let Some(attr_type) = AttrType::from_id(attr_id) {
            let value = decode_varint_i64_or_default(raw_bytes_opt);
            Some((attr_type, AttrValue::Int(value)))
        } else {
            raw_bytes_opt.and_then(|raw_bytes| decode_unknown_attr_value(attr_id, raw_bytes))
        };

        if let Some((attr_type, value)) = decoded {
            retain_player_identity_attr(player_entity, attr_type, &value);
            let _ = attr_store.set_attr(target_uid, attr_type, value);
        }
    }
}

fn process_monster_attrs(
    monster_entity: &mut Entity,
    target_uid: i64,
    target_uuid: Option<i64>,
    attrs: Vec<Attr>,
    attr_store: &mut EntityAttrStore,
) {
    for attr in attrs {
        let Some(attr_id) = attr.id else { continue };
        let raw_bytes_opt = attr.raw_data.as_deref();

        if attr_id == attr_type::ATTR_ID {
            if let Some(monster_id) =
                i32::try_from(decode_varint_i64_or_default(raw_bytes_opt)).ok()
            {
                if monster_id > 0 {
                    monster_entity.set_monster_type(monster_id);
                    let _ = attr_store.set_attr(
                        target_uid,
                        AttrType::MonsterId,
                        AttrValue::Int(i64::from(monster_id)),
                    );
                }
            }
            continue;
        }

        if attr_id == attr_type::ATTR_NAME {
            let name = decode_prefixed_string_or_default(raw_bytes_opt);
            monster_entity.monster_name_packet = Some(name.clone());
            if monster_entity.monster_type_id.is_none() {
                monster_entity.name = name;
            }
            continue;
        }

        if attr_id == attr_type::ATTR_HATE_LIST {
            let hate_list = attr_store.hate_list_mut(target_uuid.unwrap_or(target_uid));
            if let Some(raw) = raw_bytes_opt {
                let _ = parse_hate_list_into(raw, hate_list);
            } else {
                hate_list.clear();
            }
            continue;
        }

        if let Some(attr_type) = AttrType::from_id(attr_id) {
            let value = decode_varint_i64_or_default(raw_bytes_opt);
            let _ = attr_store.set_attr(target_uid, attr_type, AttrValue::Int(value));
        }
    }
}
