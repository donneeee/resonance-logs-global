use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::PathBuf;

use diesel::prelude::*;
use diesel::sql_types::{Binary, Integer, Nullable, Text};
use resonance_logs_lib::live::opcodes_models::{Entity, Skill};
use serde::Serialize;
use serde_json::{Map, Value};

#[derive(QueryableByName)]
struct EncounterBlob {
    #[diesel(sql_type = Integer)]
    id: i32,
    #[diesel(sql_type = Nullable<Text>)]
    scene_name: Option<String>,
    #[diesel(sql_type = Binary)]
    data: Vec<u8>,
}

#[derive(Default)]
struct SkillAggregate {
    skill_id: i64,
    total_value: u128,
    effective_total_value: u128,
    hits: u128,
    entities: BTreeSet<String>,
    source_monster_ids: BTreeSet<i32>,
    properties: BTreeSet<i32>,
    damage_modes: BTreeSet<i32>,
}

#[derive(Debug, Serialize)]
struct LocaleFieldCoverage {
    field: String,
    sample_label: String,
    present_locales: Vec<String>,
    missing_locales: Vec<String>,
    design_only: bool,
}

#[derive(Debug, Serialize)]
struct VisibleLocalePreview {
    locale: String,
    name: String,
    detail: String,
    leaks_cjk: bool,
    uses_placeholder: bool,
}

#[derive(Debug, Serialize)]
struct SourceMonsterPreview {
    id: i32,
    name: String,
    names: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
struct SkillAuditRow {
    skill_id: i64,
    total_value: String,
    effective_total_value: String,
    hits: String,
    entities: Vec<String>,
    source_monster_ids: Vec<i32>,
    source_monsters: Vec<SourceMonsterPreview>,
    properties: Vec<i32>,
    damage_modes: Vec<i32>,
    recount_id: Option<i64>,
    fields: Vec<LocaleFieldCoverage>,
    missing_any_app_locale: bool,
    design_only_visible_source: bool,
    visible_leak_locales: Vec<String>,
    visible_previews: Vec<VisibleLocalePreview>,
}

#[derive(Debug, Serialize)]
struct AuditReport {
    database_path: String,
    encounter_id: i32,
    scene_name: Option<String>,
    locales: Vec<String>,
    entity_count: usize,
    tanked_entity_count: usize,
    tanked_skill_count: usize,
    rows_with_missing_locale_fields: usize,
    rows_with_visible_leaks: usize,
    focus_ids: Vec<i64>,
    rows: Vec<SkillAuditRow>,
}

fn default_db_path() -> PathBuf {
    if let Some(mut dir) = dirs::data_local_dir() {
        dir.push("resonance-logs-global");
        dir.join("resonance-logs-global.db")
    } else {
        PathBuf::from("resonance-logs-global.db")
    }
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .to_path_buf()
}

fn generated_path(name: &str) -> PathBuf {
    repo_root().join("parser-data").join("generated").join(name)
}

fn default_out_path() -> PathBuf {
    repo_root()
        .join("DEV_exports")
        .join("latest-tanked-localization-audit.json")
}

fn read_json(path: PathBuf) -> Result<Value, Box<dyn std::error::Error>> {
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn clean_text(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .to_string()
}

fn text_field(entry: Option<&Value>, field: &str) -> String {
    clean_text(entry.and_then(|value| value.get(field)))
}

fn locale_map<'a>(entry: Option<&'a Value>, field: &str) -> Option<&'a Map<String, Value>> {
    entry?.get(field)?.as_object()
}

fn map_text(map: Option<&Map<String, Value>>, key: &str) -> String {
    clean_text(map.and_then(|value| value.get(key)))
}

fn has_cjk(value: &str) -> bool {
    value
        .chars()
        .any(|ch| matches!(ch as u32, 0x3400..=0x9fff | 0xf900..=0xfaff))
}

fn allows_cjk_script(locale: &str) -> bool {
    locale.starts_with("zh") || locale == "ja" || locale.starts_with("ko")
}

fn is_placeholder(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.starts_with("unknown (")
        || lower.contains("unmapped ")
        || lower.contains("unknown skill")
        || lower.contains("unknown source")
}

fn is_design_only_map(map: Option<&Map<String, Value>>, locales: &[String]) -> bool {
    let Some(map) = map else {
        return false;
    };
    let has_design = !map_text(Some(map), "design").is_empty();
    has_design
        && locales
            .iter()
            .all(|locale| map_text(Some(map), locale).is_empty())
}

fn resolve_locale_text(map: Option<&Map<String, Value>>, locale: &str, fallback: &str) -> String {
    for key in [locale, "en", "zh-CN", "zh-TW", "design"] {
        let value = map_text(map, key);
        if !value.is_empty() {
            return value;
        }
    }
    fallback.trim().to_string()
}

fn normalized(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn owner_qualified(name: String, owner_name: String) -> String {
    if name.is_empty() || owner_name.is_empty() {
        return name;
    }
    let name_norm = normalized(&name);
    let owner_norm = normalized(&owner_name);
    if name_norm == owner_norm || name_norm.contains(&owner_norm) {
        name
    } else {
        format!("{owner_name} - {name}")
    }
}

fn field_coverage(
    entry: Option<&Value>,
    field_name: &str,
    field: &str,
    locales: &[String],
) -> Option<LocaleFieldCoverage> {
    let map = locale_map(entry, field)?;
    let mut present = Vec::new();
    let mut missing = Vec::new();
    for locale in locales {
        if map_text(Some(map), locale).is_empty() {
            missing.push(locale.clone());
        } else {
            present.push(locale.clone());
        }
    }
    Some(LocaleFieldCoverage {
        field: field_name.to_string(),
        sample_label: resolve_locale_text(Some(map), "en", ""),
        present_locales: present,
        missing_locales: missing,
        design_only: is_design_only_map(Some(map), locales),
    })
}

fn damage_attr_name(entry: Option<&Value>, locale: &str, locales: &[String]) -> String {
    let names = locale_map(entry, "Names");
    if names.is_some() && !is_design_only_map(names, locales) {
        let fallback = text_field(entry, "Name").or_else(|| text_field(entry, "DamageName"));
        return resolve_locale_text(names, locale, &fallback);
    }
    text_field(entry, "Name")
        .or_else(|| text_field(entry, "DamageName"))
        .or_else(|| resolve_locale_text(names, locale, ""))
}

trait OrElseString {
    fn or_else<F: FnOnce() -> String>(self, fallback: F) -> String;
}

impl OrElseString for String {
    fn or_else<F: FnOnce() -> String>(self, fallback: F) -> String {
        if self.trim().is_empty() {
            fallback()
        } else {
            self
        }
    }
}

fn visible_name(
    skill_id: i64,
    locale: &str,
    locales: &[String],
    detail: Option<&Value>,
    damage: Option<&Value>,
    recount: Option<&Value>,
) -> String {
    let row_name =
        damage_attr_name(damage, "en", locales).or_else(|| format!("Unknown ({skill_id})"));
    let damage_name = if let Some(group) = recount {
        resolve_locale_text(
            locale_map(Some(group), "Names"),
            locale,
            &text_field(Some(group), "RecountName"),
        )
    } else {
        damage_attr_name(damage, locale, locales)
    };

    let display_names = locale_map(detail, "DisplayNames");
    let display_name = resolve_locale_text(display_names, locale, &row_name);
    if is_design_only_map(display_names, locales)
        && !damage_name.is_empty()
        && damage_name != display_name
    {
        return damage_name;
    }

    owner_qualified(
        display_name,
        resolve_locale_text(locale_map(detail, "MonsterOwnerNames"), locale, ""),
    )
}

fn visible_detail(locale: &str, detail: Option<&Value>) -> String {
    let mut parts = Vec::new();
    let detail_name = resolve_locale_text(
        locale_map(detail, "DisplayDetailNames"),
        locale,
        &text_field(detail, "DisplayDetailName"),
    );
    if !detail_name.is_empty() {
        parts.push(detail_name);
    }
    let variant_name = resolve_locale_text(
        locale_map(detail, "DisplayVariantNames"),
        locale,
        &text_field(detail, "DisplayVariantName"),
    );
    if !variant_name.is_empty() {
        parts.push(variant_name);
    }
    if text_field(detail, "Category") == "base-skill" && parts.is_empty() {
        parts.push("Base skill".to_string());
    }
    parts.join(" - ")
}

fn recount_by_damage_id(recount_table: &Value) -> HashMap<i64, &Value> {
    let mut out = HashMap::new();
    if let Some(groups) = recount_table.as_object() {
        for group in groups.values() {
            for id in group
                .get("DamageId")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_i64)
            {
                out.insert(id, group);
            }
        }
    }
    out
}

fn source_monster_preview(
    monster_names: &Value,
    monster_id: i32,
    locales: &[String],
) -> SourceMonsterPreview {
    let key = monster_id.to_string();
    let entry = monster_names.get(&key);
    let names = locale_map(entry, "Names");
    let mut localized = BTreeMap::new();
    for locale in locales {
        let text = resolve_locale_text(names, locale, "");
        if !text.trim().is_empty() {
            localized.insert(locale.clone(), text);
        }
    }
    SourceMonsterPreview {
        id: monster_id,
        name: resolve_locale_text(names, "en", &text_field(entry, "Name")),
        names: localized,
    }
}

fn aggregate_skill(row: &mut SkillAggregate, uid: i64, entity: &Entity, stats: &Skill) {
    row.total_value += stats.total_value;
    row.effective_total_value += stats.effective_total_value;
    row.hits += stats.hits;
    row.entities
        .insert(format!("{}#{} ({uid})", entity.name, entity.class_id));
    if let Some(property) = stats.property {
        row.properties.insert(property);
    }
    if let Some(mode) = stats.damage_mode {
        row.damage_modes.insert(mode);
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let db_path = args
        .windows(2)
        .find_map(|pair| (pair[0] == "--db").then(|| PathBuf::from(&pair[1])))
        .unwrap_or_else(default_db_path);
    let out_path = args
        .windows(2)
        .find_map(|pair| (pair[0] == "--out").then(|| PathBuf::from(&pair[1])))
        .unwrap_or_else(default_out_path);

    let manifest = read_json(
        repo_root()
            .join("src")
            .join("lib")
            .join("locales")
            .join("manifest.json"),
    )?;
    let locales = manifest
        .get("locales")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    let damage_names = read_json(generated_path("DamageAttrIdName.json"))?;
    let skill_details = read_json(generated_path("SkillBreakdownDetails.json"))?;
    let monster_names = read_json(generated_path("monsternames.json"))?;
    let recount_table = read_json(generated_path("RecountTable.json"))?;
    let recount_by_damage = recount_by_damage_id(&recount_table);

    let mut conn = diesel::sqlite::SqliteConnection::establish(&db_path.to_string_lossy())?;
    let encounter: EncounterBlob = diesel::sql_query(
        "SELECT e.id, e.scene_name, ed.data
         FROM encounters e
         INNER JOIN encounter_data ed ON ed.encounter_id = e.id
         WHERE e.ended_at_ms IS NOT NULL
         ORDER BY e.id DESC
         LIMIT 1",
    )
    .get_result(&mut conn)?;

    let decompressed = zstd::decode_all(&encounter.data[..])?;
    let entities: HashMap<i64, Entity> = rmp_serde::from_slice(&decompressed)?;
    let mut tanked_entity_count = 0usize;
    let mut aggregates = BTreeMap::<i64, SkillAggregate>::new();
    for (uid, entity) in &entities {
        let mut entity_had_taken = false;
        for (skill_id, stats) in &entity.skill_uid_to_taken_skill {
            if stats.hits == 0 && stats.total_value == 0 {
                continue;
            }
            entity_had_taken = true;
            let row = aggregates
                .entry(*skill_id)
                .or_insert_with(|| SkillAggregate {
                    skill_id: *skill_id,
                    ..Default::default()
                });
            aggregate_skill(row, *uid, entity, stats);
        }
        for ((skill_id, source_monster_id), stats) in &entity.skill_taken_from_source {
            if *source_monster_id == 0 || (stats.hits == 0 && stats.total_value == 0) {
                continue;
            }
            if entity.skill_uid_to_taken_skill.contains_key(skill_id) {
                if let Some(row) = aggregates.get_mut(skill_id) {
                    row.source_monster_ids.insert(*source_monster_id);
                }
            }
        }
        if entity_had_taken {
            tanked_entity_count += 1;
        }
    }

    let mut rows = aggregates
        .values()
        .map(|agg| {
            let skill_key = agg.skill_id.to_string();
            let detail = skill_details.get(&skill_key);
            let damage = damage_names.get(&skill_key);
            let recount = recount_by_damage.get(&agg.skill_id).copied();
            let mut fields = Vec::new();
            for (field_name, entry, field) in [
                ("DamageAttrIdName.Names", damage, "Names"),
                (
                    "DamageAttrIdName.LinkedSkillTableNames",
                    damage,
                    "LinkedSkillTableNames",
                ),
                (
                    "DamageAttrIdName.LinkedSkillEffectSkillTableNames",
                    damage,
                    "LinkedSkillEffectSkillTableNames",
                ),
                (
                    "DamageAttrIdName.LinkedBuffNames",
                    damage,
                    "LinkedBuffNames",
                ),
                ("SkillBreakdownDetails.DisplayNames", detail, "DisplayNames"),
                ("SkillBreakdownDetails.DamageNames", detail, "DamageNames"),
                (
                    "SkillBreakdownDetails.DisplayDetailNames",
                    detail,
                    "DisplayDetailNames",
                ),
                (
                    "SkillBreakdownDetails.DisplayVariantNames",
                    detail,
                    "DisplayVariantNames",
                ),
                ("SkillBreakdownDetails.LinkedNames", detail, "LinkedNames"),
                (
                    "SkillBreakdownDetails.UnderlyingSkillNames",
                    detail,
                    "UnderlyingSkillNames",
                ),
                (
                    "SkillBreakdownDetails.MonsterOwnerNames",
                    detail,
                    "MonsterOwnerNames",
                ),
                ("RecountTable.Names", recount, "Names"),
            ] {
                if let Some(coverage) = field_coverage(entry, field_name, field, &locales) {
                    fields.push(coverage);
                }
            }

            let visible_previews = locales
                .iter()
                .map(|locale| {
                    let name =
                        visible_name(agg.skill_id, locale, &locales, detail, damage, recount);
                    let detail_text = visible_detail(locale, detail);
                    VisibleLocalePreview {
                        locale: locale.clone(),
                        leaks_cjk: !allows_cjk_script(locale)
                            && (has_cjk(&name) || has_cjk(&detail_text)),
                        uses_placeholder: is_placeholder(&name) || is_placeholder(&detail_text),
                        name,
                        detail: detail_text,
                    }
                })
                .collect::<Vec<_>>();
            let visible_leak_locales = visible_previews
                .iter()
                .filter(|preview| preview.leaks_cjk || preview.uses_placeholder)
                .map(|preview| preview.locale.clone())
                .collect::<Vec<_>>();
            let missing_any_app_locale =
                fields.iter().any(|field| !field.missing_locales.is_empty());
            let design_only_visible_source =
                is_design_only_map(locale_map(detail, "DisplayNames"), &locales)
                    || is_design_only_map(locale_map(damage, "Names"), &locales);
            let recount_id = recount
                .and_then(|group| group.get("Id"))
                .and_then(Value::as_i64);

            SkillAuditRow {
                skill_id: agg.skill_id,
                total_value: agg.total_value.to_string(),
                effective_total_value: agg.effective_total_value.to_string(),
                hits: agg.hits.to_string(),
                entities: agg.entities.iter().cloned().collect(),
                source_monster_ids: agg.source_monster_ids.iter().copied().collect(),
                source_monsters: agg
                    .source_monster_ids
                    .iter()
                    .map(|id| source_monster_preview(&monster_names, *id, &locales))
                    .collect(),
                properties: agg.properties.iter().copied().collect(),
                damage_modes: agg.damage_modes.iter().copied().collect(),
                recount_id,
                fields,
                missing_any_app_locale,
                design_only_visible_source,
                visible_leak_locales,
                visible_previews,
            }
        })
        .collect::<Vec<_>>();

    rows.sort_by(|left, right| {
        let left_total = left.total_value.parse::<u128>().unwrap_or(0);
        let right_total = right.total_value.parse::<u128>().unwrap_or(0);
        right_total
            .cmp(&left_total)
            .then_with(|| left.skill_id.cmp(&right.skill_id))
    });

    let report = AuditReport {
        database_path: db_path.to_string_lossy().to_string(),
        encounter_id: encounter.id,
        scene_name: encounter.scene_name,
        locales,
        entity_count: entities.len(),
        tanked_entity_count,
        tanked_skill_count: rows.len(),
        rows_with_missing_locale_fields: rows
            .iter()
            .filter(|row| row.missing_any_app_locale)
            .count(),
        rows_with_visible_leaks: rows
            .iter()
            .filter(|row| !row.visible_leak_locales.is_empty())
            .count(),
        focus_ids: rows.iter().map(|row| row.skill_id).collect(),
        rows,
    };

    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&out_path, serde_json::to_vec_pretty(&report)?)?;
    println!(
        "Audited latest tanked encounter #{} ({} skill ids). Wrote {}",
        report.encounter_id,
        report.tanked_skill_count,
        out_path.display(),
    );
    Ok(())
}
