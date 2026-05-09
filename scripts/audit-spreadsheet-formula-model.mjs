#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const repoRoot = process.cwd();
const DEFAULT_LATEST_INPUTS = 3;
const DEFAULT_DEFENSE_CONSTANT = 6500;
const ATTR_ATTACK_POWER = 50;
const ATTR_TARGET_DEFENSE = 51;
const ATTR_CRIT_MULTIPLIER = 0x2b66;

const SHEET_CATEGORY_MODEL = [
  {
    id: "genericDamage",
    label: "DMG (%)",
    sheetRefs: ["Damage Modifiers!C172", "Iaido Slash!C45:C47", "Thunder Cut!C45:C47", "Flash Strike!C33:C34"],
    runtimeTerms: ["genericDamagePct"],
    componentKeys: ["generic-damage"],
    contributionMath: "additive-category-share",
    replayStatus: "candidate",
  },
  {
    id: "elementalDamage",
    label: "Elemental DMG (%)",
    sheetRefs: ["Damage Modifiers!C155", "Iaido Slash!C49:C52", "Thunder Cut!C49:C52", "Flash Strike!C36:C38"],
    runtimeTerms: ["elementalDamagePct"],
    componentKeys: ["elemental-damage"],
    contributionMath: "additive-category-share",
    replayStatus: "candidate",
  },
  {
    id: "versatilityDamage",
    label: "Versatility DMG (%)",
    sheetRefs: ["Damage Modifiers!C185"],
    runtimeTerms: ["versatilityDamagePct"],
    componentKeys: ["versatility-damage"],
    contributionMath: "additive-category-share",
    replayStatus: "candidate",
  },
  {
    id: "criticalDamage",
    label: "Crit DMG (%)",
    sheetRefs: ["Damage Modifiers!C179", "Iaido Slash!C38:C40", "Thunder Cut!C38:C40", "Flash Strike!C26:C28"],
    runtimeTerms: ["critMultiplier"],
    componentKeys: ["critical-damage"],
    contributionMath: "crit-snapshot-share",
    replayStatus: "snapshot-required",
  },
  {
    id: "criticalRate",
    label: "Crit (%)",
    sheetRefs: ["Damage Modifiers!C121", "Iaido Slash!C12:C14", "Thunder Cut!C12:C14", "Flash Strike!C11:C13"],
    runtimeTerms: ["critMultiplier"],
    componentKeys: ["critical-rate"],
    contributionMath: "expected-value-only",
    replayStatus: "toggle-proof-required",
  },
  {
    id: "primaryAttack",
    label: "ATK / MATK",
    sheetRefs: ["Damage Modifiers!C107", "Damage Modifiers!C127"],
    runtimeTerms: ["primaryAttack"],
    componentKeys: ["atk", "matk", "attack", "primary-attack"],
    contributionMath: "effective-attack-marginal",
    replayStatus: "blocked-missing-pre-buff-stat",
  },
  {
    id: "targetArmorMitigation",
    label: "Armor Reduction / Armor Penetration",
    sheetRefs: ["Damage Modifiers!C82:C86", "Iaido Slash!C17:C22", "Thunder Cut!C17:C22"],
    runtimeTerms: ["targetArmorMitigation"],
    componentKeys: ["armor-reduction", "armor-penetration"],
    contributionMath: "defense-marginal",
    replayStatus: "snapshot-required",
  },
  {
    id: "resistance",
    label: "Resistance",
    sheetRefs: [],
    runtimeTerms: ["resistance"],
    componentKeys: ["resistance"],
    contributionMath: "resistance-marginal",
    replayStatus: "not-modeled-by-this-sheet",
  },
  {
    id: "phyBoost",
    label: "PHY Boost (%)",
    sheetRefs: ["Damage Modifiers!C194", "Iaido Slash!C54:C55", "Thunder Cut!C54:C55", "Flash Strike!C40:C41"],
    runtimeTerms: [],
    componentKeys: [],
    contributionMath: "additive-category-share",
    replayStatus: "spreadsheet-only-unmapped",
  },
  {
    id: "unityDamage",
    label: "Unity DMG (%)",
    sheetRefs: ["Damage Modifiers!C197", "Iaido Slash!C57:C58", "Thunder Cut!C57:C58", "Flash Strike!C43:C44"],
    runtimeTerms: [],
    componentKeys: [],
    contributionMath: "additive-category-share",
    replayStatus: "spreadsheet-only-unmapped",
  },
  {
    id: "dreamDamage",
    label: "Dream DMG (%)",
    sheetRefs: ["Damage Modifiers!C201", "Iaido Slash!C60:C63", "Thunder Cut!C60:C63", "Flash Strike!C46:C49"],
    runtimeTerms: [],
    componentKeys: [],
    contributionMath: "additive-category-share",
    replayStatus: "spreadsheet-only-unmapped",
  },
];

const COMPONENT_TO_CATEGORY = new Map(
  SHEET_CATEGORY_MODEL.flatMap((category) => category.componentKeys.map((key) => [key, category]))
);

function parseArgs(argv) {
  const options = {
    sheet: path.join(repoRoot, "DEV_exports", "damage-simulation-sheet.xlsx"),
    inputs: [],
    latest: DEFAULT_LATEST_INPUTS,
    outJson: path.join(repoRoot, "DEV_exports", "spreadsheet-formula-model-audit.json"),
    outMd: path.join(repoRoot, "DEV_exports", "spreadsheet-formula-model-audit.md"),
    maxRows: 80,
    defenseConstant: DEFAULT_DEFENSE_CONSTANT,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };

    switch (arg) {
      case "--sheet":
        options.sheet = path.resolve(next());
        break;
      case "--input":
        options.inputs.push(path.resolve(next()));
        break;
      case "--latest":
        options.latest = Number(next());
        break;
      case "--out-json":
        options.outJson = path.resolve(next());
        break;
      case "--out-md":
        options.outMd = path.resolve(next());
        break;
      case "--max-rows":
        options.maxRows = Number(next());
        break;
      case "--defense-constant":
        options.defenseConstant = Number(next());
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Spreadsheet Formula Model Audit

Usage:
  node scripts/audit-spreadsheet-formula-model.mjs [options]

Options:
  --sheet <path>       XLSX formula workbook. Default: DEV_exports/damage-simulation-sheet.xlsx
  --input <file>       Modifier entity export. Repeatable.
  --latest <count>     When --input is omitted, scan latest DEV_exports/modifier-entity-*.json files. Default: ${DEFAULT_LATEST_INPUTS}
  --out-json <path>    JSON report path. Default: DEV_exports/spreadsheet-formula-model-audit.json
  --out-md <path>      Markdown report path. Default: DEV_exports/spreadsheet-formula-model-audit.md
  --max-rows <count>   Max Markdown rows per table. Default: 80
  --defense-constant <n> Sheet defense constant. Default: ${DEFAULT_DEFENSE_CONSTANT}
  --help               Show this help.

Notes:
  This is dev-only evidence. It extracts the spreadsheet formula model and
  replays saved hit samples against category math. It does not change runtime
  contribution totals.
`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readGenerated(fileName) {
  return readJson(path.join(repoRoot, "parser-data", "generated", fileName));
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatNumber(value, digits = 0) {
  const number = finiteNumber(value);
  if (number === null) return "";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(number);
}

function formatPct(value, digits = 1) {
  const number = finiteNumber(value);
  if (number === null) return "";
  return `${(number * 100).toFixed(digits)}%`;
}

function markdownTable(headers, rows) {
  const escape = (value) => String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
  ].join("\n");
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, number) => String.fromCodePoint(Number(number)));
}

function xmlAttr(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`).exec(tag);
  return match ? decodeXml(match[1]) : "";
}

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  throw new Error("XLSX zip end-of-central-directory record was not found.");
}

function readZipEntries(filePath) {
  const buffer = fs.readFileSync(filePath);
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let offset = centralDirOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid XLSX central directory header at ${offset}.`);
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid XLSX local file header for ${name}.`);
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      data = zlib.inflateRawSync(raw);
    } else {
      throw new Error(`Unsupported XLSX compression method ${method} for ${name}.`);
    }
    entries.set(name, data.toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function parseSharedStrings(entries) {
  const xml = entries.get("xl/sharedStrings.xml");
  if (!xml) return [];
  const strings = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const parts = [];
    for (const textMatch of match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
      parts.push(decodeXml(textMatch[1]));
    }
    strings.push(parts.join(""));
  }
  return strings;
}

function normalizeWorkbookTarget(target) {
  if (target.startsWith("/")) return target.slice(1);
  if (target.startsWith("xl/")) return target;
  return `xl/${target}`;
}

function parseWorkbook(entries) {
  const workbookXml = entries.get("xl/workbook.xml");
  const relsXml = entries.get("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) throw new Error("XLSX workbook metadata is missing.");

  const rels = new Map();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = match[1];
    rels.set(xmlAttr(attrs, "Id"), normalizeWorkbookTarget(xmlAttr(attrs, "Target")));
  }

  const sheets = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = match[1];
    sheets.push({
      name: xmlAttr(attrs, "name"),
      id: xmlAttr(attrs, "sheetId"),
      state: xmlAttr(attrs, "state") || "visible",
      path: rels.get(xmlAttr(attrs, "r:id")),
    });
  }

  const definedNames = {};
  for (const match of workbookXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    definedNames[xmlAttr(match[1], "name")] = decodeXml(match[2]);
  }

  return { sheets, definedNames };
}

function parseWorksheet(xml, sharedStrings) {
  const cells = new Map();
  for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = match[1];
    const body = match[2];
    const coordinate = xmlAttr(attrs, "r");
    if (!coordinate) continue;
    const type = xmlAttr(attrs, "t");
    const formulaMatch = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body);
    const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
    const inlineMatch = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body);
    let value = "";
    if (valueMatch) {
      value = decodeXml(valueMatch[1]);
      if (type === "s") {
        value = sharedStrings[Number(value)] ?? value;
      }
    } else if (inlineMatch) {
      value = [...inlineMatch[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join("");
    }
    cells.set(coordinate, {
      coordinate,
      formula: formulaMatch ? decodeXml(formulaMatch[1]) : "",
      value,
    });
  }
  return cells;
}

function readWorkbookModel(filePath) {
  const entries = readZipEntries(filePath);
  const sharedStrings = parseSharedStrings(entries);
  const workbook = parseWorkbook(entries);
  const sheets = new Map();

  for (const sheet of workbook.sheets) {
    if (!sheet.path || !entries.has(sheet.path)) continue;
    sheets.set(sheet.name, {
      ...sheet,
      cells: parseWorksheet(entries.get(sheet.path), sharedStrings),
    });
  }

  return {
    filePath,
    sheetCount: workbook.sheets.length,
    sheets,
    definedNames: workbook.definedNames,
  };
}

function cellValue(workbook, sheetName, coordinate) {
  const cell = workbook.sheets.get(sheetName)?.cells.get(coordinate);
  return cell?.formula ? `=${cell.formula}` : cell?.value ?? "";
}

function sheetFormulaCount(sheet) {
  let formulas = 0;
  let nonempty = 0;
  for (const cell of sheet.cells.values()) {
    if (cell.formula || cell.value !== "") nonempty += 1;
    if (cell.formula) formulas += 1;
  }
  return { formulas, nonempty };
}

function extractSheetFormulaModel(workbook) {
  const sheetSummaries = [...workbook.sheets.values()].map((sheet) => ({
    name: sheet.name,
    state: sheet.state,
    ...sheetFormulaCount(sheet),
  }));

  const withFallback = (value, fallback) => value || fallback;
  const importantCells = {
    defenseReduction: withFallback(cellValue(workbook, "Damage Modifiers", "C86"), "=(C85) / (C85 + B81)"),
    effectiveAtk: withFallback(cellValue(workbook, "Damage Modifiers", "C127"), "=C107*(1-C86)+C115+C119"),
    totalAtk: cellValue(workbook, "Damage Modifiers", "C107"),
    refinedAtk: cellValue(workbook, "Damage Modifiers", "C115"),
    elementalAtk: cellValue(workbook, "Damage Modifiers", "C119"),
    masterySkillDamage: cellValue(workbook, "Damage Modifiers", "C136"),
    elementalDamage: withFallback(cellValue(workbook, "Damage Modifiers", "C155"), "=C145+C153+E155"),
    genericDamage: cellValue(workbook, "Damage Modifiers", "C172"),
    critDamage: withFallback(cellValue(workbook, "Damage Modifiers", "C179"), "=C177"),
    versatilityDamage: cellValue(workbook, "Damage Modifiers", "C185"),
    physicalBoost: withFallback(cellValue(workbook, "Damage Modifiers", "C194"), "=SUM(C189:C191,B194)"),
    unityDamage: withFallback(cellValue(workbook, "Damage Modifiers", "C197"), "=$C$19"),
    dreamDamage: cellValue(workbook, "Damage Modifiers", "C201"),
    iaidoEffectiveSkill: cellValue(workbook, "Iaido Slash", "C75"),
    iaidoFinalNoCrit: cellValue(workbook, "Iaido Slash", "C76"),
    iaidoAverage: cellValue(workbook, "Iaido Slash", "C77"),
    thunderEffectiveSkill: cellValue(workbook, "Thunder Cut", "C75"),
    thunderFinalNoCrit: cellValue(workbook, "Thunder Cut", "C76"),
    flashEffectiveSkill: cellValue(workbook, "Flash Strike", "C60"),
    flashFinalNoCrit: cellValue(workbook, "Flash Strike", "C61"),
  };

  return {
    workbook: {
      filePath: workbook.filePath,
      sheetCount: workbook.sheetCount,
      sheetSummaries,
      definedNames: workbook.definedNames,
    },
    formulaPipeline: [
      "Sum flat and percent stat buckets into current combat stats.",
      "Compute target mitigation as finalArmor / (finalArmor + 6500).",
      "Compute effective ATK as ATK * (1 - mitigation) + elementalAttack + refinedAttack.",
      "Compute skill base damage as effectiveATK * skillCoefficient * skillSpecificMultiplier + skillFlat.",
      "Sum each damage category additively inside its category.",
      "Multiply categories together for final non-crit damage.",
      "Apply crit multiplier only on crit hits and use crit rate only for expected/average damage.",
    ],
    importantCells,
    categories: SHEET_CATEGORY_MODEL,
  };
}

function latestModifierEntityInputs(options) {
  const dir = path.join(repoRoot, "DEV_exports");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^modifier-entity-.+\.json$/i.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
    .slice(0, Math.max(0, options.latest));
}

function attrRawValue(attr) {
  if (!attr || typeof attr !== "object") return null;
  const direct = attr.valueInt ?? attr.valueFloat ?? attr.Int ?? attr.Float;
  if (direct !== undefined && direct !== null) return finiteNumber(direct);
  if (attr.value && typeof attr.value === "object") {
    return finiteNumber(attr.value.Int ?? attr.value.Float ?? attr.value.Double);
  }
  return finiteNumber(attr.value);
}

function attrValue(attrs, attrId) {
  for (const attr of asArray(attrs)) {
    if (finiteNumber(attr?.attrId) === attrId) return attrRawValue(attr);
  }
  return null;
}

function decimalAttrValue(attrs, attrId) {
  const raw = attrValue(attrs, attrId);
  return raw === null ? null : raw / 10000;
}

function critMultiplierSnapshot(sample) {
  if (!sample?.isCrit) return 1;
  const value = decimalAttrValue(sample.attackerAttrs, ATTR_CRIT_MULTIPLIER);
  return value !== null && value > 1 ? value : null;
}

function sampleValue(sample) {
  return positiveNumber(sample?.effectiveValue) ?? positiveNumber(sample?.value) ?? positiveNumber(sample?.hpLossValue);
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function sampleActorUid(sample) {
  return finiteNumber(sample?.originalAttackerUid ?? sample?.attackerUid ?? sample?.topSummonerUid);
}

function activeModifierEntries(sample) {
  const entries = [];
  for (const modifier of asArray(sample?.activeModifiers)) {
    for (const field of ["modifierBaseId", "modifierSourceConfigId"]) {
      const id = finiteNumber(modifier?.[field]);
      if (id === null) continue;
      entries.push({
        buffId: id,
        field,
        modifierBaseId: finiteNumber(modifier?.modifierBaseId),
        modifierSourceConfigId: finiteNumber(modifier?.modifierSourceConfigId),
        modifierHostUid: finiteNumber(modifier?.modifierHostUid),
        modifierSourceUid: finiteNumber(modifier?.modifierSourceUid),
        modifierLayer: finiteNumber(modifier?.modifierLayer),
      });
    }
  }
  return entries;
}

function buildIndexes() {
  const recount = readGenerated("ModifierRecountTable.json");
  const contribution = readGenerated("ModifierContributionRuntime.json");
  const display = readGenerated("ModifierDisplayTable.json");
  const skillDetails = readGenerated("SkillBreakdownDetails.json");
  const damageRows = readGenerated("DamageAttrIdName.json");
  const ruleIdsByBuffId = new Map();
  for (const [buffId, rules] of Object.entries(recount.byBuffId ?? {})) {
    ruleIdsByBuffId.set(String(buffId), asArray(rules).map(String));
  }
  return {
    recount,
    contribution,
    display,
    skillDetails,
    damageRows,
    ruleIdsByBuffId,
  };
}

function localizedName(map, fallback = "") {
  if (map && typeof map === "object" && !Array.isArray(map)) {
    return map.en ?? map.design ?? Object.values(map).find((value) => typeof value === "string" && value.trim()) ?? fallback;
  }
  return fallback;
}

function sourceLabel(ruleId, indexes) {
  const display = indexes.display.sourcesByRuleId?.[ruleId];
  const contribution = indexes.contribution.sourcesByRuleId?.[ruleId];
  const recount = indexes.recount.sourcesById?.[ruleId];
  return display?.sourceName ?? display?.name ?? recount?.sourceName ?? contribution?.sourceId ?? ruleId;
}

function damageDisplayName(damageId, indexes) {
  const key = String(damageId);
  const detail = indexes.skillDetails[key] ?? {};
  const damage = indexes.damageRows[key] ?? {};
  return (
    localizedName(detail.names) ||
    localizedName(detail.damageNames) ||
    localizedName(damage.Names) ||
    damage.Name ||
    damage.NameDesign ||
    ""
  );
}

function activeRuleLinks(sample, indexes) {
  const byRule = new Map();
  for (const entry of activeModifierEntries(sample)) {
    for (const ruleId of indexes.ruleIdsByBuffId.get(String(entry.buffId)) ?? []) {
      const current = byRule.get(ruleId) ?? {
        ruleId,
        buffIds: new Set(),
        entries: [],
      };
      current.buffIds.add(entry.buffId);
      current.entries.push(entry);
      byRule.set(ruleId, current);
    }
  }
  return [...byRule.values()].map((link) => ({
    ...link,
    buffIds: [...link.buffIds].sort((left, right) => left - right),
  }));
}

function sourceUidForLink(link) {
  return link.entries.find((entry) => entry.modifierSourceUid !== null)?.modifierSourceUid ?? null;
}

function selectedScopeForLink(link, sample) {
  const sourceUid = sourceUidForLink(link);
  const actorUid = sampleActorUid(sample);
  return sourceUid !== null && actorUid !== null && sourceUid === actorUid ? "owner" : "party";
}

function hintValues(hint) {
  if (Array.isArray(hint?.values) && hint.values.length) return hint.values;
  const decimal = finiteNumber(hint?.decimalValue);
  if (decimal !== null) {
    return [
      {
        scope: hint.valueScope ?? hint.scope ?? "global",
        decimalValue: decimal,
        rawText: hint.rawText ?? "",
      },
    ];
  }
  return [];
}

function selectHintValue(hint, selectedScope) {
  const values = hintValues(hint);
  if (!values.length) return { status: "missing-value" };
  const exactScope = values.filter((value) => String(value.scope ?? "").toLowerCase() === selectedScope);
  if (exactScope.length === 1) return { status: "ok", value: exactScope[0], reason: `scope:${selectedScope}` };
  const global = values.filter((value) => ["", "global", "all"].includes(String(value.scope ?? "").toLowerCase()));
  if (global.length === 1) return { status: "ok", value: global[0], reason: "global" };
  if (values.length === 1) return { status: "ok", value: values[0], reason: "single" };
  return { status: "ambiguous-value", values };
}

function formulaActionsForSample(sample, indexes, blocked) {
  const actions = [];
  for (const link of activeRuleLinks(sample, indexes)) {
    const sourceRule = indexes.contribution.sourcesByRuleId?.[link.ruleId];
    if (!sourceRule || sourceRule.contributionMode !== "formula-replay-candidate") continue;
    const selectedScope = selectedScopeForLink(link, sample);
    for (const hint of asArray(sourceRule.componentValueHints)) {
      const componentKey = String(hint.componentKey ?? "").toLowerCase();
      const category = COMPONENT_TO_CATEGORY.get(componentKey);
      if (!category) {
        blocked.unmappedComponentKeys[componentKey] = (blocked.unmappedComponentKeys[componentKey] ?? 0) + 1;
        continue;
      }
      const selected = selectHintValue(hint, selectedScope);
      if (selected.status !== "ok") {
        blocked.valueSelection[selected.status] = (blocked.valueSelection[selected.status] ?? 0) + 1;
        continue;
      }
      const amount = finiteNumber(selected.value.decimalValue);
      if (amount === null || !Number.isFinite(amount)) {
        blocked.valueSelection["non-numeric-value"] = (blocked.valueSelection["non-numeric-value"] ?? 0) + 1;
        continue;
      }
      actions.push({
        ruleId: link.ruleId,
        sourceId: sourceRule.sourceId,
        label: sourceLabel(link.ruleId, indexes),
        categoryId: category.id,
        categoryLabel: category.label,
        componentKey,
        amount,
        selectedScope,
        valueScope: selected.value.scope ?? selectedScope,
        sourceUid: sourceUidForLink(link),
        rawText: selected.value.rawText ?? "",
        contributionMath: category.contributionMath,
        replayStatus: category.replayStatus,
      });
    }
  }
  return collapseFormulaActions(actions);
}

function collapseFormulaActions(actions) {
  const byKey = new Map();
  for (const action of actions) {
    const key = `${action.ruleId}:${action.categoryId}:${action.componentKey}:${action.amount}:${action.selectedScope}`;
    if (!byKey.has(key)) byKey.set(key, action);
  }
  return [...byKey.values()];
}

function percentile(sortedValues, pct) {
  if (!sortedValues.length) return null;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((sortedValues.length - 1) * pct)));
  return sortedValues[index];
}

function summarize(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!sorted.length) {
    return {
      count: 0,
      min: null,
      p05: null,
      avg: null,
      p95: null,
      max: null,
      spreadPct: null,
    };
  }
  const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const p05 = percentile(sorted, 0.05);
  const p95 = percentile(sorted, 0.95);
  return {
    count: sorted.length,
    min: sorted[0],
    p05,
    avg,
    p95,
    max: sorted[sorted.length - 1],
    spreadPct: avg > 0 && p05 !== null && p95 !== null ? (p95 - p05) / avg : null,
  };
}

function makeDamageRow(damageId, indexes) {
  return {
    damageId,
    displayName: damageDisplayName(damageId, indexes),
    hits: 0,
    totalValue: 0,
    critHits: 0,
    luckyHits: 0,
    samplesWithAttack: 0,
    samplesWithDefense: 0,
    samplesWithCritMultiplier: 0,
    attackRatios: [],
    defenseAdjustedRatios: [],
    activeCategoryHits: {},
    blockers: {},
  };
}

function addBlocker(target, key, count = 1) {
  target[key] = (target[key] ?? 0) + count;
}

function contributionKey(action) {
  return `${action.ruleId}:${action.categoryId}:${action.componentKey}:${action.amount}:${action.selectedScope}`;
}

function addContribution(map, action, field, amount, damageId) {
  const key = contributionKey(action);
  const row = map.get(key) ?? {
    ruleId: action.ruleId,
    sourceId: action.sourceId,
    label: action.label,
    categoryId: action.categoryId,
    categoryLabel: action.categoryLabel,
    componentKey: action.componentKey,
    amount: action.amount,
    selectedScope: action.selectedScope,
    valueScope: action.valueScope,
    hits: 0,
    finalContribution: 0,
    damageRows: new Set(),
  };
  row.hits += 1;
  row[field] += amount;
  row.damageRows.add(String(damageId));
  map.set(key, row);
}

function analyzeSample(sample, filePath, indexes, rows, totals, options) {
  if (sample?.isHeal) return;
  const damageId = finiteNumber(sample?.damageId ?? sample?.skillKey);
  const value = sampleValue(sample);
  if (damageId === null || value === null) return;

  const row = rows.get(String(damageId)) ?? makeDamageRow(damageId, indexes);
  rows.set(String(damageId), row);
  row.hits += 1;
  row.totalValue += value;
  if (sample.isCrit) row.critHits += 1;
  if (sample.isLucky) row.luckyHits += 1;
  totals.samplesScanned += 1;
  totals.finalDamage += value;

  const attackPower = attrValue(sample.attackerAttrs, ATTR_ATTACK_POWER);
  const targetDefense = attrValue(sample.targetAttrs, ATTR_TARGET_DEFENSE);
  const critMultiplier = critMultiplierSnapshot(sample);
  const decritValue = critMultiplier !== null && critMultiplier > 0 ? value / critMultiplier : null;

  if (attackPower !== null && attackPower > 0 && decritValue !== null) {
    row.samplesWithAttack += 1;
    row.attackRatios.push(decritValue / attackPower);
  } else {
    addBlocker(row.blockers, "missing-attack-or-crit-snapshot");
    totals.blockers["missing-attack-or-crit-snapshot"] = (totals.blockers["missing-attack-or-crit-snapshot"] ?? 0) + 1;
  }

  if (targetDefense !== null) row.samplesWithDefense += 1;
  if (critMultiplier !== null) row.samplesWithCritMultiplier += 1;
  if (attackPower !== null && attackPower > 0 && targetDefense !== null && targetDefense >= 0 && decritValue !== null) {
    const mitigation = targetDefense / (targetDefense + options.defenseConstant);
    const defenseAdjustedAttack = attackPower * (1 - mitigation);
    if (defenseAdjustedAttack > 0) {
      row.defenseAdjustedRatios.push(decritValue / defenseAdjustedAttack);
    }
  }

  const blocked = totals.blockedActionReasons;
  const actions = formulaActionsForSample(sample, indexes, blocked);
  if (!actions.length) return;
  totals.samplesWithFormulaActions += 1;

  const categoryAmounts = new Map();
  for (const action of actions) {
    row.activeCategoryHits[action.categoryId] = (row.activeCategoryHits[action.categoryId] ?? 0) + 1;
    totals.categoryHits[action.categoryId] = (totals.categoryHits[action.categoryId] ?? 0) + 1;
    if (action.contributionMath === "additive-category-share") {
      categoryAmounts.set(action.categoryId, (categoryAmounts.get(action.categoryId) ?? 0) + action.amount);
    }
  }

  for (const action of actions) {
    if (action.contributionMath === "additive-category-share") {
      const categorySum = categoryAmounts.get(action.categoryId) ?? 0;
      if (categorySum <= -0.95) {
        addBlocker(row.blockers, "invalid-additive-category-sum");
        continue;
      }
      const contribution = value * (action.amount / (1 + categorySum));
      addContribution(totals.additiveContributions, action, "finalContribution", contribution, damageId);
      totals.additiveContributionTotal += contribution;
      continue;
    }

    if (action.contributionMath === "crit-snapshot-share") {
      if (!sample.isCrit) continue;
      if (critMultiplier === null || critMultiplier <= 1) {
        addBlocker(row.blockers, "missing-crit-multiplier-snapshot");
        continue;
      }
      const contribution = value * (action.amount / critMultiplier);
      addContribution(totals.critDamageContributions, action, "finalContribution", contribution, damageId);
      totals.critDamageContributionTotal += contribution;
      continue;
    }

    if (action.contributionMath === "expected-value-only") {
      if (critMultiplier === null || critMultiplier <= 1 || decritValue === null) {
        addBlocker(row.blockers, "missing-expected-crit-snapshot");
        continue;
      }
      const contribution = decritValue * action.amount * (critMultiplier - 1);
      addContribution(totals.expectedCritRateContributions, action, "finalContribution", contribution, damageId);
      totals.expectedCritRateContributionTotal += contribution;
      continue;
    }

    totals.blockedFormulaActions[action.contributionMath] = (totals.blockedFormulaActions[action.contributionMath] ?? 0) + 1;
  }
}

function finalizeContributionRows(map) {
  return [...map.values()]
    .map((row) => ({
      ...row,
      damageRows: [...row.damageRows].sort((left, right) => Number(left) - Number(right)),
    }))
    .sort((left, right) => right.finalContribution - left.finalContribution);
}

function finalizeDamageRows(rows) {
  return [...rows.values()]
    .map((row) => {
      const attack = summarize(row.attackRatios);
      const defenseAdjusted = summarize(row.defenseAdjustedRatios);
      return {
        damageId: row.damageId,
        displayName: row.displayName,
        hits: row.hits,
        totalValue: row.totalValue,
        critHits: row.critHits,
        luckyHits: row.luckyHits,
        samplesWithAttack: row.samplesWithAttack,
        samplesWithDefense: row.samplesWithDefense,
        samplesWithCritMultiplier: row.samplesWithCritMultiplier,
        attackRatio: attack,
        defenseAdjustedRatio: defenseAdjusted,
        defenseModelSpreadDelta:
          attack.spreadPct !== null && defenseAdjusted.spreadPct !== null ? attack.spreadPct - defenseAdjusted.spreadPct : null,
        activeCategoryHits: row.activeCategoryHits,
        blockers: row.blockers,
      };
    })
    .sort((left, right) => right.totalValue - left.totalValue);
}

function runtimeCoverage(indexes) {
  const formulaTermCounts = {};
  const componentKeyCounts = {};
  for (const source of Object.values(indexes.contribution.sourcesByRuleId ?? {})) {
    if (source.contributionMode !== "formula-replay-candidate") continue;
    for (const term of asArray(source.formulaTermIds)) {
      formulaTermCounts[term] = (formulaTermCounts[term] ?? 0) + 1;
    }
    for (const hint of asArray(source.componentValueHints)) {
      const key = String(hint.componentKey ?? "");
      componentKeyCounts[key] = (componentKeyCounts[key] ?? 0) + 1;
    }
  }
  const categoryCoverage = SHEET_CATEGORY_MODEL.map((category) => ({
    id: category.id,
    label: category.label,
    replayStatus: category.replayStatus,
    contributionMath: category.contributionMath,
    runtimeTermRules: category.runtimeTerms.reduce((sum, term) => sum + (formulaTermCounts[term] ?? 0), 0),
    componentHintRules: category.componentKeys.reduce((sum, key) => sum + (componentKeyCounts[key] ?? 0), 0),
    runtimeTerms: category.runtimeTerms,
    componentKeys: category.componentKeys,
  }));
  return {
    formulaTermCounts,
    componentKeyCounts,
    categoryCoverage,
  };
}

function analyzeInputs(inputs, indexes, options) {
  const rows = new Map();
  const totals = {
    filesScanned: 0,
    filesWithoutSamples: 0,
    samplesScanned: 0,
    samplesWithFormulaActions: 0,
    finalDamage: 0,
    categoryHits: {},
    blockers: {},
    blockedActionReasons: {
      unmappedComponentKeys: {},
      valueSelection: {},
    },
    blockedFormulaActions: {},
    additiveContributions: new Map(),
    critDamageContributions: new Map(),
    expectedCritRateContributions: new Map(),
    additiveContributionTotal: 0,
    critDamageContributionTotal: 0,
    expectedCritRateContributionTotal: 0,
  };

  for (const input of inputs) {
    const data = readJson(input);
    const samples = asArray(data.modifierReplayHits).filter((sample) => !sample?.isHeal);
    totals.filesScanned += 1;
    if (!samples.length) totals.filesWithoutSamples += 1;
    for (const sample of samples) {
      analyzeSample(sample, input, indexes, rows, totals, options);
    }
  }

  const damageRows = finalizeDamageRows(rows);
  const rowsWithDefenseModel = damageRows.filter((row) => row.defenseAdjustedRatio.count > 0).length;
  const rowsDefenseImproved = damageRows.filter((row) => row.defenseModelSpreadDelta !== null && row.defenseModelSpreadDelta > 0).length;
  const rowsDefenseWorse = damageRows.filter((row) => row.defenseModelSpreadDelta !== null && row.defenseModelSpreadDelta < 0).length;

  return {
    inputs: inputs.map((input) => path.relative(repoRoot, input)),
    summary: {
      filesScanned: totals.filesScanned,
      filesWithoutSamples: totals.filesWithoutSamples,
      samplesScanned: totals.samplesScanned,
      samplesWithFormulaActions: totals.samplesWithFormulaActions,
      damageRowsObserved: damageRows.length,
      rowsWithDefenseModel,
      rowsDefenseImproved,
      rowsDefenseWorse,
      finalDamage: totals.finalDamage,
      additiveContributionTotal: totals.additiveContributionTotal,
      critDamageContributionTotal: totals.critDamageContributionTotal,
      expectedCritRateContributionTotal: totals.expectedCritRateContributionTotal,
      categoryHits: totals.categoryHits,
      blockers: totals.blockers,
      blockedActionReasons: totals.blockedActionReasons,
      blockedFormulaActions: totals.blockedFormulaActions,
    },
    damageRows,
    additiveContributionRows: finalizeContributionRows(totals.additiveContributions),
    critDamageContributionRows: finalizeContributionRows(totals.critDamageContributions),
    expectedCritRateContributionRows: finalizeContributionRows(totals.expectedCritRateContributions),
  };
}

function renderMarkdown(report, options) {
  const categoryRows = report.runtimeCoverage.categoryCoverage.map((row) => [
    row.label,
    row.id,
    row.contributionMath,
    row.replayStatus,
    row.runtimeTermRules,
    row.componentHintRules,
    row.runtimeTerms.join(", "),
    row.componentKeys.join(", "),
  ]);

  const defenseRows = report.replay.damageRows
    .filter((row) => row.defenseAdjustedRatio.count > 0)
    .slice(0, options.maxRows)
    .map((row) => [
      row.displayName || row.damageId,
      row.damageId,
      row.hits,
      formatNumber(row.totalValue),
      formatPct(row.attackRatio.spreadPct, 1),
      formatPct(row.defenseAdjustedRatio.spreadPct, 1),
      row.defenseModelSpreadDelta === null ? "" : formatPct(row.defenseModelSpreadDelta, 1),
      row.samplesWithDefense,
    ]);

  const contributionTable = (rows) =>
    rows.slice(0, options.maxRows).map((row) => [
      row.label,
      row.categoryLabel,
      row.componentKey,
      formatPct(row.amount, 2),
      row.selectedScope,
      row.hits,
      formatNumber(row.finalContribution),
      row.damageRows.slice(0, 8).join(", "),
    ]);

  return [
    "# Spreadsheet Formula Model Audit",
    "",
    "This is dev-only evidence from the Iaido damage simulator workbook. It does not change runtime contribution totals.",
    "",
    "## Workbook",
    "",
    `- Source: \`${path.relative(repoRoot, report.sheetModel.workbook.filePath)}\``,
    `- Sheets: ${formatNumber(report.sheetModel.workbook.sheetCount)}`,
    `- Defined ranges: ${Object.entries(report.sheetModel.workbook.definedNames)
      .map(([name, range]) => `${name}=${range}`)
      .join("; ")}`,
    "",
    "## Extracted Formula Pipeline",
    "",
    ...report.sheetModel.formulaPipeline.map((step) => `- ${step}`),
    "",
    "## Runtime Category Coverage",
    "",
    markdownTable(
      ["Sheet Category", "ID", "Math", "Replay Status", "Runtime Term Rules", "Component Hint Rules", "Runtime Terms", "Component Keys"],
      categoryRows
    ),
    "",
    "## Replay Summary",
    "",
    `- Files scanned: ${formatNumber(report.replay.summary.filesScanned)}`,
    `- Samples scanned: ${formatNumber(report.replay.summary.samplesScanned)}`,
    `- Samples with formula actions: ${formatNumber(report.replay.summary.samplesWithFormulaActions)}`,
    `- Damage rows observed: ${formatNumber(report.replay.summary.damageRowsObserved)}`,
    `- Rows with defense model samples: ${formatNumber(report.replay.summary.rowsWithDefenseModel)}`,
    `- Rows where defense-adjusted spread improved: ${formatNumber(report.replay.summary.rowsDefenseImproved)}`,
    `- Rows where defense-adjusted spread worsened: ${formatNumber(report.replay.summary.rowsDefenseWorse)}`,
    `- Additive category candidate contribution: ${formatNumber(report.replay.summary.additiveContributionTotal)}`,
    `- Crit-damage snapshot candidate contribution: ${formatNumber(report.replay.summary.critDamageContributionTotal)}`,
    `- Expected crit-rate candidate contribution: ${formatNumber(report.replay.summary.expectedCritRateContributionTotal)}`,
    "",
    "## Defense Model Spread Check",
    "",
    defenseRows.length
      ? markdownTable(
          ["Damage Row", "Damage ID", "Hits", "Final Damage", "Decrit/ATK Spread", "Sheet Defense Spread", "Improvement", "Defense Samples"],
          defenseRows
        )
      : "No rows had enough attack and target-defense snapshots for the sheet defense model.",
    "",
    "## Additive Category Candidate Contributions",
    "",
    report.replay.additiveContributionRows.length
      ? markdownTable(
          ["Source", "Category", "Component", "Amount", "Scope", "Hits", "Candidate Final Delta", "Damage IDs"],
          contributionTable(report.replay.additiveContributionRows)
        )
      : "No additive category candidate contributions were observed.",
    "",
    "## Crit-Damage Snapshot Candidate Contributions",
    "",
    report.replay.critDamageContributionRows.length
      ? markdownTable(
          ["Source", "Category", "Component", "Amount", "Scope", "Crit Hits", "Candidate Final Delta", "Damage IDs"],
          contributionTable(report.replay.critDamageContributionRows)
        )
      : "No crit-damage snapshot candidates were observed.",
    "",
    "## Expected Crit-Rate Candidate Contributions",
    "",
    report.replay.expectedCritRateContributionRows.length
      ? markdownTable(
          ["Source", "Category", "Component", "Amount", "Scope", "Hits", "Expected Final Delta", "Damage IDs"],
          contributionTable(report.replay.expectedCritRateContributionRows)
        )
      : "No expected crit-rate candidates were observed.",
    "",
    "## Important Extracted Cells",
    "",
    markdownTable(
      ["Name", "Formula / Value"],
      Object.entries(report.sheetModel.importantCells).map(([name, value]) => [name, value])
    ),
    "",
    "## Boundaries",
    "",
    "- Moonstrike-specific behavior is intentionally out of scope for this pass.",
    "- Candidate contribution rows are not promoted. They still need source-on/source-off validation or equivalent formula replay proof.",
    "- Effective ATK and defense marginal math remain blocked where we do not have pre-buff stat snapshots, refined/elemental split, or exact skill flat/coefficient proof.",
    "",
  ].join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!fs.existsSync(options.sheet)) {
    throw new Error(`Spreadsheet workbook not found: ${options.sheet}`);
  }

  const inputs = options.inputs.length ? options.inputs : latestModifierEntityInputs(options);
  if (!inputs.length) {
    throw new Error("No modifier entity exports found. Pass --input or create DEV_exports/modifier-entity-*.json files.");
  }

  const workbook = readWorkbookModel(options.sheet);
  const sheetModel = extractSheetFormulaModel(workbook);
  const indexes = buildIndexes();
  const replay = analyzeInputs(inputs, indexes, options);
  const report = {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    sheetModel,
    runtimeCoverage: runtimeCoverage(indexes),
    replay,
  };

  fs.mkdirSync(path.dirname(options.outJson), { recursive: true });
  fs.writeFileSync(options.outJson, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(options.outMd, renderMarkdown(report, options));

  console.log(`Spreadsheet Formula Model Audit
- Workbook: ${path.relative(repoRoot, options.sheet)}
- Inputs: ${inputs.length}
- Samples scanned: ${formatNumber(replay.summary.samplesScanned)}
- Damage rows observed: ${formatNumber(replay.summary.damageRowsObserved)}
- Rows with defense model: ${formatNumber(replay.summary.rowsWithDefenseModel)}
- Defense spread improved/worse: ${formatNumber(replay.summary.rowsDefenseImproved)} / ${formatNumber(replay.summary.rowsDefenseWorse)}
- Additive candidate contribution: ${formatNumber(replay.summary.additiveContributionTotal)}
- Crit-damage candidate contribution: ${formatNumber(replay.summary.critDamageContributionTotal)}
- Expected crit-rate candidate contribution: ${formatNumber(replay.summary.expectedCritRateContributionTotal)}
- JSON: ${path.relative(repoRoot, options.outJson)}
- Markdown: ${path.relative(repoRoot, options.outMd)}`);
}

main();
