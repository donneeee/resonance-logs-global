import { legacyEntityFallbacksDisabled } from "$lib/entity-identity-dry-run";
import { entityUuidFromAliases, normalizeEntityUuid } from "$lib/entity-id";

export type LiveEntityRouteSubject = {
  uid: number;
  displayUid?: number | null;
  entityUuid?: string | null;
  entityKey?: string | null;
};

export type LiveEntityRouteIdentity = {
  playerUid: number | null;
  entityUuid: string | null;
  /** Temporary compatibility alias while older callers are migrated. */
  entityKey: string | null;
};

export function normalizeLiveEntityKey(value: unknown): string | null {
  return normalizeEntityUuid(value);
}

export function liveEntityUuid(
  subject: LiveEntityRouteSubject | null | undefined,
): string | null {
  return entityUuidFromAliases(subject);
}

export function liveRouteIdentityFromSearch(
  searchParams: URLSearchParams,
): LiveEntityRouteIdentity {
  const rawPlayerUid = Number(searchParams.get("playerUid") ?? "");
  const entityUuid =
    normalizeLiveEntityKey(searchParams.get("entityUuid")) ??
    normalizeLiveEntityKey(searchParams.get("entityKey"));
  return {
    playerUid: legacyEntityFallbacksDisabled()
      ? null
      : Number.isFinite(rawPlayerUid) && rawPlayerUid > 0
        ? rawPlayerUid
        : null,
    entityUuid,
    entityKey: entityUuid,
  };
}

export function liveEntityMatchesRoute(
  subject: LiveEntityRouteSubject | null | undefined,
  identity: LiveEntityRouteIdentity,
): boolean {
  if (!subject) return false;

  const identityEntityUuid = identity.entityUuid ?? identity.entityKey;
  const subjectEntityUuid = liveEntityUuid(subject);
  if (identityEntityUuid && subjectEntityUuid) {
    return identityEntityUuid === subjectEntityUuid;
  }

  if (legacyEntityFallbacksDisabled()) return false;
  return identity.playerUid !== null && subject.uid === identity.playerUid;
}

export function liveEntityRenderKey(
  subject: LiveEntityRouteSubject | null | undefined,
): string | number {
  const entityUuid = liveEntityUuid(subject);
  if (entityUuid) return entityUuid;
  return legacyEntityFallbacksDisabled()
    ? `missing-entity-key:${subject?.uid ?? "unknown"}`
    : (subject?.uid ?? "unknown");
}

export function liveEntityMatchesLocalPlayer(
  subject: LiveEntityRouteSubject | null | undefined,
  localPlayer: {
    localPlayerUuid?: string | null;
    localPlayerKey?: string | null;
    localPlayerUid?: number | null;
  } | null | undefined,
): boolean {
  if (!subject || !localPlayer) return false;

  const localPlayerKey =
    normalizeLiveEntityKey(localPlayer.localPlayerUuid) ??
    normalizeLiveEntityKey(localPlayer.localPlayerKey);
  const subjectEntityUuid = liveEntityUuid(subject);
  if (localPlayerKey && subjectEntityUuid) {
    return localPlayerKey === subjectEntityUuid;
  }

  if (legacyEntityFallbacksDisabled()) return false;
  return (
    localPlayer.localPlayerUid != null &&
    Number.isFinite(subject.uid) &&
    subject.uid === localPlayer.localPlayerUid
  );
}

export function livePlayerRouteQuery(
  subject: LiveEntityRouteSubject,
  extra?: Record<string, string | number | boolean | null | undefined>,
): string {
  const searchParams = new URLSearchParams();
  const entityUuid = liveEntityUuid(subject);
  if (entityUuid) {
    searchParams.set("entityUuid", entityUuid);
  }
  if (
    !legacyEntityFallbacksDisabled() &&
    Number.isFinite(subject.uid) &&
    subject.uid > 0
  ) {
    searchParams.set("playerUid", String(subject.uid));
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    searchParams.set(key, String(value));
  }
  return searchParams.toString();
}

export function livePlayerRoute(
  basePath: string,
  subject: LiveEntityRouteSubject,
  extra?: Record<string, string | number | boolean | null | undefined>,
): string {
  const query = livePlayerRouteQuery(subject, extra);
  return query ? `${basePath}?${query}` : basePath;
}
