import type { DeathRecord } from "$lib/api";
import {
  normalizeLiveEntityKey,
  type LiveEntityRouteIdentity,
  type LiveEntityRouteSubject,
} from "$lib/live-entity-route";

function finitePositiveNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function deathRecordVictimUid(record: DeathRecord): number {
  return finitePositiveNumber(record.victimUid) ?? 0;
}

export function deathRecordVictimUuid(record: DeathRecord): number | null {
  return finitePositiveNumber(record.victimUuid);
}

export function deathRecordVictimEntityKey(record: DeathRecord): string | null {
  return (
    normalizeLiveEntityKey(record.victimKey) ??
    deathRecordVictimUuid(record)?.toString() ??
    null
  );
}

export function deathRecordIdentityKey(record: DeathRecord): string {
  const entityKey = deathRecordVictimEntityKey(record);
  if (entityKey) return `entity:${entityKey}`;
  return `uid:${deathRecordVictimUid(record)}`;
}

export function deathRecordRouteIdentity(
  record: DeathRecord,
): LiveEntityRouteIdentity {
  const uid = deathRecordVictimUid(record);
  return {
    playerUid: uid > 0 ? uid : null,
    entityKey: deathRecordVictimEntityKey(record),
  };
}

export function deathRecordMatchesRoute(
  record: DeathRecord,
  identity: LiveEntityRouteIdentity,
): boolean {
  const recordEntityKey = deathRecordVictimEntityKey(record);
  if (identity.entityKey && recordEntityKey) {
    return identity.entityKey === recordEntityKey;
  }
  const recordUid = deathRecordVictimUid(record);
  return identity.playerUid !== null && recordUid === identity.playerUid;
}

export function deathRecordRouteSubject(
  record: DeathRecord,
): LiveEntityRouteSubject {
  return {
    uid: deathRecordVictimUid(record),
    entityKey: deathRecordVictimEntityKey(record),
  };
}
