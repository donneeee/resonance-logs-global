import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "DEV_exports");

const locales = [
  "en",
  "zh-CN",
  "zh-TW",
  "ja",
  "ko-KR",
  "fr",
  "de",
  "es",
  "pt-BR",
  "th",
  "id",
];

const classGroups = {
  1: { classKey: "stormblade", className: "Stormblade" },
  2: { classKey: "frost_mage", className: "Frost Mage" },
  3: { classKey: "wind_knight", className: "Wind Knight" },
  4: { classKey: "verdant_oracle", className: "Verdant Oracle" },
  5: { classKey: "marksman", className: "Marksman" },
  6: { classKey: "heavy_guardian", className: "Heavy Guardian" },
  7: { classKey: "shield_knight", className: "Shield Knight" },
  8: { classKey: "beat_performer", className: "Beat Performer" },
  9: { classKey: "twin_axe", className: "Twin Striker" },
};

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, ". ")
    .replace(/<style="[^"]*">/gi, "")
    .replace(/<\/style>/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

function pickLocalizedMap(...maps) {
  const result = {};
  for (const locale of locales) {
    for (const map of maps) {
      const value = map?.[locale];
      if (value != null && String(value).trim()) {
        result[locale] = cleanText(value);
        break;
      }
    }
  }
  return result;
}

function designText(buffRow) {
  return cleanText([buffRow?.DesignName, buffRow?.NameDesign, buffRow?.Names?.design].filter(Boolean).join(" "));
}

function parseSetDesign(design) {
  const text = cleanText(design);
  if (!/(套装|套裝|Set)/i.test(text)) {
    return null;
  }

  const seriesMatch = text.match(/S(\d+)\s*套[装裝]/i);
  const thresholdMatch =
    text.match(/套[装裝]\s*([246])\s*([AB])?/i) ??
    text.match(/Set\s*([246])\s*([AB])?/i);
  const branchMatch = thresholdMatch?.[2] ?? text.match(/\b([AB])\b/i)?.[1] ?? null;

  return {
    raw: text,
    unique: /唯一/.test(text),
    series: seriesMatch ? Number(seriesMatch[1]) : null,
    pieceThreshold: thresholdMatch ? Number(thresholdMatch[1]) : null,
    branch: branchMatch ? branchMatch.toUpperCase() : null,
    childBuff: /子\s*BUFF|子Buff|子buff|——|--/.test(text),
  };
}

function classGroupForEffectId(effectId) {
  const group = Math.floor((Number(effectId) - 2400000) / 1000);
  return classGroups[group] ?? { classKey: `unknown_${group}`, className: `Unknown ${group}` };
}

function classifyEffect(text) {
  const normalized = cleanText(text);
  const categories = [];
  if (/(remaining CD|CD\s*-|CD is immediately reset|immediately reset|reset(?:s)? .* CD|cools down|cool down)/i.test(normalized)) {
    categories.push("cooldown-remaining-reduction");
  }
  if (/(CD Boost|cooldown acceleration|cooldown boost|affected by CD Boost)/i.test(normalized)) {
    categories.push("cooldown-acceleration");
  }
  if (/(extends? .*duration|duration \+|duration is paused|lasts? for|for \d+(?:\.\d+)?s)/i.test(normalized)) {
    categories.push("duration-window");
  }
  if (/(Casting SPD|Casting Speed|cast speed|trigger speed|Attack SPD|attack speed)/i.test(normalized)) {
    categories.push("speed");
  }
  if (/(triggers?|summons?|automatically|counts as|will not start CD|does not trigger CD|not consume|no longer consume|replaces?)/i.test(normalized)) {
    categories.push("skill-trigger-or-replacement");
  }
  if (/(Energy|Sigil|Courage|Sharp|Photon|Holy|Lightforged|Performance|Soundwave|Ice Energy|Sand Crystal|Crimson)/i.test(normalized)) {
    categories.push("resource-rule");
  }
  if (/(DMG|Damage|Crit|Haste|Mastery|Luck|Armor|Shield|ATK|MAG|PHY|Fire|Ice|Wind|Light|Thunder|Dark|Healing|HP)/i.test(normalized)) {
    categories.push("stat-or-damage");
  }
  return [...new Set(categories)];
}

function firstValue(values) {
  return Array.isArray(values) ? values.filter((v) => v != null && String(v).trim()).map(String) : [];
}

function formatList(values) {
  return values.length ? values.join(", ") : "-";
}

function markdownTable(rows, columns) {
  const escapeCell = (value) =>
    cleanText(value)
      .replace(/\|/g, "\\|")
      .replace(/\n/g, " ");
  const header = `| ${columns.map((c) => c.label).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((c) => escapeCell(c.value(row))).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

const seasonEffects = readJson("parser-data/generated/SeasonEffectDescriptions.json");
const buffNames = readJson("parser-data/generated/BuffName.json");
const effectSources = readJson("parser-data/generated/EffectSources.json");
const itemNames = readJson("parser-data/generated/itemnames.json");

const seasonRows = seasonEffects.rows ?? [];
const seasonById = new Map();
for (const row of seasonRows) {
  for (const id of [row.id, row.Id, row.buffId, row.observedBuffId]) {
    const numericId = asNumber(id);
    if (numericId != null && !seasonById.has(numericId)) {
      seasonById.set(numericId, row);
    }
  }
}

const buffRowsById = new Map();
for (const row of buffNames) {
  const id = asNumber(row.Id);
  if (id == null) continue;
  if (!buffRowsById.has(id)) buffRowsById.set(id, []);
  buffRowsById.get(id).push(row);
}

const effectSourceRowsByEntityId = new Map();
for (const row of Object.values(effectSources.effectSourcesById ?? {})) {
  const id = asNumber(row.sourceEntityId);
  if (id == null) continue;
  if (!effectSourceRowsByEntityId.has(id)) effectSourceRowsByEntityId.set(id, []);
  effectSourceRowsByEntityId.get(id).push(row);
}

const setDesignBuffRows = buffNames
  .map((row) => ({ row, parsedSet: parseSetDesign(designText(row)) }))
  .filter(({ row, parsedSet }) => {
    const id = asNumber(row.Id);
    return parsedSet && id != null && id >= 2401000 && id < 2410000;
  })
  .sort((a, b) => Number(a.row.Id) - Number(b.row.Id));

const classSeasonEffectRows = seasonRows
  .filter((row) => {
    const id = asNumber(row.id ?? row.Id ?? row.buffId);
    return id != null && id >= 2401000 && id < 2410000;
  })
  .sort((a, b) => Number(a.id ?? a.Id ?? a.buffId) - Number(b.id ?? b.Id ?? b.buffId));

function buildEffectRow(id, parsedSet = null) {
  const seasonRow = seasonById.get(id);
  const buffRows = buffRowsById.get(id) ?? [];
  const primaryBuff = buffRows[0] ?? null;
  const effectSourceRows = effectSourceRowsByEntityId.get(id) ?? [];
  const classGroup = classGroupForEffectId(id);
  const design = parsedSet?.raw ?? designText(primaryBuff);
  const setInfo = parsedSet ?? parseSetDesign(design);
  const descriptions = pickLocalizedMap(
    seasonRow?.cleanDescriptions,
    seasonRow?.descriptions,
    primaryBuff?.Descriptions,
    primaryBuff?.CleanDescriptions,
    effectSourceRows[0]?.cleanDescriptions,
    effectSourceRows[0]?.descriptions,
  );
  const names = pickLocalizedMap(primaryBuff?.Names, effectSourceRows[0]?.sourceNames);
  const effectText = descriptions.en ?? seasonRow?.cleanDescription ?? primaryBuff?.Descriptions?.en ?? effectSourceRows[0]?.cleanDescriptions?.en ?? "";

  return {
    id,
    classKey: classGroup.classKey,
    className: classGroup.className,
    internalDesignName: design || null,
    parsedSet: setInfo,
    names,
    descriptions,
    englishDescription: cleanText(effectText),
    categories: classifyEffect(effectText),
    valueTexts: firstValue(seasonRow?.valueTexts),
    linkTexts: firstValue(seasonRow?.linkTexts),
    hasLocalizedDescription: Object.keys(descriptions).length > 0,
    sourceOffsets: {
      seasonEffect: seasonRow?.SourceOffset ?? seasonRow?.sourceOffset ?? null,
      buffName: primaryBuff?.SourceOffset ?? primaryBuff?.sourceOffset ?? null,
    },
    evidence: {
      hasSetDesignName: Boolean(setInfo),
      seasonEffectDescription: Boolean(seasonRow),
      effectSourceRows: effectSourceRows.map((row) => row.sourceId),
      buffNameRowCount: buffRows.length,
    },
    runtimeActivationBridge: {
      status: "needs-equipped-suit-piece-count",
      expectedSource: "SyncContainerData.ItemPackage.SuitInfoDict / EquipSuitInfo.SuitAttr",
      maxEquippedPiecesToTrack: 6,
      activationThresholdsObservedInDesignData: [...new Set(setDesignBuffRows.map((x) => x.parsedSet.pieceThreshold).filter(Boolean))].sort((a, b) => a - b),
      note:
        "Do not apply this set effect to cooldown/factor math until the player's equipped suit family and piece count prove the active 2/4 threshold. Track counts up to 6 because players can mix 4+2 or 2+2+2 across the six armor/accessory slots.",
    },
  };
}

const setEffectRows = setDesignBuffRows.map(({ row, parsedSet }) => buildEffectRow(Number(row.Id), parsedSet));
const classSeasonRows = classSeasonEffectRows.map((row) => buildEffectRow(Number(row.id ?? row.Id ?? row.buffId)));

const setIds = new Set(setEffectRows.map((row) => row.id));
const relatedNonSetRows = classSeasonRows.filter((row) => !setIds.has(row.id));
const cooldownRelevantSetRows = setEffectRows.filter((row) =>
  row.categories.some((category) =>
    [
      "cooldown-remaining-reduction",
      "cooldown-acceleration",
      "duration-window",
      "speed",
      "skill-trigger-or-replacement",
    ].includes(category),
  ),
);
const missingDescriptionRows = setEffectRows.filter((row) => !row.hasLocalizedDescription);

const setPieceItemRows = itemNames
  .filter((row) => {
    const name = row.Names?.en ?? row.NameDesign ?? "";
    return /^\[(Dreamer|Weaver|Illusion|Illusion-Breaking)\]/i.test(name);
  })
  .map((row) => ({
    itemId: row.Id,
    names: row.Names ?? {},
    iconPath: row.IconPath ?? null,
    itemTableSourceOffset: row.ItemTableSourceOffset ?? null,
  }))
  .sort((a, b) => Number(a.itemId) - Number(b.itemId));

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sources: {
    seasonEffectDescriptions: "parser-data/generated/SeasonEffectDescriptions.json",
    buffName: "parser-data/generated/BuffName.json",
    effectSources: "parser-data/generated/EffectSources.json",
    itemNames: "parser-data/generated/itemnames.json",
  },
  summary: {
    classSeasonEffectRows: classSeasonRows.length,
    setDesignRows: setEffectRows.length,
    setDesignRowsWithLocalizedDescriptions: setEffectRows.length - missingDescriptionRows.length,
    setDesignRowsMissingLocalizedDescriptions: missingDescriptionRows.length,
    cooldownRelevantSetRows: cooldownRelevantSetRows.length,
    relatedNonSetClassSeasonRows: relatedNonSetRows.length,
    setPieceItemRows: setPieceItemRows.length,
    activationThresholdsObservedInDesignData: [...new Set(setEffectRows.map((row) => row.parsedSet?.pieceThreshold).filter(Boolean))].sort((a, b) => a - b),
    runtimePieceCountRequirement:
      "Track equipped set family counts up to 6 pieces from SuitInfoDict/EquipSuitInfo before applying 2-piece/4-piece set effects. The static data currently exposes 2/4 design thresholds; 6 is the equipped-piece maximum needed for mix decisions.",
  },
  setEffectRows,
  cooldownRelevantSetRows,
  missingDescriptionRows,
  relatedNonSetClassSeasonRows: relatedNonSetRows,
  setPieceItemRows,
};

fs.mkdirSync(outDir, { recursive: true });
const jsonOut = path.join(outDir, "raid-gear-set-effects.json");
const mdOut = path.join(outDir, "raid-gear-set-effects.md");
fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));

const md = [];
md.push("# Raid / Class Gear Set Effect Audit");
md.push("");
md.push(`Generated: ${report.generatedAt}`);
md.push("");
md.push("## Summary");
md.push("");
md.push(`- Class-season effect rows in the 2401xxx-2409xxx range: ${report.summary.classSeasonEffectRows}`);
md.push(`- Set-design rows: ${report.summary.setDesignRows}`);
md.push(`- Set-design rows with localized descriptions: ${report.summary.setDesignRowsWithLocalizedDescriptions}`);
md.push(`- Set-design rows missing localized descriptions: ${report.summary.setDesignRowsMissingLocalizedDescriptions}`);
md.push(`- Cooldown / duration / speed / trigger relevant set rows: ${report.summary.cooldownRelevantSetRows}`);
md.push(`- Set-piece item rows found by name: ${report.summary.setPieceItemRows}`);
md.push(`- Observed static set thresholds: ${formatList(report.summary.activationThresholdsObservedInDesignData.map(String))}`);
md.push("");
md.push("Runtime activation still needs an equipped-suit bridge: count each player's active suit family up to 6 pieces from `SyncContainerData.ItemPackage.SuitInfoDict` / `EquipSuitInfo.SuitAttr`, then apply the proven 2-piece and 4-piece effects for each active family. This report does not promote design-only rows into runtime math.");
md.push("");
md.push("## Cooldown / Skill-Relevant Set Rows");
md.push("");
md.push(
  markdownTable(cooldownRelevantSetRows, [
    { label: "ID", value: (row) => row.id },
    { label: "Class", value: (row) => row.className },
    { label: "Design", value: (row) => row.internalDesignName ?? "-" },
    { label: "Piece", value: (row) => row.parsedSet?.pieceThreshold ?? "-" },
    { label: "Branch", value: (row) => row.parsedSet?.branch ?? "-" },
    { label: "Categories", value: (row) => formatList(row.categories) },
    { label: "EN Effect", value: (row) => row.englishDescription || "-" },
  ]),
);
md.push("");
md.push("## All Set-Design Rows");
md.push("");
for (const className of [...new Set(setEffectRows.map((row) => row.className))]) {
  const rows = setEffectRows.filter((row) => row.className === className);
  md.push(`### ${className}`);
  md.push("");
  md.push(
    markdownTable(rows, [
      { label: "ID", value: (row) => row.id },
      { label: "Design", value: (row) => row.internalDesignName ?? "-" },
      { label: "Piece", value: (row) => row.parsedSet?.pieceThreshold ?? "-" },
      { label: "Branch", value: (row) => row.parsedSet?.branch ?? "-" },
      { label: "Localized?", value: (row) => (row.hasLocalizedDescription ? "yes" : "no") },
      { label: "Categories", value: (row) => formatList(row.categories) },
      { label: "EN Effect", value: (row) => row.englishDescription || "-" },
    ]),
  );
  md.push("");
}
md.push("## Missing Localized Description Bridge");
md.push("");
md.push(
  markdownTable(missingDescriptionRows, [
    { label: "ID", value: (row) => row.id },
    { label: "Class", value: (row) => row.className },
    { label: "Design", value: (row) => row.internalDesignName ?? "-" },
    { label: "Piece", value: (row) => row.parsedSet?.pieceThreshold ?? "-" },
    { label: "Branch", value: (row) => row.parsedSet?.branch ?? "-" },
  ]),
);
md.push("");
md.push("## Related 240x Class-Season Rows Not Marked As Set Designs");
md.push("");
md.push("These rows may be ocean weapon, generic class-season, orange weapon, or other class-effect rows. They are included so cooldown/skill-affecting text is not missed.");
md.push("");
md.push(
  markdownTable(relatedNonSetRows, [
    { label: "ID", value: (row) => row.id },
    { label: "Class", value: (row) => row.className },
    { label: "Categories", value: (row) => formatList(row.categories) },
    { label: "EN Effect", value: (row) => row.englishDescription || "-" },
  ]),
);
md.push("");
fs.writeFileSync(mdOut, `${md.join("\n")}\n`);

console.log(`Wrote ${path.relative(root, jsonOut)}`);
console.log(`Wrote ${path.relative(root, mdOut)}`);
