import type { DeathRecord } from "$lib/api";
import { legacyEntityFallbacksDisabled } from "$lib/entity-identity-dry-run";
import { normalizeEntityUuid } from "$lib/entity-id";
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
    normalizeEntityUuid(record.victimEntityUuid) ??
    normalizeLiveEntityKey(record.victimKey) ??
    deathRecordVictimUuid(record)?.toString() ??
    null
  );
}

export function deathRecordIdentityKey(record: DeathRecord): string {
  const entityKey = deathRecordVictimEntityKey(record);
  if (entityKey) return `entity:${entityKey}`;
  if (legacyEntityFallbacksDisabled()) {
    return `missing-entity-key:${deathRecordVictimUid(record)}`;
  }
  return `uid:${deathRecordVictimUid(record)}`;
}

export function deathRecordRouteIdentity(
  record: DeathRecord,
): LiveEntityRouteIdentity {
  const uid = deathRecordVictimUid(record);
  return {
    playerUid: !legacyEntityFallbacksDisabled() && uid > 0 ? uid : null,
    entityUuid: deathRecordVictimEntityKey(record),
    entityKey: deathRecordVictimEntityKey(record),
  };
}

export function deathRecordMatchesRoute(
  record: DeathRecord,
  identity: LiveEntityRouteIdentity,
): boolean {
  const recordEntityKey = deathRecordVictimEntityKey(record);
  const identityEntityKey = identity.entityUuid ?? identity.entityKey;
  if (identityEntityKey && recordEntityKey) {
    return identityEntityKey === recordEntityKey;
  }
  if (legacyEntityFallbacksDisabled()) return false;
  const recordUid = deathRecordVictimUid(record);
  return identity.playerUid !== null && recordUid === identity.playerUid;
}

export function deathRecordRouteSubject(
  record: DeathRecord,
): LiveEntityRouteSubject {
  return {
    uid: deathRecordVictimUid(record),
    entityUuid: deathRecordVictimEntityKey(record),
    entityKey: deathRecordVictimEntityKey(record),
  };
}
