import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const generatedDir = path.join(root, "parser-data", "generated");
const rulesDir = path.join(root, "parser-data", "app-rules");
const outDir = path.join(root, "DEV_exports");

const sourceTemplatesPath = path.join(rulesDir, "counter_source_templates.json");
const slotTemplatesPath = path.join(rulesDir, "counter_slot_templates.json");
const factorsPath = path.join(generatedDir, "SeasonPhantomFactors.json");
const classSkillConfigsPath = path.join(rulesDir, "class_skill_configs.json");
const skillIconsPath = path.join(generatedDir, "skill_aoyi_icons.json");

const CLASS_PREFIXES = [
  ["stormablade", "Stormblade"],
  ["flame_berserker", "Twin Axe"],
  ["beat_performer", "Beat Performer"],
  ["marksman", "Marksman"],
  ["frost_mage", "Frost Mage"],
  ["wind_knight", "Wind Knight"],
  ["holy_shield", "Shield Knight"],
  ["giant_blade", "Heavy Guardian"],
];

const CLASS_NAME_PATTERNS = [
  ["Stormblade", /stormblade|raikage|雷影/i],
  ["Twin Axe", /flame (vanguard|berserker)|flame berserker|twin axe|双斧/i],
  ["Beat Performer", /beat performer|soul|灵魂/i],
  ["Marksman", /marksman|sharpshooter|神射/i],
  ["Frost Mage", /frost mage|ice demon|冰魔/i],
  ["Wind Knight", /wind knight|qinglan|青岚/i],
  ["Shield Knight", /shield knight|aegis|神盾/i],
  ["Heavy Guardian", /heavy guardian|greatsword|giant blade|巨刃/i],
];

const FACTOR_KIND_PATTERNS = [
  ["reality", /reality factor|真实因子/i],
  ["stasis", /stasis|稳态/i],
  ["polarity", /polarity|极性/i],
  ["rhapsody", /rhapsody|乐章/i],
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function displayFactorName(value) {
  return cleanText(value).replace(/\b(?:Flame Vanguard|Flame Berserker)\b/g, "Twin Axe");
}

function unique(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function sourceKind(source) {
  if (!source || typeof source !== "object") return "unknown";
  return Object.keys(source)[0] ?? "unknown";
}

function sourceConfig(source) {
  const kind = sourceKind(source);
  const config = source?.[kind];
  return config && typeof config === "object" ? config : {};
}

function sourceIncrement(template) {
  const config = sourceConfig(template.source);
  return Number.isFinite(config.increment) ? Number(config.increment) : null;
}

function extractTimerWindows(text) {
  const normalized = cleanText(text);
  const values = [];
  const patterns = [
    /\b(\d+(?:\.\d+)?)\s*s\b/gi,
    /(\d+(?:\.\d+)?)\s*秒/g,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      values.push(Number(match[1]));
    }
  }
  return unique(values.filter((value) => Number.isFinite(value) && value > 0));
}

function extractIllusionEnergyNumbers(text) {
  const normalized = cleanText(text);
  const values = [];
  const patterns = [
    /grants?\s+(\d+(?:\.\d+)?)\s+Illusion Energy/gi,
    /Illusion Energy reaches\s+(\d+(?:\.\d+)?)\s+points/gi,
    /获得\s*(\d+(?:\.\d+)?)\s*点.*?(?:能量|虚妄能量|幻象能量)/g,
    /(?:虚妄能量|幻象能量).*?达到\s*(\d+(?:\.\d+)?)\s*点/g,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      values.push(Number(match[1]));
    }
  }
  return unique(values.filter((value) => Number.isFinite(value) && value > 0));
}

function classifyClass(sourceId, familyNames) {
  const id = String(sourceId ?? "").toLowerCase();
  for (const [prefix, className] of CLASS_PREFIXES) {
    if (id.startsWith(prefix)) return className;
  }
  const namesText = familyNames.join(" ");
  for (const [className, pattern] of CLASS_NAME_PATTERNS) {
    if (pattern.test(namesText)) return className;
  }
  return "Unknown";
}

function classifyFactorKind(familyNames, sourceId) {
  const text = `${familyNames.join(" ")} ${sourceId ?? ""}`;
  for (const [kind, pattern] of FACTOR_KIND_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return "inspiration";
}

function generatedNames(value) {
  const names = [];
  if (!value || typeof value !== "object") return names;
  for (const key of ["en", "zh-CN", "zh-TW", "ja", "ko-KR", "fr", "de", "es", "pt-BR", "th"]) {
    const text = displayFactorName(value[key]);
    if (text) names.push(text);
  }
  return names;
}

function buildSkillNameMap(classSkillConfigs, skillIcons) {
  const map = new Map();
  const add = (id, name) => {
    const numeric = Number(id);
    const text = cleanText(name);
    if (!Number.isFinite(numeric) || !text || map.has(numeric)) return;
    map.set(numeric, text);
  };
  for (const config of Object.values(classSkillConfigs)) {
    for (const skill of asArray(config.skills)) {
      add(skill.skillId, skill.name);
    }
    for (const derivation of asArray(config.derivations)) {
      add(derivation.derivedSkillId, derivation.derivedName);
    }
  }
  for (const skill of asArray(skillIcons)) {
    add(skill.id, generatedNames(skill.Names)[0] ?? skill.Name ?? skill.NameDesign);
  }
  return map;
}

function describeSource(template, skillNameMap) {
  const kind = sourceKind(template.source);
  const config = sourceConfig(template.source);
  const increment = sourceIncrement(template);
  const idList = (values) =>
    asArray(values).map((id) => {
      const numeric = Number(id);
      const name = skillNameMap.get(numeric);
      return name ? `${numeric} (${name})` : String(id);
    });

  const parts = [`kind=${kind}`];
  if (increment !== null) parts.push(`increment=${increment}`);
  if (config.hitsRequired !== undefined) parts.push(`hitsRequired=${config.hitsRequired}`);
  if (config.unitsRequired !== undefined) parts.push(`unitsRequired=${config.unitsRequired}`);
  if (config.tickIntervalMs !== undefined) parts.push(`tickIntervalMs=${config.tickIntervalMs}`);
  if (config.skillBaseIds !== undefined) parts.push(`skills=${idList(config.skillBaseIds).join(", ")}`);
  if (config.skillBaseId !== undefined) parts.push(`skill=${idList([config.skillBaseId]).join(", ")}`);
  if (config.skillKeys !== undefined) parts.push(`skillKeys=${idList(config.skillKeys).join(", ")}`);
  if (config.buffId !== undefined) parts.push(`buffId=${config.buffId}`);
  if (config.resourceId !== undefined) parts.push(`resourceId=${config.resourceId}`);
  if (config.attrId !== undefined) parts.push(`attrId=${config.attrId}`);
  if (config.metersRequired !== undefined) parts.push(`metersRequired=${config.metersRequired}`);
  if (config.sourceConfigId !== undefined) parts.push(`sourceConfigId=${config.sourceConfigId}`);
  if (config.hitFilter !== undefined) {
    parts.push(
      `hitFilter=${Object.entries(config.hitFilter)
        .map(([key, value]) => `${key}=${value}`)
        .join(",")}`,
    );
  }
  return parts.join("; ");
}

function riskNotes(row) {
  const notes = [];
  const kind = row.sourceKind;
  if (row.factorKind !== "inspiration") {
    notes.push(`not inspiration (${row.factorKind})`);
  }
  if (row.matchingSlots.length === 0) notes.push("no matching slot template");
  if (row.matchingSlots.length > 1) notes.push("multiple matching slot templates");
  if (row.sourceIncrement === null) notes.push("source has no increment");
  if (
    row.sourceIncrement !== null &&
    row.energyNumbers.length > 0 &&
    !row.energyNumbers.includes(row.sourceIncrement)
  ) {
    notes.push("source increment differs from numeric energy text");
  }
  if (row.slotThresholds.length > 0 && row.sourceIncrement !== null) {
    const anyEqual = row.slotThresholds.some((value) => value === row.sourceIncrement);
    if (!anyEqual) notes.push("slot threshold differs from source increment");
  }
  if (["anyDamage", "damageTaken"].includes(kind)) notes.push("broad trigger; needs controlled proof");
  if (["buffAdded", "buffLayerSpent", "buffDurationTick", "skillDurationTick", "movementDistance"].includes(kind)) {
    notes.push("stateful trigger; verify live packets/logs");
  }
  if (kind === "damageBySkillKeyOnce") notes.push("hit-proof once-per-batch trigger");
  if (row.energyNumbers.length === 0 && row.sourceIncrement !== null) {
    notes.push("description did not expose numeric grant; source increment is primary cap evidence");
  }
  if (row.timerSeconds.length > 0 && row.slotFreezeSeconds.length === 0) {
    notes.push("timer text exists but slot freeze is not configured; linked reset buff is timer evidence");
  }
  return notes;
}

const sourceTemplates = readJson(sourceTemplatesPath);
const slotTemplates = readJson(slotTemplatesPath);
const factorData = readJson(factorsPath);
const factors = Array.isArray(factorData)
  ? factorData
  : Object.values(factorData.factorsByBuffId ?? {});
const classSkillConfigs = readJson(classSkillConfigsPath);
const skillIcons = readJson(skillIconsPath);
const skillNameMap = buildSkillNameMap(classSkillConfigs, skillIcons);

const factorByItemId = new Map();
for (const factor of factors) {
  for (const grade of asArray(factor.modifierEvidence?.gradeRows)) {
    const itemId = Number(grade.itemId);
    if (!Number.isFinite(itemId)) continue;
    factorByItemId.set(itemId, {
      itemId,
      grade: grade.grade,
      buffId: factor.buffId,
      familyId: factor.familyId,
      familyName: displayFactorName(factor.familyName),
      familyNames: generatedNames(factor.familyNames),
      description: cleanText(grade.cleanResolvedDescription),
    });
  }
}

const slotByItemId = new Map();
for (const slot of slotTemplates) {
  for (const itemId of asArray(slot.itemIds).map(Number).filter(Number.isFinite)) {
    if (!slotByItemId.has(itemId)) slotByItemId.set(itemId, []);
    slotByItemId.get(itemId).push(slot);
  }
}

const rows = sourceTemplates.map((template) => {
  const itemIds = unique(asArray(template.itemIds).map(Number).filter(Number.isFinite));
  const factorsForItems = itemIds.map((itemId) => factorByItemId.get(itemId)).filter(Boolean);
  const familyNames = unique(factorsForItems.flatMap((factor) => [
    factor.familyName,
    ...factor.familyNames,
  ].map(cleanText)));
  const descriptions = unique([
    cleanText(template.description),
    ...factorsForItems.map((factor) => factor.description),
  ]);
  const matchingSlots = unique(itemIds.flatMap((itemId) => slotByItemId.get(itemId) ?? []));
  const matchingSlotRows = matchingSlots.map((slot) => ({
    slotTemplateId: slot.slotTemplateId,
    name: cleanText(slot.name),
    description: cleanText(slot.description),
    threshold: slot.slot?.threshold ?? null,
    resetBuffId: slot.slot?.resetBuffId ?? null,
    onBuffAdd: slot.slot?.onBuffAdd ?? "noOp",
    onBuffChange: slot.slot?.onBuffChange ?? "noOp",
    onBuffRemove: slot.slot?.onBuffRemove ?? "noOp",
    freezeSeconds: Number.isFinite(slot.slot?.freezeDurationMs)
      ? Number(slot.slot.freezeDurationMs) / 1000
      : null,
    effectBuffIds: asArray(slot.effectBuffIds),
  }));
  const text = [
    cleanText(template.name),
    cleanText(template.description),
    ...descriptions,
    ...matchingSlotRows.flatMap((slot) => [slot.name, slot.description]),
  ].join(" ");
  const sourceKindValue = sourceKind(template.source);
  const row = {
    sourceId: template.sourceId,
    className: classifyClass(template.sourceId, familyNames),
    factorKind: classifyFactorKind(familyNames, template.sourceId),
    sourceKind: sourceKindValue,
    sourceIncrement: sourceIncrement(template),
    displayCapEvidence: sourceIncrement(template),
    sourceSummary: describeSource(template, skillNameMap),
    sourceName: cleanText(template.name),
    sourceDescription: cleanText(template.description),
    familyNames,
    itemIds,
    matchingSlots: matchingSlotRows,
    slotThresholds: unique(matchingSlotRows.map((slot) => slot.threshold).filter((value) => value !== null)),
    slotFreezeSeconds: unique(matchingSlotRows.map((slot) => slot.freezeSeconds).filter((value) => value !== null)),
    resetBuffIds: unique(matchingSlotRows.map((slot) => slot.resetBuffId).filter((value) => value !== null)),
    timerSeconds: extractTimerWindows(text),
    energyNumbers: extractIllusionEnergyNumbers(text),
    firstDescription: descriptions.find(Boolean) ?? cleanText(template.description),
  };
  row.riskNotes = riskNotes(row);
  return row;
});

const inspirationRows = rows.filter((row) => row.factorKind === "inspiration");
const groupedByClass = new Map();
for (const row of inspirationRows) {
  if (!groupedByClass.has(row.className)) groupedByClass.set(row.className, []);
  groupedByClass.get(row.className).push(row);
}

const classSummaries = Array.from(groupedByClass.entries())
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([className, classRows]) => ({
    className,
    count: classRows.length,
    sourceKinds: Object.fromEntries(
      Array.from(new Set(classRows.map((row) => row.sourceKind))).sort().map((kind) => [
        kind,
        classRows.filter((row) => row.sourceKind === kind).length,
      ]),
    ),
    nullSlotThresholds: classRows.filter((row) => row.slotThresholds.length === 0).length,
    timerTextRows: classRows.filter((row) => row.timerSeconds.length > 0).length,
    riskyRows: classRows.filter((row) => row.riskNotes.some((note) => !note.startsWith("hit-proof"))).length,
    incrementTextMismatches: classRows.filter((row) =>
      row.riskNotes.includes("source increment differs from numeric energy text"),
    ).length,
  }));

const out = {
  summary: {
    sourceTemplates: sourceTemplates.length,
    inspirationRows: inspirationRows.length,
    excludedNonInspirationRows: rows.length - inspirationRows.length,
    classes: classSummaries.length,
  },
  classSummaries,
  inspirationRows,
  excludedRows: rows.filter((row) => row.factorKind !== "inspiration"),
};

fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, "inspiration-factor-audit.json");
const mdPath = path.join(outDir, "inspiration-factor-audit.md");
fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

const lines = [];
lines.push("# Inspiration Factor Audit");
lines.push("");
lines.push(`Source templates scanned: ${out.summary.sourceTemplates}`);
lines.push(`Inspiration source rows: ${out.summary.inspirationRows}`);
lines.push(`Non-Inspiration source rows excluded: ${out.summary.excludedNonInspirationRows}`);
lines.push(`Classes covered: ${out.summary.classes}`);
lines.push("");
lines.push("## Class Summary");
lines.push("");
for (const summary of classSummaries) {
  const kinds = Object.entries(summary.sourceKinds).map(([kind, count]) => `${kind}=${count}`).join(", ");
  lines.push(`- ${summary.className}: ${summary.count} rows; ${kinds}; nullSlotThresholds=${summary.nullSlotThresholds}; timerTextRows=${summary.timerTextRows}; riskyRows=${summary.riskyRows}; incrementTextMismatches=${summary.incrementTextMismatches}`);
}
lines.push("");
lines.push("## Cross-Class Consistency");
lines.push("");
const unmatchedSlots = inspirationRows.filter((row) => row.matchingSlots.length === 0);
const multiSlotRows = inspirationRows.filter((row) => row.matchingSlots.length > 1);
const incrementTextMismatches = inspirationRows.filter((row) =>
  row.riskNotes.includes("source increment differs from numeric energy text"),
);
const missingIncrementRows = inspirationRows.filter((row) => row.sourceIncrement === null);
lines.push(`- Missing matching slot templates: ${unmatchedSlots.length}`);
lines.push(`- Multiple matching slot templates: ${multiSlotRows.length}`);
lines.push(`- Missing source increments: ${missingIncrementRows.length}`);
lines.push(`- Source increment / energy text mismatches: ${incrementTextMismatches.length}`);
lines.push(`- Inspiration rows with source increment evidence for display cap: ${inspirationRows.filter((row) => row.displayCapEvidence !== null).length}`);
if (incrementTextMismatches.length > 0) {
  for (const row of incrementTextMismatches) {
    lines.push(`  - ${row.sourceId}: increment=${row.sourceIncrement}; energyText=${row.energyNumbers.join(",") || "-"}`);
  }
}
lines.push("");
lines.push("## Inspiration Rows By Class");
for (const [className, classRows] of Array.from(groupedByClass.entries()).sort(([a], [b]) => a.localeCompare(b))) {
  lines.push("");
  lines.push(`### ${className}`);
  for (const row of classRows.sort((a, b) => a.sourceId.localeCompare(b.sourceId))) {
    const slots = row.matchingSlots
      .map((slot) => `${slot.slotTemplateId}(threshold=${slot.threshold ?? "-"}, reset=${slot.resetBuffId ?? "-"})`)
      .join("; ") || "-";
    const family = row.familyNames[0] ?? row.sourceName;
    lines.push(`- ${row.sourceId} / ${family}`);
    lines.push(`  - source: ${row.sourceSummary}`);
    lines.push(`  - slots: ${slots}`);
    lines.push(`  - energyText=${row.energyNumbers.join(",") || "-"} timers=${row.timerSeconds.join(",") || "-"} resetBuffs=${row.resetBuffIds.join(",") || "-"}`);
    lines.push(`  - notes: ${row.riskNotes.join("; ") || "none"}`);
  }
}
lines.push("");
lines.push("## Excluded Non-Inspiration Source Rows");
lines.push("");
for (const row of out.excludedRows.sort((a, b) => a.sourceId.localeCompare(b.sourceId))) {
  lines.push(`- ${row.sourceId}: ${row.factorKind}; ${row.familyNames[0] ?? row.sourceName}; source=${row.sourceSummary}`);
}
fs.writeFileSync(mdPath, `${lines.join("\n")}\n`);

console.log(`Wrote ${path.relative(root, jsonPath)}`);
console.log(`Wrote ${path.relative(root, mdPath)}`);
console.log(`Inspiration rows: ${inspirationRows.length}`);
console.log(`Classes covered: ${classSummaries.length}`);
