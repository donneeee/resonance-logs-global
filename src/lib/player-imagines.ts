import aoyiIconData from "$parserData/generated/skill_aoyi_icons.json";
import { resolveStaticIconUrl } from "$lib/config/static-icon-resolver";
import type { LocaleCode, MultiLangValue } from "$lib/i18n";

export type ActiveProfessionSkillLike = {
  skillId?: number | null;
  level?: number | null;
  remodelLevel?: number | null;
  slot?: number | null;
  equipped?: boolean | null;
  sourceKind?: string;
  runtimeSource?: string;
};

export type PlayerImagineInfo = {
  skillId: number;
  level: number | null;
  tier: number;
  names: MultiLangValue;
  name: string;
  icon: string;
  iconPath: string;
  iconUrl: string | undefined;
  slot: number | null;
  equipped: boolean | null;
  sourceKind: string;
  runtimeSource: string;
};

type AoyiIconRow = {
  id?: number;
  Id?: number;
  Name?: string;
  Names?: MultiLangValue;
  MonsterNames?: MultiLangValue;
  Icon?: string;
  IconPath?: string;
};

const AOYI_ICON_BY_SKILL_ID = new Map<number, AoyiIconRow>();

for (const rawRow of aoyiIconData as AoyiIconRow[]) {
  const skillId = Number(rawRow.id ?? rawRow.Id ?? 0);
  if (!Number.isFinite(skillId) || skillId <= 0) continue;
  AOYI_ICON_BY_SKILL_ID.set(skillId, rawRow);
}

function normalizeTier(remodelLevel: number | null | undefined): number {
  const tier = Number(remodelLevel ?? 0);
  if (!Number.isFinite(tier) || tier < 0) return 0;
  return Math.min(5, Math.trunc(tier));
}

function normalizeLevel(level: number | null | undefined): number | null {
  const value = Number(level ?? 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
}

function normalizeSlot(slot: number | null | undefined): number | null {
  const value = Number(slot ?? 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
}

function normalizeNames(row: AoyiIconRow): MultiLangValue {
  const monsterNames = row.MonsterNames ?? {};
  if (Object.keys(monsterNames).length > 0) return monsterNames;
  const names = row.Names ?? {};
  if (Object.keys(names).length > 0) return names;
  const fallback = row.Name?.trim();
  return fallback ? { en: fallback } : {};
}

function hasSelectedImagineEvidence(skill: ActiveProfessionSkillLike): boolean {
  const sourceKind = skill.sourceKind ?? "";
  if (sourceKind === "battle-imagine") {
    return skill.equipped === true || normalizeSlot(skill.slot) !== null;
  }
  return sourceKind === "remote-skill-level";
}

export function derivePlayerImagines(
  activeProfessionSkills: readonly ActiveProfessionSkillLike[] | null | undefined,
): PlayerImagineInfo[] {
  const out: PlayerImagineInfo[] = [];
  const seen = new Set<number>();

  for (const skill of activeProfessionSkills ?? []) {
    const skillId = Number(skill.skillId ?? 0);
    if (!Number.isFinite(skillId) || skillId <= 0 || seen.has(skillId)) continue;

    const row = AOYI_ICON_BY_SKILL_ID.get(skillId);
    if (!row) continue;
    if (!hasSelectedImagineEvidence(skill)) continue;

    seen.add(skillId);
    const names = normalizeNames(row);
    const fallbackName = names.en?.trim() || row.Name?.trim() || `#${skillId}`;
    const icon = row.Icon?.trim() ?? "";
    const iconPath = row.IconPath?.trim() ?? "";
    const slot = normalizeSlot(skill.slot);

    out.push({
      skillId,
      level: normalizeLevel(skill.level),
      tier: normalizeTier(skill.remodelLevel),
      names,
      name: fallbackName,
      icon,
      iconPath,
      iconUrl: resolveStaticIconUrl(icon, iconPath),
      slot,
      equipped: skill.equipped ?? null,
      sourceKind: skill.sourceKind ?? "",
      runtimeSource: skill.runtimeSource ?? "",
    });
  }

  out.sort((a, b) => {
    const slotA = a.slot ?? Number.MAX_SAFE_INTEGER;
    const slotB = b.slot ?? Number.MAX_SAFE_INTEGER;
    return slotA - slotB || a.skillId - b.skillId;
  });

  return out.slice(0, 2);
}

export function resolvePlayerImagineName(
  imagine: PlayerImagineInfo,
  locale: LocaleCode,
): string {
  return imagine.names[locale]?.trim() || imagine.names.en?.trim() || imagine.name;
}
