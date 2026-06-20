import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const inputPath = path.join(root, "parser-data/generated/SeasonPhantomFactors.json");
const outputPath = path.join(root, "DEV_exports/polarity-factor-grade-descriptions.csv");

const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));

function isPolarityFactor(row) {
  const names = [
    row.familyName,
    ...Object.values(row.familyNames ?? {}),
  ].filter(Boolean).join(" ");
  return /\bPolarity\b|极性|極性|Polaridad|Polaridade|Polarität|Polarité/i.test(names);
}

function slotOf(name) {
  const match = String(name ?? "").match(/\bX\s*(\d+)\b/i);
  return match ? `X${match[1]}` : "";
}

function cleanDescription(value) {
  return String(value ?? "")
    .replace(/<break\s*\/?\s*>/gi, ". ")
    .replace(/<br\s*\/?\s*>/gi, ". ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function csv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

const rows = [];

for (const factor of Object.values(data.factorsByBuffId ?? {})
  .filter(isPolarityFactor)
  .sort((left, right) => (left.buffId ?? 0) - (right.buffId ?? 0))) {
  const factorName = factor.familyNames?.en || factor.familyName || `Factor ${factor.buffId}`;
  const gradeRows = factor.modifierEvidence?.gradeRows ?? [];

  for (const grade of [...gradeRows].sort((left, right) => (left.grade ?? 0) - (right.grade ?? 0))) {
    rows.push({
      class: "All Classes",
      factor: factorName,
      slot: slotOf(factorName),
      buff_id: factor.buffId,
      family_id: factor.familyId,
      description_id: factor.descriptionId,
      grade: grade.grade,
      grade_item_id: grade.itemId,
      item_quality_tier: grade.itemQualityTier,
      parameter_values: (grade.parameterValues ?? []).join("; "),
      resolved_values: (grade.valueTexts ?? []).join("; "),
      description_en: grade.cleanResolvedDescription ?? "",
      template_en: cleanDescription(factor.cleanDescriptions?.en || factor.descriptions?.en || ""),
      source_offset: grade.sourceOffset,
    });
  }
}

const headers = [
  "class",
  "factor",
  "slot",
  "buff_id",
  "family_id",
  "description_id",
  "grade",
  "grade_item_id",
  "item_quality_tier",
  "parameter_values",
  "resolved_values",
  "description_en",
  "template_en",
  "source_offset",
];

const output = [
  headers.map(csv).join(","),
  ...rows.map((row) => headers.map((header) => csv(row[header])).join(",")),
].join("\r\n") + "\r\n";

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `\uFEFF${output}`, "utf8");

console.log(`${outputPath} rows=${rows.length} factors=${new Set(rows.map((row) => row.factor)).size}`);
