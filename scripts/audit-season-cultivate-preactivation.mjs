#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const EXPORT_DIR = path.join(ROOT, "DEV_exports");
const EXPECTED_FACTOR_RULE_ID_BASE = 900_000_000;
const TWIN_AXE_CLASS_LABEL_KEY = "class.Flame Berserker";
const TWIN_AXE_FACTOR_TYPE_LABELS = {
  en: { reality: "Reality Factor", stasis: "Stasis", rhapsody: "Rhapsody", polarity: "Polarity" },
  "zh-CN": { reality: "真实因子", stasis: "稳态", rhapsody: "狂想", polarity: "极性" },
  "zh-TW": { reality: "真實因子", stasis: "穩態", rhapsody: "狂想", polarity: "極性" },
  ja: { reality: "実像因子", stasis: "恒常性", rhapsody: "狂想", polarity: "極性" },
  "ko-KR": { reality: "진실 인자", stasis: "안정", rhapsody: "광상", polarity: "극성" },
  fr: { reality: "Facteur de réalité", stasis: "Stase", rhapsody: "Rhapsodie", polarity: "Polarité" },
  de: { reality: "Realitätsfaktor", stasis: "Stase", rhapsody: "Rhapsodie", polarity: "Polarität" },
  es: { reality: "Factor de Realidad", stasis: "Estasis", rhapsody: "Rapsodia", polarity: "Polaridad" },
  "pt-BR": { reality: "Fator de Realidade", stasis: "Estase", rhapsody: "Rapsódia", polarity: "Polaridade" },
  th: { reality: "Reality Factor", stasis: "Stasis", rhapsody: "Rhapsody", polarity: "Polarity" },
  id: { reality: "Reality Factor", stasis: "Stasis", rhapsody: "Rhapsody", polarity: "Polarity" },
};

const LOCALE_KEYS = [
  "customPanel.newFactor",
  "customPanel.factorSlots.title",
  "customPanel.factorSlots.description",
  "customPanel.factorSlots.currentList",
  "customPanel.factorSlots.searchTitle",
  "customPanel.factorSlots.searchPlaceholder",
  "customPanel.factorSlots.noMatch",
  "customPanel.factorSlots.defaultName",
  "customPanel.factorSlots.customNamePlaceholder",
  "customPanel.factorSlots.clear",
];

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

function asArray(value) {
  return Array.isArray(value) ? value : Object.values(value ?? {});
}

function uniqueSortedNumbers(values) {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function normalizeItemIds(value) {
  if (!Array.isArray(value)) return [];
  return uniqueSortedNumbers(
    value
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0),
  );
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function buildFactorIndexes() {
  const factorData = readJson("parser-data/generated/SeasonPhantomFactors.json");
  const rows = asArray(factorData.factorsByBuffId);
  const byGradeItemId = new Map();
  const byBuffId = new Map();

  for (const row of rows) {
    const buffId = Number(row.buffId);
    if (Number.isInteger(buffId) && buffId > 0) {
      byBuffId.set(buffId, row);
    }
    for (const itemId of normalizeItemIds(row.gradeItemIds)) {
      byGradeItemId.set(itemId, row);
    }
  }

  return { byBuffId, byGradeItemId };
}

function resolveFactorRows(template, indexes) {
  const itemRows = new Set();
  for (const itemId of normalizeItemIds(template.itemIds)) {
    const row = indexes.byGradeItemId.get(itemId);
    if (row) itemRows.add(row);
  }

  if (itemRows.size > 0) {
    return Array.from(itemRows);
  }

  const buffRows = new Set();
  for (const buffId of normalizeItemIds(template.effectBuffIds)) {
    const row = indexes.byBuffId.get(buffId);
    if (row) buffRows.add(row);
  }
  return Array.from(buffRows);
}

function getFactorLocaleText(row, mapName, locale) {
  const value = cleanText(row?.[mapName]?.[locale]);
  return value || null;
}

function getLocaleText(map, locale) {
  return cleanText(map?.[locale]) || cleanText(map?.en) || null;
}

function isTwinAxeFactor(row) {
  const englishName = cleanText(row?.familyNames?.en) || cleanText(row?.familyName);
  return /\b(?:Twin Striker|Flame Berserker)\b/i.test(englishName);
}

function getTwinAxeFactorKind(row) {
  const englishName = cleanText(row?.familyNames?.en) || cleanText(row?.familyName);
  if (/\bReality Factor\b/i.test(englishName)) return "reality";
  if (/\bStasis\b/i.test(englishName)) return "stasis";
  if (/\bRhapsody\b/i.test(englishName)) return "rhapsody";
  if (/\bPolarity\b/i.test(englishName)) return "polarity";
  return "";
}

function getTwinAxeSlot(row) {
  const englishName = cleanText(row?.familyNames?.en) || cleanText(row?.familyName);
  return englishName.match(/\bX\d+\b/i)?.[0]?.toUpperCase() ?? "";
}

function joinTwinAxeName(locale, className, factorKind, slot) {
  const typeLabel = factorKind
    ? TWIN_AXE_FACTOR_TYPE_LABELS[locale]?.[factorKind] ?? TWIN_AXE_FACTOR_TYPE_LABELS.en[factorKind]
    : "";

  if (!slot) return [className, typeLabel].filter(Boolean).join(" ");
  if (!typeLabel) return `${className} ${slot}`;
  if (locale === "zh-CN" || locale === "zh-TW") return `${className}${typeLabel}${slot}`;
  if (locale === "ja") return `${className}・${typeLabel}${slot}`;
  if (locale === "ko-KR") return `${className} ${typeLabel}${slot}`;
  return `${className} ${typeLabel} ${slot}`;
}

function getDisplayFamilyName(row, locale, classLabels) {
  const rawName = getFactorLocaleText(row, "familyNames", locale);
  if (!rawName || !isTwinAxeFactor(row)) return rawName;

  const className = getLocaleText(classLabels?.[TWIN_AXE_CLASS_LABEL_KEY], locale) || "Twin Striker";
  return joinTwinAxeName(locale, className, getTwinAxeFactorKind(row), getTwinAxeSlot(row)) || rawName;
}

function buildExpectedTemplateLocaleEntries(locale) {
  const indexes = buildFactorIndexes();
  const classLabels = readJson("parser-data/generated/class-labels.json");
  const sourceTemplates = asArray(
    readJson("parser-data/app-rules/counter_source_templates.json"),
  );
  const slotTemplates = asArray(
    readJson("parser-data/app-rules/counter_slot_templates.json"),
  );
  const entries = new Map();
  const bridgeIssues = [];

  for (const template of sourceTemplates) {
    const rows = resolveFactorRows(template, indexes);
    if (rows.length !== 1) {
      bridgeIssues.push({
        templateType: "source",
        templateId: template.sourceId ?? null,
        issue: `expected 1 factor bridge, found ${rows.length}`,
      });
      continue;
    }
    const row = rows[0];
    const name = getDisplayFamilyName(row, locale, classLabels);
    const description = getFactorLocaleText(row, "cleanDescriptions", locale);
    if (!name || !description) {
      bridgeIssues.push({
        templateType: "source",
        templateId: template.sourceId ?? null,
        factorBuffId: row.buffId ?? null,
        issue: `missing generated factor locale text for ${locale}`,
      });
      continue;
    }
    entries.set(`sourceTemplate.${template.sourceId}.name`, name);
    entries.set(`sourceTemplate.${template.sourceId}.description`, description);
  }

  for (const template of slotTemplates) {
    const rows = resolveFactorRows(template, indexes);
    if (rows.length !== 1) {
      bridgeIssues.push({
        templateType: "slot",
        templateId: template.slotTemplateId ?? null,
        issue: `expected 1 factor bridge, found ${rows.length}`,
      });
      continue;
    }
    const row = rows[0];
    const name = getDisplayFamilyName(row, locale, classLabels);
    const description = getFactorLocaleText(row, "cleanDescriptions", locale);
    if (!name || !description) {
      bridgeIssues.push({
        templateType: "slot",
        templateId: template.slotTemplateId ?? null,
        factorBuffId: row.buffId ?? null,
        issue: `missing generated factor locale text for ${locale}`,
      });
      continue;
    }
    entries.set(`slotTemplate.${template.slotTemplateId}.name`, name);
    entries.set(`slotTemplate.${template.slotTemplateId}.description`, description);
  }

  return { entries, bridgeIssues };
}

function hasDuplicateNumbers(value) {
  if (!Array.isArray(value)) return false;
  const seen = new Set();
  for (const item of value) {
    if (seen.has(item)) return true;
    seen.add(item);
  }
  return false;
}

function extractNumberConstant(text, name) {
  const match = text.match(new RegExp(`const\\s+${name}\\s*:?\\s*[^=]*=\\s*([0-9_]+)`));
  return match ? Number(match[1].replaceAll("_", "")) : null;
}

function collectTemplateAudit() {
  const sourceTemplates = asArray(
    readJson("parser-data/app-rules/counter_source_templates.json"),
  );
  const slotTemplates = asArray(
    readJson("parser-data/app-rules/counter_slot_templates.json"),
  );

  const sourceIssues = [];
  const slotIssues = [];
  const sourceItemIds = [];
  const slotItemIds = [];
  const effectBuffIds = [];

  for (const row of sourceTemplates) {
    const itemIds = normalizeItemIds(row.itemIds);
    sourceItemIds.push(...itemIds);
    if (typeof row.sourceId !== "string" || row.sourceId.trim() === "") {
      sourceIssues.push({ sourceId: row.sourceId ?? null, issue: "missing sourceId" });
    }
    if (itemIds.length === 0) {
      sourceIssues.push({ sourceId: row.sourceId ?? null, issue: "missing itemIds" });
    }
    if (hasDuplicateNumbers(row.itemIds)) {
      sourceIssues.push({ sourceId: row.sourceId ?? null, issue: "duplicate itemIds" });
    }
    if (!row.source || typeof row.source !== "object") {
      sourceIssues.push({ sourceId: row.sourceId ?? null, issue: "missing source config" });
    }
  }

  for (const row of slotTemplates) {
    const itemIds = normalizeItemIds(row.itemIds);
    const buffs = normalizeItemIds(row.effectBuffIds);
    slotItemIds.push(...itemIds);
    effectBuffIds.push(...buffs);
    if (typeof row.slotTemplateId !== "string" || row.slotTemplateId.trim() === "") {
      slotIssues.push({
        slotTemplateId: row.slotTemplateId ?? null,
        issue: "missing slotTemplateId",
      });
    }
    if (itemIds.length === 0) {
      slotIssues.push({
        slotTemplateId: row.slotTemplateId ?? null,
        issue: "missing itemIds",
      });
    }
    if (buffs.length === 0) {
      slotIssues.push({
        slotTemplateId: row.slotTemplateId ?? null,
        issue: "missing effectBuffIds",
      });
    }
    if (hasDuplicateNumbers(row.itemIds)) {
      slotIssues.push({
        slotTemplateId: row.slotTemplateId ?? null,
        issue: "duplicate itemIds",
      });
    }
    if (hasDuplicateNumbers(row.effectBuffIds)) {
      slotIssues.push({
        slotTemplateId: row.slotTemplateId ?? null,
        issue: "duplicate effectBuffIds",
      });
    }
    if (!row.slot || typeof row.slot !== "object") {
      slotIssues.push({
        slotTemplateId: row.slotTemplateId ?? null,
        issue: "missing slot config",
      });
    }
  }

  const uniqueSlotItemIds = uniqueSortedNumbers(slotItemIds);
  return {
    sourceTemplates: sourceTemplates.length,
    slotTemplates: slotTemplates.length,
    factorTemplates: sourceTemplates.length + slotTemplates.length,
    sourceTemplatesWithItemIds: sourceTemplates.filter(
      (row) => normalizeItemIds(row.itemIds).length > 0,
    ).length,
    slotTemplatesWithItemIds: slotTemplates.filter(
      (row) => normalizeItemIds(row.itemIds).length > 0,
    ).length,
    slotTemplatesWithEffectBuffIds: slotTemplates.filter(
      (row) => normalizeItemIds(row.effectBuffIds).length > 0,
    ).length,
    uniqueSourceItemIds: uniqueSortedNumbers(sourceItemIds).length,
    uniqueSlotItemIds: uniqueSlotItemIds.length,
    uniqueEffectBuffIds: uniqueSortedNumbers(effectBuffIds).length,
    minFactorRuleId:
      uniqueSlotItemIds.length > 0
        ? EXPECTED_FACTOR_RULE_ID_BASE + uniqueSlotItemIds[0]
        : null,
    maxFactorRuleId:
      uniqueSlotItemIds.length > 0
        ? EXPECTED_FACTOR_RULE_ID_BASE + uniqueSlotItemIds.at(-1)
        : null,
    sourceIssues,
    slotIssues,
  };
}

function collectSourceBoundaryAudit() {
  const rustSeasonCultivate = readText("src-tauri/src/live/season_cultivate.rs");
  const skillMappings = readText("src/lib/skill-mappings.ts");
  const runtimeSync = readText("src/lib/runtime-monitor-sync.ts");
  const api = readText("src/lib/api.ts");
  const eventManager = readText("src-tauri/src/live/event_manager.rs");
  const liveMain = readText("src-tauri/src/live/live_main.rs");
  const commandsModels = readText("src-tauri/src/live/commands_models.rs");
  const state = readText("src-tauri/src/live/state.rs");
  const tabCustomPanel = readText("src/routes/main/skill-monitor/tab-custom-panel.svelte");
  const overlayEvents = readText("src/routes/game-overlay/overlay-events.svelte.ts");
  const overlayDisplay = readText("src/routes/game-overlay/overlay-display.svelte.ts");

  const emptyTemplateReturns = [
    ...runtimeSync.matchAll(/seasonCultivateFactorTemplates:\s*\[\]/g),
  ].length;
  const importsFactorTemplates = runtimeSync.includes(
    "getSeasonCultivateFactorTemplates",
  );
  const hasGroupGate =
    runtimeSync.includes("hasSeasonCultivateFactorGroup") &&
    runtimeSync.includes('group.kind === "seasonCultivateFactor"') &&
    runtimeSync.includes("? getSeasonCultivateFactorTemplates()") &&
    runtimeSync.includes(": []");
  const activationMode =
    importsFactorTemplates && hasGroupGate
      ? "guarded"
      : importsFactorTemplates
        ? "unsafe"
        : "inactive";
  const backendEventPlumbingPresent =
    eventManager.includes("SeasonCultivateFactorCounterUpdate") &&
    liveMain.includes("season-cultivate-factor-counter-update") &&
    commandsModels.includes("SeasonCultivateFactorCounterUpdate");
  const backendStateEmitterRefs = [
    ...state.matchAll(/emit_season_cultivate_factor_counter_update\(/g),
  ].length;
  const backendStateEmitterActive = backendStateEmitterRefs > 1;
  const frontendApiEventPresent = api.includes(
    "season-cultivate-factor-counter-update",
  );
  const overlayEventListenerActive = overlayEvents.includes(
    "onSeasonCultivateFactorCounterUpdate",
  );
  const overlayRenderActive =
    overlayDisplay.includes("seasonCultivateFactorSlotItemIds") ||
    overlayDisplay.includes("factorCounterMap()");
  const visibleCustomPanelUiInactive = !tabCustomPanel.includes(
    "seasonCultivateFactor",
  );
  const eventMode =
    overlayEventListenerActive && overlayRenderActive
      ? visibleCustomPanelUiInactive
        ? "overlay-render-hidden"
        : "active"
      : overlayEventListenerActive
        ? "overlay-listener"
      : backendStateEmitterActive
        ? "backend-active"
        : backendEventPlumbingPresent || frontendApiEventPresent
        ? "dormant"
        : "inactive";

  return {
    rustFactorRuleIdBase: extractNumberConstant(
      rustSeasonCultivate,
      "FACTOR_RULE_ID_BASE",
    ),
    tsFactorRuleIdBase: extractNumberConstant(skillMappings, "FACTOR_RULE_ID_BASE"),
    runtimeSyncTemplateActivationMode: activationMode,
    runtimeSyncDisabledSkillClearsTemplates: emptyTemplateReturns >= 1,
    runtimeSyncEmptyTemplateReturnCount: emptyTemplateReturns,
    runtimeSyncFiltersManualCustomPanelEntries: runtimeSync.includes(
      '(group.kind ?? "manual") === "manual"',
    ),
    eventMode,
    frontendApiEventPresent,
    backendEventPlumbingPresent,
    backendStateEmitterRefs,
    backendStateEmitterActive,
    overlayEventListenerActive,
    overlayRenderActive,
    overlayFactorEffectBuffLabelResolverPresent:
      overlayDisplay.includes("getSeasonCultivateFactorEffectBuffLabelMap") &&
      overlayDisplay.includes("resolveFactorBuffName"),
    overlayFactorSkillLabelResolverPresent:
      overlayDisplay.includes("resolveSeasonCultivateSourceSkillLabel") &&
      overlayDisplay.includes("resolveSeasonCultivateSlotSkillLabel"),
    visibleCustomPanelUiInactive,
    skillMappingHelpersPresent: [
      "getSeasonCultivateFactorRuleId",
      "getSeasonCultivateFactorTemplates",
      "getSeasonCultivateFactorRuleMap",
      "getSeasonCultivateFactorItemSlotTemplateMap",
      "getSeasonCultivateFactorEffectBuffIdMap",
      "getSeasonCultivateFactorEffectBuffLabelMap",
      "getSeasonCultivateFactorConfiguredEffectBuffIds",
      "resolveSeasonCultivateSourceSkillLabel",
      "resolveSeasonCultivateSlotSkillLabel",
    ].filter((token) => skillMappings.includes(token)),
  };
}

function collectSettingsAudit() {
  const settingsStore = readText("src/lib/settings-store.ts");
  const customPanelUtils = readText("src/lib/custom-panel-utils.ts");
  const mainSkillMonitor = readText("src/routes/main/skill-monitor/+page.svelte");

  return {
    hasSeasonCultivateGroupKind: settingsStore.includes(
      '"seasonCultivateFactor"',
    ),
    hasFactorSlotLabels: settingsStore.includes("factorSlotLabels"),
    defaultCustomPanelGroupIsManual:
      settingsStore.includes('kind: CustomPanelGroupKind = "manual"') &&
      settingsStore.includes("kind,"),
    sharedNormalizerPreservesSeasonCultivate:
      customPanelUtils.includes('kind === "seasonCultivateFactor"') &&
      customPanelUtils.includes('kind: "manual"'),
    mainNormalizerPreservesSeasonCultivate:
      mainSkillMonitor.includes('group.kind === "seasonCultivateFactor"') &&
      mainSkillMonitor.includes('kind: "manual"'),
  };
}

function collectLocaleAudit() {
  const localeRoot = path.join(ROOT, "src/lib/locales");
  return fs
    .readdirSync(localeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const { entries: expectedTemplateEntries, bridgeIssues } =
        buildExpectedTemplateLocaleEntries(entry.name);
      const relPath = path.join(
        "src/lib/locales",
        entry.name,
        "ui/overlay/skill-monitor/custom-panel.json",
      );
      const data = readJson(relPath);
      const missing = LOCALE_KEYS.filter((key) => !Object.hasOwn(data, key));
      const missingTemplateKeys = [];
      const mismatchedTemplateKeys = [];

      for (const [key, expected] of expectedTemplateEntries) {
        if (!Object.hasOwn(data, key)) {
          missingTemplateKeys.push(key);
          continue;
        }
        if (cleanText(data[key]) !== expected) {
          mismatchedTemplateKeys.push({
            key,
            expected,
            actual: cleanText(data[key]),
          });
        }
      }

      return {
        locale: entry.name,
        missing,
        missingTemplateKeys,
        mismatchedTemplateKeys,
        templateBridgeIssues: bridgeIssues,
      };
    })
    .sort((left, right) => left.locale.localeCompare(right.locale));
}

function collectFactorSkillLabelAudit() {
  const sourceTemplates = asArray(
    readJson("parser-data/app-rules/counter_source_templates.json"),
  );
  const slotTemplates = asArray(
    readJson("parser-data/app-rules/counter_slot_templates.json"),
  );
  const enPanel = readJson(
    "src/lib/locales/en/ui/overlay/skill-monitor/custom-panel.json",
  );
  const bridge = readJson(
    "parser-data/app-rules/season_cultivate_factor_skill_labels.json",
  );
  const sourceEntries = bridge.sources ?? {};
  const slotEntries = bridge.slots ?? {};
  const realitySlotTemplates = slotTemplates.filter((template) => {
    const name = cleanText(
      enPanel[`slotTemplate.${template.slotTemplateId}.name`] ?? template.name,
    );
    return /\bReality Factor\b/i.test(name);
  });
  const hasLabel = (entry) => cleanText(entry?.label?.en).length > 0;

  return {
    version: bridge.version ?? null,
    sourceTemplates: sourceTemplates.length,
    sourceLabels: Object.keys(sourceEntries).length,
    realitySlotTemplates: realitySlotTemplates.length,
    realitySlotLabels: Object.keys(slotEntries).length,
    missingSourceLabels: sourceTemplates
      .filter((template) => !hasLabel(sourceEntries[template.sourceId]))
      .map((template) => template.sourceId),
    missingRealitySlotLabels: realitySlotTemplates
      .filter((template) => !hasLabel(slotEntries[template.slotTemplateId]))
      .map((template) => template.slotTemplateId),
  };
}

function collectErrors(report) {
  const errors = [];
  if (report.templates.sourceIssues.length > 0) {
    errors.push("counter source template issues found");
  }
  if (report.templates.slotIssues.length > 0) {
    errors.push("counter slot template issues found");
  }
  if (report.boundary.rustFactorRuleIdBase !== EXPECTED_FACTOR_RULE_ID_BASE) {
    errors.push("Rust factor rule base does not match expected base");
  }
  if (report.boundary.tsFactorRuleIdBase !== EXPECTED_FACTOR_RULE_ID_BASE) {
    errors.push("TypeScript factor rule base does not match expected base");
  }
  if (report.boundary.rustFactorRuleIdBase !== report.boundary.tsFactorRuleIdBase) {
    errors.push("Rust and TypeScript factor rule bases differ");
  }
  if (!["inactive", "guarded"].includes(report.boundary.runtimeSyncTemplateActivationMode)) {
    errors.push("runtime-monitor sync factor template activation is not safely gated");
  }
  if (!report.boundary.runtimeSyncDisabledSkillClearsTemplates) {
    errors.push("disabled skill monitor no longer clears factor templates");
  }
  if (!report.boundary.runtimeSyncFiltersManualCustomPanelEntries) {
    errors.push("runtime-monitor sync does not filter manual custom-panel entries");
  }
  if (!["inactive", "dormant", "backend-active", "overlay-listener", "overlay-render-hidden", "active"].includes(report.boundary.eventMode)) {
    errors.push("factor event stream is in an unknown activation mode");
  }
  if (report.boundary.skillMappingHelpersPresent.length !== 9) {
    errors.push("missing inert skill-mappings factor helpers");
  }
  if (!report.boundary.overlayFactorEffectBuffLabelResolverPresent) {
    errors.push("overlay factor effect buff labels are not resolved through factor templates");
  }
  if (!report.boundary.overlayFactorSkillLabelResolverPresent) {
    errors.push("overlay factor skill labels are not resolved through generated factor label bridge");
  }
  if (report.factorSkillLabels.missingSourceLabels.length > 0) {
    errors.push("factor skill label bridge is missing source labels");
  }
  if (report.factorSkillLabels.missingRealitySlotLabels.length > 0) {
    errors.push("factor skill label bridge is missing Reality slot labels");
  }
  for (const [key, value] of Object.entries(report.settings)) {
    if (!value) errors.push(`settings guard failed: ${key}`);
  }
  const localeGaps = report.locales.filter((locale) => locale.missing.length > 0);
  if (localeGaps.length > 0) {
    errors.push("locale gaps found for New Factor keys");
  }
  const templateLocaleGaps = report.locales.filter(
    (locale) => locale.missingTemplateKeys.length > 0,
  );
  if (templateLocaleGaps.length > 0) {
    errors.push("locale gaps found for counter template keys");
  }
  const templateLocaleMismatches = report.locales.filter(
    (locale) => locale.mismatchedTemplateKeys.length > 0,
  );
  if (templateLocaleMismatches.length > 0) {
    errors.push("counter template locale values do not match generated factor localization");
  }
  const templateBridgeIssues = report.locales.filter(
    (locale) => locale.templateBridgeIssues.length > 0,
  );
  if (templateBridgeIssues.length > 0) {
    errors.push("counter template factor locale bridge issues found");
  }
  return errors;
}

function writeReport(report) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const jsonPath = path.join(EXPORT_DIR, "season-cultivate-preactivation-audit.json");
  const mdPath = path.join(EXPORT_DIR, "season-cultivate-preactivation-audit.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  const lines = [];
  lines.push("# Season Cultivate Activation Boundary Audit");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push(`Status: ${report.errors.length === 0 ? "pass" : "fail"}`);
  lines.push("");
  lines.push("## Template Data");
  lines.push("");
  lines.push(`- Source templates: ${report.templates.sourceTemplates}`);
  lines.push(`- Slot templates: ${report.templates.slotTemplates}`);
  lines.push(`- Factor templates if activated: ${report.templates.factorTemplates}`);
  lines.push(`- Unique source item IDs: ${report.templates.uniqueSourceItemIds}`);
  lines.push(`- Unique slot item IDs: ${report.templates.uniqueSlotItemIds}`);
  lines.push(`- Unique effect buff IDs: ${report.templates.uniqueEffectBuffIds}`);
  lines.push(`- Factor rule ID range: ${report.templates.minFactorRuleId ?? "-"} to ${report.templates.maxFactorRuleId ?? "-"}`);
  lines.push("");
  lines.push("## Activation Boundary");
  lines.push("");
  lines.push(`- Rust factor rule base: ${report.boundary.rustFactorRuleIdBase}`);
  lines.push(`- TypeScript factor rule base: ${report.boundary.tsFactorRuleIdBase}`);
  lines.push(`- Runtime sync template activation mode: ${report.boundary.runtimeSyncTemplateActivationMode}`);
  lines.push(`- Disabled skill monitor clears factor templates: ${report.boundary.runtimeSyncDisabledSkillClearsTemplates ? "yes" : "no"}`);
  lines.push(`- Runtime sync filters custom-panel entries to manual groups: ${report.boundary.runtimeSyncFiltersManualCustomPanelEntries ? "yes" : "no"}`);
  lines.push(`- Factor event mode: ${report.boundary.eventMode}`);
  lines.push(`- Frontend API event type present: ${report.boundary.frontendApiEventPresent ? "yes" : "no"}`);
  lines.push(`- Backend event plumbing present: ${report.boundary.backendEventPlumbingPresent ? "yes" : "no"}`);
  lines.push(`- Backend state emitter active: ${report.boundary.backendStateEmitterActive ? "yes" : "no"}`);
  lines.push(`- Backend state emitter references: ${report.boundary.backendStateEmitterRefs}`);
  lines.push(`- Overlay factor event listener active: ${report.boundary.overlayEventListenerActive ? "yes" : "no"}`);
  lines.push(`- Overlay factor rendering active: ${report.boundary.overlayRenderActive ? "yes" : "no"}`);
  lines.push(`- Overlay factor effect buff label resolver present: ${report.boundary.overlayFactorEffectBuffLabelResolverPresent ? "yes" : "no"}`);
  lines.push(`- Overlay factor skill label resolver present: ${report.boundary.overlayFactorSkillLabelResolverPresent ? "yes" : "no"}`);
  lines.push(`- Visible New Factor custom-panel UI active: ${report.boundary.visibleCustomPanelUiInactive ? "no" : "yes"}`);
  lines.push("");
  lines.push("## Factor Skill Labels");
  lines.push("");
  lines.push(`- Bridge version: ${report.factorSkillLabels.version ?? "-"}`);
  lines.push(`- Source labels: ${report.factorSkillLabels.sourceLabels}/${report.factorSkillLabels.sourceTemplates}`);
  lines.push(`- Reality slot labels: ${report.factorSkillLabels.realitySlotLabels}/${report.factorSkillLabels.realitySlotTemplates}`);
  lines.push("");
  lines.push("## Locale Coverage");
  lines.push("");
  lines.push("| Locale | Missing New Factor Keys | Missing Template Keys | Mismatched Template Values | Bridge Issues |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const locale of report.locales) {
    lines.push(`| ${locale.locale} | ${locale.missing.length} | ${locale.missingTemplateKeys.length} | ${locale.mismatchedTemplateKeys.length} | ${locale.templateBridgeIssues.length} |`);
  }
  lines.push("");
  lines.push("## Errors");
  lines.push("");
  if (report.errors.length === 0) {
    lines.push("- None.");
  } else {
    for (const error of report.errors) lines.push(`- ${error}`);
  }
  fs.writeFileSync(mdPath, `${lines.join("\n")}\n`);
  return { jsonPath, mdPath };
}

const report = {
  generatedAt: new Date().toISOString(),
  expectedFactorRuleIdBase: EXPECTED_FACTOR_RULE_ID_BASE,
  templates: collectTemplateAudit(),
  boundary: collectSourceBoundaryAudit(),
  factorSkillLabels: collectFactorSkillLabelAudit(),
  settings: collectSettingsAudit(),
  locales: collectLocaleAudit(),
};
report.errors = collectErrors(report);

const paths = writeReport(report);
console.log(`Wrote ${path.relative(ROOT, paths.mdPath)}`);
console.log(`Wrote ${path.relative(ROOT, paths.jsonPath)}`);

if (report.errors.length > 0) {
  for (const error of report.errors) {
    console.error(`ERROR: ${error}`);
  }
  process.exitCode = 1;
}
