type LocalizedTextMap = Record<string, string>;

const RAGE_CLEAVE_STAGE_BY_SKILL_ID: Record<string, number> = {
  "1608": 1,
  "1609": 2,
  "1610": 3,
  "1611": 4,
};

const RAGE_CLEAVE_STAGE_TEMPLATES: LocalizedTextMap = {
  en: "Stage {stage}",
  "zh-CN": "\u7b2c{stage}\u6bb5",
  "zh-TW": "\u7b2c{stage}\u6bb5",
  ja: "\u7b2c{stage}\u6bb5",
  "ko-KR": "\uc81c{stage}\ub2e8\uacc4",
  fr: "Phase {stage}",
  de: "Stufe {stage}",
  es: "Fase {stage}",
  "pt-BR": "Etapa {stage}",
  th: "\u0e02\u0e31\u0e49\u0e19\u0e17\u0e35\u0e48 {stage}",
  id: "Tahap {stage}",
};

function resolveLocalizedText(
  names: LocalizedTextMap,
  locale: string,
  fallback: string,
): string {
  return names[locale] ?? names[locale.split("-")[0] ?? ""] ?? names["en"] ?? fallback;
}

export function resolveRageCleaveStageNumberForSkillId(
  skillId: number | string | null | undefined,
): number | undefined {
  return RAGE_CLEAVE_STAGE_BY_SKILL_ID[String(skillId ?? "")];
}

export function resolveRageCleaveStageLabel(stage: number, locale: string): string {
  return resolveLocalizedText(
    RAGE_CLEAVE_STAGE_TEMPLATES,
    locale,
    RAGE_CLEAVE_STAGE_TEMPLATES["en"] ?? "Stage {stage}",
  ).replace("{stage}", String(stage));
}

export function resolveKnownSkillStageDisplayName(
  skillId: number | string | null | undefined,
  locale: string,
  baseName: string,
): string | undefined {
  const stage = resolveRageCleaveStageNumberForSkillId(skillId);
  if (!stage) return undefined;
  const trimmedBase = baseName.trim();
  const stageLabel = resolveRageCleaveStageLabel(stage, locale);
  return trimmedBase ? `${trimmedBase} - ${stageLabel}` : stageLabel;
}
