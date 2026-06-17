import {
  findAnySkillByBaseId,
  findSkillById,
  findSpecialBuffDisplays,
  getCounterRules,
  getSeasonCultivateFactorConfiguredEffectBuffIds,
  getSeasonCultivateFactorEffectBuffLabelMap,
  getSeasonCultivateFactorItemSlotTemplateMap,
  getSeasonCultivateFactorRuleId,
  getSeasonCultivateFactorRuleMap,
  getSeasonCultivateFactorSourceIncrementMap,
  getSeasonCultivateFactorThreshold,
  getSourceTemplateSources,
  getSourceTemplates,
  getSlotTemplates,
  resolveSeasonCultivateSlotSkillLabel,
  resolveSeasonCultivateSourceSkillLabel,
  type CounterRulePreset,
  type SlotTemplate,
  type SourceTemplate,
} from "$lib/skill-mappings";
import {
  expandBuffSelection,
  getBuffCategoryLabel,
  getBuffIdsByCategory,
  normalizeBuffCategoryKeys,
  resolveBuffCategoryKey,
  resolveBuffOverlayDisplayName,
  type BuffCategoryKey,
} from "$lib/config/buff-name-table";
import { lookupLocalizedDamageIdName } from "$lib/config/recount-table";
import { localizeMonsterName } from "$lib/monster-mappings";
import { resolveKnownSkillStageDisplayName } from "$lib/skill-stage-labels";
import type { BuffUpdateState, CounterSlotState } from "$lib/api";
import type {
  CustomPanelDisplayRow,
  IconBuffDisplay,
  SkillDisplay,
  SkillDurationDisplay,
  TextBuffDisplay,
  BuffUptimeDisplayRow,
} from "./overlay-types";
import {
  buildBuffTextRow,
  buildPanelAreaRows,
  computeDisplay,
  ensureBuffGroups,
  ensureIndividualMonitorAllGroup,
  formatTimerText,
  getBuffRemainingMs,
  getCustomPanelDisplayRow,
  getBuffRemainPercent,
  getResourcePreciseValue as getResourcePreciseValueValue,
  getResourceValue as getResourceValueValue,
  isBuffActive,
  resolveAlertState,
} from "./overlay-utils";
import { uiT } from "$lib/i18n";
import { ensureBuffAlerts, SETTINGS, type BuffGroup, type InlineBuffEntry } from "$lib/settings-store";
import {
  activeProfile,
  buffAliases,
  buffDisplayMode,
  buffPriorityIds,
  buffUptimeActiveIndicators,
  buffUptimeAliases,
  buffUptimeColors,
  buffUptimeTrackingModes,
  customPanelGroups,
  expandedMonitoredBuffIds,
  factorSlotLabels,
  monitoredUptimeBuffIds,
  enabledPanelAttrs,
  monitoredBuffCategories,
  monitoredBuffIds,
  monitoredSkillDurationIds,
  resolvedUserCounterRules,
  selectedClassKey,
  textBuffMaxVisible,
  showTrueUptime,
} from "./overlay-profile.svelte.js";
import {
  activeUptimeRowKeys,
  buffMap,
  buffDefinitions,
  cdMap,
  counterMap,
  factorCounterMap,
  liveData,
  nameCache,
  overlayRuntime,
  seasonCultivateFactorCandidateSlotItemIds,
  seasonCultivateFactorProcCounts,
  seasonCultivateFactorSlotItemIds,
  skillDurationMap,
  uptimeTotals,
} from "./overlay-runtime.svelte.js";
import { overlayNow } from "./overlay-clock.svelte.js";
import { legacyEntityFallbacksDisabled } from "$lib/entity-identity-dry-run";

function resolveOverlaySkillDisplayName(skillId: number, baseName: string): string {
  return resolveKnownSkillStageDisplayName(
    skillId,
    SETTINGS.live.general.state.language,
    baseName,
  ) ?? baseName;
}

const tCustomPanel = uiT(
  "overlay/skill-monitor/custom-panel",
  () => SETTINGS.live.general.state.language,
);

const tMonsterMonitor = uiT(
  "overlay/monster-monitor",
  () => SETTINGS.live.general.state.language,
);

function buffCategoryLabel(category: BuffCategoryKey): string {
  return tMonsterMonitor(`teammate.category.${category}`, getBuffCategoryLabel(category));
}

const FACTOR_CLASS_KEYS = [
  "wind_knight",
  "frost_mage",
  "flame_berserker",
  "stormblade",
  "beat_performer",
  "heavy_guardian",
  "shield_knight",
  "marksman",
  "verdant_oracle",
];

const _normalizedBuffGroups = $derived.by(() => {
  const profile = activeProfile();
  if (!profile) return [];
  return ensureBuffGroups(profile);
});

const _individualMonitorAllGroup = $derived.by(() => {
  const profile = activeProfile();
  if (!profile) return null;
  return ensureIndividualMonitorAllGroup(profile);
});

const _panelAreaRows = $derived.by(() =>
  buildPanelAreaRows(activeProfile(), enabledPanelAttrs()),
);

const _specialBuffConfigMap = $derived.by(() => {
  const map = new Map<number, (ReturnType<typeof findSpecialBuffDisplays>)[number]>();
  for (const config of findSpecialBuffDisplays(selectedClassKey())) {
    map.set(config.buffBaseId, config);
  }
  return map;
});

const _counterRuleMap = $derived.by(() => {
  const map = new Map<number, CounterRulePreset>();
  for (const rule of getCounterRules()) {
    map.set(rule.ruleId, rule);
  }
  for (const rule of resolvedUserCounterRules()) {
    map.set(rule.ruleId, rule);
  }
  return map;
});

const _seasonCultivateFactorRuleMap = $derived.by(() =>
  getSeasonCultivateFactorRuleMap(),
);

const _seasonCultivateFactorItemSlotTemplateMap = $derived.by(() =>
  getSeasonCultivateFactorItemSlotTemplateMap(),
);

const _seasonCultivateFactorSourceIncrementMap = $derived.by(() =>
  getSeasonCultivateFactorSourceIncrementMap(),
);

const _seasonCultivateFactorSourceTemplateMap = $derived.by(() => {
  const map = new Map<number, SourceTemplate>();
  for (const template of getSourceTemplates()) {
    for (const itemId of template.itemIds ?? []) {
      map.set(itemId, template);
    }
  }
  return map;
});

const _seasonCultivateFactorSlotTemplateMap = $derived.by(() => {
  const map = new Map<number, SlotTemplate>();
  for (const template of getSlotTemplates()) {
    for (const itemId of template.itemIds ?? []) {
      map.set(itemId, template);
    }
  }
  return map;
});

const _seasonCultivateFactorOwnedEffectBuffIds = $derived.by(() => {
  const result = new Set<number>();
  const hasFactorPanelGroup = customPanelGroups().some(
    (group) => group.kind === "seasonCultivateFactor",
  );
  if (!hasFactorPanelGroup) return result;

  for (const buffId of getSeasonCultivateFactorConfiguredEffectBuffIds()) {
    result.add(buffId);
  }
  return result;
});

const _seasonCultivateFactorEffectBuffLabelMap = $derived.by(() =>
  getSeasonCultivateFactorEffectBuffLabelMap(),
);

function resolveFactorBuffName(
  baseId: number,
  aliases: Record<string, string>,
): string {
  return (
    _seasonCultivateFactorEffectBuffLabelMap.get(baseId)
    ?? resolveBuffOverlayDisplayName(baseId, aliases)
  );
}

function getLocalPlayerFactorBuffMap(): Map<number, BuffUpdateState> {
  const result = new Map<number, BuffUpdateState>();
  const data = liveData();
  const localEntity = data?.entities.find((entity) =>
    (data.localPlayerUuid ?? data.localPlayerKey)
      ? (entity.entityUuid ?? entity.entityKey) ===
        (data.localPlayerUuid ?? data.localPlayerKey)
      : !legacyEntityFallbacksDisabled() && entity.uid === data.localPlayerUid,
  );
  const maybeSet = (baseId: number | null | undefined, buff: BuffUpdateState) => {
    if (!baseId || baseId <= 0) return;
    const existing = result.get(baseId);
    if (!existing || buff.createTimeMs >= existing.createTimeMs) {
      result.set(baseId, buff);
    }
  };
  for (const [baseId, buff] of buffMap()) {
    maybeSet(baseId, buff);
  }
  for (const buff of localEntity?.activeEffectBuffs ?? []) {
    const converted: BuffUpdateState = {
      baseId: buff.observedBuffId,
      layer: buff.layer,
      durationMs: buff.durationMs,
      createTimeMs: buff.createTimeMs,
      hostUid: buff.hostUid,
      sourceUid: buff.sourceUid,
      sourceConfigId: buff.sourceConfigId,
    };
    maybeSet(buff.observedBuffId, converted);
    maybeSet(buff.effectSourceBuffId, {
      ...converted,
      baseId: buff.effectSourceBuffId,
    });
  }
  for (const buff of localEntity?.activeFactorBuffs ?? []) {
    const converted: BuffUpdateState = {
      baseId: buff.observedBuffId,
      layer: buff.layer,
      durationMs: buff.durationMs,
      createTimeMs: buff.createTimeMs,
      hostUid: buff.hostUid,
      sourceUid: buff.sourceUid,
      sourceConfigId: buff.sourceConfigId,
    };
    maybeSet(buff.observedBuffId, converted);
    maybeSet(buff.factorBuffId, {
      ...converted,
      baseId: buff.factorBuffId,
    });
  }
  return result;
}

function isCounterSlotLocked(slot: CounterSlotState | undefined, now: number): boolean {
  if (!slot) return false;
  if (
    slot.freezeUntilMs !== null &&
    slot.freezeUntilMs !== undefined &&
    slot.freezeUntilMs > now
  ) {
    return true;
  }
  return slot.isCounting === false;
}

function isRealityFactorItem(itemId: number): boolean {
  const template = _seasonCultivateFactorSlotTemplateMap.get(itemId);
  if (!template) return false;
  return getFactorBaseLabel(template.name, "slot")
    .toLowerCase()
    .startsWith("reality ");
}

function getInferredFactorEnergyTotal(now: number): number {
  let total = 0;
  for (const itemId of seasonCultivateFactorSlotItemIds()) {
    const increment = _seasonCultivateFactorSourceIncrementMap.get(itemId);
    if (!increment || increment <= 0) continue;
    const ruleId = getSeasonCultivateFactorRuleId(itemId);
    const currentCount = getSeasonCultivateSourceCounterCount(
      itemId,
      ruleId,
      1,
      now,
    );
    total += currentCount;
  }
  return total;
}

function buildInferredFactorEnergyRow(now: number): CustomPanelDisplayRow | null {
  const total = getInferredFactorEnergyTotal(now);
  const hasSourceRows = seasonCultivateFactorSlotItemIds().some((itemId) => {
    const increment = _seasonCultivateFactorSourceIncrementMap.get(itemId);
    return Boolean(increment && increment > 0);
  });
  if (!hasSourceRows && !overlayRuntime.isEditing) return null;
  return {
    key: "season_cultivate_inferred_energy",
    label: "",
    prefixText: tCustomPanel("customPanel.factorCounterProcs", "Procs"),
    valueText: hasSourceRows || overlayRuntime.isEditing ? String(total) : "--",
    metaText: tCustomPanel("customPanel.inferredFactorEnergy", "Illusion Energy"),
    progressPercent: 0,
    showProgress: false,
    isPlaceholder: !hasSourceRows,
  };
}

function getSeasonCultivateProcPrefix(
  itemId: number,
  ruleId: number,
  slotId: number,
  now: number,
): string | undefined {
  const increment = _seasonCultivateFactorSourceIncrementMap.get(itemId);
  const observedProcCount =
    seasonCultivateFactorProcCounts().get(itemId) ?? 0;
  if (
    _seasonCultivateFactorSourceTemplateMap.has(itemId) &&
    (!increment || increment <= 0)
  ) {
    const counterProcCount = getSeasonCultivateSourceCounterCount(
      itemId,
      ruleId,
      slotId,
      now,
    );
    return String(Math.max(counterProcCount, observedProcCount));
  }
  if (!increment || increment <= 0) {
    return String(observedProcCount);
  }
  const currentCount = getSeasonCultivateSourceCounterCount(
    itemId,
    ruleId,
    slotId,
    now,
  );
  const procCount = Math.floor(currentCount / increment);
  return String(procCount);
}

function getSeasonCultivateCounterCount(
  ruleId: number,
  slotId: number,
): number {
  const counter = factorCounterMap().get(ruleId);
  const slot =
    counter?.slots.find((item) => item.slotId === slotId) ?? counter?.slots[0];
  return Math.max(0, slot?.currentCount ?? 0);
}

function getSeasonCultivateSourceCounterCount(
  itemId: number,
  ruleId: number,
  slotId: number,
  now?: number,
): number {
  const counter = factorCounterMap().get(ruleId);
  const slot =
    counter?.slots.find((item) => item.slotId === slotId) ?? counter?.slots[0];
  if (
    now !== undefined &&
    isRealityFactorItem(itemId) &&
    isCounterSlotLocked(slot, now)
  ) {
    return 0;
  }
  return getSeasonCultivateCounterCount(ruleId, slotId);
}

function getSeasonCultivateSourceValueText(
  itemId: number,
  ruleId: number,
  slotId: number,
  now: number,
): string | undefined {
  const increment = _seasonCultivateFactorSourceIncrementMap.get(itemId);
  if (!increment || increment <= 0) return undefined;
  const currentCount = getSeasonCultivateSourceCounterCount(
    itemId,
    ruleId,
    slotId,
    now,
  );
  return String(currentCount);
}

function getSeasonCultivateFactorTimerText(
  linkedBuff: BuffUpdateState | undefined,
  now: number,
  hasTimer: boolean,
): string | undefined {
  if (!hasTimer) return undefined;
  if (!linkedBuff || linkedBuff.durationMs <= 0 || !isBuffActive(linkedBuff, now)) return undefined;
  const remainingMs = getBuffRemainingMs(linkedBuff, now);
  return remainingMs > 0 ? formatTimerText(remainingMs) : undefined;
}

function getFirstSourceSkillBaseId(template: SourceTemplate): number | null {
  for (const source of getSourceTemplateSources(template)) {
    if ("skillCast" in source) return source.skillCast.skillBaseIds[0] ?? null;
    if ("skillCastComplete" in source) {
      return source.skillCastComplete.skillBaseIds[0] ?? null;
    }
    if ("skillDurationTick" in source) return source.skillDurationTick.skillBaseId;
  }
  return null;
}

function getSourceSkillKeyLabel(template: SourceTemplate): string | null {
  for (const source of getSourceTemplateSources(template)) {
    const skillKeys =
      "damageBySkillKey" in source
        ? source.damageBySkillKey.skillKeys
        : "damageBySkillKeyOnce" in source
          ? source.damageBySkillKeyOnce.skillKeys
          : "damageBySkillKeySelfTarget" in source
            ? source.damageBySkillKeySelfTarget.skillKeys
            : "damageTaken" in source
              ? source.damageTaken.skillKeys ?? []
              : [];
    for (const skillKey of skillKeys) {
      const label = lookupLocalizedDamageIdName(
        skillKey,
        SETTINGS.live.general.state.language,
      );
      if (label && !label.startsWith("Unknown (")) return label;
    }
  }
  return null;
}

function findClassSkillLabel(skillBaseId: number): string | null {
  const selectedSkill = findSkillById(selectedClassKey(), skillBaseId);
  if (selectedSkill?.name) return selectedSkill.name;
  for (const classKey of FACTOR_CLASS_KEYS) {
    if (classKey === selectedClassKey()) continue;
    const skill = findSkillById(classKey, skillBaseId);
    if (skill?.name) return skill.name;
  }
  return null;
}

function getSourceTemplateSkillLabel(template?: SourceTemplate): string | null {
  if (!template) return null;
  const mapped = resolveSeasonCultivateSourceSkillLabel(template.sourceId);
  if (mapped) return mapped;
  const skillBaseId = getFirstSourceSkillBaseId(template);
  if (skillBaseId !== null) {
    const skillName = findClassSkillLabel(skillBaseId);
    if (skillName) return skillName;
  }
  const damageSkillName = getSourceSkillKeyLabel(template);
  if (damageSkillName) return damageSkillName;
  const description = template.description.trim();
  const sourceTextMatch =
    description.match(/(?:Casting|cast of|with|damage with)\s+([^.;,()]+?)(?:\s+grants|\s+is|\s+does|\s+Illusion|\s+Void|$)/i)
    ?? description.match(/^([^.;,()]+?)\s+(?:deals?|dealing|causes?|does)\s+.*(?:grants|gain|gives)/i)
    ?? description.match(/^([^.;,()]+?)\s+(?:Illusion|Void)/i);
  const text = sourceTextMatch?.[1]?.trim();
  return text && text.length <= 48 ? text : null;
}

function getSlotTemplateSkillLabel(template?: SlotTemplate): string | null {
  if (!template) return null;
  const mapped = resolveSeasonCultivateSlotSkillLabel(template.slotTemplateId);
  if (mapped) return mapped;
  const description = template.description.trim();
  const triggerMatch =
    description.match(/triggers?\s+([^.;]+?)(?:;|\.|,|$)/i)
    ?? description.match(/next cast of\s+([^.;,]+?)(?:\s+restores|\s+does|\s+is|,|\.|$)/i);
  const text = triggerMatch?.[1]?.trim();
  return text && text.length <= 48 ? text : null;
}

function getFactorBaseLabel(name: string, kind: "source" | "slot"): string {
  const normalized = name
    .replace(/\s*,.*$/, "")
    .replace(/\bS\d+\s+(X\d+)\b/i, "$1")
    .trim();
  const xMatch = normalized.match(/\bX\d+\b/i)?.[0]?.toUpperCase();
  if (kind === "source" && xMatch) return xMatch;
  if (kind === "slot") {
    const reality =
      normalized.match(/Reality(?:\s+Factor)?\s+(X\d+)/i)?.[1]
      ?? normalized.match(/真实因子\s*(X\d+)/i)?.[1];
    if (reality) return `Reality ${reality.toUpperCase()}`;
  }
  return normalized;
}

function getSeasonCultivateDisplayLabel(
  itemId: number,
  fallbackLabel: string,
  kind: "source" | "slot",
): string {
  const sourceTemplate = _seasonCultivateFactorSourceTemplateMap.get(itemId);
  const slotTemplate = _seasonCultivateFactorSlotTemplateMap.get(itemId);
  const templateName =
    kind === "source" ? sourceTemplate?.name : slotTemplate?.name;
  const baseLabel = getFactorBaseLabel(templateName ?? fallbackLabel, kind);
  const skillLabel =
    kind === "source"
      ? getSourceTemplateSkillLabel(sourceTemplate)
      : getSlotTemplateSkillLabel(slotTemplate);
  return skillLabel ? `${baseLabel} - ${skillLabel}` : baseLabel;
}

function getSeasonCultivateCandidateSortRank(itemId: number): number {
  const template = _seasonCultivateFactorSlotTemplateMap.get(itemId);
  const templateId = template?.slotTemplateId ?? "";
  const name = (template?.name ?? "").toLowerCase();
  const threshold = getSeasonCultivateFactorThreshold(
    itemId,
    template?.slot.threshold,
  );
  if (threshold !== null && threshold !== undefined && threshold > 0) return 0;
  if (name.includes("reality") || templateId.includes("_x4")) return 0;
  if (name.includes("polarity") || templateId.startsWith("factor_3058")) {
    return 2;
  }
  if (name.includes("stasis") || templateId.startsWith("factor_3059")) {
    return 3;
  }
  return 4;
}

function isSeasonCultivateStasisFactor(itemId: number): boolean {
  const template = _seasonCultivateFactorSlotTemplateMap.get(itemId);
  const templateId = template?.slotTemplateId ?? "";
  const name = (template?.name ?? "").toLowerCase();
  return name.includes("stasis") || templateId.startsWith("factor_3059");
}

function buildSeasonCultivateThresholdRow(
  itemId: number,
  rule: CounterRulePreset,
  label: string,
  factorBuffMap: Map<number, BuffUpdateState>,
  now: number,
  hideWhenZero = false,
): CustomPanelDisplayRow | null {
  const slot = rule.effectSlots[0];
  if (!slot) return null;
  const counter = factorCounterMap().get(rule.ruleId);
  const counterSlot = counter?.slots.find((item) => item.slotId === slot.slotId)
    ?? counter?.slots[0];
  const threshold =
    counterSlot?.effectiveThreshold
    ?? counterSlot?.threshold
    ?? getSeasonCultivateFactorThreshold(itemId, slot.threshold);
  if (!threshold || threshold <= 0) return null;
  const inferredTotal = getInferredFactorEnergyTotal(now);
  const total = Math.max(0, counterSlot?.currentCount ?? 0, inferredTotal);
  const observedProcCount = seasonCultivateFactorProcCounts().get(itemId) ?? 0;
  const storedProcCount = counterSlot?.procCount ?? 0;
  const procCount = Math.max(
    storedProcCount,
    observedProcCount,
    Math.floor(total / threshold),
  );
  const remainder = total % threshold;
  const linkedBuff = factorBuffMap.get(slot.resetBuffId);
  const active = isBuffActive(linkedBuff, now);
  const timerProgressPercent = getBuffRemainPercent(linkedBuff, now);
  const freezeUntilMs = counterSlot?.freezeUntilMs;
  const isFrozen =
    freezeUntilMs !== null
    && freezeUntilMs !== undefined
    && freezeUntilMs > now;
  const freezeRemainingMs = isFrozen ? Math.max(0, freezeUntilMs - now) : 0;
  const freezeDurationMs =
    counterSlot?.effectiveFreezeDurationMs
    ?? counterSlot?.freezeDurationMs
    ?? 0;
  const freezeProgressPercent =
    freezeDurationMs > 0
      ? Math.max(0, Math.min(100, (freezeRemainingMs / freezeDurationMs) * 100))
      : 0;
  const bucketProgressPercent = Math.max(
    0,
    Math.min(100, (remainder / threshold) * 100),
  );
  if (hideWhenZero && !isFrozen && !active && procCount === 0 && remainder === 0) {
    return null;
  }
  return {
    key: `season_cultivate_factor_threshold_${itemId}`,
    label,
    prefixText: String(procCount),
    valueText: `${remainder}/${threshold}`,
    timerText: isFrozen
      ? formatTimerText(freezeRemainingMs)
      : getSeasonCultivateFactorTimerText(
          linkedBuff,
          now,
          typeof slot.resetBuffId === "number" && slot.resetBuffId > 0,
        ),
    progressPercent:
      isFrozen && freezeDurationMs > 0
        ? freezeProgressPercent
        : active && linkedBuff?.durationMs
          ? timerProgressPercent
          : bucketProgressPercent,
    showProgress: isFrozen && freezeDurationMs > 0
      ? true
      : active && linkedBuff?.durationMs
        ? true
        : bucketProgressPercent > 0,
  };
}

const _buffSnapshot = $derived.by(() => {
  const now = overlayNow();
  const explicitSelectedBuffIds = monitoredBuffIds();
  const expandedSelectedBuffIds = new Set(expandedMonitoredBuffIds());
  const priorityIds = buffPriorityIds();
  const buffDefinitionsMap = buffDefinitions();
  const panelGroups = customPanelGroups();
  const alertMap = ensureBuffAlerts(activeProfile()?.buffAlerts);
  const resolveAlert = (
    baseId: number,
    remainingMs: number,
    durationMs: number,
  ) => resolveAlertState(alertMap[String(baseId)], remainingMs, durationMs);
  const skippedInlineBuffIds = new Set(
    panelGroups
      .filter((group) => (group.kind ?? "manual") === "manual")
      .flatMap((group) => group.entries)
      .filter((entry) => entry.sourceType === "buff")
      .map((entry) => entry.sourceId),
  );
  const currentBuffAliases = buffAliases();
  const factorOwnedEffectBuffIds = _seasonCultivateFactorOwnedEffectBuffIds;
  const nextActiveBuffIds = new Set<number>();
  const nextBuffDurationPercents = new Map<number, number>();
  const nextIconBuffs: IconBuffDisplay[] = [];
  const nextTextBuffs: TextBuffDisplay[] = [];
  const nextCustomPanelRowsByGroup = new Map<string, CustomPanelDisplayRow[]>();

  for (const [baseId, buff] of buffMap()) {
    if (skippedInlineBuffIds.has(baseId)) continue;

    const end = buff.createTimeMs + buff.durationMs;
    const remaining = Math.max(0, end - now);
    const remainPercent =
      buff.durationMs > 0
        ? Math.min(100, Math.max(0, (remaining / buff.durationMs) * 100))
        : 100;

    if (buff.durationMs > 0) {
      nextBuffDurationPercents.set(baseId, remainPercent);
    }
    if (buff.durationMs <= 0 || end > now) {
      nextActiveBuffIds.add(baseId);
    } else {
      continue;
    }

    // Keep monitor-all quiet, but allow explicitly selected state buffs with no timer.
    const allowPassiveSingleStack = expandedSelectedBuffIds.has(baseId);
    if (buff.durationMs <= 0 && buff.layer <= 1 && !allowPassiveSingleStack) continue;
    if (factorOwnedEffectBuffIds.has(baseId)) continue;

    const definition = buffDefinitionsMap.get(baseId);
    const name = resolveBuffOverlayDisplayName(baseId, currentBuffAliases);
    const timeText = formatTimerText(remaining);
    const alert = resolveAlert(baseId, remaining, buff.durationMs);
    const specialConfig = _specialBuffConfigMap.get(baseId);
    const specialImages = specialConfig
      ? (() => {
          const layer = Math.max(1, buff.layer);
          const layerIdx = Math.min(
            specialConfig.layerImages.length - 1,
            layer - 1,
          );
          return specialConfig.layerImages[layerIdx] ?? [];
        })()
      : [];

    if (definition?.spriteFile) {
      nextIconBuffs.push({
        baseId,
        name,
        spriteFile: definition.spriteFile,
        text: timeText,
        layer: buff.layer,
        ...(specialImages.length > 0 ? { specialImages } : {}),
        ...(alert ? { alert } : {}),
      });
    } else {
      const row = buildBuffTextRow(
        `buff_${baseId}`,
        name,
        buff,
        now,
        false,
        allowPassiveSingleStack,
        resolveAlert,
      );
      if (row) nextTextBuffs.push(row);
    }
  }

  if (overlayRuntime.isEditing) {
    const iconIds = new Set(nextIconBuffs.map((buff) => buff.baseId));
    const textIds = new Set(nextTextBuffs.map((buff) => buff.key));
    for (const baseId of explicitSelectedBuffIds) {
      if (factorOwnedEffectBuffIds.has(baseId)) continue;
      if (iconIds.has(baseId) || textIds.has(`buff_${baseId}`)) continue;
      const definition = buffDefinitionsMap.get(baseId);
      const name = resolveBuffOverlayDisplayName(baseId, currentBuffAliases);
      const specialConfig = _specialBuffConfigMap.get(baseId);
      const placeholderSpecialImages =
        specialConfig && specialConfig.layerImages.length > 0
          ? (specialConfig.layerImages[0] ?? [])
          : [];
      if (definition?.spriteFile) {
        nextIconBuffs.push({
          baseId,
          name,
          spriteFile: definition.spriteFile,
          text: "--",
          layer: 1,
          isPlaceholder: true,
          ...(placeholderSpecialImages.length > 0
            ? { specialImages: placeholderSpecialImages }
            : {}),
        });
      } else {
        const row = buildBuffTextRow(
          `buff_${baseId}`,
          name,
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
        );
        if (row) nextTextBuffs.push(row);
      }
    }
  }

  const sortBuffPriority = getBuffPrioritySorter(priorityIds);
  nextIconBuffs.sort((left, right) => {
    const [leftPriority, leftBaseId] = sortBuffPriority(left.baseId);
    const [rightPriority, rightBaseId] = sortBuffPriority(right.baseId);
    return leftPriority - rightPriority || leftBaseId - rightBaseId;
  });
  nextTextBuffs.sort((left, right) => {
    const [leftPriority, leftBaseId] = sortBuffPriority(getTextBuffBaseId(left));
    const [rightPriority, rightBaseId] = sortBuffPriority(getTextBuffBaseId(right));
    return leftPriority - rightPriority || leftBaseId - rightBaseId;
  });

  for (const group of panelGroups) {
    const nextRows: CustomPanelDisplayRow[] = [];
    if (group.kind === "seasonCultivateFactor") {
      const inferredEnergyRow = buildInferredFactorEnergyRow(now);
      if (inferredEnergyRow) nextRows.push(inferredEnergyRow);

      const factorBuffMap = getLocalPlayerFactorBuffMap();
      const trustedFactorItemIds = new Set<number>();
      const thresholdRows: CustomPanelDisplayRow[] = [];
      const sourceRows: CustomPanelDisplayRow[] = [];
      const candidateRows: CustomPanelDisplayRow[] = [];
      const autoShowStasisFactors = group.autoShowStasisFactors !== false;
      for (const itemId of seasonCultivateFactorSlotItemIds()) {
        if (
          !autoShowStasisFactors
          && isSeasonCultivateStasisFactor(itemId)
        ) {
          continue;
        }
        trustedFactorItemIds.add(itemId);
        const ruleId = getSeasonCultivateFactorRuleId(itemId);
        const rule = _seasonCultivateFactorRuleMap.get(ruleId);
        if (!rule) continue;
        const sourceTemplate = _seasonCultivateFactorSourceTemplateMap.get(itemId);
        const sourceIncrement =
          _seasonCultivateFactorSourceIncrementMap.get(itemId);
        const isEnergySource = Boolean(sourceIncrement && sourceIncrement > 0);
        const slotTemplateId =
          _seasonCultivateFactorItemSlotTemplateMap.get(itemId);
        const customLabel = slotTemplateId
          ? factorSlotLabels()[slotTemplateId]
          : undefined;
        const label = customLabel || getSeasonCultivateDisplayLabel(
          itemId,
          rule.name,
          isEnergySource ? "source" : "slot",
        );
        if (!sourceTemplate) {
          const thresholdRow = buildSeasonCultivateThresholdRow(
            itemId,
            rule,
            label,
            factorBuffMap,
            now,
            group.hideZeroCounters === true,
          );
          if (thresholdRow) thresholdRows.push(thresholdRow);
          continue;
        }
        const entry: InlineBuffEntry = {
          id: `season_cultivate_factor_${itemId}`,
          sourceType: "counter",
          sourceId: ruleId,
          counterSlotId: rule.effectSlots[0]?.slotId ?? 1,
          counterDisplayMode: "factor",
          hideWhenZero: group.hideZeroCounters === true,
          label,
          format: "timer",
        };
        const row = getCustomPanelDisplayRow(
          entry,
          now,
          factorBuffMap,
          factorCounterMap(),
          _seasonCultivateFactorRuleMap,
          (baseId) => resolveFactorBuffName(baseId, currentBuffAliases),
          resolveAlert,
        );
        if (row) {
          const slotId = entry.counterSlotId ?? 1;
          const sourceValueText = getSeasonCultivateSourceValueText(
            itemId,
            ruleId,
            slotId,
            now,
          );
          const hasActiveTimerBar = Boolean(row.timerText && row.showProgress);
          sourceRows.push({
            ...row,
            prefixText: getSeasonCultivateProcPrefix(
              itemId,
              ruleId,
              slotId,
              now,
            ),
            valueText: sourceValueText ?? (isEnergySource ? row.valueText : "--"),
            progressPercent: hasActiveTimerBar ? row.progressPercent : 0,
            showProgress: hasActiveTimerBar,
            metaText: undefined,
          });
        }
      }
      const sortedCandidateItemIds = [...seasonCultivateFactorCandidateSlotItemIds()]
        .sort((left, right) =>
          getSeasonCultivateCandidateSortRank(left)
          - getSeasonCultivateCandidateSortRank(right)
          || left - right,
        );
      for (const itemId of sortedCandidateItemIds) {
        if (trustedFactorItemIds.has(itemId)) continue;
        if (
          !autoShowStasisFactors
          && isSeasonCultivateStasisFactor(itemId)
        ) {
          continue;
        }
        const ruleId = getSeasonCultivateFactorRuleId(itemId);
        const rule = _seasonCultivateFactorRuleMap.get(ruleId);
        if (!rule) continue;
        const slotTemplateId =
          _seasonCultivateFactorItemSlotTemplateMap.get(itemId);
        const customLabel = slotTemplateId
          ? factorSlotLabels()[slotTemplateId]
          : undefined;
        const label = customLabel || getSeasonCultivateDisplayLabel(
          itemId,
          rule.name,
          "slot",
        );
        const thresholdRow = buildSeasonCultivateThresholdRow(
          itemId,
          rule,
          label,
          factorBuffMap,
          now,
          group.hideZeroCounters === true,
        );
        if (thresholdRow) {
          thresholdRows.push(thresholdRow);
          continue;
        }
        const linkedBuff = factorBuffMap.get(rule.effectSlots[0]?.resetBuffId ?? -1);
        const active = Boolean(
          linkedBuff
          && linkedBuff.durationMs > 0
          && isBuffActive(linkedBuff, now),
        );
        const procCount = seasonCultivateFactorProcCounts().get(itemId) ?? 0;
        if (!active && procCount <= 0 && !overlayRuntime.isEditing) continue;
        candidateRows.push({
          key: `season_cultivate_factor_candidate_${itemId}`,
          label,
          prefixText: String(procCount),
          valueText: "--",
          timerText: getSeasonCultivateFactorTimerText(
            linkedBuff,
            now,
            typeof rule.effectSlots[0]?.resetBuffId === "number"
              && (rule.effectSlots[0]?.resetBuffId ?? 0) > 0,
          ),
          progressPercent: getBuffRemainPercent(linkedBuff, now),
          showProgress: active && Boolean(linkedBuff && linkedBuff.durationMs > 0),
        });
      }
      nextRows.push(...thresholdRows, ...sourceRows, ...candidateRows);
    } else {
      for (const entry of group.entries) {
        const row = getCustomPanelDisplayRow(
          entry,
          now,
          buffMap(),
          counterMap(),
          _counterRuleMap,
          (baseId) => resolveBuffOverlayDisplayName(baseId, currentBuffAliases),
          resolveAlert,
        );
        if (row) nextRows.push(row);
      }
    }
    nextCustomPanelRowsByGroup.set(group.id, nextRows);
  }

  return {
    activeBuffIds: nextActiveBuffIds,
    buffDurationPercents: nextBuffDurationPercents,
    iconDisplayBuffs: nextIconBuffs,
    textBuffs: nextTextBuffs,
    customPanelRowsByGroup: nextCustomPanelRowsByGroup,
  };
});


const _buffUptimeRows = $derived.by<BuffUptimeDisplayRow[]>(() => {
  const trackedIds = monitoredUptimeBuffIds();
  const currentAliases = buffAliases();
  const uptimeAliases = buffUptimeAliases();
  const uptimeColors = buffUptimeColors();
  const trackingModes = buffUptimeTrackingModes();
  const activeIndicators = buffUptimeActiveIndicators();
  const totals = uptimeTotals();
  const activeKeys = activeUptimeRowKeys();
  const names = nameCache();
  const playerNamesByEntityKey = overlayRuntime.playerNameByEntityKey;
  const monsterIdsByEntityKey = overlayRuntime.monsterIdByEntityKey;
  const live = liveData();
  const encounterMs = Math.max(0, live?.elapsedMs ?? 0);
  const trueMs = Math.max(0, live?.activeCombatTimeMs ?? 0);
  const localPlayerUid = live?.localPlayerUid ?? 0;
  const localPlayerKey =
    live?.localPlayerUuid?.trim() ?? live?.localPlayerKey?.trim() ?? "";
  const rows: BuffUptimeDisplayRow[] = [];

  function sourceIsLocal(total: { sourceKey?: string | null; sourceUid: number }): boolean {
    const sourceKey = total.sourceKey?.trim();
    if (sourceKey && localPlayerKey) return sourceKey === localPlayerKey;
    if (legacyEntityFallbacksDisabled()) return false;
    return total.sourceUid === localPlayerUid;
  }

  function resolveSourceLabel(
    sourceKey: string | null | undefined,
    sourceUid: number,
    sourceConfigId: number | null,
  ): string | undefined {
    const trimmedKey = sourceKey?.trim();
    if (trimmedKey) {
      const playerName = playerNamesByEntityKey.get(trimmedKey)?.trim();
      if (playerName) return playerName;

      const monsterId = monsterIdsByEntityKey.get(trimmedKey);
      if (monsterId !== undefined) {
        return localizeMonsterName(monsterId);
      }
    }
    if (!legacyEntityFallbacksDisabled() && sourceUid > 0) {
      return names.get(sourceUid) || "Unknown";
    }
    if (sourceConfigId !== null) {
      return "Dungeon";
    }
    return "Unknown";
  }

  for (const baseId of trackedIds) {
    const mode = trackingModes[String(baseId)] ?? "self";
    const label = uptimeAliases[String(baseId)]?.trim() || resolveBuffOverlayDisplayName(baseId, currentAliases);
    const color = uptimeColors[String(baseId)] ?? "#ffffff";
    const showIndicator = activeIndicators[String(baseId)] ?? true;

    const matchingEntries = Array.from(totals.entries())
      .filter(([, total]) => total.baseId === baseId && total.trackingMode === mode)
      .sort((left, right) => {
        const leftTotal = left[1];
        const rightTotal = right[1];
        const leftSelf = sourceIsLocal(leftTotal);
        const rightSelf = sourceIsLocal(rightTotal);
        if (leftSelf !== rightSelf) return leftSelf ? -1 : 1;
        const leftSource = resolveSourceLabel(
          leftTotal.sourceKey,
          leftTotal.sourceUid,
          leftTotal.sourceConfigId,
        ) || "";
        const rightSource = resolveSourceLabel(
          rightTotal.sourceKey,
          rightTotal.sourceUid,
          rightTotal.sourceConfigId,
        ) || "";
        return leftSource.localeCompare(rightSource);
      });

    for (const [key, total] of matchingEntries) {
      const encounterPercent = encounterMs > 0
        ? Math.max(0, Math.min(100, (total.encounterActiveMs / encounterMs) * 100))
        : 0;
      const truePercent = trueMs > 0
        ? Math.max(0, Math.min(100, (total.trueActiveMs / trueMs) * 100))
        : null;
      const sourceName = total.trackingMode === "self" || sourceIsLocal(total)
        ? undefined
        : resolveSourceLabel(total.sourceKey, total.sourceUid, total.sourceConfigId);

      rows.push({
        key,
        label,
        encounterPercentText: encounterMs > 0 ? `${Math.round(encounterPercent)}%` : `0%`,
        truePercentText: showTrueUptime() ? (truePercent === null ? `--` : `${Math.round(truePercent)}%`) : undefined,
        sourceText: sourceName ? `fr: ${sourceName}` : undefined,
        color,
        isActive: activeKeys.has(key),
        showActiveIndicator: showIndicator,
      });
    }
  }

  if (rows.length === 0 && overlayRuntime.isEditing) {
    rows.push({
      key: "uptime_placeholder",
      label: "Lifewave",
      encounterPercentText: "60%",
      truePercentText: showTrueUptime() ? "80%" : undefined,
      sourceText: undefined,
      color: "#ffffff",
      isActive: true,
      showActiveIndicator: true,
      isPlaceholder: true,
    });
  }

  return rows;
});

const _skillSnapshot = $derived.by(() => {
  const now = overlayNow();
  const classKey = selectedClassKey();
  const nextDisplayMap = new Map<number, SkillDisplay>();
  const nextSkillDurationDisplays: SkillDurationDisplay[] = [];

  for (const [skillId, cd] of cdMap()) {
    const display = computeDisplay(classKey, skillId, cd, now);
    if (display) {
      nextDisplayMap.set(skillId, display);
    }
  }

  for (const skillId of monitoredSkillDurationIds()) {
    const skill = findAnySkillByBaseId(classKey, skillId);
    if (!skill) continue;
    const durationState = skillDurationMap().get(skillId);
    if (durationState) {
      const remaining = Math.max(
        0,
        durationState.startedAtMs + durationState.durationMs - now,
      );
      if (remaining > 0) {
        nextSkillDurationDisplays.push({
          skillId,
          name: resolveOverlaySkillDisplayName(skillId, skill.name),
          imagePath: skill.imagePath,
          text: formatTimerText(remaining),
        });
        continue;
      }
    }

    if (overlayRuntime.isEditing) {
      nextSkillDurationDisplays.push({
        skillId,
        name: resolveOverlaySkillDisplayName(skillId, skill.name),
        imagePath: skill.imagePath,
        text: "--",
        isPlaceholder: true,
      });
    }
  }

  return {
    displayMap: nextDisplayMap,
    skillDurationDisplays: nextSkillDurationDisplays,
  };
});

const _activeBuffIds = $derived.by(() => _buffSnapshot.activeBuffIds);
const _buffDurationPercents = $derived.by(() => _buffSnapshot.buffDurationPercents);
const _iconDisplayBuffs = $derived.by(() => _buffSnapshot.iconDisplayBuffs);
const _textBuffs = $derived.by(() => _buffSnapshot.textBuffs);
const _customPanelRowsByGroup = $derived.by(
  () => _buffSnapshot.customPanelRowsByGroup,
);
const _buffUptimeDisplayRows = $derived.by(() => _buffUptimeRows);
const _displayMap = $derived.by(() => _skillSnapshot.displayMap);
const _skillDurationDisplays = $derived.by(
  () => _skillSnapshot.skillDurationDisplays,
);

function getGroupSelectedBuffIdSet(group: BuffGroup): Set<number> {
  return new Set(expandBuffSelection(group.buffIds ?? [], group.buffCategories));
}

function getGroupCategoryPlaceholders(
  group: BuffGroup,
  entries: IconBuffDisplay[],
): IconBuffDisplay[] {
  if (!overlayRuntime.isEditing) return [];
  const activeCategoryKeys = new Set(
    entries
      .map((buff) => buff.categoryKey ?? resolveBuffCategoryKey(buff.baseId))
      .filter((key): key is BuffCategoryKey => key !== undefined),
  );
  const placeholders: IconBuffDisplay[] = [];
  for (const categoryKey of normalizeBuffCategoryKeys(group.buffCategories)) {
    if (activeCategoryKeys.has(categoryKey)) continue;
    const representativeId = getBuffIdsByCategory(categoryKey)[0];
    if (representativeId === undefined) continue;
    const definition = buffDefinitions().get(representativeId);
    if (!definition?.spriteFile) continue;
    placeholders.push({
      baseId: representativeId,
      name: buffCategoryLabel(categoryKey),
      spriteFile: definition.spriteFile,
      text: "--",
      layer: 1,
      isPlaceholder: true,
      layoutKey: `group:${group.id}:category:${categoryKey}`,
      categoryKey,
    });
  }
  return placeholders;
}

const _groupedIconBuffs = $derived.by(() => {
  if (buffDisplayMode() !== "grouped") return new Map<string, IconBuffDisplay[]>();
  const groups = _normalizedBuffGroups;
  const iconBuffs = _iconDisplayBuffs.filter(
    (buff) => !(buff.specialImages && buff.specialImages.length > 0),
  );
  const selectedBySpecificGroups = new Set<number>();
  for (const group of groups) {
    if (group.monitorAll) continue;
    for (const buffId of getGroupSelectedBuffIdSet(group)) {
      selectedBySpecificGroups.add(buffId);
    }
  }
  const result = new Map<string, IconBuffDisplay[]>();
  for (const group of groups) {
    const maxVisible = Math.max(1, group.columns * group.rows);
    const groupSelectedIds = getGroupSelectedBuffIdSet(group);
    const entries = group.monitorAll
      ? iconBuffs.filter((buff) => !selectedBySpecificGroups.has(buff.baseId))
      : iconBuffs.filter((buff) => groupSelectedIds.has(buff.baseId));
    result.set(
      group.id,
      [...entries, ...getGroupCategoryPlaceholders(group, entries)].slice(0, maxVisible),
    );
  }
  return result;
});

const _individualModeIconBuffs = $derived.by(() => {
  if (buffDisplayMode() !== "individual") return [];
  const selected = new Set(expandedMonitoredBuffIds());
  const explicitSelectedIds = monitoredBuffIds();
  const explicitSelected = new Set(explicitSelectedIds);
  const selectedCategories = monitoredBuffCategories();
  const visibleBuffs = _iconDisplayBuffs.filter((buff) =>
    selected.has(buff.baseId),
  );

  const explicitBuffs: IconBuffDisplay[] = [];
  for (const selectedBaseId of explicitSelectedIds) {
    const activeBuff = visibleBuffs.find((buff) => buff.baseId === selectedBaseId);
    if (!activeBuff) continue;
    explicitBuffs.push({
      ...activeBuff,
      layoutKey: `individual:selected:${selectedBaseId}`,
    });
  }

  const categoryBuffs: IconBuffDisplay[] = [];
  for (const categoryKey of selectedCategories) {
    const activeCategoryBuff = visibleBuffs.find((buff) =>
      !explicitSelected.has(buff.baseId) &&
      resolveBuffCategoryKey(buff.baseId) === categoryKey
    );
    if (activeCategoryBuff) {
      categoryBuffs.push({
        ...activeCategoryBuff,
        layoutKey: `individual:category:${categoryKey}`,
        categoryKey,
      });
      continue;
    }
    if (!overlayRuntime.isEditing) continue;
    const representativeId = getBuffIdsByCategory(categoryKey)[0];
    if (representativeId === undefined) continue;
    const definition = buffDefinitions().get(representativeId);
    if (!definition?.spriteFile) continue;
    categoryBuffs.push({
      baseId: representativeId,
      name: buffCategoryLabel(categoryKey),
      spriteFile: definition.spriteFile,
      text: "--",
      layer: 1,
      isPlaceholder: true,
      layoutKey: `individual:category:${categoryKey}`,
      categoryKey,
    });
  }
  return [...explicitBuffs, ...categoryBuffs];
});

const _individualAllGroupBuffs = $derived.by(() => {
  if (buffDisplayMode() !== "individual" || !_individualMonitorAllGroup) return [];
  const selected = new Set(expandedMonitoredBuffIds());
  return _iconDisplayBuffs.filter(
    (buff) =>
      !selected.has(buff.baseId) &&
      !(buff.specialImages && buff.specialImages.length > 0),
  );
});

const _specialStandaloneBuffs = $derived.by(() => {
  if (buffDisplayMode() !== "grouped") return [];
  const specials = _iconDisplayBuffs.filter(
    (buff) => buff.specialImages && buff.specialImages.length > 0,
  );
  const groups = _normalizedBuffGroups;
  if (groups.some((group) => group.monitorAll)) return specials;
  const selectedIds = new Set<number>();
  for (const group of groups) {
    for (const buffId of getGroupSelectedBuffIdSet(group)) {
      selectedIds.add(buffId);
    }
  }
  return specials.filter((buff) => selectedIds.has(buff.baseId));
});

const _limitedTextBuffs = $derived.by(() =>
  _textBuffs.slice(0, textBuffMaxVisible()),
);

export function normalizedBuffGroups() {
  return _normalizedBuffGroups;
}

export function individualMonitorAllGroup() {
  return _individualMonitorAllGroup;
}

export function panelAreaRows() {
  return _panelAreaRows;
}

export function activeBuffIds() {
  return _activeBuffIds;
}

export function buffDurationPercents() {
  return _buffDurationPercents;
}

export function displayMap() {
  return _displayMap;
}

export function skillDurationDisplays() {
  return _skillDurationDisplays;
}

export function iconDisplayBuffs() {
  return _iconDisplayBuffs;
}

export function textBuffs() {
  return _textBuffs;
}

export function specialBuffConfigMap() {
  return _specialBuffConfigMap;
}

export function counterRuleMap() {
  return _counterRuleMap;
}

export function groupedIconBuffs() {
  return _groupedIconBuffs;
}

export function individualModeIconBuffs() {
  return _individualModeIconBuffs;
}

export function individualAllGroupBuffs() {
  return _individualAllGroupBuffs;
}

export function specialStandaloneBuffs() {
  return _specialStandaloneBuffs;
}

export function limitedTextBuffs() {
  return _limitedTextBuffs;
}

export function customPanelRowsByGroup() {
  return _customPanelRowsByGroup;
}

export function getResourceValue(index: number): number {
  return getResourceValueValue(
    overlayRuntime.fightResMap,
    selectedClassKey(),
    index,
  );
}

export function getResourcePreciseValue(index: number): number {
  return getResourcePreciseValueValue(
    overlayRuntime.fightResMap,
    selectedClassKey(),
    index,
  );
}

function getBuffPrioritySorter(priorityIds: number[]) {
  if (priorityIds.length === 0) {
    return (baseId: number) => [Number.MAX_SAFE_INTEGER, baseId] as const;
  }

  const priorityIndex = new Map(priorityIds.map((id, idx) => [id, idx]));
  return (baseId: number) =>
    [priorityIndex.get(baseId) ?? priorityIds.length, baseId] as const;
}

function getTextBuffBaseId(row: TextBuffDisplay): number {
  const match = /^buff_(\d+)$/.exec(row.key);
  const baseId = match?.[1];
  return baseId ? Number.parseInt(baseId, 10) : Number.MAX_SAFE_INTEGER;
}


export function buffUptimeDisplayRows() {
  return _buffUptimeDisplayRows;
}
