use blueprotobuf_lib::blueprotobuf::EEntityType;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

pub type EntityUuid = i64;
pub type EntityUid = i64;

pub const ENTITY_TYPE_SHIFT: i64 = 6;
pub const ENTITY_UID_SHIFT: i64 = 16;
pub const DISABLE_LEGACY_ENTITY_FALLBACKS_DRY_RUN: bool = true;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityIdentityAuditMode {
    Off,
    Warn,
    Strict,
}

pub fn legacy_entity_fallbacks_disabled() -> bool {
    static DISABLED: OnceLock<bool> = OnceLock::new();
    *DISABLED.get_or_init(|| {
        let value = std::env::var("RES_LOG_DISABLE_LEGACY_ENTITY_FALLBACKS")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        match value.as_str() {
            "0" | "false" | "off" | "no" => false,
            "1" | "true" | "on" | "yes" => true,
            _ => DISABLE_LEGACY_ENTITY_FALLBACKS_DRY_RUN,
        }
    })
}

pub fn entity_identity_audit_mode() -> EntityIdentityAuditMode {
    static MODE: OnceLock<EntityIdentityAuditMode> = OnceLock::new();
    *MODE.get_or_init(|| {
        let value = std::env::var("RES_LOG_ENTITY_ID_AUDIT")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        if value.is_empty() {
            return if legacy_entity_fallbacks_disabled() {
                EntityIdentityAuditMode::Warn
            } else {
                EntityIdentityAuditMode::Off
            };
        }
        match value.as_str() {
            "strict" | "error" | "fail" | "1" => EntityIdentityAuditMode::Strict,
            "warn" | "warning" | "log" | "true" | "yes" => EntityIdentityAuditMode::Warn,
            _ => EntityIdentityAuditMode::Off,
        }
    })
}

#[inline]
pub fn strict_entity_identity_audit_enabled() -> bool {
    legacy_entity_fallbacks_disabled()
        || entity_identity_audit_mode() == EntityIdentityAuditMode::Strict
}

pub fn audit_ambiguous_uid_fallback(caller: &str, uid: EntityUid, uuids: &[EntityUuid]) {
    if entity_identity_audit_mode() == EntityIdentityAuditMode::Off {
        return;
    }

    audit_warn_once(
        format!("ambiguous:{caller}:{uid}"),
        format_args!(
            "entity identity audit: {caller} used UID fallback for ambiguous uid={uid}; candidate_uuids={uuids:?}; set RES_LOG_ENTITY_ID_AUDIT=strict to block this fallback"
        ),
    );
}

pub fn audit_uuid_to_uid_fallback(caller: &str, uuid: EntityUuid, uid: EntityUid) {
    if entity_identity_audit_mode() == EntityIdentityAuditMode::Off {
        return;
    }

    audit_warn_once(
        format!("uuid-miss:{caller}:{uuid}:{uid}"),
        format_args!(
            "entity identity audit: {caller} could not find uuid={uuid} and fell back to derived uid={uid}; set RES_LOG_ENTITY_ID_AUDIT=strict to block this fallback"
        ),
    );
}

fn audit_warn_once(key: String, message: std::fmt::Arguments<'_>) {
    static SEEN: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let seen = SEEN.get_or_init(|| Mutex::new(HashSet::new()));
    if let Ok(mut seen) = seen.lock() {
        if !seen.insert(key) {
            return;
        }
    }
    log::warn!(target: "app::entity_identity", "{message}");
}

#[inline]
pub fn uid_from_uuid(uuid: EntityUuid) -> EntityUid {
    uuid >> ENTITY_UID_SHIFT
}

#[inline]
pub fn entity_uuid_string(uuid: EntityUuid) -> String {
    uuid.to_string()
}

#[inline]
pub fn entity_key_from_uuid_or_uid(uuid: Option<EntityUuid>, uid: EntityUid) -> Option<String> {
    uuid.filter(|value| *value != 0)
        .map(entity_uuid_string)
        .or_else(|| (!legacy_entity_fallbacks_disabled() && uid > 0).then(|| uid.to_string()))
}

#[inline]
pub fn canonical_player_uuid(char_id: EntityUid) -> EntityUuid {
    entity_id_to_uuid(char_id, EEntityType::EntChar, false, false)
}

#[inline]
pub fn entity_id_to_uuid(
    uid: EntityUid,
    entity_type: EEntityType,
    is_summon: bool,
    is_client: bool,
) -> EntityUuid {
    let summon_bit = if is_summon { 1_i64 } else { 0 };
    let client_bit = if is_client { 1_i64 } else { 0 };
    (uid << ENTITY_UID_SHIFT)
        | (summon_bit << 15)
        | (client_bit << 14)
        | (i64::from(entity_type as i32) << ENTITY_TYPE_SHIFT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_player_uuid_round_trips_to_uid() {
        let uid = 12_345_678;
        let uuid = canonical_player_uuid(uid);

        assert_eq!(uid_from_uuid(uuid), uid);
        assert_eq!(EEntityType::from(uuid), EEntityType::EntChar);
    }

    #[test]
    fn same_uid_can_have_distinct_entity_uuids() {
        let uid = 42;
        let player_uuid = entity_id_to_uuid(uid, EEntityType::EntChar, false, false);
        let monster_uuid = entity_id_to_uuid(uid, EEntityType::EntMonster, false, false);

        assert_eq!(uid_from_uuid(player_uuid), uid);
        assert_eq!(uid_from_uuid(monster_uuid), uid);
        assert_ne!(player_uuid, monster_uuid);
        assert_ne!(
            EEntityType::from(player_uuid),
            EEntityType::from(monster_uuid)
        );
    }
}
