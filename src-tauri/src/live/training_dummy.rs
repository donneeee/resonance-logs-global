use crate::live::entity_id::uid_from_uuid;
use crate::live::opcodes_models::{Encounter, attr_type};
use blueprotobuf_lib::blueprotobuf::{AoiSyncDelta, EDamageType};
use std::time::{Duration, Instant};

pub const DEFAULT_TRAINING_SEGMENT_DURATION: Duration = Duration::from_secs(180);
pub const MIN_TRAINING_SEGMENT_DURATION_SECS: u64 = 10;
pub const MAX_TRAINING_SEGMENT_DURATION_SECS: u64 = 600;

#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub enum TrainingDummyPhase {
    #[default]
    Idle,
    Armed,
    Running,
    Finished,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum CombatGate {
    #[default]
    AllowAll,
    Only(i64),
    BlockAll,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum TrainingDummyMonsterId {
    EliteEnemy = 115,
    EliteGuardian = 122,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("unsupported training dummy monster id: {0}")]
pub struct InvalidTrainingDummyMonsterId(pub i32);

impl TrainingDummyMonsterId {
    pub fn id(self) -> i32 {
        self as i32
    }
}

impl TryFrom<i32> for TrainingDummyMonsterId {
    type Error = InvalidTrainingDummyMonsterId;

    fn try_from(value: i32) -> Result<Self, Self::Error> {
        match value {
            115 => Ok(Self::EliteEnemy),
            122 => Ok(Self::EliteGuardian),
            _ => Err(InvalidTrainingDummyMonsterId(value)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrainingDummyMatch {
    pub target_uid: i64,
    pub target_entity_uuid: i64,
    pub monster_id: TrainingDummyMonsterId,
    pub has_local_player_damage: bool,
}

#[derive(Debug, Clone)]
pub struct TrainingDummyRuntime {
    pub phase: TrainingDummyPhase,
    pub locked_target_uuid: Option<i64>,
    pub rollover_ready_at: Option<Instant>,
    pub segment_saved: bool,
    pub segment_duration: Duration,
}

impl Default for TrainingDummyRuntime {
    fn default() -> Self {
        Self {
            phase: TrainingDummyPhase::Idle,
            locked_target_uuid: None,
            rollover_ready_at: None,
            segment_saved: false,
            segment_duration: DEFAULT_TRAINING_SEGMENT_DURATION,
        }
    }
}

fn clamp_training_segment_duration(duration_seconds: Option<u64>) -> Duration {
    let seconds = duration_seconds.unwrap_or(DEFAULT_TRAINING_SEGMENT_DURATION.as_secs());
    Duration::from_secs(seconds.clamp(
        MIN_TRAINING_SEGMENT_DURATION_SECS,
        MAX_TRAINING_SEGMENT_DURATION_SECS,
    ))
}

impl TrainingDummyRuntime {
    pub fn arm(&mut self) {
        self.arm_with_duration(None);
    }

    pub fn arm_with_duration(&mut self, duration_seconds: Option<u64>) {
        self.phase = TrainingDummyPhase::Armed;
        self.locked_target_uuid = None;
        self.rollover_ready_at = None;
        self.segment_saved = false;
        self.segment_duration = clamp_training_segment_duration(duration_seconds);
    }

    pub fn clear(&mut self) {
        *self = Self::default();
    }

    pub fn is_active(&self) -> bool {
        self.phase != TrainingDummyPhase::Idle
    }

    pub fn rearm(&mut self) {
        if self.is_active() {
            self.arm_with_duration(Some(self.segment_duration.as_secs()));
        } else {
            self.clear();
        }
    }

    pub fn combat_gate(&self) -> CombatGate {
        match self.phase {
            TrainingDummyPhase::Idle | TrainingDummyPhase::Armed => CombatGate::AllowAll,
            TrainingDummyPhase::Running => self
                .locked_target_uuid
                .map_or(CombatGate::AllowAll, CombatGate::Only),
            TrainingDummyPhase::Finished => CombatGate::BlockAll,
        }
    }

    pub fn maybe_finish(&mut self) -> bool {
        if self.phase != TrainingDummyPhase::Running {
            return false;
        }
        if self
            .rollover_ready_at
            .is_some_and(|trigger_at| Instant::now() >= trigger_at)
        {
            self.phase = TrainingDummyPhase::Finished;
            return true;
        }
        false
    }

    pub fn should_lock_on_match(&self, matched: TrainingDummyMatch) -> bool {
        self.phase == TrainingDummyPhase::Armed && matched.has_local_player_damage
    }

    pub fn lock_target(&mut self, matched: TrainingDummyMatch) {
        let now = Instant::now();
        self.phase = TrainingDummyPhase::Running;
        self.locked_target_uuid = Some(matched.target_entity_uuid);
        self.rollover_ready_at = Some(now + self.segment_duration);
        self.segment_saved = false;
    }

    pub fn duration_ms(&self) -> u64 {
        u64::try_from(self.segment_duration.as_millis()).unwrap_or(u64::MAX)
    }

    pub fn remaining_ms(&self) -> u64 {
        match self.phase {
            TrainingDummyPhase::Armed => self.duration_ms(),
            TrainingDummyPhase::Running => self.rollover_ready_at.map_or(0, |ready_at| {
                u64::try_from(
                    ready_at
                        .saturating_duration_since(Instant::now())
                        .as_millis(),
                )
                .unwrap_or(u64::MAX)
            }),
            TrainingDummyPhase::Idle | TrainingDummyPhase::Finished => 0,
        }
    }
}

pub fn inspect_aoi_delta(
    encounter: &Encounter,
    delta: &AoiSyncDelta,
    local_player_uuid: i64,
) -> Option<TrainingDummyMatch> {
    let target_uuid = delta.uuid?;
    let target_uid = uid_from_uuid(target_uuid);
    let monster_id = resolve_target_monster_id(encounter, delta, target_uuid)?;
    let has_local_player_damage = delta.skill_effects.as_ref().is_some_and(|effects| {
        effects
            .damages
            .iter()
            .any(|damage| is_local_player_damage(damage, local_player_uuid))
    });

    Some(TrainingDummyMatch {
        target_uid,
        target_entity_uuid: target_uuid,
        monster_id,
        has_local_player_damage,
    })
}

fn resolve_target_monster_id(
    encounter: &Encounter,
    delta: &AoiSyncDelta,
    target_uuid: i64,
) -> Option<TrainingDummyMonsterId> {
    let attrs_monster_id = delta.attrs.as_ref().and_then(|attrs| {
        attrs.attrs.iter().find_map(|attr| {
            (attr.id == Some(attr_type::ATTR_ID))
                .then(|| {
                    attr.raw_data
                        .as_deref()
                        .and_then(|raw| decode_attr_id(Some(raw)))
                })
                .flatten()
        })
    });

    attrs_monster_id
        .or_else(|| {
            encounter
                .entity_by_uuid(target_uuid)
                .and_then(|entity| entity.monster_type_id)
        })
        .and_then(|monster_id| TrainingDummyMonsterId::try_from(monster_id).ok())
}

fn decode_attr_id(raw: Option<&[u8]>) -> Option<i32> {
    let mut buf = raw?;
    prost::encoding::decode_varint(&mut buf)
        .ok()
        .and_then(|value| i32::try_from(value).ok())
}

fn is_local_player_damage(
    damage: &blueprotobuf_lib::blueprotobuf::SyncDamageInfo,
    local_player_uuid: i64,
) -> bool {
    if local_player_uuid <= 0 {
        return false;
    }
    if damage.r#type.unwrap_or(0) == EDamageType::Heal as i32 {
        return false;
    }
    if damage.value.is_none() && damage.lucky_value.is_none() {
        return false;
    }
    if damage.owner_id.is_none() {
        return false;
    }

    damage
        .top_summoner_id
        .is_some_and(|uuid| uuid == local_player_uuid)
        || damage
            .attacker_uuid
            .is_some_and(|uuid| uuid == local_player_uuid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use blueprotobuf_lib::blueprotobuf::SyncDamageInfo;

    fn player_damage(attacker_uuid: Option<i64>, top_summoner_id: Option<i64>) -> SyncDamageInfo {
        SyncDamageInfo {
            r#type: Some(EDamageType::Normal as i32),
            value: Some(1),
            attacker_uuid,
            top_summoner_id,
            owner_id: Some(1),
            ..Default::default()
        }
    }

    #[test]
    fn local_attacker_counts_even_with_non_local_top_summoner() {
        let damage = player_damage(Some(100), Some(200));

        assert!(is_local_player_damage(&damage, 100));
    }

    #[test]
    fn local_top_summoner_counts_for_owned_sources() {
        let damage = player_damage(Some(200), Some(100));

        assert!(is_local_player_damage(&damage, 100));
    }

    #[test]
    fn non_local_damage_does_not_lock_training_dummy() {
        let damage = player_damage(Some(200), Some(300));

        assert!(!is_local_player_damage(&damage, 100));
    }

    #[test]
    fn healing_does_not_lock_training_dummy() {
        let mut damage = player_damage(Some(100), None);
        damage.r#type = Some(EDamageType::Heal as i32);

        assert!(!is_local_player_damage(&damage, 100));
    }
}
