use crate::live::counter_tracker::{CounterAction, CounterRule, CounterSource, EffectSlotConfig};
use blueprotobuf_lib::blueprotobuf;
use log::debug;
use std::collections::{HashMap, HashSet};

const FACTOR_RULE_ID_BASE: i32 = 900_000_000;
const CHAR_SERIALIZE_FIELD_SEASON_CULTIVATE: i32 = 101;
const DIRTY_BEGIN: i32 = -2;
const DIRTY_END: i32 = -3;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FactorCounterTemplate {
    #[serde(default)]
    pub item_ids: Vec<i32>,
    #[serde(default)]
    pub sources: Vec<CounterSource>,
    #[serde(default)]
    pub effect_slots: Vec<EffectSlotConfig>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SeasonCultivateFactorSelection {
    pub source_item_ids: Vec<i32>,
    pub slot_item_ids: Vec<i32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SeasonCultivateActiveSnapshot {
    pub active_area_ids: Vec<i32>,
    pub active_item_ids: Vec<i32>,
    pub active_fantasy_ids: Vec<i32>,
}

#[derive(Debug, Clone, Default)]
pub struct SeasonCultivateRuntimeState {
    data: Option<blueprotobuf::SeasonCultivateLineData>,
    templates: Vec<FactorCounterTemplate>,
    active_snapshot: SeasonCultivateActiveSnapshot,
    active_selection: SeasonCultivateFactorSelection,
}

impl SeasonCultivateRuntimeState {
    pub fn set_templates(&mut self, templates: Vec<FactorCounterTemplate>) -> bool {
        self.templates = normalize_factor_templates(templates);
        self.rebuild_active_selection();
        true
    }

    pub fn replace_data(&mut self, data: blueprotobuf::SeasonCultivateLineData) -> bool {
        let active_snapshot = active_snapshot_from_data(&data);
        let changed = active_snapshot != self.active_snapshot;
        self.data = Some(data);
        self.active_snapshot = active_snapshot;
        self.rebuild_active_selection() || changed
    }

    pub fn clear_data(&mut self) -> bool {
        let changed =
            self.data.is_some() || self.active_snapshot != SeasonCultivateActiveSnapshot::default();
        self.data = None;
        self.active_snapshot = SeasonCultivateActiveSnapshot::default();
        self.rebuild_active_selection() || changed
    }

    pub fn apply_dirty_bytes(&mut self, bytes: &[u8]) -> bool {
        let Some(current) = self.data.as_mut() else {
            return false;
        };
        let mut reader = DirtyReader::new(bytes);
        if let Err(err) = merge_char_serialize_dirty(&mut reader, current) {
            debug!(target: "app::live", "season cultivate dirty parse failed: {err:?}");
            return false;
        }
        let active_snapshot = active_snapshot_from_data(current);
        let changed = active_snapshot != self.active_snapshot;
        self.active_snapshot = active_snapshot;
        self.rebuild_active_selection() || changed
    }

    pub fn active_snapshot(&self) -> &SeasonCultivateActiveSnapshot {
        &self.active_snapshot
    }

    pub fn active_selection(&self) -> &SeasonCultivateFactorSelection {
        &self.active_selection
    }

    pub fn build_factor_counter_rules(&self) -> Vec<CounterRule> {
        build_counter_rules(&self.templates, &self.active_selection)
    }

    fn rebuild_active_selection(&mut self) -> bool {
        let selection = extract_active_selection(&self.templates, &self.active_snapshot);
        let changed = selection != self.active_selection;
        self.active_selection = selection;
        changed
    }
}

pub fn factor_rule_id(item_id: i32) -> i32 {
    FACTOR_RULE_ID_BASE.saturating_add(item_id)
}

pub fn normalize_factor_templates(
    templates: Vec<FactorCounterTemplate>,
) -> Vec<FactorCounterTemplate> {
    templates
        .into_iter()
        .filter_map(|mut template| {
            template.item_ids.retain(|item_id| *item_id > 0);
            template.item_ids.sort_unstable();
            template.item_ids.dedup();
            (!template.item_ids.is_empty()).then_some(template)
        })
        .collect()
}

fn extract_active_selection(
    templates: &[FactorCounterTemplate],
    snapshot: &SeasonCultivateActiveSnapshot,
) -> SeasonCultivateFactorSelection {
    let source_ids = template_item_id_set(
        templates
            .iter()
            .filter(|template| !template.sources.is_empty()),
    );
    let slot_ids = template_item_id_set(
        templates
            .iter()
            .filter(|template| !template.effect_slots.is_empty()),
    );
    let mut slot_item_ids: Vec<i32> = snapshot
        .active_item_ids
        .iter()
        .copied()
        .filter(|item_id| slot_ids.contains(item_id))
        .collect();
    normalize_ids(&mut slot_item_ids);
    let mut source_item_ids: Vec<i32> = slot_item_ids
        .iter()
        .copied()
        .filter(|item_id| source_ids.contains(item_id))
        .collect();
    normalize_ids(&mut source_item_ids);
    SeasonCultivateFactorSelection {
        source_item_ids,
        slot_item_ids,
    }
}

fn build_counter_rules(
    templates: &[FactorCounterTemplate],
    selection: &SeasonCultivateFactorSelection,
) -> Vec<CounterRule> {
    if selection.source_item_ids.is_empty() || selection.slot_item_ids.is_empty() {
        return Vec::new();
    }
    let source_templates: Vec<&FactorCounterTemplate> = templates
        .iter()
        .filter(|template| {
            !template.sources.is_empty()
                && template_matches_any_item_id(template, &selection.source_item_ids)
        })
        .collect();
    if source_templates.is_empty() {
        return Vec::new();
    }
    selection
        .slot_item_ids
        .iter()
        .filter_map(|slot_item_id| {
            let template = templates.iter().find(|template| {
                !template.effect_slots.is_empty()
                    && template_matches_item_id(template, *slot_item_id)
            })?;
            let matching_source_templates: Vec<&FactorCounterTemplate> = source_templates
                .iter()
                .copied()
                .filter(|source_template| templates_share_item_id(source_template, template))
                .collect();
            let sources: Vec<CounterSource> = matching_source_templates
                .iter()
                .flat_map(|template| template.sources.iter().cloned())
                .collect();
            if sources.is_empty() {
                return None;
            }
            Some(CounterRule {
                rule_id: factor_rule_id(*slot_item_id),
                sources,
                effect_slots: template
                    .effect_slots
                    .iter()
                    .enumerate()
                    .map(|(idx, slot)| {
                        let mut next = slot.clone();
                        next.slot_id = i32::try_from(idx + 1).unwrap_or(i32::MAX);
                        if next.threshold.is_none() {
                            next.on_buff_add = CounterAction::NoOp;
                            next.on_buff_change = CounterAction::NoOp;
                            next.on_buff_remove = CounterAction::NoOp;
                            next.on_reset_skill = CounterAction::NoOp;
                        }
                        next
                    })
                    .collect(),
            })
        })
        .collect()
}

fn template_item_id_set<'a>(
    templates: impl Iterator<Item = &'a FactorCounterTemplate>,
) -> HashSet<i32> {
    let mut result = HashSet::new();
    for template in templates {
        result.extend(template.item_ids.iter().copied());
    }
    result
}

fn template_matches_any_item_id(template: &FactorCounterTemplate, item_ids: &[i32]) -> bool {
    item_ids
        .iter()
        .any(|item_id| template_matches_item_id(template, *item_id))
}

fn template_matches_item_id(template: &FactorCounterTemplate, item_id: i32) -> bool {
    template.item_ids.contains(&item_id)
}

fn templates_share_item_id(left: &FactorCounterTemplate, right: &FactorCounterTemplate) -> bool {
    left.item_ids
        .iter()
        .any(|item_id| template_matches_item_id(right, *item_id))
}

fn active_snapshot_from_data(
    data: &blueprotobuf::SeasonCultivateLineData,
) -> SeasonCultivateActiveSnapshot {
    let mut snapshot = SeasonCultivateActiveSnapshot::default();

    for line_data in data.season_cultivate_line_map.values() {
        for sub_type in line_data.cultivate_line_map.values() {
            for (area_id, area) in active_areas(sub_type) {
                push_positive_id(&mut snapshot.active_area_ids, area_id);
                collect_middle_node_item_ids(
                    &mut snapshot.active_item_ids,
                    &area.cultivate_middle_node_map,
                );
                collect_big_node_fantasy_ids(
                    &mut snapshot.active_fantasy_ids,
                    &area.cultivate_big_node_map,
                );
            }
        }
    }

    normalize_ids(&mut snapshot.active_area_ids);
    normalize_ids(&mut snapshot.active_item_ids);
    normalize_ids(&mut snapshot.active_fantasy_ids);
    snapshot
}

fn active_areas(
    sub_type: &blueprotobuf::CultivateLineSubTypeData,
) -> Vec<(i32, &blueprotobuf::CultivateAreaData)> {
    if !sub_type.cultivate_line_area_list.is_empty() {
        return sub_type
            .cultivate_line_area_list
            .iter()
            .filter_map(|area_id| {
                sub_type
                    .cultivate_line_data_map
                    .get(area_id)
                    .map(|area| (*area_id, area))
            })
            .collect();
    }

    sub_type
        .cultivate_line_data_map
        .iter()
        .filter(|(_, area)| area.is_active.unwrap_or(false))
        .map(|(area_id, area)| (*area_id, area))
        .collect()
}

fn collect_middle_node_item_ids(
    target: &mut Vec<i32>,
    nodes: &HashMap<i32, blueprotobuf::CultivateMiddleNodeData>,
) {
    for item_id in nodes.values().filter_map(|node| node.item_id) {
        push_positive_id(target, item_id);
    }
}

fn collect_big_node_fantasy_ids(
    target: &mut Vec<i32>,
    nodes: &HashMap<i32, blueprotobuf::CultivateBigNodeData>,
) {
    for fantasy_id in nodes.values().filter_map(|node| node.fantasy_id) {
        push_positive_id(target, fantasy_id);
    }
}

fn push_positive_id(target: &mut Vec<i32>, id: i32) {
    if id > 0 {
        target.push(id);
    }
}

fn normalize_ids(ids: &mut Vec<i32>) {
    ids.sort_unstable();
    ids.dedup();
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DirtyParseError {
    UnexpectedEnd,
    InvalidMarker(i32),
    InvalidBlockSize(i32),
    InvalidFieldId(i32),
}

type DirtyResult<T> = Result<T, DirtyParseError>;

struct DirtyReader<'a> {
    data: &'a [u8],
    off: usize,
}

impl<'a> DirtyReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, off: 0 }
    }

    fn i32(&mut self) -> DirtyResult<i32> {
        if self.off + 4 > self.data.len() {
            return Err(DirtyParseError::UnexpectedEnd);
        }
        let value = i32::from_le_bytes([
            self.data[self.off],
            self.data[self.off + 1],
            self.data[self.off + 2],
            self.data[self.off + 3],
        ]);
        self.off += 4;
        Ok(value)
    }

    fn bool(&mut self) -> DirtyResult<bool> {
        if self.off >= self.data.len() {
            return Err(DirtyParseError::UnexpectedEnd);
        }
        let value = self.data[self.off] != 0;
        self.off += 1;
        Ok(value)
    }

    fn skip_to(&mut self, off: usize) -> DirtyResult<()> {
        if off > self.data.len() {
            return Err(DirtyParseError::UnexpectedEnd);
        }
        self.off = off;
        Ok(())
    }

    fn peek_i32(&self) -> DirtyResult<i32> {
        if self.off + 4 > self.data.len() {
            return Err(DirtyParseError::UnexpectedEnd);
        }
        Ok(i32::from_le_bytes([
            self.data[self.off],
            self.data[self.off + 1],
            self.data[self.off + 2],
            self.data[self.off + 3],
        ]))
    }
}

fn read_object_header(reader: &mut DirtyReader<'_>) -> DirtyResult<Option<usize>> {
    let begin = reader.i32()?;
    if begin != DIRTY_BEGIN {
        return Err(DirtyParseError::InvalidMarker(begin));
    }
    let size = reader.i32()?;
    if size == DIRTY_END {
        return Ok(None);
    }
    if size < 0 {
        return Err(DirtyParseError::InvalidBlockSize(size));
    }
    let end = reader
        .off
        .checked_add(usize::try_from(size).map_err(|_| DirtyParseError::InvalidBlockSize(size))?)
        .ok_or(DirtyParseError::UnexpectedEnd)?;
    if end + 4 > reader.data.len() {
        return Err(DirtyParseError::UnexpectedEnd);
    }
    Ok(Some(end))
}

fn finish_object(reader: &mut DirtyReader<'_>, end: usize) -> DirtyResult<()> {
    reader.skip_to(end)?;
    let marker = reader.i32()?;
    if marker != DIRTY_END {
        return Err(DirtyParseError::InvalidMarker(marker));
    }
    Ok(())
}

fn skip_object(reader: &mut DirtyReader<'_>) -> DirtyResult<()> {
    let Some(end) = read_object_header(reader)? else {
        return Ok(());
    };
    finish_object(reader, end)
}

fn merge_char_serialize_dirty(
    reader: &mut DirtyReader<'_>,
    data: &mut blueprotobuf::SeasonCultivateLineData,
) -> DirtyResult<()> {
    let Some(end) = read_object_header(reader)? else {
        return Ok(());
    };
    while reader.off < end {
        let field_id = reader.i32()?;
        if field_id <= 0 {
            return Err(DirtyParseError::InvalidFieldId(field_id));
        }
        if field_id == CHAR_SERIALIZE_FIELD_SEASON_CULTIVATE {
            merge_season_cultivate_line_data(reader, data)?;
        } else if reader.peek_i32()? == DIRTY_BEGIN {
            skip_object(reader)?;
        } else {
            reader.skip_to(end)?;
        }
    }
    finish_object(reader, end)
}

fn merge_season_cultivate_line_data(
    reader: &mut DirtyReader<'_>,
    data: &mut blueprotobuf::SeasonCultivateLineData,
) -> DirtyResult<()> {
    let Some(end) = read_object_header(reader)? else {
        return Ok(());
    };
    while reader.off < end {
        let field_id = reader.i32()?;
        if field_id == 1 {
            merge_i32_object_map(
                reader,
                &mut data.season_cultivate_line_map,
                merge_cultivate_line_data,
                blueprotobuf::CultivateLineData::default,
            )?;
        } else {
            reader.skip_to(end)?;
        }
    }
    finish_object(reader, end)
}

fn merge_cultivate_line_data(
    reader: &mut DirtyReader<'_>,
    data: &mut blueprotobuf::CultivateLineData,
) -> DirtyResult<()> {
    let Some(end) = read_object_header(reader)? else {
        return Ok(());
    };
    while reader.off < end {
        let field_id = reader.i32()?;
        if field_id == 1 {
            merge_i32_object_map(
                reader,
                &mut data.cultivate_line_map,
                merge_cultivate_line_sub_type_data,
                blueprotobuf::CultivateLineSubTypeData::default,
            )?;
        } else {
            reader.skip_to(end)?;
        }
    }
    finish_object(reader, end)
}

fn merge_cultivate_line_sub_type_data(
    reader: &mut DirtyReader<'_>,
    data: &mut blueprotobuf::CultivateLineSubTypeData,
) -> DirtyResult<()> {
    let Some(end) = read_object_header(reader)? else {
        return Ok(());
    };
    while reader.off < end {
        let field_id = reader.i32()?;
        match field_id {
            1 => {
                merge_i32_object_map(
                    reader,
                    &mut data.cultivate_line_data_map,
                    merge_cultivate_area_data,
                    blueprotobuf::CultivateAreaData::default,
                )?;
            }
            2 => {
                data.cultivate_line_area_list = parse_repeated_i32(reader)?;
            }
            _ => reader.skip_to(end)?,
        }
    }
    finish_object(reader, end)
}

fn merge_cultivate_area_data(
    reader: &mut DirtyReader<'_>,
    data: &mut blueprotobuf::CultivateAreaData,
) -> DirtyResult<()> {
    let Some(end) = read_object_header(reader)? else {
        return Ok(());
    };
    while reader.off < end {
        let field_id = reader.i32()?;
        match field_id {
            1 => {
                merge_i32_object_map(
                    reader,
                    &mut data.cultivate_normal_node_map,
                    merge_cultivate_normal_node_data,
                    blueprotobuf::CultivateNormalNodeData::default,
                )?;
            }
            2 => {
                merge_i32_object_map(
                    reader,
                    &mut data.cultivate_middle_node_map,
                    merge_cultivate_middle_node_data,
                    blueprotobuf::CultivateMiddleNodeData::default,
                )?;
            }
            3 => {
                merge_i32_object_map(
                    reader,
                    &mut data.cultivate_big_node_map,
                    merge_cultivate_big_node_data,
                    blueprotobuf::CultivateBigNodeData::default,
                )?;
            }
            4 => data.activate_effect_score = Some(reader.i32()?),
            5 => data.is_active = Some(reader.bool()?),
            _ => reader.skip_to(end)?,
        }
    }
    finish_object(reader, end)
}

fn merge_cultivate_normal_node_data(
    reader: &mut DirtyReader<'_>,
    data: &mut blueprotobuf::CultivateNormalNodeData,
) -> DirtyResult<()> {
    let Some(end) = read_object_header(reader)? else {
        return Ok(());
    };
    while reader.off < end {
        let field_id = reader.i32()?;
        if field_id == 1 {
            data.active_level = Some(reader.i32()?);
        } else {
            reader.skip_to(end)?;
        }
    }
    finish_object(reader, end)
}

fn merge_cultivate_middle_node_data(
    reader: &mut DirtyReader<'_>,
    data: &mut blueprotobuf::CultivateMiddleNodeData,
) -> DirtyResult<()> {
    let Some(end) = read_object_header(reader)? else {
        return Ok(());
    };
    while reader.off < end {
        let field_id = reader.i32()?;
        if field_id == 1 {
            data.item_id = Some(reader.i32()?);
        } else {
            reader.skip_to(end)?;
        }
    }
    finish_object(reader, end)
}

fn merge_cultivate_big_node_data(
    reader: &mut DirtyReader<'_>,
    data: &mut blueprotobuf::CultivateBigNodeData,
) -> DirtyResult<()> {
    let Some(end) = read_object_header(reader)? else {
        return Ok(());
    };
    while reader.off < end {
        let field_id = reader.i32()?;
        if field_id == 1 {
            data.fantasy_id = Some(reader.i32()?);
        } else {
            reader.skip_to(end)?;
        }
    }
    finish_object(reader, end)
}

fn merge_i32_object_map<T>(
    reader: &mut DirtyReader<'_>,
    map: &mut HashMap<i32, T>,
    merge_value: fn(&mut DirtyReader<'_>, &mut T) -> DirtyResult<()>,
    default_value: fn() -> T,
) -> DirtyResult<()> {
    let first = reader.i32()?;
    if first == -4 {
        return Ok(());
    }
    let (update_count, remove_count, add_count) = if first == -1 {
        (reader.i32()?, 0, 0)
    } else {
        (first, reader.i32()?, reader.i32()?)
    };
    for _ in 0..update_count {
        let key = reader.i32()?;
        let entry = map.entry(key).or_insert_with(default_value);
        merge_value(reader, entry)?;
    }
    for _ in 0..remove_count {
        let key = reader.i32()?;
        map.remove(&key);
    }
    for _ in 0..add_count {
        let key = reader.i32()?;
        let entry = map.entry(key).or_insert_with(default_value);
        merge_value(reader, entry)?;
    }
    Ok(())
}

fn parse_repeated_i32(reader: &mut DirtyReader<'_>) -> DirtyResult<Vec<i32>> {
    let count = reader.i32()?;
    if count < 0 {
        return Err(DirtyParseError::InvalidBlockSize(count));
    }
    let capacity = usize::try_from(count).map_err(|_| DirtyParseError::InvalidBlockSize(count))?;
    let mut result = Vec::with_capacity(capacity);
    for _ in 0..count {
        result.push(reader.i32()?);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live::counter_tracker::CounterAction;

    #[test]
    fn active_snapshot_uses_explicit_active_area_list() {
        let mut data = blueprotobuf::SeasonCultivateLineData::default();
        let mut line = blueprotobuf::CultivateLineData::default();
        let mut sub_type = blueprotobuf::CultivateLineSubTypeData::default();

        sub_type.cultivate_line_area_list = vec![2];
        sub_type.cultivate_line_data_map.insert(
            1,
            area_with_middle_and_big_node(Some(1001), Some(2001), Some(true)),
        );
        sub_type.cultivate_line_data_map.insert(
            2,
            area_with_middle_and_big_node(Some(1002), Some(2002), Some(false)),
        );
        line.cultivate_line_map.insert(10, sub_type);
        data.season_cultivate_line_map.insert(20, line);

        let snapshot = active_snapshot_from_data(&data);

        assert_eq!(snapshot.active_area_ids, vec![2]);
        assert_eq!(snapshot.active_item_ids, vec![1002]);
        assert_eq!(snapshot.active_fantasy_ids, vec![2002]);
    }

    #[test]
    fn active_snapshot_falls_back_to_active_area_flag() {
        let mut data = blueprotobuf::SeasonCultivateLineData::default();
        let mut line = blueprotobuf::CultivateLineData::default();
        let mut sub_type = blueprotobuf::CultivateLineSubTypeData::default();

        sub_type.cultivate_line_data_map.insert(
            1,
            area_with_middle_and_big_node(Some(1001), Some(2001), Some(true)),
        );
        sub_type.cultivate_line_data_map.insert(
            2,
            area_with_middle_and_big_node(Some(1002), Some(2002), Some(false)),
        );
        line.cultivate_line_map.insert(10, sub_type);
        data.season_cultivate_line_map.insert(20, line);

        let snapshot = active_snapshot_from_data(&data);

        assert_eq!(snapshot.active_area_ids, vec![1]);
        assert_eq!(snapshot.active_item_ids, vec![1001]);
        assert_eq!(snapshot.active_fantasy_ids, vec![2001]);
    }

    #[test]
    fn dirty_bytes_update_active_snapshot() {
        let mut state = SeasonCultivateRuntimeState::default();
        state.replace_data(blueprotobuf::SeasonCultivateLineData::default());

        let dirty_bytes = object(vec![
            i32_bytes(CHAR_SERIALIZE_FIELD_SEASON_CULTIVATE),
            object(vec![
                i32_bytes(1),
                map_update(
                    20,
                    object(vec![
                        i32_bytes(1),
                        map_update(
                            10,
                            object(vec![
                                i32_bytes(1),
                                map_update(
                                    2,
                                    object(vec![
                                        i32_bytes(2),
                                        map_update(1, object(vec![i32_bytes(1), i32_bytes(1002)])),
                                        i32_bytes(3),
                                        map_update(1, object(vec![i32_bytes(1), i32_bytes(2002)])),
                                    ]),
                                ),
                                i32_bytes(2),
                                repeated_i32(vec![2]),
                            ]),
                        ),
                    ]),
                ),
            ]),
        ]);

        assert!(state.apply_dirty_bytes(&dirty_bytes));
        assert_eq!(
            state.active_snapshot(),
            &SeasonCultivateActiveSnapshot {
                active_area_ids: vec![2],
                active_item_ids: vec![1002],
                active_fantasy_ids: vec![2002],
            }
        );
    }

    #[test]
    fn factor_rule_generation_pairs_active_source_and_slot_templates() {
        let mut data = blueprotobuf::SeasonCultivateLineData::default();
        let mut line = blueprotobuf::CultivateLineData::default();
        let mut sub_type = blueprotobuf::CultivateLineSubTypeData::default();

        sub_type
            .cultivate_line_data_map
            .insert(1, area_with_middle_items(vec![1001, 2001]));
        line.cultivate_line_map.insert(10, sub_type);
        data.season_cultivate_line_map.insert(20, line);

        let mut state = SeasonCultivateRuntimeState::default();
        state.set_templates(vec![
            FactorCounterTemplate {
                item_ids: vec![0, 1001, 2001, 2001],
                sources: vec![CounterSource::AnyDamage {
                    increment: 1,
                    hits_required: None,
                }],
                effect_slots: Vec::new(),
            },
            FactorCounterTemplate {
                item_ids: vec![2001],
                sources: Vec::new(),
                effect_slots: vec![slot_config(7001), slot_config(7002)],
            },
        ]);

        assert!(state.replace_data(data));
        assert_eq!(
            state.active_selection(),
            &SeasonCultivateFactorSelection {
                source_item_ids: vec![2001],
                slot_item_ids: vec![2001],
            }
        );

        let rules = state.build_factor_counter_rules();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].rule_id, factor_rule_id(2001));
        assert_eq!(rules[0].sources.len(), 1);
        assert_eq!(rules[0].effect_slots.len(), 2);
        assert_eq!(rules[0].effect_slots[0].slot_id, 1);
        assert_eq!(rules[0].effect_slots[1].slot_id, 2);
        assert_eq!(rules[0].effect_slots[0].reset_buff_id, 7001);
        assert_eq!(rules[0].effect_slots[1].reset_buff_id, 7002);
    }

    #[test]
    fn factor_rule_generation_ignores_hidden_source_templates() {
        let mut data = blueprotobuf::SeasonCultivateLineData::default();
        let mut line = blueprotobuf::CultivateLineData::default();
        let mut sub_type = blueprotobuf::CultivateLineSubTypeData::default();

        sub_type
            .cultivate_line_data_map
            .insert(1, area_with_middle_items(vec![1001, 2001]));
        line.cultivate_line_map.insert(10, sub_type);
        data.season_cultivate_line_map.insert(20, line);

        let mut state = SeasonCultivateRuntimeState::default();
        state.set_templates(vec![
            FactorCounterTemplate {
                item_ids: vec![1001],
                sources: vec![CounterSource::AnyDamage {
                    increment: 1,
                    hits_required: None,
                }],
                effect_slots: Vec::new(),
            },
            FactorCounterTemplate {
                item_ids: vec![2001],
                sources: Vec::new(),
                effect_slots: vec![slot_config(7001)],
            },
        ]);

        assert!(state.replace_data(data));
        assert_eq!(
            state.active_selection(),
            &SeasonCultivateFactorSelection {
                source_item_ids: Vec::new(),
                slot_item_ids: vec![2001],
            }
        );
        assert!(state.build_factor_counter_rules().is_empty());
    }

    #[test]
    fn factor_rule_generation_does_not_cross_apply_one_source_to_unrelated_slots() {
        let mut data = blueprotobuf::SeasonCultivateLineData::default();
        let mut line = blueprotobuf::CultivateLineData::default();
        let mut sub_type = blueprotobuf::CultivateLineSubTypeData::default();

        sub_type
            .cultivate_line_data_map
            .insert(1, area_with_middle_items(vec![2001, 3001, 4001]));
        line.cultivate_line_map.insert(10, sub_type);
        data.season_cultivate_line_map.insert(20, line);

        let mut state = SeasonCultivateRuntimeState::default();
        state.set_templates(vec![
            FactorCounterTemplate {
                item_ids: vec![2001],
                sources: vec![CounterSource::AnyDamage {
                    increment: 92,
                    hits_required: None,
                }],
                effect_slots: Vec::new(),
            },
            FactorCounterTemplate {
                item_ids: vec![2001],
                sources: Vec::new(),
                effect_slots: vec![slot_config(7001)],
            },
            FactorCounterTemplate {
                item_ids: vec![3001],
                sources: Vec::new(),
                effect_slots: vec![slot_config(8001)],
            },
            FactorCounterTemplate {
                item_ids: vec![4001],
                sources: Vec::new(),
                effect_slots: vec![slot_config(9001)],
            },
        ]);

        assert!(state.replace_data(data));
        assert_eq!(
            state.active_selection(),
            &SeasonCultivateFactorSelection {
                source_item_ids: vec![2001],
                slot_item_ids: vec![2001, 3001, 4001],
            }
        );

        let rules = state.build_factor_counter_rules();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].rule_id, factor_rule_id(2001));
        assert_eq!(rules[0].sources.len(), 1);
        assert_eq!(rules[0].effect_slots.len(), 1);
        assert_eq!(rules[0].effect_slots[0].reset_buff_id, 7001);
    }

    #[test]
    fn factor_rule_generation_does_not_use_source_increment_as_slot_threshold() {
        let mut data = blueprotobuf::SeasonCultivateLineData::default();
        let mut line = blueprotobuf::CultivateLineData::default();
        let mut sub_type = blueprotobuf::CultivateLineSubTypeData::default();

        sub_type
            .cultivate_line_data_map
            .insert(1, area_with_middle_items(vec![2001]));
        line.cultivate_line_map.insert(10, sub_type);
        data.season_cultivate_line_map.insert(20, line);

        let mut state = SeasonCultivateRuntimeState::default();
        let mut thresholdless_slot = slot_config_with_threshold(7001, None);
        thresholdless_slot.on_buff_add = CounterAction::Reset;
        thresholdless_slot.on_buff_change = CounterAction::Reset;
        thresholdless_slot.on_buff_remove = CounterAction::Reset;
        state.set_templates(vec![
            FactorCounterTemplate {
                item_ids: vec![2001],
                sources: vec![CounterSource::SkillCast {
                    skill_base_ids: vec![2238],
                    increment: 92,
                }],
                effect_slots: Vec::new(),
            },
            FactorCounterTemplate {
                item_ids: vec![2001],
                sources: Vec::new(),
                effect_slots: vec![thresholdless_slot],
            },
        ]);

        assert!(state.replace_data(data));

        let rules = state.build_factor_counter_rules();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].effect_slots.len(), 1);
        assert_eq!(rules[0].effect_slots[0].threshold, None);
        assert!(matches!(
            rules[0].effect_slots[0].on_buff_add,
            CounterAction::NoOp
        ));
        assert!(matches!(
            rules[0].effect_slots[0].on_buff_change,
            CounterAction::NoOp
        ));
        assert!(matches!(
            rules[0].effect_slots[0].on_buff_remove,
            CounterAction::NoOp
        ));
    }

    fn area_with_middle_and_big_node(
        item_id: Option<i32>,
        fantasy_id: Option<i32>,
        is_active: Option<bool>,
    ) -> blueprotobuf::CultivateAreaData {
        let mut area = blueprotobuf::CultivateAreaData {
            is_active,
            ..Default::default()
        };
        area.cultivate_middle_node_map
            .insert(1, blueprotobuf::CultivateMiddleNodeData { item_id });
        area.cultivate_big_node_map
            .insert(1, blueprotobuf::CultivateBigNodeData { fantasy_id });
        area
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

    fn slot_config(reset_buff_id: i32) -> EffectSlotConfig {
        slot_config_with_threshold(reset_buff_id, Some(3))
    }

    fn slot_config_with_threshold(reset_buff_id: i32, threshold: Option<u32>) -> EffectSlotConfig {
        EffectSlotConfig {
            slot_id: 99,
            threshold,
            reset_buff_id,
            reset_source_config_id: None,
            on_buff_add: CounterAction::NoOp,
            on_buff_change: CounterAction::NoOp,
            on_buff_remove: CounterAction::NoOp,
            freeze_duration_ms: None,
            on_freeze_expire: CounterAction::NoOp,
            alt_freeze: None,
            threshold_modifier: None,
            freeze_duration_modifier: None,
            reset_skill_keys: None,
            on_reset_skill: CounterAction::NoOp,
        }
    }

    fn object(parts: Vec<Vec<u8>>) -> Vec<u8> {
        let body: Vec<u8> = parts.into_iter().flatten().collect();
        let mut out = Vec::new();
        out.extend(i32_bytes(DIRTY_BEGIN));
        out.extend(i32_bytes(i32::try_from(body.len()).unwrap()));
        out.extend(body);
        out.extend(i32_bytes(DIRTY_END));
        out
    }

    fn map_update(key: i32, value: Vec<u8>) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend(i32_bytes(1));
        out.extend(i32_bytes(0));
        out.extend(i32_bytes(0));
        out.extend(i32_bytes(key));
        out.extend(value);
        out
    }

    fn repeated_i32(values: Vec<i32>) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend(i32_bytes(i32::try_from(values.len()).unwrap()));
        for value in values {
            out.extend(i32_bytes(value));
        }
        out
    }

    fn i32_bytes(value: i32) -> Vec<u8> {
        value.to_le_bytes().to_vec()
    }
}
