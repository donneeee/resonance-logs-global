import type {
  HeaderInfo,
  LiveDataPayload,
  PlayerRow,
  RawCombatStats,
  RawEntityData,
  RawSkillStats,
  SkillRow,
} from "$lib/api";
import { entityUuidFromAliases } from "$lib/entity-id";
import { classifyOceanWeapon, type EquippedItem } from "$lib/player-equipment";
import { derivePlayerImagines } from "$lib/player-imagines";

type Metric = "dps" | "heal" | "tanked";

function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

function rate(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

function statsByMetric(entity: RawEntityData, metric: Metric): RawCombatStats {
  if (metric === "heal") return entity.healing;
  if (metric === "tanked") return entity.taken;
  return entity.damage;
}

type PlayerRowsSource = {
  entities: RawEntityData[];
  elapsedMs: number;
  activeCombatTimeMs: number;
  totalDmg: number;
  totalHeal: number;
  totalDmgBossOnly: number;
};

export function liveDisplayElapsedMs(
  data: LiveDataPayload,
  displayNowMs = Date.now(),
): number {
  const serverElapsedMs = Math.max(0, Number(data.elapsedMs) || 0);
  const fightStartTimestampMs = Math.max(
    0,
    Number(data.fightStartTimestampMs) || 0,
  );
  if (
    fightStartTimestampMs <= 0 ||
    data.isPaused ||
    data.dpsDisplayPaused ||
    data.trainingDummy?.phase === "finished"
  ) {
    return serverElapsedMs;
  }

  const clientElapsedMs = Math.max(0, displayNowMs - fightStartTimestampMs);
  if (clientElapsedMs + 250 < serverElapsedMs) {
    return clientElapsedMs;
  }
  return Math.max(serverElapsedMs, clientElapsedMs);
}

export function computePlayerRowsFromEntities(
  source: PlayerRowsSource,
  metric: Metric,
  forbiddenIds?: Set<number>,
): PlayerRow[] {
  const elapsedSecs = source.elapsedMs > 0 ? source.elapsedMs / 1000 : 0;
  const effectiveActiveCombatMs = Math.min(source.activeCombatTimeMs, source.elapsedMs);
  const activeCombatSecs =
    effectiveActiveCombatMs > 0 ? effectiveActiveCombatMs / 1000 : 0;
  const totalMetric =
    metric === "heal"
      ? source.totalHeal
      : metric === "tanked"
        ? source.entities.reduce((sum, entity) => sum + (entity.taken?.total ?? 0), 0)
        : source.totalDmg;

  return source.entities
    .map((entity) => {
      const stats = statsByMetric(entity, metric);
      const entityUuid =
        entityUuidFromAliases(entity) ??
        (entity.uuid != null && entity.uuid > 0 ? String(entity.uuid) : null);
      const displayUid = Number(entity.displayUid ?? entity.uid ?? 0);
      const equippedItems = (entity.equippedItems ?? []) as EquippedItem[];
      const playerImagines = derivePlayerImagines(entity.activeProfessionSkills ?? []);
      const total = Number(stats.total || 0);
      const hits = Number(stats.hits || 0);
      const triggerHits = Number(stats.triggerHits || stats.hits || 0);
      const bossDmg = metric === "dps" ? Number(entity.damageBossOnly?.total || 0) : 0;
      const bossTotal = Number(source.totalDmgBossOnly || 0);
      const forbiddenHitIds =
        forbiddenIds && forbiddenIds.size > 0
          ? [...forbiddenIds].filter(
              (id) => Number(entity.takenSkills?.[id]?.hits ?? 0) > 0,
            )
          : [];

      const effectiveTotal = Number(stats.effectiveTotal || 0);

      const row: PlayerRow = {
        uid: entity.uid,
        displayUid,
        uuid: entity.uuid ?? null,
        entityUuid,
        entityKey: entity.entityKey ?? entityUuid,
        name: entity.name || `#${displayUid || entity.uid}`,
        className: entity.className,
        classSpecName: entity.classSpecName,
        abilityScore: entity.abilityScore,
        seasonStrength: entity.seasonStrength ?? 0,
        totalDmg: total,
        effectiveTotal,
        dps: elapsedSecs > 0 ? total / elapsedSecs : 0,
        effectiveDps: elapsedSecs > 0 ? effectiveTotal / elapsedSecs : 0,
        tdps: metric === "dps" && activeCombatSecs > 0 ? total / activeCombatSecs : 0,
        activeTimeMs: metric === "dps" ? effectiveActiveCombatMs : 0,
        bossDps: metric === "dps" && elapsedSecs > 0 ? bossDmg / elapsedSecs : 0,
        trueBossDps:
          metric === "dps" && activeCombatSecs > 0 ? bossDmg / activeCombatSecs : 0,
        dmgPct: percent(total, totalMetric),
        critRate: rate(Number(stats.critHits || 0), hits),
        critDmgRate: percent(Number(stats.critTotal || 0), total),
        luckyRate: rate(Number(stats.luckyHits || 0), triggerHits),
        luckyDmgRate: percent(Number(stats.luckyTotal || 0), total),
        blockRate: metric === "tanked" ? rate(Number(stats.blockHits || 0), hits) : 0,
        luckyBlockRate:
          metric === "tanked" ? rate(Number(stats.luckyBlockHits || 0), hits) : 0,
        hits,
        hitsPerMinute: elapsedSecs > 0 ? (hits / elapsedSecs) * 60 : 0,
        bossDmg,
        bossDmgPct: metric === "dps" ? percent(bossDmg, bossTotal) : 0,
        equippedItems,
        oceanWeapon: classifyOceanWeapon(equippedItems),
        playerImagines,
        forbiddenHit: forbiddenHitIds.length > 0,
        forbiddenHitIds,
      };

      return row;
    })
    .filter((row) => row.totalDmg > 0);
}

export function computePlayerRows(
  data: LiveDataPayload,
  metric: Metric,
  displayNowMs = Date.now(),
  forbiddenIds?: Set<number>,
): PlayerRow[] {
  return computePlayerRowsFromEntities(
    {
      entities: data.entities,
      elapsedMs: liveDisplayElapsedMs(data, displayNowMs),
      activeCombatTimeMs: data.activeCombatTimeMs,
      totalDmg: data.totalDmg,
      totalHeal: data.totalHeal,
      totalDmgBossOnly: data.totalDmgBossOnly,
    },
    metric,
    forbiddenIds,
  );
}

export function computeSkillRows(
  skills: Partial<Record<number, RawSkillStats>>,
  elapsedMs: number,
  parentTotal: number,
  nameResolver: (skillId: number) => string,
): SkillRow[] {
  const elapsedSecs = elapsedMs > 0 ? elapsedMs / 1000 : 0;

  return Object.entries(skills)
    .map(([skillIdText, stats]) => {
      if (!stats) return null;
      const skillId = Number(skillIdText);
      const total = Number(stats.totalValue || 0);
      const hits = Number(stats.hits || 0);
      const triggerHits = Number(stats.triggerHits || stats.hits || 0);

      const effectiveTotal = Number(stats.effectiveTotalValue || 0);

      const row: SkillRow = {
        skillId,
        name: nameResolver(skillId),
        totalDmg: total,
        effectiveTotal,
        dps: elapsedSecs > 0 ? total / elapsedSecs : 0,
        effectiveDps: elapsedSecs > 0 ? effectiveTotal / elapsedSecs : 0,
        dmgPct: percent(total, parentTotal),
        critRate: rate(Number(stats.critHits || 0), hits),
        critDmgRate: percent(Number(stats.critTotalValue || 0), total),
        luckyRate: rate(Number(stats.luckyHits || 0), triggerHits),
        luckyDmgRate: percent(Number(stats.luckyTotalValue || 0), total),
        blockRate: rate(Number(stats.blockHits || 0), hits),
        luckyBlockRate: rate(Number(stats.luckyBlockHits || 0), hits),
        hits,
        hitsPerMinute: elapsedSecs > 0 ? (hits / elapsedSecs) * 60 : 0,
        property: stats.property ?? null,
        damageMode: stats.damageMode ?? null,
      };
      return row;
    })
    .filter((row): row is SkillRow =>
      !!row && Number.isFinite(row.skillId) && row.totalDmg > 0,
    );
}

export function computeHeaderInfo(
  data: LiveDataPayload,
  displayNowMs = Date.now(),
): HeaderInfo {
  const elapsedMs = liveDisplayElapsedMs(data, displayNowMs);
  const elapsedSecs = elapsedMs > 0 ? elapsedMs / 1000 : 0;
  return {
    totalDps: elapsedSecs > 0 ? data.totalDmg / elapsedSecs : 0,
    totalDmg: data.totalDmg,
    elapsedMs,
    activeCombatTimeMs: data.activeCombatTimeMs,
    fightStartTimestampMs: data.fightStartTimestampMs,
    dpsDisplayPaused: data.dpsDisplayPaused,
    localPlayerUuid: data.localPlayerUuid ?? data.localPlayerKey ?? null,
    localPlayerKey: data.localPlayerKey ?? data.localPlayerUuid ?? null,
    bosses: data.bosses,
    sceneId: data.sceneId,
    sceneName: data.sceneName,
    trainingDummy: data.trainingDummy,
  };
}
