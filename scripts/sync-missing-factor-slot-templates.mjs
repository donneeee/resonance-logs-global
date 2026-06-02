#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FACTOR_PATH = "parser-data/generated/SeasonPhantomFactors.json";
const SLOT_TEMPLATE_PATH = "parser-data/app-rules/counter_slot_templates.json";

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

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function firstItemId(row) {
  return normalizeIds(row.gradeItemIds)[0] ?? Number.MAX_SAFE_INTEGER;
}

function resolveDefaultResetBuffId(row) {
  const buffId = Number(row.buffId);
  if (!Number.isInteger(buffId) || buffId <= 0) {
    throw new Error(`Cannot build slot template without a valid buffId: ${JSON.stringify(row)}`);
  }
  return buffId + 1;
}

function buildSlotTemplateId(row, usedIds) {
  const baseId = `factor_${row.buffId}`;
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }

  for (const itemId of normalizeIds(row.gradeItemIds)) {
    const itemIdFallback = `factor_${row.buffId}_${itemId}`;
    if (!usedIds.has(itemIdFallback)) {
      usedIds.add(itemIdFallback);
      return itemIdFallback;
    }
  }

  throw new Error(`Could not allocate a unique slotTemplateId for buffId ${row.buffId}`);
}

function buildSlotTemplate(row, usedIds) {
  const itemIds = normalizeIds(row.gradeItemIds);
  const resetBuffId = resolveDefaultResetBuffId(row);
  const buffId = Number(row.buffId);

  return {
    slotTemplateId: buildSlotTemplateId(row, usedIds),
    name: firstText(row.familyNames?.en, row.familyName, `Factor ${buffId}`),
    description: firstText(
      row.cleanDescriptions?.en,
      row.cleanDescriptions?.["zh-CN"],
      row.familyNames?.en,
      row.familyName,
      `Factor ${buffId}`,
    ),
    slot: {
      threshold: null,
      resetBuffId,
      onBuffAdd: "reset",
      onBuffChange: "reset",
      onBuffRemove: "noOp",
    },
    effectBuffIds: [resetBuffId],
    itemIds,
  };
}

function buildMissingTemplates() {
  const factorData = readJson(FACTOR_PATH);
  const factorRows = asArray(factorData.factorsByBuffId)
    .filter((row) => normalizeIds(row.gradeItemIds).length > 0)
    .sort((left, right) => firstItemId(left) - firstItemId(right));

  const slotTemplates = asArray(readJson(SLOT_TEMPLATE_PATH));
  const coveredGradeItemIds = new Set();
  const usedSlotTemplateIds = new Set();

  for (const template of slotTemplates) {
    if (typeof template.slotTemplateId === "string") {
      usedSlotTemplateIds.add(template.slotTemplateId);
    }
    for (const itemId of normalizeIds(template.itemIds)) {
      coveredGradeItemIds.add(itemId);
    }
  }

  const missingRows = factorRows.filter((row) => {
    const itemIds = normalizeIds(row.gradeItemIds);
    return itemIds.length > 0 && !itemIds.some((itemId) => coveredGradeItemIds.has(itemId));
  });

  const additions = missingRows.map((row) => buildSlotTemplate(row, usedSlotTemplateIds));

  return {
    factorRows,
    slotTemplates,
    additions,
  };
}

const checkOnly = process.argv.includes("--check");
const dryRun = process.argv.includes("--dry-run") || checkOnly;
const { factorRows, slotTemplates, additions } = buildMissingTemplates();

console.log(`Generated factor rows with grade items: ${factorRows.length}`);
console.log(`Existing slot templates: ${slotTemplates.length}`);
console.log(`Missing slot templates: ${additions.length}`);

if (additions.length > 0) {
  const preview = additions
    .slice(0, 12)
    .map((template) => `${template.slotTemplateId} (${template.itemIds[0]}-${template.itemIds.at(-1)})`);
  console.log(`Preview: ${preview.join(", ")}${additions.length > preview.length ? ", ..." : ""}`);
}

if (checkOnly && additions.length > 0) {
  process.exitCode = 1;
} else if (!dryRun && additions.length > 0) {
  writeJson(SLOT_TEMPLATE_PATH, [...slotTemplates, ...additions]);
  console.log(`Wrote ${SLOT_TEMPLATE_PATH}`);
}
