import {
  getBuffCategoryLabel,
  getBuffIdsByCategory,
  resolveBuffOverlayDisplayName,
  type BuffCategoryKey,
} from "$lib/config/buff-name-table";
import { resolveDbmSkillName } from "$lib/config/dbm-table";
import { localizeMonsterName, localizeRawMonsterName } from "$lib/monster-mappings";
import { resolveMonsterMonitorTranslation } from "$lib/i18n";
import {
  SETTINGS,
  ensureBuffAliases,
  ensureBuffAlerts,
  type TeammateBuffColumnKey,
} from "$lib/settings-store";
import type {
  BuffUpdateState,
  HateEntry,
  StunEntry,
  TeammateFantasyState,
} from "$lib/api";
import { entityUuidFromAliases, uidFromEntityUuid } from "$lib/entity-id";
import {
  buildBuffTextRow,
  formatTimerText,
  resolveAlertState,
} from "../game-overlay/overlay-utils";
import type { BuffAlertState, TextBuffDisplay } from "../game-overlay/overlay-types";
import { legacyEntityFallbacksDisabled } from "$lib/entity-identity-dry-run";
import { monsterRuntime } from "./monster-runtime.svelte.js";
import {
  fantasyEntryKey,
  withPreservedFantasySummonerName,
} from "./monster-fantasy";
import type {
  MonsterBossBuffSection,
  MonsterFantasyRow,
  MonsterHateSection,
  MonsterStunSection,
  MonsterTeammateBuffColumn,
  MonsterTeammateBuffRow,
} from "./monster-types";

const FANTASY_DISPLAY_TTL_MS = 5000;
const STUN_BROKEN_HIGHLIGHT_COLOR = "#ff4d4f";
const STUN_BROKEN_FLASH_INTERVAL_MS = 600;
const MONSTER_DISPLAY_REFRESH_MS = 100;
const USE_LEGACY_MONSTER_TARGET_UID_TITLE_FALLBACK = false;
const USE_LEGACY_MONSTER_ENTITY_UID_NAME_FALLBACK = false;
const MAX_DIRECT_ENTITY_UID = 0xFFFF_FFFF;

type TeammateColumnDefinition =
  | {
      key: TeammateBuffColumnKey;
      label: string;
      kind: "buff";
      buffId: number;
    }
  | {
      key: TeammateBuffColumnKey;
      label: string;
      kind: "category";
      categoryKey: BuffCategoryKey;
      buffIds: number[];
    };


function tMonster(key: string, fallback: string): string {
  return resolveMonsterMonitorTranslation(
    key,
    SETTINGS.live.general.state.language,
    fallback,
  );
}

function buffCategoryLabel(category: BuffCategoryKey): string {
  return tMonster(`teammate.category.${category}`, getBuffCategoryLabel(category));
}

function legacyTargetTitle(entityKey: string | number): string {
  const key = String(entityKey);
  const uid = uidFromEntityKey(key);
  return `${tMonster("placeholder.targetPrefix", "Target")} ${uid || key}`;
}

function targetTitle(entityKey: string | number): string {
  if (USE_LEGACY_MONSTER_TARGET_UID_TITLE_FALLBACK) {
    return legacyTargetTitle(entityKey);
  }
  return tMonster("placeholder.unknownTarget", "Unknown Target");
}

function unknownEntityName(): string {
  return tMonster("placeholder.unknownEntity", "Unknown Entity");
}

function unknownTeammateName(): string {
  return tMonster("placeholder.unknownTeammate", "Unknown Teammate");
}

function legacyMonsterUidFallbacksEnabled(): boolean {
  return !legacyEntityFallbacksDisabled();
}

const SYNTHETIC_TARGET_PREFIXES = [
  "Target",
  "\u76ee\u6807",
  "\u76ee\u6a19",
  "\u5bfe\u8c61",
  "\ub300\uc0c1",
  "Alvo",
  "Objetivo",
  "Cible",
  "Ziel",
  "\u0e40\u0e1b\u0e49\u0e32\u0e2b\u0e21\u0e32\u0e22",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SYNTHETIC_TARGET_NAME_PATTERN = new RegExp(
  `^(?:${SYNTHETIC_TARGET_PREFIXES.map(escapeRegExp).join("|")})\\s+(\\d+)(?:\\s+\\(You\\))?$`,
  "i",
);

function syntheticTargetUid(rawName: string): number | null {
  const match = SYNTHETIC_TARGET_NAME_PATTERN.exec(rawName.trim());
  if (!match) return null;
  const uid = Number(match[1]);
  return Number.isSafeInteger(uid) && uid > 0 ? uid : null;
}

function isSyntheticEntityName(rawName: string, uid = 0): boolean {
  const trimmed = rawName.trim();
  if (!trimmed) return true;
  if (syntheticTargetUid(trimmed) !== null) return true;
  if (/^UID\s+\d+$/i.test(trimmed)) return true;

  if (uid > 0 && trimmed.includes(String(uid))) {
    const compactPrefix = trimmed
      .replace(String(uid), "")
      .replace(/\s+/g, "")
      .toLowerCase();
    if (compactPrefix === "uid" || compactPrefix === "target") return true;
    if (compactPrefix && !/[a-z]/i.test(compactPrefix) && /[^\x00-\x7F]/.test(compactPrefix)) {
      return true;
    }
  }

  return false;
}

function cachedRawNameForUid(uid: number): string | null {
  if (uid <= 0) return null;
  const rawName = monsterRuntime.nameCache.get(uid)?.trim();
  if (!rawName || isSyntheticEntityName(rawName, uid)) return null;
  return localizeRawMonsterName(rawName, rawName);
}

function cachedUidForEntityKey(entityKey: string): number {
  return uidFromEntityKey(entityKey);
}

function compareEntityKeys(left: string, right: string): number {
  const leftUid = uidFromEntityKey(left);
  const rightUid = uidFromEntityKey(right);
  if (leftUid !== rightUid) return leftUid - rightUid;
  return left.localeCompare(right);
}

function resolveMonsterSectionTitle(entityKey: string): string {
  const entityMonsterId = monsterRuntime.monsterIdByEntityKey.get(entityKey);
  if (entityMonsterId !== undefined) {
    return localizeMonsterName(entityMonsterId);
  }

  const displayUid = cachedUidForEntityKey(entityKey);
  const monsterId = displayUid > 0
    ? monsterRuntime.monsterIdCache.get(displayUid)
    : undefined;
  if (monsterId !== undefined) {
    return localizeMonsterName(monsterId);
  }

  const playerName = monsterRuntime.playerNameByEntityKey.get(entityKey)?.trim();
  if (playerName) return playerName;

  const rawName = cachedRawNameForUid(displayUid);
  if (rawName) {
    return rawName;
  }
  return targetTitle(entityKey);
}

function resolveEntityDisplayName(uid: number): string {
  const playerName = monsterRuntime.playerNameCache.get(uid)?.trim();
  if (playerName) return playerName;

  const monsterId = monsterRuntime.monsterIdCache.get(uid);
  if (monsterId !== undefined) {
    return localizeMonsterName(monsterId);
  }

  const rawName = cachedRawNameForUid(uid);
  if (rawName) {
    return rawName;
  }

  return USE_LEGACY_MONSTER_ENTITY_UID_NAME_FALLBACK
    ? `UID ${uid}`
    : unknownEntityName();
}

function resolveHateEntryDisplayName(entry: HateEntry): string {
  const entityKey = entityUuidFromAliases(entry);
  if (entityKey) {
    const playerName = monsterRuntime.playerNameByEntityKey.get(entityKey)?.trim();
    if (playerName) return playerName;

    const monsterId = monsterRuntime.monsterIdByEntityKey.get(entityKey);
    if (monsterId !== undefined) {
      return localizeMonsterName(monsterId);
    }

    const displayUid = cachedUidForEntityKey(entityKey);
    if (displayUid > 0) return resolveEntityDisplayName(displayUid);
  }

  return resolveEntityDisplayName(entry.uid);
}

function selectedMonsterBuffIds() {
  return Array.from(new Set([
    ...SETTINGS.monsterMonitor.state.monitoredBuffIds,
    ...SETTINGS.monsterMonitor.state.selfAppliedBuffIds,
  ]));
}

function buildPlaceholderRows(now: number): TextBuffDisplay[] {
  const aliases = ensureBuffAliases(SETTINGS.monsterMonitor.state.buffAliases);
  const selectedIds = selectedMonsterBuffIds();
  const priorityIds = SETTINGS.monsterMonitor.state.buffPriorityIds ?? [];
  const priorityIndex = new Map<number, number>();
  priorityIds.forEach((id, index) => priorityIndex.set(id, index));
  const fallbackBase = priorityIds.length;
  selectedIds.forEach((id, index) => {
    if (!priorityIndex.has(id)) {
      priorityIndex.set(id, fallbackBase + index);
    }
  });

  const rows = [...selectedIds]
    .sort((left, right) => {
      const leftPriority = priorityIndex.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = priorityIndex.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftPriority - rightPriority || left - right;
    })
    .map((baseId) =>
      buildBuffTextRow(
        `monster_preview_${baseId}`,
        resolveBuffOverlayDisplayName(baseId, aliases),
        {
          baseId,
          durationMs: 0,
          createTimeMs: now,
          layer: 1,
          hostUid: 0,
          sourceUid: 0,
        },
        now,
        true,
        true,
      ))
    .filter((row): row is TextBuffDisplay => row !== null);

  if (rows.length > 0) return rows;

  return [
    {
      key: "monster_preview_empty",
      label: tMonster("placeholder.selectBuff", "Select buffs in Monster Monitor"),
      valueText: "--",
      progressPercent: 0,
      showProgress: false,
      isPlaceholder: true,
    },
  ];
}

function buildHatePlaceholderRows(): TextBuffDisplay[] {
  return [
    {
      key: "monster_hate_preview_1",
      label: "1. UID 10001",
      valueText: "100%",
      progressPercent: 0,
      showProgress: false,
      isPlaceholder: true,
    },
    {
      key: "monster_hate_preview_2",
      label: "2. UID 10002",
      valueText: "68%",
      progressPercent: 0,
      showProgress: false,
      isPlaceholder: true,
    },
    {
      key: "monster_hate_preview_3",
      label: "3. UID 10003",
      valueText: "41%",
      progressPercent: 0,
      showProgress: false,
      isPlaceholder: true,
    },
  ];
}

function buildTeammatePlaceholderRows(
  columns: MonsterTeammateBuffColumn[],
): MonsterTeammateBuffRow[] {
  const effectiveColumns =
    columns.length > 0
      ? columns
      : [
          {
            key: "placeholder",
            label: tMonster("placeholder.buffName", "Buff"),
            buffIds: [0],
          },
        ];

  return [
    {
      teammateEntityUuid: "teammate_preview_1",
      teammateName: tMonster("placeholder.teammate", "Teammate Preview"),
      isPlaceholder: true,
      cells: effectiveColumns.map((column, index) => ({
        key: `teammate_preview_cell_${index + 1}`,
        buffId: column.buffIds[0] ?? 0,
        buffName: column.label,
        valueText: index === 0 ? "12s" : "--",
        metaText: index === 0 ? "x2" : undefined,
        progressPercent: index === 0 ? 60 : 0,
        hasBuff: true,
        categoryKey: column.categoryKey,
      })),
    },
  ];
}

function buildTeammateColumnDefinitions(
  aliases: ReturnType<typeof ensureBuffAliases>,
): TeammateColumnDefinition[] {
  const state = SETTINGS.monsterMonitor.state;
  const teammateBuffIds = state.teammateBuffIds ?? [];
  const teammateBuffCategories = state.teammateBuffCategories ?? [];
  const columns: TeammateColumnDefinition[] = teammateBuffIds.map((buffId) => ({
    key: `buff:${buffId}`,
    label: resolveBuffOverlayDisplayName(buffId, aliases),
    kind: "buff",
    buffId,
  }));

  for (const categoryKey of teammateBuffCategories) {
    columns.push({
      key: `category:${categoryKey}`,
      label: buffCategoryLabel(categoryKey),
      kind: "category",
      categoryKey,
      buffIds: getBuffIdsByCategory(categoryKey),
    });
  }

  return columns;
}

function orderTeammateColumnDefinitions(
  columns: TeammateColumnDefinition[],
): TeammateColumnDefinition[] {
  const order = SETTINGS.monsterMonitor.state.teammateBuffColumnOrder ?? [];
  if (order.length === 0) return columns;

  const byKey = new Map(columns.map((column) => [column.key, column]));
  const seen = new Set<TeammateBuffColumnKey>();
  const ordered: TeammateColumnDefinition[] = [];
  for (const key of order) {
    const column = byKey.get(key);
    if (!column || seen.has(column.key)) continue;
    seen.add(column.key);
    ordered.push(column);
  }
  for (const column of columns) {
    if (!seen.has(column.key)) ordered.push(column);
  }
  return ordered;
}

function toTeammateDisplayColumns(
  columns: TeammateColumnDefinition[],
): MonsterTeammateBuffColumn[] {
  return columns.map((column) => ({
    key: column.key,
    buffIds: column.kind === "buff" ? [column.buffId] : [...column.buffIds],
    label: column.label,
    categoryKey: column.kind === "category" ? column.categoryKey : undefined,
  }));
}

function filterInactiveTeammateColumns(
  columns: MonsterTeammateBuffColumn[],
  rows: MonsterTeammateBuffRow[],
): {
  columns: MonsterTeammateBuffColumn[];
  rows: MonsterTeammateBuffRow[];
} {
  const activeColumnIndexes = columns
    .map((_, index) => index)
    .filter((index) => rows.some((row) => row.cells[index]?.hasBuff === true));

  return {
    columns: activeColumnIndexes.map((index) => columns[index]!),
    rows: rows
      .map((row) => ({
        ...row,
        cells: activeColumnIndexes
          .map((index) => row.cells[index])
          .filter((cell) => cell !== undefined),
      }))
      .filter((row) => row.cells.some((cell) => cell.hasBuff)),
  };
}

function pickLatestBuff(
  buffMap: Map<number, BuffUpdateState>,
  buffIds: number[],
): BuffUpdateState | undefined {
  let latest: BuffUpdateState | undefined;
  for (const buffId of buffIds) {
    const buff = buffMap.get(buffId);
    if (!buff) continue;
    if (!latest || buff.createTimeMs >= latest.createTimeMs) {
      latest = buff;
    }
  }
  return latest;
}

function uidFromEntityKey(entityKey: string): number {
  const numeric = Number(entityKey);
  if (Number.isSafeInteger(numeric) && numeric > 0 && numeric <= MAX_DIRECT_ENTITY_UID) {
    return numeric;
  }

  const decodedUid = uidFromEntityUuid(entityKey);
  if (decodedUid > 0) return decodedUid;

  if (Number.isSafeInteger(numeric) && numeric > 0) {
    return numeric;
  }
  return 0;
}

function resolveTeammateDisplayName(entityKey: string): string {
  const playerName = monsterRuntime.playerNameByEntityKey.get(entityKey)?.trim();
  if (playerName) return playerName;
  const displayUid = cachedUidForEntityKey(entityKey);
  const cachedName = displayUid > 0
    ? monsterRuntime.playerNameCache.get(displayUid)?.trim()
    : "";
  if (cachedName) return cachedName;
  return USE_LEGACY_MONSTER_ENTITY_UID_NAME_FALLBACK
    ? `UID ${uidFromEntityKey(entityKey) || entityKey}`
    : unknownTeammateName();
}

function stripFantasySuffix(name: string): string {
  const separatorIndex = name.indexOf("-");
  return ((separatorIndex >= 0 ? name.slice(0, separatorIndex) : name).trim() || name);
}

function resolveFantasyName(monsterId: number): string {
  const alias =
    SETTINGS.monsterMonitor.state.fantasyMonsterAliases?.[String(monsterId)]?.trim();
  if (alias) return alias;
  return stripFantasySuffix(localizeMonsterName(monsterId));
}

function isResonanceFantasyMonsterId(monsterId: number): boolean {
  return /^300\d{4}$/.test(String(monsterId));
}

function buildFantasyPlaceholderRows(): MonsterFantasyRow[] {
  return [
    {
      key: "fantasy_preview_1",
      summonUuid: "fantasy_preview_1",
      summonerName: tMonster("placeholder.teammate", "Teammate Preview"),
      fantasyName: tMonster("placeholder.fantasy", "Fantasy Preview"),
      levelText: "Lv3",
      isPlaceholder: true,
    },
    {
      key: "fantasy_preview_2",
      summonUuid: "fantasy_preview_2",
      summonerName: tMonster("placeholder.teammate", "Teammate Preview"),
      fantasyName: tMonster("placeholder.fantasy", "Fantasy Preview"),
      levelText: "Lv2",
      isPlaceholder: true,
    },
  ];
}

function sortFantasyEntries(
  entries: TeammateFantasyState[],
  persistentDisplay: boolean,
) {
  return [...entries].sort((left, right) => {
    if (!persistentDisplay) {
      return right.detectedAtMs - left.detectedAtMs;
    }

    return (
      left.summonerUuid.localeCompare(right.summonerUuid) ||
      left.monsterId - right.monsterId ||
      left.remodelLevel - right.remodelLevel
    );
  });
}

function buildFantasyRows(now: number): MonsterFantasyRow[] {
  const state = SETTINGS.monsterMonitor.state;
  const persistentDisplay = state.fantasyPersistentDisplay === true;
  const latestByFantasy = new Map<string, TeammateFantasyState>();
  for (const entry of monsterRuntime.fantasyEntries) {
    if (
      !persistentDisplay &&
      entry.detectedAtMs + FANTASY_DISPLAY_TTL_MS <= now
    ) {
      continue;
    }
    const key = fantasyEntryKey(entry);
    const existing = latestByFantasy.get(key);
    if (!existing || entry.detectedAtMs >= existing.detectedAtMs) {
      latestByFantasy.set(
        key,
        withPreservedFantasySummonerName(entry, existing),
      );
      continue;
    }

    if (!existing.summonerName && entry.summonerName) {
      latestByFantasy.set(key, { ...existing, summonerName: entry.summonerName });
    }
  }

  const activeEntries = sortFantasyEntries(
    [...latestByFantasy.values()],
    persistentDisplay,
  );
  monsterRuntime.fantasyEntries = activeEntries;

  const whitelist = new Set(state.fantasyWhitelistMonsterIds ?? []);
  const fantasyEntries = activeEntries.filter((entry) =>
    isResonanceFantasyMonsterId(entry.monsterId),
  );
  const filteredEntries = state.fantasyShowAll === true
    ? fantasyEntries
    : fantasyEntries.filter((entry) => whitelist.has(entry.monsterId));

  return filteredEntries.map((entry) => {
    const summonerName =
      entry.summonerName?.trim()
      || monsterRuntime.playerNameByEntityKey.get(entry.summonerUuid)?.trim()
      || (USE_LEGACY_MONSTER_ENTITY_UID_NAME_FALLBACK
        ? `UID ${uidFromEntityKey(entry.summonerUuid) || entry.summonerUuid}`
        : unknownTeammateName());
    const key = fantasyEntryKey(entry);
    return {
      key: `fantasy_${key}`,
      summonUuid: entry.summonUuid,
      summonerName,
      fantasyName: resolveFantasyName(entry.monsterId),
      levelText: `Lv${entry.remodelLevel}`,
    };
  });
}

function buildDbmRows(now: number): TextBuffDisplay[] {
  const entries: { createTimeMs: number; row: TextBuffDisplay }[] = [];
  for (const [baseSkillId, event] of monsterRuntime.bossDbmMap) {
    const remainingMs = Math.max(
      0,
      event.createTimeMs + event.durationMs - now,
    );
    if (remainingMs <= 0) {
      monsterRuntime.bossDbmMap.delete(baseSkillId);
      continue;
    }

    entries.push({
      createTimeMs: event.createTimeMs,
      row: {
        key: `monster_dbm_${event.baseSkillId}_${event.skillEffectId}`,
        label: resolveDbmSkillName(event.skillEffectId, event.baseSkillId),
        valueText: formatTimerText(remainingMs),
        progressPercent: Math.min(
          100,
          Math.max(0, (remainingMs / event.durationMs) * 100),
        ),
        showProgress: true,
      },
    });
  }
  return entries
    .sort((left, right) => left.createTimeMs - right.createTimeMs)
    .map((entry) => entry.row);
}

function buildDbmPlaceholderRows(): TextBuffDisplay[] {
  return [
    {
      key: "monster_dbm_preview",
      label: tMonster("placeholder.bossDbm", "Boss DBM Preview"),
      valueText: "12.0",
      progressPercent: 60,
      showProgress: true,
      isPlaceholder: true,
    },
  ];
}

function buildStunRows(entry: StunEntry): TextBuffDisplay[] {
  const { current, max } = entry;
  if (max <= 0) return [];
  const ratio = Math.min(1, Math.max(0, current / max));
  const progressPercent = Math.round(ratio * 100);
  const isBroken = current <= 0;
  const alert: BuffAlertState | undefined = isBroken
    ? {
        highlightColor: STUN_BROKEN_HIGHLIGHT_COLOR,
        flash: true,
        flashIntervalMs: STUN_BROKEN_FLASH_INTERVAL_MS,
        applyToProgress: true,
      }
    : undefined;
  return [
    {
      key: `stun_${entry.bossEntityUuid}`,
      label: isBroken
        ? tMonster("stun.broken", "Staggered")
        : tMonster("stun.label", "Stun"),
      valueText: isBroken
        ? tMonster("stun.brokenValue", "0 / {max}").replace("{max}", String(max))
        : `${current} / ${max}`,
      progressPercent,
      showProgress: true,
      alert,
    },
  ];
}

function buildStunPlaceholderRows(): TextBuffDisplay[] {
  return [
    {
      key: "stun_preview",
      label: tMonster("stun.label", "Stun"),
      valueText: "1600 / 2000",
      progressPercent: 80,
      showProgress: true,
      isPlaceholder: true,
    },
  ];
}

function buildHateRows(entries: HateEntry[], maxDisplay: number): TextBuffDisplay[] {
  const sortedEntries = [...entries].sort((left, right) => {
    if (right.hateVal !== left.hateVal) {
      return right.hateVal - left.hateVal;
    }
    return left.uid - right.uid
      || (left.entityKey ?? "").localeCompare(right.entityKey ?? "");
  });

  const normalizedHateValues = sortedEntries.map((entry) => Math.max(entry.hateVal, 0));
  const totalHate = normalizedHateValues.reduce((sum, hateVal) => sum + hateVal, 0);

  let displayPercents = new Array<number>(sortedEntries.length).fill(0);
  if (totalHate > 0) {
    const percentParts = normalizedHateValues.map((hateVal, index) => {
      const exactPercent = (hateVal / totalHate) * 100;
      const basePercent = Math.floor(exactPercent);
      return {
        index,
        basePercent,
        remainder: exactPercent - basePercent,
      };
    });

    let remainingPercent = 100 - percentParts.reduce(
      (sum, part) => sum + part.basePercent,
      0,
    );

    percentParts
      .sort((left, right) =>
        right.remainder - left.remainder || left.index - right.index)
      .forEach((part) => {
        if (remainingPercent <= 0) return;
        part.basePercent += 1;
        remainingPercent -= 1;
      });

    displayPercents = percentParts
      .sort((left, right) => left.index - right.index)
      .map((part) => part.basePercent);
  }

  return sortedEntries
    .map((entry, index) => ({
      key: `hate_${entityUuidFromAliases(entry) || (
        legacyMonsterUidFallbacksEnabled()
          ? entry.uid
          : `missing-entity-key:${entry.uid || "unknown"}`
      )}`,
      label: `${index + 1}. ${resolveHateEntryDisplayName(entry)}`,
      valueText: `${displayPercents[index] ?? 0}%`,
      progressPercent: 0,
      showProgress: false,
    }))
    .slice(0, maxDisplay);
}

export function updateMonsterDisplay() {
  if (!monsterRuntime.isMounted) return;
  const now = Date.now();
  const aliases = ensureBuffAliases(SETTINGS.monsterMonitor.state.buffAliases);
  const alertMap = ensureBuffAlerts(SETTINGS.monsterMonitor.state.buffAlerts);
  const resolveAlert = (
    baseId: number,
    remainingMs: number,
    durationMs: number,
  ) => resolveAlertState(alertMap[String(baseId)], remainingMs, durationMs);
  const selectedIds = selectedMonsterBuffIds();
  const teammateColumns = orderTeammateColumnDefinitions(
    buildTeammateColumnDefinitions(aliases),
  );
  const fullTeammateDisplayColumns = toTeammateDisplayColumns(teammateColumns);
  const priorityIds = SETTINGS.monsterMonitor.state.buffPriorityIds ?? [];
  const priorityIndex = new Map<number, number>();
  priorityIds.forEach((id, index) => priorityIndex.set(id, index));
  const fallbackBase = priorityIds.length;
  selectedIds.forEach((id, index) => {
    if (!priorityIndex.has(id)) {
      priorityIndex.set(id, fallbackBase + index);
    }
  });
  const nextSections: MonsterBossBuffSection[] = [];
  const nextTeammateRows: MonsterTeammateBuffRow[] = [];
  const nextHateSections: MonsterHateSection[] = [];
  const nextStunSections: MonsterStunSection[] = [];
  let nextFantasyRows = buildFantasyRows(now);
  let nextDbmRows = buildDbmRows(now);

  const sortedBossUids = Array.from(monsterRuntime.bossBuffMap.keys())
    .sort(compareEntityKeys);

  for (const bossUid of sortedBossUids) {
    const buffMap = monsterRuntime.bossBuffMap.get(bossUid) ?? new Map();
    const buffRows = Array.from(buffMap.values())
      .sort((left, right) => {
        const leftPriority = priorityIndex.get(left.baseId) ?? Number.MAX_SAFE_INTEGER;
        const rightPriority = priorityIndex.get(right.baseId) ?? Number.MAX_SAFE_INTEGER;
        return leftPriority - rightPriority || left.baseId - right.baseId;
      })
      .map((buff) =>
        buildBuffTextRow(
          `monster_${bossUid}_${buff.baseId}`,
          resolveBuffOverlayDisplayName(buff.baseId, aliases),
          buff,
          now,
          false,
          true,
          resolveAlert,
        ))
      .filter((row): row is TextBuffDisplay => row !== null);

    if (buffRows.length === 0) continue;
    nextSections.push({
      bossUid,
      title: resolveMonsterSectionTitle(bossUid),
      rows: buffRows,
    });
  }

  const sortedTeammateUuids = Array.from(
    monsterRuntime.teammateBuffMap.keys(),
  ).sort();

  for (const teammateUuid of sortedTeammateUuids) {
    const buffMap =
      monsterRuntime.teammateBuffMap.get(teammateUuid) ?? new Map();
    const cells = teammateColumns.map((column) => {
      if (column.kind === "buff") {
        const buff = buffMap.get(column.buffId);
        const buffName = resolveBuffOverlayDisplayName(column.buffId, aliases);
        if (!buff) {
          return {
            key: `teammate_${teammateUuid}_${column.key}_empty`,
            buffId: column.buffId,
            buffName,
            valueText: "",
            progressPercent: 0,
            hasBuff: false,
          };
        }

        const row = buildBuffTextRow(
          `teammate_${teammateUuid}_${column.key}`,
          buffName,
          buff,
          now,
          false,
          true,
          resolveAlert,
        );
        if (!row) {
          return {
            key: `teammate_${teammateUuid}_${column.key}_empty`,
            buffId: column.buffId,
            buffName,
            valueText: "",
            progressPercent: 0,
            hasBuff: false,
          };
        }

        return {
          key: `teammate_${teammateUuid}_${column.key}`,
          buffId: column.buffId,
          buffName,
          valueText: row.valueText,
          metaText: row.metaText,
          progressPercent: row.progressPercent,
          hasBuff: true,
          alert: row.alert,
        };
      }

      const buff = pickLatestBuff(buffMap, column.buffIds);
      const buffName = buff
        ? resolveBuffOverlayDisplayName(buff.baseId, aliases)
        : column.label;
      if (!buff) {
        return {
          key: `teammate_${teammateUuid}_${column.key}_empty`,
          buffId: column.buffIds[0] ?? 0,
          buffName: column.label,
          valueText: "",
          progressPercent: 0,
          hasBuff: false,
          categoryKey: column.categoryKey,
        };
      }

      const row = buildBuffTextRow(
        `teammate_${teammateUuid}_${column.key}`,
        buffName,
        buff,
        now,
        false,
        true,
        resolveAlert,
      );
      if (!row) {
        return {
          key: `teammate_${teammateUuid}_${column.key}_empty`,
          buffId: buff.baseId,
          buffName,
          valueText: "",
          progressPercent: 0,
          hasBuff: false,
          categoryKey: column.categoryKey,
          matchedBuffId: buff.baseId,
        };
      }

      return {
        key: `teammate_${teammateUuid}_${column.key}`,
        buffId: buff.baseId,
        buffName,
        valueText: row.valueText,
        metaText: row.metaText,
        progressPercent: row.progressPercent,
        hasBuff: true,
        alert: row.alert,
        categoryKey: column.categoryKey,
        matchedBuffId: buff.baseId,
      };
    });

    if (!cells.some((cell) => cell.hasBuff)) continue;
    nextTeammateRows.push({
      teammateEntityUuid: teammateUuid,
      teammateName: resolveTeammateDisplayName(teammateUuid),
      cells,
    });
  }

  if (SETTINGS.monsterMonitor.state.hateListEnabled) {
    const sortedHateBossUids = Array.from(monsterRuntime.bossHateMap.keys())
      .sort(compareEntityKeys);
    const maxDisplay = SETTINGS.monsterMonitor.state.hateListMaxDisplay ?? 5;

    for (const bossUid of sortedHateBossUids) {
      const hateRows = buildHateRows(
        monsterRuntime.bossHateMap.get(bossUid) ?? [],
        maxDisplay,
      );
      if (hateRows.length === 0) continue;
      nextHateSections.push({
        bossUid,
        title: resolveMonsterSectionTitle(bossUid),
        rows: hateRows,
      });
    }
  }

  if (nextSections.length === 0 && monsterRuntime.isEditing) {
    nextSections.push({
      bossUid: "preview",
      title: tMonster("placeholder.preview", "Preview"),
      rows: buildPlaceholderRows(now),
      isPlaceholder: true,
    });
  }

  if (
    SETTINGS.monsterMonitor.state.hateListEnabled
    && nextHateSections.length === 0
    && monsterRuntime.isEditing
  ) {
    nextHateSections.push({
      bossUid: "preview",
      title: targetTitle(0),
      rows: buildHatePlaceholderRows(),
      isPlaceholder: true,
    });
  }

  if (SETTINGS.monsterMonitor.state.stunListEnabled) {
    const sortedStunBossUids = Array.from(monsterRuntime.bossStunMap.keys())
      .sort(compareEntityKeys);
    for (const bossUid of sortedStunBossUids) {
      const entry = monsterRuntime.bossStunMap.get(bossUid);
      if (!entry) continue;
      const stunRows = buildStunRows(entry);
      if (stunRows.length === 0) continue;
      nextStunSections.push({
        bossUid,
        title: resolveMonsterSectionTitle(bossUid),
        rows: stunRows,
      });
    }
  }

  if (
    SETTINGS.monsterMonitor.state.stunListEnabled
    && nextStunSections.length === 0
    && monsterRuntime.isEditing
  ) {
    nextStunSections.push({
      bossUid: "preview",
      title: targetTitle(0),
      rows: buildStunPlaceholderRows(),
      isPlaceholder: true,
    });
  }

  if (nextFantasyRows.length === 0 && monsterRuntime.isEditing) {
    nextFantasyRows = buildFantasyPlaceholderRows();
  }

  if (nextDbmRows.length === 0 && monsterRuntime.isEditing) {
    nextDbmRows = buildDbmPlaceholderRows();
  }

  monsterRuntime.bossSections = nextSections;
  if (nextTeammateRows.length > 0) {
    const filteredTeammates = filterInactiveTeammateColumns(
      fullTeammateDisplayColumns,
      nextTeammateRows,
    );
    monsterRuntime.teammateColumns = filteredTeammates.columns;
    monsterRuntime.teammateRows = filteredTeammates.rows;
  } else {
    monsterRuntime.teammateColumns = fullTeammateDisplayColumns;
    monsterRuntime.teammateRows = monsterRuntime.isEditing
      ? buildTeammatePlaceholderRows(fullTeammateDisplayColumns)
      : [];
  }
  monsterRuntime.hateSections = nextHateSections;
  monsterRuntime.stunSections = nextStunSections;
  monsterRuntime.dbmRows = nextDbmRows;
  monsterRuntime.fantasyRows = nextFantasyRows;
  monsterRuntime.rafId = window.setTimeout(
    updateMonsterDisplay,
    MONSTER_DISPLAY_REFRESH_MS,
  );
}
