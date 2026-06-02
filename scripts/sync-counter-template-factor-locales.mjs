#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf8"));
}

function writeJson(relPath, value) {
  fs.writeFileSync(path.join(ROOT, relPath), `${JSON.stringify(value, null, 2)}\n`);
}

function asArray(value) {
  return Array.isArray(value) ? value : Object.values(value ?? {});
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
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
    for (const itemId of normalizeIds(row.gradeItemIds)) {
      byGradeItemId.set(itemId, row);
    }
  }

  return { byBuffId, byGradeItemId };
}

function resolveFactorRow(template, indexes) {
  const itemCandidates = new Set();
  for (const itemId of normalizeIds(template.itemIds)) {
    const row = indexes.byGradeItemId.get(itemId);
    if (row) itemCandidates.add(row);
  }

  if (itemCandidates.size === 1) {
    return Array.from(itemCandidates)[0];
  }

  if (itemCandidates.size > 1) {
    const id = template.sourceId ?? template.slotTemplateId ?? "<unknown>";
    throw new Error(`Expected exactly one grade-item factor bridge for ${id}, found ${itemCandidates.size}`);
  }

  const buffCandidates = new Set();
  for (const buffId of normalizeIds(template.effectBuffIds)) {
    const row = indexes.byBuffId.get(buffId);
    if (row) buffCandidates.add(row);
  }

  if (buffCandidates.size !== 1) {
    const id = template.sourceId ?? template.slotTemplateId ?? "<unknown>";
    throw new Error(`Expected exactly one factor bridge for ${id}, found ${buffCandidates.size}`);
  }

  return Array.from(buffCandidates)[0];
}

function getLocaleText(map, locale, fallbackLabel) {
  const selected = cleanText(map?.[locale]);
  if (selected) return selected;

  const en = cleanText(map?.en);
  if (en) return en;

  throw new Error(`Missing localized ${fallbackLabel} for ${locale}`);
}

function buildTemplateLocaleEntries(locale) {
  const indexes = buildFactorIndexes();
  const sourceTemplates = asArray(readJson("parser-data/app-rules/counter_source_templates.json"));
  const slotTemplates = asArray(readJson("parser-data/app-rules/counter_slot_templates.json"));
  const entries = new Map();

  for (const template of sourceTemplates) {
    const row = resolveFactorRow(template, indexes);
    entries.set(
      `sourceTemplate.${template.sourceId}.name`,
      getLocaleText(row.familyNames, locale, `source template ${template.sourceId} name`),
    );
    entries.set(
      `sourceTemplate.${template.sourceId}.description`,
      getLocaleText(row.cleanDescriptions, locale, `source template ${template.sourceId} description`),
    );
  }

  for (const template of slotTemplates) {
    const row = resolveFactorRow(template, indexes);
    entries.set(
      `slotTemplate.${template.slotTemplateId}.name`,
      getLocaleText(row.familyNames, locale, `slot template ${template.slotTemplateId} name`),
    );
    entries.set(
      `slotTemplate.${template.slotTemplateId}.description`,
      getLocaleText(row.cleanDescriptions, locale, `slot template ${template.slotTemplateId} description`),
    );
  }

  return entries;
}

const localeRoot = path.join(ROOT, "src/lib/locales");
const localeNames = fs
  .readdirSync(localeRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

const checkOnly = process.argv.includes("--check");
const summary = [];

for (const locale of localeNames) {
  const relPath = path.join(
    "src/lib/locales",
    locale,
    "ui/overlay/skill-monitor/custom-panel.json",
  );
  const current = readJson(relPath);
  const expectedEntries = buildTemplateLocaleEntries(locale);
  let changed = 0;

  for (const [key, expected] of expectedEntries) {
    if (current[key] !== expected) {
      changed += 1;
      current[key] = expected;
    }
  }

  summary.push({ locale, changed });

  if (changed > 0 && !checkOnly) {
    writeJson(relPath, current);
  }
}

for (const row of summary) {
  console.log(`${row.locale}: ${row.changed} ${checkOnly ? "mismatched" : "updated"}`);
}

if (checkOnly && summary.some((row) => row.changed > 0)) {
  process.exitCode = 1;
}
