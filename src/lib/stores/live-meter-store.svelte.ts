import type { DeathRecord, LiveDataPayload, TrainingDummyState } from "$lib/api";

let liveData = $state<LiveDataPayload | null>(null);
let trainingDummyState = $state<TrainingDummyState | null>(null);
let deathRecords = $state<DeathRecord[]>([]);
let liveDisplayNowMs = $state(Date.now());
let crowdedLiveSession = $state(false);
let trainingDummyStateKey = "";

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

export function clearMeterData() {
  clearLiveData();
  clearDeathRecords();
}

export function cleanupStores() {
  clearLiveData();
  clearTrainingDummyState();
  clearDeathRecords();
}
