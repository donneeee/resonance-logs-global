import type {
  BuffUpdateState,
  CounterSlotState,
  CounterUpdateState,
  SkillCdSourceState,
  SkillCdState,
} from "$lib/api";
import skillTagLabelsData from "$parserData/generated/SkillTagLabels.json";
export {
  ensureCustomPanelEntries,
  ensureCustomPanelGroups,
  ensureInlineBuffEntries,
} from "$lib/custom-panel-utils";
export {
  DEFAULT_OVERLAY_SIZES,
  ensureBuffGroup,
  ensureBuffGroups,
  ensureCustomPanelStyle,
  ensureIndividualMonitorAllGroup,
  ensureOverlaySizes,
  ensurePanelAreaRowOrder,
  ensurePanelAttrs,
  ensureShieldDetailStyle,
  ensureTextBuffPanelStyle,
} from "$lib/skill-monitor-normalize";
import { ensurePanelAreaRowOrder } from "$lib/skill-monitor-normalize";
import { SETTINGS } from "$lib/settings-store";
import type {
  BuffAlertRule,
  InlineBuffEntry,
  OverlayPositions,
  OverlayVisibility,
  PanelAttrConfig,
  SkillMonitorProfile,
} from "$lib/settings-store";
import {
  findAnySkillByBaseId,
  type CounterRulePreset,
} from "$lib/skill-mappings";
import {
  DEFAULT_OVERLAY_POSITIONS,
  DEFAULT_OVERLAY_VISIBILITY,
  DEFAULT_RESOURCE_VALUES_BY_CLASS,
  RESOURCE_SCALES_BY_CLASS,
} from "./overlay-constants";
import type {
  BuffAlertState,
  CustomPanelDisplayRow,
  PanelAreaDisplayRow,
  SkillDisplay,
  TextBuffDisplay,
} from "./overlay-types";

type BuffAlertResolver = (
  baseId: number,
  remainingMs: number,
  durationMs: number,
) => BuffAlertState | undefined;

export function ensureOverlayPositions(
  profile: SkillMonitorProfile,
): OverlayPositions {
  const current = profile.overlayPositions;
  return {
    skillCdGroup:
      current?.skillCdGroup ?? DEFAULT_OVERLAY_POSITIONS.skillCdGroup,
    resourceGroup:
      current?.resourceGroup ?? DEFAULT_OVERLAY_POSITIONS.resourceGroup,
    textBuffPanel:
      current?.textBuffPanel ?? DEFAULT_OVERLAY_POSITIONS.textBuffPanel,
    specialBuffGroup:
      current?.specialBuffGroup ?? DEFAULT_OVERLAY_POSITIONS.specialBuffGroup,
    panelAttrGroup:
      current?.panelAttrGroup ?? DEFAULT_OVERLAY_POSITIONS.panelAttrGroup,
    buffUptimeGroup:
      current?.buffUptimeGroup ?? DEFAULT_OVERLAY_POSITIONS.buffUptimeGroup,
    customPanelGroup:
      current?.customPanelGroup ?? DEFAULT_OVERLAY_POSITIONS.customPanelGroup,
    shieldDetailGroup:
      current?.shieldDetailGroup ?? DEFAULT_OVERLAY_POSITIONS.shieldDetailGroup,
    iconBuffPositions: current?.iconBuffPositions ?? {},
    standaloneIconPositions: current?.standaloneIconPositions ?? {},
    skillDurationPositions: current?.skillDurationPositions ?? {},
    categoryIconPositions: current?.categoryIconPositions ?? {},
  };
}

export function ensureOverlayVisibility(
  profile: SkillMonitorProfile,
): OverlayVisibility {
  const current = profile.overlayVisibility;
  return {
    showSkillCdGroup:
      current?.showSkillCdGroup ??
      DEFAULT_OVERLAY_VISIBILITY.showSkillCdGroup,
    showSkillDurationGroup:
      current?.showSkillDurationGroup ??
      DEFAULT_OVERLAY_VISIBILITY.showSkillDurationGroup,
    showResourceGroup:
      current?.showResourceGroup ??
      DEFAULT_OVERLAY_VISIBILITY.showResourceGroup,
    showPanelAttrGroup:
      current?.showPanelAttrGroup ??
      DEFAULT_OVERLAY_VISIBILITY.showPanelAttrGroup,
    showBuffUptimeGroup:
      current?.showBuffUptimeGroup ??
      DEFAULT_OVERLAY_VISIBILITY.showBuffUptimeGroup,
    showCustomPanelGroup:
      current?.showCustomPanelGroup ??
      DEFAULT_OVERLAY_VISIBILITY.showCustomPanelGroup,
    showShieldDetailGroup:
      current?.showShieldDetailGroup ??
      DEFAULT_OVERLAY_VISIBILITY.showShieldDetailGroup,
  };
}

export function formatAttrValue(
  value: number,
  format: PanelAttrConfig["format"],
): string {
  if (format === "integer") {
    return value.toLocaleString();
  }
  return `${(value / 100).toFixed(2)}%`;
}

export function getBuffRemainingMs(
  buff: BuffUpdateState | undefined,
  now: number,
): number {
  if (!buff) return 0;
  if (buff.durationMs <= 0) return Number.POSITIVE_INFINITY;
  const end = buff.createTimeMs + buff.durationMs;
  return Math.max(0, end - now);
}

export function isBuffActive(
  buff: BuffUpdateState | undefined,
  now: number,
): boolean {
  if (!buff) return false;
  if (buff.durationMs <= 0) return true;
  return buff.createTimeMs + buff.durationMs > now;
}

export function formatTimerText(remainingMs: number): string {
  if (!Number.isFinite(remainingMs)) return "∞";
  if (remainingMs <= 0) return "--";
  if (remainingMs <= 60_000) {
    return `${formatTenthsDown(remainingMs / 1000)}s`;
  }
  if (remainingMs <= 3_600_000) {
    return `${formatTenthsDown(remainingMs / 60_000)}m`;
  }
  return `${formatTenthsDown(remainingMs / 3_600_000)}h`;
}

export function getBuffRemainPercent(
  buff: BuffUpdateState | undefined,
  now: number,
): number {
  if (!buff || buff.durationMs <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, (getBuffRemainingMs(buff, now) / buff.durationMs) * 100),
  );
}

export function resolveAlertState(
  rule: BuffAlertRule | undefined,
  remainingMs: number,
  durationMs: number,
): BuffAlertState | undefined {
  if (!rule || durationMs <= 0) return undefined;
  if (remainingMs > rule.thresholdSeconds * 1000) return undefined;
  return {
    highlightColor: rule.highlightColor,
    flash: rule.flash,
    flashIntervalMs: rule.flashIntervalMs ?? 600,
    applyToProgress: rule.applyToProgress ?? true,
  };
}

export function buildBuffTextRow(
  key: string,
  label: string,
  buff: BuffUpdateState,
  now: number,
  isPlaceholder = false,
  allowPassiveSingleStack = false,
  alertResolver?: BuffAlertResolver,
): TextBuffDisplay | null {
  const active = isBuffActive(buff, now);
  if (!active && !isPlaceholder) return null;

  if (
    buff.durationMs <= 0 &&
    buff.layer <= 1 &&
    !isPlaceholder &&
    !allowPassiveSingleStack
  ) {
    return null;
  }

  const remainingMs = getBuffRemainingMs(buff, now);
  const layer = Math.max(1, buff.layer);
  const alert = isPlaceholder
    ? undefined
    : alertResolver?.(buff.baseId, remainingMs, buff.durationMs);

  return {
    key,
    label,
    valueText: isPlaceholder ? "--" : formatTimerText(remainingMs),
    metaText: layer > 1 ? `x${layer}` : undefined,
    progressPercent: isPlaceholder ? 0 : getBuffRemainPercent(buff, now),
    showProgress: !isPlaceholder && buff.durationMs > 0,
    ...(isPlaceholder ? { isPlaceholder: true } : {}),
    ...(alert ? { alert } : {}),
  };
}

function formatCounterCountText(
  slotState: CounterSlotState,
  slotConfig?: CounterRulePreset["effectSlots"][number],
): string {
  const threshold = resolveCounterThreshold(slotState);
  const countText = `${Math.max(0, slotState.currentCount)}`;
  const slotWithDisplay = slotConfig as
    | (CounterRulePreset["effectSlots"][number] & { displayMode?: string })
    | undefined;
  if (
    slotWithDisplay?.displayMode === "percentOfThreshold" &&
    threshold !== null &&
    threshold > 0
  ) {
    const ratio = Math.min(1, Math.max(0, slotState.currentCount / threshold));
    const percent = Math.round(ratio * 1000) / 10;
    return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
  }
  if (
    slotWithDisplay?.displayMode === "remainingToThreshold" &&
    threshold !== null
  ) {
    return `${Math.max(0, threshold - slotState.currentCount)}`;
  }
  if (threshold !== null && threshold > 0) {
    return `${countText}/${threshold}`;
  }
  return countText;
}

function resolveCounterThreshold(
  slotState: CounterSlotState,
): number | null {
  const slotWithEffective = slotState as CounterSlotState & {
    effectiveThreshold?: number | null;
  };
  return slotWithEffective.effectiveThreshold ?? slotState.threshold ?? null;
}

function getCounterThresholdProgressPercent(
  slotState: CounterSlotState,
): number {
  const threshold = resolveCounterThreshold(slotState);
  if (threshold === null || threshold <= 0) return 0;
  return Math.max(0, Math.min(100, (slotState.currentCount / threshold) * 100));
}

function getLinkedBuffProgress(
  linkedBuff: BuffUpdateState | undefined,
  now: number,
): { active: boolean; progressPercent: number; showProgress: boolean } {
  const active = isBuffActive(linkedBuff, now);
  return {
    active,
    progressPercent: getBuffRemainPercent(linkedBuff, now),
    showProgress: active && Boolean(linkedBuff && linkedBuff.durationMs > 0),
  };
}

function getLinkedTimerText(
  linkedBuff: BuffUpdateState | undefined,
  now: number,
  showInactive = false,
): string | undefined {
  if (!linkedBuff) return showInactive ? "--" : undefined;
  if (linkedBuff.durationMs <= 0) return showInactive ? "--" : undefined;
  if (!isBuffActive(linkedBuff, now)) return showInactive ? "--" : undefined;
  const remainingMs = getBuffRemainingMs(linkedBuff, now);
  return remainingMs > 0 ? formatTimerText(remainingMs) : showInactive ? "--" : undefined;
}

export function getCustomPanelDisplayRow(
  entry: InlineBuffEntry,
  now: number,
  buffMap: Map<number, BuffUpdateState>,
  counterMap: Map<number, CounterUpdateState>,
  counterRuleMap: Map<number, CounterRulePreset>,
  resolveBuffName: (baseId: number) => string,
  alertResolver?: BuffAlertResolver,
): CustomPanelDisplayRow | null {
  if (entry.sourceType === "buff") {
    const buff = buffMap.get(entry.sourceId);
    if (!buff) return null;
    return buildBuffTextRow(
      `inline_buff_${entry.id}`,
      resolveBuffName(entry.sourceId),
      buff,
      now,
      false,
      true,
      alertResolver,
    );
  }

  const counter = counterMap.get(entry.sourceId);
  const rule = counterRuleMap.get(entry.sourceId);
  const selectedSlotId = entry.counterSlotId
    ?? counter?.slots[0]?.slotId
    ?? rule?.effectSlots[0]?.slotId;
  const selectedSlot = counter?.slots.find((slot) => slot.slotId === selectedSlotId)
    ?? counter?.slots[0];
  const slotConfig = rule?.effectSlots.find((slot) => slot.slotId === selectedSlotId)
    ?? rule?.effectSlots[0];
  const linkedBuff = buffMap.get(slotConfig?.resetBuffId ?? -1);
  const factorDisplay = entry.counterDisplayMode === "factor";
  if (!counter || !selectedSlot) {
    if (entry.hideWhenZero === true) return null;
    return {
      key: `counter_${entry.id}`,
      label: entry.label,
      valueText: "--",
      progressPercent: 0,
      showProgress: false,
    };
  }
  if (selectedSlot.isCounting) {
    if (entry.hideWhenZero === true && selectedSlot.currentCount === 0) {
      return null;
    }
    const linkedProgress = getLinkedBuffProgress(linkedBuff, now);
    const thresholdProgressPercent = getCounterThresholdProgressPercent(
      selectedSlot,
    );
    return {
      key: `inline_counter_${entry.id}`,
      label: entry.label,
      valueText: formatCounterCountText(selectedSlot, slotConfig),
      metaText: undefined,
      timerText: factorDisplay
        ? getLinkedTimerText(linkedBuff, now, false)
        : undefined,
      progressPercent: factorDisplay && linkedProgress.showProgress
        ? linkedProgress.progressPercent
        : thresholdProgressPercent,
      showProgress: factorDisplay
        ? linkedProgress.showProgress || thresholdProgressPercent > 0
        : false,
    };
  }
  const fixedFreezeUntilMs = selectedSlot.freezeUntilMs;
  if (
    fixedFreezeUntilMs !== null &&
    fixedFreezeUntilMs !== undefined &&
    fixedFreezeUntilMs > now
  ) {
    const fixedRemainingMs = Math.max(0, fixedFreezeUntilMs - now);
    const slotWithEffective = selectedSlot as typeof selectedSlot & {
      effectiveFreezeDurationMs?: number | null;
    };
    const freezeDurationMs =
      slotWithEffective.effectiveFreezeDurationMs ??
      selectedSlot.freezeDurationMs ??
      0;
    const progressPercent =
      freezeDurationMs > 0
        ? Math.max(0, Math.min(100, (fixedRemainingMs / freezeDurationMs) * 100))
        : 0;
    if (factorDisplay) {
      return {
        key: `inline_counter_${entry.id}`,
        label: entry.label,
        valueText: formatCounterCountText(selectedSlot, slotConfig),
        metaText: undefined,
        timerText: fixedRemainingMs > 0 ? formatTimerText(fixedRemainingMs) : "--",
        progressPercent,
        showProgress: freezeDurationMs > 0,
      };
    }
    return {
      key: `inline_counter_${entry.id}`,
      label: entry.label,
      valueText: fixedRemainingMs > 0 ? formatTimerText(fixedRemainingMs) : "--",
      metaText: "On Cooldown",
      progressPercent,
      showProgress: freezeDurationMs > 0,
    };
  }
  const active = selectedSlot.resetBuffActive ?? isBuffActive(linkedBuff, now);
  const remainingMs = getBuffRemainingMs(linkedBuff, now);
  if (entry.hideWhenZero === true && !active) return null;
  if (factorDisplay) {
    return {
      key: `inline_counter_${entry.id}`,
      label: entry.label,
      valueText: formatCounterCountText(selectedSlot, slotConfig),
      metaText: undefined,
      timerText: getLinkedTimerText(linkedBuff, now, false),
      progressPercent: getBuffRemainPercent(linkedBuff, now),
      showProgress: active && Boolean(linkedBuff && linkedBuff.durationMs > 0),
    };
  }
  return {
    key: `inline_counter_${entry.id}`,
    label: entry.label,
    valueText: active ? formatTimerText(remainingMs) : "--",
    metaText: active ? "On Cooldown" : "On Cooldown",
    progressPercent: getBuffRemainPercent(linkedBuff, now),
    showProgress: active && Boolean(linkedBuff && linkedBuff.durationMs > 0),
  };
}

export function buildPanelAreaRows(
  activeProfile: SkillMonitorProfile | null,
  enabledPanelAttrs: PanelAttrConfig[],
): PanelAreaDisplayRow[] {
  if (!activeProfile) return [];
  const rows = ensurePanelAreaRowOrder(activeProfile, enabledPanelAttrs);
  const result: PanelAreaDisplayRow[] = [];
  for (const row of rows) {
    const attr = enabledPanelAttrs.find((item) => item.attrId === row.attrId);
    if (attr) {
      result.push({ key: `attr_${attr.attrId}`, attr });
    }
  }
  for (const attr of enabledPanelAttrs) {
    if (!result.some((row) => row.attr.attrId === attr.attrId)) {
      result.push({ key: `attr_${attr.attrId}`, attr });
    }
  }
  return result;
}

export function computeDisplay(
  selectedClassKey: string,
  skillId: number,
  cd: SkillCdState,
  now: number,
): SkillDisplay | null {
  const skill = findAnySkillByBaseId(selectedClassKey, skillId);
  const cdAccelerateRate = Math.max(0, cd.cdAccelerateRate ?? 0);
  const observedProgressRate = Math.max(0, cd.observedProgressRate ?? 0);
  const elapsed = Math.max(0, now - cd.receivedAt);
  const packetDuration = cd.duration > 0 ? Math.max(1, cd.duration) : 0;
  const calculatedDuration = cd.calculatedDuration > 0
    ? Math.max(1, cd.calculatedDuration)
    : 0;
  const usesCalculatedDuration =
    calculatedDuration > 0 &&
    packetDuration <= 0;
  const effectiveDuration = usesCalculatedDuration
    ? calculatedDuration
    : packetDuration || calculatedDuration;
  const serverProgress = Math.max(0, cd.validCdTime ?? 0);
  const formulaProgressRate = Math.max(1, 1 + cdAccelerateRate);
  const progressRate = formulaProgressRate;
  const progressed = serverProgress + elapsed * progressRate;
  const targetEndAt =
    effectiveDuration > 0
      ? cd.receivedAt + Math.max(0, effectiveDuration - serverProgress) / progressRate
      : 0;
  const accelerationText = formatCooldownAcceleration(cdAccelerateRate);
  const observedRateText =
    observedProgressRate > 0 ? `${observedProgressRate.toFixed(2)}x` : "--";
  const sourceLines = formatCooldownSourceLines(cd);
  const debugTitle = [
    `CD accel: ${accelerationText}`,
    `display rate: ${progressRate.toFixed(2)}x`,
    `observed rate: ${observedRateText}`,
    `packet: ${formatCooldownDebugMs(packetDuration)}`,
    `calculated: ${formatCooldownDebugMs(calculatedDuration)}`,
    `progress: ${formatCooldownDebugMs(serverProgress)}`,
    `elapsed: ${formatCooldownDebugMs(elapsed)}`,
    `display progress: ${formatCooldownDebugMs(progressed)}`,
    `target end: ${targetEndAt > 0 ? formatCooldownDebugMs(Math.max(0, targetEndAt - now)) : "--"}`,
    `packet ratios: sub=${cd.packetSubCdRatio ?? 0} fixed=${cd.packetSubCdFixed ?? 0} accel=${cd.packetAccelerateCdRatio ?? 0}`,
    `source: ${usesCalculatedDuration ? "calculated duration" : packetDuration ? "packet duration" : calculatedDuration ? "calculated fallback" : "none"}`,
    ...sourceLines,
  ].join(" | ");
  const debugFields = { accelerationText, debugTitle };

  if (cd.duration === -1 && cd.skillCdType === 1) {
    if (!skill?.maxValidCdTime) return null;
    const chargePercent = Math.max(
      0,
      Math.min(1, cd.validCdTime / skill.maxValidCdTime),
    );
    return {
      isActive: chargePercent < 1,
      percent: 1 - chargePercent,
      text: `${Math.round(chargePercent * 100)}%`,
      usable: chargePercent >= 1,
      ...debugFields,
    };
  }

  if (cd.skillCdType === 1 && cd.duration > 0) {
    const maxCharges = Math.max(1, skill?.maxCharges ?? 1);
    if (maxCharges > 1 && effectiveDuration > 0) {
      const chargeDuration = effectiveDuration;
      const maxVct = maxCharges * chargeDuration;
      const currentVct = Math.min(maxVct, progressed);
      const chargesAvailable = Math.min(
        maxCharges,
        Math.floor(currentVct / chargeDuration),
      );
      const chargesOnCd = Math.max(0, maxCharges - chargesAvailable);
      if (chargesOnCd <= 0) {
        return {
          isActive: false,
          percent: 0,
          text: "",
          chargesText: `${maxCharges}/${maxCharges}`,
          usable: true,
          chargesAvailable: maxCharges,
          maxCharges,
          ...debugFields,
        };
      }
      const timeToNextCharge = Math.max(
        0,
        chargeDuration - (currentVct % chargeDuration),
      );
      return {
        isActive: chargesOnCd > 0,
        percent: Math.min(1, timeToNextCharge / chargeDuration),
        text: formatTenthsDown(timeToNextCharge / 1000),
        chargesText: `${chargesAvailable}/${maxCharges}`,
        usable: chargesAvailable >= 1,
        chargesAvailable,
        maxCharges,
        ...debugFields,
      };
    }
  }

  const remaining =
    effectiveDuration > 0 ? Math.max(0, effectiveDuration - progressed) : 0;
  const duration = effectiveDuration > 0 ? effectiveDuration : 1;
  return {
    isActive: remaining > 0,
    percent: remaining > 0 ? Math.min(1, remaining / duration) : 0,
    text: remaining > 0 ? formatTenthsDown(remaining / 1000) : "",
    usable: remaining <= 0,
    ...debugFields,
  };
}

export function getResourceValue(
  fightResMap: Map<number, number>,
  selectedClassKey: string,
  resourceId: number,
): number {
  const raw = fightResMap.get(resourceId);
  if (raw === undefined) {
    return DEFAULT_RESOURCE_VALUES_BY_CLASS[selectedClassKey]?.[resourceId] ?? 0;
  }
  const scale = RESOURCE_SCALES_BY_CLASS[selectedClassKey]?.[resourceId] ?? 1;
  return Math.floor(raw / scale);
}

export function getResourcePreciseValue(
  fightResMap: Map<number, number>,
  selectedClassKey: string,
  resourceId: number,
): number {
  const raw = fightResMap.get(resourceId);
  if (raw === undefined) {
    return DEFAULT_RESOURCE_VALUES_BY_CLASS[selectedClassKey]?.[resourceId] ?? 0;
  }
  const scale = RESOURCE_SCALES_BY_CLASS[selectedClassKey]?.[resourceId] ?? 1;
  return raw / scale;
}

function formatTenthsDown(value: number): string {
  return (Math.floor(Math.max(0, value) * 10) / 10).toFixed(1);
}

function formatCooldownDebugMs(value: number): string {
  return value > 0 ? `${(value / 1000).toFixed(2)}s` : "--";
}

function formatCooldownAcceleration(rate: number): string {
  const percent = rate * 100;
  const digits = Math.abs(percent) >= 10 || percent === 0 ? 0 : 1;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(digits)}%`;
}

type SkillTagLabelEntry = {
  Name?: string;
  Names?: Record<string, string>;
};

const skillTagLabels = (
  skillTagLabelsData as { labels?: Record<string, SkillTagLabelEntry> }
).labels ?? {};

function resolveSkillTagLabel(tagId: number): string {
  const entry = skillTagLabels[String(tagId)];
  const locale = SETTINGS.live.general.state.language;
  return entry?.Names?.[locale] ?? entry?.Names?.["en"] ?? entry?.Name ?? String(tagId);
}

function formatSkillTagList(tagIds: number[] | undefined): string {
  const ids = (tagIds ?? []).slice(0, 8);
  if (!ids.length) return "";
  return ids.map((tagId) => `${resolveSkillTagLabel(tagId)} (${tagId})`).join(", ");
}

function formatCooldownSourceLines(cd: SkillCdState): string[] {
  const sources = cd.cdSources ?? [];
  if (sources.length === 0) return ["sources: none"];
  const lines = sources.slice(0, 8).map((source) => {
  if (source.sourceKind === "professionTalentSnapshot") {
    const nodes = source.attrParams?.length ? source.attrParams.join(", ") : "none";
    return `active talents: ${nodes}`;
  }
  if (source.sourceKind === "gearSet") {
    return formatCooldownGearSetSource(source);
  }
  if (source.contributionKind === "activeBuffStack") {
    const stacks = source.attrParams?.[1] ?? source.value ?? 0;
    return `${source.sourceKind}: active stack x${Math.max(0, Math.round(stacks))}`;
  }
  if (source.contributionKind === "activeDuration") {
    const duration = source.attrParams?.[2] ?? 0;
    return `${source.sourceKind}: active ${formatCooldownDebugMs(duration)}`;
  }
  if (source.contributionKind === "durationExtend") {
    return `${source.sourceKind}: active duration +${formatCooldownDebugMs(source.contribution)}`;
  }
  if (source.contributionKind === "focusHasteCdBoostEvidence") {
    return `${source.sourceKind}: Focus haste CD boost evidence, haste raw ${formatCooldownRaw(source.contribution)}`;
  }
  if (source.contributionKind === "hasteEvidence") {
    return `haste attr: raw ${formatCooldownRaw(source.value)}`;
  }
  if (source.contributionKind === "finalStatEvidence") {
    return `${formatCooldownFinalStatLabel(source.attrType)}: ${formatCooldownPanelPercent(source.value)}`;
  }
  if (source.contributionKind === "accelerateCandidate") {
    return `${source.sourceKind}: ${formatCooldownAcceleration(source.contribution)} accel candidate`;
  }
  const id = source.tempAttrId
    ? `tempAttr ${source.tempAttrId}`
    : source.sourceKey || source.sourceKind;
    const scope = source.scope ? ` ${source.scope}` : "";
    const logic = source.logicType !== null && source.logicType !== undefined
      ? ` logic ${source.logicType}`
      : "";
    const params = source.attrParams?.length
      ? source.logicType === 3
        ? ` params ${formatSkillTagList(source.attrParams.slice(0, 6))}`
        : ` params ${source.attrParams.slice(0, 6).join(",")}`
      : "";
    const tags = source.skillTags?.length
      ? ` tags ${formatSkillTagList(source.skillTags)}`
      : "";
    return `source ${id}${scope}${logic}: ${formatCooldownSourceContribution(source.contributionKind, source.contribution)}${params}${tags}`;
  });
  if (sources.length > lines.length) {
    lines.push(`sources: +${sources.length - lines.length} more`);
  }
  return lines;
}

function formatCooldownGearSetSource(source: SkillCdSourceState): string {
  const params = source.attrParams ?? [];
  const suitId = params[0] ?? source.attrType;
  const attrType = params[1];
  const attrPairs: string[] = [];
  for (let index = 2; index + 1 < params.length; index += 2) {
    attrPairs.push(`${params[index]}=${params[index + 1]}`);
  }
  const attrs = attrPairs.length ? ` attrs ${attrPairs.join(", ")}` : " attrs none";
  const typeText = attrType === undefined || attrType < 0 ? "" : ` type ${attrType}`;
  return `gear set ${suitId}${typeText}:${attrs}`;
}

function formatCooldownSourceContribution(kind: string, contribution: number): string {
  if (kind === "flatReduceMs") {
    return `-${formatCooldownDebugMs(Math.abs(contribution))}`;
  }
  if (kind === "pctReduce") {
    return `-${formatCooldownPercent(Math.abs(contribution))} cd`;
  }
  if (kind === "accelerate") {
    return `${formatCooldownAcceleration(contribution)} accel`;
  }
  if (kind === "noCdReduction") {
    return "no cooldown reduction";
  }
  if (kind === "evidence") {
    return "observed";
  }
  if (kind === "activeBuffStack") {
    return `stack x${Math.max(0, Math.round(contribution))}`;
  }
  if (kind === "activeDuration") {
    return "active";
  }
  if (kind === "durationExtend") {
    return `+${formatCooldownDebugMs(contribution)} active duration`;
  }
  if (kind === "focusHasteCdBoostEvidence" || kind === "hasteEvidence") {
    return `raw ${formatCooldownRaw(contribution)}`;
  }
  if (kind === "finalStatEvidence") {
    return "final stat";
  }
  if (kind === "accelerateCandidate") {
    return `${formatCooldownAcceleration(contribution)} accel candidate`;
  }
  return contribution.toString();
}

function formatCooldownFinalStatLabel(attrId: number): string {
  if (attrId === 11930) return "final Haste";
  if (attrId === 11710) return "final Crit";
  if (attrId === 11780) return "final Lucky";
  if (attrId === 11940) return "final Mastery";
  if (attrId === 11950) return "final Versatility";
  if (attrId === 12510) return "final Crit Damage";
  return "final stat";
}

function formatCooldownPanelPercent(value: number): string {
  if (!Number.isFinite(value)) return "0.00%";
  return `${(value / 100).toFixed(2)}%`;
}

function formatCooldownRaw(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toString();
}

function formatCooldownPercent(rate: number): string {
  const percent = rate * 100;
  const digits = Math.abs(percent) >= 10 || percent === 0 ? 0 : 1;
  return `${percent.toFixed(digits)}%`;
}
