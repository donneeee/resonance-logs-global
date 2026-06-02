#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CN_ROOT =
  process.env.CN_RELEASE_ROOT ??
  path.resolve(ROOT, "..", "resonance-logs-cn-main_0.1.5");
const EXPORT_DIR = path.join(ROOT, "DEV_exports");

const TOKENS = [
  "seasonCultivate",
  "SeasonCultivate",
  "season_cultivate",
  "FactorCounter",
  "factorSlots",
  "newFactor",
];

const FEATURE_FILES = [
  {
    area: "backend",
    path: "src-tauri/src/live/season_cultivate.rs",
    purpose: "New runtime state; active factor item extraction; dynamic factor counter rule generation; dirty-byte merge parser.",
  },
  {
    area: "backend",
    path: "src-tauri/src/live/bootstrap_snapshot.rs",
    purpose: "MonitorRuntimeSnapshot.skill seasonCultivateFactorTemplates payload and normalization.",
  },
  {
    area: "backend",
    path: "src-tauri/src/live/state.rs",
    purpose: "Stores SeasonCultivateRuntimeState, owns factor_counter_tracker, applies SyncContainer full/dirty updates, emits factor counter updates.",
  },
  {
    area: "backend",
    path: "src-tauri/src/live/opcodes_process.rs",
    purpose: "Extracts SeasonCultivateLineData from SyncContainerData and raw dirty bytes from SyncContainerDirtyData.",
  },
  {
    area: "backend",
    path: "src-tauri/src/live/event_manager.rs",
    purpose: "Adds SeasonCultivateFactorCounterUpdate outbound event.",
  },
  {
    area: "backend",
    path: "src-tauri/src/live/live_main.rs",
    purpose: "Emits season-cultivate-factor-counter-update to game overlay.",
  },
  {
    area: "backend",
    path: "src-tauri/src/live/commands_models.rs",
    purpose: "Adds SeasonCultivateFactorCounterUpdatePayload model.",
  },
  {
    area: "backend",
    path: "src-tauri/src/live/mod.rs",
    purpose: "Exports live::season_cultivate module.",
  },
  {
    area: "protobuf",
    path: "src-tauri/src/blueprotobuf-lib/src/blueprotobuf_package.rs",
    purpose: "Adds CharSerialize.season_cultivate_line_data and SeasonCultivateLineData protobuf structs.",
  },
  {
    area: "protobuf",
    path: "src-tauri/src/blueprotobuf-lib/src/blueprotobuf_package.serde.rs",
    purpose: "Serde surface for SeasonCultivateLineData.",
  },
  {
    area: "frontend",
    path: "src/lib/api.ts",
    purpose: "Adds SeasonCultivateFactorCounterUpdatePayload and listener for season-cultivate-factor-counter-update.",
  },
  {
    area: "frontend",
    path: "src/lib/bindings.ts",
    purpose: "Adds FactorCounterTemplate and seasonCultivateFactorTemplates binding fields.",
  },
  {
    area: "frontend",
    path: "src/lib/skill-mappings.ts",
    purpose: "Builds factor templates/rule maps from imported counter source and slot template itemIds/effectBuffIds.",
  },
  {
    area: "frontend",
    path: "src/lib/runtime-monitor-sync.ts",
    purpose: "Sends factor templates only when a custom-panel New Factor group exists; includes needed buff IDs in monitor snapshot.",
  },
  {
    area: "frontend",
    path: "src/lib/settings-store.ts",
    purpose: "Adds CustomPanelGroupKind seasonCultivateFactor and factorSlotLabels profile setting.",
  },
  {
    area: "frontend",
    path: "src/lib/custom-panel-utils.ts",
    purpose: "Normalizes custom panel group kind values.",
  },
  {
    area: "frontend",
    path: "src/routes/main/skill-monitor/tab-custom-panel.svelte",
    purpose: "Adds New Factor group UI and factor display-name editor/search.",
  },
  {
    area: "overlay",
    path: "src/routes/game-overlay/overlay-runtime.svelte.ts",
    purpose: "Stores factor counter map and active source/slot item ids.",
  },
  {
    area: "overlay",
    path: "src/routes/game-overlay/overlay-events.svelte.ts",
    purpose: "Listens for season-cultivate-factor-counter-update.",
  },
  {
    area: "overlay",
    path: "src/routes/game-overlay/overlay-display.svelte.ts",
    purpose: "Renders active factor slot counters and owned effect-buff rows in custom panels.",
  },
  {
    area: "overlay",
    path: "src/routes/monster-overlay/GhostOverlay.svelte",
    purpose: "Counts New Factor group rows during overlay edit/ghost sizing.",
  },
];

const LOCALE_KEY_RE =
  /"((?:skillMonitor\.customPanel\.(?:newFactor|factorSlots\.[^"]+)))"\s*:/g;
const GLOBAL_LOCALE_KEYS = [
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

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileStatus(relPath) {
  const cnPath = path.join(CN_ROOT, relPath);
  const globalPath = path.join(ROOT, relPath);
  const cnText = readText(cnPath);
  const globalText = readText(globalPath);
  return {
    path: relPath,
    cnExists: Boolean(cnText),
    globalExists: Boolean(globalText),
    cnTokenHits: TOKENS.filter((token) => cnText.includes(token)),
    globalTokenHits: TOKENS.filter((token) => globalText.includes(token)),
    cnSize: cnText.length,
    globalSize: globalText.length,
  };
}

function extractCnLocaleKeys() {
  const locales = ["en-US", "ja-JP", "zh-CN"];
  const byLocale = {};
  const allKeys = new Set();
  for (const locale of locales) {
    const text = readText(path.join(CN_ROOT, "src/lib/i18n/messages", `${locale}.ts`));
    const entries = [];
    for (const match of text.matchAll(LOCALE_KEY_RE)) {
      entries.push(match[1]);
      allKeys.add(match[1]);
    }
    byLocale[locale] = entries.sort();
  }
  return { byLocale, allKeys: [...allKeys].sort() };
}

function globalLocaleCoverage(keys) {
  const baseDir = path.join(ROOT, "src/lib/locales");
  const globalKeys = (keys.length ? keys : GLOBAL_LOCALE_KEYS).map((key) =>
    key.replace(/^skillMonitor\./, ""),
  );
  if (!fs.existsSync(baseDir)) return [];
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const locale = entry.name;
      const filePath = path.join(
        baseDir,
        locale,
        "ui/overlay/skill-monitor/custom-panel.json",
      );
      const data = readJson(filePath, {});
      return {
        locale,
        file: path.relative(ROOT, filePath),
        present: globalKeys.filter((key) => Object.hasOwn(data, key)).sort(),
        missing: globalKeys.filter((key) => !Object.hasOwn(data, key)).sort(),
      };
    })
    .sort((left, right) => left.locale.localeCompare(right.locale));
}

function counterTemplateSummary() {
  const sourceTemplates = readJson(
    path.join(ROOT, "parser-data/app-rules/counter_source_templates.json"),
    [],
  );
  const slotTemplates = readJson(
    path.join(ROOT, "parser-data/app-rules/counter_slot_templates.json"),
    [],
  );
  const sources = Array.isArray(sourceTemplates) ? sourceTemplates : Object.values(sourceTemplates);
  const slots = Array.isArray(slotTemplates) ? slotTemplates : Object.values(slotTemplates);
  return {
    sourceTemplates: sources.length,
    sourceTemplatesWithItemIds: sources.filter((row) => row.itemIds?.length).length,
    slotTemplates: slots.length,
    slotTemplatesWithItemIds: slots.filter((row) => row.itemIds?.length).length,
    slotTemplatesWithEffectBuffIds: slots.filter((row) => row.effectBuffIds?.length).length,
    sampleSourceIds: sources
      .filter((row) => row.itemIds?.length)
      .slice(0, 8)
      .map((row) => row.sourceId),
    sampleSlotIds: slots
      .filter((row) => row.itemIds?.length)
      .slice(0, 8)
      .map((row) => row.slotTemplateId),
  };
}

function templateId(row) {
  return row?.sourceId ?? row?.slotTemplateId ?? null;
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function buildFactorIndexes() {
  const factorData = readJson(
    path.join(ROOT, "parser-data/generated/SeasonPhantomFactors.json"),
    {},
  );
  const rows = Object.values(factorData.factorsByBuffId ?? {});
  const byGradeItemId = new Map();
  const byBuffId = new Map();

  for (const row of rows) {
    const buffId = Number(row.buffId);
    if (Number.isInteger(buffId) && buffId > 0) {
      byBuffId.set(buffId, row);
    }
    for (const itemId of normalizeIds(row.gradeItemIds)) {
      byGradeItemId.set(itemId, row);
    }
  }

  return { rows, byGradeItemId, byBuffId, summary: factorData.summary ?? {} };
}

function bridgeIssuesForTemplates(templates, indexes) {
  const issues = [];
  let bridged = 0;

  for (const template of templates) {
    const itemMatches = new Set();
    for (const itemId of normalizeIds(template.itemIds)) {
      const row = indexes.byGradeItemId.get(itemId);
      if (row) itemMatches.add(row);
    }

    const matches = itemMatches.size > 0 ? itemMatches : new Set();
    if (itemMatches.size === 0) {
      for (const buffId of normalizeIds(template.effectBuffIds)) {
        const row = indexes.byBuffId.get(buffId);
        if (row) matches.add(row);
      }
    }

    if (matches.size === 1) {
      bridged += 1;
    } else {
      issues.push({ templateId: templateId(template), factorMatches: matches.size });
    }
  }

  return { bridged, issues };
}

function factorCoverageSummary() {
  const globalSources = readJson(
    path.join(ROOT, "parser-data/app-rules/counter_source_templates.json"),
    [],
  );
  const globalSlots = readJson(
    path.join(ROOT, "parser-data/app-rules/counter_slot_templates.json"),
    [],
  );
  const cnSources = readJson(
    path.join(CN_ROOT, "src/lib/config/counter_source_templates.json"),
    [],
  );
  const cnSlots = readJson(
    path.join(CN_ROOT, "src/lib/config/counter_slot_templates.json"),
    [],
  );

  const globalSourceIds = new Set(globalSources.map(templateId));
  const globalSlotIds = new Set(globalSlots.map(templateId));
  const cnSourceIds = new Set(cnSources.map(templateId));
  const cnSlotIds = new Set(cnSlots.map(templateId));
  const indexes = buildFactorIndexes();
  const sourceBridge = bridgeIssuesForTemplates(globalSources, indexes);
  const slotBridge = bridgeIssuesForTemplates(globalSlots, indexes);
  const probePath = path.join(
    ROOT,
    "..",
    "BPSR-UID-Extractors",
    "output/probing-reports/SeasonPhantomFactorProbe.json",
  );
  const probe = readJson(probePath, {});

  return {
    cnSourceTemplates: cnSources.length,
    globalSourceTemplates: globalSources.length,
    cnSourceMissingInGlobal: [...cnSourceIds].filter((id) => !globalSourceIds.has(id)).sort(),
    globalSourceOnly: [...globalSourceIds].filter((id) => !cnSourceIds.has(id)).sort(),
    cnSlotTemplates: cnSlots.length,
    globalSlotTemplates: globalSlots.length,
    cnSlotMissingInGlobal: [...cnSlotIds].filter((id) => !globalSlotIds.has(id)).sort(),
    globalSlotOnly: [...globalSlotIds].filter((id) => !cnSlotIds.has(id)).sort(),
    generatedFactorRows: indexes.rows.length,
    generatedFactorFamilies: indexes.summary.factorFamilies ?? null,
    rawProbeFamilies: probe.summary?.factorFamilies ?? null,
    sourceTemplatesWithFactorBridge: sourceBridge.bridged,
    sourceTemplateBridgeIssues: sourceBridge.issues,
    slotTemplatesWithFactorBridge: slotBridge.bridged,
    slotTemplateBridgeIssues: slotBridge.issues,
  };
}

function writeReport(report) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const jsonPath = path.join(EXPORT_DIR, "cn-0.1.5-season-cultivate-map.json");
  const mdPath = path.join(EXPORT_DIR, "cn-0.1.5-season-cultivate-map.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  const lines = [];
  lines.push("# CN 0.1.5 New Factor Zone / Season Cultivate Map");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Data Readiness");
  lines.push("");
  lines.push(`- Counter source templates: ${report.counterTemplates.sourceTemplates} total, ${report.counterTemplates.sourceTemplatesWithItemIds} with itemIds.`);
  lines.push(`- Counter slot templates: ${report.counterTemplates.slotTemplates} total, ${report.counterTemplates.slotTemplatesWithItemIds} with itemIds, ${report.counterTemplates.slotTemplatesWithEffectBuffIds} with effectBuffIds.`);
  lines.push(`- CN source templates covered in Global: ${report.factorCoverage.cnSourceTemplates - report.factorCoverage.cnSourceMissingInGlobal.length}/${report.factorCoverage.cnSourceTemplates}.`);
  lines.push(`- CN slot templates covered in Global: ${report.factorCoverage.cnSlotTemplates - report.factorCoverage.cnSlotMissingInGlobal.length}/${report.factorCoverage.cnSlotTemplates}.`);
  lines.push(`- Counter source templates with generated factor bridge: ${report.factorCoverage.sourceTemplatesWithFactorBridge}/${report.factorCoverage.globalSourceTemplates}.`);
  lines.push(`- Counter slot templates with generated factor bridge: ${report.factorCoverage.slotTemplatesWithFactorBridge}/${report.factorCoverage.globalSlotTemplates}.`);
  lines.push(`- Generated active/runtime factor rows: ${report.factorCoverage.generatedFactorRows}; raw game-probe factor families: ${report.factorCoverage.rawProbeFamilies ?? "unknown"}.`);
  lines.push("- Raw probe-only/expired factor families should not be bulk-added unless runtime selection evidence needs them.");
  lines.push("");
  lines.push("## CN Feature Files");
  lines.push("");
  lines.push("| Area | Path | CN | Global | Global token hits | Purpose |");
  lines.push("| --- | --- | ---: | ---: | --- | --- |");
  for (const item of report.files) {
    lines.push(
      `| ${item.area} | \`${item.path}\` | ${item.cnExists ? "yes" : "no"} | ${item.globalExists ? "yes" : "no"} | ${item.globalTokenHits.join(", ") || "-"} | ${item.purpose} |`,
    );
  }
  lines.push("");
  lines.push("## CN Locale Keys");
  lines.push("");
  for (const key of report.localeKeys) {
    lines.push(`- \`${key}\``);
  }
  lines.push("");
  lines.push("## Global Locale Coverage");
  lines.push("");
  lines.push("| Locale | Missing Keys |");
  lines.push("| --- | ---: |");
  for (const locale of report.globalLocaleCoverage) {
    lines.push(`| ${locale.locale} | ${locale.missing.length} |`);
  }
  lines.push("");
  lines.push("## Factor Coverage Issues");
  lines.push("");
  const issueRows = [
    ["CN source templates missing in Global", report.factorCoverage.cnSourceMissingInGlobal],
    ["Global-only source templates", report.factorCoverage.globalSourceOnly],
    ["CN slot templates missing in Global", report.factorCoverage.cnSlotMissingInGlobal],
    ["Global-only slot templates", report.factorCoverage.globalSlotOnly],
    ["Source template bridge issues", report.factorCoverage.sourceTemplateBridgeIssues],
    ["Slot template bridge issues", report.factorCoverage.slotTemplateBridgeIssues],
  ];
  for (const [label, issues] of issueRows) {
    lines.push(`- ${label}: ${issues.length ? issues.map((issue) => typeof issue === "string" ? issue : JSON.stringify(issue)).join(", ") : "none"}`);
  }
  lines.push("");
  lines.push("## Suggested Port Order");
  lines.push("");
  for (const [index, step] of report.suggestedPortOrder.entries()) {
    lines.push(`${index + 1}. ${step}`);
  }
  fs.writeFileSync(mdPath, lines.join("\n"));
  return { jsonPath, mdPath };
}

const locale = extractCnLocaleKeys();
const report = {
  generatedAt: new Date().toISOString(),
  cnRoot: CN_ROOT,
  files: FEATURE_FILES.map((item) => ({ ...item, ...fileStatus(item.path) })),
  localeKeys: locale.allKeys,
  cnLocaleKeysByLocale: locale.byLocale,
  globalLocaleCoverage: globalLocaleCoverage(locale.allKeys),
  counterTemplates: counterTemplateSummary(),
  factorCoverage: factorCoverageSummary(),
  suggestedPortOrder: [
    "Port protobuf/blueprotobuf SeasonCultivateLineData surface, then run cargo check before wiring runtime state.",
    "Port backend season_cultivate.rs and factor_counter_tracker state separately from the normal buff counter tracker.",
    "Wire SyncContainerData/SyncContainerDirtyData extraction and the season-cultivate-factor-counter-update outbound event.",
    "Regenerate bindings and add frontend API listener/types.",
    "Add skill-mappings factor-template helpers using the already-imported counter source/slot template itemIds/effectBuffIds.",
    "Add custom-panel group kind/settings migration and runtime-monitor snapshot wiring.",
    "Add overlay rendering/listener for active factor slot counters and owned effect-buff rows.",
    "Add all Global locale JSON keys for every supported locale before exposing the UI button.",
  ],
};

const paths = writeReport(report);
console.log(`Wrote ${path.relative(ROOT, paths.mdPath)}`);
console.log(`Wrote ${path.relative(ROOT, paths.jsonPath)}`);
