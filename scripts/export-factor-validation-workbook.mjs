import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, "DEV_exports", "factor-validation-checklist.xlsx");

const SHEET_NAMES = [
  "Stormblade",
  "Wind Knight",
  "Frost Mage",
  "Marksman",
  "Shield Knight",
  "Heavy Guardian",
  "Verdant Oracle",
  "Beat Performer",
  "Twin Striker",
  "Polarity",
  "Stasis",
];

const PUBLIC_HEADERS = [
  "Validation Status",
  "Tester Notes",
  "Class",
  "Factor Type",
  "Slot",
  "Factor Name",
  "Selected Grade",
  "Description",
  "Energy Gain",
  "Energy Gain Varies By Grade",
  "Reality Threshold",
  "Threshold Varies By Grade",
  "Reality Carryover / Code Expectation",
  "Lockout Evidence",
  "Timer / Duration Evidence",
  "Energy Source / Trigger",
  "Associated Buffs",
  "Associated Skills / Damage",
  "Counter Rule Behavior",
  "Source Offset",
  "Buff ID",
  "Family ID",
  "Description ID",
  "Source Family Name",
];

const HIDDEN_HEADERS = [
  ...Array.from({ length: 10 }, (_, index) => `G${index + 1} Description`),
  ...Array.from({ length: 10 }, (_, index) => `G${index + 1} Energy Gain`),
  ...Array.from({ length: 10 }, (_, index) => `G${index + 1} Reality Threshold`),
  ...Array.from({ length: 10 }, (_, index) => `G${index + 1} Source Offset`),
];

const STATUS_OPTIONS = [
  "Untested",
  "Validated Working",
  "Bug Found",
  "Needs Review",
  "N/A",
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function asRows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/<break\s*\/?\s*>/gi, ". ")
    .replace(/<br\s*\/?\s*>/gi, ". ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function normalizeClassName(value) {
  const text = String(value ?? "").trim();
  if (/^(?:Twin Striker|Flame Berserker|Twin Striker)$/i.test(text)) return "Twin Striker";
  return text;
}

function normalizeFactorName(value) {
  return String(value ?? "")
    .replace(/\bTwin Striker\b/g, "Twin Striker")
    .replace(/\bFlame Berserker\b/g, "Twin Striker")
    .replace(/\bTwin Striker\b/g, "Twin Striker")
    .trim();
}

function isExpiredSeasonFactor(row) {
  const gradeRows = row.modifierEvidence?.gradeRows ?? [];
  const texts = [
    row.cleanDescriptions?.en,
    row.descriptions?.en,
    ...gradeRows.map((grade) => grade.cleanResolvedDescription),
  ].filter(Boolean).join(" ");

  return /expired\s+for\s+the\s+current\s+season/i.test(texts);
}

function factorTypeOf(name) {
  if (/\bPolarity\b/i.test(name)) return "Polarity";
  if (/\bStasis\b/i.test(name)) return "Stasis";
  if (/\bReality\b/i.test(name)) return "Reality";
  if (/\bRhapsody\b/i.test(name)) return "Rhapsody";
  return "Inspiration";
}

function slotOf(name) {
  return Number(String(name ?? "").match(/\bX\s*(\d+)\b/i)?.[1] ?? "") || "";
}

function classOf(name, factorType) {
  if (factorType === "Polarity") return "Polarity";
  if (factorType === "Stasis" && /^\s*Stasis\s+X\s*\d+\b/i.test(name)) return "Stasis";

  const patterns = [
    /^(.*?)\s+Reality(?:\s+Factor)?\s+X\s*\d+\b/i,
    /^(.*?)\s+Rhapsody\s+X\s*\d+\b/i,
    /^(.*?)\s+Stasis\s+X\s*\d+\b/i,
    /^(.*?)\s+X\s*\d+\b/i,
  ];

  for (const pattern of patterns) {
    const match = String(name ?? "").match(pattern);
    if (match?.[1]) return normalizeClassName(match[1]);
  }

  return "";
}

function localeName(row) {
  return row?.Names?.en
    ?? row?.DisplayNames?.en
    ?? row?.DisplayDetailNames?.en
    ?? row?.DamageNames?.en
    ?? row?.UnderlyingSkillNames?.en
    ?? row?.RecountNames?.en
    ?? row?.Name
    ?? row?.RecountName
    ?? row?.DisplayName
    ?? null;
}

function designName(row) {
  return row?.Names?.design
    ?? row?.DisplayNames?.design
    ?? row?.DisplayDetailNames?.design
    ?? row?.DamageNames?.design
    ?? row?.UnderlyingSkillNames?.design
    ?? row?.NameDesign
    ?? row?.DesignName
    ?? null;
}

function makeNameResolver() {
  const skillRows = asRows(readJson("parser-data/generated/skillnames.json"));
  const breakdownRows = asRows(readJson("parser-data/generated/SkillBreakdownDetails.json"));
  const recountRows = asRows(readJson("parser-data/generated/RecountTable.json"));
  const buffRows = asRows(readJson("parser-data/generated/BuffName.json"));

  const skillById = new Map(skillRows.map((row) => [Number(row.Id ?? row.id), row]).filter(([id]) => Number.isFinite(id)));
  const breakdownById = new Map();
  const breakdownByLinkedId = new Map();
  for (const row of breakdownRows) {
    const id = Number(row.Id ?? row.id);
    if (Number.isFinite(id)) breakdownById.set(id, row);
    const linkedIds = [
      row.LinkedId,
      ...(Array.isArray(row.LinkedIds) ? row.LinkedIds : []),
    ].map(Number).filter(Number.isFinite);
    for (const linkedId of linkedIds) {
      if (!breakdownByLinkedId.has(linkedId)) breakdownByLinkedId.set(linkedId, row);
    }
  }
  const recountById = new Map(recountRows.map((row) => [Number(row.Id ?? row.id), row]).filter(([id]) => Number.isFinite(id)));
  const recountByDamageId = new Map();
  for (const row of recountRows) {
    for (const id of (Array.isArray(row.DamageId) ? row.DamageId : [row.DamageId]).map(Number).filter(Number.isFinite)) {
      if (!recountByDamageId.has(id)) recountByDamageId.set(id, row);
    }
  }
  const buffById = new Map(buffRows.map((row) => [Number(row.Id ?? row.id), row]).filter(([id]) => Number.isFinite(id)));

  function resolve(id, kind = "any") {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) return "";

    const candidates = [];
    if (kind === "skill") {
      candidates.push(skillById.get(numericId), breakdownByLinkedId.get(numericId), breakdownById.get(numericId), recountByDamageId.get(numericId));
    } else if (kind === "buff") {
      candidates.push(buffById.get(numericId), breakdownByLinkedId.get(numericId), breakdownById.get(numericId));
    } else if (kind === "damage") {
      candidates.push(breakdownById.get(numericId), recountByDamageId.get(numericId), skillById.get(numericId), breakdownByLinkedId.get(numericId));
    } else if (kind === "recount") {
      candidates.push(recountById.get(numericId), skillById.get(numericId), breakdownByLinkedId.get(numericId));
    } else {
      candidates.push(skillById.get(numericId), breakdownById.get(numericId), breakdownByLinkedId.get(numericId), recountById.get(numericId), recountByDamageId.get(numericId), buffById.get(numericId));
    }

    const row = candidates.find(Boolean);
    const english = localeName(row);
    if (english) return `${english} (#${numericId})`;
    const design = designName(row);
    if (design) return `Unlocalized: ${design} (#${numericId})`;
    return `Unresolved (#${numericId})`;
  }

  return { resolve };
}

function valuesDiffer(values) {
  const normalized = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  return new Set(normalized).size > 1 ? "Yes" : normalized.length ? "No" : "";
}

function extractEnergyGain(text) {
  const matches = [...String(text ?? "").matchAll(/(?:grants?|gain(?:s|ed)?|restores?)\s+([0-9][0-9.,]*)\s+(?:Illusion\s+)?Energy/gi)];
  return matches.map((match) => match[1]).join("; ");
}

function extractRealityThreshold(text) {
  const matches = [...String(text ?? "").matchAll(/Illusion Energy reaches\s+([0-9][0-9.,]*)\s+points?/gi)];
  return matches.map((match) => match[1]).join("; ");
}

function extractLockout(text) {
  const source = String(text ?? "");
  const matches = [
    ...source.matchAll(/Can trigger at most once within\s+([0-9.]+\s*s(?:ec(?:ond)?s?)?)/gi),
    ...source.matchAll(/up to once every\s+([0-9.]+\s*s(?:ec(?:ond)?s?)?)/gi),
    ...source.matchAll(/once every\s+([0-9.]+\s*s(?:ec(?:ond)?s?)?)/gi),
  ];
  return [...new Set(matches.map((match) => cleanText(match[0])))].join("; ");
}

function extractDurations(text) {
  const source = String(text ?? "");
  const patterns = [
    /for\s+([0-9.]+\s*s(?:ec(?:ond)?s?)?)/gi,
    /within\s+([0-9.]+\s*s(?:ec(?:ond)?s?)?)/gi,
    /every\s+([0-9.]+\s*s(?:ec(?:ond)?s?)?)/gi,
    /lasting\s+([0-9.]+\s*s(?:ec(?:ond)?s?)?)/gi,
  ];
  const found = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(cleanText(match[0]));
  }
  return [...new Set(found)].join("; ");
}

function matchTemplates(factor, templates) {
  const factorItemIds = new Set((factor.modifierEvidence?.gradeRows ?? [])
    .map((row) => Number(row.itemId))
    .filter(Number.isFinite));
  return templates.filter((template) => (template.itemIds ?? []).some((id) => factorItemIds.has(Number(id))));
}

function formatIdList(ids, kind, resolver) {
  const unique = [...new Set((ids ?? []).map(Number).filter(Number.isFinite))];
  if (!unique.length) return "";
  return unique.map((id) => resolver.resolve(id, kind)).join("; ");
}

function formatSourceRule(sourceRule, resolver) {
  if (!sourceRule) return "";
  if (Array.isArray(sourceRule)) return sourceRule.map((item) => formatSourceRule(item, resolver)).filter(Boolean).join(" | ");

  const parts = [];
  if (sourceRule.skillCast) {
    const row = sourceRule.skillCast;
    parts.push(`Skill cast: ${formatIdList(row.skillBaseIds, "skill", resolver)} +${row.increment ?? "?"} energy`);
  }
  if (sourceRule.skillDurationTick) {
    const row = sourceRule.skillDurationTick;
    parts.push(`Skill duration tick: ${resolver.resolve(row.skillBaseId, "skill")} every ${formatMs(row.tickIntervalMs)} +${row.increment ?? "?"} energy`);
  }
  if (sourceRule.damageBySkillKey) {
    const row = sourceRule.damageBySkillKey;
    const filters = formatHitFilter(row.hitFilter);
    parts.push(`Damage by skill: ${formatIdList(row.skillKeys, "damage", resolver)}${filters ? ` (${filters})` : ""} +${row.increment ?? "?"} energy`);
  }
  if (sourceRule.damageBySkillKeyOnce) {
    const row = sourceRule.damageBySkillKeyOnce;
    parts.push(`Damage by skill once: ${formatIdList(row.skillKeys, "damage", resolver)} +${row.increment ?? "?"} energy`);
  }
  if (sourceRule.buffDurationTick) {
    const row = sourceRule.buffDurationTick;
    parts.push(`Buff duration tick: ${resolver.resolve(row.buffId, "buff")} every ${formatMs(row.tickIntervalMs)} +${row.increment ?? "?"} energy`);
  }
  if (sourceRule.buffLayerSpent) {
    const row = sourceRule.buffLayerSpent;
    parts.push(`Buff layer spent: ${resolver.resolve(row.buffId, "buff")} ${row.unitsRequired ?? "?"} layer(s) +${row.increment ?? "?"} energy`);
  }
  if (sourceRule.buffAdded) {
    const row = sourceRule.buffAdded;
    parts.push(`Buff added: ${resolver.resolve(row.buffId, "buff")} +${row.increment ?? "?"} energy`);
  }
  if (sourceRule.buffUpserted) {
    const row = sourceRule.buffUpserted;
    parts.push(`Buff added/updated: ${resolver.resolve(row.buffId, "buff")} +${row.increment ?? "?"} energy`);
  }
  if (sourceRule.fightResourceSpent) {
    const row = sourceRule.fightResourceSpent;
    parts.push(`Resource spent: resource #${row.resourceId ?? "?"}, ${row.unitsRequired ?? "?"} unit(s) +${row.increment ?? "?"} energy`);
  }
  if (sourceRule.movementDistance) {
    const row = sourceRule.movementDistance;
    parts.push(`Movement: ${row.metersRequired ?? "?"}m while ${resolver.resolve(row.buffId, "buff")} +${row.increment ?? "?"} energy`);
  }
  if (sourceRule.damageTaken) {
    const row = sourceRule.damageTaken;
    parts.push(`Damage taken +${row.increment ?? "?"} energy`);
  }
  if (sourceRule.anyDamage) {
    const row = sourceRule.anyDamage;
    const filters = formatHitFilter(row.hitFilter);
    parts.push(`Any damage${filters ? ` (${filters})` : ""} +${row.increment ?? "?"} energy`);
  }
  return parts.join("; ");
}

function formatHitFilter(filter) {
  if (!filter || typeof filter !== "object") return "";
  return Object.entries(filter)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key)
    .join(", ");
}

function formatMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "?";
  if (numeric % 1000 === 0) return `${numeric / 1000}s`;
  return `${numeric}ms`;
}

function formatSlotRule(slotTemplate, resolver) {
  const slot = slotTemplate?.slot ?? {};
  const parts = [];
  if (slot.threshold != null) parts.push(`threshold=${slot.threshold}`);
  if (slot.resetBuffId != null) parts.push(`reset/effect buff=${resolver.resolve(slot.resetBuffId, "buff")}`);
  if (slot.freezeDurationMs != null) parts.push(`lockout/freeze=${formatMs(slot.freezeDurationMs)}`);
  if (slot.onBuffAdd) parts.push(`onBuffAdd=${slot.onBuffAdd}`);
  if (slot.onBuffChange) parts.push(`onBuffChange=${slot.onBuffChange}`);
  if (slot.onBuffRemove) parts.push(`onBuffRemove=${slot.onBuffRemove}`);
  if (slot.countThresholdProcs != null) parts.push(`countThresholdProcs=${slot.countThresholdProcs}`);
  if (slot.countResetBuffProcs != null) parts.push(`countResetBuffProcs=${slot.countResetBuffProcs}`);
  return parts.join("; ");
}

function buildRows() {
  const factorData = readJson("parser-data/generated/SeasonPhantomFactors.json");
  const sourceTemplates = asRows(readJson("parser-data/app-rules/counter_source_templates.json"));
  const slotTemplates = asRows(readJson("parser-data/app-rules/counter_slot_templates.json"));
  const resolver = makeNameResolver();
  const rowsBySheet = new Map(SHEET_NAMES.map((name) => [name, []]));

  for (const factor of Object.values(factorData.factorsByBuffId ?? {})
    .filter((row) => !isExpiredSeasonFactor(row))
    .sort((left, right) => {
      const leftName = normalizeFactorName(left.familyNames?.en || left.familyName || "");
      const rightName = normalizeFactorName(right.familyNames?.en || right.familyName || "");
      const classCompare = classOf(leftName, factorTypeOf(leftName)).localeCompare(classOf(rightName, factorTypeOf(rightName)));
      if (classCompare) return classCompare;
      return (slotOf(leftName) || 0) - (slotOf(rightName) || 0) || leftName.localeCompare(rightName);
    })) {
    const sourceFamilyName = factor.familyNames?.en || factor.familyName || `Factor ${factor.buffId}`;
    const factorName = normalizeFactorName(sourceFamilyName);
    const factorType = factorTypeOf(sourceFamilyName);
    const className = classOf(sourceFamilyName, factorType);
    const sheetName = rowsBySheet.has(className) ? className : null;
    if (!sheetName) continue;

    const gradeRows = [...(factor.modifierEvidence?.gradeRows ?? [])]
      .sort((left, right) => (left.grade ?? 0) - (right.grade ?? 0));
    const descriptions = Array(10).fill("");
    const energyGains = Array(10).fill("");
    const thresholds = Array(10).fill("");
    const sourceOffsets = Array(10).fill("");
    const allText = [];

    for (const grade of gradeRows) {
      const gradeIndex = Number(grade.grade) - 1;
      if (gradeIndex < 0 || gradeIndex > 9) continue;
      const description = cleanText(grade.cleanResolvedDescription ?? factor.cleanDescriptions?.en ?? factor.descriptions?.en ?? "");
      descriptions[gradeIndex] = description;
      energyGains[gradeIndex] = extractEnergyGain(description);
      thresholds[gradeIndex] = extractRealityThreshold(description);
      sourceOffsets[gradeIndex] = grade.sourceOffset ?? "";
      allText.push(description);
    }

    const factorText = cleanText([factor.cleanDescriptions?.en, factor.descriptions?.en, ...allText].filter(Boolean).join(" "));
    const matchingSources = matchTemplates(factor, sourceTemplates);
    const matchingSlots = matchTemplates(factor, slotTemplates);
    const sourceRules = matchingSources.map((template) => formatSourceRule(template.source, resolver)).filter(Boolean);
    const slotRules = matchingSlots.map((template) => formatSlotRule(template, resolver)).filter(Boolean);
    const effectBuffIds = matchingSlots.flatMap((template) => template.effectBuffIds ?? []);
    const resetBuffIds = matchingSlots.map((template) => template.slot?.resetBuffId).filter(Boolean);
    const affectedDamageIds = [
      ...(factor.affectedDamageIds ?? []),
      ...matchingSources.flatMap((template) => extractSourceIds(template.source, ["damageBySkillKey", "damageBySkillKeyOnce"], ["skillKeys"])),
    ];
    const affectedSkillIds = matchingSources.flatMap((template) => extractSourceIds(template.source, ["skillCast", "skillDurationTick"], ["skillBaseIds", "skillBaseId"]));
    const affectedRecountIds = factor.affectedRecountIds ?? [];
    const associatedSkills = [
      formatIdList(affectedSkillIds, "skill", resolver),
      formatIdList(affectedDamageIds, "damage", resolver),
      formatIdList(affectedRecountIds, "recount", resolver),
    ].filter(Boolean).join("; ");
    const associatedBuffs = formatIdList([...effectBuffIds, ...resetBuffIds], "buff", resolver);

    rowsBySheet.get(sheetName).push({
      public: [
        "Untested",
        "",
        className,
        factorType,
        slotOf(factorName),
        factorName,
        10,
        null,
        null,
        valuesDiffer(energyGains),
        null,
        valuesDiffer(thresholds),
        factorType === "Reality" ? "Current parser model: threshold reset / no carry-over; validate in-game" : "N/A",
        extractLockout(factorText),
        extractDurations(factorText),
        sourceRules.join("; "),
        associatedBuffs,
        associatedSkills,
        slotRules.join("; "),
        null,
        factor.buffId ?? "",
        factor.familyId ?? "",
        factor.descriptionId ?? "",
        sourceFamilyName,
      ],
      hidden: [
        ...descriptions,
        ...energyGains,
        ...thresholds,
        ...sourceOffsets,
      ],
    });
  }

  for (const rows of rowsBySheet.values()) {
    rows.sort((left, right) => {
      const typeOrder = ["Inspiration", "Reality", "Stasis", "Rhapsody", "Polarity"];
      const typeCompare = typeOrder.indexOf(left.public[3]) - typeOrder.indexOf(right.public[3]);
      if (typeCompare) return typeCompare;
      return (Number(left.public[4]) || 0) - (Number(right.public[4]) || 0) || String(left.public[5]).localeCompare(String(right.public[5]));
    });
  }

  return rowsBySheet;
}

function extractSourceIds(sourceRule, sourceKeys, idKeys) {
  if (!sourceRule) return [];
  if (Array.isArray(sourceRule)) return sourceRule.flatMap((item) => extractSourceIds(item, sourceKeys, idKeys));
  const ids = [];
  for (const sourceKey of sourceKeys) {
    const row = sourceRule[sourceKey];
    if (!row) continue;
    for (const idKey of idKeys) {
      const value = row[idKey];
      if (Array.isArray(value)) ids.push(...value);
      else if (value != null) ids.push(value);
    }
  }
  return ids;
}

function columnName(index) {
  let current = index;
  let result = "";
  while (current > 0) {
    const rem = (current - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function xml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cell(ref, value, style = 0) {
  const styleAttr = style ? ` s="${style}"` : "";
  if (value == null) return `<c r="${ref}"${styleAttr}/>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t>${xml(value)}</t></is></c>`;
}

function formulaCell(ref, formula, style = 0) {
  const styleAttr = style ? ` s="${style}"` : "";
  return `<c r="${ref}"${styleAttr}><f>${xml(formula)}</f></c>`;
}

function rowXml(rowIndex, values, style = 0) {
  const cells = values.map((value, index) => cell(`${columnName(index + 1)}${rowIndex}`, value, style)).join("");
  return `<row r="${rowIndex}">${cells}</row>`;
}

function sheetXml(sheetName, rows) {
  const headers = [...PUBLIC_HEADERS, ...HIDDEN_HEADERS];
  const maxPublicCol = PUBLIC_HEADERS.length;
  const maxCol = headers.length;
  const maxRow = rows.length + 1;
  const descHiddenStart = maxPublicCol + 1;
  const energyHiddenStart = descHiddenStart + 10;
  const thresholdHiddenStart = energyHiddenStart + 10;
  const offsetHiddenStart = thresholdHiddenStart + 10;
  const descStart = columnName(descHiddenStart);
  const descEnd = columnName(descHiddenStart + 9);
  const energyStart = columnName(energyHiddenStart);
  const energyEnd = columnName(energyHiddenStart + 9);
  const thresholdStart = columnName(thresholdHiddenStart);
  const thresholdEnd = columnName(thresholdHiddenStart + 9);
  const offsetStart = columnName(offsetHiddenStart);
  const offsetEnd = columnName(offsetHiddenStart + 9);

  const sheetRows = [
    rowXml(1, headers, 1),
    ...rows.map((row, index) => {
      const rowIndex = index + 2;
      const values = [...row.public, ...row.hidden];
      const cells = values.map((value, columnIndex) => {
        const column = columnIndex + 1;
        const ref = `${columnName(column)}${rowIndex}`;
        if (column === 8) return formulaCell(ref, `INDEX($${descStart}${rowIndex}:$${descEnd}${rowIndex},$G${rowIndex})`, 2);
        if (column === 9) return formulaCell(ref, `INDEX($${energyStart}${rowIndex}:$${energyEnd}${rowIndex},$G${rowIndex})`, 2);
        if (column === 11) return formulaCell(ref, `INDEX($${thresholdStart}${rowIndex}:$${thresholdEnd}${rowIndex},$G${rowIndex})`, 2);
        if (column === 20) return formulaCell(ref, `INDEX($${offsetStart}${rowIndex}:$${offsetEnd}${rowIndex},$G${rowIndex})`, 0);
        const style = column === 2 || column === 8 || column === 14 || column === 15 || column === 16 || column === 17 || column === 18 || column === 19 ? 2 : 0;
        return cell(ref, value, style);
      }).join("");
      return `<row r="${rowIndex}">${cells}</row>`;
    }),
  ].join("");

  const dataValidationEndRow = Math.max(maxRow, 2);
  const statusList = STATUS_OPTIONS.join(",");
  const columnsXml = [
    `<col min="1" max="1" width="20" customWidth="1"/>`,
    `<col min="2" max="2" width="28" customWidth="1"/>`,
    `<col min="3" max="6" width="18" customWidth="1"/>`,
    `<col min="7" max="7" width="14" customWidth="1"/>`,
    `<col min="8" max="8" width="72" customWidth="1"/>`,
    `<col min="9" max="13" width="22" customWidth="1"/>`,
    `<col min="14" max="19" width="42" customWidth="1"/>`,
    `<col min="20" max="24" width="18" customWidth="1"/>`,
    `<col min="${maxPublicCol + 1}" max="${maxCol}" hidden="1"/>`,
  ].join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${columnName(maxCol)}${Math.max(maxRow, 1)}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${columnsXml}</cols>
  <sheetData>${sheetRows}</sheetData>
  <autoFilter ref="A1:${columnName(maxPublicCol)}${Math.max(maxRow, 1)}"/>
  <dataValidations count="2">
    <dataValidation type="list" allowBlank="1" sqref="A2:A${dataValidationEndRow}"><formula1>"${xml(statusList)}"</formula1></dataValidation>
    <dataValidation type="list" allowBlank="0" sqref="G2:G${dataValidationEndRow}"><formula1>"1,2,3,4,5,6,7,8,9,10"</formula1></dataValidation>
  </dataValidations>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function workbookXml(sheetNames) {
  const sheets = sheetNames.map((name, index) => (
    `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr date1904="false"/>
  <sheets>${sheets}</sheets>
  <calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>
</workbook>`;
}

function workbookRelsXml(sheetNames) {
  const rels = sheetNames.map((_, index) => (
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels}
  <Relationship Id="rId${sheetNames.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function contentTypesXml(sheetNames) {
  const overrides = sheetNames.map((_, index) => (
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${overrides}
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF262626"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function dosDateTime(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  return {
    time: (hours << 11) | (minutes << 5) | seconds,
    date: ((year - 1980) << 9) | (month << 5) | day,
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function createZip(files) {
  const now = dosDateTime(new Date());
  const chunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name.replace(/\\/g, "/"), "utf8");
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, "utf8");
    const crc = crc32(content);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(now.time),
      u16(now.date),
      u32(crc),
      u32(content.length),
      u32(content.length),
      u16(nameBuffer.length),
      u16(0),
      nameBuffer,
    ]);

    chunks.push(local, content);
    centralChunks.push(Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(now.time),
      u16(now.date),
      u32(crc),
      u32(content.length),
      u32(content.length),
      u16(nameBuffer.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuffer,
    ]));
    offset += local.length + content.length;
  }

  const centralStart = offset;
  const central = Buffer.concat(centralChunks);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(centralStart),
    u16(0),
  ]);

  return Buffer.concat([...chunks, central, eocd]);
}

function buildWorkbook(rowsBySheet) {
  const files = [
    { name: "[Content_Types].xml", content: contentTypesXml(SHEET_NAMES) },
    { name: "_rels/.rels", content: rootRelsXml() },
    { name: "xl/workbook.xml", content: workbookXml(SHEET_NAMES) },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRelsXml(SHEET_NAMES) },
    { name: "xl/styles.xml", content: stylesXml() },
    ...SHEET_NAMES.map((sheetName, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: sheetXml(sheetName, rowsBySheet.get(sheetName) ?? []),
    })),
  ];
  return createZip(files);
}

function main() {
  const rowsBySheet = buildRows();
  const workbook = buildWorkbook(rowsBySheet);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, workbook);

  const summary = Object.fromEntries([...rowsBySheet.entries()].map(([sheetName, rows]) => [sheetName, rows.length]));
  const totalRows = Object.values(summary).reduce((sum, count) => sum + count, 0);
  console.log(`${OUT_PATH}`);
  console.log(`factor rows=${totalRows}`);
  console.log(JSON.stringify(summary, null, 2));
}

main();
