use crate::parser_data;
use log::warn;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::LazyLock;

const SKILL_FIGHT_LEVEL_TABLE_RELATIVE: &str = "logic/SkillFightLevelTable.json";

#[derive(Debug, Clone, Deserialize)]
struct RawSkillFightLevelEntry {
    #[serde(rename = "SkillId")]
    skill_id: i32,
}

static SKILL_LEVEL_TO_BASE: LazyLock<HashMap<i32, i32>> = LazyLock::new(|| {
    load_skill_level_to_base_map().unwrap_or_else(|err| {
        warn!(
            "[skill-ids] failed to load SkillFightLevelTable.json: {}",
            err
        );
        HashMap::new()
    })
});

fn load_skill_level_to_base_map() -> Result<HashMap<i32, i32>, Box<dyn std::error::Error>> {
    let contents = parser_data::read_to_string(SKILL_FIGHT_LEVEL_TABLE_RELATIVE)?;
    let raw_map: HashMap<String, RawSkillFightLevelEntry> = serde_json::from_str(&contents)?;

    let mut result = HashMap::new();
    for (key, value) in raw_map {
        let Ok(skill_level_id) = key.parse::<i32>() else {
            continue;
        };
        if skill_level_id <= 0 || value.skill_id <= 0 {
            continue;
        }
        result.insert(skill_level_id, value.skill_id);
    }
    Ok(result)
}

pub fn base_skill_id_for_level_id(skill_level_id: i32) -> Option<i32> {
    SKILL_LEVEL_TO_BASE.get(&skill_level_id).copied()
}

pub fn normalize_skill_id(skill_id: i32) -> i32 {
    base_skill_id_for_level_id(skill_id).unwrap_or(skill_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_blast_shot_level_ids_to_base_skill_id() {
        assert_eq!(base_skill_id_for_level_id(223801), Some(2238));
        assert_eq!(base_skill_id_for_level_id(223810), Some(2238));
        assert_eq!(normalize_skill_id(223804), 2238);
        assert_eq!(normalize_skill_id(2238), 2238);
    }
}
