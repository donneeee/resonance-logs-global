import classResourcesRaw from "$parserData/app-rules/class_resources.json";
import classSkillConfigsRaw from "$parserData/app-rules/class_skill_configs.json";
import classSpecialBuffDisplaysRaw from "$parserData/app-rules/class_special_buff_displays.json";
import counterRulesRaw from "$parserData/app-rules/counter_rules.json";
import seasonCultivateFactorSkillLabelsRaw from "$parserData/app-rules/season_cultivate_factor_skill_labels.json";
import counterSlotTemplatesRaw from "$parserData/app-rules/counter_slot_templates.json";
import counterSourceTemplatesRaw from "$parserData/app-rules/counter_source_templates.json";
import resonanceSkillIcons from "$parserData/generated/skill_aoyi_icons.json";
import {
  DEFAULT_LOCALE,
  PRIMARY_FALLBACK_LOCALE,
  SUPPORTED_LOCALES,
  isLocaleCode,
  resolveUiTranslation,
  type LocaleCode,
} from "$lib/i18n";
import { settings } from "$lib/settings-store";
import type { UserCounterRule } from "$lib/settings-store";
import type {
  CounterAction,
  CounterSource,
  FactorCounterTemplate,
} from "$lib/bindings";

export type SkillDisplayInfo = {
  skillId: number;
  name: string;
  imagePath: string;
  maxCharges?: number;
  maxValidCdTime?: number;
  effectDurationMs?: number;
  resourceRequirement?: ResourceRequirement;
};

export type SkillDefinition = SkillDisplayInfo;

export type ClassSkillConfig = {
  classKey: string;
  className: string;
  classId: number;
  skills: SkillDefinition[];
  derivations?: SkillDerivation[];
  defaultMonitoredBuffIds?: number[];
};

export type ResourceDefinition = {
  type: "bar" | "charges";
  label: string;
  currentId?: number;
  maxId?: number;
  currentIndex?: number;
  maxIndex?: number;
  imageOn: string;
  imageOff: string;
  buffBaseId?: number;
  buffBaseIds?: number[];
};

export type SpecialBuffDisplay = {
  buffBaseId: number;
  layerImages: string[][];
};

export type ResourceRequirement = {
  resourceId?: number;
  resourceIndex?: number;
  amount: number;
};

type ResonanceSkillIconRaw = {
  id: number;
  Name?: string;
  NameDesign?: string;
  Names?: unknown;
  MonsterNames?: unknown;
  QuoteTexts?: unknown;
  Icon: string;
  maxCharges?: number;
  maxValidCdTime?: number;
};

type ResonanceSkillSearchRaw = {
  id?: number;
  Id?: number;
  DescriptionSearchText?: string;
};

type MultiLangValue = Partial<Record<LocaleCode, string>>;

type SeasonCultivateFactorSkillLabelEntry = {
  label?: MultiLangValue;
  evidence?: Record<string, unknown>;
};

type SeasonCultivateFactorSkillLabels = {
  version?: number;
  sources?: Record<string, SeasonCultivateFactorSkillLabelEntry>;
  slots?: Record<string, SeasonCultivateFactorSkillLabelEntry>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const RESONANCE_SKILL_SEARCH_DATA_URL = "/data/resonance_skill_search.json";
let resonanceSkillDescriptionSearchById = new Map<number, string>();
let resonanceSkillSearchRuntimeLoad: Promise<void> | null = null;

export async function initializeResonanceSkillSearchRuntimeData(): Promise<void> {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  if (!resonanceSkillSearchRuntimeLoad) {
    resonanceSkillSearchRuntimeLoad = loadResonanceSkillSearchRuntimeData();
  }
  return resonanceSkillSearchRuntimeLoad;
}

export async function reloadResonanceSkillSearchRuntimeData(): Promise<void> {
  resonanceSkillSearchRuntimeLoad = null;
  resonanceSkillDescriptionSearchById = new Map();
  return initializeResonanceSkillSearchRuntimeData();
}

async function loadResonanceSkillSearchRuntimeData(): Promise<void> {
  try {
    const response = await fetch(RESONANCE_SKILL_SEARCH_DATA_URL);
    if (!response.ok) return;
    const rows = (await response.json()) as ResonanceSkillSearchRaw[];
    const next = new Map<number, string>();
    for (const row of rows) {
      const id = row.id ?? row.Id;
      const text = row.DescriptionSearchText?.trim();
      if (!id || !text) continue;
      next.set(id, text);
    }
    resonanceSkillDescriptionSearchById = next;
  } catch (error) {
    console.warn("Failed to load resonance skill search data", error);
  }
}

function normalizeSearchText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function collectMultiLangTexts(value: MultiLangValue | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const locale of SUPPORTED_LOCALES) {
    const text = normalizeSearchText(value?.[locale]);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function getCurrentLocale(): LocaleCode {
  const locale = String(settings.state.live.general.language);

  if (isLocaleCode(locale)) {
    return locale;
  }

  return DEFAULT_LOCALE;
}

function resolveSkillMonitorUiTranslation(
  relativePath: string,
  key: string,
  fallback: string,
): string {
  return resolveUiTranslation(
    `ui/overlay/skill-monitor/${relativePath}.json`,
    key,
    getCurrentLocale(),
    fallback,
  );
}

function resolveMultiLangName(value: MultiLangValue | undefined, fallback: string): string {
  const locale = getCurrentLocale();
  const selected = value?.[locale]?.trim();
  if (selected) return selected;

  if (locale !== PRIMARY_FALLBACK_LOCALE) {
    const en = value?.[PRIMARY_FALLBACK_LOCALE]?.trim();
    if (en) return en;
  }

  if (locale !== DEFAULT_LOCALE) {
    const zh = value?.[DEFAULT_LOCALE]?.trim();
    if (zh) return zh;
  }

  return fallback;
}

function collectGeneratedNames(value: unknown): MultiLangValue {
  const out: MultiLangValue = {};
  if (!isRecord(value)) return out;

  for (const locale of SUPPORTED_LOCALES) {
    const text = value[locale];
    if (typeof text === "string" && text.trim()) {
      out[locale] = text.trim();
    }
  }

  return out;
}

function localizeResonanceSkill(skill: ResonanceSkillDefinition): ResonanceSkillDefinition {
  const displayName = resolveMultiLangName(skill.generatedNames, skill.name);
  const displayImagineName = resolveMultiLangName(
    skill.generatedImagineNames,
    skill.imagineName ?? "",
  );
  if (displayName === skill.name && displayImagineName === (skill.imagineName ?? "")) {
    return skill;
  }
  return {
    ...skill,
    name: displayName,
    ...(displayImagineName ? { imagineName: displayImagineName } : {}),
  };
}

export type ResonanceSkillDefinition = SkillDisplayInfo & {
  generatedNames?: MultiLangValue;
  imagineName?: string;
  generatedImagineNames?: MultiLangValue;
  generatedQuoteTexts?: MultiLangValue;
};

function collectResonanceSearchTexts(skill: ResonanceSkillDefinition): string[] {
  const texts = new Set<string>();

  const idText = String(skill.skillId);
  texts.add(idText);
  texts.add(`#${idText}`);

  const rawName = normalizeSearchText(skill.name);
  if (rawName) texts.add(rawName);

  for (const text of collectMultiLangTexts(skill.generatedNames)) {
    texts.add(text);
  }

  const imagineName = normalizeSearchText(skill.imagineName);
  if (imagineName) texts.add(imagineName);

  for (const text of collectMultiLangTexts(skill.generatedImagineNames)) {
    texts.add(text);
  }

  const descriptionSearchText = normalizeSearchText(
    resonanceSkillDescriptionSearchById.get(skill.skillId),
  );
  if (descriptionSearchText) texts.add(descriptionSearchText);

  for (const text of collectMultiLangTexts(skill.generatedQuoteTexts)) {
    texts.add(text);
  }

  return Array.from(texts);
}

export type CounterRulePreset = {
  ruleId: number;
  name: string;
  sources: CounterSource[];
  effectSlots: CounterEffectSlotPreset[];
};

export type CounterEffectSlotPreset = {
  slotId: number;
  threshold: number | null;
  resetBuffId: number;
  resetSourceConfigId?: number;
  onBuffAdd: CounterAction;
  onBuffChange: CounterAction;
  onBuffRemove: CounterAction;
  freezeDurationMs?: number;
  onFreezeExpire?: CounterAction;
  altFreeze?: { conditionBuffId: number; freezeDurationMs: number };
};

export type SourceTemplate = {
  sourceId: string;
  itemIds: number[];
  name: string;
  description: string;
  source: CounterSource;
};

export type SlotTemplate = {
  slotTemplateId: string;
  itemIds: number[];
  effectBuffIds?: number[];
  name: string;
  description: string;
  slot: Omit<CounterEffectSlotPreset, "slotId">;
};

export const CLASS_RESOURCES: Record<string, ResourceDefinition[]> =
  classResourcesRaw as Record<string, ResourceDefinition[]>;

export const CLASS_SPECIAL_BUFF_DISPLAYS: Record<string, SpecialBuffDisplay[]> =
  classSpecialBuffDisplaysRaw as Record<string, SpecialBuffDisplay[]>;

export const CLASS_SKILL_CONFIGS: Record<string, ClassSkillConfig> =
  classSkillConfigsRaw as Record<string, ClassSkillConfig>;

export type SkillDerivation = {
  sourceSkillId: number;
  derivedSkillId: number;
  triggerBuffBaseId: number;
  derivedName: string;
  derivedImagePath: string;
  keepCdWhenDerived?: boolean;
};

export const RESONANCE_SKILLS: ResonanceSkillDefinition[] = (
  resonanceSkillIcons as ResonanceSkillIconRaw[]
).map((skill) => {
  const generatedNames = collectGeneratedNames(skill.Names);
  const generatedImagineNames = collectGeneratedNames(skill.MonsterNames);
  const generatedQuoteTexts = collectGeneratedNames(skill.QuoteTexts);
  const fallbackName = skill.Name?.trim() || skill.NameDesign?.trim() || `#${skill.id}`;

  return {
    skillId: skill.id,
    name: fallbackName,
    generatedNames,
    generatedImagineNames,
    generatedQuoteTexts,
    imagePath: `/images/resonance_skill/${skill.Icon}`,
    ...(skill.maxCharges !== undefined ? { maxCharges: skill.maxCharges } : {}),
    ...(skill.maxValidCdTime !== undefined
      ? { maxValidCdTime: skill.maxValidCdTime }
      : {}),
  };
});

const SKILL_ICON_PATH_BY_ID = new Map<number, string>();

function addSkillIconPath(skillId: unknown, imagePath: unknown): void {
  const id = Number(skillId);
  const path = typeof imagePath === "string" ? imagePath.trim() : "";
  if (!Number.isFinite(id) || !path || SKILL_ICON_PATH_BY_ID.has(id)) {
    return;
  }
  SKILL_ICON_PATH_BY_ID.set(id, path);
}

for (const config of Object.values(CLASS_SKILL_CONFIGS)) {
  for (const skill of config.skills ?? []) {
    addSkillIconPath(skill.skillId, skill.imagePath);
  }
  for (const derivation of config.derivations ?? []) {
    addSkillIconPath(derivation.derivedSkillId, derivation.derivedImagePath);
  }
}

for (const skill of RESONANCE_SKILLS) {
  addSkillIconPath(skill.skillId, skill.imagePath);
}

export function lookupSkillIconPath(skillId: number | string | null | undefined): string | undefined {
  const id = Number(skillId);
  return Number.isFinite(id) ? SKILL_ICON_PATH_BY_ID.get(id) : undefined;
}

export function lookupFirstSkillIconPath(
  skillIds: Iterable<number | string | null | undefined>,
): string | undefined {
  for (const skillId of skillIds) {
    const iconPath = lookupSkillIconPath(skillId);
    if (iconPath) return iconPath;
  }
  return undefined;
}

export const COUNTER_RULES: CounterRulePreset[] =
  counterRulesRaw as CounterRulePreset[];
export const SOURCE_TEMPLATES: SourceTemplate[] =
  counterSourceTemplatesRaw as SourceTemplate[];
export const SLOT_TEMPLATES: SlotTemplate[] =
  counterSlotTemplatesRaw as SlotTemplate[];

const SEASON_CULTIVATE_FACTOR_SKILL_LABELS =
  seasonCultivateFactorSkillLabelsRaw as SeasonCultivateFactorSkillLabels;
const FACTOR_RULE_ID_BASE = 900_000_000;

function resolveSeasonCultivateFactorSkillLabel(
  entry: SeasonCultivateFactorSkillLabelEntry | undefined,
): string | null {
  const label = resolveMultiLangName(entry?.label, "").trim();
  return label || null;
}

export function resolveSeasonCultivateSourceSkillLabel(
  sourceId: string | null | undefined,
): string | null {
  if (!sourceId) return null;
  return resolveSeasonCultivateFactorSkillLabel(
    SEASON_CULTIVATE_FACTOR_SKILL_LABELS.sources?.[sourceId],
  );
}

export function resolveSeasonCultivateSlotSkillLabel(
  slotTemplateId: string | null | undefined,
): string | null {
  if (!slotTemplateId) return null;
  return resolveSeasonCultivateFactorSkillLabel(
    SEASON_CULTIVATE_FACTOR_SKILL_LABELS.slots?.[slotTemplateId],
  );
}

function localizeSkillDefinition(classKey: string, skill: SkillDefinition): SkillDefinition {
  return {
    ...skill,
    name: resolveSkillMonitorUiTranslation(
      "skill-cd",
      `classSkill.${classKey}.${skill.skillId}`,
      skill.name,
    ),
  };
}

function localizeSkillDerivation(classKey: string, derivation: SkillDerivation): SkillDerivation {
  return {
    ...derivation,
    derivedName: resolveSkillMonitorUiTranslation(
      "skill-cd",
      `classSkillDerived.${classKey}.${derivation.sourceSkillId}.${derivation.triggerBuffBaseId}`,
      derivation.derivedName,
    ),
  };
}

function localizeClassConfig(config: ClassSkillConfig): ClassSkillConfig {
  return {
    ...config,
    className: resolveSkillMonitorUiTranslation(
      "skill-cd",
      `className.${config.classKey}`,
      config.className,
    ),
    skills: config.skills.map((skill) => localizeSkillDefinition(config.classKey, skill)),
    ...(config.derivations
      ? {
          derivations: config.derivations.map((derivation) =>
            localizeSkillDerivation(config.classKey, derivation),
          ),
        }
      : {}),
  };
}

function localizeResourceDefinition(
  classKey: string,
  resource: ResourceDefinition,
): ResourceDefinition {
  const suffix = resource.type === "bar" ? "bar" : "charges";
  return {
    ...resource,
    label: resolveSkillMonitorUiTranslation(
      "skill-cd",
      `resourceLabel.${classKey}.${suffix}`,
      resource.label,
    ),
  };
}

function localizeCounterRule(rule: CounterRulePreset): CounterRulePreset {
  return {
    ...rule,
    name: resolveSkillMonitorUiTranslation(
      "custom-panel",
      `counterRule.${rule.ruleId}.name`,
      rule.name,
    ),
  };
}

function localizeSourceTemplate(template: SourceTemplate): SourceTemplate {
  return {
    ...template,
    name: resolveSkillMonitorUiTranslation(
      "custom-panel",
      `sourceTemplate.${template.sourceId}.name`,
      template.name,
    ),
    description: resolveSkillMonitorUiTranslation(
      "custom-panel",
      `sourceTemplate.${template.sourceId}.description`,
      template.description,
    ),
  };
}

function localizeSlotTemplate(template: SlotTemplate): SlotTemplate {
  return {
    ...template,
    name: resolveSkillMonitorUiTranslation(
      "custom-panel",
      `slotTemplate.${template.slotTemplateId}.name`,
      template.name,
    ),
    description: resolveSkillMonitorUiTranslation(
      "custom-panel",
      `slotTemplate.${template.slotTemplateId}.description`,
      template.description,
    ),
  };
}

export function getClassConfigs(): ClassSkillConfig[] {
  return Object.values(CLASS_SKILL_CONFIGS).map((config) => localizeClassConfig(config));
}

export function getCounterRules(): CounterRulePreset[] {
  return COUNTER_RULES.map((rule) => localizeCounterRule(rule));
}

export function getSourceTemplates(): SourceTemplate[] {
  return SOURCE_TEMPLATES.map((template) => localizeSourceTemplate(template));
}

export function getSlotTemplates(): SlotTemplate[] {
  return SLOT_TEMPLATES.map((template) => localizeSlotTemplate(template));
}

export function getSeasonCultivateFactorRuleId(itemId: number): number {
  return FACTOR_RULE_ID_BASE + itemId;
}

function normalizeTemplateItemIds(item: { itemIds?: number[] }): number[] {
  return Array.from(
    new Set(
      (item.itemIds ?? []).filter(
        (itemId) => Number.isInteger(itemId) && itemId > 0,
      ),
    ),
  ).sort((left, right) => left - right);
}

function normalizeTemplateEffectBuffIds(item: {
  effectBuffIds?: number[];
}): number[] {
  const result: number[] = [];
  const seen = new Set<number>();
  for (const buffId of item.effectBuffIds ?? []) {
    if (!Number.isInteger(buffId) || buffId <= 0 || seen.has(buffId)) continue;
    seen.add(buffId);
    result.push(buffId);
  }
  return result;
}

export function getSeasonCultivateFactorTemplates(): FactorCounterTemplate[] {
  return [
    ...SOURCE_TEMPLATES.map((template) => ({
      itemIds: normalizeTemplateItemIds(template),
      sources: [template.source],
      effectSlots: [],
    })),
    ...SLOT_TEMPLATES.map((template) => ({
      itemIds: normalizeTemplateItemIds(template),
      sources: [],
      effectSlots: resolveCounterEffectSlots([template.slotTemplateId]),
    })),
  ];
}

export function getSeasonCultivateFactorRuleMap(): Map<number, CounterRulePreset> {
  const map = new Map<number, CounterRulePreset>();
  for (const template of getSlotTemplates()) {
    const itemIds = normalizeTemplateItemIds(template);
    const effectSlots = resolveCounterEffectSlots([template.slotTemplateId]);
    for (const itemId of itemIds) {
      map.set(getSeasonCultivateFactorRuleId(itemId), {
        ruleId: getSeasonCultivateFactorRuleId(itemId),
        name: template.name,
        sources: [],
        effectSlots,
      });
    }
  }
  return map;
}

export function getSeasonCultivateFactorItemSlotTemplateMap(): Map<
  number,
  string
> {
  const map = new Map<number, string>();
  for (const template of SLOT_TEMPLATES) {
    for (const itemId of normalizeTemplateItemIds(template)) {
      map.set(itemId, template.slotTemplateId);
    }
  }
  return map;
}

export function getSeasonCultivateFactorEffectBuffIdMap(): Map<
  number,
  number[]
> {
  const map = new Map<number, number[]>();
  for (const template of SLOT_TEMPLATES) {
    const effectBuffIds = normalizeTemplateEffectBuffIds(template);
    if (effectBuffIds.length === 0) continue;
    for (const itemId of normalizeTemplateItemIds(template)) {
      map.set(itemId, effectBuffIds);
    }
  }
  return map;
}

export function getSeasonCultivateFactorProcBuffItemIdsMap(): Map<
  number,
  number[]
> {
  const map = new Map<number, number[]>();
  for (const template of SLOT_TEMPLATES) {
    const itemIds = normalizeTemplateItemIds(template);
    if (itemIds.length === 0) continue;
    const buffIds = new Set(normalizeTemplateEffectBuffIds(template));
    const resetBuffId = template.slot.resetBuffId;
    if (Number.isInteger(resetBuffId) && resetBuffId > 0) {
      buffIds.add(resetBuffId);
    }
    for (const buffId of buffIds) {
      const existing = map.get(buffId) ?? [];
      const merged = new Set([...existing, ...itemIds]);
      map.set(buffId, Array.from(merged).sort((left, right) => left - right));
    }
  }
  return map;
}

function getCounterSourceIncrement(source: CounterSource): number | null {
  if ("damageBySkillKey" in source) return source.damageBySkillKey.increment;
  if ("damageBySkillKeyOnce" in source) {
    return source.damageBySkillKeyOnce.increment;
  }
  if ("damageBySkillKeySelfTarget" in source) {
    return source.damageBySkillKeySelfTarget.increment;
  }
  if ("anyDamage" in source) return source.anyDamage.increment;
  if ("damageTaken" in source) return source.damageTaken.increment;
  if ("fightResourceSpent" in source) {
    return source.fightResourceSpent.increment;
  }
  if ("buffAdded" in source) return source.buffAdded.increment;
  if ("buffLayerSpent" in source) return source.buffLayerSpent.increment;
  if ("buffDurationTick" in source) {
    return source.buffDurationTick.increment;
  }
  if ("skillCast" in source) return source.skillCast.increment;
  if ("skillDurationTick" in source) {
    return source.skillDurationTick.increment;
  }
  if ("skillCastComplete" in source) {
    return source.skillCastComplete.increment;
  }
  if ("movementDistance" in source) {
    return source.movementDistance.increment;
  }
  return null;
}

export function getSeasonCultivateFactorSourceIncrementMap(): Map<
  number,
  number
> {
  const map = new Map<number, number>();
  const conflicts = new Set<number>();
  for (const template of SOURCE_TEMPLATES) {
    const increment = getCounterSourceIncrement(template.source);
    if (!Number.isFinite(increment) || increment === null || increment <= 0) {
      continue;
    }
    for (const itemId of normalizeTemplateItemIds(template)) {
      const existing = map.get(itemId);
      if (existing === undefined) {
        map.set(itemId, increment);
      } else if (existing !== increment) {
        conflicts.add(itemId);
      }
    }
  }
  for (const itemId of conflicts) {
    map.delete(itemId);
  }
  return map;
}

export function getSeasonCultivateFactorEffectBuffLabelMap(): Map<number, string> {
  const map = new Map<number, string>();
  for (const template of getSlotTemplates()) {
    const effectBuffIds = new Set(normalizeTemplateEffectBuffIds(template));
    if (Number.isInteger(template.slot.resetBuffId) && template.slot.resetBuffId > 0) {
      effectBuffIds.add(template.slot.resetBuffId);
    }
    for (const buffId of effectBuffIds) {
      if (!map.has(buffId)) {
        map.set(buffId, template.name);
      }
    }
  }
  return map;
}

export function getSeasonCultivateFactorConfiguredEffectBuffIds(): number[] {
  return Array.from(
    new Set(
      SLOT_TEMPLATES.flatMap((template) =>
        normalizeTemplateEffectBuffIds(template),
      ),
    ),
  ).sort((left, right) => left - right);
}

export function resolveCounterSources(sourceRefs: string[]): CounterSource[] {
  const templateMap = new Map(
    SOURCE_TEMPLATES.map((item) => [item.sourceId, item]),
  );
  return sourceRefs.flatMap((ref) => {
    const item = templateMap.get(ref);
    return item ? [item.source] : [];
  });
}

export function resolveCounterEffectSlots(
  slotRefs: string[],
): CounterEffectSlotPreset[] {
  const templateMap = new Map(
    SLOT_TEMPLATES.map((item) => [item.slotTemplateId, item]),
  );
  return slotRefs.flatMap((ref, idx) => {
    const item = templateMap.get(ref);
    return item
      ? [
          {
            slotId: idx + 1,
            threshold: item.slot.threshold,
            resetBuffId: item.slot.resetBuffId,
            ...(item.slot.resetSourceConfigId !== undefined
              ? { resetSourceConfigId: item.slot.resetSourceConfigId }
              : {}),
            onBuffAdd: item.slot.onBuffAdd,
            onBuffChange: item.slot.onBuffChange,
            onBuffRemove: item.slot.onBuffRemove,
            ...(item.slot.freezeDurationMs !== undefined
              ? { freezeDurationMs: item.slot.freezeDurationMs }
              : {}),
            ...(item.slot.onFreezeExpire !== undefined
              ? { onFreezeExpire: item.slot.onFreezeExpire }
              : {}),
            ...(item.slot.altFreeze !== undefined
              ? { altFreeze: item.slot.altFreeze }
              : {}),
          },
        ]
      : [];
  });
}

export function ensureUserCounterRules(
  rules: UserCounterRule[] | undefined,
): UserCounterRule[] {
  return (rules ?? []).map((rule, idx) => ({
    ruleId: Number.isInteger(rule.ruleId) ? rule.ruleId : 10001 + idx,
    name: rule.name?.trim() || `自定义计数器 ${idx + 1}`,
    sourceRefs: Array.from(
      new Set(
        (rule.sourceRefs ?? []).filter(
          (item) => typeof item === "string" && item.trim(),
        ),
      ),
    ),
    slotRefs: Array.from(
      new Set(
        (rule.slotRefs ?? []).filter(
          (item) => typeof item === "string" && item.trim(),
        ),
      ),
    ),
  }));
}

export function resolveUserCounterRulesToPresets(
  rules: UserCounterRule[] | undefined,
): CounterRulePreset[] {
  return ensureUserCounterRules(rules).flatMap((rule) => {
    const sources = resolveCounterSources(rule.sourceRefs);
    const effectSlots = resolveCounterEffectSlots(rule.slotRefs);
    if (sources.length === 0 || effectSlots.length === 0) {
      return [];
    }
    return [
      {
        ruleId: rule.ruleId,
        name: rule.name,
        sources,
        effectSlots,
      },
    ];
  });
}

export function getSkillsByClass(classKey: string): SkillDefinition[] {
  return (CLASS_SKILL_CONFIGS[classKey]?.skills ?? []).map((skill) =>
    localizeSkillDefinition(classKey, skill),
  );
}

export function getDurationSkillsByClass(classKey: string): SkillDefinition[] {
  return getSkillsByClass(classKey).filter(
    (skill) => skill.effectDurationMs !== undefined,
  );
}

export function findSkillById(
  classKey: string,
  skillId: number,
): SkillDefinition | undefined {
  const skill = CLASS_SKILL_CONFIGS[classKey]?.skills.find(
    (skill) => skill.skillId === skillId,
  );
  return skill ? localizeSkillDefinition(classKey, skill) : undefined;
}

export function findResourcesByClass(classKey: string): ResourceDefinition[] {
  return (CLASS_RESOURCES[classKey] || []).map((resource) =>
    localizeResourceDefinition(classKey, resource),
  );
}

export function findSpecialBuffDisplays(
  classKey: string,
): SpecialBuffDisplay[] {
  return CLASS_SPECIAL_BUFF_DISPLAYS[classKey] ?? [];
}

export function getDefaultMonitoredBuffIds(classKey: string): number[] {
  return CLASS_SKILL_CONFIGS[classKey]?.defaultMonitoredBuffIds ?? [];
}

export function findSkillDerivationBySource(
  classKey: string,
  sourceSkillId: number,
): SkillDerivation | undefined {
  const derivation = CLASS_SKILL_CONFIGS[classKey]?.derivations?.find(
    (derivation) => derivation.sourceSkillId === sourceSkillId,
  );
  return derivation ? localizeSkillDerivation(classKey, derivation) : undefined;
}

export function findResonanceSkill(
  skillId: number,
): ResonanceSkillDefinition | undefined {
  const skill = RESONANCE_SKILLS.find((item) => item.skillId === skillId);
  return skill ? localizeResonanceSkill(skill) : undefined;
}

export function searchResonanceSkills(
  keyword: string,
): ResonanceSkillDefinition[] {
  const normalized = normalizeSearchText(keyword);
  if (!normalized) return [];

  const matches = RESONANCE_SKILLS
    .map((skill) => {
      const texts = collectResonanceSearchTexts(skill);
      let rank: number | null = null;

      for (const text of texts) {
        if (text === normalized) {
          rank = rank === null ? 0 : Math.min(rank, 0);
          continue;
        }
        if (text.includes(normalized)) {
          rank = rank === null ? 1 : Math.min(rank, 1);
        }
      }

      return rank === null ? null : { skill, rank };
    })
    .filter((entry): entry is { skill: ResonanceSkillDefinition; rank: number } => entry !== null)
    .sort((a, b) => a.rank - b.rank || a.skill.skillId - b.skill.skillId);

  return matches.map(({ skill }) => localizeResonanceSkill(skill));
}

export function findAnySkillByBaseId(
  classKey: string,
  skillId: number,
): SkillDisplayInfo | undefined {
  return findSkillById(classKey, skillId) ?? findResonanceSkill(skillId);
}

void initializeResonanceSkillSearchRuntimeData();
