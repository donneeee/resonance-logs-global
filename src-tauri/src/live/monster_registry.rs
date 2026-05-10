use crate::parser_data;
use anyhow::{Context, Result};
use log::warn;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum MonsterType {
    Normal = 0,
    Elite = 1,
    Boss = 2,
}

#[derive(Debug, Clone)]
pub struct MonsterInfo {
    pub name: String,
    pub monster_type: MonsterType,
}

const MONSTER_ID_NAME_TYPE_RELATIVE: &str = "generated/monsternames.json";
const EXTRA_BUFF_MONITORED_MONSTERS_RELATIVE: &str = "logic/ExtraBuffMonitoredMonsters.json";
const BOSS_METRIC_EXCLUDED_MONSTERS_RELATIVE: &str = "logic/BossMetricExcludedMonsters.json";

static MONSTER_REGISTRY: LazyLock<HashMap<i32, MonsterInfo>> = LazyLock::new(|| {
    #[derive(Deserialize)]
    struct RawMonsterInfo {
        #[serde(rename = "Name")]
        name: String,
        #[serde(rename = "MonsterType")]
        monster_type: u8,
    }

    let data = parser_data::read_to_string(MONSTER_ID_NAME_TYPE_RELATIVE).unwrap_or_else(|err| {
        warn!(
            "[monster-registry] failed to load {}: {}",
            MONSTER_ID_NAME_TYPE_RELATIVE, err
        );
        String::new()
    });
    let raw: HashMap<String, RawMonsterInfo> = serde_json::from_str(&data).unwrap_or_else(|err| {
        warn!(
            "[monster-registry] failed to parse {}: {}",
            MONSTER_ID_NAME_TYPE_RELATIVE, err
        );
        HashMap::new()
    });

    let mut registry = HashMap::with_capacity(raw.len());
    for (key, info) in raw {
        if let Ok(id) = key.parse::<i32>() {
            let monster_type = match info.monster_type {
                1 => MonsterType::Elite,
                2 => MonsterType::Boss,
                _ => MonsterType::Normal,
            };

            registry.insert(
                id,
                MonsterInfo {
                    name: info.name,
                    monster_type,
                },
            );
        }
    }

    registry
});

static EXTRA_BUFF_MONITORED_MONSTER_IDS: LazyLock<HashSet<i32>> = LazyLock::new(|| {
    load_monster_id_list(EXTRA_BUFF_MONITORED_MONSTERS_RELATIVE).unwrap_or_else(|err| {
        warn!(
            "[monster-registry] failed to load {}: {}",
            EXTRA_BUFF_MONITORED_MONSTERS_RELATIVE, err
        );
        HashSet::new()
    })
});

static BOSS_METRIC_EXCLUDED_MONSTER_IDS: LazyLock<HashSet<i32>> = LazyLock::new(|| {
    load_monster_id_list(BOSS_METRIC_EXCLUDED_MONSTERS_RELATIVE).unwrap_or_else(|err| {
        warn!(
            "[monster-registry] failed to load {}: {}",
            BOSS_METRIC_EXCLUDED_MONSTERS_RELATIVE, err
        );
        HashSet::new()
    })
});

static BOSS_METRIC_EXCLUDED_MONSTER_NAMES: LazyLock<HashSet<String>> = LazyLock::new(|| {
    BOSS_METRIC_EXCLUDED_MONSTER_IDS
        .iter()
        .filter_map(|id| MONSTER_REGISTRY.get(id))
        .map(|info| normalize_monster_name(&info.name))
        .filter(|name| !name.is_empty())
        .collect()
});

#[derive(Debug, Deserialize)]
struct RawMonsterIdList {
    #[serde(rename = "monsterIds")]
    monster_ids: Vec<i32>,
}

fn normalize_monster_name(name: &str) -> String {
    name.trim().to_ascii_lowercase()
}

fn parse_monster_id_list(contents: &str) -> Result<HashSet<i32>, serde_json::Error> {
    let raw: RawMonsterIdList = serde_json::from_str(contents)?;
    Ok(raw.monster_ids.into_iter().filter(|id| *id > 0).collect())
}

fn load_monster_id_list(relative_path: &str) -> Result<HashSet<i32>> {
    let contents = parser_data::read_to_string(relative_path)
        .with_context(|| format!("failed to read {}", relative_path))?;
    parse_monster_id_list(&contents).with_context(|| format!("failed to parse {}", relative_path))
}

pub fn monster_name(id: i32) -> Option<&'static str> {
    MONSTER_REGISTRY.get(&id).map(|info| info.name.as_str())
}

pub fn monster_type(id: i32) -> Option<MonsterType> {
    MONSTER_REGISTRY.get(&id).map(|info| info.monster_type)
}

pub fn is_extra_buff_monitored_monster(id: i32) -> bool {
    EXTRA_BUFF_MONITORED_MONSTER_IDS.contains(&id)
}

pub fn counts_as_boss_metric_monster(id: i32) -> bool {
    monster_type(id)
        .map(|monster_type| {
            monster_type == MonsterType::Boss && !BOSS_METRIC_EXCLUDED_MONSTER_IDS.contains(&id)
        })
        .unwrap_or(false)
}

pub fn counts_as_elite_or_boss_metric_monster(id: i32) -> bool {
    monster_type(id)
        .map(|monster_type| {
            matches!(monster_type, MonsterType::Elite)
                || (monster_type == MonsterType::Boss
                    && !BOSS_METRIC_EXCLUDED_MONSTER_IDS.contains(&id))
        })
        .unwrap_or(false)
}

pub fn is_boss_metric_excluded_monster_name(name: &str) -> bool {
    let normalized = normalize_monster_name(name);
    !normalized.is_empty()
        && (BOSS_METRIC_EXCLUDED_MONSTER_NAMES.contains(&normalized)
            || normalized.ends_with("_coordinate")
            || normalized.ends_with("_coordinates"))
}
