export type LiveEntityRouteSubject = {
  uid: number;
  entityKey?: string | null;
};

export type LiveEntityRouteIdentity = {
  playerUid: number | null;
  entityKey: string | null;
};

export function normalizeLiveEntityKey(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

export function liveRouteIdentityFromSearch(
  searchParams: URLSearchParams,
): LiveEntityRouteIdentity {
  const rawPlayerUid = Number(searchParams.get("playerUid") ?? "");
  return {
    playerUid:
      Number.isFinite(rawPlayerUid) && rawPlayerUid > 0 ? rawPlayerUid : null,
    entityKey: normalizeLiveEntityKey(searchParams.get("entityKey")),
  };
}

export function liveEntityMatchesRoute(
  subject: LiveEntityRouteSubject | null | undefined,
  identity: LiveEntityRouteIdentity,
): boolean {
  if (!subject) return false;

  const subjectEntityKey = normalizeLiveEntityKey(subject.entityKey);
  if (identity.entityKey && subjectEntityKey) {
    return identity.entityKey === subjectEntityKey;
  }

  return identity.playerUid !== null && subject.uid === identity.playerUid;
}

export function livePlayerRouteQuery(
  subject: LiveEntityRouteSubject,
  extra?: Record<string, string | number | boolean | null | undefined>,
): string {
  const searchParams = new URLSearchParams();
  const entityKey = normalizeLiveEntityKey(subject.entityKey);
  if (entityKey) {
    searchParams.set("entityKey", entityKey);
  }
  if (Number.isFinite(subject.uid) && subject.uid > 0) {
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
