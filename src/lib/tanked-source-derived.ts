import type {
  HistoryEntityData,
  PerSourceStats,
  RawCombatStats,
} from "$lib/bindings";
import { resolveUiTranslation, SUPPORTED_LOCALES, type LocaleCode } from "$lib/i18n";
import { localizeMonsterName } from "$lib/monster-mappings";
import { SETTINGS } from "$lib/settings-store";
import type { SkillRuntimeSourceFallback } from "$lib/config/recount-table";

export const UNKNOWN_SOURCE_KEY = "unknown";

export function sourceMonsterKey(sourceMonsterId: number | null): string {
  return sourceMonsterId == null ? UNKNOWN_SOURCE_KEY : String(sourceMonsterId);
}

export function resolveSourceName(
  sourceMonsterId: number | null,
  localeOverride?: LocaleCode,
): string {
  const locale = localeOverride ?? SETTINGS.live.general.state.language;
  if (sourceMonsterId == null) {
    return resolveUiTranslation(
      "ui/dps/history.json",
      "tanked.monster.unknownSource",
      locale,
      "Unknown Source",
    );
  }
  return localizeMonsterName(sourceMonsterId, null, locale);
}

export function buildSourceNameFallback(
  sourceMonsterId: number | null,
  localeOverride?: LocaleCode,
): SkillRuntimeSourceFallback {
  const names: Partial<Record<LocaleCode, string>> = {};
  for (const locale of SUPPORTED_LOCALES) {
    names[locale] = resolveSourceName(sourceMonsterId, locale);
  }
  return {
    sourceName: resolveSourceName(sourceMonsterId, localeOverride ?? "en"),
    sourceNames: names,
  };
}

export function buildUniqueSkillSourceFallbacks(
  perSource: PerSourceStats[] | null | undefined,
  localeOverride?: LocaleCode,
): Map<number, SkillRuntimeSourceFallback> {
  const bySkill = new Map<
    number,
    { sourceKey: string; fallback: SkillRuntimeSourceFallback; ambiguous: boolean }
  >();

  for (const source of perSource ?? []) {
    const sourceKey = sourceMonsterKey(source.sourceMonsterId);
    const fallback = buildSourceNameFallback(source.sourceMonsterId, localeOverride);
    for (const [skillIdText, stats] of Object.entries(source.skills ?? {})) {
      if (!stats || Number(stats.totalValue || 0) <= 0) continue;
      const skillId = Number(skillIdText);
      if (!Number.isFinite(skillId)) continue;
      const existing = bySkill.get(skillId);
      if (!existing) {
        bySkill.set(skillId, { sourceKey, fallback, ambiguous: false });
      } else if (existing.sourceKey !== sourceKey) {
        existing.ambiguous = true;
      }
    }
  }

  const out = new Map<number, SkillRuntimeSourceFallback>();
  for (const [skillId, entry] of bySkill.entries()) {
    if (!entry.ambiguous) out.set(skillId, entry.fallback);
  }
  return out;
}

export function findSourceByKey(
  perSource: PerSourceStats[] | null | undefined,
  monsterKey: string | null,
): PerSourceStats | null {
  if (!perSource || monsterKey == null) return null;
  return (
    perSource.find((src) =>
      monsterKey === UNKNOWN_SOURCE_KEY
        ? src.sourceMonsterId == null
        : src.sourceMonsterId === Number(monsterKey),
    ) ?? null
  );
}

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

export function buildSourceEntities(
  base: HistoryEntityData,
  perSource: PerSourceStats[] | null | undefined,
  localeOverride?: LocaleCode,
): HistoryEntityData[] {
  return (perSource ?? []).map((src) => ({
    ...base,
    uid: src.sourceMonsterId ?? 0,
    name: resolveSourceName(src.sourceMonsterId, localeOverride),
    classId: 0,
    classSpec: 0,
    className: "",
    classSpecName: "",
    abilityScore: 0,
    seasonStrength: 0,
    damage: zeroCombatStats(),
    damageBossOnly: zeroCombatStats(),
    healing: zeroCombatStats(),
    taken: src.taken,
    dmgSkills: {},
    healSkills: {},
    takenSkills: src.skills,
    takenPerSource: [],
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
  }));
}
