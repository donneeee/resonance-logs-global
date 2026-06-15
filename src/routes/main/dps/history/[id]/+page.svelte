<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { commands } from "$lib/bindings";
  import type { EncounterSummaryDto, HistoryEntityData, ModifierReplayHitState } from "$lib/bindings";
  import type { RawCombatStats, RawSkillStats } from "$lib/api";
  import type { EquippedItem, OceanWeaponInfo } from "$lib/player-equipment";
  import type { PlayerImagineInfo } from "$lib/player-imagines";
  import { tooltip } from "$lib/utils.svelte";
  import ClassSpecIcon from "$lib/components/class-spec-icon.svelte";
  import OceanWeaponBadge from "$lib/components/ocean-weapon-badge.svelte";
  import PlayerImagineBadges from "$lib/components/player-imagine-badges.svelte";
  import TableRowGlow from "$lib/components/table-row-glow.svelte";
  import AbbreviatedNumber from "$lib/components/abbreviated-number.svelte";
  import { scaledBadgeSize } from "$lib/badge-sizing";
  import {
    columnLabelWithAlias,
    historyDpsPlayerColumns,
    historyDpsSkillColumns,
    historyHealPlayerColumns,
    historyHealSkillColumns,
    historyTankedPlayerColumns,
    historyTankedSkillColumns,
    orderColumnsByKey,
    type ColumnDefinition,
  } from "$lib/column-data";
  import { settings, SETTINGS, DEFAULT_HISTORY_STATS } from "$lib/settings-store";
  import { localizeSceneName } from "$lib/scene-mappings";
  import { localizeRawMonsterName } from "$lib/monster-mappings";
  import getDisplayName, { getDisplayIconSpecName } from "$lib/name-display";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { computePlayerRowsFromEntities } from "$lib/live-derived";
  import {
    buildRecountGroupHoverText,
    buildSkillBreakdownHoverText,
    groupSkillsByRecount,
    lookupRecountGroupIconPath,
    lookupSkillBreakdownIconPath,
    resolveRecountGroupName,
    resolveSkillBreakdownDetailName,
    resolveSkillBreakdownName,
    resolveLocalizedText,
    lookupDamageIdName,
    type RecountGroup,
    type SkillDisplayRow,
    type SkillGroupingOptions,
  } from "$lib/config/recount-table";
  import { lookupBuffLocalizedNames, lookupBuffMeta, lookupDefaultBuffName } from "$lib/config/buff-name-table";
  import { resolveStaticIconUrl } from "$lib/config/static-icon-resolver";
  import { createHistoryModifierReportWorker } from "$lib/history-modifier-report-worker-client";
  import {
    resolveModifierSourceDescription,
    resolveModifierSourceName,
    type ModifierActivityRow,
    type ModifierActivityScope,
    type ModifierActivitySkillRow,
    type ModifierActorFilter,
    type ModifierActorSummary,
    type ModifierSourceActor,
  } from "$lib/history-modifier-report-display";
  import DeathPlayerList, {
    type DeathPlayerEntry,
  } from "$lib/components/death-replay/death-player-list.svelte";
  import DeathList from "$lib/components/death-replay/death-list.svelte";
  import DeathReplayDetail from "$lib/components/death-replay/death-replay-detail.svelte";
  import { formatClassSpecLabel } from "$lib/class-labels";
  import { uiT, resolveNavigationTranslation, resolveSkillNote, resolveSkillTranslation, type LocaleCode } from "$lib/i18n";
  import { damageModeLabelKey, propertyLabelKey } from "$lib/damage-type";
  import { buildUniqueSkillSourceFallbacks } from "$lib/tanked-source-derived";

  type HistorySkillType = "dps" | "heal" | "tanked" | "death";
  type HistoryOverviewTab = "damage" | "tanked" | "healing" | "modifiers" | "death";
  type HistoryDataViewMode = "breakdown" | "graph";
  type HistoryGraphDisplayMode = "individual" | "team";
  type HistoryGraphMetric = "damage" | "healing" | "tanked";
  type ModifierViewMode = "by-modifier" | "by-skill";

  type ModifierReportWorkerResponse =
    | {
      requestId: number;
      status: "started";
      buckets: number;
    }
    | {
        requestId: number;
        status: "ok";
        rows: ModifierActivityRow[];
        elapsedMs: number;
      }
    | {
        requestId: number;
        status: "error";
        error: string;
      };

  type HistoryPlayerRow = {
    uid: number;
    uuid?: number | null;
    name: string;
    isLocalPlayer: boolean;
    className: string;
    classSpecName: string;
    classDisplay: string;
    abilityScore: number;
    seasonStrength: number;
    equippedItems: EquippedItem[];
    oceanWeapon: OceanWeaponInfo | null;
    playerImagines: PlayerImagineInfo[];
    totalDmg: number;
    dps: number;
    tdps: number;
    activeTimeMs: number;
    dmgPct: number;
    bossDmg: number;
    bossDps: number;
    bossDmgPct: number;
    critRate: number;
    critDmgRate: number;
    luckyRate: number;
    luckyDmgRate: number;
    hits: number;
    hitsPerMinute: number;
    effectiveTotal: number;
    effectiveDps: number;
    damageTaken: number;
    tankedPS: number;
    tankedPct: number;
    critTakenRate: number;
    blockRate: number;
    luckyBlockRate: number;
    hitsTaken: number;
    healDealt: number;
    effectiveHeal: number;
    ehps: number;
    hps: number;
    healPct: number;
    critHealRate: number;
    hitsHeal: number;
  };

  type HistorySummaryAccent = "time" | "damage" | "healing" | "tanked";

  type PlayerSummaryItem = {
    key: string;
    label: string;
    value: string;
    accent: HistorySummaryAccent;
  };

  type PlayerSummaryGroup = {
    key: string;
    label: string;
    columns: number;
    rows: (PlayerSummaryItem | null)[][];
  };

  type HistorySummaryStatsSource = {
    row: HistoryPlayerRow;
    damage: RawCombatStats;
    bossDamage: RawCombatStats;
    healing: RawCombatStats;
    taken: RawCombatStats;
    deaths: number;
  };

  type BuildHistoryPlayersOptions = {
    includeBossTargetAggregate?: boolean;
  };

  type HistoryGraphPoint = {
    timeMs: number;
    value: number;
    x: number;
    y: number;
  };

  type HistoryGraphSeries = {
    key: string;
    uid: number;
    uuid?: number | null;
    name: string;
    className: string;
    classSpecName: string;
    color: string;
    total: number;
    average: number;
    peak: number;
    overallPoints: HistoryGraphPoint[];
    movingAveragePoints: HistoryGraphPoint[];
    deathMarkers: number[];
  };

  type HistoryGraphData = {
    metric: HistoryGraphMetric;
    bucketMs: number;
    movingWindowMs: number;
    durationMs: number;
    maxOverallValue: number;
    maxMovingValue: number;
    total: number;
    teamSeries: HistoryGraphSeries | null;
    series: HistoryGraphSeries[];
    overallYTicks: number[];
    movingYTicks: number[];
    xTicks: number[];
    minorXTicks: number[];
  };

  type GraphTickScale = {
    maxValue: number;
    ticks: number[];
  };

  type CombatTimelineBucket = NonNullable<HistoryEntityData["combatTimeline"]>[number];

  type FlatSkillRow =
    | { kind: "group"; key: string; depth: 0; row: RecountGroup }
    | { kind: "skill"; key: string; depth: 0 | 1; row: SkillDisplayRow };

  type ModifierBreakdownMatch = ModifierActivityRow["match"];

  type ModifierBreakdownSourceRow = {
    key: string;
    source: ModifierActivityRow;
    sourceId: string;
    sourceIds: string[];
    sourceKind: string;
    sourceType?: string;
    sourceEntityId?: number;
    sourceName: string;
    sourceNames?: ModifierActivityRow["sourceNames"];
    displayOwnerKind?: ModifierActivityRow["displayOwnerKind"];
    buffIds: number[];
    evidence: string[];
    attributionModel?: ModifierActivityRow["attributionModel"];
    actorSummary: ModifierActivityRow["actorSummary"];
    targetDamageIds: number[];
    targetRecountIds: number[];
    match: ModifierActivitySkillRow["match"];
    totalDmg: number;
    effectiveTotal: number;
    estimatedContributionTotal?: number;
    estimatedContributionPct?: number;
    estimatedContributionConfidence?: ModifierActivitySkillRow["estimatedContributionConfidence"];
    formulaReplayModel?: ModifierActivitySkillRow["formulaReplayModel"];
    observedDmgPerHit?: number;
    baselineDmgPerHit?: number;
    baselineHits?: number;
    dmgPct: number;
    sourcePct: number;
    coveragePct: number;
    dps: number;
    hits: number;
    hitsPerMinute: number;
    critRate: number;
    luckyRate: number;
  };

  type ModifierBreakdownRow = {
    key: string;
    rowKind: ModifierActivitySkillRow["rowKind"];
    skillId: number;
    recountId?: number;
    name: string;
    names?: ModifierActivitySkillRow["names"];
    damageIds: number[];
    match: ModifierBreakdownMatch;
    totalDmg: number;
    effectiveTotal: number;
    estimatedContributionTotal?: number;
    estimatedContributionPct?: number;
    estimatedContributionConfidence?: ModifierActivitySkillRow["estimatedContributionConfidence"];
    observedDmgPerHit?: number;
    baselineDmgPerHit?: number;
    baselineHits?: number;
    dmgPct: number;
    sourcePct: number;
    coveragePct: number;
    dps: number;
    hits: number;
    hitsPerMinute: number;
    critRate: number;
    luckyRate: number;
    sources: ModifierBreakdownSourceRow[];
  };

  type FlatModifierRow =
    | { kind: "modifier"; key: string; row: ModifierActivityRow }
    | { kind: "modifier-skill"; key: string; sourceKey: string; row: ModifierActivitySkillRow; source: ModifierActivityRow }
    | { kind: "skill"; key: string; row: ModifierBreakdownRow }
    | { kind: "source"; key: string; skillKey: string; row: ModifierBreakdownSourceRow };

  type PerTargetStats = {
    targetUid: number;
    targetUuid?: number | null;
    targetName: string;
    totalValue: number;
    damage: RawCombatStats;
    skills: Partial<Record<number, RawSkillStats>>;
  };

  type EntityPerTargetData = {
    uid: number;
    uuid?: number | null;
    dmgTargets: PerTargetStats[];
    healTargets: PerTargetStats[];
  };

  type OverviewTargetOption = {
    targetUid: number;
    targetUuid?: number | null;
    targetName: string;
    totalValue: number;
  };

  // Get encounter ID from URL params
  let encounterId = $derived($page.params.id ? parseInt($page.params.id) : null);
  let charId = $derived($page.url.searchParams.get("charId"));
  let charUuid = $derived(finitePositiveReportId($page.url.searchParams.get("charUuid")));
  let selectedCharUid = $derived(finitePositiveReportId(charId));
  let hasSelectedChar = $derived(selectedCharUid !== null || charUuid !== null);
  let skillType = $derived(($page.url.searchParams.get("skillType") ?? "dps") as HistorySkillType);

  let encounter = $state<EncounterSummaryDto | null>(null);
  let localPlayerUid = $state<number | null>(null);
  let localPlayerUuid = $state<number | null>(null);
  let rawEntities = $state<HistoryEntityData[]>([]);
  let encounterEntitiesLoading = $state(false);
  let targetDetailsLoading = $state(false);
  let targetDetailsRequestedEncounterId = $state<number | null>(null);
  let targetDetailsLoadedEncounterId = $state<number | null>(null);
  let modifierEntityCache = $state<Record<string, HistoryEntityData[]>>({});
  let modifierReportCache = $state<Record<string, ModifierActivityRow[]>>({});
  let modifierEntitiesLoading = $state(false);
  let modifierEntitiesError = $state<string | null>(null);
  let modifierEntitiesLoadingKey = $state<string | null>(null);
  let modifierReportLoading = $state(false);
  let modifierReportError = $state<string | null>(null);
  let modifierReportErrorKey = $state<string | null>(null);
  let modifierReportLoadingKey = $state<string | null>(null);
  let players = $state<HistoryPlayerRow[]>([]);
  let error = $state<string | null>(null);
  let isDeleting = $state(false);
  let showDeleteModal = $state(false);
  let expandedGroups = $state<Set<number>>(new Set<number>());
  let expandedModifierRows = $state<Set<string>>(new Set<string>());
  let modifierExpansionSeed = $state("");
  let historyDataViewMode = $state<HistoryDataViewMode>("breakdown");
  let historyGraphDisplayMode = $state<HistoryGraphDisplayMode>("individual");
  let graphEntities = $state<HistoryEntityData[] | null>(null);
  let graphEntitiesEncounterId = $state<number | null>(null);
  let graphEntitiesLoading = $state(false);
  let graphEntitiesError = $state<string | null>(null);
  let historyGraphHiddenSeries = $state<Set<string>>(new Set());
  let historyGraphSeriesScopeKey = $state("");
  let overviewTargetUid = $state<number | null>(null);
  let overviewTargetUuid = $state<number | null>(null);
  let modifierPlayerUid = $state<number | null>(null);
  let modifierPlayerUuid = $state<number | null>(null);
  let modifierViewMode = $state<ModifierViewMode>("by-modifier");
  let modifierScope = $state<ModifierActivityScope>("all-active");
  let modifierActorFilter = $state<ModifierActorFilter>("all");
  let modifierHideFullCoverage = $state(false);
  let encounterLoadToken = 0;
  let targetDetailsLoadToken = 0;
  let modifierEntitiesLoadToken = 0;
  let modifierReportLoadToken = 0;
  let graphEntitiesLoadToken = 0;
  let modifierReportWorker: Worker | null = null;
  const MODIFIER_REPORT_WORKER_START_TIMEOUT_MS = 45_000;
  const MODIFIER_REPORT_WORKER_BUILD_TIMEOUT_MS = 90_000;
  const MODIFIER_REPORT_CACHE_SCHEMA = "modifier-report-v2-buff-source-labels";

  function modifierCacheKey(encounterUid: number, playerUid: number, playerUuid?: number | null): string {
    return `${encounterUid}:${playerUuid ? `uuid:${playerUuid}` : `uid:${playerUid}`}`;
  }

  function modifierReportCacheKey(entityCacheKey: string): string {
    return [
      MODIFIER_REPORT_CACHE_SCHEMA,
      entityCacheKey,
      modifierScope,
      modifierActorFilter,
      Math.round(encounterDurationSeconds * 1000),
      encounter?.startedAtMs ?? "",
      encounter?.endedAtMs ?? "",
    ].join(":");
  }

  function createModifierReportWorker(): Worker {
    if (typeof Worker === "undefined") {
      throw new Error("Modifier report worker is unavailable in this WebView.");
    }
    terminateModifierReportWorker();
    modifierReportWorker = createHistoryModifierReportWorker();
    return modifierReportWorker;
  }

  function terminateModifierReportWorker() {
    modifierReportWorker?.terminate();
    modifierReportWorker = null;
  }

  onDestroy(() => {
    terminateModifierReportWorker();
  });

  function modifierReportEntityShell(entity: HistoryEntityData): HistoryEntityData {
    return {
      uid: entity.uid,
      name: entity.name,
      classId: entity.classId,
      classSpec: entity.classSpec,
      className: entity.className,
      classSpecName: entity.classSpecName,
      abilityScore: entity.abilityScore,
      seasonStrength: entity.seasonStrength,
      damage: zeroCombatStats(),
      damageBossOnly: zeroCombatStats(),
      healing: zeroCombatStats(),
      taken: zeroCombatStats(),
      dmgSkills: {},
      healSkills: {},
      takenSkills: {},
      activeBuffs: [],
      activeFactorBuffs: [],
      activeEffectBuffs: [],
      modifierWindows: [],
      modifierHitBuckets: [],
      modifierReplayHits: [],
      skillCastEvents: [],
      skillCooldownEvents: [],
      activeEffectSources: [],
      activeFactorItems: [],
      activePassiveSkills: [],
      activeProfessionSkills: [],
      activeProfessionTalents: [],
      modifierSourceActors: [],
      dmgPerTarget: [],
      healPerTarget: [],
      deaths: [],
    };
  }

  function slimCombatStats(stats: RawCombatStats): RawCombatStats {
    return {
      total: Number(stats?.total) || 0,
      effectiveTotal: Number(stats?.effectiveTotal) || 0,
      hits: Number(stats?.hits) || 0,
      critHits: Number(stats?.critHits) || 0,
      critTotal: Number(stats?.critTotal) || 0,
      luckyHits: Number(stats?.luckyHits) || 0,
      luckyTotal: Number(stats?.luckyTotal) || 0,
      triggerHits: Number(stats?.triggerHits) || 0,
      blockHits: Number(stats?.blockHits) || 0,
      luckyBlockHits: Number(stats?.luckyBlockHits) || 0,
    };
  }

  function slimRawSkillStats(stats: RawSkillStats): RawSkillStats {
    return {
      totalValue: Number(stats?.totalValue) || 0,
      effectiveTotalValue: Number(stats?.effectiveTotalValue) || 0,
      hits: Number(stats?.hits) || 0,
      critHits: Number(stats?.critHits) || 0,
      critTotalValue: Number(stats?.critTotalValue) || 0,
      luckyHits: Number(stats?.luckyHits) || 0,
      luckyTotalValue: Number(stats?.luckyTotalValue) || 0,
      property: stats?.property ?? null,
      damageMode: stats?.damageMode ?? null,
      triggerHits: Number(stats?.triggerHits) || 0,
      blockHits: Number(stats?.blockHits) || 0,
      luckyBlockHits: Number(stats?.luckyBlockHits) || 0,
    };
  }

  function finitePositiveReportId(value: unknown): number | null {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function playerIdentityKey(player: { uid: number; uuid?: number | null }): string {
    const uuid = finitePositiveReportId(player.uuid);
    return uuid !== null ? `uuid:${uuid}` : `uid:${player.uid}`;
  }

  function entityIdentityKey(entity: HistoryEntityData): string {
    const uuid = finitePositiveReportId(entity.uuid);
    return uuid !== null ? `uuid:${uuid}` : `uid:${entity.uid}`;
  }

  function targetIdentityKey(target: { targetUid: number; targetUuid?: number | null }): string {
    const uuid = finitePositiveReportId(target.targetUuid);
    return uuid !== null ? `uuid:${uuid}` : `uid:${target.targetUid}`;
  }

  function playerMatchesIdentity(player: { uid: number; uuid?: number | null }, uid: number | null, uuid: number | null): boolean {
    const playerUuid = finitePositiveReportId(player.uuid);
    if (uuid !== null && playerUuid !== null) return playerUuid === uuid;
    return uid !== null && player.uid === uid;
  }

  function entityMatchesIdentity(entity: HistoryEntityData, uid: number | null, uuid: number | null): boolean {
    const entityUuid = finitePositiveReportId(entity.uuid);
    if (uuid !== null && entityUuid !== null) return entityUuid === uuid;
    return uid !== null && entity.uid === uid;
  }

  function targetMatchesIdentity(target: { targetUid: number; targetUuid?: number | null }, uid: number | null, uuid: number | null): boolean {
    const targetUuid = finitePositiveReportId(target.targetUuid);
    if (uuid !== null && targetUuid !== null) return targetUuid === uuid;
    return uid !== null && target.targetUid === uid;
  }

  function hitTargetIdentityKey(hit: ModifierReplayHitState): string {
    const uuid = finitePositiveReportId(hit.targetUuid);
    return uuid !== null ? `uuid:${uuid}` : `uid:${hit.targetUid}`;
  }

  type ModifierReportCatalogGate = {
    ignoredBuffIds?: number[];
    reportableBuffIds?: number[];
  };

  function modifierReportCatalogGate(catalog: unknown): {
    ignoredBuffIds: Set<number>;
    reportableBuffIds: Set<number>;
  } | null {
    if (!catalog || typeof catalog !== "object") return null;
    const maybeCatalog = catalog as ModifierReportCatalogGate;
    const reportableBuffIds = new Set(
      (maybeCatalog.reportableBuffIds ?? [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    );
    if (reportableBuffIds.size === 0) return null;
    return {
      reportableBuffIds,
      ignoredBuffIds: new Set(
        (maybeCatalog.ignoredBuffIds ?? [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    };
  }

  function shouldKeepModifierReportBucket(
    bucket: HistoryEntityData["modifierHitBuckets"][number],
    gate: ReturnType<typeof modifierReportCatalogGate>,
  ): boolean {
    if (!gate) return true;
    const ids = [
      finitePositiveReportId(bucket.modifierBaseId),
      finitePositiveReportId(bucket.modifierSourceConfigId),
    ].filter((id): id is number => id !== null);
    if (ids.length === 0) return false;
    if (ids.some((id) => gate.ignoredBuffIds.has(id))) return false;
    return ids.some((id) => gate.reportableBuffIds.has(id));
  }

  function shouldKeepModifierReplaySource(
    source: ModifierReplayHitState["activeModifiers"][number],
    gate: ReturnType<typeof modifierReportCatalogGate>,
  ): boolean {
    if (!gate) return true;
    const ids = [
      finitePositiveReportId(source.modifierBaseId),
      finitePositiveReportId(source.modifierSourceConfigId),
    ].filter((id): id is number => id !== null);
    if (ids.length === 0) return false;
    if (ids.some((id) => gate.ignoredBuffIds.has(id))) return false;
    return ids.some((id) => gate.reportableBuffIds.has(id));
  }

  function slimModifierReplayHit(
    hit: ModifierReplayHitState,
    gate: ReturnType<typeof modifierReportCatalogGate>,
  ): ModifierReplayHitState | null {
    const activeModifiers = (hit.activeModifiers ?? [])
      .filter((source) => shouldKeepModifierReplaySource(source, gate))
      .map((source) => ({
        modifierBaseId: Number(source.modifierBaseId) || 0,
        modifierSourceConfigId: source.modifierSourceConfigId ?? null,
        modifierBuffLevel: source.modifierBuffLevel ?? null,
        modifierCount: source.modifierCount ?? null,
        modifierLayer: Number(source.modifierLayer) || 0,
        modifierHostUuid: source.modifierHostUuid ?? null,
        modifierSourceUuid: source.modifierSourceUuid ?? null,
        modifierHostUid: Number(source.modifierHostUid) || 0,
        modifierSourceUid: Number(source.modifierSourceUid) || 0,
      }));
    if (activeModifiers.length === 0) return null;
    return {
      timestampMs: Number(hit.timestampMs) || 0,
      skillKey: Number(hit.skillKey) || 0,
      damageId: Number(hit.damageId) || 0,
      ownerId: Number(hit.ownerId) || 0,
      ownerLevel: hit.ownerLevel ?? null,
      hitEventId: hit.hitEventId ?? null,
      damageSource: hit.damageSource ?? null,
      property: hit.property ?? null,
      damageMode: hit.damageMode ?? null,
      attackerUuid: hit.attackerUuid ?? null,
      originalAttackerUuid: hit.originalAttackerUuid ?? null,
      topSummonerUuid: hit.topSummonerUuid ?? null,
      targetUuid: hit.targetUuid ?? null,
      attackerUid: Number(hit.attackerUid) || 0,
      originalAttackerUid: Number(hit.originalAttackerUid) || 0,
      topSummonerUid: hit.topSummonerUid ?? null,
      targetUid: Number(hit.targetUid) || 0,
      targetMonsterTypeId: hit.targetMonsterTypeId ?? null,
      isHeal: Boolean(hit.isHeal),
      isCrit: Boolean(hit.isCrit),
      isLucky: Boolean(hit.isLucky),
      value: Number(hit.value) || 0,
      effectiveValue: Number(hit.effectiveValue) || 0,
      hpLossValue: Number(hit.hpLossValue) || 0,
      shieldLossValue: Number(hit.shieldLossValue) || 0,
      activeModifiers,
      attackerAttrs: (hit.attackerAttrs ?? []).map((attr) => ({
        attrId: Number(attr.attrId) || 0,
        valueInt: attr.valueInt ?? null,
        valueFloat: attr.valueFloat ?? null,
        valueBool: attr.valueBool ?? null,
      })),
      targetAttrs: (hit.targetAttrs ?? []).map((attr) => ({
        attrId: Number(attr.attrId) || 0,
        valueInt: attr.valueInt ?? null,
        valueFloat: attr.valueFloat ?? null,
        valueBool: attr.valueBool ?? null,
      })),
    };
  }

  type ModifierSourceOwnerHint = {
    ownerUid: number;
    ownerUuid?: number | null;
    ownerName: string;
    entityType: string;
  };

  function isModifierStateHostedOnTarget(
    hostUid: unknown,
    hostUuid: unknown,
    fallbackUid: number,
    fallbackUuid: unknown,
    targetUid: number,
    targetUuid: unknown,
  ): boolean {
    const resolvedTargetUuid = finitePositiveReportId(targetUuid);
    const resolvedHostUuid = finitePositiveReportId(hostUuid) ?? finitePositiveReportId(fallbackUuid);
    if (resolvedTargetUuid !== null && resolvedHostUuid !== null) {
      return resolvedHostUuid === resolvedTargetUuid;
    }

    const resolvedHostUid = finitePositiveReportId(hostUid) ?? fallbackUid;
    return resolvedHostUid === targetUid;
  }

  function collectModifierSourceOwnerHints(
    targetUid: number,
    targetUuid: number | null,
    neededSourceUids: Set<number>,
    encounterEntities: HistoryEntityData[],
  ): Map<number, ModifierSourceOwnerHint> {
    const owners = new Map<number, ModifierSourceOwnerHint>();
    const ambiguousSourceUids = new Set<number>();

    function remember(
      sourceUidValue: unknown,
      ownerEntity: HistoryEntityData,
      hostUidValue: unknown,
      hostUuidValue: unknown,
    ) {
      const sourceUid = finitePositiveReportId(sourceUidValue);
      if (sourceUid === null || !neededSourceUids.has(sourceUid) || sourceUid === ownerEntity.uid) return;
      if (!isModifierStateHostedOnTarget(hostUidValue, hostUuidValue, ownerEntity.uid, ownerEntity.uuid, targetUid, targetUuid)) return;
      if (ambiguousSourceUids.has(sourceUid)) return;

      const ownerUid = finitePositiveReportId(ownerEntity.uid);
      const ownerUuid = finitePositiveReportId(ownerEntity.uuid);
      if (ownerUid === null) return;
      const existing = owners.get(sourceUid);
      const existingOwnerUuid = finitePositiveReportId(existing?.ownerUuid);
      if (
        existing
        && (
          existing.ownerUid !== ownerUid
          || (existingOwnerUuid !== null && ownerUuid !== null && existingOwnerUuid !== ownerUuid)
        )
      ) {
        owners.delete(sourceUid);
        ambiguousSourceUids.add(sourceUid);
        return;
      }

      owners.set(sourceUid, {
        ownerUid,
        ownerUuid,
        ownerName: ownerEntity.name || `#${ownerUid}`,
        entityType: "EntChar",
      });
    }

    for (const ownerEntity of encounterEntities) {
      for (const state of ownerEntity.activeBuffs ?? []) remember(state.sourceUid, ownerEntity, state.hostUid, state.hostUuid);
      for (const state of ownerEntity.activeFactorBuffs ?? []) remember(state.sourceUid, ownerEntity, state.hostUid, state.hostUuid);
      for (const state of ownerEntity.activeEffectBuffs ?? []) remember(state.sourceUid, ownerEntity, state.hostUid, state.hostUuid);
      for (const state of ownerEntity.modifierWindows ?? []) remember(state.sourceUid, ownerEntity, state.hostUid, state.hostUuid);
    }

    return owners;
  }

  function slimModifierReportEntity(
    entity: HistoryEntityData,
    modifierSourceCatalog?: unknown,
    encounterEntities: HistoryEntityData[] = [],
  ): HistoryEntityData {
    const catalogGate = modifierReportCatalogGate(modifierSourceCatalog);
    const modifierHitBuckets = (entity.modifierHitBuckets ?? [])
      .filter((bucket) => shouldKeepModifierReportBucket(bucket, catalogGate))
      .map((bucket) => ({
        modifierBaseId: Number(bucket.modifierBaseId) || 0,
        modifierSourceConfigId: bucket.modifierSourceConfigId ?? null,
        modifierHostUuid: bucket.modifierHostUuid ?? null,
        modifierSourceUuid: bucket.modifierSourceUuid ?? null,
        modifierHostUid: Number(bucket.modifierHostUid) || 0,
        modifierSourceUid: Number(bucket.modifierSourceUid) || 0,
        skillKey: Number(bucket.skillKey) || 0,
        damageId: Number(bucket.damageId) || 0,
        targetUuid: bucket.targetUuid ?? null,
        targetUid: Number(bucket.targetUid) || 0,
        isHeal: Boolean(bucket.isHeal),
        hits: Number(bucket.hits) || 0,
        totalValue: Number(bucket.totalValue) || 0,
        effectiveTotalValue: Number(bucket.effectiveTotalValue) || 0,
        critHits: Number(bucket.critHits) || 0,
        critTotalValue: Number(bucket.critTotalValue) || 0,
        luckyHits: Number(bucket.luckyHits) || 0,
        luckyTotalValue: Number(bucket.luckyTotalValue) || 0,
      }) as HistoryEntityData["modifierHitBuckets"][number]);
    const modifierReplayHits = (entity.modifierReplayHits ?? [])
      .map((hit) => slimModifierReplayHit(hit, catalogGate))
      .filter((hit): hit is ModifierReplayHitState => hit !== null);

    const neededSkillIds = new Set<number>();
    for (const bucket of modifierHitBuckets) {
      const skillId = finitePositiveReportId(bucket.skillKey);
      const damageId = finitePositiveReportId(bucket.damageId);
      if (skillId !== null) neededSkillIds.add(skillId);
      if (damageId !== null) neededSkillIds.add(damageId);
    }

    const dmgSkills: HistoryEntityData["dmgSkills"] = {};
    for (const skillId of neededSkillIds) {
      const stats = entity.dmgSkills?.[skillId];
      if (stats) dmgSkills[skillId] = slimRawSkillStats(stats);
    }
    const neededSourceUids = new Set(
      modifierHitBuckets
        .map((bucket) => finitePositiveReportId(bucket.modifierSourceUid))
        .filter((uid): uid is number => uid !== null),
    );
    const sourceIdsByUid = new Map<number, { sourceConfigIds: Set<number>; baseIds: Set<number> }>();
    for (const bucket of modifierHitBuckets) {
      const sourceUid = finitePositiveReportId(bucket.modifierSourceUid);
      if (sourceUid === null) continue;
      let ids = sourceIdsByUid.get(sourceUid);
      if (!ids) {
        ids = { sourceConfigIds: new Set(), baseIds: new Set() };
        sourceIdsByUid.set(sourceUid, ids);
      }
      const sourceConfigId = finitePositiveReportId(bucket.modifierSourceConfigId);
      const baseId = finitePositiveReportId(bucket.modifierBaseId);
      if (sourceConfigId !== null) ids.sourceConfigIds.add(sourceConfigId);
      if (baseId !== null) ids.baseIds.add(baseId);
    }
    const sourceOwnerHints = collectModifierSourceOwnerHints(entity.uid, entity.uuid ?? null, neededSourceUids, encounterEntities);
    const modifierSourceActors = (entity.modifierSourceActors ?? [])
      .filter((actor) => neededSourceUids.has(Number(actor.uid)))
      .map((actor) => {
        const uid = Number(actor.uid) || 0;
        const ownerHint = sourceOwnerHints.get(uid);
        return {
          uid,
          uuid: actor.uuid ?? null,
          name: actor.name || `#${actor.uid}`,
          entityType: actor.entityType || ownerHint?.entityType || "Unknown",
          ownerUid: actor.ownerUid ?? ownerHint?.ownerUid ?? null,
          ownerUuid: actor.ownerUuid ?? ownerHint?.ownerUuid ?? null,
          ownerName: actor.ownerName ?? ownerHint?.ownerName ?? null,
          sourceConfigIds: (actor.sourceConfigIds ?? []).map(Number).filter((id) => Number.isFinite(id) && id > 0),
          baseIds: (actor.baseIds ?? []).map(Number).filter((id) => Number.isFinite(id) && id > 0),
        };
      });
    const modifierSourceActorUids = new Set(modifierSourceActors.map((actor) => actor.uid));
    for (const sourceEntity of encounterEntities) {
      if (!neededSourceUids.has(sourceEntity.uid) || modifierSourceActorUids.has(sourceEntity.uid)) continue;
      modifierSourceActors.push({
        uid: sourceEntity.uid,
        uuid: sourceEntity.uuid ?? null,
        name: sourceEntity.name || `#${sourceEntity.uid}`,
        entityType: "EntChar",
        ownerUid: null,
        ownerUuid: null,
        ownerName: null,
        sourceConfigIds: [],
        baseIds: [],
      });
      modifierSourceActorUids.add(sourceEntity.uid);
    }
    for (const [sourceUid, ownerHint] of sourceOwnerHints) {
      if (modifierSourceActorUids.has(sourceUid)) continue;
      const ids = sourceIdsByUid.get(sourceUid);
      modifierSourceActors.push({
        uid: sourceUid,
        uuid: null,
        name: `#${sourceUid}`,
        entityType: "Unknown",
        ownerUid: ownerHint.ownerUid,
        ownerUuid: ownerHint.ownerUuid ?? null,
        ownerName: ownerHint.ownerName,
        sourceConfigIds: [...(ids?.sourceConfigIds ?? [])].sort((a, b) => a - b),
        baseIds: [...(ids?.baseIds ?? [])].sort((a, b) => a - b),
      });
      modifierSourceActorUids.add(sourceUid);
    }

    return {
      ...modifierReportEntityShell(entity),
      damage: slimCombatStats(entity.damage),
      dmgSkills,
      activeFactorBuffs: (entity.activeFactorBuffs ?? []).map((buff) => ({
        factorBuffId: Number(buff.factorBuffId) || 0,
        observedBuffId: Number(buff.observedBuffId) || 0,
        buffLevel: buff.buffLevel ?? null,
        partId: buff.partId ?? null,
        count: buff.count ?? null,
        fightSourceType: buff.fightSourceType ?? null,
        sourceConfigId: buff.sourceConfigId ?? null,
        layer: Number(buff.layer) || 0,
        durationMs: Number(buff.durationMs) || 0,
        createTimeMs: Number(buff.createTimeMs) || 0,
        receivedTimeMs: Number(buff.receivedTimeMs) || 0,
        hostUuid: buff.hostUuid ?? null,
        sourceUuid: buff.sourceUuid ?? null,
        hostUid: Number(buff.hostUid) || 0,
        sourceUid: Number(buff.sourceUid) || 0,
      })),
      activeFactorItems: (entity.activeFactorItems ?? []).map((item) => ({
        factorBuffId: Number(item.factorBuffId) || 0,
        itemConfigId: Number(item.itemConfigId) || 0,
        itemUuid: item.itemUuid ?? null,
        packageKey: Number(item.packageKey) || 0,
        packageType: item.packageType ?? null,
        grade: item.grade ?? null,
        familyId: item.familyId ?? null,
        runtimeSource: item.runtimeSource ?? "",
        selectorPath: item.selectorPath ?? null,
        selectorSignature: item.selectorSignature ?? null,
        selectorOffset: item.selectorOffset ?? null,
      })),
      modifierHitBuckets,
      modifierReplayHits,
      modifierSourceActors,
      ...(modifierSourceCatalog ? { modifierSourceCatalog } : {}),
      dmgPerTarget: (entity.dmgPerTarget ?? []).map((target) => ({
        targetUid: target.targetUid,
        targetUuid: target.targetUuid ?? null,
        targetName: target.targetName,
        totalValue: 0,
        damage: zeroCombatStats(),
        skills: {},
      })),
    };
  }

  // Tab state for encounter view
  let activeTab = $state<HistoryOverviewTab>("damage");

  const t = uiT("dps/history", () => SETTINGS.live.general.state.language);
  let modifierReportsEnabled = $derived.by(() =>
    SETTINGS.live.general.state.modifierReportsEnabled === true,
  );

  function historyPerfNow(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  function historyLoadMs(startedAt: number): number {
    return Math.round(historyPerfNow() - startedAt);
  }

  function logHistoryTiming(message: string, details: Record<string, unknown>) {
    console.info(`[history] ${message}`, details);
  }

  function waitForHistoryPaint(): Promise<void> {
    if (typeof requestAnimationFrame !== "function") return Promise.resolve();
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function modifierLoadingText(): string {
    if (!modifierReportsEnabled) {
      return t("detail.modifierDisabled", "Modifier analysis is disabled in Meter Settings.");
    }
    if (modifierEntitiesLoading && modifierEntitiesLoadingKey === selectedModifierCacheKey) {
      return t("detail.loadingModifierEntities", "Loading modifier encounter data...");
    }
    if (modifierReportLoading && modifierReportLoadingKey === selectedModifierReportKey) {
      return t("detail.loadingModifierReport", "Building modifier report...");
    }
    return t("detail.loadingModifierRows", "Loading modifier details...");
  }

  function thLabel(col: ColumnDefinition): string {
    const fallback = col.headerKey ? t(col.headerKey, col.header ?? "") : (col.header ?? "");
    return columnLabelWithAlias(SETTINGS.history.columnAliases.state, col, fallback);
  }

  const tabs: { key: HistoryOverviewTab; label: string }[] = [
    { key: "damage", label: t("detail.tab.damage", "伤害") },
    { key: "tanked", label: t("detail.tab.tanked", "承伤") },
    { key: "healing", label: t("detail.tab.healing", "治疗") },
    { key: "modifiers", label: t("detail.tab.modifiers", "Modifiers") },
    { key: "death", label: t("detail.tab.death", "Death Replay") },
  ];

  const HISTORY_GRAPH_MAX_SERIES = 12;
  const HISTORY_GRAPH_BUCKET_MS = 5_000;
  const HISTORY_GRAPH_MOVING_WINDOW_MS = 15_000;
  const HISTORY_GRAPH_VIEW_WIDTH = 1000;
  const HISTORY_GRAPH_VIEW_HEIGHT = 560;
  const HISTORY_GRAPH_LEFT = 64;
  const HISTORY_GRAPH_RIGHT = 20;
  const HISTORY_GRAPH_OVERALL_TOP = 34;
  const HISTORY_GRAPH_MOVING_TOP = 318;
  const HISTORY_GRAPH_PANEL_HEIGHT = 176;
  const HISTORY_GRAPH_PLOT_WIDTH = HISTORY_GRAPH_VIEW_WIDTH - HISTORY_GRAPH_LEFT - HISTORY_GRAPH_RIGHT;
  const HISTORY_GRAPH_SERIES_COLORS = [
    "#22c55e",
    "#38bdf8",
    "#f97316",
    "#e879f9",
    "#facc15",
    "#a78bfa",
    "#14b8a6",
    "#ef4444",
    "#84cc16",
    "#60a5fa",
    "#f43f5e",
    "#c084fc",
  ];

  const HISTORY_SUMMARY_DATA_ROWS = 4;

  let encounterDurationSeconds = $derived.by(() => {
    if (!encounter) return 1;
    if (encounter.duration > 0) return Math.max(1, encounter.duration);
    return Math.max(
      1,
      ((encounter.endedAtMs ?? Date.now()) - encounter.startedAtMs) / 1000,
    );
  });

  function formatEncounterDuration(durationSeconds: number) {
    const secs = Math.max(0, Math.round(durationSeconds));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function encounterSceneDisplayName(currentEncounter: EncounterSummaryDto) {
    return localizeSceneName(
      currentEncounter.sceneId ?? null,
      currentEncounter.sceneName || t("detail.unknownScene", "Unknown Scene"),
    );
  }

  function encounterBossSummary(currentEncounter: EncounterSummaryDto) {
    const bossNames = currentEncounter.bosses
      .map((boss) =>
        localizeRawMonsterName(
          boss.monsterName,
          t("detail.unknownBoss", "Unknown Boss"),
        ).trim(),
      )
      .filter((name) => name.length > 0);

    return bossNames.length > 0
      ? bossNames.join(", ")
      : t("list.noBoss", "No Boss");
  }

  function buildHistoryPlayers(
    entities: HistoryEntityData[],
    durationSeconds: number,
    activeCombatDurationSeconds: number | null | undefined,
    localUid: number | null,
    localUuid: number | null,
    options: BuildHistoryPlayersOptions = {},
  ): HistoryPlayerRow[] {
    const elapsedMs = Math.max(1, Math.floor(durationSeconds * 1000));
    const activeCombatMs = Math.max(
      1,
      Math.floor((activeCombatDurationSeconds ?? durationSeconds) * 1000),
    );
    const includeBossTargetAggregate = options.includeBossTargetAggregate !== false;
    const displayEntities = includeBossTargetAggregate
      ? entities.map((entity) => entityWithBossTargetAggregate(entity))
      : entities;
    const source = {
      entities: displayEntities,
      elapsedMs,
      activeCombatTimeMs: activeCombatMs,
      totalDmg: displayEntities.reduce((sum, entity) => sum + (entity.damage?.total ?? 0), 0),
      totalHeal: displayEntities.reduce((sum, entity) => sum + (entity.healing?.total ?? 0), 0),
      totalDmgBossOnly: displayEntities.reduce((sum, entity) => sum + (entity.damageBossOnly?.total ?? 0), 0),
    };

    const dpsRows = computePlayerRowsFromEntities(source, "dps");
    const healRows = computePlayerRowsFromEntities(source, "heal");
    const tankRows = computePlayerRowsFromEntities(source, "tanked");
    const dpsByUid = new Map(dpsRows.map((row) => [row.uid, row]));
    const healByUid = new Map(healRows.map((row) => [row.uid, row]));
    const tankByUid = new Map(tankRows.map((row) => [row.uid, row]));
    const dpsByIdentity = new Map(dpsRows.map((row) => [playerIdentityKey(row), row]));
    const healByIdentity = new Map(healRows.map((row) => [playerIdentityKey(row), row]));
    const tankByIdentity = new Map(tankRows.map((row) => [playerIdentityKey(row), row]));

    return displayEntities
      .map((entity) => {
        const identityKey = entityIdentityKey(entity);
        const dps = dpsByIdentity.get(identityKey) ?? dpsByUid.get(entity.uid);
        const heal = healByIdentity.get(identityKey) ?? healByUid.get(entity.uid);
        const tank = tankByIdentity.get(identityKey) ?? tankByUid.get(entity.uid);
        const equipmentSource = dps ?? heal ?? tank;
        const className = entity.className || "";
        const classSpecName = entity.classSpecName || "";
        const entityUuid = finitePositiveReportId(entity.uuid);
        return {
          uid: entity.uid,
          uuid: entityUuid,
          name: entity.name || `#${entity.uid}`,
          isLocalPlayer: localUuid !== null && entityUuid !== null
            ? entityUuid === localUuid
            : localUid !== null && entity.uid === localUid,
          className,
          classSpecName,
          classDisplay: formatClassSpecLabel(className, classSpecName) || t("detail.unknownClass", "未知职业"),
          abilityScore: entity.abilityScore || 0,
          seasonStrength: entity.seasonStrength || 0,
          equippedItems: equipmentSource?.equippedItems ?? [],
          oceanWeapon: equipmentSource?.oceanWeapon ?? null,
          playerImagines: equipmentSource?.playerImagines ?? [],
          totalDmg: dps?.totalDmg ?? 0,
          dps: dps?.dps ?? 0,
          tdps: dps?.tdps ?? 0,
          activeTimeMs: dps?.activeTimeMs ?? 0,
          dmgPct: dps?.dmgPct ?? 0,
          bossDmg: dps?.bossDmg ?? 0,
          bossDps: dps?.bossDps ?? 0,
          bossDmgPct: dps?.bossDmgPct ?? 0,
          critRate: dps?.critRate ?? 0,
          critDmgRate: dps?.critDmgRate ?? 0,
          luckyRate: dps?.luckyRate ?? 0,
          luckyDmgRate: dps?.luckyDmgRate ?? 0,
          hits: dps?.hits ?? 0,
          hitsPerMinute: dps?.hitsPerMinute ?? 0,
          effectiveTotal: dps?.effectiveTotal ?? 0,
          effectiveDps: dps?.effectiveDps ?? 0,
          damageTaken: tank?.totalDmg ?? 0,
          tankedPS: tank?.dps ?? 0,
          tankedPct: tank?.dmgPct ?? 0,
          critTakenRate: tank?.critRate ?? 0,
          blockRate: tank?.blockRate ?? 0,
          luckyBlockRate: tank?.luckyBlockRate ?? 0,
          hitsTaken: tank?.hits ?? 0,
          healDealt: heal?.totalDmg ?? 0,
          hps: heal?.dps ?? 0,
          healPct: heal?.dmgPct ?? 0,
          critHealRate: heal?.critRate ?? 0,
          hitsHeal: heal?.hits ?? 0,
          effectiveHeal: heal?.effectiveTotal ?? 0,
          ehps: heal?.effectiveDps ?? 0,
        };
      })
      .filter((row) => row.totalDmg > 0 || row.healDealt > 0 || row.damageTaken > 0);
  }

  // Filtered and sorted players based on active tab
  function zeroCombatStats(): RawCombatStats {
    return {
      total: 0,
      effectiveTotal: 0,
      hits: 0,
      critHits: 0,
      critTotal: 0,
      luckyHits: 0,
      luckyTotal: 0,
      triggerHits: 0,
      blockHits: 0,
      luckyBlockHits: 0,
    };
  }

  function addCombatStats(left: RawCombatStats, right: RawCombatStats): RawCombatStats {
    return {
      total: left.total + right.total,
      effectiveTotal: left.effectiveTotal + right.effectiveTotal,
      hits: left.hits + right.hits,
      critHits: left.critHits + right.critHits,
      critTotal: left.critTotal + right.critTotal,
      luckyHits: left.luckyHits + right.luckyHits,
      luckyTotal: left.luckyTotal + right.luckyTotal,
      triggerHits: (left.triggerHits || 0) + (right.triggerHits || 0),
      blockHits: (left.blockHits || 0) + (right.blockHits || 0),
      luckyBlockHits: (left.luckyBlockHits || 0) + (right.luckyBlockHits || 0),
    };
  }

  function isBossOrEliteTargetName(targetName: string): boolean {
    const name = targetName.trim();
    if (!name) return false;
    const lowerName = name.toLowerCase();
    return (
      /^(boss|elite)\s*[:：-]/.test(lowerName) ||
      name.startsWith("首领") ||
      name.startsWith("精英") ||
      name.startsWith("ボス") ||
      name.startsWith("エリート")
    );
  }

  function bossOrEliteTargetStats(entity: HistoryEntityData): RawCombatStats {
    let stats = zeroCombatStats();
    for (const target of entity.dmgPerTarget ?? []) {
      if (!isBossOrEliteTargetName(target.targetName)) continue;
      stats = addCombatStats(stats, target.damage ?? zeroCombatStats());
    }
    return stats;
  }

  function entityWithBossTargetAggregate(entity: HistoryEntityData): HistoryEntityData {
    const targetStats = bossOrEliteTargetStats(entity);
    if (targetStats.total <= 0) return entity;
    return {
      ...entity,
      damageBossOnly: targetStats,
    };
  }

  let perTargetByUid = $derived.by(() =>
    new Map(
      rawEntities.map((row) => [
        row.uid,
        {
          uid: row.uid,
          uuid: row.uuid ?? null,
          dmgTargets: row.dmgPerTarget ?? [],
          healTargets: row.healPerTarget ?? [],
        } satisfies EntityPerTargetData,
      ]),
    ),
  );
  let perTargetByIdentity = $derived.by(() =>
    new Map(
      rawEntities.map((row) => [
        entityIdentityKey(row),
        {
          uid: row.uid,
          uuid: row.uuid ?? null,
          dmgTargets: row.dmgPerTarget ?? [],
          healTargets: row.healPerTarget ?? [],
        } satisfies EntityPerTargetData,
      ]),
    ),
  );

  let entityNameByUid = $derived.by(() => {
    const mapping = new Map<number, string>();
    for (const entity of rawEntities) {
      if (entity.name && entity.name.trim().length > 0) {
        mapping.set(entity.uid, entity.name);
      }
    }
    return mapping;
  });
  let entityNameByIdentity = $derived.by(() => {
    const mapping = new Map<string, string>();
    for (const entity of rawEntities) {
      if (entity.name && entity.name.trim().length > 0) {
        mapping.set(entityIdentityKey(entity), entity.name);
      }
    }
    return mapping;
  });

  let pushedUidSet = $derived.by(() => new Set(rawEntities.map((row) => row.uid)));
  let pushedIdentitySet = $derived.by(() => new Set(rawEntities.map((row) => entityIdentityKey(row))));
  let pushedPlayerEntities = $derived.by(() =>
    rawEntities.filter((row) =>
      entityMatchesIdentity(row, localPlayerUid, localPlayerUuid) ||
      row.classId > 0 ||
      row.classSpec > 0 ||
      row.className.trim().length > 0 ||
      row.classSpecName.trim().length > 0
    ),
  );
  let playerTargetUidSet = $derived.by(() => new Set(pushedPlayerEntities.map((row) => row.uid)));
  let playerTargetIdentitySet = $derived.by(() => new Set(pushedPlayerEntities.map((row) => entityIdentityKey(row))));

  function perTargetForPlayer(player: { uid: number; uuid?: number | null } | null): EntityPerTargetData | undefined {
    if (!player) return undefined;
    return perTargetByIdentity.get(playerIdentityKey(player)) ?? perTargetByUid.get(player.uid);
  }

  function targetDisplayName(target: { targetUid: number; targetUuid?: number | null; targetName: string }): string {
    return entityNameByIdentity.get(targetIdentityKey(target))
      ?? entityNameByUid.get(target.targetUid)
      ?? target.targetName;
  }

  function isNumericLikeName(name: string): boolean {
    return /^#?\d+$/.test(name.trim());
  }

  let overviewTargets = $derived.by(() => {
    const merged = new Map<string, OverviewTargetOption>();
    for (const row of rawEntities) {
      for (const target of row.dmgPerTarget ?? []) {
        const key = targetIdentityKey(target);
        const existing = merged.get(key);
        if (existing) {
          existing.totalValue += target.totalValue;
          if (existing.targetName.startsWith("#") && target.targetName) {
            existing.targetName = target.targetName;
          }
        } else {
          merged.set(key, {
            targetUid: target.targetUid,
            targetUuid: target.targetUuid ?? null,
            targetName: target.targetName,
            totalValue: target.totalValue,
          });
        }
      }
    }
    return [...merged.values()]
      .filter(
        (target) =>
          target.targetName.trim().length > 0 &&
          !playerTargetIdentitySet.has(targetIdentityKey(target)) &&
          !playerTargetUidSet.has(target.targetUid) &&
          !isNumericLikeName(target.targetName),
      )
      .sort((a, b) => b.totalValue - a.totalValue);
  });

  let displayedPlayers = $derived.by(() => {
    if (activeTab === "damage") {
      if (overviewTargetUid === null && overviewTargetUuid === null) {
        return [...players].sort((a, b) => b.totalDmg - a.totalDmg);
      }

      const targetEntities = rawEntities.map((entity) => {
        const perTarget = perTargetByIdentity.get(entityIdentityKey(entity)) ?? perTargetByUid.get(entity.uid);
        const targetStats = perTarget?.dmgTargets.find((target) =>
          targetMatchesIdentity(target, overviewTargetUid, overviewTargetUuid),
        );
        const damage = targetStats?.damage ?? zeroCombatStats();
        return {
          ...entity,
          damage,
          damageBossOnly: zeroCombatStats(),
          healing: zeroCombatStats(),
          taken: zeroCombatStats(),
        };
      });
      return buildHistoryPlayers(
        targetEntities,
        encounterDurationSeconds,
        encounter?.activeCombatDuration ?? null,
        localPlayerUid,
        localPlayerUuid,
        { includeBossTargetAggregate: false },
      )
        .sort((a, b) => b.totalDmg - a.totalDmg);
    } else if (activeTab === "tanked") {
      return [...players]
        .filter((p) => p.damageTaken > 0)
        .sort((a, b) => b.damageTaken - a.damageTaken);
    } else if (activeTab === "healing") {
      return [...players]
        .filter((p) => p.healDealt > 0)
        .sort((a, b) => b.healDealt - a.healDealt);
    }
    return players;
  });

  let selectedPlayer = $derived.by(() => {
    if (!hasSelectedChar) return null;
    return players.find((p) => playerMatchesIdentity(p, selectedCharUid, charUuid)) ?? null;
  });

  let selectedEntity = $derived.by(() => {
    if (!hasSelectedChar) return null;
    return rawEntities.find((entity) => entityMatchesIdentity(entity, selectedCharUid, charUuid)) ?? null;
  });

  let selectedSkillTargetUid = $derived.by(() => {
    return finitePositiveReportId($page.url.searchParams.get("targetUid"));
  });
  let selectedSkillTargetUuid = $derived(finitePositiveReportId($page.url.searchParams.get("targetUuid")));

  let selectedDeathTs = $derived.by(() => {
    const raw = $page.url.searchParams.get("deathTs");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  });

  let deathEntries = $derived.by<DeathPlayerEntry[]>(() =>
    rawEntities
      .filter((entity) => (entity.deaths?.length ?? 0) > 0)
      .map((entity) => ({
        uid: entity.uid,
        uuid: entity.uuid ?? null,
        entityKey: entity.uuid ? String(entity.uuid) : null,
        name: entity.name || `#${entity.uid}`,
        className: entity.className || "",
        classSpecName: entity.classSpecName || "",
        deaths: entity.deaths ?? [],
      })),
  );

  let selectedDeathRecord = $derived.by(() => {
    if (!selectedEntity || selectedDeathTs == null) return null;
    return (
      selectedEntity.deaths?.find(
        (record) => Number(record.deathTimestampMs) === selectedDeathTs,
      ) ?? null
    );
  });

  let historyTeamSummarySource = $derived.by<HistorySummaryStatsSource | null>(() => {
    const row = buildTeamSummaryRow(players);
    return row ? buildTeamSummaryStatsSource(row, rawEntities) : null;
  });

  let selectedSkillSummarySource = $derived.by<HistorySummaryStatsSource | null>(() =>
    selectedPlayer && selectedEntity
      ? buildPlayerSummaryStatsSource(selectedPlayer, selectedEntity)
      : null,
  );

  let overviewSummaryGroups = $derived.by<PlayerSummaryGroup[]>(() =>
    historyTeamSummarySource
      ? buildTeamSummaryGroups(historyTeamSummarySource)
      : [],
  );

  let selectedSkillSummaryGroups = $derived.by<PlayerSummaryGroup[]>(() =>
    selectedSkillSummarySource
      ? buildPlayerSummaryGroups(selectedSkillSummarySource, skillType)
      : [],
  );

  function graphMetricForTab(tab: HistoryOverviewTab): HistoryGraphMetric | null {
    if (tab === "damage") return "damage";
    if (tab === "healing") return "healing";
    if (tab === "tanked") return "tanked";
    return null;
  }

  let historyGraphMetric = $derived.by(() => graphMetricForTab(activeTab));
  let graphSourceEntities = $derived.by(() =>
    graphEntitiesEncounterId === encounterId && graphEntities ? graphEntities : rawEntities,
  );

  function replayHitMetricValue(hit: ModifierReplayHitState, metric: HistoryGraphMetric): number {
    if (metric === "healing") {
      if (!hit.isHeal) return 0;
      return Math.max(0, Number(hit.effectiveValue) || Number(hit.value) || 0);
    }
    if (hit.isHeal) return 0;
    if (metric === "tanked") {
      const takenValue = (Number(hit.hpLossValue) || 0) + (Number(hit.shieldLossValue) || 0);
      return Math.max(0, takenValue || Number(hit.effectiveValue) || Number(hit.value) || 0);
    }
    return Math.max(0, Number(hit.effectiveValue) || Number(hit.value) || 0);
  }

  function combatTimelineMetricValue(
    bucket: CombatTimelineBucket,
    metric: HistoryGraphMetric,
  ): number {
    if (metric === "healing") {
      return Math.max(0, Number(bucket.effectiveHealingValue) || Number(bucket.healingValue) || 0);
    }
    if (metric === "tanked") {
      const takenValue = Number(bucket.takenValue) || ((Number(bucket.hpLossValue) || 0) + (Number(bucket.shieldLossValue) || 0));
      return Math.max(0, takenValue);
    }
    return Math.max(0, Number(bucket.effectiveDamageValue) || Number(bucket.damageValue) || 0);
  }

  function replayHitRelativeMs(hit: ModifierReplayHitState, startMs: number, durationMs: number): number {
    const timestampMs = Number(hit.timestampMs) || 0;
    const relativeMs = timestampMs >= startMs ? timestampMs - startMs : timestampMs;
    if (!Number.isFinite(relativeMs)) return 0;
    return Math.min(Math.max(0, relativeMs), durationMs);
  }

  function combatTimelineRelativeMs(
    bucket: CombatTimelineBucket,
    startMs: number,
    durationMs: number,
  ): number {
    const timestampMs = Number(bucket.timestampMs) || 0;
    const relativeMs = timestampMs >= startMs ? timestampMs - startMs : timestampMs;
    if (!Number.isFinite(relativeMs)) return 0;
    return Math.min(Math.max(0, relativeMs), durationMs);
  }

  function deathRelativeMs(timestampMs: number, startMs: number, durationMs: number): number | null {
    const raw = Number(timestampMs);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const relativeMs = raw >= startMs ? raw - startMs : raw;
    return Math.min(Math.max(0, relativeMs), durationMs);
  }

  function graphX(relativeMs: number, durationMs: number): number {
    return HISTORY_GRAPH_LEFT + (Math.min(Math.max(0, relativeMs), durationMs) / Math.max(1, durationMs)) * HISTORY_GRAPH_PLOT_WIDTH;
  }

  function graphY(value: number, maxValue: number, panelTop: number): number {
    return panelTop + HISTORY_GRAPH_PANEL_HEIGHT - (Math.min(Math.max(0, value), maxValue) / Math.max(1, maxValue)) * HISTORY_GRAPH_PANEL_HEIGHT;
  }

  function graphSeriesPoints(points: HistoryGraphPoint[]): string {
    return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  }

  function graphAreaPoints(points: HistoryGraphPoint[], panelTop: number): string {
    if (points.length === 0) return "";
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    if (!firstPoint || !lastPoint) return "";
    const baselineY = panelTop + HISTORY_GRAPH_PANEL_HEIGHT;
    return [
      `${firstPoint.x.toFixed(1)},${baselineY.toFixed(1)}`,
      ...points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`),
      `${lastPoint.x.toFixed(1)},${baselineY.toFixed(1)}`,
    ].join(" ");
  }

  function graphNiceStep(rawStep: number): number {
    if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;
    const niceNormalized =
      normalized <= 1 ? 1 :
      normalized <= 2 ? 2 :
      normalized <= 5 ? 5 :
      10;
    return niceNormalized * magnitude;
  }

  function graphTickScale(maxValue: number): GraphTickScale {
    if (!Number.isFinite(maxValue) || maxValue <= 0) return { maxValue: 1, ticks: [0, 1] };
    const steps = 4;
    const step = graphNiceStep(maxValue / steps);
    const scaledMaxValue = Math.max(step, Math.ceil(maxValue / step) * step);
    const ticks: number[] = [];
    const limit = scaledMaxValue + step * 0.001;
    for (let value = 0; value <= limit; value += step) {
      ticks.push(Math.min(value, scaledMaxValue));
    }
    return { maxValue: scaledMaxValue, ticks };
  }

  function graphTimeTicks(durationMs: number): number[] {
    const durationSeconds = Math.max(1, durationMs / 1000);
    const stepSeconds = durationSeconds <= 60 ? 15 : durationSeconds <= 180 ? 30 : 60;
    const ticks: number[] = [0];
    for (let seconds = stepSeconds; seconds < durationSeconds; seconds += stepSeconds) {
      ticks.push(seconds * 1000);
    }
    if (durationMs > 0 && ticks[ticks.length - 1] !== durationMs) ticks.push(durationMs);
    return ticks;
  }

  function graphMinorTimeTicks(durationMs: number, majorTicks: number[]): number[] {
    const ticks: number[] = [];
    for (let index = 0; index < majorTicks.length - 1; index += 1) {
      const left = majorTicks[index];
      const right = majorTicks[index + 1];
      if (left === undefined || right === undefined) continue;
      const mid = (left + right) / 2;
      if (mid > 0 && mid < durationMs) ticks.push(mid);
    }
    return ticks;
  }

  function formatGraphTime(ms: number): string {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  function formatGraphNumber(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "0";
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}b`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return Math.round(value).toString();
  }

  function sumHistoryRows(rows: readonly HistoryPlayerRow[], key: keyof HistoryPlayerRow): number {
    return rows.reduce((total, row) => {
      const value = row[key];
      return total + (typeof value === "number" && Number.isFinite(value) ? value : 0);
    }, 0);
  }

  function weightedHistoryRate(
    rows: readonly HistoryPlayerRow[],
    rateKey: keyof HistoryPlayerRow,
    weightKey: keyof HistoryPlayerRow,
  ): number {
    let weightedTotal = 0;
    let weightTotal = 0;
    for (const row of rows) {
      const rate = row[rateKey];
      const weight = row[weightKey];
      if (
        typeof rate !== "number" ||
        !Number.isFinite(rate) ||
        typeof weight !== "number" ||
        !Number.isFinite(weight) ||
        weight <= 0
      ) {
        continue;
      }
      weightedTotal += rate * weight;
      weightTotal += weight;
    }
    return weightTotal > 0 ? weightedTotal / weightTotal : 0;
  }

  function buildTeamSummaryRow(rows: readonly HistoryPlayerRow[]): HistoryPlayerRow | null {
    if (rows.length === 0) return null;

    const durationSeconds = Math.max(1, encounterDurationSeconds);
    const activeSeconds = Math.max(1, encounter?.activeCombatDuration ?? durationSeconds);
    const totalDmg = sumHistoryRows(rows, "totalDmg");
    const bossDmg = sumHistoryRows(rows, "bossDmg");
    const hits = sumHistoryRows(rows, "hits");
    const healDealt = sumHistoryRows(rows, "healDealt");
    const effectiveHeal = sumHistoryRows(rows, "effectiveHeal");
    const hitsHeal = sumHistoryRows(rows, "hitsHeal");
    const damageTaken = sumHistoryRows(rows, "damageTaken");
    const hitsTaken = sumHistoryRows(rows, "hitsTaken");

    return {
      uid: 0,
      uuid: null,
      name: "Team",
      isLocalPlayer: false,
      className: "",
      classSpecName: "",
      classDisplay: "",
      abilityScore: 0,
      seasonStrength: 0,
      equippedItems: [],
      oceanWeapon: null,
      playerImagines: [],
      totalDmg,
      dps: totalDmg / durationSeconds,
      tdps: totalDmg / activeSeconds,
      activeTimeMs: activeSeconds * 1000,
      dmgPct: totalDmg > 0 ? 100 : 0,
      bossDmg,
      bossDps: bossDmg / durationSeconds,
      bossDmgPct: bossDmg > 0 ? 100 : 0,
      critRate: weightedHistoryRate(rows, "critRate", "hits"),
      critDmgRate: weightedHistoryRate(rows, "critDmgRate", "totalDmg"),
      luckyRate: weightedHistoryRate(rows, "luckyRate", "hits"),
      luckyDmgRate: weightedHistoryRate(rows, "luckyDmgRate", "totalDmg"),
      hits,
      hitsPerMinute: (hits / durationSeconds) * 60,
      effectiveTotal: sumHistoryRows(rows, "effectiveTotal"),
      effectiveDps: sumHistoryRows(rows, "effectiveTotal") / durationSeconds,
      damageTaken,
      tankedPS: damageTaken / durationSeconds,
      tankedPct: damageTaken > 0 ? 100 : 0,
      critTakenRate: weightedHistoryRate(rows, "critTakenRate", "hitsTaken"),
      blockRate: weightedHistoryRate(rows, "blockRate", "hitsTaken"),
      luckyBlockRate: weightedHistoryRate(rows, "luckyBlockRate", "hitsTaken"),
      hitsTaken,
      healDealt,
      effectiveHeal,
      ehps: effectiveHeal / durationSeconds,
      hps: healDealt / durationSeconds,
      healPct: healDealt > 0 ? 100 : 0,
      critHealRate: weightedHistoryRate(rows, "critHealRate", "hitsHeal"),
      hitsHeal,
    };
  }

  function entityBossDamageStats(entity: HistoryEntityData): RawCombatStats {
    const targetStats = bossOrEliteTargetStats(entity);
    return targetStats.total > 0 ? targetStats : (entity.damageBossOnly ?? zeroCombatStats());
  }

  function aggregateCombatStats(
    entities: readonly HistoryEntityData[],
    statsForEntity: (entity: HistoryEntityData) => RawCombatStats,
  ): RawCombatStats {
    let stats = zeroCombatStats();
    for (const entity of entities) {
      stats = addCombatStats(stats, statsForEntity(entity) ?? zeroCombatStats());
    }
    return stats;
  }

  function buildTeamSummaryStatsSource(
    row: HistoryPlayerRow,
    entities: readonly HistoryEntityData[],
  ): HistorySummaryStatsSource {
    return {
      row,
      damage: aggregateCombatStats(entities, (entity) => entity.damage ?? zeroCombatStats()),
      bossDamage: aggregateCombatStats(entities, entityBossDamageStats),
      healing: aggregateCombatStats(entities, (entity) => entity.healing ?? zeroCombatStats()),
      taken: aggregateCombatStats(entities, (entity) => entity.taken ?? zeroCombatStats()),
      deaths: entities.reduce((count, entity) => count + (entity.deaths?.length ?? 0), 0),
    };
  }

  function buildPlayerSummaryStatsSource(
    row: HistoryPlayerRow,
    entity: HistoryEntityData,
  ): HistorySummaryStatsSource {
    return {
      row,
      damage: entity.damage ?? zeroCombatStats(),
      bossDamage: entityBossDamageStats(entity),
      healing: entity.healing ?? zeroCombatStats(),
      taken: entity.taken ?? zeroCombatStats(),
      deaths: entity.deaths?.length ?? 0,
    };
  }

  function summaryLabel(key: string, fallback: string): string {
    return t(`detail.summary.${key}`, fallback);
  }

  function summaryItem(
    key: string,
    label: string,
    value: string,
    accent: HistorySummaryAccent,
  ): PlayerSummaryItem {
    return { key, label, value, accent };
  }

  function normalizeSummaryRows(
    pairsPerRow: number,
    rows: readonly (readonly (PlayerSummaryItem | null)[])[],
  ): (PlayerSummaryItem | null)[][] {
    const normalized: (PlayerSummaryItem | null)[][] = [];
    for (let rowIndex = 0; rowIndex < HISTORY_SUMMARY_DATA_ROWS; rowIndex += 1) {
      const sourceRow = rows[rowIndex] ?? [];
      normalized.push(Array.from({ length: pairsPerRow }, (_, pairIndex) => sourceRow[pairIndex] ?? null));
    }
    return normalized;
  }

  function summaryGroup(
    key: string,
    label: string,
    pairsPerRow: number,
    rows: readonly (readonly (PlayerSummaryItem | null)[])[],
  ): PlayerSummaryGroup {
    return {
      key,
      label,
      columns: pairsPerRow * 2,
      rows: normalizeSummaryRows(pairsPerRow, rows),
    };
  }

  function statValue(stats: RawCombatStats, key: keyof RawCombatStats): number {
    const value = stats[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  function statTriggerHits(stats: RawCombatStats): number {
    return statValue(stats, "triggerHits") || statValue(stats, "hits");
  }

  function summaryRate(part: number, total: number): number {
    if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
    return (part / total) * 100;
  }

  function clampSummaryPercent(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value >= 99.95) return 100;
    return Math.min(100, value);
  }

  function formatSummaryCompact(value: number): string {
    return formatGraphNumber(value);
  }

  function formatSummaryInteger(value: number): string {
    if (!Number.isFinite(value)) return "0";
    return Math.round(Math.max(0, value)).toLocaleString();
  }

  function formatSummaryPercent(value: number): string {
    return `${clampSummaryPercent(value).toFixed(1)}%`;
  }

  function buildSummaryTimeRows(source: HistorySummaryStatsSource): (PlayerSummaryItem | null)[][] {
    return [
      [
        summaryItem(
          "encounterTime",
          summaryLabel("encounterTime", "Encounter Time"),
          formatEncounterDuration(encounterDurationSeconds),
          "time",
        ),
      ],
      [
        summaryItem(
          "trueDpsTime",
          summaryLabel("trueDpsTime", "True DPS Time"),
          formatEncounterDuration(playerActiveDurationSeconds(source.row)),
          "time",
        ),
      ],
      [null],
      [
        summaryItem(
          "deaths",
          t("detail.death.countColumn", "Deaths"),
          formatSummaryInteger(source.deaths),
          "time",
        ),
      ],
    ];
  }

  function buildTeamSummaryGroups(source: HistorySummaryStatsSource): PlayerSummaryGroup[] {
    const { row } = source;
    return [
      summaryGroup("time", summaryLabel("time", "Time"), 1, buildSummaryTimeRows(source)),
      summaryGroup("damage", summaryLabel("damage", "Damage"), 2, [
        [
          summaryItem("totalDmg", summaryLabel("damageDone", "Damage"), formatSummaryCompact(row.totalDmg), "damage"),
          summaryItem("bossDmg", summaryLabel("bossDamage", "Boss Damage"), formatSummaryCompact(row.bossDmg), "damage"),
        ],
        [
          summaryItem("dps", summaryLabel("dps", "DPS"), formatSummaryCompact(row.dps), "damage"),
          summaryItem("bossDps", summaryLabel("bossDps", "Boss DPS"), formatSummaryCompact(row.bossDps), "damage"),
        ],
        [
          summaryItem("tdps", summaryLabel("trueDps", "True DPS"), formatSummaryCompact(row.tdps), "damage"),
          summaryItem("hits", summaryLabel("hits", "Hits"), formatSummaryInteger(row.hits), "damage"),
        ],
        [
          summaryItem("dmgPct", summaryLabel("sharePct", "Share %"), formatSummaryPercent(row.dmgPct), "damage"),
          summaryItem("hitsPerMinute", summaryLabel("hitsPerMinute", "Hits/min"), formatSummaryCompact(row.hitsPerMinute), "damage"),
        ],
      ]),
      summaryGroup("healing", summaryLabel("heals", "Heals"), 1, [
        [summaryItem("healDealt", summaryLabel("healingDone", "Healing"), formatSummaryCompact(row.healDealt), "healing")],
        [summaryItem("hps", summaryLabel("hps", "HPS"), formatSummaryCompact(row.hps), "healing")],
        [summaryItem("effectiveHeal", summaryLabel("effectiveHeals", "Effective Heals"), formatSummaryCompact(row.effectiveHeal), "healing")],
        [summaryItem("ehps", summaryLabel("ehps", "eHPS"), formatSummaryCompact(row.ehps), "healing")],
      ]),
      summaryGroup("tanked", summaryLabel("tanked", "Tanked"), 1, [
        [summaryItem("damageTaken", summaryLabel("damageTakenShort", "Dmg Taken"), formatSummaryCompact(row.damageTaken), "tanked")],
        [summaryItem("tankedPS", summaryLabel("dtps", "DTPS"), formatSummaryCompact(row.tankedPS), "tanked")],
        [summaryItem("hitsTaken", summaryLabel("hitsTaken", "Hits Taken"), formatSummaryInteger(row.hitsTaken), "tanked")],
        [summaryItem("tankedPct", summaryLabel("sharePct", "Share %"), formatSummaryPercent(row.tankedPct), "tanked")],
      ]),
    ];
  }

  function buildDamageSummaryRows(source: HistorySummaryStatsSource): (PlayerSummaryItem | null)[][] {
    const { row, damage } = source;
    const hits = statValue(damage, "hits");
    const triggerHits = statTriggerHits(damage);
    return [
      [
        summaryItem("totalDmg", summaryLabel("damageDone", "Damage"), formatSummaryCompact(row.totalDmg), "damage"),
        summaryItem("bossDmg", summaryLabel("bossDamage", "Boss Damage"), formatSummaryCompact(row.bossDmg), "damage"),
        summaryItem("critHits", summaryLabel("critHits", "Crit Hits"), formatSummaryInteger(statValue(damage, "critHits")), "damage"),
        summaryItem("luckyHits", summaryLabel("luckyHits", "Lucky Hits"), formatSummaryInteger(statValue(damage, "luckyHits")), "damage"),
      ],
      [
        summaryItem("dps", summaryLabel("dps", "DPS"), formatSummaryCompact(row.dps), "damage"),
        summaryItem("bossDps", summaryLabel("bossDps", "Boss DPS"), formatSummaryCompact(row.bossDps), "damage"),
        summaryItem("critRate", summaryLabel("critPct", "Crit%"), formatSummaryPercent(summaryRate(statValue(damage, "critHits"), hits)), "damage"),
        summaryItem("luckyRate", summaryLabel("luckyPct", "Lucky%"), formatSummaryPercent(summaryRate(statValue(damage, "luckyHits"), triggerHits)), "damage"),
      ],
      [
        summaryItem("tdps", summaryLabel("trueDps", "True DPS"), formatSummaryCompact(row.tdps), "damage"),
        summaryItem("hits", summaryLabel("hits", "Hits"), formatSummaryInteger(row.hits), "damage"),
        summaryItem("critTotal", summaryLabel("critDamage", "Crit DMG"), formatSummaryCompact(statValue(damage, "critTotal")), "damage"),
        summaryItem("luckyTotal", summaryLabel("luckyDamage", "Lucky DMG"), formatSummaryCompact(statValue(damage, "luckyTotal")), "damage"),
      ],
      [
        summaryItem("dmgPct", summaryLabel("sharePct", "Share %"), formatSummaryPercent(row.dmgPct), "damage"),
        summaryItem("hitsPerMinute", summaryLabel("hitsPerMinute", "Hits/min"), formatSummaryCompact(row.hitsPerMinute), "damage"),
        null,
        null,
      ],
    ];
  }

  function buildHealingSummaryRows(source: HistorySummaryStatsSource): (PlayerSummaryItem | null)[][] {
    const { row, healing } = source;
    const hits = statValue(healing, "hits");
    const triggerHits = statTriggerHits(healing);
    return [
      [
        null,
        summaryItem("healDealt", summaryLabel("healingDone", "Healing"), formatSummaryCompact(row.healDealt), "healing"),
        summaryItem("critHits", summaryLabel("critHits", "Crit Hits"), formatSummaryInteger(statValue(healing, "critHits")), "healing"),
        summaryItem("luckyHits", summaryLabel("luckyHits", "Lucky Hits"), formatSummaryInteger(statValue(healing, "luckyHits")), "healing"),
      ],
      [
        null,
        summaryItem("hps", summaryLabel("hps", "HPS"), formatSummaryCompact(row.hps), "healing"),
        summaryItem("critRate", summaryLabel("critPct", "Crit%"), formatSummaryPercent(summaryRate(statValue(healing, "critHits"), hits)), "healing"),
        summaryItem("luckyRate", summaryLabel("luckyPct", "Lucky%"), formatSummaryPercent(summaryRate(statValue(healing, "luckyHits"), triggerHits)), "healing"),
      ],
      [
        null,
        summaryItem("effectiveHeal", summaryLabel("effectiveHeals", "Effective Heals"), formatSummaryCompact(row.effectiveHeal), "healing"),
        summaryItem("critTotal", summaryLabel("critHeals", "Crit Heals"), formatSummaryCompact(statValue(healing, "critTotal")), "healing"),
        summaryItem("luckyTotal", summaryLabel("luckyHeals", "Lucky Heals"), formatSummaryCompact(statValue(healing, "luckyTotal")), "healing"),
      ],
      [
        null,
        summaryItem("ehps", summaryLabel("ehps", "eHPS"), formatSummaryCompact(row.ehps), "healing"),
        null,
        null,
      ],
    ];
  }

  function buildTankedSummaryRows(source: HistorySummaryStatsSource): (PlayerSummaryItem | null)[][] {
    const { row, taken } = source;
    const hits = statValue(taken, "hits");
    const triggerHits = statTriggerHits(taken);
    return [
      [
        null,
        summaryItem("damageTaken", summaryLabel("damageTakenShort", "Dmg Taken"), formatSummaryCompact(row.damageTaken), "tanked"),
        summaryItem("hitsTaken", summaryLabel("hitsTaken", "Hits Taken"), formatSummaryInteger(row.hitsTaken), "tanked"),
        summaryItem("blockRate", summaryLabel("blockPct", "Block%"), formatSummaryPercent(summaryRate(statValue(taken, "blockHits"), hits)), "tanked"),
      ],
      [
        null,
        summaryItem("tankedPS", summaryLabel("dtps", "DTPS"), formatSummaryCompact(row.tankedPS), "tanked"),
        summaryItem("luckyRate", summaryLabel("luckyPct", "Lucky%"), formatSummaryPercent(summaryRate(statValue(taken, "luckyHits"), triggerHits)), "tanked"),
        summaryItem("blockHits", summaryLabel("blocks", "Blocks"), formatSummaryInteger(statValue(taken, "blockHits")), "tanked"),
      ],
      [null, null, null, null],
      [null, null, null, null],
    ];
  }

  function buildPlayerSummaryGroups(
    source: HistorySummaryStatsSource,
    mode: HistorySkillType,
  ): PlayerSummaryGroup[] {
    const time = summaryGroup("time", summaryLabel("time", "Time"), 1, buildSummaryTimeRows(source));
    if (mode === "heal") {
      return [
        time,
        summaryGroup("healing", summaryLabel("healed", "Healed"), 4, buildHealingSummaryRows(source)),
      ];
    }
    if (mode === "tanked") {
      return [
        time,
        summaryGroup("tanked", summaryLabel("tanked", "Tanked"), 4, buildTankedSummaryRows(source)),
      ];
    }
    return [
      time,
      summaryGroup("damage", summaryLabel("damage", "Damage"), 4, buildDamageSummaryRows(source)),
    ];
  }

  function playerActiveDurationSeconds(row: HistoryPlayerRow): number {
    if (row.activeTimeMs > 0) return row.activeTimeMs / 1000;
    const encounterActiveDuration = encounter?.activeCombatDuration;
    return Math.max(1, encounterActiveDuration ?? encounterDurationSeconds);
  }

  function formatGraphAxisNumber(value: number): string {
    return formatGraphNumber(value).replace(/\.0([kmb])$/, "$1");
  }

  function graphMetricLabel(metric: HistoryGraphMetric): string {
    if (metric === "healing") return t("detail.graphHealing", "Healing");
    if (metric === "tanked") return t("detail.graphTanked", "Tanked");
    return t("detail.graphDamage", "Damage");
  }

  function graphRateLabel(metric: HistoryGraphMetric): string {
    if (metric === "healing") return t("detail.graphHps", "HPS");
    if (metric === "tanked") return t("detail.graphTps", "TPS");
    return t("detail.graphDps", "DPS");
  }

  function graphOverallLabel(metric: HistoryGraphMetric): string {
    return `${t("detail.graphOverall", "Overall")} ${graphRateLabel(metric)}`;
  }

  function graphMovingAverageLabel(metric: HistoryGraphMetric): string {
    return `${t("detail.graphMovingAverage", "Moving Average")} ${graphRateLabel(metric)}`;
  }

  function graphEmptyMessage(metric: HistoryGraphMetric | null): string {
    if (!metric) return t("detail.graphUnavailable", "Graph is unavailable for this view.");
    return t(
      "detail.graphNoTimelineData",
      "No timeline data is available for this saved encounter. Older saved encounters cannot be backfilled; save a new encounter with graph capture enabled.",
    );
  }

  function graphSettingSeconds(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
  }

  function historyGraphBucketMsSetting(): number {
    return graphSettingSeconds(
      settings.state.history.general.historyGraphBucketSeconds,
      5,
      1,
      10,
    ) * 1000;
  }

  function historyGraphMovingWindowMsSetting(): number {
    return graphSettingSeconds(
      settings.state.history.general.historyGraphWindowSeconds,
      15,
      10,
      30,
    ) * 1000;
  }

  function graphGuideLineDasharray(style: unknown): string | undefined {
    if (style === "dotted") return "1 7";
    if (style === "dashed") return "8 7";
    return undefined;
  }

  function graphGuideLineCap(style: unknown): "butt" | "round" {
    return style === "dotted" || style === "dashed" ? "round" : "butt";
  }

  function graphSeriesGradientId(seriesKey: string, panel: "overall" | "moving"): string {
    return `history-graph-${panel}-${seriesKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  }

  function buildHistoryGraphData(
    sourceEntities: HistoryEntityData[],
    visiblePlayers: HistoryPlayerRow[],
    metric: HistoryGraphMetric | null,
    currentEncounter: EncounterSummaryDto | null,
    displayMode: HistoryGraphDisplayMode,
  ): HistoryGraphData | null {
    if (!metric || !currentEncounter) return null;
    const durationMs = Math.max(1_000, Math.round(encounterDurationSeconds * 1000));
    const bucketMs = historyGraphBucketMsSetting();
    const bucketCount = Math.max(1, Math.ceil(durationMs / bucketMs));
    const startMs = Number(currentEncounter.startedAtMs) || 0;
    const playerByIdentity = new Map(visiblePlayers.map((player) => [playerIdentityKey(player), player]));
    const playerByUid = new Map(visiblePlayers.map((player) => [player.uid, player]));
    const entityByIdentity = new Map(sourceEntities.map((entity) => [entityIdentityKey(entity), entity]));
    const entityByUid = new Map(sourceEntities.map((entity) => [entity.uid, entity]));
    const bucketsByIdentity = new Map<string, number[]>();

    function playerForSourceEntity(entity: HistoryEntityData): HistoryPlayerRow | undefined {
      return playerByIdentity.get(entityIdentityKey(entity)) ?? playerByUid.get(entity.uid);
    }

    function playerForHitTarget(hit: ModifierReplayHitState): HistoryPlayerRow | undefined {
      return playerByIdentity.get(hitTargetIdentityKey(hit)) ?? playerByUid.get(hit.targetUid);
    }

    function addValue(player: HistoryPlayerRow | undefined, relativeMs: number, value: number): void {
      if (!player || value <= 0) return;
      const key = playerIdentityKey(player);
      let buckets = bucketsByIdentity.get(key);
      if (!buckets) {
        buckets = Array.from({ length: bucketCount }, () => 0);
        bucketsByIdentity.set(key, buckets);
      }
      const bucketIndex = Math.min(bucketCount - 1, Math.floor(Math.max(0, relativeMs) / bucketMs));
      buckets[bucketIndex] = (buckets[bucketIndex] ?? 0) + value;
    }

    const useCombatTimeline = sourceEntities.some((entity) => (entity.combatTimeline?.length ?? 0) > 0);

    if (useCombatTimeline) {
      for (const entity of sourceEntities) {
        const sourcePlayer = playerForSourceEntity(entity);
        if (!sourcePlayer) continue;
        for (const bucket of entity.combatTimeline ?? []) {
          const value = combatTimelineMetricValue(bucket, metric);
          if (value <= 0) continue;
          if (
            metric === "damage" &&
            (overviewTargetUid !== null || overviewTargetUuid !== null) &&
            !targetMatchesIdentity(
              { targetUid: bucket.targetUid, targetUuid: bucket.targetUuid ?? null },
              overviewTargetUid,
              overviewTargetUuid,
            )
          ) {
            continue;
          }
          const relativeMs = combatTimelineRelativeMs(bucket, startMs, durationMs);
          addValue(sourcePlayer, relativeMs, value);
        }
      }
    } else {
      for (const entity of sourceEntities) {
        const sourcePlayer = metric === "tanked" ? undefined : playerForSourceEntity(entity);
        if (metric !== "tanked" && !sourcePlayer) continue;
        for (const hit of entity.modifierReplayHits ?? []) {
          const value = replayHitMetricValue(hit, metric);
          if (value <= 0) continue;
          if (
            metric === "damage" &&
            (overviewTargetUid !== null || overviewTargetUuid !== null) &&
            !targetMatchesIdentity(
              { targetUid: hit.targetUid, targetUuid: hit.targetUuid ?? null },
              overviewTargetUid,
              overviewTargetUuid,
            )
          ) {
            continue;
          }
          const relativeMs = replayHitRelativeMs(hit, startMs, durationMs);
          addValue(metric === "tanked" ? playerForHitTarget(hit) : sourcePlayer, relativeMs, value);
        }
      }
    }

    const rankedPlayerEntries = visiblePlayers
      .map((player) => {
        const buckets = bucketsByIdentity.get(playerIdentityKey(player)) ?? [];
        return {
          player,
          buckets,
          total: buckets.reduce((sum, value) => sum + value, 0),
        };
      })
      .filter((entry) => entry.total > 0)
      .sort((a, b) => b.total - a.total);

    const rankedPlayers = rankedPlayerEntries.slice(0, HISTORY_GRAPH_MAX_SERIES);

    const movingWindowMs = historyGraphMovingWindowMsSetting();
    const movingWindowBuckets = Math.max(1, Math.round(movingWindowMs / bucketMs));
    const buildRateEntry = <T extends { buckets: number[]; total: number }>(entry: T) => {
      let cumulativeTotal = 0;
      const overallRates = entry.buckets.map((value, index) => {
        cumulativeTotal += value;
        const bucketEndMs = Math.max(1, Math.min(durationMs, (index + 1) * bucketMs));
        return cumulativeTotal / (bucketEndMs / 1000);
      });
      const movingRates = entry.buckets.map((_value, index) => {
        const windowStartIndex = Math.max(0, index - movingWindowBuckets + 1);
        let windowTotal = 0;
        for (let bucketIndex = windowStartIndex; bucketIndex <= index; bucketIndex += 1) {
          windowTotal += entry.buckets[bucketIndex] ?? 0;
        }
        const windowStartMs = windowStartIndex * bucketMs;
        const windowEndMs = Math.max(1, Math.min(durationMs, (index + 1) * bucketMs));
        return windowTotal / (Math.max(1, windowEndMs - windowStartMs) / 1000);
      });
      const rawBucketRates = entry.buckets.map((value, index) => {
        const bucketStartMs = index * bucketMs;
        const bucketDurationMs = Math.max(1, Math.min(bucketMs, durationMs - bucketStartMs));
        return value / (bucketDurationMs / 1000);
      });
      return {
        ...entry,
        overallRates,
        movingRates,
        average: entry.total / Math.max(1, durationMs / 1000),
        peak: rawBucketRates.reduce((max, value) => Math.max(max, value), 0),
      };
    };
    const perSeriesRates = rankedPlayers.map(buildRateEntry);
    const teamBuckets = Array.from({ length: bucketCount }, (_unused, index) =>
      rankedPlayerEntries.reduce((sum, entry) => sum + (entry.buckets[index] ?? 0), 0),
    );
    const teamTotal = teamBuckets.reduce((sum, value) => sum + value, 0);
    const teamRateEntry = teamTotal > 0 ? buildRateEntry({ buckets: teamBuckets, total: teamTotal }) : null;
    const rateEntriesForScale = displayMode === "team" && teamRateEntry ? [teamRateEntry] : perSeriesRates;

    const rawMaxOverallValue = Math.max(
      1,
      ...rateEntriesForScale.flatMap((entry) => entry.overallRates),
    );
    const rawMaxMovingValue = Math.max(
      1,
      ...rateEntriesForScale.flatMap((entry) => entry.movingRates),
    );
    const overallScale = graphTickScale(rawMaxOverallValue);
    const movingScale = graphTickScale(rawMaxMovingValue);
    const maxOverallValue = overallScale.maxValue;
    const maxMovingValue = movingScale.maxValue;

    const buildPoints = (rates: number[], maxValue: number, panelTop: number) => [
      {
        timeMs: 0,
        value: 0,
        x: graphX(0, durationMs),
        y: graphY(0, maxValue, panelTop),
      },
      ...rates.map((value, index) => {
        const timeMs = Math.min(durationMs, (index + 1) * bucketMs);
        return {
          timeMs,
          value,
          x: graphX(timeMs, durationMs),
          y: graphY(value, maxValue, panelTop),
        };
      }),
    ];

    const series: HistoryGraphSeries[] = perSeriesRates.map((entry, index) => {
      const player = entry.player;
      const identityKey = playerIdentityKey(player);
      const sourceEntity = entityByIdentity.get(identityKey) ?? entityByUid.get(player.uid);
      const overallPoints = buildPoints(entry.overallRates, maxOverallValue, HISTORY_GRAPH_OVERALL_TOP);
      const movingAveragePoints = buildPoints(entry.movingRates, maxMovingValue, HISTORY_GRAPH_MOVING_TOP);
      return {
        key: identityKey,
        uid: player.uid,
        uuid: player.uuid ?? null,
        name: getDisplayName({
          player: {
            uid: player.uid,
            name: player.name,
            className: player.className,
            classSpecName: player.classSpecName,
          },
          showYourNameSetting: settings.state.history.general.showYourName,
          showOthersNameSetting: settings.state.history.general.showOthersName,
          isLocalPlayer: player.isLocalPlayer,
        }) || player.name || `#${player.uid}`,
        className: player.className,
        classSpecName: player.classSpecName,
        color: HISTORY_GRAPH_SERIES_COLORS[index % HISTORY_GRAPH_SERIES_COLORS.length]
          ?? "#22c55e",
        total: entry.total,
        average: entry.average,
        peak: entry.peak,
        overallPoints,
        movingAveragePoints,
        deathMarkers: (sourceEntity?.deaths ?? [])
          .map((record) => deathRelativeMs(record.deathTimestampMs, startMs, durationMs))
          .filter((value): value is number => value !== null),
      };
    });
    const teamSeries: HistoryGraphSeries | null = teamRateEntry
      ? {
          key: "__team__",
          uid: 0,
          uuid: null,
          name: t("detail.graphTeamSeries", "Team Total"),
          className: "",
          classSpecName: "",
          color: "#22d3ee",
          total: teamRateEntry.total,
          average: teamRateEntry.average,
          peak: teamRateEntry.peak,
          overallPoints: buildPoints(teamRateEntry.overallRates, maxOverallValue, HISTORY_GRAPH_OVERALL_TOP),
          movingAveragePoints: buildPoints(teamRateEntry.movingRates, maxMovingValue, HISTORY_GRAPH_MOVING_TOP),
          deathMarkers: [],
        }
      : null;

    const xTicks = graphTimeTicks(durationMs);

    return {
      metric,
      bucketMs,
      movingWindowMs,
      durationMs,
      maxOverallValue,
      maxMovingValue,
      total: teamSeries?.total ?? series.reduce((sum, row) => sum + row.total, 0),
      teamSeries,
      series,
      overallYTicks: [...overallScale.ticks].reverse(),
      movingYTicks: [...movingScale.ticks].reverse(),
      xTicks,
      minorXTicks: graphMinorTimeTicks(durationMs, xTicks),
    };
  }

  let historyGraphData = $derived.by(() =>
    buildHistoryGraphData(
      graphSourceEntities,
      displayedPlayers,
      historyGraphMetric,
      encounter,
      historyGraphDisplayMode,
    ),
  );

  function visibleHistoryGraphSeries(graph: HistoryGraphData | null): HistoryGraphSeries[] {
    if (!graph) return [];
    if (historyGraphDisplayMode === "team") return graph.teamSeries ? [graph.teamSeries] : [];
    return graph.series.filter((series) => !historyGraphHiddenSeries.has(series.key));
  }

  function historyGraphSeriesIsVisible(seriesKey: string): boolean {
    if (seriesKey === "__team__") return true;
    return !historyGraphHiddenSeries.has(seriesKey);
  }

  function toggleHistoryGraphSeries(seriesKey: string): void {
    if (seriesKey === "__team__") return;
    const next = new Set(historyGraphHiddenSeries);
    if (next.has(seriesKey)) {
      next.delete(seriesKey);
    } else {
      next.add(seriesKey);
    }
    historyGraphHiddenSeries = next;
  }

  function historyGraphLegendSeries(graph: HistoryGraphData | null): HistoryGraphSeries[] {
    if (!graph) return [];
    if (historyGraphDisplayMode === "team") return graph.teamSeries ? [graph.teamSeries] : [];
    return graph.series;
  }

  function pruneHistoryGraphHiddenSeries(graph: HistoryGraphData | null): void {
    if (!graph || historyGraphHiddenSeries.size === 0) return;
    const currentKeys = new Set(graph.series.map((series) => series.key));
    const next = new Set([...historyGraphHiddenSeries].filter((key) => currentKeys.has(key)));
    if (next.size !== historyGraphHiddenSeries.size) {
      historyGraphHiddenSeries = next;
    }
  }

  function flattenGrouping(grouping: {
    groups: RecountGroup[];
    ungrouped: SkillDisplayRow[];
  }): FlatSkillRow[] {
    const rows: FlatSkillRow[] = [];
    const topLevel = [
      ...grouping.groups.map(
        (group): { kind: "group"; row: RecountGroup } => ({ kind: "group", row: group }),
      ),
      ...grouping.ungrouped.map(
        (skill): { kind: "skill"; row: SkillDisplayRow } => ({ kind: "skill", row: skill }),
      ),
    ].sort((a, b) => b.row.totalDmg - a.row.totalDmg);

    for (const item of topLevel) {
      if (item.kind === "skill") {
        rows.push({
          kind: "skill",
          key: `u-${item.row.skillId}`,
          depth: 0,
          row: item.row,
        });
        continue;
      }

      const group = item.row;
      rows.push({
        kind: "group",
        key: `g-${group.recountId}`,
        depth: 0,
        row: group,
      });
      if (!expandedGroups.has(group.recountId)) continue;
      for (const skill of group.skills) {
        rows.push({
          kind: "skill",
          key: `gs-${group.recountId}-${skill.skillId}`,
          depth: 1,
          row: skill,
        });
      }
    }
    return rows;
  }

  let skillGrouping = $derived.by(() => {
    if (!selectedEntity) return { groups: [], ungrouped: [] };
    const durationSecs = Math.max(1, encounterDurationSeconds);
    if (skillType === "dps" && (selectedSkillTargetUid !== null || selectedSkillTargetUuid !== null) && selectedPlayer) {
      const targetStats = perTargetForPlayer(selectedPlayer)
        ?.dmgTargets.find((target) =>
          targetMatchesIdentity(target, selectedSkillTargetUid, selectedSkillTargetUuid),
        );
      if (!targetStats) return { groups: [], ungrouped: [] };
      return groupSkillsByRecount(
        targetStats.skills,
        durationSecs,
        targetStats.totalValue,
        [],
        [],
        [],
        [],
        { includeContributionSources: false },
      );
    }
    const skills =
      skillType === "heal"
        ? selectedEntity.healSkills
        : skillType === "tanked"
          ? selectedEntity.takenSkills
          : selectedEntity.dmgSkills;
    const parentTotal =
      skillType === "heal"
        ? selectedEntity.healing.total
        : skillType === "tanked"
          ? selectedEntity.taken.total
          : selectedEntity.damage.total;
    const groupingOptions: SkillGroupingOptions = { includeContributionSources: false };
    if (skillType === "tanked") {
      groupingOptions.runtimeSourceBySkillId = buildUniqueSkillSourceFallbacks(
        selectedEntity.takenPerSource,
        SETTINGS.live.general.state.language as LocaleCode,
      );
    }
    return groupSkillsByRecount(
      skills,
      durationSecs,
      parentTotal,
      [],
      [],
      [],
      [],
      groupingOptions,
    );
  });

  let flatSkillRows = $derived.by(() => flattenGrouping(skillGrouping));

  function hasModifierState(entity: HistoryEntityData | undefined): boolean {
    if (!entity) return false;
    return Boolean(
      entity.activeBuffs?.length
      || entity.activeFactorBuffs?.length
      || entity.activeEffectBuffs?.length
      || entity.modifierWindows?.length
      || entity.activeEffectSources?.length
      || entity.activeFactorItems?.length
      || entity.activePassiveSkills?.length
      || entity.activeProfessionSkills?.length
      || entity.activeProfessionTalents?.length,
    );
  }

  let modifierPlayers = $derived.by(() =>
    activeTab === "modifiers" && modifierReportsEnabled
      ? [...players]
          .filter((player) =>
            player.totalDmg > 0
            || hasModifierState(rawEntities.find((entity) =>
              entityMatchesIdentity(entity, player.uid, player.uuid ?? null),
            ))
          )
          .sort((left, right) => {
            if (left.isLocalPlayer !== right.isLocalPlayer) return left.isLocalPlayer ? -1 : 1;
            return right.totalDmg - left.totalDmg;
          })
      : [],
  );

  let selectedModifierPlayer = $derived.by(() => {
    if (modifierPlayers.length === 0) return null;
    if (modifierPlayerUid !== null || modifierPlayerUuid !== null) {
      const selected = modifierPlayers.find((player) =>
        playerMatchesIdentity(player, modifierPlayerUid, modifierPlayerUuid),
      );
      if (selected) return selected;
    }
    if (localPlayerUid !== null || localPlayerUuid !== null) {
      const local = modifierPlayers.find((player) =>
        playerMatchesIdentity(player, localPlayerUid, localPlayerUuid),
      );
      if (local) return local;
    }
    return modifierPlayers[0] ?? null;
  });

  let selectedModifierCacheKey = $derived.by(() =>
    modifierReportsEnabled && encounterId !== null && selectedModifierPlayer
      ? modifierCacheKey(encounterId, selectedModifierPlayer.uid, selectedModifierPlayer.uuid ?? null)
      : null,
  );

  let selectedModifierReportKey = $derived.by(() =>
    selectedModifierCacheKey ? modifierReportCacheKey(selectedModifierCacheKey) : null,
  );

  let modifierRawEntities = $derived.by(() =>
    selectedModifierCacheKey ? (modifierEntityCache[selectedModifierCacheKey] ?? []) : [],
  );

  let modifierEntitySource = $derived.by(() =>
    modifierRawEntities.length > 0 ? modifierRawEntities : rawEntities,
  );

  let selectedModifierEntity = $derived.by(() => {
    if (!selectedModifierPlayer) return null;
    return modifierEntitySource.find((entity) =>
      entityMatchesIdentity(entity, selectedModifierPlayer.uid, selectedModifierPlayer.uuid ?? null),
    ) ?? null;
  });

  let modifierRows = $derived.by(() =>
    modifierReportsEnabled && !hasSelectedChar && activeTab === "modifiers" && selectedModifierReportKey
      ? (modifierReportCache[selectedModifierReportKey] ?? [])
      : [],
  );

  function modifierSkillGroupKey(skill: ModifierActivitySkillRow): string {
    if (skill.recountId !== undefined) return `recount:${skill.recountId}`;
    return `skill:${skill.skillId}:${skill.damageIds.join(",")}`;
  }

  function normalizeModifierBreakdownSource(row: ModifierBreakdownRow, source: ModifierBreakdownSourceRow) {
    const cappedTotal = Math.min(source.totalDmg, row.totalDmg);
    const cappedEffectiveTotal = Math.min(source.effectiveTotal, row.effectiveTotal);
    const cappedHits = Math.min(source.hits, row.hits);
    const damageScale = source.totalDmg > 0 ? cappedTotal / source.totalDmg : 0;
    const hitScale = source.hits > 0 ? cappedHits / source.hits : 0;

    source.totalDmg = cappedTotal;
    source.effectiveTotal = cappedEffectiveTotal;
    if (source.estimatedContributionTotal !== undefined) {
      source.estimatedContributionTotal *= damageScale;
      source.estimatedContributionPct = displayPct(
        row.totalDmg > 0 ? (source.estimatedContributionTotal / row.totalDmg) * row.dmgPct : 0,
      );
    }
    source.dmgPct = displayPct(row.totalDmg > 0 ? (cappedTotal / row.totalDmg) * row.dmgPct : 0);
    source.sourcePct = displayPct(row.totalDmg > 0 ? (cappedTotal / row.totalDmg) * 100 : 0);
    source.dps *= damageScale;
    source.hits = cappedHits;
    source.hitsPerMinute *= hitScale;
  }

  function buildModifierBreakdownRows(rows: ModifierActivityRow[]): ModifierBreakdownRow[] {
    const bySkill = new Map<string, ModifierBreakdownRow>();
    const sourceKeysBySkill = new Map<string, Set<string>>();

    for (const source of rows) {
      for (const skill of source.skills) {
        const key = modifierSkillGroupKey(skill);
        let parent = bySkill.get(key);
        if (!parent) {
          parent = {
            key,
            rowKind: skill.rowKind,
            skillId: skill.skillId,
            ...(skill.recountId !== undefined ? { recountId: skill.recountId } : {}),
            name: skill.name,
            ...(skill.names ? { names: skill.names } : {}),
            damageIds: [...skill.damageIds],
            match: skill.match,
            totalDmg: skill.baseTotalDmg,
            effectiveTotal: skill.baseEffectiveTotal,
            dmgPct: skill.baseDmgPct,
            sourcePct: 100,
            coveragePct: 100,
            dps: skill.baseDps,
            hits: skill.baseHits,
            hitsPerMinute: skill.baseHitsPerMinute,
            critRate: skill.critRate,
            luckyRate: skill.luckyRate,
            sources: [],
          };
          bySkill.set(key, parent);
          sourceKeysBySkill.set(key, new Set<string>());
        } else if (skill.baseTotalDmg > parent.totalDmg) {
          parent.totalDmg = skill.baseTotalDmg;
          parent.effectiveTotal = skill.baseEffectiveTotal;
          parent.dmgPct = skill.baseDmgPct;
          parent.dps = skill.baseDps;
          parent.hits = skill.baseHits;
          parent.hitsPerMinute = skill.baseHitsPerMinute;
          parent.critRate = skill.critRate;
          parent.luckyRate = skill.luckyRate;
        }

        const seenSources = sourceKeysBySkill.get(key);
        if (seenSources?.has(source.key)) continue;
        seenSources?.add(source.key);
        parent.sources.push({
          key: `${key}:${source.key}`,
          source,
          sourceId: source.sourceId,
          sourceIds: [...source.sourceIds],
          sourceKind: source.sourceKind,
          ...(source.sourceType ? { sourceType: source.sourceType } : {}),
          ...(source.sourceEntityId !== undefined ? { sourceEntityId: source.sourceEntityId } : {}),
          sourceName: source.sourceName,
          ...(source.sourceNames ? { sourceNames: source.sourceNames } : {}),
          ...(source.displayOwnerKind ? { displayOwnerKind: source.displayOwnerKind } : {}),
          buffIds: [...source.buffIds],
          evidence: [...source.evidence],
          ...(source.attributionModel ? { attributionModel: source.attributionModel } : {}),
          actorSummary: source.actorSummary,
          targetDamageIds: [...source.targetDamageIds],
          targetRecountIds: [...source.targetRecountIds],
          match: skill.match,
          totalDmg: skill.totalDmg,
          effectiveTotal: skill.effectiveTotal,
          ...(skill.estimatedContributionTotal !== undefined
            ? { estimatedContributionTotal: skill.estimatedContributionTotal }
            : {}),
          ...(skill.estimatedContributionPct !== undefined
            ? { estimatedContributionPct: skill.estimatedContributionPct }
            : {}),
          ...(skill.estimatedContributionConfidence
            ? { estimatedContributionConfidence: skill.estimatedContributionConfidence }
            : {}),
          ...(source.formulaReplayModel ? { formulaReplayModel: source.formulaReplayModel } : {}),
          ...(skill.observedDmgPerHit !== undefined ? { observedDmgPerHit: skill.observedDmgPerHit } : {}),
          ...(skill.baselineDmgPerHit !== undefined ? { baselineDmgPerHit: skill.baselineDmgPerHit } : {}),
          ...(skill.baselineHits !== undefined ? { baselineHits: skill.baselineHits } : {}),
          dmgPct: skill.dmgPct,
          sourcePct: skill.sourcePct,
          coveragePct: skill.coveragePct,
          dps: skill.dps,
          hits: skill.hits,
          hitsPerMinute: skill.hitsPerMinute,
          critRate: skill.critRate,
          luckyRate: skill.luckyRate,
        });
      }
    }

    for (const row of bySkill.values()) {
      const directMatches = row.sources.filter((source) => source.match === "direct-static-target").length;
      row.match = directMatches === row.sources.length
          ? "direct-static-target"
          : directMatches === 0
            ? "no-static-target"
            : "mixed";
      for (const source of row.sources) {
        normalizeModifierBreakdownSource(row, source);
      }
      row.sources.sort((left, right) =>
        Number(right.match === "direct-static-target") - Number(left.match === "direct-static-target")
        || right.sourcePct - left.sourcePct
        || right.hits - left.hits
        || modifierSourceLabel(left.source, SETTINGS.live.general.state.language as LocaleCode)
          .localeCompare(modifierSourceLabel(right.source, SETTINGS.live.general.state.language as LocaleCode)),
      );
    }

    return [...bySkill.values()].sort((left, right) =>
      right.totalDmg - left.totalDmg
      || right.hits - left.hits
      || left.name.localeCompare(right.name),
    );
  }

  function isFullCoverage(value: number): boolean {
    return value >= 99.95;
  }

  let modifierBreakdownRows = $derived.by(() => buildModifierBreakdownRows(modifierRows));

  let visibleSkillFirstModifierRows = $derived.by(() => {
    if (!modifierHideFullCoverage) return modifierBreakdownRows;
    return modifierBreakdownRows
      .map((row) => ({
        ...row,
        sources: row.sources.filter((source) => !isFullCoverage(source.sourcePct)),
      }));
  });

  let visibleModifierActivityRows = $derived.by(() => {
    if (!modifierHideFullCoverage) return modifierRows;
    return modifierRows.filter((row) => !isFullCoverage(row.coveragePct));
  });

  function flattenSkillFirstModifierRows(rows: ModifierBreakdownRow[]): FlatModifierRow[] {
    const flattened: FlatModifierRow[] = [];
    for (const row of rows) {
      flattened.push({ kind: "skill", key: row.key, row });
      if (!expandedModifierRows.has(row.key)) continue;
      for (const source of row.sources) {
        flattened.push({
          kind: "source",
          key: source.key,
          skillKey: row.key,
          row: source,
        });
      }
    }
    return flattened;
  }

  function flattenModifierFirstRows(rows: ModifierActivityRow[]): FlatModifierRow[] {
    const flattened: FlatModifierRow[] = [];
    for (const row of rows) {
      flattened.push({ kind: "modifier", key: row.key, row });
      if (!expandedModifierRows.has(row.key)) continue;
      for (const skill of row.skills) {
        flattened.push({
          kind: "modifier-skill",
          key: `${row.key}:${skill.key}`,
          sourceKey: row.key,
          row: skill,
          source: row,
        });
      }
    }
    return flattened;
  }

  let visibleModifierRows = $derived.by(() =>
    modifierViewMode === "by-modifier" ? visibleModifierActivityRows : visibleSkillFirstModifierRows,
  );

  let flatModifierRows = $derived.by(() =>
    modifierViewMode === "by-modifier"
      ? flattenModifierFirstRows(visibleModifierActivityRows)
      : flattenSkillFirstModifierRows(visibleSkillFirstModifierRows),
  );

  let healTargetSummary = $derived.by(() => {
    if (!selectedPlayer || skillType !== "heal") return [] as PerTargetStats[];
    return [...(perTargetForPlayer(selectedPlayer)?.healTargets ?? [])]
      .map((target) => {
        const resolvedName = targetDisplayName(target);
        return resolvedName
          ? { ...target, targetName: resolvedName }
          : target;
      })
      .filter(
        (target) =>
          target.totalValue > 0 &&
          (!isNumericLikeName(target.targetName) ||
            pushedIdentitySet.has(targetIdentityKey(target)) ||
            pushedUidSet.has(target.targetUid)),
      )
      .sort((a, b) => b.totalValue - a.totalValue);
  });

  let healTargetTotal = $derived.by(() => {
    return healTargetSummary.reduce((sum, target) => sum + target.totalValue, 0);
  });

  function rowTotalDmg(row: FlatSkillRow): number {
    return row.row.totalDmg ?? 0;
  }

  function rowDmgPct(row: FlatSkillRow): number {
    return row.row.dmgPct ?? 0;
  }

  function skillCellValue(row: FlatSkillRow, key: string): number {
    const value = (row.row as Record<string, unknown>)[key];
    return typeof value === "number" ? value : 0;
  }

  let maxDpsPlayer = $derived.by(() => displayedPlayers.reduce((max, p) => Math.max(max, p.totalDmg || 0), 0));
  let maxHealPlayer = $derived.by(() => displayedPlayers.reduce((max, p) => Math.max(max, p.healDealt || 0), 0));
  let maxTankedPlayer = $derived.by(() => displayedPlayers.reduce((max, p) => Math.max(max, p.damageTaken || 0), 0));
  let maxSkillTotal = $derived.by(() => flatSkillRows.reduce((max, row) => Math.max(max, rowTotalDmg(row)), 0));
  let maxModifierTotal = $derived.by(() => visibleModifierRows.reduce((max, row) => Math.max(max, row.totalDmg), 0));

  // Get visible columns based on settings and active tab
  let visiblePlayerColumns = $derived.by(() => {
    if (activeTab === "healing") {
      return orderColumnsByKey(
        historyHealPlayerColumns,
        SETTINGS.history.columnOrder.healPlayers.state.order,
      ).filter(
        (col) =>
          SETTINGS.history.heal.players.state[
            col.key as keyof typeof SETTINGS.history.heal.players.state
          ] ?? true,
      );
    } else if (activeTab === "tanked") {
      return orderColumnsByKey(
        historyTankedPlayerColumns,
        SETTINGS.history.columnOrder.tankedPlayers.state.order,
      ).filter(
        (col) =>
          SETTINGS.history.tanked.players.state[
            col.key as keyof typeof SETTINGS.history.tanked.players.state
          ] ?? true,
      );
    }
    return orderColumnsByKey(
      historyDpsPlayerColumns,
      SETTINGS.history.columnOrder.dpsPlayers.state.order,
    ).filter((col) => {
      if (col.key === "effectiveTotal" || col.key === "effectiveDps") return false;
      if (overviewTargetUid !== null && (col.key === "bossDmg" || col.key === "bossDps")) return false;
      const defaultValue = DEFAULT_HISTORY_STATS[col.key as keyof typeof DEFAULT_HISTORY_STATS] ?? true;
      const setting =
        SETTINGS.history.dps.players.state[
          col.key as keyof typeof SETTINGS.history.dps.players.state
        ];
      return typeof setting === "boolean" ? setting : defaultValue;
    });
  });

  let visibleSkillColumns = $derived.by(() => {
    if (skillType === "heal") {
      return orderColumnsByKey(
        historyHealSkillColumns,
        SETTINGS.history.columnOrder.healSkills.state.order,
      ).filter(
        (col) =>
          SETTINGS.history.heal.skillBreakdown.state[
            col.key as keyof typeof SETTINGS.history.heal.skillBreakdown.state
          ] === true,
      );
    } else if (skillType === "tanked") {
      return orderColumnsByKey(
        historyTankedSkillColumns,
        SETTINGS.history.columnOrder.tankedSkills.state.order,
      ).filter(
        (col) =>
          SETTINGS.history.tanked.skillBreakdown.state[
            col.key as keyof typeof SETTINGS.history.tanked.skillBreakdown.state
          ] === true,
      );
    }
    return orderColumnsByKey(
      historyDpsSkillColumns,
      SETTINGS.history.columnOrder.dpsSkills.state.order,
    ).filter(
      (col) =>
        col.key !== "effectiveTotal" &&
        col.key !== "effectiveDps" &&
        SETTINGS.history.dps.skillBreakdown.state[
          col.key as keyof typeof SETTINGS.history.dps.skillBreakdown.state
        ] === true,
    );
  });

  let skillHitsColumnVisible = $derived.by(() =>
    visibleSkillColumns.some((col) => col.key === "hits"),
  );

  const websiteBaseUrl = $derived.by(() => {
    const apiBase = (SETTINGS.moduleSync.state.baseUrl || "").trim() || null;
    if (!apiBase) {
      return "https://bpsr.app";
    }

    try {
      const url = new URL(apiBase);
      if (url.hostname.startsWith("api.")) {
        url.hostname = url.hostname.replace(/^api\./, "");
      }
      url.pathname = "";
      return url.toString().replace(/\/$/, "");
    } catch (err) {
      console.error("Failed to parse website URL from API base:", apiBase, err);
      return "https://bpsr.app";
    }
  });
  let abbreviatedDecimalPlaces = $derived(
    SETTINGS.history.general.state.abbreviatedDecimalPlaces ?? 1,
  );

  function toggleGroup(id: number) {
    const next = new Set(expandedGroups);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    expandedGroups = next;
  }

  function toggleModifierRow(key: string) {
    const next = new Set(expandedModifierRows);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    expandedModifierRows = next;
  }

  function modifierSourceLabel(row: ModifierActivityRow, language: LocaleCode): string {
    const rowLabel = resolveModifierSourceName(row, language);
    const sourceIdBuffId = Number(row.sourceId.match(/^buff-source:(\d+)/)?.[1] ?? NaN);
    const placeholderBuffIds = [
      Number.isFinite(sourceIdBuffId) ? sourceIdBuffId : null,
      row.sourceEntityId,
      ...row.buffIds,
    ].filter((buffId): buffId is number =>
      typeof buffId === "number" && Number.isFinite(buffId) && buffId > 0
    );
    const isRawBuffSourceLabel = placeholderBuffIds.some((buffId) =>
      rowLabel === `buff-source:${buffId}`
        || rowLabel === `#${buffId}`
        || new RegExp(`^(?:Buff|Unmapped Buff) ${buffId}$`, "i").test(rowLabel)
    );

    if (!isRawBuffSourceLabel && (row.sourceNames || !/^(?:Buff \d+|Unknown Modifier)$/i.test(rowLabel))) {
      return rowLabel;
    }

    for (const buffId of placeholderBuffIds) {
      const localized = lookupBuffLocalizedNames(buffId);
      const fallback = lookupDefaultBuffName(buffId) ?? rowLabel;
      const label = resolveLocalizedText(localized, language, fallback).trim();
      if (label && label !== `#${buffId}`) return label;
    }

    return rowLabel;
  }

  function modifierSourceDisplayLabel(row: ModifierActivityRow, language: LocaleCode): string {
    const label = modifierSourceLabel(row, language);
    const providerSuffix = modifierExternalSourceInlineSuffix(row.actorSummary);
    return providerSuffix ? `${label} ${providerSuffix}` : label;
  }

  function modifierSourceUidLabel(row: ModifierActivityRow): string {
    if (row.sourceEntityId !== undefined && Number.isFinite(row.sourceEntityId)) {
      return `#${row.sourceEntityId}`;
    }
    const sourceIdBuffMatch = row.sourceId.match(/^buff-source:(\d+)/);
    if (sourceIdBuffMatch?.[1]) return `#${sourceIdBuffMatch[1]}`;
    return row.sourceId;
  }

  function shouldShowModifierSourceUid(row: ModifierActivityRow): boolean {
    return SETTINGS.live.general.state.skillIdDisplayMode === 'column'
      || /^buff-source:\d+/.test(row.sourceId);
  }

  function emptyModifierActorSummary(): ModifierActorSummary {
    return {
      hostUids: [],
      hostUuids: [],
      sourceUids: [],
      sourceUuids: [],
      externalSourceUids: [],
      externalSourceUuids: [],
      selfSourceUids: [],
      selfSourceUuids: [],
      sourceActors: [],
      externalSourceActors: [],
      selfSourceActors: [],
    };
  }

  function mergeModifierActors(left: ModifierSourceActor[], right: ModifierSourceActor[]): ModifierSourceActor[] {
    const byIdentity = new Map<string, ModifierSourceActor>();
    for (const actor of [...left, ...right]) {
      const uid = finitePositiveReportId(actor.uid);
      if (uid === null) continue;
      const uuid = finitePositiveReportId(actor.uuid);
      const identity = uuid !== null ? `uuid:${uuid}` : `uid:${uid}`;
      const previous = byIdentity.get(identity);
      const merged: ModifierSourceActor = {
        uid,
        ...(uuid !== null ? { uuid } : previous?.uuid !== undefined ? { uuid: previous.uuid } : {}),
        name: previous?.name && previous.name !== `#${uid}` ? previous.name : (actor.name || `#${uid}`),
        sourceConfigIds: [...new Set([...(previous?.sourceConfigIds ?? []), ...(actor.sourceConfigIds ?? [])])].sort((a, b) => a - b),
        baseIds: [...new Set([...(previous?.baseIds ?? []), ...(actor.baseIds ?? [])])].sort((a, b) => a - b),
      };
      const entityType = previous?.entityType ?? actor.entityType;
      const ownerUid = previous?.ownerUid ?? actor.ownerUid;
      const ownerUuid = previous?.ownerUuid ?? actor.ownerUuid;
      const ownerName = previous?.ownerName ?? actor.ownerName;
      if (entityType) merged.entityType = entityType;
      if (ownerUid !== undefined) merged.ownerUid = ownerUid;
      if (ownerUuid !== undefined) merged.ownerUuid = ownerUuid;
      if (ownerName) merged.ownerName = ownerName;
      byIdentity.set(identity, merged);
    }
    return [...byIdentity.values()].sort((leftActor, rightActor) =>
      leftActor.uid - rightActor.uid
      || (finitePositiveReportId(leftActor.uuid) ?? 0) - (finitePositiveReportId(rightActor.uuid) ?? 0)
    );
  }

  function mergeModifierActorSummaries(summaries: ModifierActorSummary[]): ModifierActorSummary {
    return summaries.reduce((summary, next) => ({
      hostUids: [...new Set([...summary.hostUids, ...(next.hostUids ?? [])])].sort((a, b) => a - b),
      hostUuids: [...new Set([...summary.hostUuids, ...(next.hostUuids ?? [])])].sort((a, b) => a - b),
      sourceUids: [...new Set([...summary.sourceUids, ...(next.sourceUids ?? [])])].sort((a, b) => a - b),
      sourceUuids: [...new Set([...summary.sourceUuids, ...(next.sourceUuids ?? [])])].sort((a, b) => a - b),
      externalSourceUids: [...new Set([...summary.externalSourceUids, ...(next.externalSourceUids ?? [])])].sort((a, b) => a - b),
      externalSourceUuids: [...new Set([...summary.externalSourceUuids, ...(next.externalSourceUuids ?? [])])].sort((a, b) => a - b),
      selfSourceUids: [...new Set([...summary.selfSourceUids, ...(next.selfSourceUids ?? [])])].sort((a, b) => a - b),
      selfSourceUuids: [...new Set([...summary.selfSourceUuids, ...(next.selfSourceUuids ?? [])])].sort((a, b) => a - b),
      sourceActors: mergeModifierActors(summary.sourceActors ?? [], next.sourceActors ?? []),
      externalSourceActors: mergeModifierActors(summary.externalSourceActors ?? [], next.externalSourceActors ?? []),
      selfSourceActors: mergeModifierActors(summary.selfSourceActors ?? [], next.selfSourceActors ?? []),
    }), emptyModifierActorSummary());
  }

  function modifierHasExternalSources(summary: ModifierActorSummary): boolean {
    return (summary.externalSourceUids?.length ?? 0) > 0
      || (summary.externalSourceUuids?.length ?? 0) > 0
      || (summary.externalSourceActors?.length ?? 0) > 0;
  }

  function modifierSourceActorLabel(actor: ModifierSourceActor): string {
    const uid = finitePositiveReportId(actor.uid) ?? 0;
    const idLabel = uid > 0 ? `#${uid}` : "#?";
    const name = actor.name?.trim();
    const actorLabel = name && name !== idLabel ? `${name} (${idLabel})` : `${t("detail.modifierLocalActor", "Local actor")} ${idLabel}`;
    const owner = actor.ownerName?.trim();
    const sourceIds = [...new Set([...(actor.sourceConfigIds ?? []), ...(actor.baseIds ?? [])])]
      .filter((id) => Number.isFinite(id) && id > 0)
      .sort((a, b) => a - b);
    const idSuffix = sourceIds.length > 0
      ? ` ${t("detail.modifierTitleBuffIds", "Buff IDs")}: ${sourceIds.map((id) => `#${id}`).join(", ")}`
      : "";
    if (owner && owner !== name) return `${owner} -> ${actorLabel}${idSuffix}`;
    return `${actorLabel}${idSuffix}`;
  }

  function modifierSourceActorDisplayName(actor: ModifierSourceActor): string {
    const uid = finitePositiveReportId(actor.uid) ?? 0;
    const idLabel = uid > 0 ? `#${uid}` : "#?";
    const owner = actor.ownerName?.trim();
    const name = actor.name?.trim();
    const displayName = owner && owner !== name ? owner : name;
    return displayName && displayName !== idLabel ? displayName : idLabel;
  }

  function modifierExternalSourceNames(summary: ModifierActorSummary, maxNames = 3): string[] {
    if (!modifierHasExternalSources(summary)) return [];
    const names: string[] = [];
    const seen = new Set<string>();
    for (const actor of summary.externalSourceActors ?? []) {
      const name = modifierSourceActorDisplayName(actor);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    if (names.length === 0) {
      for (const uid of summary.externalSourceUids ?? []) {
        const name = `#${uid}`;
        if (seen.has(name)) continue;
        seen.add(name);
        names.push(name);
      }
    }
    if (names.length === 0) {
      for (const uuid of summary.externalSourceUuids ?? []) {
        const name = `uuid:${uuid}`;
        if (seen.has(name)) continue;
        seen.add(name);
        names.push(name);
      }
    }
    if (names.length <= maxNames) return names;
    return [
      ...names.slice(0, maxNames),
      `+${names.length - maxNames}`,
    ];
  }

  function modifierExternalSourceInlineSuffix(summary: ModifierActorSummary): string {
    const names = modifierExternalSourceNames(summary);
    if (names.length === 0) return "";
    return `(${t("detail.modifierExternalFrom", "from")}: ${names.join(", ")})`;
  }

  function modifierExternalBadgeLabel(summary: ModifierActorSummary): string {
    const names = modifierExternalSourceNames(summary);
    if (names.length > 0) return `${t("detail.modifierExternalFrom", "from")}: ${names.join(", ")}`;
    return t("detail.modifierExternal", "External");
  }

  function modifierExternalBadgeTitle(summary: ModifierActorSummary): string {
    if (!modifierHasExternalSources(summary)) return "";
    const actors = summary.externalSourceActors ?? [];
    const lines = actors.length > 0
      ? actors.map(modifierSourceActorLabel)
      : [
          ...(summary.externalSourceUids ?? []).map((uid) => `${t("detail.modifierLocalActor", "Local actor")} #${uid}`),
          ...(summary.externalSourceUuids ?? []).map((uuid) => `${t("detail.modifierLocalActor", "Local actor")} uuid:${uuid}`),
        ];
    return `${t("detail.modifierTitleExternalSources", "External sources")}:\n${lines.join("\n")}`;
  }

  function hoverDescriptionsEnabled(): boolean {
    return SETTINGS.live.general.state.showHoverDescriptions !== false;
  }

  function shouldShowUidHover(): boolean {
    return SETTINGS.live.general.state.skillIdDisplayMode === 'hover' || hoverDescriptionsEnabled();
  }

  function modifierSkillLabel(
    row: {
      name: string;
      names?: ModifierActivitySkillRow["names"] | undefined;
      skillId: number;
      damageIds: number[];
    },
    language: LocaleCode,
  ): string {
    const generatedFallback = lookupDamageIdName(row.skillId);
    const fallback = !/^Skill \d+$/i.test(row.name)
      ? row.name
      : generatedFallback;
    const translated = resolveSkillTranslation(row.skillId, language, fallback);
    if (translated && translated !== fallback) return translated;

    const localized = resolveLocalizedText(row.names, language, fallback).trim();
    if (localized && !/^Skill \d+$/i.test(localized)) return localized;

    for (const damageId of row.damageIds) {
      const damageName = lookupDamageIdName(damageId);
      if (damageName && !/^Unknown \(/.test(damageName)) return damageName;
    }

    return localized || fallback;
  }

  function modifierMatchLabel(match: ModifierActivityRow["match"] | ModifierActivitySkillRow["match"]): string {
    if (match === "direct-static-target") return t("detail.modifierTargeted", "Targeted");
    if (match === "mixed") return t("detail.modifierMixed", "Mixed");
    return t("detail.modifierActive", "Active");
  }

  function modifierAttributionLabel(model: ModifierActivityRow["attributionModel"]): string {
    switch (model?.status) {
      case "formula-ready-candidate":
        return t("detail.modifierAttributionFormula", "Formula");
      case "uptime-only":
        return t("detail.modifierAttributionUptime", "Uptime");
      case "runtime-only":
        return t("detail.modifierAttributionRuntime", "Runtime");
      case "proc-damage":
        return t("detail.modifierAttributionProc", "Proc");
      case "timing-only":
        return t("detail.modifierAttributionTiming", "Timing");
      case "defensive-or-non-damage":
        return t("detail.modifierAttributionNonDamage", "Non-DMG");
      case "needs-source-localization":
        return t("detail.modifierAttributionNeedsName", "Needs name");
      case "needs-component-classification":
        return t("detail.modifierAttributionNeedsMap", "Needs map");
      case "mixed":
        return t("detail.modifierAttributionMixed", "Mixed model");
      default:
        return t("detail.modifierAttributionUnknown", "Unknown");
    }
  }

  function modifierAttributionClass(model: ModifierActivityRow["attributionModel"]): string {
    switch (model?.status) {
      case "formula-ready-candidate":
        return "border-sky-400/35 bg-sky-400/10 text-sky-200";
      case "proc-damage":
      case "timing-only":
        return "border-amber-400/35 bg-amber-400/10 text-amber-200";
      case "defensive-or-non-damage":
        return "border-muted-foreground/30 bg-muted/20 text-muted-foreground";
      case "needs-source-localization":
      case "needs-component-classification":
        return "border-red-400/35 bg-red-400/10 text-red-200";
      default:
        return "border-border/50 bg-background/60 text-muted-foreground";
    }
  }

  function modifierFormulaReplayLabel(model: ModifierActivityRow["formulaReplayModel"]): string {
    switch (model?.status) {
      case "counterfactual-replayed":
        return t("detail.modifierFormulaReplayCounterfactual", "Replayed");
      case "ready-for-replay":
        return t("detail.modifierFormulaReplayReady", "Replay ready");
      case "aggregate-only":
        return t("detail.modifierFormulaReplayAggregate", "Aggregate only");
      case "blocked-missing-evidence":
        return t("detail.modifierFormulaReplayBlocked", "Replay blocked");
      default:
        return t("detail.modifierFormulaReplay", "Replay");
    }
  }

  function modifierFormulaReplayClass(model: ModifierActivityRow["formulaReplayModel"]): string {
    switch (model?.status) {
      case "counterfactual-replayed":
      case "ready-for-replay":
        return "border-emerald-400/35 bg-emerald-400/10 text-emerald-200";
      case "aggregate-only":
        return "border-amber-400/35 bg-amber-400/10 text-amber-200";
      case "blocked-missing-evidence":
        return "border-red-400/35 bg-red-400/10 text-red-200";
      default:
        return "border-border/50 bg-background/60 text-muted-foreground";
    }
  }

  function modifierFormulaReplayTitle(model: ModifierActivityRow["formulaReplayModel"]): string {
    if (!model) return "";
    return [
      `${t("detail.modifierFormulaReplay", "Formula replay")}: ${modifierFormulaReplayLabel(model)}`,
      `${t("detail.modifierFormulaReplayBuckets", "Buckets")}: ${model.singleHitBucketCount}/${model.bucketCount} ${t("detail.modifierFormulaReplaySingleHitBuckets", "single-hit")}, ${formatModifierCount(model.hitCount)} ${t("detail.modifierFormulaReplayHits", "hits")}`,
      model.mixedCritBucketCount > 0
        ? `${t("detail.modifierFormulaReplayMixedCrit", "Mixed crit buckets")}: ${formatModifierCount(model.mixedCritBucketCount)}`
        : "",
      model.mixedLuckyBucketCount > 0
        ? `${t("detail.modifierFormulaReplayMixedLucky", "Mixed lucky buckets")}: ${formatModifierCount(model.mixedLuckyBucketCount)}`
        : "",
      model.availableEvidence.length > 0
        ? `${t("detail.modifierFormulaReplayAvailable", "Available evidence")}: ${model.availableEvidence.join(", ")}`
        : "",
      model.missingEvidence.length > 0
        ? `${t("detail.modifierFormulaReplayMissing", "Missing evidence")}: ${model.missingEvidence.join(", ")}`
        : "",
      model.blockers.length > 0
        ? `${t("detail.modifierFormulaReplayBlockers", "Blockers")}: ${model.blockers.join("; ")}`
        : "",
      model.formulaTermIds?.length
        ? `${t("detail.modifierTitleFormulaTerms", "Formula terms")}: ${model.formulaTermIds.join(", ")}`
        : "",
      model.formulaZoneIds?.length
        ? `${t("detail.modifierTitleFormulaZones", "Formula zones")}: ${model.formulaZoneIds.join(", ")}`
        : "",
      model.contributionGroups?.length
        ? `${t("detail.modifierTitleContributionGroups", "Contribution groups")}: ${model.contributionGroups.join(", ")}`
        : "",
      model.predicateTags?.length
        ? `${t("detail.modifierTitlePredicates", "Predicates")}: ${model.predicateTags.join(", ")}`
        : "",
      model.replayedContributionTotal !== undefined
        ? `${t("detail.modifierEstimatedGain", "Est. gain")}: ${formatModifierCount(model.replayedContributionTotal)}`
        : "",
      model.counterfactualTotal !== undefined
        ? `Counterfactual total: ${formatModifierCount(model.counterfactualTotal)}`
        : "",
      model.replayedComponents?.length
        ? `Replayed components: ${model.replayedComponents.map((component) =>
            `${component.label ?? component.componentKey ?? "component"} ${component.decimalValue !== undefined ? `${(component.decimalValue * 100).toFixed(1)}% ` : ""}${formatModifierCount(component.contributionTotal)}`
          ).join("; ")}`
        : "",
      model.skippedReplayComponents?.length
        ? `Skipped replay components: ${model.skippedReplayComponents.join("; ")}`
        : "",
      model.notes?.length ? model.notes.join("\n") : "",
    ].filter(Boolean).join("\n");
  }

  type ModifierEffectPattern = {
    key: string;
    label: string;
    patterns: RegExp[];
  };

  type ModifierAttributionComponent = NonNullable<NonNullable<ModifierActivityRow["attributionModel"]>["components"]>[number];

  const modifierEffectPatterns: ModifierEffectPattern[] = [
    { key: "critDmg", label: "Crit DMG", patterns: [/\bcrit(?:ical)?\s+dmg\b/i, /\bcritical\s+damage\b/i] },
    { key: "critRate", label: "Crit Rate", patterns: [/\bcrit(?:ical)?\s+(?:rate|chance)\b/i, /\bchance\s+to\s+crit\b/i] },
    { key: "atkSpd", label: "Attack SPD", patterns: [/\battack\s+sp(?:d|eed)\b/i] },
    { key: "animation", label: "Animation", patterns: [/\banimation(?:\s+speed)?\b/i] },
    { key: "haste", label: "Haste", patterns: [/\bhaste\b/i] },
    { key: "mastery", label: "Mastery", patterns: [/\bmastery\b/i] },
    { key: "versatility", label: "Versatility", patterns: [/\bversatility\b/i] },
    { key: "luck", label: "Luck", patterns: [/\bluck(?:y)?\b/i] },
    { key: "atkMatk", label: "ATK/MATK", patterns: [/\batk\s*\/\s*matk\b/i] },
    { key: "matk", label: "MATK", patterns: [/\bmatk\b/i] },
    { key: "atk", label: "ATK", patterns: [/\batk\b/i, /\battack\b/i] },
    { key: "eliteDmg", label: "Elite DMG", patterns: [/\bdmg\s+to\s+elites?\b/i, /\bdamage\s+(?:dealt\s+)?to\s+elites?\b/i, /\belites?\s+or\s+stronger\b/i] },
    { key: "elementDmg", label: "Element DMG", patterns: [/\belement(?:al)?\s+dmg\b/i, /\ball\s+element\b/i, /\b(?:light|dark|fire|flame|ice|wind|earth|thunder|water)\s+strength\b/i] },
    { key: "genericDmg", label: "DMG", patterns: [/\bdmg\b/i, /\bdamage\b/i] },
    { key: "armor", label: "Armor", patterns: [/\barmor\b/i] },
    { key: "resistance", label: "Resistance", patterns: [/\bresistance\b/i] },
    { key: "cooldown", label: "CD", patterns: [/\b(?:skill\s+)?cds?\b/i, /\bcooldowns?\b/i] },
  ];

  function clauseEffectValue(clause: string): string {
    const value = clause.match(/[+-]?\s*\d+(?:\.\d+)?\s*%\s*\+\s*[+-]?\s*\d+(?:\.\d+)?|[+-]?\s*\d+(?:\.\d+)?\s*%|[+-]\s*\d+(?:\.\d+)?/);
    return value?.[0]?.replace(/\s+/g, "") ?? "";
  }

  function modifierDescriptionEffectSummary(row: ModifierActivityRow, language: LocaleCode): string[] {
    const description = resolveModifierSourceDescription(row, language)
      || resolveModifierSourceDescription(row, "en");
    if (!description) return [];

    const effects = new Map<string, string>();
    const clauses = description
      .replace(/<br\s*\/?>/gi, ". ")
      .replace(/\s+/g, " ")
      .split(/(?:[.;]|\n)+/)
      .map((clause) => clause.trim())
      .filter(Boolean);

    for (const clause of clauses) {
      const matchedKeys = new Set<string>();
      for (const pattern of modifierEffectPatterns) {
        if (!pattern.patterns.some((item) => item.test(clause))) continue;
        matchedKeys.add(pattern.key);
      }
      if (matchedKeys.size === 0) continue;
      if (matchedKeys.size > 1 && matchedKeys.has("genericDmg")) {
        matchedKeys.delete("genericDmg");
      }

      const value = clauseEffectValue(clause);
      for (const pattern of modifierEffectPatterns) {
        if (!matchedKeys.has(pattern.key) || effects.has(pattern.key)) continue;
        effects.set(pattern.key, value ? `${pattern.label} ${value}` : pattern.label);
      }
    }

    return [...effects.values()].slice(0, 4);
  }

  function componentEffectLabel(component: ModifierAttributionComponent): string {
    if (component.stat?.trim()) return component.stat.trim();
    if (component.label?.trim()) return component.label.trim();
    const formulaTerm = component.formulaTermIds?.[0];
    if (formulaTerm === "critMultiplier") return "Crit";
    if (formulaTerm === "genericDamagePct") return "DMG";
    if (formulaTerm === "elementalDamagePct") return "Element DMG";
    if (formulaTerm === "versatilityDamagePct") return "Versatility";
    if (formulaTerm === "physicalMagicEnhancementPct") return "Phys/Magic";
    if (formulaTerm === "finalDamagePct") return "Final DMG";
    if (formulaTerm === "seasonDamagePct") return "Season DMG";
    if (formulaTerm === "seasonSuppressionPct") return "Season Suppression";
    if (formulaTerm === "resistance") return "Resistance";
    if (formulaTerm === "armor") return "Armor";
    if (component.effectClass?.trim()) {
      return component.effectClass.replace(/[-_]+/g, " ").replace(/\b\w/g, (value: string) => value.toUpperCase());
    }
    return "";
  }

  function modifierAttributionEffectSummary(model: ModifierActivityRow["attributionModel"]): string[] {
    const labels = new Map<string, string>();
    for (const component of model?.components ?? []) {
      const label = componentEffectLabel(component);
      if (!label) continue;
      const key = label.trim().toLowerCase();
      if (labels.has(key)) continue;
      const values = [...new Set((component.valueTexts ?? []).map((value) => value.trim()).filter(Boolean))];
      labels.set(key, values.length === 1 ? `${label} ${values[0]}` : label);
    }
    return [...labels.values()].slice(0, 4);
  }

  function modifierEffectSummary(row: ModifierActivityRow, language: LocaleCode): string {
    const descriptionSummary = modifierDescriptionEffectSummary(row, language);
    const pieces = descriptionSummary.length > 0
      ? descriptionSummary
      : modifierAttributionEffectSummary(row.attributionModel);
    return pieces.join(" / ");
  }

  function modifierEffectSummaryTitle(row: ModifierActivityRow, language: LocaleCode): string {
    const summary = modifierEffectSummary(row, language);
    if (!summary) return "";
    return summary;
  }

  function modifierAttributionTitle(model: ModifierActivityRow["attributionModel"]): string {
    if (!model) return "";
    return [
      `${t("detail.modifierTitleAttribution", "Attribution")}: ${modifierAttributionLabel(model)}`,
      model.damageFormulaId ? `${t("detail.modifierTitleFormula", "Formula")}: ${model.damageFormulaId}` : "",
      model.formulaTermIds?.length
        ? `${t("detail.modifierTitleFormulaTerms", "Formula terms")}: ${model.formulaTermIds.join(", ")}`
        : "",
      model.contributionGroups?.length
        ? `${t("detail.modifierTitleContributionGroups", "Contribution groups")}: ${model.contributionGroups.join(", ")}`
        : "",
      model.predicateTags?.length
        ? `${t("detail.modifierTitlePredicates", "Predicates")}: ${model.predicateTags.join(", ")}`
        : "",
      model.requiredRuntimeEvidence?.length
        ? `${t("detail.modifierTitleRequiredEvidence", "Required evidence")}: ${model.requiredRuntimeEvidence.join(", ")}`
        : "",
      model.notes?.length
        ? `${t("detail.modifierTitleAttributionNotes", "Attribution notes")}: ${model.notes.join(" ")}`
        : "",
    ].filter(Boolean).join("\n");
  }

  function formatModifierDurationMs(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "0s";
    const seconds = value / 1000;
    if (seconds >= 60) return `${(seconds / 60).toFixed(1)}m`;
    return `${seconds.toFixed(1)}s`;
  }

  function modifierTimingTitle(model: ModifierActivityRow["timingModel"]): string {
    if (!model) return "";
    return [
      `${t("detail.modifierTimingModel", "Timing model")}: ${t("detail.modifierTimingCooldownAcceleration", "Cooldown acceleration")}`,
      `${t("detail.modifierTimingStatus", "Status")}: ${model.status}`,
      `${t("detail.modifierTimingCooldownEvents", "Cooldown starts")}: ${formatModifierCount(model.cooldownEvents)}`,
      `${t("detail.modifierTimingCastEvents", "Cast markers")}: ${formatModifierCount(model.castEventsDuringWindow)}`,
      model.totalDirectReductionMs > 0
        ? `${t("detail.modifierTimingDirectReduction", "Direct CD reduction")}: ${formatModifierDurationMs(model.totalDirectReductionMs)}`
        : "",
      model.totalAccelerationOpportunityMs > 0
        ? `${t("detail.modifierTimingAccelerationSaved", "Acceleration time saved")}: ${formatModifierDurationMs(model.totalAccelerationOpportunityMs)}`
        : "",
      model.totalTimeSavedMs > 0
        ? `${t("detail.modifierTimingTotalSaved", "Total cooldown time saved")}: ${formatModifierDurationMs(model.totalTimeSavedMs)}`
        : "",
      model.extraCastOpportunity > 0
        ? `${t("detail.modifierTimingExtraCasts", "Extra cast opportunity")}: ${model.extraCastOpportunity.toFixed(2)}`
        : "",
      model.estimatedOpportunityDamage !== undefined
        ? `${t("detail.modifierTimingOpportunityDamage", "Opportunity damage")}: ${formatModifierCount(model.estimatedOpportunityDamage)}`
        : "",
      model.averageAccelerateRate > 0
        ? `${t("detail.modifierTimingAverageRate", "Average acceleration")}: ${(model.averageAccelerateRate * 100).toFixed(1)}%`
        : "",
      model.affectedSkillIds.length > 0
        ? `${t("detail.modifierTimingAffectedSkills", "Affected skill IDs")}: ${model.affectedSkillIds.map((id) => `#${id}`).join(", ")}`
        : "",
      model.notes.length > 0 ? model.notes.join("\n") : "",
    ].filter(Boolean).join("\n");
  }

  function modifierSourceTitle(row: ModifierActivityRow, language: LocaleCode): string {
    const effectSummary = modifierEffectSummary(row, language);
    const description = hoverDescriptionsEnabled()
      ? resolveModifierSourceDescription(row, language)
      : "";
    return [
      modifierSourceDisplayLabel(row, language),
      effectSummary ? effectSummary : "",
      description ? `${t("detail.modifierTitleDescription", "Description")}:\n${description}` : "",
      row.sourceIds.length > 1
        ? `${t("detail.modifierTitleSources", "Sources")}: ${row.sourceIds.join(", ")}`
        : `${t("detail.modifierTitleSource", "Source")}: ${row.sourceId}`,
      row.sourceType ? `${t("detail.modifierTitleType", "Type")}: ${row.sourceType}` : "",
      Number.isFinite(row.coveragePct)
        ? `${t("detail.modifierTitleObservedCoverage", "Observed coverage")}: ${row.coveragePct.toFixed(1)}%`
        : "",
      modifierTimingTitle(row.timingModel),
      modifierFormulaReplayTitle(row.formulaReplayModel),
      row.estimatedContributionTotal !== undefined
        ? `${t("detail.modifierEstimatedGain", "Est. gain")}: ${formatModifierCount(row.estimatedContributionTotal)}`
        : "",
      modifierAttributionTitle(row.attributionModel),
      row.buffIds.length > 0 ? `${t("detail.modifierTitleBuffIds", "Buff IDs")}: ${row.buffIds.map((id) => `#${id}`).join(", ")}` : "",
      row.targetDamageIds.length > 0
        ? `${t("detail.modifierTitleTargetDamageIds", "Target damage IDs")}: ${row.targetDamageIds.map((id) => `#${id}`).join(", ")}`
        : "",
      row.targetRecountIds.length > 0
        ? `${t("detail.modifierTitleTargetRecountIds", "Target recount IDs")}: ${row.targetRecountIds.map((id) => `#${id}`).join(", ")}`
        : "",
      modifierHasExternalSources(row.actorSummary)
        ? modifierExternalBadgeTitle(row.actorSummary)
        : "",
      row.evidence.length > 0 ? `${t("detail.modifierTitleEvidence", "Evidence")}: ${row.evidence.join(", ")}` : "",
    ].filter(Boolean).join("\n");
  }

  function modifierSkillIconPath(row: Pick<ModifierBreakdownRow, "rowKind" | "recountId" | "skillId">): string | undefined {
    if (row.rowKind === "recount" && row.recountId !== undefined) {
      return lookupRecountGroupIconPath(row.recountId);
    }
    return lookupSkillBreakdownIconPath(row.skillId);
  }

  function buffIconPath(buffIds: number[]): string | undefined {
    for (const buffId of buffIds) {
      const spriteFile = lookupBuffMeta(buffId)?.spriteFile;
      if (spriteFile) return `/images/buff/${spriteFile}`;
    }
    return undefined;
  }

  function modifierSourceIconPath(row: ModifierActivityRow): string | undefined {
    return resolveStaticIconUrl(row.iconPath) ?? buffIconPath(row.buffIds);
  }

  function historySkillIconPath(item: FlatSkillRow): string | undefined {
    if (item.kind === "group") {
      return lookupRecountGroupIconPath(item.row.recountId);
    }
    return lookupSkillBreakdownIconPath(item.row.skillId);
  }

  function historyGroupLabel(row: RecountGroup, language: LocaleCode): string {
    return resolveRecountGroupName(row.recountId, language, row.recountName);
  }

  function historySkillLabel(row: SkillDisplayRow, language: LocaleCode): string {
    if (row.details) {
      return resolveSkillBreakdownName(row, language);
    }
    return resolveSkillTranslation(row.skillId, language, row.name);
  }

  function sharedDpsLabel(key: string, language: LocaleCode, fallback: string): string {
    return resolveNavigationTranslation(key, language, fallback);
  }

  function normalizeDisplayLabel(value: string): string {
    return value.replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toLowerCase();
  }

  function historySkillDetailLabel(row: SkillDisplayRow, language: LocaleCode): string {
    if (!row.details) return "";
    const detail = resolveSkillBreakdownDetailName(row, language, {
      baseSkillLabel: sharedDpsLabel("detail.skillBreakdown.baseSkill", language, "Base skill"),
    }).trim();
    const label = historySkillLabel(row, language);
    if (!detail || normalizeDisplayLabel(detail) === normalizeDisplayLabel(label)) return "";
    return detail;
  }

  function historyHitCountLabel(hits: number): string {
    const language = SETTINGS.live.general.state.language as LocaleCode;
    const roundedCount = Math.round(Number(hits) || 0);
    const count = roundedCount.toLocaleString(language);
    const fallback = sharedDpsLabel("detail.skillHitCount", language, "{count} hits");
    const key = roundedCount === 1
      ? "detail.skillHitCount.one"
      : "detail.skillHitCount.other";
    return sharedDpsLabel(key, language, fallback).replace("{count}", count);
  }

  function localizedDamageColumnValue(
    col: { key: string; format: (value: number | null) => string },
    rawValue: unknown,
  ): string {
    const value = typeof rawValue === "number" ? rawValue : null;
    const fallback = col.format(value);
    const labelKey = col.key === "property"
      ? propertyLabelKey(value)
      : col.key === "damageMode"
        ? damageModeLabelKey(value)
        : undefined;
    if (!labelKey) return fallback;
    return sharedDpsLabel(labelKey, SETTINGS.live.general.state.language as LocaleCode, fallback);
  }

  function modifierSkillTitle(row: Pick<ModifierBreakdownRow, "name" | "names" | "recountId" | "skillId" | "damageIds" | "match">, language: LocaleCode): string {
    return [
      modifierSkillLabel(row, language),
      row.recountId !== undefined
        ? `${t("detail.modifierTitleRecount", "Recount")}: #${row.recountId}`
        : `${t("detail.modifierTitleSkill", "Skill")}: #${row.skillId}`,
      row.damageIds.length > 0 ? `${t("detail.modifierTitleDamageIds", "Damage IDs")}: ${row.damageIds.map((id) => `#${id}`).join(", ")}` : "",
      `${t("detail.modifierTitleMatch", "Match")}: ${modifierMatchLabel(row.match)}`,
    ].filter(Boolean).join("\n");
  }

  function modifierBreakdownExternalSummary(row: ModifierBreakdownRow): ModifierActorSummary {
    return mergeModifierActorSummaries(row.sources.map((source) => source.actorSummary));
  }

  function formatModifierCount(value: number): string {
    return Math.round(value).toLocaleString();
  }

  function modifierTimingModelFromItem(item: FlatModifierRow): ModifierActivityRow["timingModel"] {
    if (item.kind === "modifier") return item.row.timingModel;
    if (item.kind === "modifier-skill") return item.source.timingModel;
    if (item.kind === "source") return item.row.source.timingModel;
    return undefined;
  }

  function modifierFormulaReplayModelFromItem(item: FlatModifierRow): ModifierActivityRow["formulaReplayModel"] {
    if (item.kind === "modifier") return item.row.formulaReplayModel;
    if (item.kind === "modifier-skill") return item.row.formulaReplayModel ?? item.source.formulaReplayModel;
    if (item.kind === "source") return item.row.formulaReplayModel ?? item.row.source.formulaReplayModel;
    return undefined;
  }

  function modifierEstimatedGain(item: FlatModifierRow): number | null {
    const value = item.row.estimatedContributionTotal;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (item.kind !== "modifier") return null;
    const opportunityDamage = modifierTimingModelFromItem(item)?.estimatedOpportunityDamage;
    return typeof opportunityDamage === "number" && Number.isFinite(opportunityDamage) && opportunityDamage > 0
      ? opportunityDamage
      : null;
  }

  function modifierEstimatedGainTitle(item: FlatModifierRow): string {
    const timingModel = modifierTimingModelFromItem(item);
    const formulaReplayModel = modifierFormulaReplayModelFromItem(item);
    if (
      item.row.estimatedContributionTotal === undefined
      && timingModel?.estimatedOpportunityDamage !== undefined
    ) {
      return modifierTimingTitle(timingModel);
    }
    const gain = modifierEstimatedGain(item);
    if (gain === null) {
      return modifierTimingTitle(timingModel)
        || modifierFormulaReplayTitle(formulaReplayModel)
        || t("detail.modifierEstimatedGainUnavailable", "No matching outside-window baseline.");
    }
    const row = item.row;
    return [
      `${t("detail.modifierEstimatedGain", "Est. gain")}: ${formatModifierCount(gain)}`,
      row.estimatedContributionPct !== undefined
        ? `${t("detail.encounterPct", "Encounter %")}: ${displayPct(row.estimatedContributionPct).toFixed(1)}%`
        : "",
      row.estimatedContributionConfidence
        ? `${t("detail.modifierEstimatedGainConfidence", "Confidence")}: ${row.estimatedContributionConfidence}`
        : "",
      row.observedDmgPerHit !== undefined
        ? `${t("detail.modifierEstimatedGainObservedHit", "Observed / hit")}: ${formatModifierCount(row.observedDmgPerHit)}`
        : "",
      row.baselineDmgPerHit !== undefined
        ? `${t("detail.modifierEstimatedGainBaselineHit", "Baseline / hit")}: ${formatModifierCount(row.baselineDmgPerHit)}`
        : "",
      row.baselineHits !== undefined
        ? `${t("detail.modifierEstimatedGainBaselineHits", "Baseline hits")}: ${formatModifierCount(row.baselineHits)}`
        : "",
    ].filter(Boolean).join("\n");
  }

  function displayPct(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 99.95) return 100;
    return Math.min(100, value);
  }

  function modifierGlowPercentage(item: FlatModifierRow): number {
    if (item.kind === "source" || item.kind === "modifier-skill") return displayPct(item.row.sourcePct);
    if (SETTINGS.history.general.state.relativeToTopDPSSkill && maxModifierTotal > 0) {
      return displayPct((item.row.totalDmg / maxModifierTotal) * 100);
    }
    return displayPct(item.row.dmgPct);
  }

  function modifierSourceShare(item: FlatModifierRow): number {
    if (item.kind === "source" || item.kind === "modifier-skill") return displayPct(item.row.sourcePct);
    if (item.kind === "modifier") return displayPct(item.row.coveragePct);
    return 100;
  }

  async function loadEncounter() {
    const currentEncounterId = encounterId;
    if (!currentEncounterId) return;
    const token = ++encounterLoadToken;
    const startedAt = historyPerfNow();
    error = null;
    localPlayerUid = null;
    localPlayerUuid = null;
    encounterEntitiesLoading = false;
    targetDetailsLoading = false;
    targetDetailsRequestedEncounterId = null;
    targetDetailsLoadedEncounterId = null;
    expandedGroups = new Set<number>();
    expandedModifierRows = new Set<string>();
    modifierExpansionSeed = "";
    modifierEntityCache = {};
    modifierReportCache = {};
    modifierEntitiesError = null;
    modifierReportError = null;
    modifierReportErrorKey = null;
    modifierEntitiesLoading = false;
    modifierReportLoading = false;
    modifierEntitiesLoadingKey = null;
    modifierReportLoadingKey = null;
    graphEntities = null;
    graphEntitiesEncounterId = null;
    graphEntitiesLoading = false;
    graphEntitiesError = null;
    targetDetailsLoadToken++;
    modifierEntitiesLoadToken++;
    modifierReportLoadToken++;
    graphEntitiesLoadToken++;
    try {
      logHistoryTiming("encounter load start", { encounterId: currentEncounterId });
      const encounterStartedAt = historyPerfNow();
      const encounterRes = await commands.getEncounterById(currentEncounterId).then((result) => {
        logHistoryTiming("encounter summary loaded", {
          encounterId: currentEncounterId,
          ms: historyLoadMs(encounterStartedAt),
          status: result.status,
        });
        return result;
      });
      if (token !== encounterLoadToken) return;

      if (encounterRes.status !== "ok") {
        error = String(encounterRes.error);
        return;
      }
      encounter = encounterRes.data;
      localPlayerUid =
        (encounterRes.data as { localPlayerId?: number | null }).localPlayerId ??
        null;
      localPlayerUuid = encounterRes.data.localPlayerUuid ?? null;
      rawEntities = [];
      players = [];
      encounterEntitiesLoading = true;
      await tick();
      await waitForHistoryPaint();

      const entitiesStartedAt = historyPerfNow();
      const entitiesRes = await commands.getEncounterEntitiesCompactRaw(currentEncounterId).then((result) => {
        logHistoryTiming("encounter compact entities loaded", {
          encounterId: currentEncounterId,
          ms: historyLoadMs(entitiesStartedAt),
          status: result.status,
          rows: result.status === "ok" ? result.data.length : 0,
        });
        return result;
      });

      if (token !== encounterLoadToken) return;
      if (entitiesRes.status !== "ok") {
        error = String(entitiesRes.error);
        return;
      }
      rawEntities = entitiesRes.data;
      const durationSeconds =
        encounterRes.data.duration > 0
          ? Math.max(1, encounterRes.data.duration)
          : Math.max(
              1,
              ((encounterRes.data.endedAtMs ?? Date.now()) -
                encounterRes.data.startedAtMs) /
                1000,
            );
      players = buildHistoryPlayers(
        rawEntities,
        durationSeconds,
        encounterRes.data.activeCombatDuration ?? null,
        localPlayerUid,
        localPlayerUuid,
      );
      encounterEntitiesLoading = false;
      logHistoryTiming("encounter load complete", {
        encounterId: currentEncounterId,
        ms: historyLoadMs(startedAt),
        players: players.length,
      });
    } catch (err) {
      if (token === encounterLoadToken) {
        encounterEntitiesLoading = false;
      }
      error = err instanceof Error ? err.message : String(err);
      console.warn("[history] encounter load failed", {
        encounterId: currentEncounterId,
        ms: historyLoadMs(startedAt),
        error,
      });
    } finally {
      if (token === encounterLoadToken) {
        encounterEntitiesLoading = false;
      }
    }
  }

  async function loadGraphEntities() {
    const currentEncounterId = encounterId;
    if (!currentEncounterId) return;
    if (graphEntitiesLoading) return;
    if (graphEntitiesEncounterId === currentEncounterId && graphEntities) return;

    const token = ++graphEntitiesLoadToken;
    const startedAt = historyPerfNow();
    graphEntitiesLoading = true;
    graphEntitiesError = null;
    try {
      const entitiesRes = await commands.getEncounterEntitiesRaw(currentEncounterId).then((result) => {
        logHistoryTiming("encounter graph entities loaded", {
          encounterId: currentEncounterId,
          ms: historyLoadMs(startedAt),
          status: result.status,
          rows: result.status === "ok" ? result.data.length : 0,
        });
        return result;
      });
      if (token !== graphEntitiesLoadToken || currentEncounterId !== encounterId) return;
      if (entitiesRes.status !== "ok") {
        graphEntitiesError = String(entitiesRes.error);
        return;
      }
      graphEntities = entitiesRes.data;
      graphEntitiesEncounterId = currentEncounterId;
    } catch (err) {
      if (token === graphEntitiesLoadToken) {
        graphEntitiesError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      if (token === graphEntitiesLoadToken) {
        graphEntitiesLoading = false;
      }
    }
  }

  async function loadTargetDetailEntities() {
    const currentEncounterId = encounterId;
    if (!currentEncounterId || targetDetailsLoading) return;
    const token = ++targetDetailsLoadToken;
    const startedAt = historyPerfNow();
    targetDetailsRequestedEncounterId = currentEncounterId;
    targetDetailsLoading = true;
    try {
      const entitiesRes = await commands.getEncounterEntitiesTargetDetailsRaw(currentEncounterId).then((result) => {
        logHistoryTiming("encounter target detail entities loaded", {
          encounterId: currentEncounterId,
          ms: historyLoadMs(startedAt),
          status: result.status,
          rows: result.status === "ok" ? result.data.length : 0,
        });
        return result;
      });
      if (token !== targetDetailsLoadToken || currentEncounterId !== encounterId) return;
      if (entitiesRes.status !== "ok") {
        console.warn("[history] target detail entity load failed", {
          encounterId: currentEncounterId,
          error: String(entitiesRes.error),
        });
        return;
      }

      rawEntities = entitiesRes.data;
      players = buildHistoryPlayers(
        rawEntities,
        encounterDurationSeconds,
        encounter?.activeCombatDuration ?? null,
        localPlayerUid,
        localPlayerUuid,
      );
      targetDetailsLoadedEncounterId = currentEncounterId;
    } catch (err) {
      console.warn("[history] target detail entity load failed", {
        encounterId: currentEncounterId,
        ms: historyLoadMs(startedAt),
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (token === targetDetailsLoadToken) {
        targetDetailsLoading = false;
      }
    }
  }

  async function loadModifierEntities() {
    if (!modifierReportsEnabled) return;
    const currentEncounterId = encounterId;
    const selectedUid = selectedModifierPlayer?.uid ?? null;
    const selectedUuid = selectedModifierPlayer?.uuid ?? null;
    if (!currentEncounterId || selectedUid === null) return;
    const cacheKey = modifierCacheKey(currentEncounterId, selectedUid, selectedUuid);
    if (modifierEntityCache[cacheKey]?.length) {
      return;
    }
    const token = ++modifierEntitiesLoadToken;
    modifierEntitiesLoading = true;
    modifierEntitiesLoadingKey = cacheKey;
    modifierEntitiesError = null;
    const startedAt = historyPerfNow();
    try {
      logHistoryTiming("modifier entities load start", {
        encounterId: currentEncounterId,
        playerUid: selectedUid,
        playerUuid: selectedUuid,
      });
      const entitiesRes = await commands.getEncounterModifierEntitiesRaw(currentEncounterId, selectedUid, selectedUuid);
      if (token !== modifierEntitiesLoadToken) return;
      if (entitiesRes.status !== "ok") {
        modifierEntitiesError = String(entitiesRes.error);
        console.warn("[history] modifier entities load returned error", {
          encounterId: currentEncounterId,
          playerUid: selectedUid,
          playerUuid: selectedUuid,
          ms: historyLoadMs(startedAt),
          error: modifierEntitiesError,
        });
        return;
      }
      logHistoryTiming("modifier entities load complete", {
        encounterId: currentEncounterId,
        playerUid: selectedUid,
        playerUuid: selectedUuid,
        ms: historyLoadMs(startedAt),
        rows: entitiesRes.data.length,
        primaryBuckets: entitiesRes.data[0]?.modifierHitBuckets?.length ?? 0,
        supportRows: Math.max(0, entitiesRes.data.length - 1),
      });
      modifierEntityCache = {
        ...modifierEntityCache,
        [cacheKey]: entitiesRes.data,
      };
    } catch (err) {
      if (token !== modifierEntitiesLoadToken) return;
      modifierEntitiesError = err instanceof Error ? err.message : String(err);
      console.warn("[history] modifier entities load failed", {
        encounterId: currentEncounterId,
        playerUid: selectedUid,
        playerUuid: selectedUuid,
        ms: historyLoadMs(startedAt),
        error: modifierEntitiesError,
      });
    } finally {
      if (token === modifierEntitiesLoadToken) {
        modifierEntitiesLoading = false;
        modifierEntitiesLoadingKey = null;
      }
    }
  }

  async function loadModifierReport() {
    if (!modifierReportsEnabled) return;
    if (hasSelectedChar || activeTab !== "modifiers") return;
    if (!selectedModifierCacheKey || !selectedModifierReportKey) return;
    const detailedEntities = modifierEntityCache[selectedModifierCacheKey];
    if (!detailedEntities?.length || !selectedModifierEntity) return;
    if (modifierReportCache[selectedModifierReportKey]) return;
    if (modifierReportErrorKey === selectedModifierReportKey) return;
    if (modifierReportLoading && modifierReportLoadingKey === selectedModifierReportKey) return;

    const reportKey = selectedModifierReportKey;
    const token = ++modifierReportLoadToken;
    modifierReportLoading = true;
    modifierReportLoadingKey = reportKey;
    modifierReportError = null;
    modifierReportErrorKey = null;
    const startedAt = historyPerfNow();

    let reportEntity: HistoryEntityData;
    try {
      const { buildModifierSourceCatalog } = await import("$lib/config/modifier-source-catalog");
      const modifierSourceCatalog = await buildModifierSourceCatalog(selectedModifierEntity);
      if (token !== modifierReportLoadToken) return;
      reportEntity = slimModifierReportEntity(selectedModifierEntity, modifierSourceCatalog, detailedEntities);
    } catch (err) {
      if (token === modifierReportLoadToken) {
        modifierReportError = err instanceof Error ? err.message : String(err);
        modifierReportErrorKey = reportKey;
        modifierReportLoading = false;
        modifierReportLoadingKey = null;
        console.warn("[history] modifier report catalog build failed", {
          reportKey,
          ms: historyLoadMs(startedAt),
          error: modifierReportError,
        });
      }
      return;
    }

    logHistoryTiming("modifier report build start", {
      reportKey,
      playerUid: reportEntity.uid,
      buckets: reportEntity.modifierHitBuckets?.length ?? 0,
      scope: modifierScope,
      actorFilter: modifierActorFilter,
    });

    let worker: Worker;
    try {
      worker = createModifierReportWorker();
    } catch (err) {
      if (token === modifierReportLoadToken) {
        modifierReportError = err instanceof Error ? err.message : String(err);
        modifierReportErrorKey = reportKey;
        modifierReportLoading = false;
        modifierReportLoadingKey = null;
        console.warn("[history] modifier report worker startup failed", {
          reportKey,
          ms: historyLoadMs(startedAt),
          error: modifierReportError,
        });
      }
      return;
    }

    await new Promise<void>((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        worker.removeEventListener("message", handleMessage);
        worker.removeEventListener("error", handleError);
        worker.removeEventListener("messageerror", handleMessageError);
        worker.terminate();
        if (modifierReportWorker === worker) modifierReportWorker = null;
      };
      const finish = () => {
        cleanup();
        if (token === modifierReportLoadToken) {
          modifierReportLoading = false;
          modifierReportLoadingKey = null;
        }
        resolve();
      };
      const handleMessage = async (event: MessageEvent<ModifierReportWorkerResponse>) => {
        if (event.data.requestId !== token) return;
        if (token !== modifierReportLoadToken) {
          finish();
          return;
        }
        if (event.data.status === "started") {
          if (timeoutId !== null) clearTimeout(timeoutId);
          timeoutId = setTimeout(handleTimeout, MODIFIER_REPORT_WORKER_BUILD_TIMEOUT_MS);
          logHistoryTiming("modifier report worker started", {
            reportKey,
            ms: historyLoadMs(startedAt),
            buckets: event.data.buckets,
          });
          return;
        }
        if (event.data.status === "ok") {
          let rows = event.data.rows;
          try {
            const { enrichModifierRowsWithDescriptions } = await import("$lib/config/modifier-descriptions");
            rows = await enrichModifierRowsWithDescriptions(rows);
            if (token !== modifierReportLoadToken) {
              finish();
              return;
            }
          } catch (err) {
            console.warn("[history] modifier description enrichment failed", {
              reportKey,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          modifierReportCache = {
            ...modifierReportCache,
            [reportKey]: rows,
          };
          logHistoryTiming("modifier report worker built", {
            reportKey,
            ms: historyLoadMs(startedAt),
            workerMs: event.data.elapsedMs,
            rows: rows.length,
          });
        } else {
          modifierReportError = event.data.error;
          modifierReportErrorKey = reportKey;
          console.warn("[history] modifier report worker returned error", {
            reportKey,
            ms: historyLoadMs(startedAt),
            error: modifierReportError,
          });
        }
        finish();
      };
      const handleError = (event: ErrorEvent) => {
        if (token === modifierReportLoadToken) {
          modifierReportError = event.message || "Modifier report worker failed.";
          modifierReportErrorKey = reportKey;
          console.warn("[history] modifier report worker failed", {
            reportKey,
            ms: historyLoadMs(startedAt),
            error: modifierReportError,
          });
        }
        finish();
      };
      const handleMessageError = () => {
        if (token === modifierReportLoadToken) {
          modifierReportError = "Modifier report worker could not read the report payload.";
          modifierReportErrorKey = reportKey;
          console.warn("[history] modifier report worker messageerror", {
            reportKey,
            ms: historyLoadMs(startedAt),
          });
        }
        finish();
      };
      const handleTimeout = () => {
        if (token === modifierReportLoadToken) {
          modifierReportError = "Modifier report worker did not respond before the safety timeout.";
          modifierReportErrorKey = reportKey;
          console.warn("[history] modifier report worker timeout", {
            reportKey,
            ms: historyLoadMs(startedAt),
            startTimeoutMs: MODIFIER_REPORT_WORKER_START_TIMEOUT_MS,
            buildTimeoutMs: MODIFIER_REPORT_WORKER_BUILD_TIMEOUT_MS,
          });
        }
        finish();
      };

      worker.addEventListener("message", handleMessage);
      worker.addEventListener("error", handleError);
      worker.addEventListener("messageerror", handleMessageError);
      timeoutId = setTimeout(handleTimeout, MODIFIER_REPORT_WORKER_START_TIMEOUT_MS);
      worker.postMessage({
        requestId: token,
        entity: reportEntity,
        elapsedSecs: encounterDurationSeconds,
        options: {
          scope: modifierScope,
          actorFilter: modifierActorFilter,
          encounterStartMs: encounter?.startedAtMs ?? null,
          encounterEndMs: encounter?.endedAtMs ?? null,
        },
      });
    });
  }

  function viewPlayerSkills(
    playerUid: number,
    type = "dps",
    targetUid?: number | null,
    playerUuid?: number | null,
    targetUuid?: number | null,
  ) {
    const sp = new URLSearchParams($page.url.searchParams);
    const resolvedPlayerUuid = finitePositiveReportId(
      playerUuid ?? players.find((player) => player.uid === playerUid)?.uuid ?? null,
    );
    const resolvedTargetUuid = finitePositiveReportId(targetUuid);
    sp.set("charId", String(playerUid));
    if (resolvedPlayerUuid !== null) {
      sp.set("charUuid", String(resolvedPlayerUuid));
    } else {
      sp.delete("charUuid");
    }
    sp.set("skillType", type);
    if (type === "dps" && targetUid != null) {
      sp.set("targetUid", String(targetUid));
      if (resolvedTargetUuid !== null) {
        sp.set("targetUuid", String(resolvedTargetUuid));
      } else {
        sp.delete("targetUuid");
      }
    } else {
      sp.delete("targetUid");
      sp.delete("targetUuid");
    }
    sp.delete("deathTs");
    goto(`/main/dps/history/${encounterId}?${sp.toString()}`);
  }

  function viewDeathReplay(playerUid: number, deathTs: number, playerUuid?: number | null) {
    const sp = new URLSearchParams($page.url.searchParams);
    const resolvedPlayerUuid = finitePositiveReportId(
      playerUuid ?? players.find((player) => player.uid === playerUid)?.uuid ?? null,
    );
    sp.set("charId", String(playerUid));
    if (resolvedPlayerUuid !== null) {
      sp.set("charUuid", String(resolvedPlayerUuid));
    } else {
      sp.delete("charUuid");
    }
    sp.set("skillType", "death");
    sp.set("deathTs", String(deathTs));
    sp.delete("targetUid");
    sp.delete("targetUuid");
    goto(`/main/dps/history/${encounterId}?${sp.toString()}`);
  }

  function backToDeathPlayerList() {
    const sp = new URLSearchParams($page.url.searchParams);
    sp.delete("charId");
    sp.delete("charUuid");
    sp.delete("deathTs");
    sp.delete("targetUid");
    sp.delete("targetUuid");
    sp.set("skillType", "death");
    goto(`/main/dps/history/${encounterId}?${sp.toString()}`);
  }

  function backToDeathList() {
    const sp = new URLSearchParams($page.url.searchParams);
    sp.delete("deathTs");
    sp.delete("targetUid");
    sp.delete("targetUuid");
    sp.set("skillType", "death");
    goto(`/main/dps/history/${encounterId}?${sp.toString()}`);
  }

  function backToEncounter() {

    const sp = new URLSearchParams($page.url.searchParams);
    sp.delete("charId");
    sp.delete("charUuid");
    sp.delete("skillType");
    sp.delete("targetUid");
    sp.delete("targetUuid");
    sp.delete("deathTs");
    const qs = sp.toString();
    goto(`/main/dps/history/${encounterId}${qs ? `?${qs}` : ""}`);
  }

  function handleHistoryContextMenu(event: MouseEvent) {
    if (!hasSelectedChar) return;

    event.preventDefault();
    backToEncounter();
  }

  function backToHistory(resetPage = false) {

    // Return to the history list while preserving list state.
    const sp = new URLSearchParams($page.url.searchParams);
    sp.delete("charId");
    sp.delete("charUuid");
    sp.delete("skillType");
    sp.delete("targetUid");
    sp.delete("targetUuid");
    sp.delete("deathTs");
    if (resetPage) sp.set("page", "0");
    const qs = sp.toString();
    goto(`/main/dps/history${qs ? `?${qs}` : ""}`);
  }

  async function handleToggleFavorite() {
    if (!encounter) return;
    try {
      const newStatus = !encounter.isFavorite;
      // Optimistic update
      encounter.isFavorite = newStatus;
      await commands.toggleFavoriteEncounter(encounter.id, newStatus);
    } catch (e) {
      console.error("Failed to toggle favorite", e);
      // Revert on error
      if (encounter) encounter.isFavorite = !encounter.isFavorite;
    }
  }

  function openDeleteModal() {
    if (encounter?.isFavorite) return;
    showDeleteModal = true;
  }

  function closeDeleteModal() {
    showDeleteModal = false;
  }

  function singleLineHoverPreview(value: string, maxLength = 260): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
  }

  function buildHistoryGroupHoverText(recountId: string | number, language: LocaleCode) {
    const note = hoverDescriptionsEnabled()
      ? singleLineHoverPreview(resolveSkillNote(recountId, language))
      : "";
    return buildRecountGroupHoverText(recountId, language, note, { compact: true });
  }

  function buildHistorySkillHoverText(skillId: string | number, language: LocaleCode) {
    const note = hoverDescriptionsEnabled()
      ? singleLineHoverPreview(resolveSkillNote(skillId, language))
      : "";
    return buildSkillBreakdownHoverText(skillId, language, note, { compact: true });
  }

  async function confirmDeleteEncounter() {
    if (!encounter || encounter.isFavorite) return;
    isDeleting = true;
    try {
      await commands.deleteEncounter(encounter.id);
      // Navigate back to history after deletion
      backToHistory(true);
    } catch (e) {
      console.error("Failed to delete encounter", e);
      alert(`${t("detail.deleteFailed", "删除战斗记录失败")}: ${e}`);
      isDeleting = false;
      showDeleteModal = false;
    }
  }

  async function openEncounterOnWebsite() {
    if (!encounter || !encounter.remoteEncounterId) return;

    const url = `${websiteBaseUrl}/encounter/${encounter.remoteEncounterId}`;
    try {
      await openUrl(url);
    } catch (err) {
      console.error("Failed to open URL:", url, err);
    }
  }

  $effect(() => {
    loadEncounter();
  });

  $effect(() => {
    charId;
    charUuid;
    expandedGroups = new Set<number>();
  });

  $effect(() => {
    if (!hasSelectedChar || skillType !== "dps" || (selectedSkillTargetUid === null && selectedSkillTargetUuid === null)) return;
    if (targetDetailsLoadedEncounterId === encounterId) return;
    if (targetDetailsRequestedEncounterId === encounterId) return;
    const targetStats = perTargetForPlayer(selectedPlayer)
      ?.dmgTargets.find((target) =>
        targetMatchesIdentity(target, selectedSkillTargetUid, selectedSkillTargetUuid),
      );
    if (!targetStats) return;
    if (Object.keys(targetStats.skills ?? {}).length > 0) return;
    void loadTargetDetailEntities();
  });

  $effect(() => {
    activeTab;
    if (activeTab !== "damage") {
      overviewTargetUid = null;
      overviewTargetUuid = null;
    }
  });

  $effect(() => {
    if (skillType === "death") {
      activeTab = "death";
    }
  });

  $effect(() => {
    if (hasSelectedChar || activeTab !== "modifiers" || !modifierReportsEnabled) return;
    void loadModifierEntities();
  });

  $effect(() => {
    if (hasSelectedChar || activeTab !== "modifiers" || !modifierReportsEnabled) return;
    selectedModifierReportKey;
    selectedModifierEntity;
    modifierEntityCache;
    void loadModifierReport();
  });

  $effect(() => {
    if (activeTab !== "modifiers" || !modifierReportsEnabled) return;
    if (modifierPlayers.length === 0) {
      modifierPlayerUid = null;
      modifierPlayerUuid = null;
      return;
    }
    const selectedPlayer = modifierPlayers.find((player) =>
      playerMatchesIdentity(player, modifierPlayerUid, modifierPlayerUuid),
    );
    if (selectedPlayer) {
      modifierPlayerUid = selectedPlayer.uid;
      modifierPlayerUuid = selectedPlayer.uuid ?? null;
      return;
    }
    const localPlayer = modifierPlayers.find((player) =>
      playerMatchesIdentity(player, localPlayerUid, localPlayerUuid),
    );
    const fallbackPlayer = localPlayer ?? modifierPlayers[0];
    if (fallbackPlayer) {
      modifierPlayerUid = fallbackPlayer.uid;
      modifierPlayerUuid = fallbackPlayer.uuid ?? null;
    } else {
      modifierPlayerUid = null;
      modifierPlayerUuid = null;
    }
  });

  $effect(() => {
    if (activeTab !== "modifiers") return;
    if (!modifierReportsEnabled) {
      modifierPlayerUid = null;
      modifierPlayerUuid = null;
      modifierEntitiesLoading = false;
      modifierReportLoading = false;
      modifierEntitiesLoadingKey = null;
      modifierReportLoadingKey = null;
      modifierEntitiesLoadToken++;
      modifierReportLoadToken++;
      terminateModifierReportWorker();
      return;
    }
    const seed = [
      encounterId ?? "",
      selectedModifierPlayer?.uid ?? "",
      selectedModifierPlayer?.uuid ?? "",
      modifierViewMode,
      modifierScope,
      modifierActorFilter,
      modifierHideFullCoverage ? "hide-full" : "show-full",
    ].join(":");
    if (modifierExpansionSeed === seed) return;
    modifierExpansionSeed = seed;
    expandedModifierRows = new Set<string>();
  });

  $effect(() => {
    if (hasSelectedChar || historyDataViewMode !== "graph" || !historyGraphMetric || !encounterId) {
      return;
    }
    void loadGraphEntities();
  });

  $effect(() => {
    const scopeKey = [
      encounterId ?? "none",
      historyGraphMetric ?? "none",
      overviewTargetUuid !== null ? `uuid:${overviewTargetUuid}` : `uid:${overviewTargetUid ?? "total"}`,
    ].join(":");
    if (historyGraphSeriesScopeKey !== scopeKey) {
      historyGraphSeriesScopeKey = scopeKey;
      historyGraphHiddenSeries = new Set();
      return;
    }
    pruneHistoryGraphHiddenSeries(historyGraphData);
  });

</script>

<svelte:window oncontextmenu={handleHistoryContextMenu} />

<div class="history-detail-root">
  {#if error}
    <div class="text-red-400 mb-3">{error}</div>
  {/if}

  {#if !hasSelectedChar && encounter}
    <!-- Encounter Overview -->
    {#if overviewSummaryGroups.length > 0}
      <div class="history-summary-rail">
        <div class="history-overview-summary">
          <div class="history-summary-panel" aria-label={t("detail.summary.aria", "Player stat summary")}>
            {#each overviewSummaryGroups as group (group.key)}
              <div
                class="history-summary-group"
                style={`grid-column: span ${group.columns}; --summary-section-columns: ${group.columns};`}
              >
                <div class="history-summary-heading">{group.label}</div>
                {#each group.rows as row}
                  {#each row as item}
                    {#if item}
                      <span class="history-summary-cell history-summary-label summary-accent-{item.accent}">
                        {item.label}
                      </span>
                      <span class="history-summary-cell history-summary-value">
                        {item.value}
                      </span>
                    {:else}
                      <span
                        class="history-summary-cell history-summary-empty"
                        aria-hidden="true"
                      ></span>
                      <span
                        class="history-summary-cell history-summary-empty"
                        aria-hidden="true"
                      ></span>
                    {/if}
                  {/each}
                {/each}
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    <div class="mb-4">
      <div class="flex flex-col gap-3 rounded-lg border border-border bg-card/50 p-4">
        <div class="flex flex-wrap items-stretch justify-between gap-3">
          <div class="flex items-start gap-3 min-w-0 flex-1">
            <div class="space-y-1 min-w-0 flex-1 h-full">
              <div class="flex flex-wrap items-center gap-1">
                <button
                  onclick={() => backToHistory()}
                  class="p-0.5 text-muted-foreground/70 hover:text-foreground transition-colors rounded shrink-0"
                  title={t("detail.backToHistory", "返回历史")}
                  aria-label={t("detail.backToHistory", "返回历史")}
                >
                  <svg
                    class="w-4 h-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                </button>
                <h2 class="text-lg font-semibold text-foreground leading-tight">
                  {localizeSceneName((encounter as { sceneId?: number | string | null }).sceneId ?? null, encounter.sceneName || t("detail.unknownScene", "未知场景"))}
                </h2>
              </div>
              {#if encounter.bosses.length > 0}
                <div class="w-full mt-1">
                  <div class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {#each encounter.bosses as b, i}
                      <span
                        class={b.isDefeated
                          ? "text-destructive line-through"
                          : "text-primary"}
                        >{localizeRawMonsterName(b.monsterName, t("detail.unknownBoss", "未知首领"))}{i < encounter.bosses.length - 1 ? "," : ""}</span
                      >
                    {/each}
                  </div>
                </div>
              {/if}
              <div class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <span>{new Date(encounter.startedAtMs).toLocaleString()}</span>
                <span class="text-muted-foreground">•</span>
                <span>{t("detail.duration", "时长")}: {formatEncounterDuration(encounterDurationSeconds)}</span>
                <span class="text-muted-foreground">•</span>
                <span class="text-[11px] text-muted-foreground">#{encounter.id}</span>
              </div>
              {#if historyGraphMetric}
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <div class="inline-flex rounded border border-border bg-popover">
                    <button
                      class="px-3 py-1 text-xs rounded transition-colors {historyDataViewMode === 'breakdown'
                        ? 'bg-muted/40 text-foreground'
                        : 'text-muted-foreground hover:text-foreground'}"
                      onclick={() => (historyDataViewMode = "breakdown")}
                    >
                      {t("detail.breakdownView", "Breakdown")}
                    </button>
                    <button
                      class="px-3 py-1 text-xs rounded transition-colors {historyDataViewMode === 'graph'
                        ? 'bg-muted/40 text-foreground'
                        : 'text-muted-foreground hover:text-foreground'}"
                      onclick={() => (historyDataViewMode = "graph")}
                    >
                      {t("detail.graphView", "Graph")}
                    </button>
                  </div>
                  {#if historyDataViewMode === "graph"}
                    <div class="inline-flex rounded border border-border bg-popover">
                      <button
                        class="px-3 py-1 text-xs rounded transition-colors {historyGraphDisplayMode === 'individual'
                          ? 'bg-muted/40 text-foreground'
                          : 'text-muted-foreground hover:text-foreground'}"
                        onclick={() => (historyGraphDisplayMode = "individual")}
                      >
                        {t("detail.graphIndividualView", "Graph - Individual")}
                      </button>
                      <button
                        class="px-3 py-1 text-xs rounded transition-colors {historyGraphDisplayMode === 'team'
                          ? 'bg-muted/40 text-foreground'
                          : 'text-muted-foreground hover:text-foreground'}"
                        onclick={() => (historyGraphDisplayMode = "team")}
                      >
                        {t("detail.graphTeamView", "Graph - T.DPS")}
                      </button>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </div>

          <div class="flex flex-col items-end gap-2 shrink-0 self-stretch justify-between h-full">
            <div class="flex items-center gap-1.5">
              {#if activeTab === "modifiers" && modifierReportsEnabled}
                <label
                  class="inline-flex items-center gap-1.5 rounded border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                  title={modifierViewMode === "by-modifier"
                    ? t("detail.modifierHideFullCoverageTitleByModifier", "Hide modifier parent rows whose observed coverage reaches 100%.")
                    : t("detail.modifierHideFullCoverageTitleBySkill", "Hide modifier child rows whose source coverage reaches 100%.")}
                >
                  <input
                    type="checkbox"
                    class="size-3 accent-primary"
                    bind:checked={modifierHideFullCoverage}
                  />
                  <span>{t("detail.modifierHideFullCoverage", "Hide 100%")}</span>
                </label>
              {/if}

              {#if encounter.remoteEncounterId}
                <button
                  onclick={openEncounterOnWebsite}
                  class="inline-flex items-center justify-center rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors p-2"
                  title={t("detail.openOnWebsiteTitle", "在 resonance-logs.com 打开该战斗记录")}
                  aria-label={t("detail.openOnWebsite", "在 resonance-logs.com 打开该战斗记录")}
                >
                  <svg
                    class="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </button>
              {/if}

              <button
                onclick={handleToggleFavorite}
                class="inline-flex items-center justify-center rounded transition-colors p-2 {encounter.isFavorite
                  ? 'bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20'
                  : 'bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
                title={encounter.isFavorite
                  ? t("detail.removeFavorite", "取消收藏")
                  : t("detail.addFavorite", "加入收藏")}
                aria-label={encounter.isFavorite
                  ? t("detail.removeFavorite", "取消收藏")
                  : t("detail.addFavorite", "加入收藏")}
              >
                <svg
                  class="w-4 h-4"
                  fill={encounter.isFavorite ? "currentColor" : "none"}
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                  />
                </svg>
              </button>

              <button
                onclick={openDeleteModal}
                disabled={encounter.isFavorite}
                class="inline-flex items-center justify-center rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors p-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-destructive/10"
                title={encounter.isFavorite
                  ? t("detail.deleteFavoriteDisabled", "Remove favorite before deleting")
                  : t("detail.deleteEncounterTitle", "删除该战斗记录")}
                aria-label={t("detail.deleteEncounterAria", "删除战斗记录")}
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>

            <div class="flex rounded border border-border bg-popover">
              {#each tabs as tab}
                <button
                  onclick={() => (activeTab = tab.key)}
                  class="px-3 py-1 text-xs rounded transition-colors {activeTab === tab.key
                    ? 'bg-muted/40 text-foreground'
                    : 'text-muted-foreground hover:text-foreground'}"
                >
                  {tab.label}
                </button>
              {/each}
            </div>
          </div>
        </div>
      </div>
    </div>

    {#if activeTab === "damage" && overviewTargets.length > 0}
      <div class="mb-3 flex flex-wrap gap-1.5">
        <button
          class="px-3 py-1 text-xs rounded border border-border transition-colors {overviewTargetUid === null && overviewTargetUuid === null
            ? 'bg-muted/40 text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'}"
          onclick={() => {
            overviewTargetUid = null;
            overviewTargetUuid = null;
          }}
        >
          {t("detail.total", "总计")}
        </button>
        {#each overviewTargets as target (targetIdentityKey(target))}
          <button
            class="px-3 py-1 text-xs rounded border border-border transition-colors {targetMatchesIdentity(target, overviewTargetUid, overviewTargetUuid)
              ? 'bg-muted/40 text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'}"
            onclick={() => {
              overviewTargetUid = target.targetUid;
              overviewTargetUuid = target.targetUuid ?? null;
            }}
            title={`${t("detail.target", "目标")} #${target.targetUid}${target.targetUuid ? ` / UUID: ${target.targetUuid}` : ""}`}
          >
            {localizeRawMonsterName(target.targetName, target.targetName)}
          </button>
        {/each}
      </div>
    {/if}

    {#if activeTab === "death"}
      <DeathPlayerList
        entries={deathEntries}
        localPlayerUid={localPlayerUid}
        localPlayerKey={localPlayerUuid ? String(localPlayerUuid) : null}
        onSelect={(uid, entry) => viewPlayerSkills(uid, "death", null, entry?.uuid ?? null)}
        emptyMessage={t("detail.noDeathRows", "No player deaths were recorded for this encounter.")}
        variant="history"
      />
    {:else if activeTab === "modifiers"}
      {@const language = SETTINGS.live.general.state.language as LocaleCode}
      {#if !modifierReportsEnabled}
        <div class="rounded border border-border/60 bg-card/30 px-3 py-6 text-center text-sm text-muted-foreground">
          {t("detail.modifierDisabled", "Modifier analysis is disabled in Meter Settings.")}
        </div>
      {:else}
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap gap-1.5">
          {#each modifierPlayers as player (playerIdentityKey(player))}
            <button
              class="px-3 py-1 text-xs rounded border border-border transition-colors {selectedModifierPlayer && playerMatchesIdentity(selectedModifierPlayer, player.uid, player.uuid ?? null)
                ? 'bg-muted/40 text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'}"
              onclick={() => {
                modifierPlayerUid = player.uid;
                modifierPlayerUuid = player.uuid ?? null;
              }}
              title={`UID: #${player.uid}${player.uuid ? ` / UUID: ${player.uuid}` : ""}`}
            >
              {getDisplayName({
                player: {
                  uid: player.uid,
                  name: player.name,
                  className: player.className,
                  classSpecName: player.classSpecName,
                },
                showYourNameSetting: settings.state.history.general.showYourName,
                showOthersNameSetting: settings.state.history.general.showOthersName,
                isLocalPlayer: player.isLocalPlayer,
              })}
              {#if player.isLocalPlayer}
                <span class="ml-1 text-[oklch(0.65_0.1_250)]">{`(${t("detail.you", "You")})`}</span>
              {/if}
            </button>
          {/each}
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="flex rounded border border-border bg-popover">
            <button
              class="px-3 py-1 text-xs rounded transition-colors {modifierViewMode === 'by-modifier'
                ? 'bg-muted/40 text-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (modifierViewMode = "by-modifier")}
            >
              {t("detail.modifierByModifier", "By modifier")}
            </button>
            <button
              class="px-3 py-1 text-xs rounded transition-colors {modifierViewMode === 'by-skill'
                ? 'bg-muted/40 text-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (modifierViewMode = "by-skill")}
            >
              {t("detail.modifierBySkill", "By skill")}
            </button>
          </div>
          <div class="flex rounded border border-border bg-popover">
            <button
              class="px-3 py-1 text-xs rounded transition-colors {modifierScope === 'all-active'
                ? 'bg-muted/40 text-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (modifierScope = "all-active")}
            >
              {t("detail.modifierAllActive", "All active")}
            </button>
            <button
              class="px-3 py-1 text-xs rounded transition-colors {modifierScope === 'static-targets'
                ? 'bg-muted/40 text-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (modifierScope = "static-targets")}
            >
              {t("detail.modifierStaticTargets", "Static targets")}
            </button>
          </div>
          <div class="flex rounded border border-border bg-popover">
            <button
              class="px-3 py-1 text-xs rounded transition-colors {modifierActorFilter === 'all'
                ? 'bg-muted/40 text-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (modifierActorFilter = "all")}
            >
              {t("detail.modifierAllSources", "All sources")}
            </button>
            <button
              class="px-3 py-1 text-xs rounded transition-colors {modifierActorFilter === 'external'
                ? 'bg-muted/40 text-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (modifierActorFilter = "external")}
            >
              {t("detail.modifierExternalOnly", "External only")}
            </button>
          </div>
        </div>
      </div>

      <div class="history-sticky-frame rounded border border-border/60 bg-card">
        <table class="history-sticky-table w-full border-separate border-spacing-0">
          <thead>
            <tr class="bg-popover">
              <th class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {modifierViewMode === "by-modifier"
                  ? t("detail.modifierColumnByModifier", "Modifier / Skill")
                  : t("detail.modifierColumnBySkill", "Skill / Modifier")}
              </th>
              <th class="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("detail.modifierObservedDamage", "Allocated damage")}
              </th>
              <th class="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("detail.modifierEstimatedGain", "Est. gain")}
              </th>
              <th class="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("detail.encounterPct", "Encounter %")}
              </th>
              <th class="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("detail.sourcePct", "Source %")}
              </th>
              <th class="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("detail.modifierObservedHits", "Allocated hits")}
              </th>
              <th class="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("detail.critPct", "Crit %")}
              </th>
              <th class="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("detail.luckyPct", "Lucky %")}
              </th>
            </tr>
          </thead>
          <tbody class="bg-background/40">
            {#if (modifierEntitiesLoading && modifierEntitiesLoadingKey === selectedModifierCacheKey) || (modifierReportLoading && modifierReportLoadingKey === selectedModifierReportKey)}
              <tr class="border-t border-border/40">
                <td class="px-3 py-6 text-center text-sm text-muted-foreground" colspan="8">
                  {modifierLoadingText()}
                </td>
              </tr>
            {:else if modifierEntitiesError || modifierReportError}
              <tr class="border-t border-border/40">
                <td class="px-3 py-6 text-center text-sm text-red-400" colspan="8">
                  {modifierEntitiesError ?? modifierReportError}
                </td>
              </tr>
            {:else if flatModifierRows.length === 0}
              <tr class="border-t border-border/40">
                <td class="px-3 py-6 text-center text-sm text-muted-foreground" colspan="8">
                  {t("detail.noModifierRows", "No modifier activity recorded.")}
                </td>
              </tr>
            {:else}
              {#each flatModifierRows as item (item.key)}
                <tr class="relative border-t border-border/40 hover:bg-muted/60 transition-colors">
                  <td class="px-3 py-3 text-sm text-muted-foreground relative z-0">
                    {#if item.kind === "modifier"}
                      {@const sourceIconPath = modifierSourceIconPath(item.row)}
                      {@const effectSummary = modifierEffectSummary(item.row, language)}
                      <button
                        class="inline-flex max-w-full items-center gap-1.5 hover:text-foreground transition-colors"
                        onclick={() => toggleModifierRow(item.row.key)}
                        title={modifierSourceTitle(item.row, language)}
                      >
                        <svg
                          class="size-3 shrink-0 text-muted-foreground/70 transition-transform duration-150 {expandedModifierRows.has(item.row.key) ? 'rotate-90' : ''}"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2.5"
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                        {#if sourceIconPath}
                          <img
                            class="size-4 shrink-0 rounded-sm object-cover"
                            src={sourceIconPath}
                            alt=""
                            loading="lazy"
                          />
                        {/if}
                        <span class="truncate font-medium text-foreground/90">
                          {modifierSourceLabel(item.row, language)}
                        </span>
                        {#if modifierHasExternalSources(item.row.actorSummary)}
                          <span
                            class="inline-block max-w-40 shrink-0 truncate rounded border border-primary/30 bg-primary/10 px-1 py-0.5 align-middle text-[9px] leading-none text-primary"
                            title={modifierExternalBadgeTitle(item.row.actorSummary)}
                          >
                            {modifierExternalBadgeLabel(item.row.actorSummary)}
                          </span>
                        {/if}
                        <span class="shrink-0 rounded border border-border/50 bg-muted/30 px-1 py-0.5 text-[9px] leading-none text-muted-foreground">
                          {modifierMatchLabel(item.row.match)}
                        </span>
                        {#if item.row.attributionModel}
                          <span
                            class="shrink-0 rounded border px-1 py-0.5 text-[9px] leading-none {modifierAttributionClass(item.row.attributionModel)}"
                            title={modifierAttributionTitle(item.row.attributionModel)}
                          >
                            {modifierAttributionLabel(item.row.attributionModel)}
                          </span>
                        {/if}
                        {#if item.row.timingModel}
                          <span
                            class="shrink-0 rounded border border-cyan-400/35 bg-cyan-400/10 px-1 py-0.5 text-[9px] leading-none text-cyan-200"
                            title={modifierTimingTitle(item.row.timingModel)}
                          >
                            {t("detail.modifierTimingPill", "Timing")}
                          </span>
                        {/if}
                        {#if item.row.formulaReplayModel}
                          <span
                            class="shrink-0 rounded border px-1 py-0.5 text-[9px] leading-none {modifierFormulaReplayClass(item.row.formulaReplayModel)}"
                            title={modifierFormulaReplayTitle(item.row.formulaReplayModel)}
                          >
                            {modifierFormulaReplayLabel(item.row.formulaReplayModel)}
                          </span>
                        {/if}
                        {#if effectSummary}
                          <span
                            class="max-w-48 shrink truncate rounded border border-emerald-400/30 bg-emerald-400/10 px-1 py-0.5 text-[9px] leading-none text-emerald-200"
                            title={modifierEffectSummaryTitle(item.row, language)}
                          >
                            {effectSummary}
                          </span>
                        {/if}
                        {#if shouldShowModifierSourceUid(item.row)}
                          <span class="text-[10px] text-muted-foreground/50 shrink-0">
                            {modifierSourceUidLabel(item.row)}
                          </span>
                        {/if}
                      </button>
                    {:else if item.kind === "modifier-skill"}
                      {@const skillIconPath = modifierSkillIconPath(item.row)}
                      {@const replayModel = modifierFormulaReplayModelFromItem(item)}
                      <div
                        class="inline-flex max-w-full items-center gap-1.5 pl-5"
                        title={modifierSkillTitle(item.row, language)}
                      >
                        <span class="w-3 shrink-0 flex justify-center">
                          <span class="size-1 rounded-full bg-muted-foreground/35"></span>
                        </span>
                        {#if skillIconPath}
                          <img
                            class="size-4 shrink-0 rounded-sm object-cover"
                            src={skillIconPath}
                            alt=""
                            loading="lazy"
                          />
                        {/if}
                        <span class="truncate">
                          {modifierSkillLabel(item.row, language)}
                        </span>
                        <span class="shrink-0 rounded border border-border/50 bg-background/60 px-1 py-0.5 text-[9px] leading-none text-muted-foreground">
                          {modifierMatchLabel(item.row.match)}
                        </span>
                        {#if replayModel}
                          <span
                            class="shrink-0 rounded border px-1 py-0.5 text-[9px] leading-none {modifierFormulaReplayClass(replayModel)}"
                            title={modifierFormulaReplayTitle(replayModel)}
                          >
                            {modifierFormulaReplayLabel(replayModel)}
                          </span>
                        {/if}
                        {#if SETTINGS.live.general.state.skillIdDisplayMode === 'column'}
                          <span class="text-[10px] text-muted-foreground/50 shrink-0">
                            #{item.row.skillId}{item.row.damageIds.length > 1 ? ` +${item.row.damageIds.length - 1}` : ""}
                          </span>
                    {/if}
                  </div>
                {:else if item.kind === "skill"}
                  {@const skillIconPath = modifierSkillIconPath(item.row)}
                  {@const breakdownExternalSummary = modifierBreakdownExternalSummary(item.row)}
                  <button
                        class="inline-flex max-w-full items-center gap-1.5 hover:text-foreground transition-colors"
                        onclick={() => toggleModifierRow(item.row.key)}
                        title={modifierSkillTitle(item.row, language)}
                      >
                        <svg
                          class="size-3 shrink-0 text-muted-foreground/70 transition-transform duration-150 {expandedModifierRows.has(item.row.key) ? 'rotate-90' : ''}"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2.5"
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                        {#if skillIconPath}
                          <img
                            class="size-4 shrink-0 rounded-sm object-cover"
                            src={skillIconPath}
                            alt=""
                            loading="lazy"
                          />
                        {/if}
                        <span class="truncate font-medium text-foreground/90">
                          {modifierSkillLabel(item.row, language)}
                        </span>
                        <span class="shrink-0 rounded border border-border/50 bg-muted/30 px-1 py-0.5 text-[9px] leading-none text-muted-foreground">
                          {modifierMatchLabel(item.row.match)}
                        </span>
                        {#if modifierHasExternalSources(breakdownExternalSummary)}
                          <span
                            class="inline-block max-w-40 shrink-0 truncate rounded border border-primary/30 bg-primary/10 px-1 py-0.5 align-middle text-[9px] leading-none text-primary"
                            title={modifierExternalBadgeTitle(breakdownExternalSummary)}
                          >
                            {modifierExternalBadgeLabel(breakdownExternalSummary)}
                          </span>
                        {/if}
                        {#if SETTINGS.live.general.state.skillIdDisplayMode === 'column'}
                          <span class="text-[10px] text-muted-foreground/50 shrink-0">
                            #{item.row.skillId}{item.row.damageIds.length > 1 ? ` +${item.row.damageIds.length - 1}` : ""}
                          </span>
                        {/if}
                      </button>
                    {:else if item.kind === "source"}
                      {@const sourceIconPath = modifierSourceIconPath(item.row.source)}
                      {@const effectSummary = modifierEffectSummary(item.row.source, language)}
                      {@const replayModel = modifierFormulaReplayModelFromItem(item)}
                      <div
                        class="inline-flex max-w-full items-center gap-1.5 pl-5"
                        title={modifierSourceTitle(item.row.source, language)}
                      >
                        <span class="w-3 shrink-0 flex justify-center">
                          <span class="size-1 rounded-full bg-muted-foreground/35"></span>
                        </span>
                        {#if sourceIconPath}
                          <img
                            class="size-4 shrink-0 rounded-sm object-cover"
                            src={sourceIconPath}
                            alt=""
                            loading="lazy"
                          />
                        {/if}
                        <span class="truncate">
                          {modifierSourceLabel(item.row.source, language)}
                        </span>
                        {#if modifierHasExternalSources(item.row.source.actorSummary)}
                          <span
                            class="inline-block max-w-40 shrink-0 truncate rounded border border-primary/30 bg-primary/10 px-1 py-0.5 align-middle text-[9px] leading-none text-primary"
                            title={modifierExternalBadgeTitle(item.row.source.actorSummary)}
                          >
                            {modifierExternalBadgeLabel(item.row.source.actorSummary)}
                          </span>
                        {/if}
                        <span class="shrink-0 rounded border border-border/50 bg-background/60 px-1 py-0.5 text-[9px] leading-none text-muted-foreground">
                          {modifierMatchLabel(item.row.match)}
                        </span>
                        {#if item.row.attributionModel}
                          <span
                            class="shrink-0 rounded border px-1 py-0.5 text-[9px] leading-none {modifierAttributionClass(item.row.attributionModel)}"
                            title={modifierAttributionTitle(item.row.attributionModel)}
                          >
                            {modifierAttributionLabel(item.row.attributionModel)}
                          </span>
                        {/if}
                        {#if item.row.source.timingModel}
                          <span
                            class="shrink-0 rounded border border-cyan-400/35 bg-cyan-400/10 px-1 py-0.5 text-[9px] leading-none text-cyan-200"
                            title={modifierTimingTitle(item.row.source.timingModel)}
                          >
                            {t("detail.modifierTimingPill", "Timing")}
                          </span>
                        {/if}
                        {#if replayModel}
                          <span
                            class="shrink-0 rounded border px-1 py-0.5 text-[9px] leading-none {modifierFormulaReplayClass(replayModel)}"
                            title={modifierFormulaReplayTitle(replayModel)}
                          >
                            {modifierFormulaReplayLabel(replayModel)}
                          </span>
                        {/if}
                        {#if effectSummary}
                          <span
                            class="max-w-48 shrink truncate rounded border border-emerald-400/30 bg-emerald-400/10 px-1 py-0.5 text-[9px] leading-none text-emerald-200"
                            title={modifierEffectSummaryTitle(item.row.source, language)}
                          >
                            {effectSummary}
                          </span>
                        {/if}
                        {#if shouldShowModifierSourceUid(item.row.source)}
                          <span class="text-[10px] text-muted-foreground/50 shrink-0">
                            {modifierSourceUidLabel(item.row.source)}
                          </span>
                        {/if}
                      </div>
                    {/if}
                  </td>
                  <td class="px-3 py-3 text-right text-sm text-muted-foreground relative z-0">
                    {#if SETTINGS.history.general.state.shortenDps}
                      <AbbreviatedNumber num={item.row.totalDmg} decimalPlaces={abbreviatedDecimalPlaces} />
                    {:else}
                      {formatModifierCount(item.row.totalDmg)}
                    {/if}
                  </td>
                  <td
                    class="px-3 py-3 text-right text-sm text-muted-foreground relative z-0"
                    title={modifierEstimatedGainTitle(item)}
                  >
                    {#if modifierEstimatedGain(item) !== null}
                      {#if SETTINGS.history.general.state.shortenDps}
                        <AbbreviatedNumber num={modifierEstimatedGain(item) ?? 0} decimalPlaces={abbreviatedDecimalPlaces} />
                      {:else}
                        {formatModifierCount(modifierEstimatedGain(item) ?? 0)}
                      {/if}
                    {:else}
                      <span class="text-muted-foreground/45">-</span>
                    {/if}
                  </td>
                  <td class="px-3 py-3 text-right text-sm text-muted-foreground relative z-0">
                    {displayPct(item.row.dmgPct).toFixed(1)}%
                  </td>
                  <td class="px-3 py-3 text-right text-sm text-muted-foreground relative z-0">
                    {modifierSourceShare(item).toFixed(1)}%
                  </td>
                  <td class="px-3 py-3 text-right text-sm text-muted-foreground relative z-0">
                    {formatModifierCount(item.row.hits)}
                  </td>
                  <td class="px-3 py-3 text-right text-sm text-muted-foreground relative z-0">
                    {item.row.critRate.toFixed(1)}%
                  </td>
                  <td class="px-3 py-3 text-right text-sm text-muted-foreground relative z-0">
                    {item.row.luckyRate.toFixed(1)}%
                  </td>
                  <TableRowGlow
                    className={selectedModifierPlayer?.className ?? ""}
                    percentage={modifierGlowPercentage(item)}
                  />
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
      {/if}
    {:else if historyDataViewMode === "graph" && historyGraphMetric}
      {@const graph = historyGraphData}
      {@const visibleGraphSeries = visibleHistoryGraphSeries(graph)}
      <div class="rounded border border-border/60 bg-card/30 p-4">
        <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-foreground">
              {graphMetricLabel(historyGraphMetric)} {t("detail.graphTimeline", "Timeline")}
            </h3>
            <p class="text-xs text-muted-foreground">
              {t("detail.graphBucket", "Bucket")}: {formatGraphTime(graph?.bucketMs ?? HISTORY_GRAPH_BUCKET_MS)}
              <span class="mx-1 text-muted-foreground/50">/</span>
              {t("detail.graphMovingWindow", "Window")}: {formatGraphTime(graph?.movingWindowMs ?? HISTORY_GRAPH_MOVING_WINDOW_MS)}
              <span class="mx-1 text-muted-foreground/50">/</span>
              {graphRateLabel(historyGraphMetric)}
            </p>
          </div>
          <div class="text-right text-xs text-muted-foreground">
            <div>
              {t("detail.graphSeries", "Players")}:
              {#if graph && historyGraphHiddenSeries.size > 0}
                {visibleGraphSeries.length}/{historyGraphLegendSeries(graph).length}
              {:else}
                {historyGraphLegendSeries(graph).length}
              {/if}
            </div>
            <div>{t("detail.graphTotal", "Total")}: {formatGraphNumber(graph?.total ?? 0)}</div>
          </div>
        </div>

        {#if graphEntitiesLoading && (!graph || graph.series.length === 0)}
          <div class="rounded border border-border/50 bg-background/30 px-3 py-10 text-center text-sm text-muted-foreground">
            {t("detail.graphLoading", "Loading timeline data...")}
          </div>
        {:else if graphEntitiesError}
          <div class="rounded border border-destructive/40 bg-destructive/10 px-3 py-8 text-center text-sm text-destructive">
            {graphEntitiesError}
          </div>
        {:else if !graph || graph.series.length === 0}
          <div class="rounded border border-border/50 bg-background/30 px-3 py-10 text-center text-sm text-muted-foreground">
            {graphEmptyMessage(historyGraphMetric)}
          </div>
        {:else}
          <div class="overflow-x-auto">
            <svg
              class="min-w-[760px] w-full text-muted-foreground"
              viewBox={`0 0 ${HISTORY_GRAPH_VIEW_WIDTH} ${HISTORY_GRAPH_VIEW_HEIGHT}`}
              role="img"
              aria-label={`${graphMetricLabel(graph.metric)} ${t("detail.graphTimeline", "Timeline")}`}
            >
              <defs>
                {#each visibleGraphSeries as series (series.key)}
                  <linearGradient id={graphSeriesGradientId(series.key, "overall")} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color={series.color} stop-opacity="0.22" />
                    <stop offset="58%" stop-color={series.color} stop-opacity="0.08" />
                    <stop offset="100%" stop-color={series.color} stop-opacity="0" />
                  </linearGradient>
                  <linearGradient id={graphSeriesGradientId(series.key, "moving")} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color={series.color} stop-opacity="0.18" />
                    <stop offset="60%" stop-color={series.color} stop-opacity="0.06" />
                    <stop offset="100%" stop-color={series.color} stop-opacity="0" />
                  </linearGradient>
                {/each}
              </defs>
              <rect
                x={HISTORY_GRAPH_LEFT}
                y={HISTORY_GRAPH_OVERALL_TOP}
                width={HISTORY_GRAPH_PLOT_WIDTH}
                height={HISTORY_GRAPH_PANEL_HEIGHT}
                rx="6"
                fill="transparent"
                stroke="hsl(var(--muted-foreground) / 0.16)"
              />
              <rect
                x={HISTORY_GRAPH_LEFT}
                y={HISTORY_GRAPH_MOVING_TOP}
                width={HISTORY_GRAPH_PLOT_WIDTH}
                height={HISTORY_GRAPH_PANEL_HEIGHT}
                rx="6"
                fill="transparent"
                stroke="hsl(var(--muted-foreground) / 0.16)"
              />
              {#each graph.minorXTicks as tick}
                {@const x = graphX(tick, graph.durationMs)}
                <line
                  x1={x}
                  x2={x}
                  y1={HISTORY_GRAPH_OVERALL_TOP}
                  y2={HISTORY_GRAPH_OVERALL_TOP + HISTORY_GRAPH_PANEL_HEIGHT}
                  stroke="hsl(var(--muted-foreground) / 0.14)"
                  stroke-width="1"
                  stroke-dasharray="2 8"
                />
                <line
                  x1={x}
                  x2={x}
                  y1={HISTORY_GRAPH_MOVING_TOP}
                  y2={HISTORY_GRAPH_MOVING_TOP + HISTORY_GRAPH_PANEL_HEIGHT}
                  stroke="hsl(var(--muted-foreground) / 0.14)"
                  stroke-width="1"
                  stroke-dasharray="2 8"
                />
              {/each}
              {#each graph.overallYTicks as tick}
                {@const y = graphY(tick, graph.maxOverallValue, HISTORY_GRAPH_OVERALL_TOP)}
                <line
                  x1={HISTORY_GRAPH_LEFT}
                  x2={HISTORY_GRAPH_VIEW_WIDTH - HISTORY_GRAPH_RIGHT}
                  y1={y}
                  y2={y}
                  stroke="hsl(var(--muted-foreground) / 0.42)"
                  stroke-width="1"
                  stroke-dasharray={graphGuideLineDasharray(settings.state.history.general.historyGraphGuideLineStyle)}
                  stroke-linecap={graphGuideLineCap(settings.state.history.general.historyGraphGuideLineStyle)}
                />
                <text
                  x={HISTORY_GRAPH_LEFT - 10}
                  y={y + 4}
                  text-anchor="end"
                  font-size="12"
                  fill="currentColor"
                >
                  {formatGraphAxisNumber(tick)}/s
                </text>
              {/each}
              {#each graph.movingYTicks as tick}
                {@const y = graphY(tick, graph.maxMovingValue, HISTORY_GRAPH_MOVING_TOP)}
                <line
                  x1={HISTORY_GRAPH_LEFT}
                  x2={HISTORY_GRAPH_VIEW_WIDTH - HISTORY_GRAPH_RIGHT}
                  y1={y}
                  y2={y}
                  stroke="hsl(var(--muted-foreground) / 0.42)"
                  stroke-width="1"
                  stroke-dasharray={graphGuideLineDasharray(settings.state.history.general.historyGraphGuideLineStyle)}
                  stroke-linecap={graphGuideLineCap(settings.state.history.general.historyGraphGuideLineStyle)}
                />
                <text
                  x={HISTORY_GRAPH_LEFT - 10}
                  y={y + 4}
                  text-anchor="end"
                  font-size="12"
                  fill="currentColor"
                >
                  {formatGraphAxisNumber(tick)}/s
                </text>
              {/each}
              {#each graph.xTicks as tick}
                {@const x = graphX(tick, graph.durationMs)}
                <line
                  x1={x}
                  x2={x}
                  y1={HISTORY_GRAPH_OVERALL_TOP}
                  y2={HISTORY_GRAPH_OVERALL_TOP + HISTORY_GRAPH_PANEL_HEIGHT}
                  stroke="hsl(var(--muted-foreground) / 0.24)"
                  stroke-width="1"
                  stroke-dasharray="2 6"
                />
                <line
                  x1={x}
                  x2={x}
                  y1={HISTORY_GRAPH_MOVING_TOP}
                  y2={HISTORY_GRAPH_MOVING_TOP + HISTORY_GRAPH_PANEL_HEIGHT}
                  stroke="hsl(var(--muted-foreground) / 0.24)"
                  stroke-width="1"
                  stroke-dasharray="2 6"
                />
                <text
                  x={x}
                  y={HISTORY_GRAPH_OVERALL_TOP + HISTORY_GRAPH_PANEL_HEIGHT + 22}
                  text-anchor="middle"
                  font-size="12"
                  fill="currentColor"
                >
                  {formatGraphTime(tick)}
                </text>
                <text
                  x={x}
                  y={HISTORY_GRAPH_MOVING_TOP + HISTORY_GRAPH_PANEL_HEIGHT + 22}
                  text-anchor="middle"
                  font-size="12"
                  fill="currentColor"
                >
                  {formatGraphTime(tick)}
                </text>
              {/each}
              <line
                x1={HISTORY_GRAPH_LEFT}
                x2={HISTORY_GRAPH_VIEW_WIDTH - HISTORY_GRAPH_RIGHT}
                y1={HISTORY_GRAPH_OVERALL_TOP + HISTORY_GRAPH_PANEL_HEIGHT}
                y2={HISTORY_GRAPH_OVERALL_TOP + HISTORY_GRAPH_PANEL_HEIGHT}
                stroke="hsl(var(--muted-foreground) / 0.36)"
                stroke-width="1"
              />
              <line
                x1={HISTORY_GRAPH_LEFT}
                x2={HISTORY_GRAPH_VIEW_WIDTH - HISTORY_GRAPH_RIGHT}
                y1={HISTORY_GRAPH_MOVING_TOP + HISTORY_GRAPH_PANEL_HEIGHT}
                y2={HISTORY_GRAPH_MOVING_TOP + HISTORY_GRAPH_PANEL_HEIGHT}
                stroke="hsl(var(--muted-foreground) / 0.36)"
                stroke-width="1"
              />
              <text
                x={HISTORY_GRAPH_LEFT + HISTORY_GRAPH_PLOT_WIDTH / 2}
                y={HISTORY_GRAPH_OVERALL_TOP + HISTORY_GRAPH_PANEL_HEIGHT + 54}
                text-anchor="middle"
                font-size="18"
                fill="currentColor"
                opacity="0.68"
              >
                {graphOverallLabel(graph.metric)}
              </text>
              <text
                x={HISTORY_GRAPH_LEFT + HISTORY_GRAPH_PLOT_WIDTH / 2}
                y={HISTORY_GRAPH_VIEW_HEIGHT - 4}
                text-anchor="middle"
                font-size="18"
                fill="currentColor"
                opacity="0.68"
              >
                {graphMovingAverageLabel(graph.metric)}
              </text>
              {#each visibleGraphSeries as series (series.key)}
                <polygon
                  points={graphAreaPoints(series.overallPoints, HISTORY_GRAPH_OVERALL_TOP)}
                  fill={`url(#${graphSeriesGradientId(series.key, "overall")})`}
                />
                <polygon
                  points={graphAreaPoints(series.movingAveragePoints, HISTORY_GRAPH_MOVING_TOP)}
                  fill={`url(#${graphSeriesGradientId(series.key, "moving")})`}
                />
              {/each}
              {#each graph.overallYTicks as tick}
                {@const y = graphY(tick, graph.maxOverallValue, HISTORY_GRAPH_OVERALL_TOP)}
                <line
                  x1={HISTORY_GRAPH_LEFT}
                  x2={HISTORY_GRAPH_VIEW_WIDTH - HISTORY_GRAPH_RIGHT}
                  y1={y}
                  y2={y}
                  stroke="rgb(148 163 184)"
                  stroke-opacity="0.38"
                  stroke-width="1.2"
                  pointer-events="none"
                  vector-effect="non-scaling-stroke"
                />
              {/each}
              {#each graph.movingYTicks as tick}
                {@const y = graphY(tick, graph.maxMovingValue, HISTORY_GRAPH_MOVING_TOP)}
                <line
                  x1={HISTORY_GRAPH_LEFT}
                  x2={HISTORY_GRAPH_VIEW_WIDTH - HISTORY_GRAPH_RIGHT}
                  y1={y}
                  y2={y}
                  stroke="rgb(148 163 184)"
                  stroke-opacity="0.38"
                  stroke-width="1.2"
                  pointer-events="none"
                  vector-effect="non-scaling-stroke"
                />
              {/each}
              {#each visibleGraphSeries as series (series.key)}
                <polyline
                  points={graphSeriesPoints(series.overallPoints)}
                  fill="none"
                  stroke={series.color}
                  stroke-width="2.65"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  opacity="0.94"
                >
                  <title>{series.name}: {formatGraphNumber(series.total)} total, {formatGraphNumber(series.average)} avg {graphRateLabel(graph.metric)}</title>
                </polyline>
                <polyline
                  points={graphSeriesPoints(series.movingAveragePoints)}
                  fill="none"
                  stroke={series.color}
                  stroke-width="2.45"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  opacity="0.9"
                >
                  <title>{series.name}: {formatGraphNumber(series.peak)} peak {graphRateLabel(graph.metric)}</title>
                </polyline>
                {#each series.deathMarkers as deathMs}
                  {@const x = graphX(deathMs, graph.durationMs)}
                  <g transform={`translate(${x} ${HISTORY_GRAPH_OVERALL_TOP + HISTORY_GRAPH_PANEL_HEIGHT - 9})`}>
                    <title>{series.name} - {t("detail.graphDeath", "death")} @ {formatGraphTime(deathMs)}</title>
                    <path
                      d="M0 -7.5c-4.6 0-8 3.4-8 7.9 0 3 1.5 5.3 4 6.4v3.2h8V6.8c2.5-1.1 4-3.4 4-6.4 0-4.5-3.4-7.9-8-7.9Z"
                      fill={series.color}
                      stroke="hsl(var(--background))"
                      stroke-width="1.4"
                      stroke-linejoin="round"
                    />
                    <circle cx="-2.8" cy="0.3" r="1.45" fill="hsl(var(--background))" />
                    <circle cx="2.8" cy="0.3" r="1.45" fill="hsl(var(--background))" />
                    <path d="M0 2.3l-1.5 2.5h3L0 2.3Z" fill="hsl(var(--background))" />
                    <line x1="-2.4" x2="2.4" y1="7.1" y2="7.1" stroke="hsl(var(--background))" stroke-width="1.2" stroke-linecap="round" />
                  </g>
                  <g transform={`translate(${x} ${HISTORY_GRAPH_MOVING_TOP + HISTORY_GRAPH_PANEL_HEIGHT - 9})`}>
                    <title>{series.name} - {t("detail.graphDeath", "death")} @ {formatGraphTime(deathMs)}</title>
                    <path
                      d="M0 -7.5c-4.6 0-8 3.4-8 7.9 0 3 1.5 5.3 4 6.4v3.2h8V6.8c2.5-1.1 4-3.4 4-6.4 0-4.5-3.4-7.9-8-7.9Z"
                      fill={series.color}
                      stroke="hsl(var(--background))"
                      stroke-width="1.4"
                      stroke-linejoin="round"
                    />
                    <circle cx="-2.8" cy="0.3" r="1.45" fill="hsl(var(--background))" />
                    <circle cx="2.8" cy="0.3" r="1.45" fill="hsl(var(--background))" />
                    <path d="M0 2.3l-1.5 2.5h3L0 2.3Z" fill="hsl(var(--background))" />
                    <line x1="-2.4" x2="2.4" y1="7.1" y2="7.1" stroke="hsl(var(--background))" stroke-width="1.2" stroke-linecap="round" />
                  </g>
                {/each}
              {/each}
              <g pointer-events="none" shape-rendering="crispEdges">
                {#each graph.overallYTicks as tick}
                  {@const y = graphY(tick, graph.maxOverallValue, HISTORY_GRAPH_OVERALL_TOP)}
                  <line
                    x1={HISTORY_GRAPH_LEFT}
                    x2={HISTORY_GRAPH_VIEW_WIDTH - HISTORY_GRAPH_RIGHT}
                    y1={y}
                    y2={y}
                    stroke="rgb(148 163 184)"
                    stroke-opacity="0.5"
                    stroke-width="1.25"
                    vector-effect="non-scaling-stroke"
                  />
                {/each}
                {#each graph.movingYTicks as tick}
                  {@const y = graphY(tick, graph.maxMovingValue, HISTORY_GRAPH_MOVING_TOP)}
                  <line
                    x1={HISTORY_GRAPH_LEFT}
                    x2={HISTORY_GRAPH_VIEW_WIDTH - HISTORY_GRAPH_RIGHT}
                    y1={y}
                    y2={y}
                    stroke="rgb(148 163 184)"
                    stroke-opacity="0.5"
                    stroke-width="1.25"
                    vector-effect="non-scaling-stroke"
                  />
                {/each}
              </g>
            </svg>
          </div>

          <div class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {#each historyGraphLegendSeries(graph) as series (series.key)}
              {@const seriesVisible = historyGraphSeriesIsVisible(series.key)}
              <button
                type="button"
                class="flex min-w-0 items-center gap-2 rounded border px-2 py-1.5 text-left text-xs transition-colors {seriesVisible
                  ? 'border-border/55 bg-background/30 text-foreground hover:border-border hover:bg-background/45'
                  : 'border-border/30 bg-background/10 text-muted-foreground/55 opacity-60 hover:opacity-85'}"
                aria-pressed={seriesVisible}
                title={seriesVisible
                  ? t("detail.graphHideSeries", "Hide this player's line")
                  : t("detail.graphShowSeries", "Show this player's line")}
                onclick={() => toggleHistoryGraphSeries(series.key)}
              >
                <span
                  class="size-2.5 shrink-0 rounded-full {seriesVisible ? '' : 'opacity-35'}"
                  style={`background-color: ${series.color}`}
                ></span>
                <span class="min-w-0 flex-1 truncate {seriesVisible ? 'text-foreground' : 'text-muted-foreground'}" title={series.name}>
                  {series.name}
                </span>
                <span class="shrink-0 tabular-nums text-muted-foreground">
                  {formatGraphNumber(series.total)}
                </span>
                <span class="shrink-0 tabular-nums text-muted-foreground/70">
                  {t("detail.graphAverageShort", "avg")} {formatGraphNumber(series.average)}
                </span>
                <span class="shrink-0 tabular-nums text-muted-foreground/70">
                  {t("detail.graphPeakShort", "peak")} {formatGraphNumber(series.peak)} {graphRateLabel(graph.metric)}
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
    <div class="history-sticky-frame rounded border border-border/60 bg-card">
        <table class="history-sticky-table w-full border-separate border-spacing-0">
          <thead>
            <tr class="bg-popover">
              <th
                class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >{t("detail.player", "玩家")}</th
              >
              {#each visiblePlayerColumns as col (col.key)}
                <th
                  class="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground"
                  >{thLabel(col)}</th
                >
              {/each}
            </tr>
          </thead>
          <tbody class="bg-background/40">
            {#if encounterEntitiesLoading && displayedPlayers.length === 0}
              <tr class="border-t border-border/40">
                <td
                  class="px-3 py-8 text-center text-sm text-muted-foreground"
                  colspan={visiblePlayerColumns.length + 1}
                >
                  {t("detail.loadingEncounterRows", "Loading encounter rows...")}
                </td>
              </tr>
            {:else}
            {#each displayedPlayers as p (playerIdentityKey(p))}
              {@const iconSpecName = getDisplayIconSpecName({
                classSpecName: p.classSpecName,
                showYourNameSetting: settings.state.history.general.showYourName,
                showOthersNameSetting:
                  settings.state.history.general.showOthersName,
                isLocalPlayer: p.isLocalPlayer,
              })}
              <tr
                class="relative border-t border-border/40 hover:bg-muted/60 transition-colors cursor-pointer"
                onclick={() =>
                  viewPlayerSkills(
                    p.uid,
                    activeTab === "healing"
                      ? "heal"
                      : activeTab === "tanked"
                        ? "tanked"
                        : "dps",
                    activeTab === "damage" ? overviewTargetUid : null,
                    p.uuid ?? null,
                    activeTab === "damage" ? overviewTargetUuid : null,
                  )}
              >
                <td
                  class="px-3 py-3 text-sm text-muted-foreground relative z-0"
                >
                  <div class="flex items-center gap-2 h-full">
                    <ClassSpecIcon
                      class="size-5 object-contain"
                      className={p.className}
                      classSpecName={iconSpecName}
                      alt={t("detail.classIcon", "职业图标")}
                      tooltipText={p.classDisplay || t("detail.unknownClass", "Unknown Class")}
                    />
                    {#if SETTINGS.history.general.state.showPlayerImagineBadges !== false}
                      <PlayerImagineBadges
                        imagines={p.playerImagines}
                        size={scaledBadgeSize(30, SETTINGS.history.general.state.playerImagineBadgeScale)}
                      />
                    {/if}
                    <span class="inline-flex min-w-0 items-center gap-1 truncate">
                      {#if (p.abilityScore > 0 && (p.isLocalPlayer
                        ? SETTINGS.history.general.state.showYourAbilityScore
                        : SETTINGS.history.general.state.showOthersAbilityScore)) || (p.seasonStrength > 0 && (p.isLocalPlayer
                        ? SETTINGS.history.general.state.showYourSeasonStrength
                        : SETTINGS.history.general.state.showOthersSeasonStrength))}
                        <span class="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
                          {#if p.abilityScore > 0 && (p.isLocalPlayer
                            ? SETTINGS.history.general.state.showYourAbilityScore
                            : SETTINGS.history.general.state.showOthersAbilityScore)}
                            {#if SETTINGS.history.general.state.shortenAbilityScore}
                              <AbbreviatedNumber num={p.abilityScore} />
                            {:else}
                              <span>{p.abilityScore}</span>
                            {/if}
                          {/if}
                          {#if p.seasonStrength > 0 && (p.isLocalPlayer
                            ? SETTINGS.history.general.state.showYourSeasonStrength
                            : SETTINGS.history.general.state.showOthersSeasonStrength)}
                            <span>·</span>
                            <span>({p.seasonStrength})</span>
                          {/if}
                        </span>
                      {/if}
                      {#if SETTINGS.history.general.state.showOceanWeaponBadge !== false}
                        <OceanWeaponBadge
                          weapon={p.oceanWeapon}
                          size={scaledBadgeSize(23, SETTINGS.history.general.state.oceanWeaponBadgeScale)}
                        />
                      {/if}
                      <span
                        class="truncate"
                        {@attach tooltip(() => `UID: #${p.uid}`)}
                      >
                        {getDisplayName({
                          player: {
                            uid: p.uid,
                            name: p.name,
                            className: p.className,
                            classSpecName: p.classSpecName,
                          },
                          showYourNameSetting:
                            settings.state.history.general.showYourName,
                          showOthersNameSetting:
                            settings.state.history.general.showOthersName,
                          isLocalPlayer: p.isLocalPlayer,
                        })}
                      </span>
                      {#if p.isLocalPlayer}
                        <span class="ml-1 text-[oklch(0.65_0.1_250)]"
                          >{`(${t("detail.you", "你")})`}</span
                        >
                      {/if}
                    </span>
                  </div>
                </td>
                {#each visiblePlayerColumns as col (col.key)}
                  <td
                    class="px-3 py-3 text-right text-sm text-muted-foreground relative z-0"
                  >
                    {#if (activeTab === "damage" && (col.key === "totalDmg" || col.key === "effectiveTotal" || col.key === "bossDmg" || col.key === "bossDps" || col.key === "dps" || col.key === "effectiveDps" || col.key === "tdps") && SETTINGS.history.general.state.shortenDps) || (activeTab === "healing" && (col.key === "healDealt" || col.key === "effectiveHeal" || col.key === "hps" || col.key === "ehps") && SETTINGS.history.general.state.shortenDps) || (activeTab === "tanked" && (col.key === "damageTaken" || col.key === "tankedPS") && SETTINGS.history.general.state.shortenTps)}
                      {#if activeTab === "tanked" ? SETTINGS.history.general.state.shortenTps : SETTINGS.history.general.state.shortenDps}
                        <AbbreviatedNumber
                          num={p[col.key] ?? 0}
                          decimalPlaces={abbreviatedDecimalPlaces}
                        />
                      {:else}
                        {col.format(p[col.key] ?? 0)}
                      {/if}
                    {:else}
                      {col.format(p[col.key] ?? 0)}
                    {/if}
                  </td>
                {/each}
                <TableRowGlow
                  className={p.className}
                  classSpecName={p.classSpecName}
                  percentage={activeTab === "healing"
                    ? SETTINGS.history.general.state.relativeToTopHealPlayer &&
                      maxHealPlayer > 0
                      ? (p.healDealt / maxHealPlayer) * 100
                      : p.healPct
                    : activeTab === "tanked"
                      ? SETTINGS.history.general.state
                          .relativeToTopTankedPlayer && maxTankedPlayer > 0
                        ? (p.damageTaken / maxTankedPlayer) * 100
                        : p.tankedPct
                      : SETTINGS.history.general.state.relativeToTopDPSPlayer &&
                          maxDpsPlayer > 0
                        ? (p.totalDmg / maxDpsPlayer) * 100
                        : p.dmgPct}
                />
              </tr>
            {/each}
            {/if}
          </tbody>
        </table>
    </div>
    {/if}
  {:else if hasSelectedChar && selectedPlayer && selectedEntity && skillType === "death"}
    <div class="mb-4">
      {#if selectedDeathTs == null}
        <DeathList
          playerName={getDisplayName({
            player: {
              uid: selectedPlayer.uid,
              name: selectedPlayer.name,
              className: selectedPlayer.className,
              classSpecName: selectedPlayer.classSpecName,
            },
            showYourNameSetting: settings.state.history.general.showYourName,
            showOthersNameSetting: settings.state.history.general.showOthersName,
            isLocalPlayer: selectedPlayer.isLocalPlayer,
          })}
          className={selectedPlayer.className}
          classSpecName={selectedPlayer.classSpecName}
          isLocalPlayer={selectedPlayer.isLocalPlayer}
          deaths={selectedEntity.deaths ?? []}
          fightStartTimestampMs={encounter?.startedAtMs ?? null}
          onSelect={(ts) => viewDeathReplay(selectedPlayer.uid, ts, selectedPlayer.uuid ?? null)}
          onBack={backToDeathPlayerList}
          variant="history"
        />
      {:else if selectedDeathRecord}
        <DeathReplayDetail
          playerName={getDisplayName({
            player: {
              uid: selectedPlayer.uid,
              name: selectedPlayer.name,
              className: selectedPlayer.className,
              classSpecName: selectedPlayer.classSpecName,
            },
            showYourNameSetting: settings.state.history.general.showYourName,
            showOthersNameSetting: settings.state.history.general.showOthersName,
            isLocalPlayer: selectedPlayer.isLocalPlayer,
          })}
          className={selectedPlayer.className}
          classSpecName={selectedPlayer.classSpecName}
          isLocalPlayer={selectedPlayer.isLocalPlayer}
          record={selectedDeathRecord}
          onBack={backToDeathList}
          variant="history"
        />
      {:else}
        <div class="rounded border border-border/60 bg-card/30 p-4 text-sm text-muted-foreground">
          {t("detail.deathRecordMissing", "Death replay record not found.")}
        </div>
      {/if}
    </div>
  {:else if hasSelectedChar && selectedPlayer && selectedEntity}
    <!-- Player Skills View -->
    <div class="mb-4">
      <div class="skill-detail-header mb-2">
        <div class="flex min-w-0 items-start gap-3">
          <button
            onclick={backToEncounter}
            class="p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors rounded hover:bg-neutral-800"
            aria-label={t("detail.backToOverview", "返回战斗概览")}
          >
            <svg
              class="w-5 h-5"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <div class="skill-detail-title-block min-w-0">
            <h2 class="text-xl font-semibold text-foreground">{t("detail.skillDetails", "技能明细")}</h2>
            <div class="text-sm text-neutral-400">
              {t("detail.playerLabel", "玩家")}: {getDisplayName({
                player: {
                  uid: selectedPlayer.uid,
                  name: selectedPlayer.name,
                  className: selectedPlayer.className,
                  classSpecName: selectedPlayer.classSpecName,
                },
                showYourNameSetting: settings.state.history.general.showYourName,
                showOthersNameSetting:
                  settings.state.history.general.showOthersName,
                isLocalPlayer: selectedPlayer.isLocalPlayer,
              })} <span class="text-neutral-500">#{selectedPlayer.uid}</span>
            </div>
            {#if encounter}
              <div class="skill-detail-scene-info">
                <div class="skill-detail-scene-name">
                  {encounterSceneDisplayName(encounter)}
                </div>
                <div class="skill-detail-scene-meta">
                  <span>{encounterBossSummary(encounter)}</span>
                  <span>{new Date(encounter.startedAtMs).toLocaleString()}</span>
                  <span>{t("detail.duration", "Duration")}: {formatEncounterDuration(encounterDurationSeconds)}</span>
                  <span>#{encounter.id}</span>
                </div>
              </div>
            {/if}
          </div>
        </div>

        {#if selectedSkillSummaryGroups.length > 0}
          <div
            class="history-summary-panel skill-detail-summary"
            aria-label={t("detail.summary.aria", "Player stat summary")}
          >
            {#each selectedSkillSummaryGroups as group (group.key)}
              <section
                class="history-summary-group"
                style={`grid-column: span ${group.columns}; --summary-section-columns: ${group.columns};`}
              >
                <div class="history-summary-heading">{group.label}</div>
                {#each group.rows as row}
                  {#each row as item}
                    {#if item}
                      <span class="history-summary-cell history-summary-label summary-accent-{item.accent}">
                        {item.label}
                      </span>
                      <span class="history-summary-cell history-summary-value">
                        {item.value}
                      </span>
                    {:else}
                      <span
                        class="history-summary-cell history-summary-empty"
                        aria-hidden="true"
                      ></span>
                      <span
                        class="history-summary-cell history-summary-empty"
                        aria-hidden="true"
                      ></span>
                    {/if}
                  {/each}
                {/each}
              </section>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    {#if skillType === "heal"}
      <div class="mb-3 rounded border border-border/60 bg-card/30 p-3">
        <div class="text-xs uppercase tracking-wider text-muted-foreground mb-2">
          {t("detail.healTargetDistribution", "治疗目标分布")}
        </div>
        {#if healTargetSummary.length === 0}
          <div class="text-sm text-muted-foreground">{t("detail.noHealTargetData", "暂无治疗目标数据")}</div>
        {:else}
          <div class="space-y-1.5">
            {#each healTargetSummary as target (targetIdentityKey(target))}
              {@const pct = healTargetTotal > 0 ? (target.totalValue / healTargetTotal) * 100 : 0}
              <div class="text-sm">
                <div class="flex items-center justify-between gap-2 text-muted-foreground">
                  <span class="truncate">{target.targetName}</span>
                  <span class="shrink-0">
                    {target.totalValue.toLocaleString()} ({pct.toFixed(1)}%)
                  </span>
                </div>
                <div class="mt-1 h-1.5 rounded bg-muted/40 overflow-hidden">
                  <div class="h-full bg-primary/70" style="width: {pct}%;"></div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <div class="history-sticky-frame rounded border border-border/60 bg-card">
      <table class="history-sticky-table w-full border-separate border-spacing-0">
        <thead>
          <tr class="bg-popover">
            <th
              class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >{t("detail.skillColumn", "技能")}</th
            >
            {#each visibleSkillColumns as col (col.key)}
              <th
                class="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >{thLabel(col)}</th
              >
            {/each}
          </tr>
        </thead>
        <tbody class="bg-background/40">
          {#if targetDetailsLoading && (selectedSkillTargetUid !== null || selectedSkillTargetUuid !== null) && flatSkillRows.length === 0}
            <tr class="border-t border-border/40">
              <td
                class="px-3 py-8 text-center text-sm text-muted-foreground"
                colspan={visibleSkillColumns.length + 1}
              >
                {t("detail.loadingTargetSkillRows", "Loading target skill rows...")}
              </td>
            </tr>
          {:else}
          {#each flatSkillRows as item (item.key)}
            {@const skillIconPath = historySkillIconPath(item)}
            <tr
              class="relative border-t border-border/40 hover:bg-muted/60 transition-colors"
            >
              <td class="px-3 py-3 text-sm text-muted-foreground relative z-0"
              >
                {#if item.kind === "group"}
                  <button
                    class="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
                    onclick={() => toggleGroup(item.row.recountId)}
                  >
                    <svg
                      class="size-3 shrink-0 text-muted-foreground/70 transition-transform duration-150 {expandedGroups.has(
                        item.row.recountId,
                      )
                        ? 'rotate-90'
                        : ''}"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2.5"
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    {#if skillIconPath}
                      <img
                        class="size-4 shrink-0 rounded-sm object-cover"
                        src={skillIconPath}
                        alt=""
                        loading="lazy"
                      />
                    {/if}
                    <span
                      class="truncate"
                      title={shouldShowUidHover()
                        ? buildHistoryGroupHoverText(item.row.recountId, SETTINGS.live.general.state.language as LocaleCode)
                        : undefined}
                    >
                      {historyGroupLabel(item.row, SETTINGS.live.general.state.language as LocaleCode)}
                    </span>
                    {#if SETTINGS.live.general.state.skillIdDisplayMode === 'column'}
                      <span class="text-[10px] text-muted-foreground/50 shrink-0">
                        #{item.row.recountId}
                      </span>
                    {/if}
                    {#if !skillHitsColumnVisible}
                      <span
                        class="shrink-0 rounded border border-border/50 bg-background/60 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground"
                        title={t("detail.recountGroupHitCountHelp", "Total emitted hits across this recount group. Expand the row for per-damage-source hits.")}
                      >
                        {historyHitCountLabel(item.row.hits)}
                      </span>
                    {/if}
                  </button>
                {:else}
                  {@const historyRowLabel = historySkillLabel(item.row, SETTINGS.live.general.state.language as LocaleCode)}
                  {@const historyRowDetailLabel = historySkillDetailLabel(item.row, SETTINGS.live.general.state.language as LocaleCode)}
                  <div
                    class="inline-flex items-center gap-1.5"
                    style="padding-left: {item.depth * 16}px;"
                  >
                    {#if item.depth > 0}
                      <span class="w-3 shrink-0 flex justify-center">
                        <span class="size-1 rounded-full bg-muted-foreground/35"></span>
                      </span>
                    {:else}
                      <span class="w-3 shrink-0"></span>
                    {/if}
                    {#if skillIconPath}
                      <img
                        class="size-4 shrink-0 rounded-sm object-cover"
                        src={skillIconPath}
                        alt=""
                        loading="lazy"
                      />
                    {/if}
                    <span
                      class="truncate"
                      title={shouldShowUidHover()
                        ? buildHistorySkillHoverText(item.row.skillId, SETTINGS.live.general.state.language as LocaleCode)
                        : undefined}
                    >
                      {historyRowLabel}
                    </span>
                    {#if historyRowDetailLabel}
                      <span class="max-w-[18rem] truncate text-xs text-muted-foreground/70">
                        · {historyRowDetailLabel}
                      </span>
                    {/if}
                    {#if SETTINGS.live.general.state.skillIdDisplayMode === 'column'}
                      <span class="text-[10px] text-muted-foreground/50 shrink-0">
                        #{item.row.skillId}
                      </span>
                    {/if}
                    {#if !skillHitsColumnVisible}
                      <span
                        class="shrink-0 rounded border border-border/50 bg-background/60 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground"
                        title={t("detail.damageSourceHitCountHelp", "Emitted hit packets for this damage source.")}
                      >
                        {historyHitCountLabel(item.row.hits)}
                      </span>
                    {/if}
                  </div>
                {/if}
              </td
              >
              {#each visibleSkillColumns as col (col.key)}
                <td
                  class="px-3 py-3 text-right text-sm text-muted-foreground relative z-0"
                >
                  {#if (col.key === "totalDmg" || col.key === "effectiveTotal" || col.key === "dps" || col.key === "effectiveDps") && (skillType === "tanked" ? SETTINGS.history.general.state.shortenTps : SETTINGS.history.general.state.shortenDps)}
                    <AbbreviatedNumber
                      num={skillCellValue(item, col.key)}
                      decimalPlaces={abbreviatedDecimalPlaces}
                    />
                  {:else if col.key === "property" || col.key === "damageMode"}
                    {localizedDamageColumnValue(col, item.row[col.key] ?? null)}
                  {:else}
                    {col.format(skillCellValue(item, col.key))}
                  {/if}
                </td>
              {/each}
              <TableRowGlow
                className={selectedPlayer.className}
                percentage={skillType === "heal"
                  ? SETTINGS.history.general.state.relativeToTopHealSkill &&
                    maxSkillTotal > 0
                    ? (rowTotalDmg(item) / maxSkillTotal) * 100
                    : rowDmgPct(item)
                  : skillType === "tanked"
                    ? SETTINGS.history.general.state.relativeToTopTankedSkill &&
                      maxSkillTotal > 0
                      ? (rowTotalDmg(item) / maxSkillTotal) * 100
                      : rowDmgPct(item)
                    : SETTINGS.history.general.state.relativeToTopDPSSkill &&
                        maxSkillTotal > 0
                      ? (rowTotalDmg(item) / maxSkillTotal) * 100
                      : rowDmgPct(item)}
              />
            </tr>
          {/each}
          {/if}
        </tbody>
      </table>
    </div>
  {:else}
    <div class="text-neutral-400">{t("detail.loading", "加载中...")}</div>
  {/if}
</div>

<!-- Delete Confirmation Modal -->
{#if showDeleteModal}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center"
    role="dialog"
    aria-modal="true"
    aria-labelledby="delete-modal-title"
  >
    <!-- Backdrop -->
    <button
      class="absolute inset-0 bg-black/60 backdrop-blur-sm"
      onclick={closeDeleteModal}
      aria-label={t("detail.closeModal", "关闭弹窗")}
    ></button>

    <!-- Modal Content -->
    <div
      class="relative bg-card border border-border rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
    >
      <div class="flex items-start gap-4">
        <!-- Warning Icon -->
        <div
          class="flex-shrink-0 w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center"
        >
          <svg
            class="w-5 h-5 text-destructive"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        <div class="flex-1">
          <h3
            id="delete-modal-title"
            class="text-lg font-semibold text-foreground"
          >
            {t("detail.deleteModalTitle", "删除战斗记录")}
          </h3>
          <p class="mt-2 text-sm text-muted-foreground">
            {t("detail.deleteModalDescription", "确定要删除这条战斗记录吗？此操作无法撤销，所有关联数据都会被永久移除。")}
          </p>
        </div>
      </div>

      <!-- Actions -->
      <div class="mt-6 flex justify-end gap-3">
        <button
          onclick={closeDeleteModal}
          disabled={isDeleting}
          class="px-4 py-2 text-sm rounded-md border border-border bg-popover text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t("detail.cancel", "取消")}
        </button>
        <button
          onclick={confirmDeleteEncounter}
          disabled={isDeleting}
          class="px-4 py-2 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          {#if isDeleting}
            <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              ></circle>
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            {t("detail.deleting", "删除中...")}
          {:else}
            {t("detail.delete", "删除")}
          {/if}
        </button>
      </div>
  </div>
</div>
{/if}

<style>
  .skill-detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .skill-detail-title-block {
    flex: 0 1 34rem;
    max-width: min(34rem, 100%);
  }

  .skill-detail-scene-info {
    display: flex;
    max-width: 100%;
    flex-direction: column;
    gap: 0.2rem;
    margin-top: 0.38rem;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .skill-detail-scene-name {
    color: var(--foreground);
    font-size: 0.86rem;
    font-weight: 650;
    line-height: 1.3;
  }

  .skill-detail-scene-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.18rem 0.65rem;
    color: var(--muted-foreground);
    font-size: 0.76rem;
    line-height: 1.3;
  }

  .skill-detail-scene-meta span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .history-summary-rail {
    display: flex;
    position: absolute;
    top: 0;
    right: 0;
    z-index: 2;
    width: min(1180px, calc(100% - 500px));
    min-width: 0;
    height: 7.8rem;
    max-height: 7.8rem;
    overflow: hidden;
    align-items: flex-start;
    justify-content: flex-end;
    padding: 0.05rem 0 0.45rem 0;
  }

  .history-overview-summary {
    display: flex;
    width: 100%;
    align-items: flex-start;
    justify-content: flex-end;
  }

  .history-summary-panel {
    --summary-row-height: 1.28rem;
    display: grid;
    width: 100%;
    max-width: min(1180px, 100%);
    height: auto;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    align-items: start;
    overflow: hidden;
    padding: 0 0.35rem 0.42rem 0.35rem;
  }

  .skill-detail-summary {
    flex: 1 1 min(1120px, 64vw);
    justify-content: stretch;
    margin-left: auto;
  }

  .history-summary-group {
    display: grid;
    grid-template-columns: repeat(var(--summary-section-columns), minmax(0, 1fr));
    grid-template-rows: 1.05rem repeat(4, var(--summary-row-height));
    min-width: 0;
    height: calc(1.05rem + (4 * var(--summary-row-height)));
    min-height: 0;
    overflow: hidden;
    border-top: 1px solid hsl(var(--border) / 0.45);
    border-bottom: 1px solid hsl(var(--border) / 0.45);
    border-left: 1px solid hsl(var(--border) / 0.62);
    background: hsl(var(--card) / 0.12);
  }

  .history-summary-group:first-child {
    border-left-color: hsl(var(--border) / 0.45);
  }

  .history-summary-group:last-child {
    border-right: 1px solid hsl(var(--border) / 0.45);
  }

  .history-summary-heading {
    grid-column: 1 / -1;
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: center;
    border-bottom: 1px solid hsl(var(--border) / 0.45);
    color: hsl(var(--muted-foreground));
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0;
    line-height: 1;
    text-align: center;
    white-space: nowrap;
  }

  .history-summary-cell {
    display: flex;
    min-height: 0;
    min-width: 0;
    align-items: center;
    border-bottom: 1px solid hsl(var(--border) / 0.26);
    overflow: hidden;
    padding: 0 0.32rem;
    font-size: 0.66rem;
    line-height: 1;
  }

  .history-summary-label {
    justify-content: flex-end;
    color: hsl(var(--muted-foreground));
    font-weight: 750;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-summary-value {
    justify-content: flex-start;
    color: hsl(var(--foreground));
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-summary-empty {
    pointer-events: none;
  }

  .summary-accent-damage {
    color: #f87171;
  }

  .summary-accent-healing {
    color: #4ade80;
  }

  .summary-accent-tanked {
    color: #60a5fa;
  }

  .summary-accent-time {
    color: hsl(var(--muted-foreground));
  }

  @media (max-width: 1280px) {
    .skill-detail-header {
      flex-direction: column;
    }

    .history-summary-rail {
      position: static;
      width: 100%;
      height: auto;
      max-height: none;
      overflow: visible;
    }

    .history-overview-summary,
    .history-summary-panel,
    .skill-detail-summary {
      justify-content: flex-start;
    }

    .history-summary-panel {
      grid-template-columns: repeat(10, minmax(4.75rem, 1fr));
      max-width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
    }

    .skill-detail-summary {
      flex: 0 1 auto;
      margin-left: 0;
      width: 100%;
    }
  }

  :global(.history-sticky-frame) {
    --history-sticky-header-height: 44px;
    --history-sticky-frame-bg: var(--card);
    --history-sticky-header-bg: var(--popover);
    --history-sticky-border-color: var(--border);
    box-sizing: border-box;
    max-height: clamp(280px, calc(100dvh - 380px), 64vh);
    min-height: 0;
    margin-bottom: clamp(1rem, 3dvh, 2rem);
    overflow: auto;
    overscroll-behavior: contain;
    padding-bottom: 0.75rem;
    position: relative;
    scroll-padding-bottom: 0.75rem;
    isolation: isolate;
    background: var(--history-sticky-frame-bg) !important;
  }

  :global(.history-sticky-table) {
    border-collapse: separate;
    border-spacing: 0;
    position: relative;
  }

  :global(.history-sticky-table thead) {
    position: sticky;
    top: 0;
    z-index: 200 !important;
    isolation: isolate;
    background: var(--history-sticky-header-bg) !important;
    transform: translateZ(0);
    box-shadow: 0 1px 0 var(--history-sticky-border-color);
  }

  :global(.history-sticky-table thead::before) {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    background: var(--history-sticky-header-bg) !important;
    pointer-events: none;
  }

  :global(.history-sticky-table thead tr) {
    position: sticky;
    top: 0;
    z-index: 201 !important;
    background: var(--history-sticky-header-bg) !important;
  }

  :global(.history-sticky-table tbody),
  :global(.history-sticky-table tbody tr) {
    position: relative;
    z-index: 0 !important;
  }

  :global(.history-sticky-table th) {
    position: sticky;
    top: 0;
    z-index: 203 !important;
    isolation: isolate;
    background-color: var(--history-sticky-header-bg) !important;
    background-image: linear-gradient(var(--history-sticky-header-bg), var(--history-sticky-header-bg)) !important;
    background-clip: border-box;
    transform: translateZ(0);
    box-shadow: 0 1px 0 var(--history-sticky-border-color);
  }

  :global(.history-sticky-table tbody td) {
    position: relative;
    z-index: 0 !important;
  }

  :global(.history-sticky-table tbody td.absolute) {
    z-index: 0 !important;
  }

  :global(.history-sticky-table .table-row-glow-anchor) {
    display: none !important;
  }
</style>
