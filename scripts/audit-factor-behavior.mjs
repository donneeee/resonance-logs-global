import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const generatedDir = path.join(root, "parser-data", "generated");
const rulesDir = path.join(root, "parser-data", "app-rules");
const outDir = path.join(root, "DEV_exports");

const slotTemplatesPath = path.join(rulesDir, "counter_slot_templates.json");
const sourceTemplatesPath = path.join(rulesDir, "counter_source_templates.json");
const factorsPath = path.join(generatedDir, "SeasonPhantomFactors.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function extractEnergyThreshold(text) {
  const normalized = cleanText(text);
  const patterns = [
    /Illusion Energy reaches\s+(\d+(?:\.\d+)?)\s+points/i,
    /幻象能量达到\s*(\d+(?:\.\d+)?)\s*点/,
    /虚妄能量达到\s*(\d+(?:\.\d+)?)\s*点/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function extractTimerWindows(text) {
  const normalized = cleanText(text);
  const values = [];
  const patterns = [
    /\b(\d+(?:\.\d+)?)\s*s\b/gi,
    /\bfor\s+(\d+(?:\.\d+)?)\s*s\b/gi,
    /\bwithin\s+(\d+(?:\.\d+)?)\s*s\b/gi,
    /\bcooldown\s+(\d+(?:\.\d+)?)\s*s\b/gi,
    /\bCD\s+(\d+(?:\.\d+)?)\s*s\b/gi,
    /(\d+(?:\.\d+)?)\s*s\s+cooldown/gi,
    /持续\s*(\d+(?:\.\d+)?)\s*秒/g,
    /冷却\s*(\d+(?:\.\d+)?)\s*秒/g,
    /(\d+(?:\.\d+)?)\s*秒内/g,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      values.push(Number(match[1]));
    }
  }
  return [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))];
}

function classifySlotTemplateId(id) {
  const normalized = String(id ?? "").toLowerCase();
  if (normalized.includes("reality")) return "reality";
  if (normalized.includes("stasis")) return "stasis";
  if (normalized.includes("polarity")) return "polarity";
  if (normalized.includes("false")) return "inspiration";
  if (normalized.includes("s3")) return "reality";
  return "factor";
}

function sourceIncrement(source) {
  if (!source || typeof source !== "object") return 0;
  for (const value of Object.values(source)) {
    if (value && typeof value === "object" && Number.isFinite(value.increment)) {
      return Number(value.increment);
    }
  }
  return 0;
}

const slotTemplates = readJson(slotTemplatesPath);
const sourceTemplates = readJson(sourceTemplatesPath);
const factorData = readJson(factorsPath);
const factors = Array.isArray(factorData)
  ? factorData
  : Object.values(factorData.factorsByBuffId ?? {});

const factorByItemId = new Map();
for (const factor of factors) {
  for (const row of asArray(factor.modifierEvidence?.gradeRows)) {
    const itemId = Number(row.itemId);
    if (!Number.isFinite(itemId)) continue;
    factorByItemId.set(itemId, {
      familyId: factor.familyId,
      buffId: factor.buffId,
      familyName: cleanText(factor.familyName),
      grade: row.grade,
      itemId,
      description: cleanText(row.cleanResolvedDescription),
      values: asArray(row.valueTexts).map(cleanText).filter(Boolean),
    });
  }
}

const sourceByItemId = new Map();
for (const sourceTemplate of sourceTemplates) {
  for (const itemId of asArray(sourceTemplate.itemIds)) {
    if (!sourceByItemId.has(itemId)) sourceByItemId.set(itemId, []);
    sourceByItemId.get(itemId).push(sourceTemplate);
  }
}

const reportRows = slotTemplates.map((slotTemplate) => {
  const itemIds = asArray(slotTemplate.itemIds).map(Number).filter(Number.isFinite);
  const factorsForItems = itemIds.map((itemId) => factorByItemId.get(itemId)).filter(Boolean);
  const descriptions = factorsForItems.map((row) => row.description).filter(Boolean);
  const fullText = [
    slotTemplate.name,
    slotTemplate.description,
    ...descriptions,
  ].map(cleanText).filter(Boolean).join(" ");
  const parsedThresholds = descriptions
    .map(extractEnergyThreshold)
    .filter((value) => Number.isFinite(value));
  const parsedTimers = descriptions.flatMap(extractTimerWindows);
  const sources = itemIds.flatMap((itemId) => sourceByItemId.get(itemId) ?? []);
  const sourceIncrements = sources.map((source) => sourceIncrement(source.source)).filter(Boolean);
  const configuredThreshold = slotTemplate.slot?.threshold ?? null;
  const configuredFreezeMs = slotTemplate.slot?.freezeDurationMs ?? null;
  const firstFactor = factorsForItems[0] ?? null;
  return {
    slotTemplateId: slotTemplate.slotTemplateId,
    type: classifySlotTemplateId(slotTemplate.slotTemplateId),
    firstItemId: itemIds[0] ?? null,
    familyName: firstFactor?.familyName ?? "",
    buffId: firstFactor?.buffId ?? null,
    configuredThreshold,
    parsedThresholds: [...new Set(parsedThresholds)],
    configuredFreezeSeconds:
      Number.isFinite(configuredFreezeMs) && configuredFreezeMs > 0
        ? Number(configuredFreezeMs) / 1000
        : null,
    parsedTimerSeconds: [...new Set(parsedTimers)],
    sourceIncrements: [...new Set(sourceIncrements)],
    onBuffAdd: slotTemplate.slot?.onBuffAdd ?? "noOp",
    onBuffChange: slotTemplate.slot?.onBuffChange ?? "noOp",
    onBuffRemove: slotTemplate.slot?.onBuffRemove ?? "noOp",
    resetBuffId: slotTemplate.slot?.resetBuffId ?? null,
    firstDescription: descriptions[0] ?? cleanText(slotTemplate.description),
    hasEnergyThresholdText: /Illusion Energy reaches|幻象能量达到|虚妄能量达到/i.test(fullText),
    hasTimerText: /within|cooldown|\bCD\b|for \d|持续|冷却|\d+\s*秒/i.test(fullText),
  };
});

const patchCandidates = reportRows.filter((row) =>
  row.configuredThreshold === null &&
  row.parsedThresholds.length === 1
);
const timerCandidates = reportRows.filter((row) =>
  row.configuredFreezeSeconds === null &&
  row.parsedTimerSeconds.length > 0
);

fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, "factor-behavior-audit.json");
const mdPath = path.join(outDir, "factor-behavior-audit.md");
fs.writeFileSync(jsonPath, JSON.stringify({ reportRows, patchCandidates, timerCandidates }, null, 2));

const lines = [];
lines.push("# Factor Behavior Audit");
lines.push("");
lines.push(`Slot templates scanned: ${reportRows.length}`);
lines.push(`Threshold patch candidates: ${patchCandidates.length}`);
lines.push(`Timer candidates without configured freeze: ${timerCandidates.length}`);
lines.push("");
lines.push("## Threshold Patch Candidates");
lines.push("");
for (const row of patchCandidates) {
  lines.push(`- ${row.slotTemplateId}: ${row.parsedThresholds[0]} (${row.familyName || row.firstItemId})`);
}
lines.push("");
lines.push("## Timer Candidates Without Configured Freeze");
lines.push("");
for (const row of timerCandidates) {
  lines.push(
    `- ${row.slotTemplateId}: timers ${row.parsedTimerSeconds.join(", ")}s (${row.familyName || row.firstItemId}); actions add=${row.onBuffAdd} change=${row.onBuffChange} remove=${row.onBuffRemove} resetBuff=${row.resetBuffId}`,
  );
}
lines.push("");
lines.push("## Rows With Timer Or Energy Text");
lines.push("");
for (const row of reportRows.filter((item) => item.hasTimerText || item.hasEnergyThresholdText)) {
  lines.push(
    `- ${row.slotTemplateId}: threshold=${row.configuredThreshold ?? "null"} parsedThresholds=${row.parsedThresholds.join(",") || "-"} freeze=${row.configuredFreezeSeconds ?? "-"} parsedTimers=${row.parsedTimerSeconds.join(",") || "-"} type=${row.type} actions=${row.onBuffAdd}/${row.onBuffChange}/${row.onBuffRemove} resetBuff=${row.resetBuffId}`,
  );
}
fs.writeFileSync(mdPath, `${lines.join("\n")}\n`);

console.log(`Wrote ${path.relative(root, jsonPath)}`);
console.log(`Wrote ${path.relative(root, mdPath)}`);
console.log(`Threshold patch candidates: ${patchCandidates.length}`);
console.log(`Timer candidates without configured freeze: ${timerCandidates.length}`);
