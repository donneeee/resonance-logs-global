import type { LocaleCode } from "$lib/i18n";
import { getLocalizedSceneName, localizeRawSceneName } from "$lib/scene-mappings";

type SceneDifficulty =
  | "Easy"
  | "Normal"
  | "Hard"
  | "Nightmare"
  | "Master"
  | "Unstable"
  | "Adept"
  | "Clash"
  | "Brutal"
  | "Purge";

const HISTORY_SCENE_DIFFICULTY_BY_ID: Readonly<Record<number, SceneDifficulty>> = {
  12011: "Hard",
  12012: "Normal",
  12013: "Easy",
  12014: "Normal",
  12015: "Hard",
  12018: "Normal",
  12019: "Hard",
  12022: "Normal",
  12023: "Hard",
  1011: "Unstable",
  1021: "Unstable",
  1031: "Normal",
  1032: "Hard",
  1033: "Master",
  1611: "Unstable",
  1621: "Unstable",
  1631: "Normal",
  1632: "Hard",
  1633: "Master",
  1111: "Unstable",
  1112: "Unstable",
  1121: "Normal",
  1122: "Hard",
  1123: "Master",
  1150: "Master",
  1151: "Hard",
  1152: "Normal",
  1153: "Unstable",
  1154: "Unstable",
  6541: "Unstable",
  6542: "Unstable",
  6543: "Normal",
  6544: "Hard",
  6545: "Master",
  6511: "Unstable",
  6512: "Unstable",
  6513: "Normal",
  6514: "Hard",
  6515: "Master",
  6521: "Unstable",
  6522: "Unstable",
  6523: "Normal",
  6524: "Hard",
  6525: "Master",
  6563: "Normal",
  6564: "Hard",
  6565: "Master",
  9200: "Adept",
  13001: "Clash",
  13002: "Brutal",
  13003: "Purge",
  9205: "Easy",
  9206: "Hard",
  9207: "Nightmare",
  13011: "Clash",
  13012: "Brutal",
  13013: "Purge",
  13021: "Clash",
  13022: "Brutal",
  13023: "Purge",
};

function normalizeSceneId(sceneId: number | string | null | undefined): number {
  const numeric = Number(sceneId ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : 0;
}

function extractRawSceneDifficulty(value: string | null | undefined): number | null {
  const match = value?.trim().match(/-(\d+)$/);
  if (!match) return null;
  const difficulty = Number(match[1]);
  return Number.isFinite(difficulty) && difficulty > 0 ? difficulty : null;
}

function stripRawSceneDifficulty(value: string): string {
  return value.replace(/-\d+$/, "").trim();
}

function formatSceneDifficultyLabel(
  knownDifficulty: SceneDifficulty | undefined,
  rawDifficulty: number | null,
): string | null {
  if (knownDifficulty === "Master") {
    return `M${rawDifficulty ?? 1}`;
  }
  if (knownDifficulty) return knownDifficulty;
  if (rawDifficulty === null) return null;
  if (rawDifficulty === 1) return "Normal";
  if (rawDifficulty === 2) return "Hard";
  return `M${rawDifficulty}`;
}

export function formatHistorySceneName(
  sceneId: number | string | null | undefined,
  sceneName: string | null | undefined,
  locale?: LocaleCode,
): string {
  const fallback = sceneName?.trim() || "Unknown Scene";
  const localizedById = getLocalizedSceneName(sceneId, sceneName, locale);
  const localized = localizedById && localizedById !== "Unknown Scene"
    ? localizedById
    : localizeRawSceneName(sceneName, fallback, locale);
  const numericSceneId = normalizeSceneId(sceneId);
  const knownDifficulty = numericSceneId > 0
    ? HISTORY_SCENE_DIFFICULTY_BY_ID[numericSceneId]
    : undefined;
  const rawDifficulty = extractRawSceneDifficulty(sceneName) ?? extractRawSceneDifficulty(localized);
  const difficultyLabel = formatSceneDifficultyLabel(knownDifficulty, rawDifficulty);
  const displayName = stripRawSceneDifficulty(localized);
  return difficultyLabel ? `${displayName} (${difficultyLabel})` : displayName;
}
