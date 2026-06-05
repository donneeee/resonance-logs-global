#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
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

function isTwinAxeFactor(row) {
  const englishName = cleanText(row?.familyNames?.en) || cleanText(row?.familyName);
  return /\b(?:Flame Vanguard|Flame Berserker)\b/i.test(englishName);
}

function getTwinAxeClassLabel(classLabels, locale) {
  return getLocaleText(classLabels?.[TWIN_AXE_CLASS_LABEL_KEY], locale, "Twin Axe class label");
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

function getDisplayFamilyName(row, locale, classLabels, fallbackLabel) {
  const rawName = getLocaleText(row.familyNames, locale, fallbackLabel);
  if (!isTwinAxeFactor(row)) return rawName;

  const className = getTwinAxeClassLabel(classLabels, locale);
  return joinTwinAxeName(locale, className, getTwinAxeFactorKind(row), getTwinAxeSlot(row)) || rawName;
}

function buildTemplateLocaleEntries(locale) {
  const indexes = buildFactorIndexes();
  const classLabels = readJson("parser-data/generated/class-labels.json");
  const sourceTemplates = asArray(readJson("parser-data/app-rules/counter_source_templates.json"));
  const slotTemplates = asArray(readJson("parser-data/app-rules/counter_slot_templates.json"));
  const entries = new Map();

  for (const template of sourceTemplates) {
    const row = resolveFactorRow(template, indexes);
    entries.set(
      `sourceTemplate.${template.sourceId}.name`,
      getDisplayFamilyName(row, locale, classLabels, `source template ${template.sourceId} name`),
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
      getDisplayFamilyName(row, locale, classLabels, `slot template ${template.slotTemplateId} name`),
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
