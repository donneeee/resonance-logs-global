import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  findAnySkillByBaseId,
  getSeasonCultivateFactorItemSlotTemplateMap,
  getSeasonCultivateFactorProcBuffItemIdsMap,
  getSeasonCultivateFactorRuleId,
  getSeasonCultivateFactorSourceIncrementMap,
} from "$lib/skill-mappings";
import {
  ensureBuffUptimeActiveIndicators,
  ensureBuffUptimeAliases,
  ensureBuffUptimeColors,
  ensureBuffUptimeMinStacks,
  ensureBuffUptimeMinStacksEnabled,
  ensureBuffUptimeTextStyle,
  ensureBuffUptimeTrackingModes,
  type BuffUptimeTrackingMode,
} from "$lib/settings-store";
import {
  onBossBuffUpdate,
  onBuffCounterUpdate,
  onBuffUpdate,
  onEntityIdentities,
  onEntityNames,
  onFightResUpdate,
  onLiveData,
  onPanelAttrUpdate,
  onResetEncounter,
  onSeasonCultivateFactorCounterUpdate,
  onShieldDetailUpdate,
  onSkillCdUpdate,
  type BuffUpdateState,
  type CounterUpdateState,
} from "$lib/api";
import {
  getAvailableBuffDefinitions,
  type BuffDefinition,
} from "$lib/config/buff-name-table";
import {
  ensureBuffGroups,
  ensureCustomPanelGroups,
  ensureCustomPanelStyle,
  ensureIndividualMonitorAllGroup,
  ensureOverlayPositions,
  ensureOverlaySizes,
  ensureOverlayVisibility,
  ensureShieldDetailStyle,
  ensureTextBuffPanelStyle,
  isBuffActive,
} from "./overlay-utils";
import {
  activeProfile,
  buffUptimeMinStacks,
  buffUptimeMinStacksEnabled,
  monitoredSkillIds,
  buffUptimeTrackingModes,
  monitoredSkillDurationIds,
  monitoredUptimeBuffIds,
  selectedClassKey,
  updateActiveProfile,
} from "./overlay-profile.svelte.js";
import { overlayRuntime } from "./overlay-runtime.svelte.js";
import {
  onGlobalPointerMove,
  onGlobalPointerUp,
  setEditMode,
  setOverlayWindow,
} from "./overlay-layout.svelte.js";
import { initOverlayClock } from "./overlay-clock.svelte.js";

type TrackedUptimeRow = {
  key: string;
  baseId: number;
  trackingMode: BuffUptimeTrackingMode;
  hostKey?: string | null;
  sourceKey?: string | null;
  hostUid: number;
  sourceUid: number;
  sourceConfigId: number | null;
  isActive: boolean;
};

function filterSeasonCultivateSlotItemIds(
  itemIds: number[],
  activeRuleIds?: Set<number>,
) {
  const slotTemplateMap = getSeasonCultivateFactorItemSlotTemplateMap();
  const seen = new Set<number>();
  const result: number[] = [];
  for (const itemId of itemIds) {
    if (!Number.isInteger(itemId) || !slotTemplateMap.has(itemId) || seen.has(itemId)) {
      continue;
    }
    const ruleId = getSeasonCultivateFactorRuleId(itemId);
    if (activeRuleIds && !activeRuleIds.has(ruleId)) {
      continue;
    }
    seen.add(itemId);
    result.push(itemId);
  }
  return result;
}

function getFactorProcBuffKey(buff: BuffUpdateState): string {
  return String(buff.baseId);
}

function updateObservedSeasonCultivateFactorProcCounts(
  buffs: BuffUpdateState[],
) {
  const procBuffItemIdsMap = getSeasonCultivateFactorProcBuffItemIdsMap();
  if (procBuffItemIdsMap.size === 0) return;
  const sourceIncrementMap = getSeasonCultivateFactorSourceIncrementMap();
  const activeFactorItemIds = new Set([
    ...overlayRuntime.seasonCultivateFactorSlotItemIds,
    ...overlayRuntime.seasonCultivateFactorCandidateSlotItemIds,
  ]);
  if (activeFactorItemIds.size === 0) return;

  const now = Date.now();
  const previousLayers = overlayRuntime.seasonCultivateFactorProcBuffLayers;
  const initialized =
    overlayRuntime.seasonCultivateFactorProcBuffLayersInitialized;
  const nextLayers = new Map<string, number>();
  const nextCounts = new Map(overlayRuntime.seasonCultivateFactorProcCounts);

  for (const buff of buffs) {
    const itemIds = procBuffItemIdsMap.get(buff.baseId);
    if (!itemIds || itemIds.length === 0) continue;
    if (buff.durationMs <= 0) continue;
    if (!isBuffActive(buff, now)) continue;

    const layer = Math.max(1, buff.layer);
    const key = getFactorProcBuffKey(buff);
    nextLayers.set(key, layer);

    const previousLayer = previousLayers.get(key);
    const recentActivationWindowMs = Math.max(
      5_000,
      Math.min(Math.max(0, buff.durationMs), 10_000),
    );
    const isRecentActivation =
      buff.createTimeMs > 0
      && Math.abs(now - buff.createTimeMs) <= recentActivationWindowMs;
    let procDelta = 0;
    if (previousLayer === undefined) {
      procDelta = initialized || isRecentActivation ? 1 : 0;
    } else {
      procDelta = Math.max(0, layer - previousLayer);
    }
    if (procDelta <= 0) continue;

    for (const itemId of itemIds) {
      if (!activeFactorItemIds.has(itemId)) continue;
      const sourceIncrement = sourceIncrementMap.get(itemId);
      if (sourceIncrement && sourceIncrement > 0) {
        continue;
      } else {
        nextCounts.set(itemId, (nextCounts.get(itemId) ?? 0) + procDelta);
      }
    }
  }

  overlayRuntime.seasonCultivateFactorProcBuffLayers = nextLayers;
  overlayRuntime.seasonCultivateFactorProcCounts = nextCounts;
  overlayRuntime.seasonCultivateFactorProcBuffLayersInitialized = true;
}

function buildLatestBuffMap(buffs: BuffUpdateState[]) {
  const next = new Map<number, BuffUpdateState>();
  for (const buff of buffs) {
    const existing = next.get(buff.baseId);
    if (!existing || buff.createTimeMs >= existing.createTimeMs) {
      next.set(buff.baseId, buff);
    }
  }
  return next;
}

function entityKeyPart(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? `entity:${trimmed}` : fallback;
}

function buildTrackedUptimeRows(localPlayerUid: number, now: number) {
  const trackedIds = monitoredUptimeBuffIds();
  const trackingModes = buffUptimeTrackingModes();
  const minStacksEnabled = buffUptimeMinStacksEnabled();
  const minStacks = buffUptimeMinStacks();
  const allBuffs: BuffUpdateState[] = [
    ...overlayRuntime.localBuffs,
    ...Array.from(overlayRuntime.bossBuffLists.values()).flat(),
  ];
  const next = new Map<string, TrackedUptimeRow>();

  for (const baseId of trackedIds) {
    const trackingMode = trackingModes[String(baseId)] ?? "self";
    const minStack = minStacksEnabled[String(baseId)]
      ? Math.max(1, minStacks[String(baseId)] ?? 1)
      : 1;
    const matches = allBuffs.filter((buff) => buff.baseId === baseId && buff.layer >= minStack);

    if (trackingMode === "self") {
      const ownMatches = overlayRuntime.localBuffs.filter((buff) => buff.baseId === baseId && buff.layer >= minStack);
      if (ownMatches.length === 0) continue;
      next.set(`uptime:${baseId}:self`, {
        key: `uptime:${baseId}:self`,
        baseId,
        trackingMode,
        hostKey: ownMatches[0]?.hostKey ?? null,
        sourceKey: ownMatches[0]?.sourceKey ?? null,
        hostUid: ownMatches[0]?.hostUid ?? 0,
        sourceUid: ownMatches[0]?.sourceUid ?? localPlayerUid,
        sourceConfigId: ownMatches[0]?.sourceConfigId ?? null,
        isActive: ownMatches.some((buff) => isBuffActive(buff, now)),
      });
      continue;
    }

    const grouped = new Map<string, BuffUpdateState[]>();
    for (const buff of matches) {
      const sourceUid = buff.sourceUid ?? 0;
      const hostUid = buff.hostUid ?? 0;
      const sourceConfigId = buff.sourceConfigId ?? null;
      const sourceKey = entityKeyPart(
        buff.sourceKey,
        sourceConfigId !== null
          ? `cfg:${sourceConfigId}`
          : `uid:${sourceUid || "unknown"}`,
      );
      const hostKey = entityKeyPart(buff.hostKey, `uid:${hostUid || "unknown"}`);
      const rowKey = `uptime:${baseId}:global:${sourceKey}:host:${hostKey}`;
      const current = grouped.get(rowKey) ?? [];
      current.push(buff);
      grouped.set(rowKey, current);
    }

    for (const [key, buffs] of grouped) {
      const first = buffs[0];
      if (!first) continue;
      next.set(key, {
        key,
        baseId,
        trackingMode,
        hostKey: first.hostKey ?? null,
        sourceKey: first.sourceKey ?? null,
        hostUid: first.hostUid ?? 0,
        sourceUid: first.sourceUid ?? 0,
        sourceConfigId: first.sourceConfigId ?? null,
        isActive: buffs.some((buff) => isBuffActive(buff, now)),
      });
    }
  }

  return next;
}

export function initOverlay() {
  if (overlayRuntime.cleanup) return overlayRuntime.cleanup;
  if (typeof window === "undefined") {
    return () => {};
  }

  overlayRuntime.isMounted = true;
  overlayRuntime.isInitialized = true;
  setOverlayWindow(getCurrentWindow());

  document.documentElement.style.setProperty(
    "background",
    "transparent",
    "important",
  );
  document.body.style.setProperty("background", "transparent", "important");

  ensureActiveProfileDefaults();
  void setEditMode(false);
  loadAvailableBuffs();

  const unlistenEditToggle = listen<{ visibleBeforeEdit?: boolean }>("overlay-edit-toggle", (event) => {
    const nextEditing = !overlayRuntime.isEditing;
    if (nextEditing) {
      overlayRuntime.restoreVisibilityAfterEditing = !(event.payload?.visibleBeforeEdit ?? true);
    }
    void setEditMode(nextEditing);
  });
  const unlistenBuff = onBuffUpdate((event) => {
    overlayRuntime.localBuffs = event.payload.buffs;
    overlayRuntime.buffMap = buildLatestBuffMap(event.payload.buffs);
    updateObservedSeasonCultivateFactorProcCounts(event.payload.buffs);
  });
  const unlistenBossBuff = onBossBuffUpdate((event) => {
    const next = new Map<string, BuffUpdateState[]>();
    for (const [entityKey, buffs] of Object.entries(event.payload.bossBuffs)) {
      next.set(entityKey, buffs);
    }
    overlayRuntime.bossBuffLists = next;
  });
  const unlistenNames = onEntityNames((event) => {
    const next = new Map(overlayRuntime.nameCache);
    for (const [uid, name] of Object.entries(event.payload.names)) {
      next.set(Number(uid), name);
    }
    overlayRuntime.nameCache = next;
  });
  const unlistenIdentities = onEntityIdentities((event) => {
    const nextPlayerNamesByEntityKey = new Map(overlayRuntime.playerNameByEntityKey);
    for (const [entityKey, name] of Object.entries(event.payload.playerNames)) {
      nextPlayerNamesByEntityKey.set(entityKey, name);
    }
    overlayRuntime.playerNameByEntityKey = nextPlayerNamesByEntityKey;

    const nextMonsterIdsByEntityKey = new Map(overlayRuntime.monsterIdByEntityKey);
    for (const [entityKey, monsterId] of Object.entries(event.payload.monsterIds)) {
      nextMonsterIdsByEntityKey.set(entityKey, monsterId);
    }
    overlayRuntime.monsterIdByEntityKey = nextMonsterIdsByEntityKey;
  });
  const unlistenCounter = onBuffCounterUpdate((event) => {
    const next = new Map<number, CounterUpdateState>();
    for (const counter of event.payload.counters) {
      next.set(counter.ruleId, counter);
    }
    overlayRuntime.counterMap = next;
  });
  const unlistenFactorCounter = onSeasonCultivateFactorCounterUpdate((event) => {
    const next = new Map<number, CounterUpdateState>();
    const activeRuleIds = new Set<number>();
    for (const counter of event.payload.counters) {
      next.set(counter.ruleId, counter);
      activeRuleIds.add(counter.ruleId);
    }
    overlayRuntime.factorCounterMap = next;
    overlayRuntime.seasonCultivateFactorSourceItemIds = event.payload.sourceItemIds;
    overlayRuntime.seasonCultivateFactorCandidateSlotItemIds =
      filterSeasonCultivateSlotItemIds(event.payload.slotItemIds);
    overlayRuntime.seasonCultivateFactorSlotItemIds =
      filterSeasonCultivateSlotItemIds(event.payload.slotItemIds, activeRuleIds);
    overlayRuntime.seasonCultivateFactorActiveAreaIds = event.payload.activeAreaIds;
    overlayRuntime.seasonCultivateFactorActiveItemIds = event.payload.activeItemIds;
    overlayRuntime.seasonCultivateFactorActiveFantasyIds =
      event.payload.activeFantasyIds;
  });
  const unlistenCd = onSkillCdUpdate((event) => {
    const next = new Map(overlayRuntime.cdMap);
    const nextDurationMap = new Map(overlayRuntime.skillDurationMap);
    const classKey = selectedClassKey();
    const skillIds = new Set(monitoredSkillIds());
    const durationSkillIds = new Set(monitoredSkillDurationIds());
    const monitoredIds = new Set([...skillIds, ...durationSkillIds]);
    for (const cd of event.payload.skillCds) {
      const levelBaseId = Math.floor(cd.skillLevelId / 100);
      const baseId = monitoredIds.has(cd.skillLevelId)
        ? cd.skillLevelId
        : monitoredIds.has(levelBaseId)
          ? levelBaseId
          : levelBaseId;
      next.set(baseId, cd);
      if (!durationSkillIds.has(baseId)) continue;
      const skill = findAnySkillByBaseId(classKey, baseId);
      const effectDurationMs = skill?.effectDurationMs;
      if (!effectDurationMs || cd.beginTime <= 0) continue;
      const currentDuration = nextDurationMap.get(baseId);
      if (currentDuration?.beginTime === cd.beginTime) continue;
      nextDurationMap.set(baseId, {
        skillId: baseId,
        startedAtMs: cd.receivedAt || Date.now(),
        durationMs: effectDurationMs,
        beginTime: cd.beginTime,
      });
    }
    for (const skillId of nextDurationMap.keys()) {
      if (!durationSkillIds.has(skillId)) {
        nextDurationMap.delete(skillId);
      }
    }
    overlayRuntime.cdMap = next;
    overlayRuntime.skillDurationMap = nextDurationMap;
  });
  const unlistenRes = onFightResUpdate((event) => {
    const next = new Map<number, number>();
    for (const entry of event.payload.fightRes.entries) {
      next.set(entry.id, entry.value);
    }
    overlayRuntime.fightResMap = next;
  });
  const unlistenPanelAttr = onPanelAttrUpdate((event) => {
    const next = new Map(overlayRuntime.panelAttrMap);
    for (const attr of event.payload.attrs) {
      next.set(attr.attrId, attr.value);
    }
    overlayRuntime.panelAttrMap = next;
  });
  const unlistenShieldDetail = onShieldDetailUpdate((event) => {
    overlayRuntime.shieldDetailHp = {
      current: event.payload.currentHp,
      max: event.payload.maxHp,
    };
    overlayRuntime.shieldDetailEntries = event.payload.entries;
  });

  const unlistenLiveData = onLiveData((event) => {
    const data = event.payload;
    overlayRuntime.liveData = data;

    const shouldReset =
      overlayRuntime.uptimeFightStartTimestampMs !== data.fightStartTimestampMs
      || data.elapsedMs < overlayRuntime.uptimeLastElapsedMs
      || data.activeCombatTimeMs < overlayRuntime.uptimeLastActiveCombatTimeMs
      || data.elapsedMs === 0;

    const prevElapsedMs = shouldReset ? 0 : overlayRuntime.uptimeLastElapsedMs;
    const prevActiveCombatMs = shouldReset ? 0 : overlayRuntime.uptimeLastActiveCombatTimeMs;

    if (shouldReset) {
      overlayRuntime.uptimeTotals = new Map();
      overlayRuntime.activeUptimeRowKeys = new Set();
      overlayRuntime.seasonCultivateFactorProcCounts = new Map();
      overlayRuntime.seasonCultivateFactorProcBuffLayers = new Map();
      overlayRuntime.seasonCultivateFactorProcBuffLayersInitialized = false;
      overlayRuntime.uptimeFightStartTimestampMs = data.fightStartTimestampMs;
      if (data.elapsedMs === 0) {
        overlayRuntime.uptimeLastElapsedMs = 0;
        overlayRuntime.uptimeLastActiveCombatTimeMs = 0;
        return;
      }
    }

    const deltaElapsedMs = Math.max(0, data.elapsedMs - prevElapsedMs);
    const deltaActiveCombatMs = Math.max(0, data.activeCombatTimeMs - prevActiveCombatMs);
    const now = Date.now();
    const trackedRows = buildTrackedUptimeRows(data.localPlayerUid, now);
    overlayRuntime.activeUptimeRowKeys = new Set(
      Array.from(trackedRows.entries())
        .filter(([, row]) => row.isActive)
        .map(([key]) => key),
    );

    const nextTotals = new Map(overlayRuntime.uptimeTotals);
    for (const [key, row] of trackedRows) {
      const current = nextTotals.get(key) ?? {
        baseId: row.baseId,
        trackingMode: row.trackingMode,
        hostKey: row.hostKey ?? null,
        sourceKey: row.sourceKey ?? null,
        hostUid: row.hostUid,
        sourceUid: row.sourceUid,
        sourceConfigId: row.sourceConfigId,
        encounterActiveMs: 0,
        trueActiveMs: 0,
      };

      current.baseId = row.baseId;
      current.trackingMode = row.trackingMode;
      current.hostKey = row.hostKey ?? null;
      current.sourceKey = row.sourceKey ?? null;
      current.hostUid = row.hostUid;
      current.sourceUid = row.sourceUid;
      current.sourceConfigId = row.sourceConfigId;

      if (row.isActive) {
        current.encounterActiveMs += deltaElapsedMs;
        current.trueActiveMs += deltaActiveCombatMs;
      }

      nextTotals.set(key, current);
    }
    overlayRuntime.uptimeTotals = nextTotals;

    overlayRuntime.uptimeFightStartTimestampMs = data.fightStartTimestampMs;
    overlayRuntime.uptimeLastElapsedMs = data.elapsedMs;
    overlayRuntime.uptimeLastActiveCombatTimeMs = data.activeCombatTimeMs;
  });

  const unlistenResetEncounter = onResetEncounter(() => {
    overlayRuntime.liveData = null;
    overlayRuntime.shieldDetailHp = { current: 0, max: 0 };
    overlayRuntime.shieldDetailEntries = [];
    overlayRuntime.uptimeTotals = new Map();
    overlayRuntime.activeUptimeRowKeys = new Set();
    overlayRuntime.playerNameByEntityKey = new Map();
    overlayRuntime.monsterIdByEntityKey = new Map();
    overlayRuntime.factorCounterMap = new Map();
    overlayRuntime.seasonCultivateFactorSourceItemIds = [];
    overlayRuntime.seasonCultivateFactorSlotItemIds = [];
    overlayRuntime.seasonCultivateFactorCandidateSlotItemIds = [];
    overlayRuntime.seasonCultivateFactorActiveAreaIds = [];
    overlayRuntime.seasonCultivateFactorActiveItemIds = [];
    overlayRuntime.seasonCultivateFactorActiveFantasyIds = [];
    overlayRuntime.seasonCultivateFactorProcCounts = new Map();
    overlayRuntime.seasonCultivateFactorProcBuffLayers = new Map();
    overlayRuntime.seasonCultivateFactorProcBuffLayersInitialized = false;
    overlayRuntime.uptimeFightStartTimestampMs = 0;
    overlayRuntime.uptimeLastElapsedMs = 0;
    overlayRuntime.uptimeLastActiveCombatTimeMs = 0;
  });

  window.addEventListener("pointermove", onGlobalPointerMove);
  window.addEventListener("pointerup", onGlobalPointerUp);
  const cleanupClock = initOverlayClock();

  overlayRuntime.cleanup = () => {
    overlayRuntime.isMounted = false;
    overlayRuntime.isInitialized = false;
    overlayRuntime.dragState = null;
    overlayRuntime.resizeState = null;
    overlayRuntime.activeUptimeRowKeys = new Set();
    overlayRuntime.nameCache = new Map();
    overlayRuntime.playerNameByEntityKey = new Map();
    overlayRuntime.monsterIdByEntityKey = new Map();
    overlayRuntime.localBuffs = [];
    overlayRuntime.bossBuffLists = new Map();
    overlayRuntime.factorCounterMap = new Map();
    overlayRuntime.seasonCultivateFactorSourceItemIds = [];
    overlayRuntime.seasonCultivateFactorSlotItemIds = [];
    overlayRuntime.seasonCultivateFactorCandidateSlotItemIds = [];
    overlayRuntime.seasonCultivateFactorActiveAreaIds = [];
    overlayRuntime.seasonCultivateFactorActiveItemIds = [];
    overlayRuntime.seasonCultivateFactorActiveFantasyIds = [];
    overlayRuntime.seasonCultivateFactorProcCounts = new Map();
    overlayRuntime.seasonCultivateFactorProcBuffLayers = new Map();
    overlayRuntime.seasonCultivateFactorProcBuffLayersInitialized = false;
    unlistenEditToggle.then((fn) => fn());
    unlistenBuff.then((fn) => fn());
    unlistenBossBuff.then((fn) => fn());
    unlistenNames.then((fn) => fn());
    unlistenIdentities.then((fn) => fn());
    unlistenCounter.then((fn) => fn());
    unlistenFactorCounter.then((fn) => fn());
    unlistenCd.then((fn) => fn());
    unlistenRes.then((fn) => fn());
    unlistenPanelAttr.then((fn) => fn());
    unlistenShieldDetail.then((fn) => fn());
    unlistenLiveData.then((fn) => fn());
    unlistenResetEncounter.then((fn) => fn());
    window.removeEventListener("pointermove", onGlobalPointerMove);
    window.removeEventListener("pointerup", onGlobalPointerUp);
    cleanupClock();
    setOverlayWindow(null);
    overlayRuntime.cleanup = null;
  };

  return overlayRuntime.cleanup;
}

function loadAvailableBuffs() {
  const next = new Map<number, BuffDefinition>();
  for (const buff of getAvailableBuffDefinitions()) {
    next.set(buff.baseId, buff);
  }
  overlayRuntime.buffDefinitions = next;
}

function ensureActiveProfileDefaults() {
  const profile = activeProfile();
  if (
    profile &&
    (!profile.overlayPositions ||
      profile.overlayPositions.skillDurationPositions === undefined ||
      !profile.overlaySizes ||
      profile.overlaySizes.skillDurationSizes === undefined ||
      !profile.overlayVisibility ||
      profile.overlayVisibility.showSkillDurationGroup === undefined ||
      profile.overlayVisibility.showBuffUptimeGroup === undefined ||
      profile.overlayVisibility.showShieldDetailGroup === undefined ||
      !profile.buffDisplayMode ||
      !profile.buffGroups ||
      !profile.customPanelGroups ||
      !profile.customPanelStyle ||
      !profile.textBuffPanelStyle ||
      !profile.textBuffMaxVisible ||
      profile.monitoredSkillDurationIds === undefined ||
      profile.monitoredUptimeBuffIds === undefined ||
      profile.buffUptimeColors === undefined ||
      profile.buffUptimeAliases === undefined ||
      profile.buffUptimeTrackingModes === undefined ||
      profile.buffUptimeActiveIndicators === undefined ||
      profile.buffUptimeMinStacksEnabled === undefined ||
      profile.buffUptimeMinStacks === undefined ||
      profile.buffUptimeTextStyle === undefined ||
      profile.shieldDetailStyle === undefined ||
      profile.showTrueUptime === undefined)
  ) {
    updateActiveProfile((profile) => ({
      ...profile,
      monitoredSkillDurationIds: profile.monitoredSkillDurationIds ?? [],
      monitoredUptimeBuffIds: profile.monitoredUptimeBuffIds ?? [],
      buffUptimeColors: ensureBuffUptimeColors(profile.buffUptimeColors),
      buffUptimeAliases: ensureBuffUptimeAliases(profile.buffUptimeAliases),
      buffUptimeTrackingModes: ensureBuffUptimeTrackingModes(profile.buffUptimeTrackingModes),
      buffUptimeActiveIndicators: ensureBuffUptimeActiveIndicators(profile.buffUptimeActiveIndicators),
      buffUptimeMinStacksEnabled: ensureBuffUptimeMinStacksEnabled(profile.buffUptimeMinStacksEnabled),
      buffUptimeMinStacks: ensureBuffUptimeMinStacks(profile.buffUptimeMinStacks),
      buffUptimeTextStyle: ensureBuffUptimeTextStyle(profile.buffUptimeTextStyle),
      shieldDetailStyle: ensureShieldDetailStyle(profile),
      showTrueUptime: profile.showTrueUptime ?? true,
      overlayPositions: ensureOverlayPositions(profile),
      overlaySizes: ensureOverlaySizes(profile),
      overlayVisibility: ensureOverlayVisibility(profile),
      buffDisplayMode: profile.buffDisplayMode ?? "individual",
      buffGroups: ensureBuffGroups(profile),
      individualMonitorAllGroup: ensureIndividualMonitorAllGroup(profile),
      customPanelGroups: ensureCustomPanelGroups(profile),
      inlineBuffEntries: [],
      customPanelStyle: ensureCustomPanelStyle(profile),
      textBuffPanelStyle: ensureTextBuffPanelStyle(profile),
      textBuffMaxVisible: Math.max(
        1,
        Math.min(20, profile.textBuffMaxVisible ?? 10),
      ),
    }));
  }
}
