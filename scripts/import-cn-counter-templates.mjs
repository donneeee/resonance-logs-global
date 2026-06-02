#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GLOBAL_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CN_ROOT = path.resolve(GLOBAL_ROOT, "..", "resonance-logs-cn-main_0.1.5");

const LOCALES = [
  "de",
  "en",
  "es",
  "fr",
  "id",
  "ja",
  "ko-KR",
  "pt-BR",
  "th",
  "zh-CN",
  "zh-TW",
];

function parseArgs(argv) {
  const args = {
    cnRoot: DEFAULT_CN_ROOT,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--cn-root") {
      const value = argv[i + 1];
      if (!value) throw new Error("--cn-root requires a path");
      args.cnRoot = path.resolve(value);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value, dryRun) {
  if (dryRun) return;
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function byKey(entries, keyField) {
  return new Map(entries.map((entry) => [String(entry[keyField]), entry]));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function textChanged(left, right) {
  return (left?.name ?? "") !== (right?.name ?? "")
    || (left?.description ?? "") !== (right?.description ?? "");
}

function buildTouchedKeys(globalEntries, cnEntries, keyField, behaviorField) {
  const globalByKey = byKey(globalEntries, keyField);
  const added = [];
  const behaviorChanged = [];
  const textChangedKeys = [];
  const metadataOnly = [];

  for (const cnEntry of cnEntries) {
    const key = String(cnEntry[keyField]);
    const globalEntry = globalByKey.get(key);
    if (!globalEntry) {
      added.push(key);
      continue;
    }

    const behaviorDiffers =
      canonical(globalEntry[behaviorField]) !== canonical(cnEntry[behaviorField]);
    const textDiffers = textChanged(globalEntry, cnEntry);
    const wholeDiffers = canonical(globalEntry) !== canonical(cnEntry);

    if (behaviorDiffers) behaviorChanged.push(key);
    if (textDiffers) textChangedKeys.push(key);
    if (wholeDiffers && !behaviorDiffers && !textDiffers) metadataOnly.push(key);
  }

  return {
    added,
    behaviorChanged,
    textChanged: textChangedKeys,
    metadataOnly,
    localeTouched: new Set([...added, ...behaviorChanged, ...textChangedKeys]),
  };
}

function loadCnText(cnRoot, relativePath, keyField) {
  const entries = readJson(path.join(cnRoot, "src", "lib", "config", relativePath));
  return byKey(entries, keyField);
}

function localizedText(entry, enEntry, jaEntry, locale) {
  if (locale === "zh-CN") {
    return {
      name: entry.name,
      description: entry.description,
    };
  }
  if (locale === "ja") {
    return {
      name: jaEntry?.name ?? enEntry?.name ?? entry.name,
      description: jaEntry?.description ?? enEntry?.description ?? entry.description,
    };
  }
  return {
    name: enEntry?.name ?? entry.name,
    description: enEntry?.description ?? entry.description,
  };
}

function applyLocaleEntries({
  localeData,
  locale,
  sourceEntries,
  sourceTextEn,
  sourceTextJa,
  touchedSourceIds,
  slotEntries,
  slotTextEn,
  slotTextJa,
  touchedSlotIds,
}) {
  let writtenKeys = 0;

  for (const entry of sourceEntries) {
    const id = String(entry.sourceId);
    if (!touchedSourceIds.has(id)) continue;
    const text = localizedText(entry, sourceTextEn.get(id), sourceTextJa.get(id), locale);
    localeData[`sourceTemplate.${id}.name`] = text.name;
    localeData[`sourceTemplate.${id}.description`] = text.description;
    writtenKeys += 2;
  }

  for (const entry of slotEntries) {
    const id = String(entry.slotTemplateId);
    if (!touchedSlotIds.has(id)) continue;
    const text = localizedText(entry, slotTextEn.get(id), slotTextJa.get(id), locale);
    localeData[`slotTemplate.${id}.name`] = text.name;
    localeData[`slotTemplate.${id}.description`] = text.description;
    writtenKeys += 2;
  }

  return writtenKeys;
}

function summarize(label, delta) {
  return [
    `${label}:`,
    `  added: ${delta.added.length}`,
    `  behavior changed: ${delta.behaviorChanged.length}`,
    `  text changed: ${delta.textChanged.length}`,
    `  metadata-only refreshed: ${delta.metadataOnly.length}`,
    `  locale-touched: ${delta.localeTouched.size}`,
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const globalSourcePath = path.join(
    GLOBAL_ROOT,
    "parser-data",
    "app-rules",
    "counter_source_templates.json",
  );
  const globalSlotPath = path.join(
    GLOBAL_ROOT,
    "parser-data",
    "app-rules",
    "counter_slot_templates.json",
  );
  const cnSourcePath = path.join(args.cnRoot, "src", "lib", "config", "counter_source_templates.json");
  const cnSlotPath = path.join(args.cnRoot, "src", "lib", "config", "counter_slot_templates.json");

  const globalSources = readJson(globalSourcePath);
  const globalSlots = readJson(globalSlotPath);
  const cnSources = readJson(cnSourcePath);
  const cnSlots = readJson(cnSlotPath);

  const sourceDelta = buildTouchedKeys(globalSources, cnSources, "sourceId", "source");
  const slotDelta = buildTouchedKeys(globalSlots, cnSlots, "slotTemplateId", "slot");

  const sourceTextEn = loadCnText(args.cnRoot, path.join("en-US", "counter_source_templates.json"), "sourceId");
  const sourceTextJa = loadCnText(args.cnRoot, path.join("ja-JP", "counter_source_templates.json"), "sourceId");
  const slotTextEn = loadCnText(args.cnRoot, path.join("en-US", "counter_slot_templates.json"), "slotTemplateId");
  const slotTextJa = loadCnText(args.cnRoot, path.join("ja-JP", "counter_slot_templates.json"), "slotTemplateId");

  writeJson(globalSourcePath, cnSources, args.dryRun);
  writeJson(globalSlotPath, cnSlots, args.dryRun);

  const localeWrites = {};
  for (const locale of LOCALES) {
    const localePath = path.join(
      GLOBAL_ROOT,
      "src",
      "lib",
      "locales",
      locale,
      "ui",
      "overlay",
      "skill-monitor",
      "custom-panel.json",
    );
    const localeData = readJson(localePath);
    localeWrites[locale] = applyLocaleEntries({
      localeData,
      locale,
      sourceEntries: cnSources,
      sourceTextEn,
      sourceTextJa,
      touchedSourceIds: sourceDelta.localeTouched,
      slotEntries: cnSlots,
      slotTextEn,
      slotTextJa,
      touchedSlotIds: slotDelta.localeTouched,
    });
    writeJson(localePath, localeData, args.dryRun);
  }

  console.log(args.dryRun ? "Dry run complete." : "Imported CN counter templates.");
  console.log(summarize("Counter source templates", sourceDelta));
  console.log(summarize("Counter slot templates", slotDelta));
  console.log("Locale keys written:");
  for (const locale of LOCALES) {
    console.log(`  ${locale}: ${localeWrites[locale]}`);
  }
}

main();
