export type EntityId = string;

const ENTITY_UID_SHIFT = 16n;

export function normalizeEntityUuid(value: unknown): EntityId | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

export function entityUuidFromAliases(value: {
  entityUuid?: string | null;
  entityKey?: string | null;
} | null | undefined): EntityId | null {
  return normalizeEntityUuid(value?.entityUuid) ?? normalizeEntityUuid(value?.entityKey);
}

export function uidFromEntityUuid(entityUuid: EntityId): number {
  try {
    const uuid = BigInt(entityUuid);
    return Number(uuid >> ENTITY_UID_SHIFT);
  } catch {
    return 0;
  }
}

export function displayEntityId(entityUuid: EntityId): string {
  const uid = uidFromEntityUuid(entityUuid);
  return uid > 0 ? `#${uid}` : `#${entityUuid}`;
}
