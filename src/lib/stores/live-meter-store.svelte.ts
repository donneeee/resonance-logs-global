import type {
  DeathRecord,
  LiveDataPayload,
  SkillCdState,
  TrainingDummyState,
} from "$lib/api";

let liveData = $state<LiveDataPayload | null>(null);
let trainingDummyState = $state<TrainingDummyState | null>(null);
let deathRecords = $state<DeathRecord[]>([]);
let skillCooldownsBySkillId = $state(new Map<number, SkillCdState>());
let liveDisplayNowMs = $state(Date.now());
let crowdedLiveSession = $state(false);
let trainingDummyStateKey = "";

function setCooldownIndex(
  target: Map<number, SkillCdState>,
  skillId: number,
  cd: SkillCdState,
): void {
  if (!Number.isFinite(skillId) || skillId <= 0) return;
  const normalizedId = Math.trunc(skillId);
  const existing = target.get(normalizedId);
  if (!existing || (cd.receivedAt ?? 0) >= (existing.receivedAt ?? 0)) {
    target.set(normalizedId, cd);
  }
}

function keyTrainingDummyState(data: TrainingDummyState): string {
  return `${data.phase}:${data.durationMs}:${data.remainingMs}`;
}

function updateTrainingDummyState(data: TrainingDummyState): void {
  const key = keyTrainingDummyState(data);
  if (key === trainingDummyStateKey) return;
  trainingDummyStateKey = key;
  trainingDummyState = data;
}

export function setLiveData(data: LiveDataPayload) {
  liveData = data;
  updateTrainingDummyState(data.trainingDummy);
  if (data.entities.length > 20) {
    crowdedLiveSession = true;
  }
}

export function getLiveData() {
  return liveData;
}

export function setLiveDisplayNowMs(nowMs = Date.now()) {
  liveDisplayNowMs = nowMs;
}

export function getLiveDisplayNowMs() {
  return liveDisplayNowMs;
}

export function setSkillCooldowns(skillCds: SkillCdState[] | null | undefined) {
  const next = new Map<number, SkillCdState>();
  for (const cd of skillCds ?? []) {
    setCooldownIndex(next, cd.skillLevelId, cd);
    setCooldownIndex(next, Math.trunc(cd.skillLevelId / 100), cd);
  }
  skillCooldownsBySkillId = next;
}

export function getSkillCooldownMap() {
  return skillCooldownsBySkillId;
}

export function isCrowdedLiveSession() {
  return crowdedLiveSession;
}

export function setTrainingDummyState(data: TrainingDummyState) {
  updateTrainingDummyState(data);
}

export function getTrainingDummyState() {
  return trainingDummyState;
}

export function setDeathRecords(records: DeathRecord[] | null | undefined) {
  deathRecords = records ?? [];
}

export function getDeathRecords() {
  return deathRecords;
}

export function clearLiveData() {
  liveData = null;
  crowdedLiveSession = false;
  liveDisplayNowMs = Date.now();
}

export function clearTrainingDummyState() {
  trainingDummyStateKey = "";
  trainingDummyState = null;
}

export function clearDeathRecords() {
  deathRecords = [];
}

export function clearSkillCooldowns() {
  skillCooldownsBySkillId = new Map();
}

export function clearMeterData() {
  clearLiveData();
  clearDeathRecords();
  clearSkillCooldowns();
}

export function cleanupStores() {
  clearLiveData();
  clearTrainingDummyState();
  clearDeathRecords();
  clearSkillCooldowns();
}
