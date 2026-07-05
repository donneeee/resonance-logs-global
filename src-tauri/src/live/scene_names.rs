use crate::parser_data;
use log::warn;
use parking_lot::RwLock;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::LazyLock;

const SCENE_NAME_RELATIVE: &str = "generated/scenenames.json";
const SCENE_NAME_OVERRIDES: &[(i32, &str)] = &[
    (12030, "Ee-chan, Don't Stare at Me!"),
    (12040, "Ee-chan, Don't Stare at Me!"),
];

/// Stores cached scene names to minimize JSON reloads.
#[derive(Default)]
struct SceneNameCache {
    names: HashMap<i32, String>,
}

static SCENE_NAME_CACHE: LazyLock<RwLock<SceneNameCache>> = LazyLock::new(|| {
    let cache = load_scene_names();
    RwLock::new(cache)
});

/// Returns the name for the given scene id, or a default string if not found.
pub fn lookup(scene_id: i32) -> String {
    if let Some(name) = scene_name_override(scene_id) {
        return name.to_string();
    }

    let cache = SCENE_NAME_CACHE.read();
    cache
        .names
        .get(&scene_id)
        .cloned()
        .unwrap_or_else(|| format!("Unknown Scene {}", scene_id))
}

fn scene_name_override(scene_id: i32) -> Option<&'static str> {
    SCENE_NAME_OVERRIDES
        .iter()
        .find_map(|(id, name)| (*id == scene_id).then_some(*name))
}

/// Returns the scene name with optional dungeon difficulty suffix.
pub fn lookup_with_difficulty(scene_id: i32, difficulty: Option<i32>) -> String {
    let base_name = lookup(scene_id);
    with_difficulty(&base_name, difficulty)
}

pub fn has_difficulty_suffix(scene_name: &str) -> bool {
    scene_name
        .rsplit_once('-')
        .is_some_and(|(_, suffix)| !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()))
}

pub fn with_difficulty(scene_name: &str, dungeon_difficulty: Option<i32>) -> String {
    let scene_name = scene_name.trim();
    let scene_name = if scene_name.is_empty() {
        "Unknown Scene"
    } else {
        scene_name
    };
    let difficulty = dungeon_difficulty.unwrap_or_default();
    if difficulty > 0 && !has_difficulty_suffix(scene_name) {
        format!("{scene_name}-{difficulty}")
    } else {
        scene_name.to_string()
    }
}

/// Returns true if a scene id exists in the loaded scene map.
#[allow(dead_code)]
pub fn contains(scene_id: i32) -> bool {
    let cache = SCENE_NAME_CACHE.read();
    cache.names.contains_key(&scene_id)
}

/// Loads the scene names JSON file and builds a lookup map from id to display name.
fn load_scene_names() -> SceneNameCache {
    let mut names = HashMap::new();

    match parser_data::read_to_string(SCENE_NAME_RELATIVE) {
        Ok(data) => match serde_json::from_str::<Value>(&data) {
            Ok(Value::Object(root)) => {
                for (id_str, name_value) in root {
                    if let Ok(scene_id) = id_str.parse::<i32>() {
                        if let Some(name) = name_value.as_str() {
                            names.insert(scene_id, name.to_string());
                        } else if let Some(name) = name_value
                            .as_object()
                            .and_then(|entry| entry.get("Name"))
                            .and_then(Value::as_str)
                        {
                            names.insert(scene_id, name.to_string());
                        }
                    }
                }
            }
            Ok(_) => {
                warn!(
                    "Scene names JSON is not an object at {}",
                    SCENE_NAME_RELATIVE
                );
            }
            Err(err) => {
                warn!(
                    "Failed to parse scene names JSON at {}: {}",
                    SCENE_NAME_RELATIVE, err
                );
            }
        },
        Err(err) => {
            warn!(
                "Failed to read scene names JSON at {}: {}",
                SCENE_NAME_RELATIVE, err
            );
        }
    }

    SceneNameCache { names }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_positive_difficulty_once() {
        assert_eq!(
            with_difficulty("Cursed Radiant Tomb", Some(1)),
            "Cursed Radiant Tomb-1"
        );
        assert_eq!(
            with_difficulty("Cursed Radiant Tomb-1", Some(2)),
            "Cursed Radiant Tomb-1"
        );
    }

    #[test]
    fn ignores_missing_or_non_positive_difficulty() {
        assert_eq!(
            with_difficulty("Cursed Radiant Tomb", None),
            "Cursed Radiant Tomb"
        );
        assert_eq!(
            with_difficulty("Cursed Radiant Tomb", Some(0)),
            "Cursed Radiant Tomb"
        );
    }

    #[test]
    fn normalizes_blank_scene_names() {
        assert_eq!(with_difficulty("   ", Some(1)), "Unknown Scene-1");
    }
}
