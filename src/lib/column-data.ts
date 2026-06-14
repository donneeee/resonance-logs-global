
/**
 * Column data shared across history and live views.
 * This file replaces the previous `history-columns.ts` name to better
 * reflect its purpose as generic column metadata.
 */

import { damageModeLabel, propertyLabel } from "./damage-type";

export type ColumnDefinition<K extends string = string> = {
  key: K;
  header: string;
  label: string;
  description: string;
  format: (v: number | null) => string;
  aliasKey?: string;
  headerKey?: string;
  labelKey?: string;
  descriptionKey?: string;
};

export type ColumnAliasState = Record<string, string | undefined>;

export function columnAliasKey(col: ColumnDefinition): string {
  if (col.aliasKey) return col.aliasKey;
  if (col.headerKey?.endsWith(".header")) {
    return col.headerKey.slice(0, -".header".length);
  }
  if (col.labelKey?.endsWith(".label")) {
    return col.labelKey.slice(0, -".label".length);
  }
  return col.key;
}

export function columnAliasValue(
  aliases: ColumnAliasState | null | undefined,
  col: ColumnDefinition,
): string {
  return aliases?.[columnAliasKey(col)] ?? "";
}

export function columnLabelWithAlias(
  aliases: ColumnAliasState | null | undefined,
  col: ColumnDefinition,
  fallback: string,
): string {
  const alias = columnAliasValue(aliases, col).trim();
  return alias || fallback;
}

export function orderColumnsByKey<T extends { key: string }>(
  columns: readonly T[],
  order: readonly string[] | null | undefined,
): T[] {
  const orderIndex = new Map<string, number>();
  (order ?? []).forEach((key, index) => {
    if (!orderIndex.has(key)) orderIndex.set(key, index);
  });

  return [...columns].sort((a, b) => {
    const aIndex = orderIndex.get(a.key);
    const bIndex = orderIndex.get(b.key);

    if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
    if (aIndex !== undefined) return -1;
    if (bIndex !== undefined) return 1;
    return columns.indexOf(a) - columns.indexOf(b);
  });
}

const integer = (v: number | null) => Number(v ?? 0).toLocaleString();
const fixed1 = (v: number | null) => Number(v ?? 0).toFixed(1);
const percent1 = (v: number | null) => Number(v ?? 0).toFixed(1) + "%";

function makeColumn<K extends string>(
  section: string,
  key: K,
  header: string,
  label: string,
  description: string,
  format: (v: number | null) => string,
): ColumnDefinition<K> {
  return {
    key,
    header,
    label,
    description,
    format,
    aliasKey: `${section}.${key}`,
    headerKey: `${section}.${key}.header`,
    labelKey: `${section}.${key}.label`,
    descriptionKey: `${section}.${key}.description`,
  };
}

export const historyDpsPlayerColumns = [
  makeColumn("columns.historyPlayers", "totalDmg", "Damage", "Damage", "Show the total damage dealt by the player", integer),
  makeColumn("columns.historyPlayers", "dps", "DPS", "DPS", "Show the player's damage per second (DPS)", fixed1),
  makeColumn("columns.historyPlayers", "effectiveTotal", "Effective Damage", "Effective Damage", "Show the player's effective damage dealt", integer),
  makeColumn("columns.historyPlayers", "effectiveDps", "Effective DPS", "Effective DPS", "Show the player's effective damage per second (EDPS)", fixed1),
  makeColumn("columns.historyPlayers", "tdps", "True DPS", "True DPS", "Show the player's true DPS based on global active combat time", fixed1),
  makeColumn("columns.historyPlayers", "bossDmg", "Boss Damage", "Boss Damage", "Show the damage dealt by the player to the boss", integer),
  makeColumn("columns.historyPlayers", "bossDps", "Boss DPS", "Boss DPS", "Show the player's DPS against the boss", fixed1),
  makeColumn("columns.historyPlayers", "dmgPct", "Share %", "Share %", "Show the player's damage share", percent1),
  makeColumn("columns.historyPlayers", "critRate", "Crit %", "Crit %", "Show the player's critical hit rate", percent1),
  makeColumn("columns.historyPlayers", "critDmgRate", "Crit Dmg %", "Crit Dmg %", "Show the proportion of damage dealt as critical damage", percent1),
  makeColumn("columns.historyPlayers", "luckyRate", "Lucky %", "Lucky %", "Show the player's lucky hit rate", percent1),
  makeColumn("columns.historyPlayers", "luckyDmgRate", "Lucky Dmg %", "Lucky Dmg %", "Show the proportion of damage dealt as lucky-hit damage", percent1),
  makeColumn("columns.historyPlayers", "hits", "Hits", "Hits", "Show the player's total number of hits", integer),
  makeColumn("columns.historyPlayers", "hitsPerMinute", "Hits/Min", "Hits/Min", "Show the player's hits per minute", fixed1),
] as const satisfies readonly ColumnDefinition[];

export const historyDpsSkillColumns = [
  makeColumn("columns.historySkills", "totalDmg", "Damage", "Damage", "Show the total damage dealt by the skill", integer),
  makeColumn("columns.historySkills", "dps", "DPS", "DPS", "Show the skill's damage per second (DPS)", fixed1),
  makeColumn("columns.historySkills", "effectiveTotal", "Effective Damage", "Effective Damage", "Show the skill's effective damage dealt", integer),
  makeColumn("columns.historySkills", "effectiveDps", "Effective DPS", "Effective DPS", "Show the skill's effective damage per second (EDPS)", fixed1),
  makeColumn("columns.historySkills", "dmgPct", "Share %", "Share %", "Show the skill's damage share", percent1),
  makeColumn("columns.historySkills", "critRate", "Crit %", "Crit %", "Show the skill's critical hit rate", percent1),
  makeColumn("columns.historySkills", "critDmgRate", "Crit Dmg %", "Crit Dmg %", "Show the proportion of damage dealt as critical damage", percent1),
  makeColumn("columns.historySkills", "luckyRate", "Lucky %", "Lucky %", "Show the skill's lucky hit rate", percent1),
  makeColumn("columns.historySkills", "luckyDmgRate", "Lucky Dmg %", "Lucky Dmg %", "Show the proportion of damage dealt as lucky-hit damage", percent1),
  makeColumn("columns.historySkills", "hits", "Hits", "Hits", "Show the skill's total number of hits", integer),
  makeColumn("columns.historySkills", "hitsPerMinute", "Hits/Min", "Hits/Min", "Show the skill's hits per minute", fixed1),
] as const satisfies readonly ColumnDefinition[];

export const historyHealPlayerColumns = [
  makeColumn("columns.historyHealPlayers", "healDealt", "Healing", "Healing", "Show the total healing done by the player", integer),
  makeColumn("columns.historyHealPlayers", "hps", "HPS", "HPS", "Show the player's healing per second (HPS)", fixed1),
  makeColumn("columns.historyHealPlayers", "effectiveHeal", "Effective Healing", "Effective Healing", "Show the player's effective healing done", integer),
  makeColumn("columns.historyHealPlayers", "ehps", "EHPS", "EHPS", "Show the player's effective healing per second (EHPS)", fixed1),
  makeColumn("columns.historyHealPlayers", "healPct", "Share %", "Share %", "Show the player's healing share", percent1),
  makeColumn("columns.historyHealPlayers", "critHealRate", "Crit %", "Crit %", "Show the player's healing critical hit rate", percent1),
  makeColumn("columns.historyHealPlayers", "critDmgRate", "Crit Heal %", "Crit Heal %", "Show the proportion of healing done as critical healing", percent1),
  makeColumn("columns.historyHealPlayers", "luckyRate", "Lucky %", "Lucky %", "Show the player's lucky hit rate", percent1),
  makeColumn("columns.historyHealPlayers", "luckyDmgRate", "Lucky Heal %", "Lucky Heal %", "Show the proportion of healing done as lucky-hit healing", percent1),
  makeColumn("columns.historyHealPlayers", "hitsHeal", "Count", "Count", "Show the player's total number of healing events", integer),
  makeColumn("columns.historyHealPlayers", "hitsPerMinute", "Count/Min", "Count/Min", "Show the player's healing events per minute", fixed1),
] as const satisfies readonly ColumnDefinition[];

export const liveHealPlayerColumns = [
  makeColumn("columns.liveHealPlayers", "totalDmg", "Healing", "Healing", "Show the total healing done by the player", integer),
  makeColumn("columns.liveHealPlayers", "dps", "HPS", "HPS", "Show the player's healing per second (HPS)", fixed1),
  makeColumn("columns.liveHealPlayers", "effectiveTotal", "Effective Healing", "Effective Healing", "Show the player's effective healing done", integer),
  makeColumn("columns.liveHealPlayers", "effectiveDps", "EHPS", "EHPS", "Show the player's effective healing per second (EHPS)", fixed1),
  makeColumn("columns.liveHealPlayers", "dmgPct", "Share %", "Share %", "Show the player's healing share", percent1),
  makeColumn("columns.liveHealPlayers", "critRate", "Crit %", "Crit %", "Show the player's crit rate", percent1),
  makeColumn("columns.liveHealPlayers", "critDmgRate", "Crit Heal %", "Crit Heal %", "Show the proportion of healing done as critical healing", percent1),
  makeColumn("columns.liveHealPlayers", "luckyRate", "Lucky %", "Lucky %", "Show the player's lucky hit rate", percent1),
  makeColumn("columns.liveHealPlayers", "luckyDmgRate", "Lucky Heal %", "Lucky Heal %", "Show the proportion of healing done as lucky-hit healing", percent1),
  makeColumn("columns.liveHealPlayers", "hits", "Count", "Count", "Show the player's total healing count", integer),
  makeColumn("columns.liveHealPlayers", "hitsPerMinute", "Count/Min", "Count/Min", "Show the player's healing count per minute", fixed1),
] as const satisfies readonly ColumnDefinition[];

export const liveTankedPlayerColumns = [
  makeColumn("columns.liveTankedPlayers", "blockRate", "Block %", "Block %", "Show the chance that incoming hits were blocked", percent1),
  makeColumn("columns.liveTankedPlayers", "luckyBlockRate", "Lucky Block %", "Lucky Block %", "Show the chance that incoming hits triggered lucky block", percent1),
  makeColumn("columns.liveTankedPlayers", "totalDmg", "Damage Taken", "Damage Taken", "Show the total damage taken by the player", integer),
  makeColumn("columns.liveTankedPlayers", "dps", "TPS", "TPS", "Show the player's damage taken per second (TPS)", fixed1),
  makeColumn("columns.liveTankedPlayers", "effectiveTotal", "Effective Tanked", "Effective Tanked", "Show the player's effective damage taken", integer),
  makeColumn("columns.liveTankedPlayers", "effectiveDps", "ETPS", "ETPS", "Show the player's effective damage taken per second (ETPS)", fixed1),
  makeColumn("columns.liveTankedPlayers", "dmgPct", "Share %", "Share %", "Show the player's damage taken share", percent1),
  makeColumn("columns.liveTankedPlayers", "critRate", "Crit Taken %", "Crit Taken %", "Show the player's chance to be critically hit", percent1),
  makeColumn("columns.liveTankedPlayers", "critDmgRate", "Crit Tanked %", "Crit Taken Dmg %", "Show the proportion of taken damage received as critical damage", percent1),
  makeColumn("columns.liveTankedPlayers", "luckyRate", "Lucky Taken %", "Lucky Taken %", "Show the player's chance to be hit by lucky attacks", percent1),
  makeColumn("columns.liveTankedPlayers", "luckyDmgRate", "Lucky Tanked %", "Lucky Taken Dmg %", "Show the proportion of taken damage received as lucky-hit damage", percent1),
  makeColumn("columns.liveTankedPlayers", "hits", "Hits Taken", "Hits Taken", "Show the player's total number of hits taken", integer),
  makeColumn("columns.liveTankedPlayers", "hitsPerMinute", "Hits/Min", "Hits Taken/Min", "Show the player's hits taken per minute", fixed1),
] as const satisfies readonly ColumnDefinition[];

export const liveTankedSkillColumns = [
  makeColumn("columns.liveTankedSkills", "blockRate", "Block %", "Block %", "Show the chance that this incoming skill was blocked", percent1),
  makeColumn("columns.liveTankedSkills", "luckyBlockRate", "Lucky Block %", "Lucky Block %", "Show the chance that this incoming skill triggered lucky block", percent1),
  makeColumn("columns.liveTankedSkills", "totalDmg", "Damage Taken", "Damage Taken", "Show the total damage taken by the skill entry", integer),
  makeColumn("columns.liveTankedSkills", "dps", "DTPS", "DTPS", "Show the damage taken per second for the skill entry (DTPS)", fixed1),
  makeColumn("columns.liveTankedSkills", "effectiveTotal", "Effective Tanked", "Effective Tanked", "Show the skill's effective damage taken", integer),
  makeColumn("columns.liveTankedSkills", "effectiveDps", "ETPS", "ETPS", "Show the skill's effective damage taken per second (ETPS)", fixed1),
  makeColumn("columns.liveTankedSkills", "dmgPct", "Share %", "Share %", "Show the skill entry's damage taken share", percent1),
  makeColumn("columns.liveTankedSkills", "critRate", "Crit Taken %", "Crit Taken %", "Show the chance for this skill entry to be critically hit", percent1),
  makeColumn("columns.liveTankedSkills", "critDmgRate", "Crit Tanked %", "Crit Taken Dmg %", "Show the proportion of damage taken as critical damage for this skill entry", percent1),
  makeColumn("columns.liveTankedSkills", "luckyRate", "Lucky Taken %", "Lucky Taken %", "Show the chance for this skill entry to be hit by lucky attacks", percent1),
  makeColumn("columns.liveTankedSkills", "luckyDmgRate", "Lucky Tanked %", "Lucky Taken Dmg %", "Show the proportion of damage taken as lucky-hit damage for this skill entry", percent1),
  makeColumn("columns.liveTankedSkills", "hits", "Hits Taken", "Hits Taken", "Show the total hits taken for this skill entry", integer),
  makeColumn("columns.liveTankedSkills", "hitsPerMinute", "Hits/Min", "Hits Taken/Min", "Show the hits taken per minute for this skill entry", fixed1),
  makeColumn("columns.liveTankedSkills", "property", "Element", "Element", "Skill damage element property", propertyLabel),
  makeColumn("columns.liveTankedSkills", "damageMode", "P/M", "P/M", "Physical or magical damage type", damageModeLabel),
] as const satisfies readonly ColumnDefinition[];

export const historyTankedPlayerColumns = [
  makeColumn("columns.historyTankedPlayers", "blockRate", "Block %", "Block %", "Show the chance that incoming hits were blocked", percent1),
  makeColumn("columns.historyTankedPlayers", "luckyBlockRate", "Lucky Block %", "Lucky Block %", "Show the chance that incoming hits triggered lucky block", percent1),
  makeColumn("columns.historyTankedPlayers", "damageTaken", "Damage Taken", "Damage Taken", "Show the total damage taken by the player", integer),
  makeColumn("columns.historyTankedPlayers", "tankedPS", "DTPS", "DTPS", "Show the player's damage taken per second (DTPS)", fixed1),
  makeColumn("columns.historyTankedPlayers", "tankedPct", "Share %", "Share %", "Show the player's damage-taken share", percent1),
  makeColumn("columns.historyTankedPlayers", "critTakenRate", "Crit Taken %", "Crit Taken %", "Show the player's chance to be critically hit", percent1),
  makeColumn("columns.historyTankedPlayers", "critDmgRate", "Crit Taken Dmg %", "Crit Taken Dmg %", "Show the proportion of taken damage received as critical damage", percent1),
  makeColumn("columns.historyTankedPlayers", "luckyRate", "Lucky Taken %", "Lucky Taken %", "Show the player's chance to be hit by lucky attacks", percent1),
  makeColumn("columns.historyTankedPlayers", "luckyDmgRate", "Lucky Taken Dmg %", "Lucky Taken Dmg %", "Show the proportion of taken damage received as lucky-hit damage", percent1),
  makeColumn("columns.historyTankedPlayers", "hitsTaken", "Hits Taken", "Hits Taken", "Show the player's total number of hits taken", integer),
  makeColumn("columns.historyTankedPlayers", "hitsPerMinute", "Hits Taken/Min", "Hits Taken/Min", "Show the player's hits taken per minute", fixed1),
] as const satisfies readonly ColumnDefinition[];

export const historyTankedSkillColumns = [
  makeColumn("columns.historyTankedSkills", "blockRate", "Block %", "Block %", "Show the chance that this incoming skill was blocked", percent1),
  makeColumn("columns.historyTankedSkills", "luckyBlockRate", "Lucky Block %", "Lucky Block %", "Show the chance that this incoming skill triggered lucky block", percent1),
  makeColumn("columns.historyTankedSkills", "totalDmg", "Damage Taken", "Damage Taken", "Show the total damage taken for this skill", integer),
  makeColumn("columns.historyTankedSkills", "dps", "DTPS", "DTPS", "Show the skill's damage taken per second (DTPS)", fixed1),
  makeColumn("columns.historyTankedSkills", "dmgPct", "Share %", "Share %", "Show the skill's damage-taken share", percent1),
  makeColumn("columns.historyTankedSkills", "critRate", "Crit Taken %", "Crit Taken %", "Show the chance for this skill to be critically hit", percent1),
  makeColumn("columns.historyTankedSkills", "critDmgRate", "Crit Taken Dmg %", "Crit Taken Dmg %", "Show the proportion of taken damage received as critical damage for this skill", percent1),
  makeColumn("columns.historyTankedSkills", "luckyRate", "Lucky Taken %", "Lucky Taken %", "Show the chance for this skill to be hit by lucky attacks", percent1),
  makeColumn("columns.historyTankedSkills", "luckyDmgRate", "Lucky Taken Dmg %", "Lucky Taken Dmg %", "Show the proportion of taken damage received as lucky-hit damage for this skill", percent1),
  makeColumn("columns.historyTankedSkills", "hits", "Hits Taken", "Hits Taken", "Show the total number of hits taken for this skill", integer),
  makeColumn("columns.historyTankedSkills", "hitsPerMinute", "Hits Taken/Min", "Hits Taken/Min", "Show the skill's hits taken per minute", fixed1),
  makeColumn("columns.historyTankedSkills", "property", "Element", "Element", "Skill damage element property", propertyLabel),
  makeColumn("columns.historyTankedSkills", "damageMode", "P/M", "P/M", "Physical or magical damage type", damageModeLabel),
] as const satisfies readonly ColumnDefinition[];

export const historyHealSkillColumns = [
  makeColumn("columns.historyHealSkills", "totalDmg", "Healing", "Healing", "Show the total healing done by the skill", integer),
  makeColumn("columns.historyHealSkills", "dps", "HPS", "HPS", "Show the skill's healing per second (HPS)", fixed1),
  makeColumn("columns.historyHealSkills", "effectiveTotal", "Effective Healing", "Effective Healing", "Show the skill's effective healing done", integer),
  makeColumn("columns.historyHealSkills", "effectiveDps", "EHPS", "EHPS", "Show the skill's effective healing per second (EHPS)", fixed1),
  makeColumn("columns.historyHealSkills", "dmgPct", "Share %", "Share %", "Show the skill's healing share", percent1),
  makeColumn("columns.historyHealSkills", "critRate", "Crit %", "Crit %", "Show the skill's critical hit rate", percent1),
  makeColumn("columns.historyHealSkills", "critDmgRate", "Crit Heal %", "Crit Heal %", "Show the proportion of healing done as critical healing", percent1),
  makeColumn("columns.historyHealSkills", "luckyRate", "Lucky %", "Lucky %", "Show the skill's lucky hit rate", percent1),
  makeColumn("columns.historyHealSkills", "luckyDmgRate", "Lucky Heal %", "Lucky Heal %", "Show the proportion of healing done as lucky-hit healing", percent1),
  makeColumn("columns.historyHealSkills", "hits", "Count", "Count", "Show the skill's total number of healing events", integer),
  makeColumn("columns.historyHealSkills", "hitsPerMinute", "Count/Min", "Count/Min", "Show the skill's healing events per minute", fixed1),
] as const satisfies readonly ColumnDefinition[];

// Aliases for live views: reuse history DPS/Heal skill definitions where appropriate.
// True Boss DPS is live-only because history can drill into each boss target directly.
export const liveDpsPlayerColumns = [
  ...historyDpsPlayerColumns,
  makeColumn("columns.livePlayers", "trueBossDps", "True Boss DPS", "True Boss DPS", "Show boss-only DPS based on global active combat time", fixed1),
] as const satisfies readonly ColumnDefinition[];
export const liveDpsSkillColumns = historyDpsSkillColumns;
export const liveHealSkillColumns = historyHealSkillColumns;
