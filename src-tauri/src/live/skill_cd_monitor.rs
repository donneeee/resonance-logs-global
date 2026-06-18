use crate::database::now_ms;
use crate::live::buff_monitor::{ActiveBuff, BuffChangeEvent};
use crate::live::commands_models::{SkillCdSourceState, SkillCdState};
use crate::live::entity_attr_store::EntityAttrStore;
use crate::live::opcodes_models::{
    AttrType, ObservedEffectSource, ObservedGearSet, ObservedProfessionSkill, attr_type,
};
use crate::live::opcodes_process::ParsedSkillCd;
use crate::parser_data;
use log::{debug, warn};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

const TEMP_ATTR_TABLE_RELATIVE: &str = "logic/TempAttrTable.json";
const SKILL_EFFECT_TABLE_RELATIVE: &str = "logic/SkillEffectTable.json";
const TAG_NO_CD_REDUCE: i32 = 103;
const TAG_SPECIAL_ATTACK: i32 = 3;
const TAG_EXPERTISE_SKILL: i32 = 4;
const TAG_ULTIMATE_SKILL: i32 = 5;
const TAG_HASTE: i32 = 81;
const BUFF_ENDLESS_MIND: i32 = 3003410;
const BUFF_SWIFTFLOW: i32 = 3003440;
const BUFF_RESURGE: i32 = 3003450;
const BUFF_TIME_SLIT_DREAM: i32 = 3002240;
const BUFF_FOCUS: i32 = 55223;
const BUFF_RADIANT_SPIRIT: i32 = 2203150;
const BUFF_CELESTIAL_EAGLE: i32 = 2203600;
const BUFF_IMAGINE_ACCELERATION_ROGUE_ENTRY: i32 = 997470;
const BUFF_IMAGINE_ACCELERATION_DEEP_SLUMBER: i32 = 3004010;
const BUFF_IMAGINE_ACCELERATION_DEEP_SLUMBER_ALT: i32 = 3010410;
const SKILL_FOCUS: i32 = 2231;
const SEASON_TALENT_ULTIMATE_CHARGE: u32 = 107;
const SEASON_TALENT_SWIFTFLOW: u32 = 1704;
const TALENT_RAGING_FLAME_SHARPNESS_II: u32 = 348;
const TALENT_CELESTIAL_EAGLE: u32 = 1160;
const ULTIMATE_CHARGE_HASTE_STEP: f32 = 200.0;
const ULTIMATE_CHARGE_REDUCTION_PER_STEP: f32 = 0.01;
const ULTIMATE_CHARGE_MAX_REDUCTION: f32 = 0.50;
const SWIFTFLOW_ACCEL_PER_ENDLESS_MIND_STACK: f32 = 0.025;
const FOCUS_CELESTIAL_EAGLE_ACCEL_PER_HASTE_PERCENT: f32 = 0.01;
const RESURGE_ULTIMATE_ACCEL: f32 = 0.15;
const TIME_SLIT_DREAM_CD_REDUCTION: f32 = 0.22;
const RAGING_FLAME_SHARPNESS_ACCEL_PER_HASTE_PERCENT: f32 = 0.005;
const BATTLE_IMAGINE_CD_REDUCTION: f32 = 0.80;
const MIN_OBSERVED_PROGRESS_RATE: f32 = 0.75;
const MAX_OBSERVED_PROGRESS_RATE: f32 = 5.0;
const OBSERVED_PROGRESS_SMOOTHING: f32 = 0.45;

#[derive(Debug, Clone, Deserialize)]
struct RawTempAttrDef {
    #[serde(rename = "Id")]
    id: i32,
    #[serde(rename = "AttrType")]
    attr_type: i32,
    #[serde(rename = "LogicType")]
    logic_type: i32,
    #[serde(rename = "AttrParams", default)]
    attr_params: Vec<i32>,
}

#[derive(Debug, Clone)]
struct CdTempAttrDef {
    attr_type: i32,
    logic_type: i32,
    attr_params: Vec<i32>,
}

#[derive(Debug, Clone)]
pub(crate) struct SkillCdCalculation {
    pub duration: f32,
    pub accelerate_rate: f32,
    pub sources: Vec<SkillCdSourceState>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct SkillCdRuntimeSnapshot<'a> {
    active_buffs: &'a HashMap<i32, ActiveBuff>,
    final_stats: SkillCdFinalStats,
    active_profession_skills: &'a [ObservedProfessionSkill],
    active_effect_sources: &'a [ObservedEffectSource],
    active_gear_sets: &'a [ObservedGearSet],
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct SkillCdFinalStats {
    pub strength: f32,
    pub endurance: f32,
    pub agility: f32,
    pub versatility: f32,
    pub haste: f32,
    pub mastery: f32,
    pub lucky: f32,
    pub crit: f32,
    pub crit_damage: f32,
}

#[derive(Debug, Default)]
struct SkillCdRuntimeContributions {
    flat_reduce: f32,
    pct_reduce: f32,
    accelerate: f32,
}

impl<'a> SkillCdRuntimeSnapshot<'a> {
    pub(crate) fn new(
        active_buffs: &'a HashMap<i32, ActiveBuff>,
        final_stats: SkillCdFinalStats,
    ) -> Self {
        Self {
            active_buffs,
            final_stats,
            active_profession_skills: &[],
            active_effect_sources: &[],
            active_gear_sets: &[],
        }
    }

    pub(crate) fn with_active_profession_skills(
        mut self,
        active_profession_skills: &'a [ObservedProfessionSkill],
    ) -> Self {
        self.active_profession_skills = active_profession_skills;
        self
    }

    pub(crate) fn with_active_effect_sources(
        mut self,
        active_effect_sources: &'a [ObservedEffectSource],
    ) -> Self {
        self.active_effect_sources = active_effect_sources;
        self
    }

    pub(crate) fn with_active_gear_sets(mut self, active_gear_sets: &'a [ObservedGearSet]) -> Self {
        self.active_gear_sets = active_gear_sets;
        self
    }

    pub(crate) fn from_attr_store(
        active_buffs: &'a HashMap<i32, ActiveBuff>,
        attr_store: &EntityAttrStore,
    ) -> Self {
        Self::new(active_buffs, SkillCdFinalStats::from_attr_store(attr_store))
    }
}

impl SkillCdFinalStats {
    fn from_attr_store(attr_store: &EntityAttrStore) -> Self {
        Self {
            strength: final_stat_value(
                attr_store,
                attr_type::ATTR_PANEL_STRENGTH,
                Some(AttrType::BaseStrength),
            ),
            endurance: direct_stat_value(attr_store, AttrType::Endurance),
            agility: final_stat_value(attr_store, attr_type::ATTR_PANEL_AGILITY, None),
            versatility: final_stat_value(attr_store, attr_type::ATTR_PANEL_VERSATILITY, None),
            haste: final_stat_value(
                attr_store,
                attr_type::ATTR_PANEL_HASTE,
                Some(AttrType::Haste),
            ),
            mastery: final_stat_value(
                attr_store,
                attr_type::ATTR_PANEL_MASTERY,
                Some(AttrType::Mastery),
            ),
            lucky: final_stat_value(
                attr_store,
                attr_type::ATTR_PANEL_LUCKY,
                Some(AttrType::Lucky),
            ),
            crit: final_stat_value(
                attr_store,
                attr_type::ATTR_PANEL_CRIT_RATE,
                Some(AttrType::Crit),
            ),
            crit_damage: final_stat_value(attr_store, attr_type::ATTR_PANEL_CRIT_DAMAGE, None),
        }
    }

    fn haste_raw(&self) -> f32 {
        self.haste
    }
}

fn final_stat_value(
    attr_store: &EntityAttrStore,
    panel_attr_id: i32,
    fallback_attr_type: Option<AttrType>,
) -> f32 {
    attr_store
        .local_attr_int(AttrType::Unknown(panel_attr_id))
        .or_else(|| attr_store.panel_attr_value(panel_attr_id).map(i64::from))
        .or_else(|| fallback_attr_type.and_then(|attr_type| attr_store.local_attr_int(attr_type)))
        .unwrap_or(0) as f32
}

fn direct_stat_value(attr_store: &EntityAttrStore, attr_type: AttrType) -> f32 {
    attr_store.local_attr_int(attr_type).unwrap_or(0) as f32
}

#[derive(Debug, Clone, Deserialize)]
struct RawSkillEffectEntry {
    #[serde(rename = "Tags", default)]
    tags: Vec<i32>,
}

static CD_TEMP_ATTR_DEFS: LazyLock<HashMap<i32, CdTempAttrDef>> = LazyLock::new(|| {
    load_cd_temp_attr_defs().unwrap_or_else(|err| {
        warn!("[skill-cd] failed to load TempAttrTable.json: {}", err);
        HashMap::new()
    })
});

static SKILL_EFFECT_TAGS: LazyLock<HashMap<i32, Vec<i32>>> = LazyLock::new(|| {
    load_skill_effect_tags().unwrap_or_else(|err| {
        warn!("[skill-cd] failed to load SkillEffectTable.json: {}", err);
        HashMap::new()
    })
});

#[derive(Debug, Default)]
pub struct SkillCdMonitor {
    /// Skill cooldown map keyed by skill level ID.
    pub skill_cd_map: HashMap<i32, SkillCdState>,
    /// Ordered list of monitored skill IDs.
    pub monitored_skill_ids: Vec<i32>,
}

impl SkillCdMonitor {
    pub(crate) fn new() -> Self {
        Self {
            skill_cd_map: HashMap::new(),
            monitored_skill_ids: Vec::new(),
        }
    }

    pub(crate) fn recalculate_cached_skill_cds(
        &mut self,
        attr_store: &EntityAttrStore,
        active_talent_node_ids: &[u32],
        runtime: SkillCdRuntimeSnapshot<'_>,
    ) {
        let (attr_skill_cd, attr_skill_cd_pct, attr_cd_accelerate_pct) = attr_store.cd_inputs();
        for cd in self.skill_cd_map.values_mut() {
            if cd.duration > 0 {
                let calculation = calculate_skill_cd_with_sources(
                    cd.duration as f32,
                    cd.skill_level_id,
                    attr_store.temp_attrs(),
                    attr_skill_cd,
                    attr_skill_cd_pct,
                    attr_cd_accelerate_pct,
                    active_talent_node_ids,
                    Some(runtime),
                );
                cd.calculated_duration = calculation.duration.round() as i32;
                cd.cd_accelerate_rate = calculation.accelerate_rate;
                cd.cd_sources = calculation.sources;
            } else {
                cd.calculated_duration = cd.duration;
                cd.cd_accelerate_rate = 0.0;
                cd.observed_progress_rate = 0.0;
                cd.cd_sources.clear();
            }
        }
    }

    pub(crate) fn build_filtered_skill_cds(&self) -> Vec<SkillCdState> {
        if self.monitored_skill_ids.is_empty() {
            return Vec::new();
        }
        let mut filtered = Vec::with_capacity(self.monitored_skill_ids.len());
        for monitored_skill_id in &self.monitored_skill_ids {
            if let Some(cd) = self
                .skill_cd_map
                .values()
                .filter(|cd| skill_cd_matches_monitored(cd.skill_level_id, *monitored_skill_id))
                .max_by_key(|cd| cd.received_at)
                .cloned()
            {
                filtered.push(cd);
            }
        }
        filtered
    }

    pub(crate) fn apply_skill_cd_updates(
        &mut self,
        skill_cds: &[ParsedSkillCd],
        attr_store: &EntityAttrStore,
        active_talent_node_ids: &[u32],
        runtime: SkillCdRuntimeSnapshot<'_>,
    ) {
        let now = now_ms();
        for cd in skill_cds {
            let Some(id) = cd.skill_level_id else {
                continue;
            };
            let Some(base_id) = monitored_base_id_for_skill_cd(id, &self.monitored_skill_ids)
            else {
                continue;
            };

            let duration = cd.duration.unwrap_or(0);
            let begin_time = cd.begin_time.unwrap_or(0);
            let (attr_skill_cd, attr_skill_cd_pct, attr_cd_accelerate_pct) = attr_store.cd_inputs();
            let calculation = if duration > 0 {
                calculate_skill_cd_with_sources(
                    duration as f32,
                    id,
                    attr_store.temp_attrs(),
                    attr_skill_cd,
                    attr_skill_cd_pct,
                    attr_cd_accelerate_pct,
                    active_talent_node_ids,
                    Some(runtime),
                )
            } else {
                SkillCdCalculation {
                    duration: duration as f32,
                    accelerate_rate: 0.0,
                    sources: Vec::new(),
                }
            };
            let previous = self.skill_cd_map.get(&id);
            let valid_cd_time = cd.valid_cd_time.unwrap_or(0);
            let packet_sub_cd_ratio = cd.sub_cd_ratio.unwrap_or(0);
            let packet_sub_cd_fixed = cd.sub_cd_fixed.unwrap_or(0);
            let packet_accelerate_cd_ratio = cd.accelerate_cd_ratio.unwrap_or(0);
            let packet_accelerate_rate = packet_cd_accelerate_rate(packet_accelerate_cd_ratio);
            let effective_accelerate_rate =
                packet_accelerate_rate.unwrap_or(calculation.accelerate_rate);
            let formula_progress_rate = (1.0 + effective_accelerate_rate).max(1.0);
            let observed_progress_rate = observe_progress_rate(
                previous,
                begin_time,
                valid_cd_time,
                now,
                formula_progress_rate,
            );
            let (anchored_valid_cd_time, anchored_received_at) =
                cooldown_progress_anchor(previous, begin_time, valid_cd_time, now);
            let anchor_preserved =
                anchored_valid_cd_time != valid_cd_time || anchored_received_at != now;

            debug!(
                "[skill-cd-trace] skill_level_id={} base_id={} begin_time={} duration_ms={} raw_valid_ms={} anchored_valid_ms={} raw_received_at={} anchored_received_at={} observed_rate={:.3} accel_rate={:.3} packet_sub_ratio={} packet_sub_fixed={} packet_accel_ratio={} calculated_ms={} anchor_preserved={}",
                id,
                base_id,
                begin_time,
                duration,
                valid_cd_time,
                anchored_valid_cd_time,
                now,
                anchored_received_at,
                observed_progress_rate,
                effective_accelerate_rate,
                packet_sub_cd_ratio,
                packet_sub_cd_fixed,
                packet_accelerate_cd_ratio,
                calculation.duration.round() as i32,
                anchor_preserved
            );

            self.skill_cd_map.insert(
                id,
                SkillCdState {
                    skill_level_id: id,
                    begin_time,
                    duration,
                    skill_cd_type: cd.skill_cd_type.unwrap_or(0),
                    valid_cd_time: anchored_valid_cd_time,
                    received_at: anchored_received_at,
                    calculated_duration: calculation.duration.round() as i32,
                    cd_accelerate_rate: effective_accelerate_rate,
                    observed_progress_rate,
                    packet_sub_cd_ratio,
                    packet_sub_cd_fixed,
                    packet_accelerate_cd_ratio,
                    cd_sources: calculation.sources,
                },
            );
        }
    }
}

fn skill_cd_matches_monitored(skill_id: i32, monitored_skill_id: i32) -> bool {
    skill_id == monitored_skill_id || skill_id / 100 == monitored_skill_id
}

fn monitored_base_id_for_skill_cd(skill_id: i32, monitored_skill_ids: &[i32]) -> Option<i32> {
    monitored_skill_ids
        .iter()
        .copied()
        .find(|monitored_skill_id| skill_cd_matches_monitored(skill_id, *monitored_skill_id))
}

fn cooldown_progress_anchor(
    previous: Option<&SkillCdState>,
    begin_time: i64,
    valid_cd_time: i32,
    received_at: i64,
) -> (i32, i64) {
    let Some(previous) = previous else {
        return (valid_cd_time, received_at);
    };

    if previous.begin_time == begin_time && valid_cd_time <= previous.valid_cd_time {
        return (previous.valid_cd_time, previous.received_at);
    }

    (valid_cd_time, received_at)
}

fn observe_progress_rate(
    previous: Option<&SkillCdState>,
    begin_time: i64,
    valid_cd_time: i32,
    received_at: i64,
    formula_progress_rate: f32,
) -> f32 {
    let inherited = previous
        .map(|cd| cd.observed_progress_rate)
        .filter(|rate| is_reasonable_observed_rate(*rate));

    let Some(previous) = previous else {
        return 0.0;
    };

    if previous.begin_time != begin_time {
        return 0.0;
    }

    let wall_delta = received_at.saturating_sub(previous.received_at);
    let progress_delta = valid_cd_time.saturating_sub(previous.valid_cd_time);
    if wall_delta <= 0 || progress_delta <= 0 {
        return inherited.unwrap_or(0.0);
    }

    let measured = progress_delta as f32 / wall_delta as f32;
    let Some(measured) = normalize_observed_rate(measured) else {
        return inherited.unwrap_or(0.0);
    };

    let baseline = inherited.unwrap_or_else(|| formula_progress_rate.max(1.0));
    baseline + ((measured - baseline) * OBSERVED_PROGRESS_SMOOTHING)
}

fn normalize_observed_rate(rate: f32) -> Option<f32> {
    if !is_reasonable_observed_rate(rate) {
        return None;
    }
    Some(rate.max(1.0))
}

fn is_reasonable_observed_rate(rate: f32) -> bool {
    rate.is_finite() && (MIN_OBSERVED_PROGRESS_RATE..=MAX_OBSERVED_PROGRESS_RATE).contains(&rate)
}

fn packet_cd_accelerate_rate(raw_ratio: i32) -> Option<f32> {
    if raw_ratio <= 0 {
        return None;
    }
    let rate = raw_ratio as f32 / 10_000.0;
    if rate.is_finite() && (0.0..=MAX_OBSERVED_PROGRESS_RATE).contains(&rate) {
        Some(rate)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill_cd_state(begin_time: i64, valid_cd_time: i32, received_at: i64) -> SkillCdState {
        SkillCdState {
            skill_level_id: 223101,
            begin_time,
            duration: 45_000,
            skill_cd_type: 0,
            valid_cd_time,
            received_at,
            calculated_duration: 45_000,
            cd_accelerate_rate: 0.0,
            observed_progress_rate: 0.0,
            packet_sub_cd_ratio: 0,
            packet_sub_cd_fixed: 0,
            packet_accelerate_cd_ratio: 0,
            cd_sources: Vec::new(),
        }
    }

    #[test]
    fn stale_cooldown_packet_preserves_existing_anchor() {
        let previous = skill_cd_state(10_000, 12_000, 20_000);

        assert_eq!(
            cooldown_progress_anchor(Some(&previous), 10_000, 12_000, 20_500),
            (12_000, 20_000)
        );
        assert_eq!(
            cooldown_progress_anchor(Some(&previous), 10_000, 11_500, 20_500),
            (12_000, 20_000)
        );
    }

    #[test]
    fn advancing_or_new_cooldown_packet_refreshes_anchor() {
        let previous = skill_cd_state(10_000, 12_000, 20_000);

        assert_eq!(
            cooldown_progress_anchor(Some(&previous), 10_000, 13_500, 21_000),
            (13_500, 21_000)
        );
        assert_eq!(
            cooldown_progress_anchor(Some(&previous), 11_000, 0, 21_500),
            (0, 21_500)
        );
    }

    #[test]
    fn cooldown_id_matching_accepts_base_and_level_ids() {
        assert!(skill_cd_matches_monitored(2231, 2231));
        assert!(skill_cd_matches_monitored(223101, 2231));
        assert_eq!(monitored_base_id_for_skill_cd(2231, &[2231]), Some(2231));
        assert_eq!(monitored_base_id_for_skill_cd(223101, &[2231]), Some(2231));
        assert_eq!(monitored_base_id_for_skill_cd(223101, &[2238]), None);
    }

    #[test]
    fn talent_family_matching_accepts_full_node_ids() {
        assert!(active_talent_node_matches(
            &[1160001],
            TALENT_CELESTIAL_EAGLE
        ));
        assert!(active_talent_node_matches(
            &[348003],
            TALENT_RAGING_FLAME_SHARPNESS_II
        ));
        assert!(active_talent_node_matches(
            &[TALENT_CELESTIAL_EAGLE],
            TALENT_CELESTIAL_EAGLE
        ));
        assert!(!active_talent_node_matches(
            &[1160001],
            TALENT_RAGING_FLAME_SHARPNESS_II
        ));
    }

    #[test]
    fn packet_cd_accelerate_ratio_uses_attr_scale() {
        assert_eq!(packet_cd_accelerate_rate(0), None);
        assert_eq!(packet_cd_accelerate_rate(250), Some(0.025));
        assert_eq!(packet_cd_accelerate_rate(3071), Some(0.3071));
    }

    #[test]
    fn new_cooldown_does_not_inherit_previous_observed_rate() {
        let mut previous = skill_cd_state(10_000, 12_000, 20_000);
        previous.observed_progress_rate = 1.45;

        assert_eq!(
            observe_progress_rate(Some(&previous), 11_000, 0, 21_000, 1.15),
            0.0
        );
    }

    #[test]
    fn same_cooldown_observed_rate_blends_from_formula_baseline() {
        let previous = skill_cd_state(10_000, 12_000, 20_000);
        let observed = observe_progress_rate(Some(&previous), 10_000, 13_500, 21_000, 1.10);

        assert!(observed > 1.10);
        assert!(observed < 1.50);
    }
}

fn load_cd_temp_attr_defs() -> Result<HashMap<i32, CdTempAttrDef>, Box<dyn std::error::Error>> {
    let contents = parser_data::read_to_string(TEMP_ATTR_TABLE_RELATIVE)?;
    let raw_map: HashMap<String, RawTempAttrDef> = serde_json::from_str(&contents)?;

    let mut result = HashMap::new();
    for raw in raw_map.into_values() {
        // 100 = pct reduce, 101 = flat reduce, 103 = accelerate pct
        if raw.attr_type != 100 && raw.attr_type != 101 && raw.attr_type != 103 {
            continue;
        }
        result.insert(
            raw.id,
            CdTempAttrDef {
                attr_type: raw.attr_type,
                logic_type: raw.logic_type,
                attr_params: raw.attr_params,
            },
        );
    }
    Ok(result)
}

fn load_skill_effect_tags() -> Result<HashMap<i32, Vec<i32>>, Box<dyn std::error::Error>> {
    let contents = parser_data::read_to_string(SKILL_EFFECT_TABLE_RELATIVE)?;
    let raw_map: HashMap<String, RawSkillEffectEntry> = serde_json::from_str(&contents)?;

    let mut result = HashMap::new();
    for (key, value) in raw_map {
        if let Ok(skill_level_id) = key.parse::<i32>() {
            result.insert(skill_level_id, value.tags);
        }
    }
    Ok(result)
}

fn temp_attr_matches(def: &CdTempAttrDef, skill_id: i32, skill_tags: &HashSet<i32>) -> bool {
    match def.logic_type {
        0 => true,
        1 => def.attr_params.contains(&skill_id),
        3 => def.attr_params.iter().any(|tag| skill_tags.contains(tag)),
        _ => false,
    }
}

pub(crate) fn calculate_skill_cd(
    base_cd: f32,
    skill_level_id: i32,
    temp_attr_values: &HashMap<i32, i32>,
    attr_skill_cd: f32,
    attr_skill_cd_pct: f32,
    attr_cd_accelerate_pct: f32,
) -> (f32, f32) {
    let calculation = calculate_skill_cd_with_sources(
        base_cd,
        skill_level_id,
        temp_attr_values,
        attr_skill_cd,
        attr_skill_cd_pct,
        attr_cd_accelerate_pct,
        &[],
        None,
    );
    (calculation.duration, calculation.accelerate_rate)
}

pub(crate) fn calculate_skill_cd_with_sources(
    base_cd: f32,
    skill_level_id: i32,
    temp_attr_values: &HashMap<i32, i32>,
    attr_skill_cd: f32,
    attr_skill_cd_pct: f32,
    attr_cd_accelerate_pct: f32,
    active_talent_node_ids: &[u32],
    runtime: Option<SkillCdRuntimeSnapshot<'_>>,
) -> SkillCdCalculation {
    let temp_attrs_nonzero: Vec<(i32, i32)> = temp_attr_values
        .iter()
        .filter(|(_, v)| **v != 0)
        .map(|(k, v)| (*k, *v))
        .collect();
    debug!(
        "[skill-cd] calc skill_level_id={} base_cd={} attr_skill_cd={} attr_skill_cd_pct={} attr_cd_accelerate_pct={} temp_attrs={:?}",
        skill_level_id,
        base_cd,
        attr_skill_cd,
        attr_skill_cd_pct,
        attr_cd_accelerate_pct,
        temp_attrs_nonzero
    );

    if base_cd <= 0.0 {
        debug!("[skill-cd]   base_cd<=0, return (0.0, 0.0)");
        return SkillCdCalculation {
            duration: 0.0,
            accelerate_rate: 0.0,
            sources: Vec::new(),
        };
    }

    let skill_id = skill_level_id / 100;
    let tag_lookup_skill_level_id = skill_id * 100 + 1;
    let skill_tags_vec = SKILL_EFFECT_TAGS
        .get(&tag_lookup_skill_level_id)
        .cloned()
        .unwrap_or_default();
    let skill_tags: HashSet<i32> = skill_tags_vec.iter().copied().collect();
    debug!(
        "[skill-cd]   skill_id={} tag_lookup={} skill_tags={:?}",
        skill_id, tag_lookup_skill_level_id, skill_tags_vec
    );
    let talent_snapshot_sources = build_talent_snapshot_sources(active_talent_node_ids);
    let runtime_sources = runtime
        .map(|snapshot| {
            build_runtime_cd_sources(
                snapshot,
                skill_id,
                &skill_tags,
                &skill_tags_vec,
                active_talent_node_ids,
            )
        })
        .unwrap_or_default();

    if skill_tags.contains(&TAG_NO_CD_REDUCE) {
        debug!(
            "[skill-cd]   skill has TAG_NO_CD_REDUCE(103), no reduction applied, return (base_cd={}, accelerate=0.0)",
            base_cd
        );
        let mut sources = vec![SkillCdSourceState {
            source_key: format!("skill-tag-{}", TAG_NO_CD_REDUCE),
            source_kind: "skillTag".to_string(),
            attr_type: TAG_NO_CD_REDUCE,
            temp_attr_id: None,
            logic_type: None,
            attr_params: Vec::new(),
            skill_tags: skill_tags_vec.clone(),
            value: 0.0,
            contribution: 0.0,
            contribution_kind: "noCdReduction".to_string(),
            scope: "skillTag".to_string(),
        }];
        sources.extend(talent_snapshot_sources);
        sources.extend(runtime_sources);
        return SkillCdCalculation {
            duration: base_cd.max(0.0),
            accelerate_rate: 0.0,
            sources,
        };
    }

    let mut flat_reduce = attr_skill_cd;
    let mut pct_reduce = attr_skill_cd_pct / 10000.0;
    let mut accelerate = attr_cd_accelerate_pct / 10000.0;
    let mut sources = talent_snapshot_sources;
    let runtime_contributions = runtime_cd_contributions(&runtime_sources);
    flat_reduce += runtime_contributions.flat_reduce;
    pct_reduce += runtime_contributions.pct_reduce;
    accelerate += runtime_contributions.accelerate;
    sources.extend(runtime_sources);
    if attr_skill_cd != 0.0 {
        sources.push(SkillCdSourceState {
            source_key: "attr-skill-cd".to_string(),
            source_kind: "attr".to_string(),
            attr_type: 101,
            temp_attr_id: None,
            logic_type: None,
            attr_params: Vec::new(),
            skill_tags: skill_tags_vec.clone(),
            value: attr_skill_cd,
            contribution: attr_skill_cd,
            contribution_kind: "flatReduceMs".to_string(),
            scope: "global".to_string(),
        });
    }
    if attr_skill_cd_pct != 0.0 {
        sources.push(SkillCdSourceState {
            source_key: "attr-skill-cd-pct".to_string(),
            source_kind: "attr".to_string(),
            attr_type: 100,
            temp_attr_id: None,
            logic_type: None,
            attr_params: Vec::new(),
            skill_tags: skill_tags_vec.clone(),
            value: attr_skill_cd_pct,
            contribution: pct_reduce,
            contribution_kind: "pctReduce".to_string(),
            scope: "global".to_string(),
        });
    }
    if attr_cd_accelerate_pct != 0.0 {
        sources.push(SkillCdSourceState {
            source_key: "attr-cd-accelerate-pct".to_string(),
            source_kind: "attr".to_string(),
            attr_type: 103,
            temp_attr_id: None,
            logic_type: None,
            attr_params: Vec::new(),
            skill_tags: skill_tags_vec.clone(),
            value: attr_cd_accelerate_pct,
            contribution: accelerate,
            contribution_kind: "accelerate".to_string(),
            scope: "global".to_string(),
        });
    }
    debug!(
        "[skill-cd]   init flat_reduce={} pct_reduce={} accelerate={} runtime_contrib={:?}",
        flat_reduce, pct_reduce, accelerate, runtime_contributions
    );

    for (temp_attr_id, value) in temp_attr_values {
        if *value == 0 {
            continue;
        }
        let Some(def) = CD_TEMP_ATTR_DEFS.get(temp_attr_id) else {
            debug!(
                "[skill-cd]   temp_attr {} value={} def_found=false (not in CD_TEMP_ATTR_DEFS), skip",
                temp_attr_id, value
            );
            continue;
        };
        let matches = temp_attr_matches(def, skill_id, &skill_tags);
        if !matches {
            debug!(
                "[skill-cd]   temp_attr {} value={} def_found=true matches=false (attr_type={} logic_type={} params={:?}), skip",
                temp_attr_id, value, def.attr_type, def.logic_type, def.attr_params
            );
            continue;
        }

        match def.attr_type {
            101 => {
                let contrib = *value as f32 / 1000.0;
                flat_reduce += contrib;
                sources.push(build_temp_attr_source(
                    *temp_attr_id,
                    *value,
                    def,
                    contrib,
                    "flatReduceMs",
                    &skill_tags_vec,
                ));
                debug!(
                    "[skill-cd]   temp_attr {} value={} attr_type=101(flat) contrib={} -> flat_reduce={}",
                    temp_attr_id, value, contrib, flat_reduce
                );
            }
            100 => {
                let contrib = *value as f32 / 10000.0;
                pct_reduce += contrib;
                sources.push(build_temp_attr_source(
                    *temp_attr_id,
                    *value,
                    def,
                    contrib,
                    "pctReduce",
                    &skill_tags_vec,
                ));
                debug!(
                    "[skill-cd]   temp_attr {} value={} attr_type=100(pct) contrib={} -> pct_reduce={}",
                    temp_attr_id, value, contrib, pct_reduce
                );
            }
            103 => {
                let contrib = *value as f32 / 10000.0;
                accelerate += contrib;
                sources.push(build_temp_attr_source(
                    *temp_attr_id,
                    *value,
                    def,
                    contrib,
                    "accelerate",
                    &skill_tags_vec,
                ));
                debug!(
                    "[skill-cd]   temp_attr {} value={} attr_type=103(accelerate) contrib={} -> accelerate={}",
                    temp_attr_id, value, contrib, accelerate
                );
            }
            _ => {}
        }
    }

    debug!(
        "[skill-cd]   final flat_reduce={} pct_reduce={} accelerate={}",
        flat_reduce, pct_reduce, accelerate
    );

    let reduced_cd = ((1.0 - pct_reduce) * (base_cd - flat_reduce)).max(0.0);
    debug!(
        "[skill-cd]   reduced_cd=(1-{})*({}-{})={}",
        pct_reduce, base_cd, flat_reduce, reduced_cd
    );

    debug!(
        "[skill-cd]   final_result actual_cd={} accelerate_rate={}",
        reduced_cd, accelerate
    );
    SkillCdCalculation {
        duration: reduced_cd,
        accelerate_rate: accelerate,
        sources,
    }
}

fn runtime_cd_contributions(sources: &[SkillCdSourceState]) -> SkillCdRuntimeContributions {
    let mut contributions = SkillCdRuntimeContributions::default();
    for source in sources {
        match source.contribution_kind.as_str() {
            "flatReduceMs" => contributions.flat_reduce += source.contribution,
            "pctReduce" => contributions.pct_reduce += source.contribution,
            "accelerate" => contributions.accelerate += source.contribution,
            _ => {}
        }
    }
    contributions
}

pub(crate) fn buff_changes_affect_skill_cd(changes: &[BuffChangeEvent]) -> bool {
    changes.iter().any(|change| {
        matches!(
            change.base_id,
            BUFF_ENDLESS_MIND
                | BUFF_SWIFTFLOW
                | BUFF_RESURGE
                | BUFF_TIME_SLIT_DREAM
                | BUFF_FOCUS
                | BUFF_RADIANT_SPIRIT
                | BUFF_CELESTIAL_EAGLE
                | BUFF_IMAGINE_ACCELERATION_ROGUE_ENTRY
                | BUFF_IMAGINE_ACCELERATION_DEEP_SLUMBER
                | BUFF_IMAGINE_ACCELERATION_DEEP_SLUMBER_ALT
        )
    })
}

fn build_runtime_cd_sources(
    runtime: SkillCdRuntimeSnapshot<'_>,
    skill_id: i32,
    skill_tags: &HashSet<i32>,
    skill_tags_vec: &[i32],
    active_talent_node_ids: &[u32],
) -> Vec<SkillCdSourceState> {
    let mut sources = Vec::new();
    let final_haste_raw = runtime.final_stats.haste_raw();
    let endless_mind = active_buff_by_base_id(runtime.active_buffs, BUFF_ENDLESS_MIND);
    let swiftflow = active_buff_by_base_id(runtime.active_buffs, BUFF_SWIFTFLOW);

    sources.extend(build_gear_set_evidence_sources(
        runtime.active_gear_sets,
        skill_tags_vec,
    ));

    if let Some(buff) = endless_mind {
        sources.push(build_active_buff_source(
            "season-talent-node:1701",
            "Endless Mind",
            buff,
            "activeBuffStack",
            buff.layer as f32,
            0.0,
            "activeBuff",
            skill_tags_vec,
        ));
    }

    if active_profession_skill_matches_battle_imagine(runtime.active_profession_skills, skill_id) {
        if let Some((source_key, buff)) = active_imagine_acceleration_buff(runtime.active_buffs) {
            sources.push(build_active_buff_source(
                source_key,
                "Imagine Acceleration",
                buff,
                "pctReduce",
                80.0,
                BATTLE_IMAGINE_CD_REDUCTION,
                "battleImagine",
                skill_tags_vec,
            ));
        }
    }

    if let Some(endless_mind_buff) = endless_mind {
        let stacks = endless_mind_buff.layer.max(0) as f32;
        let swiftflow_selected =
            selected_season_talent_source(runtime.active_effect_sources, SEASON_TALENT_SWIFTFLOW);
        if skill_tags.contains(&TAG_EXPERTISE_SKILL)
            && stacks > 0.0
            && (swiftflow.is_some() || swiftflow_selected)
        {
            let contribution = stacks * SWIFTFLOW_ACCEL_PER_ENDLESS_MIND_STACK;
            if let Some(swiftflow_buff) = swiftflow {
                sources.push(build_active_buff_source(
                    "season-talent-node:1704",
                    "Swiftflow CD Boost",
                    swiftflow_buff,
                    "accelerate",
                    SWIFTFLOW_ACCEL_PER_ENDLESS_MIND_STACK,
                    contribution,
                    "expertiseSkill",
                    skill_tags_vec,
                ));
            } else {
                sources.push(SkillCdSourceState {
                    source_key: format!("season-talent-node:{}", SEASON_TALENT_SWIFTFLOW),
                    source_kind: "Swiftflow CD Boost".to_string(),
                    attr_type: BUFF_SWIFTFLOW,
                    temp_attr_id: None,
                    logic_type: None,
                    attr_params: vec![
                        SEASON_TALENT_SWIFTFLOW as i32,
                        BUFF_ENDLESS_MIND,
                        endless_mind_buff.layer,
                        endless_mind_buff.duration,
                    ],
                    skill_tags: skill_tags_vec.to_vec(),
                    value: stacks,
                    contribution,
                    contribution_kind: "accelerate".to_string(),
                    scope: "expertiseSkill:selectedSeasonTalent".to_string(),
                });
            }
        }
    }

    if skill_tags.contains(&TAG_EXPERTISE_SKILL)
        && active_talent_node_matches(active_talent_node_ids, TALENT_RAGING_FLAME_SHARPNESS_II)
        && final_haste_raw > 0.0
    {
        sources.push(build_talent_stat_source(
            "talent:348",
            "Raging Flame Sharpness II",
            TALENT_RAGING_FLAME_SHARPNESS_II,
            attr_type::ATTR_PANEL_HASTE,
            final_haste_raw,
            (final_haste_raw / 100.0) * RAGING_FLAME_SHARPNESS_ACCEL_PER_HASTE_PERCENT,
            "accelerate",
            "expertiseSkill",
            skill_tags_vec,
        ));
    }

    if skill_tags.contains(&TAG_ULTIMATE_SKILL)
        && selected_season_talent_source(
            runtime.active_effect_sources,
            SEASON_TALENT_ULTIMATE_CHARGE,
        )
        && final_haste_raw >= ULTIMATE_CHARGE_HASTE_STEP
    {
        let reduction = ((final_haste_raw / ULTIMATE_CHARGE_HASTE_STEP).floor()
            * ULTIMATE_CHARGE_REDUCTION_PER_STEP)
            .min(ULTIMATE_CHARGE_MAX_REDUCTION);
        if reduction > 0.0 {
            sources.push(build_talent_stat_source(
                "season-talent-node:107",
                "Ultimate Charge",
                SEASON_TALENT_ULTIMATE_CHARGE,
                attr_type::ATTR_PANEL_HASTE,
                final_haste_raw,
                reduction,
                "pctReduce",
                "ultimateSkill",
                skill_tags_vec,
            ));
        }
    }

    if skill_tags.contains(&TAG_SPECIAL_ATTACK) || skill_tags.contains(&TAG_EXPERTISE_SKILL) {
        if let Some(buff) = active_buff_by_base_id(runtime.active_buffs, BUFF_TIME_SLIT_DREAM) {
            sources.push(build_active_buff_source(
                "season-talent-node:1104",
                "Time-Slit - Dream",
                buff,
                "pctReduce",
                22.0,
                TIME_SLIT_DREAM_CD_REDUCTION,
                "specialOrExpertiseSkill",
                skill_tags_vec,
            ));
        }
    }

    if skill_tags.contains(&TAG_ULTIMATE_SKILL) {
        if let Some(buff) = active_buff_by_base_id(runtime.active_buffs, BUFF_RESURGE) {
            sources.push(build_active_buff_source(
                "season-talent-node:1705",
                "Resurge",
                buff,
                "accelerate",
                15.0,
                RESURGE_ULTIMATE_ACCEL,
                "ultimateSkill",
                skill_tags_vec,
            ));
        }
    }

    if skill_id == SKILL_FOCUS {
        for (base_id, source_key, name, contribution_kind, contribution) in [
            (
                BUFF_FOCUS,
                "focus-active",
                "Focus",
                "activeDuration",
                0.0_f32,
            ),
            (
                BUFF_RADIANT_SPIRIT,
                "talent:1115",
                "Radiant Spirit",
                "durationExtend",
                3000.0_f32,
            ),
        ] {
            if let Some(buff) = active_buff_by_base_id(runtime.active_buffs, base_id) {
                sources.push(build_active_buff_source(
                    source_key,
                    name,
                    buff,
                    contribution_kind,
                    final_haste_raw,
                    contribution,
                    "focus",
                    skill_tags_vec,
                ));
            }
        }
        if active_talent_node_matches(active_talent_node_ids, TALENT_CELESTIAL_EAGLE)
            && final_haste_raw > 0.0
        {
            sources.push(build_talent_stat_source(
                "talent:1160",
                "Celestial Eagle",
                TALENT_CELESTIAL_EAGLE,
                attr_type::ATTR_PANEL_HASTE,
                final_haste_raw,
                (final_haste_raw / 100.0) * FOCUS_CELESTIAL_EAGLE_ACCEL_PER_HASTE_PERCENT,
                "accelerate",
                "focus",
                skill_tags_vec,
            ));
            if let Some(buff) = active_buff_by_base_id(runtime.active_buffs, BUFF_CELESTIAL_EAGLE) {
                sources.push(build_active_buff_source(
                    "talent:1160-active",
                    "Celestial Eagle",
                    buff,
                    "activeDuration",
                    final_haste_raw,
                    0.0,
                    "focus",
                    skill_tags_vec,
                ));
            }
        }
        if final_haste_raw > 0.0 && skill_tags.contains(&TAG_HASTE) {
            sources.push(build_final_stat_source(
                "haste",
                attr_type::ATTR_PANEL_HASTE,
                final_haste_raw,
                "focus",
                skill_tags_vec,
            ));
        }
    }

    sources
}

fn active_talent_node_matches(active_talent_node_ids: &[u32], talent_family_id: u32) -> bool {
    active_talent_node_ids
        .iter()
        .any(|node_id| *node_id == talent_family_id || *node_id / 1_000 == talent_family_id)
}

fn build_gear_set_evidence_sources(
    active_gear_sets: &[ObservedGearSet],
    skill_tags: &[i32],
) -> Vec<SkillCdSourceState> {
    active_gear_sets
        .iter()
        .take(6)
        .map(|set| {
            let mut attr_params = vec![set.suit_id, set.attr_type.unwrap_or(-1)];
            for attr in set.suit_attrs.iter().take(8) {
                attr_params.push(attr.attr_id);
                attr_params.push(attr.value);
            }

            SkillCdSourceState {
                source_key: format!("gear-set-{}", set.suit_id),
                source_kind: "gearSet".to_string(),
                attr_type: set.suit_id,
                temp_attr_id: None,
                logic_type: None,
                attr_params,
                skill_tags: skill_tags.to_vec(),
                value: set.suit_attrs.len() as f32,
                contribution: 0.0,
                contribution_kind: "evidence".to_string(),
                scope: set.runtime_source.clone(),
            }
        })
        .collect()
}

fn selected_season_talent_source(
    active_effect_sources: &[ObservedEffectSource],
    node_id: u32,
) -> bool {
    let expected_source_id = format!("season-talent-node:{node_id}");
    active_effect_sources.iter().any(|source| {
        source.node_id == Some(node_id)
            && source.source_id == expected_source_id
            && source.runtime_source.contains("season_medal_info")
            && source.runtime_source.contains("choose")
    })
}

fn active_profession_skill_matches_battle_imagine(
    active_profession_skills: &[ObservedProfessionSkill],
    skill_id: i32,
) -> bool {
    active_profession_skills.iter().any(|skill| {
        skill.source_kind == "battle-imagine"
            && skill.equipped.unwrap_or(false)
            && (skill.skill_id == skill_id
                || skill.base_skill_id == Some(skill_id)
                || skill
                    .skill_level_id
                    .is_some_and(|skill_level_id| skill_level_id / 100 == skill_id)
                || skill.replace_skill_ids.iter().any(|id| *id == skill_id))
    })
}

fn active_imagine_acceleration_buff(
    active_buffs: &HashMap<i32, ActiveBuff>,
) -> Option<(&'static str, &ActiveBuff)> {
    [
        (
            "season-rogue-entry:175",
            BUFF_IMAGINE_ACCELERATION_ROGUE_ENTRY,
        ),
        (
            "season-talent-node:5201",
            BUFF_IMAGINE_ACCELERATION_DEEP_SLUMBER,
        ),
        (
            "season-talent-node:5201",
            BUFF_IMAGINE_ACCELERATION_DEEP_SLUMBER_ALT,
        ),
    ]
    .into_iter()
    .filter_map(|(source_key, buff_id)| {
        active_buff_by_base_id(active_buffs, buff_id).map(|buff| (source_key, buff))
    })
    .max_by_key(|(_, buff)| buff.received_time_ms)
}

fn build_final_stat_source(
    stat_key: &str,
    attr_id: i32,
    value: f32,
    scope: &str,
    skill_tags: &[i32],
) -> SkillCdSourceState {
    SkillCdSourceState {
        source_key: format!("final-stat-{}", stat_key),
        source_kind: "finalStat".to_string(),
        attr_type: attr_id,
        temp_attr_id: None,
        logic_type: None,
        attr_params: Vec::new(),
        skill_tags: skill_tags.to_vec(),
        value,
        contribution: 0.0,
        contribution_kind: "finalStatEvidence".to_string(),
        scope: scope.to_string(),
    }
}

fn build_talent_stat_source(
    source_key: &str,
    source_name: &str,
    talent_node_id: u32,
    stat_attr_id: i32,
    raw_value: f32,
    contribution: f32,
    contribution_kind: &str,
    scope: &str,
    skill_tags: &[i32],
) -> SkillCdSourceState {
    SkillCdSourceState {
        source_key: source_key.to_string(),
        source_kind: source_name.to_string(),
        attr_type: stat_attr_id,
        temp_attr_id: None,
        logic_type: None,
        attr_params: vec![talent_node_id as i32, raw_value.round() as i32],
        skill_tags: skill_tags.to_vec(),
        value: raw_value,
        contribution,
        contribution_kind: contribution_kind.to_string(),
        scope: scope.to_string(),
    }
}

fn active_buff_by_base_id(
    active_buffs: &HashMap<i32, ActiveBuff>,
    base_id: i32,
) -> Option<&ActiveBuff> {
    active_buffs
        .values()
        .filter(|buff| buff.base_id == base_id)
        .max_by_key(|buff| buff.received_time_ms)
}

fn build_active_buff_source(
    source_key: &str,
    source_name: &str,
    buff: &ActiveBuff,
    contribution_kind: &str,
    value: f32,
    contribution: f32,
    scope: &str,
    skill_tags: &[i32],
) -> SkillCdSourceState {
    SkillCdSourceState {
        source_key: format!("{}:buff-{}", source_key, buff.base_id),
        source_kind: source_name.to_string(),
        attr_type: buff.base_id,
        temp_attr_id: None,
        logic_type: None,
        attr_params: vec![buff.base_id, buff.layer, buff.duration],
        skill_tags: skill_tags.to_vec(),
        value,
        contribution,
        contribution_kind: contribution_kind.to_string(),
        scope: scope.to_string(),
    }
}

fn build_temp_attr_source(
    temp_attr_id: i32,
    raw_value: i32,
    def: &CdTempAttrDef,
    contribution: f32,
    contribution_kind: &str,
    skill_tags: &[i32],
) -> SkillCdSourceState {
    SkillCdSourceState {
        source_key: format!("temp-attr-{}", temp_attr_id),
        source_kind: "tempAttr".to_string(),
        attr_type: def.attr_type,
        temp_attr_id: Some(temp_attr_id),
        logic_type: Some(def.logic_type),
        attr_params: def.attr_params.clone(),
        skill_tags: skill_tags.to_vec(),
        value: raw_value as f32,
        contribution,
        contribution_kind: contribution_kind.to_string(),
        scope: temp_attr_scope(def.logic_type).to_string(),
    }
}

fn build_talent_snapshot_sources(active_talent_node_ids: &[u32]) -> Vec<SkillCdSourceState> {
    let talent_node_ids: Vec<i32> = active_talent_node_ids
        .iter()
        .filter_map(|id| i32::try_from(*id).ok())
        .collect();
    if talent_node_ids.is_empty() {
        return Vec::new();
    }

    vec![SkillCdSourceState {
        source_key: "active-profession-talents".to_string(),
        source_kind: "professionTalentSnapshot".to_string(),
        attr_type: 0,
        temp_attr_id: None,
        logic_type: None,
        attr_params: talent_node_ids.clone(),
        skill_tags: Vec::new(),
        value: talent_node_ids.len() as f32,
        contribution: 0.0,
        contribution_kind: "evidence".to_string(),
        scope: "selectedTalents".to_string(),
    }]
}

fn temp_attr_scope(logic_type: i32) -> &'static str {
    match logic_type {
        0 => "global",
        1 => "skill",
        3 => "skillTag",
        _ => "unknown",
    }
}
