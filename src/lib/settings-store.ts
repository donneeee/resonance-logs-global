/**
 * @file This file contains the settings store for the application.
 * It uses `@tauri-store/svelte` to create persistent stores for user settings.
 */
import { RuneStore } from "@tauri-store/svelte";
import type { BuffCategoryKey } from "./config/buff-name-table";
import type { LocaleCode, SkillIdDisplayMode } from "./i18n";
import {
  cloneHeaderCustomLayout,
  type HeaderCustomLayout,
  type HeaderLayoutMode,
} from "./live-header-layout";

export const DEFAULT_STATS = {
  totalDmg: true,
  dps: true,
  effectiveTotal: true,
  effectiveDps: true,
  tdps: false,
  bossDmg: true,
  bossDps: true,
  dmgPct: true,
  critRate: true,
  critDmgRate: true,
  luckyRate: false,
  luckyDmgRate: false,
  blockRate: false,
  luckyBlockRate: false,
  hits: false,
  hitsPerMinute: false,
  property: true,
  damageMode: true,
};

export const DEFAULT_HISTORY_STATS = {
  totalDmg: true,
  dps: true,
  effectiveTotal: true,
  effectiveDps: true,
  tdps: false,
  bossDmg: true,
  bossDps: true,
  dmgPct: true,
  critRate: false,
  critDmgRate: false,
  luckyRate: false,
  luckyDmgRate: false,
  blockRate: false,
  luckyBlockRate: false,
  hits: false,
  hitsPerMinute: false,
  property: true,
  damageMode: true,
};

export const DEFAULT_HISTORY_DPS_SKILL_STATS = {
  ...DEFAULT_HISTORY_STATS,
  hits: true,
};

export const DEFAULT_HISTORY_TANKED_STATS = {
  damageTaken: true,
  tankedPS: true,
  tankedPct: true,
  critTakenRate: false,
  critDmgRate: false,
  luckyRate: false,
  luckyDmgRate: false,
  blockRate: false,
  luckyBlockRate: false,
  hitsTaken: false,
  hitsPerMinute: false,
};

export const DEFAULT_HISTORY_HEAL_STATS = {
  healDealt: true,
  hps: true,
  effectiveHeal: true,
  ehps: true,
  healPct: true,
  critHealRate: false,
  critDmgRate: false,
  luckyRate: false,
  luckyDmgRate: false,
  hitsHeal: false,
  hitsPerMinute: false,
};

// Default column order for live tables (keys from column-data.ts)
export const DEFAULT_DPS_PLAYER_COLUMN_ORDER = ['totalDmg', 'dps', 'tdps', 'bossDmg', 'bossDps', 'dmgPct', 'critRate', 'critDmgRate', 'luckyRate', 'luckyDmgRate', 'hits', 'hitsPerMinute'];
export const DEFAULT_DPS_SKILL_COLUMN_ORDER = ['totalDmg', 'dps', 'dmgPct', 'critRate', 'critDmgRate', 'luckyRate', 'luckyDmgRate', 'hits', 'hitsPerMinute'];
export const DEFAULT_HEAL_PLAYER_COLUMN_ORDER = ['totalDmg', 'dps', 'effectiveTotal', 'effectiveDps', 'dmgPct', 'critRate', 'critDmgRate', 'luckyRate', 'luckyDmgRate', 'hits', 'hitsPerMinute'];
export const DEFAULT_HEAL_SKILL_COLUMN_ORDER = ['totalDmg', 'dps', 'effectiveTotal', 'effectiveDps', 'dmgPct', 'critRate', 'critDmgRate', 'luckyRate', 'luckyDmgRate', 'hits', 'hitsPerMinute'];
export const DEFAULT_TANKED_PLAYER_COLUMN_ORDER = ['totalDmg', 'dps', 'dmgPct', 'critRate', 'critDmgRate', 'luckyRate', 'luckyDmgRate', 'blockRate', 'luckyBlockRate', 'hits', 'hitsPerMinute'];
export const DEFAULT_TANKED_SKILL_COLUMN_ORDER = ['totalDmg', 'dps', 'dmgPct', 'critRate', 'critDmgRate', 'luckyRate', 'luckyDmgRate', 'blockRate', 'luckyBlockRate', 'hits', 'hitsPerMinute', 'property', 'damageMode'];

// Default sort settings for live tables
export const DEFAULT_LIVE_SORT_SETTINGS = {
  dpsPlayers: { sortKey: "totalDmg", sortDesc: true },
  dpsSkills: { sortKey: "totalDmg", sortDesc: true },
  healPlayers: { sortKey: "totalDmg", sortDesc: true },
  healSkills: { sortKey: "totalDmg", sortDesc: true },
  tankedPlayers: { sortKey: "totalDmg", sortDesc: true },
  tankedSkills: { sortKey: "totalDmg", sortDesc: true },
};

type MutableRecord = Record<string, unknown>;

function isMutableRecord(value: unknown): value is MutableRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneSettingValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneSettingValue(item)) as T;
  }
  if (isMutableRecord(value)) {
    const next: MutableRecord = {};
    for (const [key, item] of Object.entries(value)) {
      next[key] = cloneSettingValue(item);
    }
    return next as T;
  }
  return value;
}

function mergeDeepDefaults<T extends MutableRecord>(
  target: T,
  defaults: Record<string, unknown>,
): void {
  const mutableTarget = target as MutableRecord;
  for (const [key, value] of Object.entries(defaults)) {
    const current = mutableTarget[key];
    if (current === undefined) {
      mutableTarget[key] = cloneSettingValue(value);
      continue;
    }
    if (isMutableRecord(current) && isMutableRecord(value)) {
      mergeDeepDefaults(current, value);
    }
  }
}

function normalizeObjectWithDefaults<T extends MutableRecord>(
  value: unknown,
  defaults: T,
): T {
  const next = isMutableRecord(value)
    ? (cloneSettingValue(value) as MutableRecord)
    : {};
  mergeDeepDefaults(next, defaults);
  return next as T;
}

function normalizeColumnOrder(
  target: { order?: string[] },
  defaults: readonly string[],
): void {
  const current = Array.isArray(target.order) ? target.order : [];
  const defaultSet = new Set(defaults);
  const deduped = current.filter(
    (key, index) => defaultSet.has(key) && current.indexOf(key) === index,
  );

  for (const key of defaults) {
    if (!deduped.includes(key)) deduped.push(key);
  }

  target.order = deduped;
}

function normalizeColumnOrderSettingsState(
  defaults: readonly string[],
): SettingsStoreNormalizer<{ order: string[] }> {
  return (value: unknown) => {
    const next = normalizeObjectWithDefaults(value, {
      order: [...defaults],
    }) as { order: string[] };
    normalizeColumnOrder(next, defaults);
    return next;
  };
}

export type ShortcutSettingId = keyof typeof DEFAULT_SETTINGS.shortcuts;

export type Point = {
  x: number;
  y: number;
};

export type PanelAttrConfig = {
  attrId: number;
  label: string;
  labelKey?: string;
  color: string;
  enabled: boolean;
  format: "percent" | "integer";
};

export const AVAILABLE_PANEL_ATTRS: PanelAttrConfig[] = [
  {
    attrId: 11720,
    labelKey: "panelAttr.11720",
    label: "攻速",
    color: "#6ee7ff",
    enabled: false,
    format: "percent",
  },
  {
    attrId: 11710,
    labelKey: "panelAttr.11710",
    label: "暴击率",
    color: "#ff7a7a",
    enabled: false,
    format: "percent",
  },
  {
    attrId: 11930,
    labelKey: "panelAttr.11930",
    label: "急速",
    color: "#facc15",
    enabled: false,
    format: "percent",
  },
  {
    attrId: 11780,
    labelKey: "panelAttr.11780",
    label: "幸运",
    color: "#a78bfa",
    enabled: false,
    format: "percent",
  },
  {
    attrId: 11940,
    labelKey: "panelAttr.11940",
    label: "精通",
    color: "#60a5fa",
    enabled: false,
    format: "percent",
  },
  {
    attrId: 11950,
    labelKey: "panelAttr.11950",
    label: "全能",
    color: "#34d399",
    enabled: false,
    format: "percent",
  },
  {
    attrId: 11760,
    labelKey: "panelAttr.11760",
    label: "冷却缩减",
    color: "#f97316",
    enabled: false,
    format: "percent",
  },
  {
    attrId: 11960,
    labelKey: "panelAttr.11960",
    label: "冷却加速",
    color: "#38bdf8",
    enabled: false,
    format: "percent",
  },
  {
    attrId: 11010,
    labelKey: "panelAttr.11010",
    label: "力量",
    color: "#f87171",
    enabled: false,
    format: "integer",
  },
  {
    attrId: 11020,
    labelKey: "panelAttr.11020",
    label: "智力",
    color: "#818cf8",
    enabled: false,
    format: "integer",
  },
  {
    attrId: 11030,
    labelKey: "panelAttr.11030",
    label: "敏捷",
    color: "#4ade80",
    enabled: false,
    format: "integer",
  },
  {
    attrId: 11330,
    labelKey: "panelAttr.11330",
    label: "物理攻击",
    color: "#fb923c",
    enabled: false,
    format: "integer",
  },
  {
    attrId: 11340,
    labelKey: "panelAttr.11340",
    label: "魔法攻击",
    color: "#c084fc",
    enabled: false,
    format: "integer",
  },
  {
    attrId: 11730,
    labelKey: "panelAttr.11730",
    label: "施法速度",
    color: "#22d3ee",
    enabled: false,
    format: "percent",
  },
  {
    attrId: 12510,
    labelKey: "panelAttr.12510",
    label: "暴击伤害",
    color: "#f472b6",
    enabled: false,
    format: "percent",
  },
  {
    attrId: 12530,
    labelKey: "panelAttr.12530",
    label: "幸运伤害倍率",
    color: "#d8b4fe",
    enabled: false,
    format: "percent",
  },
  {
    attrId: 12540,
    labelKey: "panelAttr.12540",
    label: "格挡伤害减免",
    color: "#86efac",
    enabled: false,
    format: "percent",
  },
  {
    attrId: 11970,
    labelKey: "panelAttr.11970",
    label: "格挡",
    color: "#fbbf24",
    enabled: false,
    format: "percent",
  },
];

export type OverlayPositions = {
  skillCdGroup: Point;
  resourceGroup: Point;
  textBuffPanel: Point;
  specialBuffGroup: Point;
  panelAttrGroup: Point;
  buffUptimeGroup: Point;
  customPanelGroup: Point;
  shieldDetailGroup: Point;
  iconBuffPositions: Record<number, Point>;
  standaloneIconPositions?: Record<string, Point>;
  skillDurationPositions: Record<number, Point>;
  categoryIconPositions?: Partial<Record<BuffCategoryKey, Point>>;
};

export type OverlaySizes = {
  skillCdGroupScale: number;
  skillCdShowSlotOutline: boolean;
  skillCdShowEnhancedGlow: boolean;
  resourceGroupScale: number;
  textBuffPanelScale: number;
  panelAttrGroupScale: number;
  buffUptimeGroupScale: number;
  customPanelGroupScale: number;
  shieldDetailGroupScale: number;
  panelAttrGap: number;
  panelAttrFontSize: number;
  panelAttrColumnGap: number;
  buffUptimeGap: number;
  buffUptimeFontSize: number;
  buffUptimeEncounterFontSize: number;
  buffUptimeTrueFontSize: number;
  buffUptimeColumnGap: number;
  buffUptimeNameColumnAdjust: number;
  buffUptimeEncounterColumnAdjust: number;
  buffUptimeTrueColumnAdjust: number;
  iconBuffStackCounterSize: number;
  iconBuffSizes: Record<number, number>;
  standaloneIconSizes?: Record<string, number>;
  skillDurationSizes: Record<number, number>;
  categoryIconSizes?: Partial<Record<BuffCategoryKey, number>>;
};

export type OverlayVisibility = {
  showSkillCdGroup: boolean;
  showSkillDurationGroup: boolean;
  showResourceGroup: boolean;
  showPanelAttrGroup: boolean;
  showBuffUptimeGroup: boolean;
  showCustomPanelGroup: boolean;
  showShieldDetailGroup: boolean;
};

export type CustomPanelStyle = {
  gap: number;
  columnGap: number;
  fontSize: number;
  nameColor: string;
  valueColor: string;
  progressColor: string;
  progressOpacity: number;
};

export type MonsterOverlayPositions = {
  monsterBuffPanel: Point;
  teammateBuffPanel: Point;
  hatePanel: Point;
};

export type MonsterOverlaySizes = {
  monsterBuffPanelScale: number;
  teammateBuffPanelScale: number;
  hatePanelScale: number;
};

export type MonsterOverlayVisibility = {
  showMonsterBuffPanel: boolean;
  showTeammateBuffPanel: boolean;
  showHatePanel: boolean;
};

export type BuffAlertRule = {
  thresholdSeconds: number;
  highlightColor: string;
  flash: boolean;
  flashIntervalMs?: number;
  applyToProgress?: boolean;
};

export type BuffAlertMap = Record<string, BuffAlertRule>;

export type MonsterMonitorConfig = {
  enabled: boolean;
  hateListEnabled: boolean;
  hateListMaxDisplay: number;
  monitoredBuffIds: number[];
  selfAppliedBuffIds: number[];
  teammateBuffIds: number[];
  teammateBuffCategories?: BuffCategoryKey[];
  buffPriorityIds: number[];
  buffAliases: BuffAliasMap;
  buffAlerts: BuffAlertMap;
  overlayPositions: MonsterOverlayPositions;
  overlaySizes: MonsterOverlaySizes;
  overlayVisibility: MonsterOverlayVisibility;
  panelStyle: CustomPanelStyle;
  teammatePanelStyle: CustomPanelStyle;
  hatePanelStyle: CustomPanelStyle;
};

export type TextBuffPanelDisplayMode = "modern" | "classic";

export type TextBuffPanelStyle = {
  displayMode: TextBuffPanelDisplayMode;
  gap: number;
  columnGap: number;
  fontSize: number;
  nameColor: string;
  valueColor: string;
  progressColor: string;
  progressOpacity: number;
};

export type BuffUptimeTextStyle = {
  useOutline: boolean;
  outlineColor: string;
  outlineStrength: number;
  showTitle: boolean;
};

export type ShieldDetailStyle = {
  fontSize: number;
  barWidth: number;
  gap: number;
  hpColor: string;
  shieldColor: string;
  healShieldColor: string;
};

export type BuffUptimeTrackingMode = "self" | "global";
export type BuffUptimeMinStacksEnabledMap = Record<string, boolean>;
export type BuffUptimeMinStacksMap = Record<string, number>;

export type BuffDisplayMode = "individual" | "grouped";

export type BuffAliasMap = Record<string, string>;

export type InlineBuffFormat = "active" | "stacks_timer" | "timer";

export type InlineBuffEntry = {
  id: string;
  sourceType: "buff" | "counter";
  sourceId: number;
  counterSlotId?: number;
  counterDisplayMode?: "factor";
  label: string;
  format: InlineBuffFormat;
};

export type UserCounterRule = {
  ruleId: number;
  name: string;
  sourceRefs: string[];
  slotRefs: string[];
};

export type PanelAreaRowRef = { type: "attr"; attrId: number };

export type CustomPanelGroupKind = "manual" | "seasonCultivateFactor";

export type CustomPanelGroup = {
  id: string;
  name: string;
  kind: CustomPanelGroupKind;
  entries: InlineBuffEntry[];
  position: Point;
  scale: number;
  style: CustomPanelStyle;
};

export type BuffGroup = {
  id: string;
  name: string;
  buffIds: number[];
  priorityBuffIds: number[];
  monitorAll: boolean;
  position: Point;
  iconSize: number;
  columns: number;
  rows: number;
  gap: number;
  showName: boolean;
  showTime: boolean;
  showLayer: boolean;
};

export type ModuleCalcRequirement = {
  attrId: number | null;
  value: number | null;
};

export type ModuleCalcProfileSettings = {
  useGpu: boolean;
  combinationSize: 4 | 5;
  targetAttributes: number[];
  excludeAttributes: number[];
  minTotalValue: number;
  minRequirements: ModuleCalcRequirement[];
};

export type ModuleCalcMemoryState = {
  profileSettings: Record<string, ModuleCalcProfileSettings>;
};

export type SkillMonitorProfile = {
  id: string;
  name: string;
  selectedClass: string;
  monitoredSkillIds: number[];
  monitoredSkillDurationIds: number[];
  monitoredBuffIds: number[];
  monitoredUptimeBuffIds?: number[];
  monitoredBuffCategories?: BuffCategoryKey[];
  monitoredPanelAttrs: PanelAttrConfig[];
  buffPriorityIds: number[];
  buffAlerts?: BuffAlertMap;
  buffDisplayMode: BuffDisplayMode;
  buffGroups: BuffGroup[];
  individualMonitorAllGroup?: BuffGroup | null;
  userCounterRules?: UserCounterRule[];
  customPanelGroups?: CustomPanelGroup[];
  factorSlotLabels?: Record<string, string>;
  inlineBuffEntries?: InlineBuffEntry[];
  panelAreaRowOrder?: PanelAreaRowRef[];
  /** @deprecated Legacy shared style, kept only for migrating old custom panel groups. */
  customPanelStyle?: CustomPanelStyle;
  textBuffPanelStyle?: TextBuffPanelStyle;
  buffUptimeColors?: Record<string, string>;
  buffUptimeAliases?: Record<string, string>;
  buffUptimeTrackingModes?: Record<string, BuffUptimeTrackingMode>;
  buffUptimeActiveIndicators?: Record<string, boolean>;
  buffUptimeMinStacksEnabled?: BuffUptimeMinStacksEnabledMap;
  buffUptimeMinStacks?: BuffUptimeMinStacksMap;
  buffUptimeTextStyle?: BuffUptimeTextStyle;
  shieldDetailStyle?: ShieldDetailStyle;
  textBuffMaxVisible: number;
  moduleCalc?: ModuleCalcProfileSettings;
  autoHideWindowsOnGameBlur?: boolean;
  showTrueUptime?: boolean;
  showBuffUptimeActiveIndicator?: boolean;
  overlayPositions: OverlayPositions;
  overlaySizes: OverlaySizes;
  overlayVisibility: OverlayVisibility;
};

export type ProfileLibrarySettings = {
  folder: string;
  lastSelectedProfileId: string;
  lastSelectedProfileFile: string;
  profileFiles: Record<string, string>;
};

export function ensureBuffAliases(
  buffAliases: BuffAliasMap | null | undefined,
): BuffAliasMap {
  const next: BuffAliasMap = {};
  for (const [baseId, alias] of Object.entries(buffAliases ?? {})) {
    const trimmed = alias.trim();
    if (!trimmed) continue;
    next[baseId] = trimmed;
  }
  return next;
}

export function createDefaultBuffAlertRule(): BuffAlertRule {
  return {
    thresholdSeconds: 5,
    highlightColor: "#ef4444",
    flash: true,
    flashIntervalMs: 600,
    applyToProgress: true,
  };
}

export function ensureBuffAlerts(
  buffAlerts: BuffAlertMap | null | undefined,
): BuffAlertMap {
  const next: BuffAlertMap = {};
  for (const [baseId, rule] of Object.entries(buffAlerts ?? {})) {
    if (!rule || typeof rule !== "object") continue;
    const numericBaseId = Number(baseId);
    if (!Number.isFinite(numericBaseId)) continue;

    const thresholdSeconds = Number(rule.thresholdSeconds);
    const flashIntervalMs = Number(rule.flashIntervalMs);
    next[String(numericBaseId)] = {
      thresholdSeconds: Number.isFinite(thresholdSeconds)
        ? Math.max(1, Math.min(60, thresholdSeconds))
        : 5,
      highlightColor: rule.highlightColor || "#ef4444",
      flash: Boolean(rule.flash),
      flashIntervalMs: Number.isFinite(flashIntervalMs)
        ? Math.max(100, flashIntervalMs)
        : 600,
      applyToProgress: rule.applyToProgress ?? true,
    };
  }
  return next;
}

function createDefaultOverlayPositions(): OverlayPositions {
  return {
    skillCdGroup: { x: 40, y: 40 },
    resourceGroup: { x: 40, y: 170 },
    textBuffPanel: { x: 360, y: 40 },
    specialBuffGroup: { x: 360, y: 220 },
    panelAttrGroup: { x: 700, y: 40 },
    buffUptimeGroup: { x: 700, y: 220 },
    customPanelGroup: { x: 700, y: 320 },
    shieldDetailGroup: { x: 40, y: 550 },
    iconBuffPositions: {},
    standaloneIconPositions: {},
    skillDurationPositions: {},
    categoryIconPositions: {},
  };
}

function createDefaultOverlaySizes(): OverlaySizes {
  return {
    skillCdGroupScale: 1,
    skillCdShowSlotOutline: true,
    skillCdShowEnhancedGlow: true,
    resourceGroupScale: 1,
    textBuffPanelScale: 1,
    panelAttrGroupScale: 1,
    buffUptimeGroupScale: 1,
    customPanelGroupScale: 1,
    shieldDetailGroupScale: 1,
    panelAttrGap: 4,
    panelAttrFontSize: 14,
    panelAttrColumnGap: 12,
    buffUptimeGap: 4,
    buffUptimeFontSize: 14,
    buffUptimeEncounterFontSize: 15,
    buffUptimeTrueFontSize: 15,
    buffUptimeColumnGap: 12,
    buffUptimeNameColumnAdjust: 0,
    buffUptimeEncounterColumnAdjust: 0,
    buffUptimeTrueColumnAdjust: 0,
    iconBuffStackCounterSize: 9,
    iconBuffSizes: {},
    standaloneIconSizes: {},
    skillDurationSizes: {},
    categoryIconSizes: {},
  };
}

function createDefaultOverlayVisibility(): OverlayVisibility {
  return {
    showSkillCdGroup: true,
    showSkillDurationGroup: true,
    showResourceGroup: true,
    showPanelAttrGroup: true,
    showBuffUptimeGroup: true,
    showCustomPanelGroup: true,
    showShieldDetailGroup: false,
  };
}

export function createDefaultCustomPanelStyle(): CustomPanelStyle {
  return {
    gap: 6,
    columnGap: 12,
    fontSize: 14,
    nameColor: "#ffffff",
    valueColor: "#ffffff",
    progressColor: "#ffffff",
    progressOpacity: 0.4,
  };
}

function createDefaultMonsterOverlayPositions(): MonsterOverlayPositions {
  return {
    monsterBuffPanel: { x: 40, y: 40 },
    teammateBuffPanel: { x: 420, y: 40 },
    hatePanel: { x: 40, y: 300 },
  };
}

function createDefaultMonsterOverlaySizes(): MonsterOverlaySizes {
  return {
    monsterBuffPanelScale: 1,
    teammateBuffPanelScale: 1,
    hatePanelScale: 1,
  };
}

function createDefaultMonsterOverlayVisibility(): MonsterOverlayVisibility {
  return {
    showMonsterBuffPanel: true,
    showTeammateBuffPanel: true,
    showHatePanel: true,
  };
}

function createDefaultTextBuffPanelStyle(): TextBuffPanelStyle {
  return {
    displayMode: "modern",
    gap: 6,
    columnGap: 8,
    fontSize: 12,
    nameColor: "#ffffff",
    valueColor: "#ffffff",
    progressColor: "#ffffff",
    progressOpacity: 0.4,
  };
}

function createDefaultBuffUptimeTextStyle(): BuffUptimeTextStyle {
  return {
    useOutline: true,
    outlineColor: "#000000",
    outlineStrength: 2,
    showTitle: true,
  };
}

function createDefaultShieldDetailStyle(): ShieldDetailStyle {
  return {
    fontSize: 13,
    barWidth: 220,
    gap: 4,
    hpColor: "#ef4444",
    shieldColor: "#38bdf8",
    healShieldColor: "#22c55e",
  };
}

export function createDefaultBuffGroup(name = "新分组", index = 1): BuffGroup {
  return {
    id: `group_${Date.now()}_${index}`,
    name,
    buffIds: [],
    priorityBuffIds: [],
    monitorAll: false,
    position: { x: 40 + (index - 1) * 40, y: 310 + (index - 1) * 40 },
    iconSize: 44,
    columns: 6,
    rows: 3,
    gap: 6,
    showName: true,
    showTime: true,
    showLayer: true,
  };
}

export function createDefaultCustomPanelGroup(
  name = "监控区 1",
  index = 1,
  kind: CustomPanelGroupKind = "manual",
): CustomPanelGroup {
  return {
    id: `custom_panel_group_${Date.now()}_${index}`,
    name,
    kind,
    entries: [],
    position: { x: 700 + (index - 1) * 40, y: 280 + (index - 1) * 40 },
    scale: 1,
    style: createDefaultCustomPanelStyle(),
  };
}

function finiteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function finiteNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function profileIdSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "profile";
}

export function createGeneratedProfileId(seed = "profile"): string {
  return `${profileIdSlug(seed)}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function normalizeProfileId(
  value: unknown,
  name: string,
  index: number,
  fallbackId?: string,
): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (fallbackId?.trim()) return fallbackId.trim();
  return `profile-${index + 1}-${profileIdSlug(name)}`;
}

export function createDefaultModuleCalcProfileSettings(): ModuleCalcProfileSettings {
  return {
    useGpu: true,
    combinationSize: 4,
    targetAttributes: [],
    excludeAttributes: [],
    minTotalValue: 12,
    minRequirements: [{ attrId: null, value: null }],
  };
}

export function normalizeModuleCalcProfileSettings(
  value: Partial<ModuleCalcProfileSettings> | null | undefined,
): ModuleCalcProfileSettings {
  const defaults = createDefaultModuleCalcProfileSettings();
  const minRequirements = Array.isArray(value?.minRequirements)
    ? value.minRequirements.map((item) => ({
        attrId: finiteNumberOrNull(item?.attrId),
        value: finiteNumberOrNull(item?.value),
      }))
    : defaults.minRequirements;

  return {
    useGpu: typeof value?.useGpu === "boolean" ? value.useGpu : defaults.useGpu,
    combinationSize: value?.combinationSize === 5 ? 5 : 4,
    targetAttributes: finiteNumberArray(value?.targetAttributes),
    excludeAttributes: finiteNumberArray(value?.excludeAttributes),
    minTotalValue: finiteNumberOrNull(value?.minTotalValue) ?? defaults.minTotalValue,
    minRequirements:
      minRequirements.length > 0 ? minRequirements : defaults.minRequirements,
  };
}

export function createDefaultSkillMonitorProfile(
  name = "默认方案",
  classKey = "wind_knight",
  id = createGeneratedProfileId(name),
): SkillMonitorProfile {
  return {
    id,
    name,
    selectedClass: classKey,
    monitoredSkillIds: [],
    monitoredSkillDurationIds: [],
    monitoredBuffIds: [],
    monitoredUptimeBuffIds: [],
    monitoredBuffCategories: [],
    monitoredPanelAttrs: AVAILABLE_PANEL_ATTRS.map((item) => ({ ...item })),
    buffPriorityIds: [],
    buffAlerts: {},
    buffDisplayMode: "individual",
    buffGroups: [],
    individualMonitorAllGroup: null,
    userCounterRules: [],
    customPanelGroups: [],
    factorSlotLabels: {},
    inlineBuffEntries: [],
    panelAreaRowOrder: [],
    customPanelStyle: createDefaultCustomPanelStyle(),
    textBuffPanelStyle: createDefaultTextBuffPanelStyle(),
    buffUptimeColors: {},
    buffUptimeAliases: {},
    buffUptimeTrackingModes: {},
    buffUptimeActiveIndicators: {},
    buffUptimeMinStacksEnabled: {},
    buffUptimeMinStacks: {},
    buffUptimeTextStyle: createDefaultBuffUptimeTextStyle(),
    shieldDetailStyle: createDefaultShieldDetailStyle(),
    textBuffMaxVisible: 10,
    moduleCalc: createDefaultModuleCalcProfileSettings(),
    autoHideWindowsOnGameBlur: false,
    showTrueUptime: true,
    showBuffUptimeActiveIndicator: true,
    overlayPositions: createDefaultOverlayPositions(),
    overlaySizes: createDefaultOverlaySizes(),
    overlayVisibility: createDefaultOverlayVisibility(),
  };
}


export function ensureBuffUptimeColors(
  colors: Record<string, string> | null | undefined,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [buffId, color] of Object.entries(colors ?? {})) {
    const trimmed = typeof color === "string" ? color.trim() : "";
    if (!trimmed) continue;
    next[buffId] = trimmed;
  }
  return next;
}


export function ensureBuffUptimeAliases(
  aliases: Record<string, string> | null | undefined,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [buffId, alias] of Object.entries(aliases ?? {})) {
    const trimmed = typeof alias === "string" ? alias.trim() : "";
    if (!trimmed) continue;
    next[buffId] = trimmed;
  }
  return next;
}

export function ensureBuffUptimeTrackingModes(
  modes: Record<string, BuffUptimeTrackingMode> | null | undefined,
): Record<string, BuffUptimeTrackingMode> {
  const next: Record<string, BuffUptimeTrackingMode> = {};
  for (const [buffId, mode] of Object.entries(modes ?? {})) {
    next[buffId] = mode === "global" ? "global" : "self";
  }
  return next;
}

export function ensureBuffUptimeActiveIndicators(
  indicators: Record<string, boolean> | null | undefined,
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const [buffId, enabled] of Object.entries(indicators ?? {})) {
    next[buffId] = enabled !== false;
  }
  return next;
}

export function ensureBuffUptimeMinStacksEnabled(
  enabledMap: BuffUptimeMinStacksEnabledMap | null | undefined,
): BuffUptimeMinStacksEnabledMap {
  const next: BuffUptimeMinStacksEnabledMap = {};
  for (const [buffId, enabled] of Object.entries(enabledMap ?? {})) {
    next[buffId] = enabled === true;
  }
  return next;
}

export function ensureBuffUptimeMinStacks(
  minStacksMap: BuffUptimeMinStacksMap | null | undefined,
): BuffUptimeMinStacksMap {
  const next: BuffUptimeMinStacksMap = {};
  for (const [buffId, value] of Object.entries(minStacksMap ?? {})) {
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) continue;
    next[buffId] = Math.max(1, Math.min(999, Math.round(num)));
  }
  return next;
}
export function ensureBuffUptimeTextStyle(
  style: BuffUptimeTextStyle | null | undefined,
): BuffUptimeTextStyle {
  return {
    useOutline: style?.useOutline ?? true,
    outlineColor: style?.outlineColor?.trim() || "#000000",
    outlineStrength: Math.max(0, Math.min(4, Math.round(style?.outlineStrength ?? 2))),
    showTitle: style?.showTitle !== false,
  };
}

export function createDefaultMonsterMonitorConfig(): MonsterMonitorConfig {
  return {
    enabled: false,
    hateListEnabled: false,
    hateListMaxDisplay: 5,
    monitoredBuffIds: [],
    selfAppliedBuffIds: [],
    teammateBuffIds: [],
    teammateBuffCategories: [],
    buffPriorityIds: [],
    buffAliases: {},
    buffAlerts: {},
    overlayPositions: createDefaultMonsterOverlayPositions(),
    overlaySizes: createDefaultMonsterOverlaySizes(),
    overlayVisibility: createDefaultMonsterOverlayVisibility(),
    panelStyle: createDefaultCustomPanelStyle(),
    teammatePanelStyle: createDefaultCustomPanelStyle(),
    hatePanelStyle: createDefaultCustomPanelStyle(),
  };
}

const DEFAULT_GENERAL_SETTINGS: {
  showYourName: string;
  showOthersName: string;
  showYourAbilityScore: boolean;
  showOthersAbilityScore: boolean;
  showYourSeasonStrength: boolean;
  showOthersSeasonStrength: boolean;
  relativeToTopDPSPlayer: boolean;
  relativeToTopDPSSkill: boolean;
  relativeToTopHealPlayer: boolean;
  relativeToTopHealSkill: boolean;
  relativeToTopTankedPlayer: boolean;
  relativeToTopTankedSkill: boolean;
  shortenAbilityScore: boolean;
  shortenDps: boolean;
  shortenTps: boolean;
  abbreviationStyle: 'western' | 'cn';
  abbreviatedDecimalPlaces: number;
  eventUpdateRateMs: number;
  autoClearOnSceneChange: boolean;
  autoHideLiveWindow: boolean;
  autoHideOverlaysWithLiveWindow: boolean;
  autoHideLiveWindowDelaySeconds: number;
  modifierReportsEnabled: boolean;
  language: LocaleCode;
  skillIdDisplayMode: SkillIdDisplayMode;
  showHoverDescriptions: boolean;
} = {
  showYourName: "Show Your Name",
  showOthersName: "Show Others' Name",
  showYourAbilityScore: true,
  showOthersAbilityScore: true,
  showYourSeasonStrength: false,
  showOthersSeasonStrength: false,
  relativeToTopDPSPlayer: true,
  relativeToTopDPSSkill: true,
  relativeToTopHealPlayer: true,
  relativeToTopHealSkill: true,
  relativeToTopTankedPlayer: true,
  relativeToTopTankedSkill: true,
  shortenAbilityScore: true,
  shortenDps: true,
  shortenTps: true,
  abbreviationStyle: 'western',
  abbreviatedDecimalPlaces: 1,
  eventUpdateRateMs: 200,
  autoClearOnSceneChange: true,
  autoHideLiveWindow: false,
  autoHideOverlaysWithLiveWindow: false,
  autoHideLiveWindowDelaySeconds: 5,
  modifierReportsEnabled: false,
  language: 'zh-CN',
  skillIdDisplayMode: 'off',
  showHoverDescriptions: true,
};

export const MODIFIER_REPORTS_RUNTIME_OPT_IN_VERSION = "1.0.7-release-guard-2026-05-29";
const MODIFIER_REPORTS_RESET_VERSION = "1.0.7-release-guard-2026-05-29";

export const DEFAULT_CLASS_COLORS: Record<string, string> = {
  Stormblade: "#674598",
  "Frost Mage": "#4de3d1",
  "Flame Berserker": "#e64a19",
  "Wind Knight": "#0099c6",
  "Verdant Oracle": "#66aa00",
  "Heavy Guardian": "#b38915",
  Marksman: "#ffee00",
  "Shield Knight": "#7b9aa2",
  "Beat Performer": "#ee2e48",
};

export const CLASS_SPEC_MAP: Record<string, string> = {
  Iaido: "Stormblade",
  Moonstrike: "Stormblade",
  Icicle: "Frost Mage",
  Frostbeam: "Frost Mage",
  Voidflame: "Flame Berserker",
  Blazecrimson: "Flame Berserker",
  Vanguard: "Wind Knight",
  Skyward: "Wind Knight",
  Smite: "Verdant Oracle",
  Lifebind: "Verdant Oracle",
  Earthfort: "Heavy Guardian",
  Block: "Heavy Guardian",
  Wildpack: "Marksman",
  Falconry: "Marksman",
  Recovery: "Shield Knight",
  Shield: "Shield Knight",
  Dissonance: "Beat Performer",
  Concerto: "Beat Performer",
};

export const CLASS_SPEC_NAMES = Object.keys(CLASS_SPEC_MAP);

export const DEFAULT_CLASS_SPEC_COLORS: Record<string, string> = {
  // Stormblade
  Iaido: "#9b6cf0",
  Moonstrike: "#4a2f80",
  // Frost Mage
  Icicle: "#8ff7ee",
  Frostbeam: "#2fbfb3",
  // Flame Berserker
  Voidflame: "#ff6d3a",
  Blazecrimson: "#c41e00",
  // Wind Knight
  Vanguard: "#4ddff6",
  Skyward: "#006b8f",
  // Verdant Oracle
  Smite: "#b9f36e",
  Lifebind: "#3b6d00",
  // Heavy Guardian
  Earthfort: "#7ea6c6",
  Block: "#7b5b08",
  // Marksman
  Wildpack: "#fff9a6",
  Falconry: "#cab400",
  // Shield Knight
  Recovery: "#b6d1d6",
  Shield: "#4f6b70",
  // Beat Performer
  Dissonance: "#ff7b94",
  Concerto: "#9f1322",
};

export const DEFAULT_FONT_SIZES = {
  xs: 10, // Extra small - labels, hints (default 0.625rem = 10px)
  sm: 12, // Small - secondary text (default 0.75rem = 12px)
  base: 14, // Base - default text (default 0.875rem = 14px)
  lg: 16, // Large - emphasis (default 1rem = 16px)
  xl: 20, // Extra large - titles (default 1.25rem = 20px)
};

// Live table customization defaults
export const DEFAULT_LIVE_TABLE_SETTINGS = {
  compactMode: false,
  compactDpsKey: "dps" as "dps" | "tdps",

  // Player row settings
  playerRowHeight: 28,
  playerFontSize: 13,
  playerIconSize: 20,

  // Table header settings
  showTableHeader: true,
  tableHeaderHeight: 24,
  tableHeaderFontSize: 11,
  tableHeaderTextColor: "#a1a1aa",

  // Abbreviated numbers (K, M, %)
  abbreviatedFontSize: 10,

  // Skill row settings (separate from player rows)
  skillRowHeight: 24,
  skillFontSize: 12,
  skillIconSize: 18,

  skillShowHeader: true,
  skillHeaderHeight: 22,
  skillHeaderFontSize: 10,
  skillHeaderTextColor: "#a1a1aa",
  skillAbbreviatedFontSize: 9,

  // Skill-specific row glow / highlight customization (separate from player rows)
  skillRowGlowMode: "gradient-underline" as
    | "gradient-underline"
    | "gradient"
    | "solid",
  skillRowGlowOpacity: 0.15,
  skillRowBorderRadius: 0,
  // Row glow / highlight customization
  // modes: 'gradient-underline' (gradient + neon underline), 'gradient' (gradient only), 'solid' (solid color fill)
  rowGlowMode: "gradient-underline" as
    | "gradient-underline"
    | "gradient"
    | "solid",
  // opacity applied to the fill (0-1)
  rowGlowOpacity: 0.15,
  // border height in pixels for the neon underline effect
  rowGlowBorderHeight: 2,
  // box-shadow spread/blur for the neon border
  rowGlowSpread: 8,
  // Note: glow always uses the detected class/spec color.
  // Row border customization
  rowBorderRadius: 0,
};

export const DEFAULT_LIVE_DYNAMIC_WINDOW_SETTINGS = {
  enabled: false,
  maxPlayerRows: 10,
};

// (Header preset constants removed - header defaults inlined into DEFAULT_SETTINGS)

export const FONT_SIZE_LABELS: Record<string, string> = {
  xs: "超小",
  sm: "小",
  base: "标准",
  lg: "大",
  xl: "超大",
};

// Default custom theme colors (based on dark theme)
export type CustomThemeColors = {
  backgroundMain: string;
  backgroundLive: string;
  foreground: string;
  surface: string;
  surfaceForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipFg: string;
  tableTextColor: string;
  tableAbbreviatedColor: string;
};

export const DEFAULT_CUSTOM_THEME_COLORS: CustomThemeColors = {
  backgroundMain: "rgba(33, 33, 33, 1)",
  backgroundLive: "rgba(33, 33, 33, 1)",
  foreground: "rgba(226, 226, 226, 1)",
  surface: "rgba(41, 41, 41, 1)",
  surfaceForeground: "rgba(226, 226, 226, 1)",
  primary: "rgba(166, 166, 166, 1)",
  primaryForeground: "rgba(33, 33, 33, 1)",
  secondary: "rgba(64, 64, 64, 1)",
  secondaryForeground: "rgba(226, 226, 226, 1)",
  muted: "rgba(56, 56, 56, 1)",
  mutedForeground: "rgba(138, 138, 138, 1)",
  accent: "rgba(82, 82, 82, 1)",
  accentForeground: "rgba(226, 226, 226, 1)",
  destructive: "rgba(220, 80, 80, 1)",
  destructiveForeground: "rgba(255, 255, 255, 1)",
  border: "rgba(74, 74, 74, 1)",
  input: "rgba(64, 64, 64, 1)",
  tooltipBg: "rgba(33, 33, 33, 0.92)",
  tooltipBorder: "rgba(74, 74, 74, 0.55)",
  tooltipFg: "rgba(226, 226, 226, 1)",
  tableTextColor: "#ffffff",
  tableAbbreviatedColor: "#71717a",
};

// Labels for custom theme color variables
export const CUSTOM_THEME_COLOR_LABELS: Record<
  string,
  { label: string; description: string; category: string }
> = {
  backgroundMain: {
    label: "背景（主窗口）",
    description: "主窗口背景颜色",
    category: "Base",
  },
  backgroundLive: {
    label: "背景（实时）",
    description: "实时统计窗口背景颜色",
    category: "Base",
  },
  foreground: { label: "前景", description: "主要文本颜色", category: "Base" },
  surface: {
    label: "表面",
    description: "卡片、弹窗和面板的背景颜色",
    category: "Surfaces",
  },
  surfaceForeground: {
    label: "表面文本",
    description: "表面上的文本颜色",
    category: "Surfaces",
  },
  primary: { label: "主色", description: "主要强调色", category: "Accents" },
  primaryForeground: {
    label: "主色文本",
    description: "主色元素上的文本颜色",
    category: "Accents",
  },
  secondary: { label: "次色", description: "次要强调色", category: "Accents" },
  secondaryForeground: {
    label: "次色文本",
    description: "次色元素上的文本颜色",
    category: "Accents",
  },
  muted: {
    label: "柔和",
    description: "柔和/低调的背景颜色",
    category: "Utility",
  },
  mutedForeground: {
    label: "柔和文本",
    description: "低调的文本颜色",
    category: "Utility",
  },
  accent: { label: "强调", description: "高亮强调色", category: "Accents" },
  accentForeground: {
    label: "强调文本",
    description: "强调色元素上的文本颜色",
    category: "Accents",
  },
  destructive: {
    label: "破坏性",
    description: "错误/危险颜色",
    category: "Utility",
  },
  destructiveForeground: {
    label: "破坏性文本",
    description: "破坏性元素上的文本颜色",
    category: "Utility",
  },
  border: { label: "边框", description: "边框颜色", category: "Utility" },
  input: {
    label: "输入框",
    description: "输入框背景颜色",
    category: "Utility",
  },
  tableTextColor: {
    label: "表格文本",
    description: "实时表格中的文本颜色",
    category: "Tables",
  },
  tableAbbreviatedColor: {
    label: "后缀颜色",
    description: "表格中 K、M、% 后缀的颜色",
    category: "Tables",
  },
  tooltipBg: {
    label: "提示背景",
    description: "提示框背景颜色",
    category: "Tooltip",
  },
  tooltipBorder: {
    label: "提示边框",
    description: "提示框边框颜色",
    category: "Tooltip",
  },
  tooltipFg: {
    label: "提示文本",
    description: "提示框文本颜色",
    category: "Tooltip",
  },
};

const DEFAULT_SETTINGS = {
  accessibility: {
    blur: false,
    clickthrough: false,
    classColors: { ...DEFAULT_CLASS_COLORS },
    useClassSpecColors: false,
    classSpecColors: { ...DEFAULT_CLASS_SPEC_COLORS },
    fontSizes: { ...DEFAULT_FONT_SIZES },
    customThemeColors: { ...DEFAULT_CUSTOM_THEME_COLORS },
    // Background image settings
    backgroundImage: "" as string,
    backgroundImageEnabled: false,
    backgroundImageMode: "cover" as "cover" | "contain" | "fit-width",
    backgroundImageContainColor: "rgba(0, 0, 0, 0)",
    backgroundImageOpacity: 100,
    // Custom font settings
    customFontSansEnabled: false,
    customFontSansUrl: "" as string,
    customFontSansName: "" as string,
    customFontMonoEnabled: false,
    customFontMonoUrl: "" as string,
    customFontMonoName: "" as string,
  },
  shortcuts: {
    showLiveMeter: "",
    hideLiveMeter: "",
    toggleLiveMeter: "",
    toggleOverlayWindow: "",
    enableClickthrough: "",
    disableClickthrough: "",
    toggleClickthrough: "",
    resetEncounter: "",
    togglePauseEncounter: "",
    hardReset: "",
    toggleBossHp: "",
    toggleOverlayEdit: "",
    toggleEventLogger: "",
  },
  moduleSync: {
    enabled: false,
    apiKey: "",
    baseUrl: "https://your-api-server.com/api/v1",
    autoSyncIntervalMinutes: 0,
    autoUpload: true,
    marketUpload: true,
  },
  moduleCalc: {
    profileSettings: {} as Record<string, ModuleCalcProfileSettings>,
  },
  skillMonitor: {
    enabled: false,
    overlayStartWithApp: false,
    activeProfileIndex: 0,
    buffAliases: {} as BuffAliasMap,
    profiles: [createDefaultSkillMonitorProfile()] as SkillMonitorProfile[],
  },
  profileLibrary: {
    folder: "",
    lastSelectedProfileId: "",
    lastSelectedProfileFile: "",
    profileFiles: {} as Record<string, string>,
  } satisfies ProfileLibrarySettings,
  customTriggers: {
    enabled: true,
    loggerAlwaysOnTop: false,
    loggerStartWithMeter: false,
    loggerReduceClutter: true,
    loggerCaptureEvents: true,
    loggerCaptureSnapshots: true,
    loggerDisplayMode: "name_uid" as "name" | "name_uid" | "uid",
    loggerBufferSize: 1000,
    loggerVisibleColumns: {
      time: true,
      category: true,
      action: true,
      name: true,
      known: true,
      uid: true,
      source: true,
      target: true,
      stacks: true,
      duration: true,
      summary: true,
    } as Record<string, boolean>,
    selectedHotkeyTriggerId: "",
    selectedHotkeyGroupId: "",
    groupUiStates: {} as Record<string, { collapsed?: boolean; settingsCollapsed?: boolean; triggersCollapsed?: boolean }>,
    hotkeys: {
      fireSelectedTrigger: "",
      stopSelectedTrigger: "",
      resetSelectedTrigger: "",
      clearSelectedGroup: "",
      resetAllRuntimeState: "",
    },
  },
  monsterMonitor: createDefaultMonsterMonitorConfig(),
  trainingDummy: {
    showHeaderControl: true,
  },
  appBehavior: {
    hideMainWindowToTray: false,
  },
  live: {
    general: { ...DEFAULT_GENERAL_SETTINGS },
    dpsPlayers: { ...DEFAULT_STATS },
    dpsSkillBreakdown: { ...DEFAULT_STATS },
    healPlayers: { ...DEFAULT_STATS },
    healSkillBreakdown: { ...DEFAULT_STATS },
    tankedPlayers: { ...DEFAULT_STATS },
    tankedSkillBreakdown: { ...DEFAULT_STATS },
    tableCustomization: { ...DEFAULT_LIVE_TABLE_SETTINGS },
    dynamicWindow: { ...DEFAULT_LIVE_DYNAMIC_WINDOW_SETTINGS },
    headerCustomization: {
      headerLayoutMode: "classic" as HeaderLayoutMode,
      headerCustomLayout: cloneHeaderCustomLayout() as HeaderCustomLayout,
      windowPadding: 12,
      headerPadding: 8,
      showTimer: true,
      showActiveTimer: false,
      showSceneName: true,
      showResetButton: true,
      showPauseButton: true,
      showBossOnlyButton: true,
      showSettingsButton: true,
      showMinimizeButton: true,
      showHeaderControl: true,
      showTotalDamage: true,
      showTotalDps: true,
      showBossHealth: true,
      showNavigationTabs: true,
      showDeathTab: false,
      timerLabelFontSize: 12,
      timerFontSize: 18,
      activeTimerFontSize: 18,
      sceneNameFontSize: 14,
      resetButtonSize: 20,
      resetButtonPadding: 8,
      pauseButtonSize: 20,
      pauseButtonPadding: 8,
      bossOnlyButtonSize: 20,
      bossOnlyButtonPadding: 8,
      settingsButtonSize: 20,
      settingsButtonPadding: 8,
      minimizeButtonSize: 20,
      minimizeButtonPadding: 8,
      totalDamageLabelFontSize: 14,
      totalDamageValueFontSize: 18,
      totalDpsLabelFontSize: 14,
      totalDpsValueFontSize: 18,
      bossHealthLabelFontSize: 14,
      bossHealthNameFontSize: 14,
      bossHealthValueFontSize: 14,
      bossHealthPercentFontSize: 14,
      bossHealthLayout: "vertical" as "vertical" | "horizontal",
      navTabFontSize: 11,
      navTabPaddingX: 14,
      navTabPaddingY: 6,
    },
  },
  history: {
    general: { ...DEFAULT_GENERAL_SETTINGS },
    dpsPlayers: { ...DEFAULT_HISTORY_STATS },
    dpsSkillBreakdown: { ...DEFAULT_HISTORY_DPS_SKILL_STATS },
    healPlayers: { ...DEFAULT_HISTORY_HEAL_STATS },
    healSkillBreakdown: { ...DEFAULT_HISTORY_STATS },
    tankedPlayers: { ...DEFAULT_HISTORY_TANKED_STATS },
    tankedSkillBreakdown: { ...DEFAULT_HISTORY_STATS },
  },
};

function normalizeStringRecord(value: unknown): Record<string, string> {
  const next: Record<string, string> = {};
  if (!isMutableRecord(value)) return next;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") next[key] = item;
  }
  return next;
}

function normalizeInlineBuffEntriesForPersistence(
  value: unknown,
): InlineBuffEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isMutableRecord)
    .map((entry, index) => {
      const format = entry["format"];
      const normalized: InlineBuffEntry = {
        id:
          typeof entry["id"] === "string" && entry["id"]
            ? entry["id"]
            : `inline_${index + 1}`,
        sourceType: entry["sourceType"] === "counter" ? "counter" : "buff",
        sourceId: Number.isFinite(Number(entry["sourceId"]))
          ? Number(entry["sourceId"])
          : 0,
        label: typeof entry["label"] === "string" ? entry["label"] : "",
        format:
          format === "active" || format === "stacks_timer"
            ? format
            : "timer",
      };
      if (
        entry["counterSlotId"] !== undefined &&
        Number.isFinite(Number(entry["counterSlotId"]))
      ) {
        normalized.counterSlotId = Number(entry["counterSlotId"]);
      }
      if (entry["counterDisplayMode"] === "factor") {
        normalized.counterDisplayMode = "factor";
      }
      return normalized;
    });
}

function normalizeCustomPanelGroupKind(
  value: unknown,
): CustomPanelGroupKind {
  return value === "seasonCultivateFactor" ? "seasonCultivateFactor" : "manual";
}

function normalizeCustomPanelGroupsForPersistence(
  value: unknown,
  profile: SkillMonitorProfile,
): CustomPanelGroup[] {
  if (!Array.isArray(value)) return [];
  const legacyPosition = profile.overlayPositions?.customPanelGroup ?? {
    x: 700,
    y: 280,
  };
  const legacyScale =
    typeof profile.overlaySizes?.customPanelGroupScale === "number"
      ? profile.overlaySizes.customPanelGroupScale
      : 1;
  return value.filter(isMutableRecord).map((group, index) => {
    const kind = normalizeCustomPanelGroupKind(group["kind"]);
    const fallbackPosition = {
      x: legacyPosition.x + index * 40,
      y: legacyPosition.y + index * 40,
    };
    const normalized = normalizeObjectWithDefaults(group, {
      id: `custom_panel_group_${index + 1}`,
      name: `监控区 ${index + 1}`,
      kind,
      entries: [] as InlineBuffEntry[],
      position: fallbackPosition,
      scale: index === 0 ? legacyScale : 1,
      style: createDefaultCustomPanelStyle(),
    }) as CustomPanelGroup;
    normalized.kind = kind;
    normalized.entries =
      kind === "manual"
        ? normalizeInlineBuffEntriesForPersistence(normalized.entries)
        : [];
    normalized.style = normalizeObjectWithDefaults(
      normalized.style,
      createDefaultCustomPanelStyle(),
    );
    return normalized as CustomPanelGroup;
  });
}

export function normalizeSkillMonitorProfileForPersistence(
  value: unknown,
  index: number,
  options?: { fallbackId?: string },
): SkillMonitorProfile {
  const defaults = createDefaultSkillMonitorProfile(`默认方案 ${index + 1}`);
  const next = normalizeObjectWithDefaults(value, defaults);
  next.id = normalizeProfileId(next.id, next.name, index, options?.fallbackId);
  next.monitoredSkillIds = finiteNumberArray(next.monitoredSkillIds);
  next.monitoredSkillDurationIds = finiteNumberArray(next.monitoredSkillDurationIds);
  next.monitoredBuffIds = finiteNumberArray(next.monitoredBuffIds);
  next.monitoredUptimeBuffIds = finiteNumberArray(next.monitoredUptimeBuffIds);
  next.buffPriorityIds = finiteNumberArray(next.buffPriorityIds);
  next.userCounterRules = Array.isArray(next.userCounterRules)
    ? next.userCounterRules
    : [];
  next.buffUptimeColors = ensureBuffUptimeColors(next.buffUptimeColors);
  next.buffUptimeAliases = ensureBuffUptimeAliases(next.buffUptimeAliases);
  next.buffUptimeTrackingModes = ensureBuffUptimeTrackingModes(
    next.buffUptimeTrackingModes,
  );
  next.buffUptimeActiveIndicators = ensureBuffUptimeActiveIndicators(
    next.buffUptimeActiveIndicators,
  );
  next.buffUptimeMinStacksEnabled = ensureBuffUptimeMinStacksEnabled(
    next.buffUptimeMinStacksEnabled,
  );
  next.buffUptimeMinStacks = ensureBuffUptimeMinStacks(next.buffUptimeMinStacks);
  next.moduleCalc = normalizeModuleCalcProfileSettings(next.moduleCalc);
  next.autoHideWindowsOnGameBlur = next.autoHideWindowsOnGameBlur === true;
  next.factorSlotLabels = normalizeStringRecord(next.factorSlotLabels);
  next.inlineBuffEntries = normalizeInlineBuffEntriesForPersistence(
    next.inlineBuffEntries,
  );
  next.customPanelGroups = normalizeCustomPanelGroupsForPersistence(
    next.customPanelGroups,
    next,
  );
  next.panelAreaRowOrder = Array.isArray(next.panelAreaRowOrder)
    ? next.panelAreaRowOrder
    : [];
  return next as SkillMonitorProfile;
}

function normalizeSkillMonitorSettingsState(
  value: unknown,
): typeof DEFAULT_SETTINGS.skillMonitor {
  const next = normalizeObjectWithDefaults(value, DEFAULT_SETTINGS.skillMonitor);
  const profiles = Array.isArray(next.profiles)
    ? next.profiles.map((profile, index) =>
        normalizeSkillMonitorProfileForPersistence(profile, index),
      )
    : [];
  next.profiles =
    profiles.length > 0 ? profiles : [createDefaultSkillMonitorProfile()];
  const activeIndex = Number(next.activeProfileIndex);
  next.activeProfileIndex = Number.isFinite(activeIndex)
    ? Math.max(0, Math.min(next.profiles.length - 1, Math.round(activeIndex)))
    : 0;
  return next;
}

function normalizeProfileLibrarySettingsState(
  value: unknown,
): ProfileLibrarySettings {
  const next = normalizeObjectWithDefaults(
    value,
    DEFAULT_SETTINGS.profileLibrary,
  );
  next.folder = typeof next.folder === "string" ? next.folder : "";
  next.lastSelectedProfileId =
    typeof next.lastSelectedProfileId === "string"
      ? next.lastSelectedProfileId
      : "";
  next.lastSelectedProfileFile =
    typeof next.lastSelectedProfileFile === "string"
      ? next.lastSelectedProfileFile
      : "";
  next.profileFiles = isMutableRecord(next.profileFiles)
    ? normalizeStringRecord(next.profileFiles)
    : {};
  return next as ProfileLibrarySettings;
}

function normalizeMonsterMonitorSettingsState(
  value: unknown,
): MonsterMonitorConfig {
  return normalizeObjectWithDefaults(
    value,
    DEFAULT_SETTINGS.monsterMonitor,
  ) as MonsterMonitorConfig;
}

type SettingsStoreNormalizer<T extends MutableRecord> = (value: unknown) => T;

function createSettingsStore<T extends MutableRecord>(
  id: string,
  defaults: T,
  normalize: SettingsStoreNormalizer<T> = (value) =>
    normalizeObjectWithDefaults(value, defaults),
): RuneStore<T> {
  return new RuneStore(id, cloneSettingValue(defaults), {
    autoStart: true,
    saveOnChange: true,
    hooks: {
      beforeFrontendSync: normalize,
      beforeBackendSync: normalize,
    },
  });
}

// We need flattened settings for every update to be able to auto-detect new changes
export const SETTINGS = {
  accessibility: createSettingsStore(
    "accessibility",
    DEFAULT_SETTINGS.accessibility,
  ),
  shortcuts: createSettingsStore(
    "shortcuts",
    DEFAULT_SETTINGS.shortcuts,
  ),
  moduleSync: createSettingsStore(
    "moduleSync",
    DEFAULT_SETTINGS.moduleSync,
  ),
  moduleCalc: createSettingsStore(
    "moduleCalc",
    DEFAULT_SETTINGS.moduleCalc,
  ),
  skillMonitor: createSettingsStore(
    "skillMonitor",
    DEFAULT_SETTINGS.skillMonitor,
    normalizeSkillMonitorSettingsState,
  ),
  profileLibrary: createSettingsStore(
    "profileLibrary",
    DEFAULT_SETTINGS.profileLibrary,
    normalizeProfileLibrarySettingsState,
  ),
  customTriggers: createSettingsStore(
    "customTriggers",
    DEFAULT_SETTINGS.customTriggers,
  ),
  monsterMonitor: createSettingsStore(
    "monsterMonitor",
    DEFAULT_SETTINGS.monsterMonitor,
    normalizeMonsterMonitorSettingsState,
  ),
  trainingDummy: createSettingsStore(
    "trainingDummy",
    DEFAULT_SETTINGS.trainingDummy,
  ),
  appBehavior: createSettingsStore(
    "appBehavior",
    DEFAULT_SETTINGS.appBehavior,
  ),
  live: {
    general: createSettingsStore(
      "liveGeneral",
      DEFAULT_SETTINGS.live.general,
    ),
    dps: {
      players: createSettingsStore(
        "liveDpsPlayers",
        DEFAULT_SETTINGS.live.dpsPlayers,
      ),
      skillBreakdown: createSettingsStore(
        "liveDpsSkillBreakdown",
        DEFAULT_SETTINGS.live.dpsSkillBreakdown,
      ),
    },
    heal: {
      players: createSettingsStore(
        "liveHealPlayers",
        DEFAULT_SETTINGS.live.healPlayers,
      ),
      skillBreakdown: createSettingsStore(
        "liveHealSkillBreakdown",
        DEFAULT_SETTINGS.live.healSkillBreakdown,
      ),
    },
    tanked: {
      players: createSettingsStore(
        "liveTankedPlayers",
        DEFAULT_SETTINGS.live.tankedPlayers,
      ),
      skills: createSettingsStore(
        "liveTankedSkills",
        DEFAULT_SETTINGS.live.tankedSkillBreakdown,
      ),
    },
    tableCustomization: createSettingsStore(
      "liveTableCustomization",
      DEFAULT_SETTINGS.live.tableCustomization,
    ),
    dynamicWindow: createSettingsStore(
      "liveDynamicWindow",
      DEFAULT_SETTINGS.live.dynamicWindow,
    ),
    headerCustomization: createSettingsStore(
      "liveHeaderCustomization",
      DEFAULT_SETTINGS.live.headerCustomization,
    ),
    // Column order settings
    columnOrder: {
      dpsPlayers: createSettingsStore(
        "liveDpsPlayersColumnOrder",
        { order: DEFAULT_DPS_PLAYER_COLUMN_ORDER },
        normalizeColumnOrderSettingsState(DEFAULT_DPS_PLAYER_COLUMN_ORDER),
      ),
      dpsSkills: createSettingsStore(
        "liveDpsSkillsColumnOrder",
        { order: DEFAULT_DPS_SKILL_COLUMN_ORDER },
        normalizeColumnOrderSettingsState(DEFAULT_DPS_SKILL_COLUMN_ORDER),
      ),
      healPlayers: createSettingsStore(
        "liveHealPlayersColumnOrder",
        { order: DEFAULT_HEAL_PLAYER_COLUMN_ORDER },
        normalizeColumnOrderSettingsState(DEFAULT_HEAL_PLAYER_COLUMN_ORDER),
      ),
      healSkills: createSettingsStore(
        "liveHealSkillsColumnOrder",
        { order: DEFAULT_HEAL_SKILL_COLUMN_ORDER },
        normalizeColumnOrderSettingsState(DEFAULT_HEAL_SKILL_COLUMN_ORDER),
      ),
      tankedPlayers: createSettingsStore(
        "liveTankedPlayersColumnOrder",
        { order: DEFAULT_TANKED_PLAYER_COLUMN_ORDER },
        normalizeColumnOrderSettingsState(DEFAULT_TANKED_PLAYER_COLUMN_ORDER),
      ),
      tankedSkills: createSettingsStore(
        "liveTankedSkillsColumnOrder",
        { order: DEFAULT_TANKED_SKILL_COLUMN_ORDER },
        normalizeColumnOrderSettingsState(DEFAULT_TANKED_SKILL_COLUMN_ORDER),
      ),
    },
    // Sort settings
    sorting: {
      dpsPlayers: createSettingsStore(
        "liveDpsPlayersSorting",
        DEFAULT_LIVE_SORT_SETTINGS.dpsPlayers,
      ),
      dpsSkills: createSettingsStore(
        "liveDpsSkillsSorting",
        DEFAULT_LIVE_SORT_SETTINGS.dpsSkills,
      ),
      healPlayers: createSettingsStore(
        "liveHealPlayersSorting",
        DEFAULT_LIVE_SORT_SETTINGS.healPlayers,
      ),
      healSkills: createSettingsStore(
        "liveHealSkillsSorting",
        DEFAULT_LIVE_SORT_SETTINGS.healSkills,
      ),
      tankedPlayers: createSettingsStore(
        "liveTankedPlayersSorting",
        DEFAULT_LIVE_SORT_SETTINGS.tankedPlayers,
      ),
      tankedSkills: createSettingsStore(
        "liveTankedSkillsSorting",
        DEFAULT_LIVE_SORT_SETTINGS.tankedSkills,
      ),
    },
  },
  history: {
    general: createSettingsStore(
      "historyGeneral",
      DEFAULT_SETTINGS.history.general,
    ),
    dps: {
      players: createSettingsStore(
        "historyDpsPlayers",
        DEFAULT_SETTINGS.history.dpsPlayers,
      ),
      skillBreakdown: createSettingsStore(
        "historyDpsSkillBreakdown",
        DEFAULT_SETTINGS.history.dpsSkillBreakdown,
      ),
    },
    heal: {
      players: createSettingsStore(
        "historyHealPlayers",
        DEFAULT_SETTINGS.history.healPlayers,
      ),
      skillBreakdown: createSettingsStore(
        "historyHealSkillBreakdown",
        DEFAULT_SETTINGS.history.healSkillBreakdown,
      ),
    },
    tanked: {
      players: createSettingsStore(
        "historyTankedPlayers",
        DEFAULT_SETTINGS.history.tankedPlayers,
      ),
      skillBreakdown: createSettingsStore(
        "historyTankedSkillBreakdown",
        DEFAULT_SETTINGS.history.tankedSkillBreakdown,
      ),
    },
  },
  // persisted app metadata (tracks which app version the user last saw)
  appVersion: createSettingsStore("appVersion", { value: "" }),
  packetCapture: createSettingsStore(
    "packetCapture",
    { npcapDevice: "" },
  ),
};

// Create flattened settings object for backwards compatibility
export const settings = {
  get state() {
    return {
      accessibility: SETTINGS.accessibility.state,
      shortcuts: SETTINGS.shortcuts.state,
      moduleSync: SETTINGS.moduleSync.state,
      moduleCalc: SETTINGS.moduleCalc.state,
      skillMonitor: SETTINGS.skillMonitor.state,
      profileLibrary: SETTINGS.profileLibrary.state,
      customTriggers: SETTINGS.customTriggers.state,
      monsterMonitor: SETTINGS.monsterMonitor.state,
      trainingDummy: SETTINGS.trainingDummy.state,
      appBehavior: SETTINGS.appBehavior.state,
      live: {
        general: SETTINGS.live.general.state,
        dps: {
          players: SETTINGS.live.dps.players.state,
          skillBreakdown: SETTINGS.live.dps.skillBreakdown.state,
        },
        heal: {
          players: SETTINGS.live.heal.players.state,
          skillBreakdown: SETTINGS.live.heal.skillBreakdown.state,
        },
        tanked: {
          players: SETTINGS.live.tanked.players.state,
          skills: SETTINGS.live.tanked.skills.state,
        },
        tableCustomization: SETTINGS.live.tableCustomization.state,
        dynamicWindow: SETTINGS.live.dynamicWindow.state,
        headerCustomization: SETTINGS.live.headerCustomization.state,
        columnOrder: {
          dpsPlayers: SETTINGS.live.columnOrder.dpsPlayers.state,
          dpsSkills: SETTINGS.live.columnOrder.dpsSkills.state,
          healPlayers: SETTINGS.live.columnOrder.healPlayers.state,
          healSkills: SETTINGS.live.columnOrder.healSkills.state,
          tankedPlayers: SETTINGS.live.columnOrder.tankedPlayers.state,
          tankedSkills: SETTINGS.live.columnOrder.tankedSkills.state,
        },
        sorting: {
          dpsPlayers: SETTINGS.live.sorting.dpsPlayers.state,
          dpsSkills: SETTINGS.live.sorting.dpsSkills.state,
          healPlayers: SETTINGS.live.sorting.healPlayers.state,
          healSkills: SETTINGS.live.sorting.healSkills.state,
          tankedPlayers: SETTINGS.live.sorting.tankedPlayers.state,
          tankedSkills: SETTINGS.live.sorting.tankedSkills.state,
        },
      },
      appVersion: SETTINGS.appVersion.state,
      history: {
        general: SETTINGS.history.general.state,
        dps: {
          players: SETTINGS.history.dps.players.state,
          skillBreakdown: SETTINGS.history.dps.skillBreakdown.state,
        },
        heal: {
          players: SETTINGS.history.heal.players.state,
          skillBreakdown: SETTINGS.history.heal.skillBreakdown.state,
        },
        tanked: {
          players: SETTINGS.history.tanked.players.state,
          skillBreakdown: SETTINGS.history.tanked.skillBreakdown.state,
        },
      },
    };
  },
};



export function normalizePersistedSettings(): void {
  Object.assign(
    SETTINGS.skillMonitor.state,
    normalizeSkillMonitorSettingsState(SETTINGS.skillMonitor.state),
  );
  Object.assign(
    SETTINGS.profileLibrary.state,
    normalizeProfileLibrarySettingsState(SETTINGS.profileLibrary.state),
  );
  Object.assign(
    SETTINGS.monsterMonitor.state,
    normalizeMonsterMonitorSettingsState(SETTINGS.monsterMonitor.state),
  );
  Object.assign(
    SETTINGS.trainingDummy.state,
    normalizeObjectWithDefaults(SETTINGS.trainingDummy.state, DEFAULT_SETTINGS.trainingDummy),
  );
  Object.assign(
    SETTINGS.appBehavior.state,
    normalizeObjectWithDefaults(SETTINGS.appBehavior.state, DEFAULT_SETTINGS.appBehavior),
  );
  Object.assign(
    SETTINGS.live.general.state,
    normalizeObjectWithDefaults(SETTINGS.live.general.state, DEFAULT_SETTINGS.live.general),
  );
  Object.assign(
    SETTINGS.live.tableCustomization.state,
    normalizeObjectWithDefaults(
      SETTINGS.live.tableCustomization.state,
      DEFAULT_SETTINGS.live.tableCustomization,
    ),
  );
  Object.assign(
    SETTINGS.live.dynamicWindow.state,
    normalizeObjectWithDefaults(
      SETTINGS.live.dynamicWindow.state,
      DEFAULT_SETTINGS.live.dynamicWindow,
    ),
  );
  Object.assign(
    SETTINGS.live.headerCustomization.state,
    normalizeObjectWithDefaults(
      SETTINGS.live.headerCustomization.state,
      DEFAULT_SETTINGS.live.headerCustomization,
    ),
  );
  Object.assign(
    SETTINGS.live.dps.players.state,
    normalizeObjectWithDefaults(SETTINGS.live.dps.players.state, DEFAULT_SETTINGS.live.dpsPlayers),
  );
  Object.assign(
    SETTINGS.live.dps.skillBreakdown.state,
    normalizeObjectWithDefaults(
      SETTINGS.live.dps.skillBreakdown.state,
      DEFAULT_SETTINGS.live.dpsSkillBreakdown,
    ),
  );
  Object.assign(
    SETTINGS.live.heal.players.state,
    normalizeObjectWithDefaults(SETTINGS.live.heal.players.state, DEFAULT_SETTINGS.live.healPlayers),
  );
  Object.assign(
    SETTINGS.live.heal.skillBreakdown.state,
    normalizeObjectWithDefaults(
      SETTINGS.live.heal.skillBreakdown.state,
      DEFAULT_SETTINGS.live.healSkillBreakdown,
    ),
  );
  Object.assign(
    SETTINGS.live.tanked.players.state,
    normalizeObjectWithDefaults(
      SETTINGS.live.tanked.players.state,
      DEFAULT_SETTINGS.live.tankedPlayers,
    ),
  );
  Object.assign(
    SETTINGS.live.tanked.skills.state,
    normalizeObjectWithDefaults(
      SETTINGS.live.tanked.skills.state,
      DEFAULT_SETTINGS.live.tankedSkillBreakdown,
    ),
  );
  Object.assign(
    SETTINGS.history.general.state,
    normalizeObjectWithDefaults(SETTINGS.history.general.state, DEFAULT_SETTINGS.history.general),
  );
  Object.assign(
    SETTINGS.history.dps.players.state,
    normalizeObjectWithDefaults(
      SETTINGS.history.dps.players.state,
      DEFAULT_SETTINGS.history.dpsPlayers,
    ),
  );
  Object.assign(
    SETTINGS.history.dps.skillBreakdown.state,
    normalizeObjectWithDefaults(
      SETTINGS.history.dps.skillBreakdown.state,
      DEFAULT_SETTINGS.history.dpsSkillBreakdown,
    ),
  );
  Object.assign(
    SETTINGS.history.heal.players.state,
    normalizeObjectWithDefaults(
      SETTINGS.history.heal.players.state,
      DEFAULT_SETTINGS.history.healPlayers,
    ),
  );
  Object.assign(
    SETTINGS.history.heal.skillBreakdown.state,
    normalizeObjectWithDefaults(
      SETTINGS.history.heal.skillBreakdown.state,
      DEFAULT_SETTINGS.history.healSkillBreakdown,
    ),
  );
  Object.assign(
    SETTINGS.history.tanked.players.state,
    normalizeObjectWithDefaults(
      SETTINGS.history.tanked.players.state,
      DEFAULT_SETTINGS.history.tankedPlayers,
    ),
  );
  Object.assign(
    SETTINGS.history.tanked.skillBreakdown.state,
    normalizeObjectWithDefaults(
      SETTINGS.history.tanked.skillBreakdown.state,
      DEFAULT_SETTINGS.history.tankedSkillBreakdown,
    ),
  );

  normalizeColumnOrder(SETTINGS.live.columnOrder.dpsPlayers.state, DEFAULT_DPS_PLAYER_COLUMN_ORDER);
  normalizeColumnOrder(SETTINGS.live.columnOrder.dpsSkills.state, DEFAULT_DPS_SKILL_COLUMN_ORDER);
  normalizeColumnOrder(SETTINGS.live.columnOrder.healPlayers.state, DEFAULT_HEAL_PLAYER_COLUMN_ORDER);
  normalizeColumnOrder(SETTINGS.live.columnOrder.healSkills.state, DEFAULT_HEAL_SKILL_COLUMN_ORDER);
  normalizeColumnOrder(SETTINGS.live.columnOrder.tankedPlayers.state, DEFAULT_TANKED_PLAYER_COLUMN_ORDER);
  normalizeColumnOrder(SETTINGS.live.columnOrder.tankedSkills.state, DEFAULT_TANKED_SKILL_COLUMN_ORDER);

  const appMetadata = SETTINGS.appVersion.state as MutableRecord;
  if (appMetadata["modifierReportsResetVersion"] !== MODIFIER_REPORTS_RESET_VERSION) {
    SETTINGS.live.general.state.modifierReportsEnabled = false;
    appMetadata["modifierReportsResetVersion"] = MODIFIER_REPORTS_RESET_VERSION;
  }
}

normalizePersistedSettings();

// Accessibility helpers

// Theme selection removed — app uses only the `custom` theme controlled by customThemeColors
