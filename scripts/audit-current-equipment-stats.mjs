import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_INPUT = path.join(repoRoot, "DEV_exports", "factor-vdata-current-equipment.json");
const DEFAULT_MIRAGE_AUDIT = path.join(repoRoot, "DEV_exports", "mirage-dream-scaling-audit-205.json");
const DEFAULT_OUT_JSON = path.join(repoRoot, "DEV_exports", "current-equipment-stat-audit.json");
const DEFAULT_OUT_MD = path.join(repoRoot, "DEV_exports", "current-equipment-stat-audit.md");
const DEFAULT_OUT_CSV = path.join(repoRoot, "DEV_exports", "current-equipment-stat-audit.csv");
const DEFAULT_ITEM_NAMES = path.join(repoRoot, "parser-data", "generated", "itemnames.json");

const SLOT_NAMES = new Map([
  [200, "weapon"],
  [201, "helm"],
  [202, "garb"],
  [203, "bracers"],
  [204, "boots"],
  [205, "earrings"],
  [206, "necklace"],
  [207, "ring"],
  [208, "bracelet-l"],
  [209, "bracelet-r"],
  [210, "charm"],
]);

const ACCESSORY_SLOTS = new Set([205, 206, 207, 208, 209, 210]);
const MIRAGE_TOOLTIP_CAP_PER_STACK = 50;
const ACCESSORY_RARE_ATK_PERCENT_HYPOTHESIS = 1.5;

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    itemNames: DEFAULT_ITEM_NAMES,
    mirageAudit: DEFAULT_MIRAGE_AUDIT,
    outJson: DEFAULT_OUT_JSON,
    outMd: DEFAULT_OUT_MD,
    outCsv: DEFAULT_OUT_CSV,
    locale: "en",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--input" && next) {
      args.input = path.resolve(next);
      i += 1;
    } else if (arg === "--item-names" && next) {
      args.itemNames = path.resolve(next);
      i += 1;
    } else if (arg === "--mirage-audit" && next) {
      args.mirageAudit = path.resolve(next);
      i += 1;
    } else if (arg === "--out-json" && next) {
      args.outJson = path.resolve(next);
      i += 1;
    } else if (arg === "--out-md" && next) {
      args.outMd = path.resolve(next);
      i += 1;
    } else if (arg === "--out-csv" && next) {
      args.outCsv = path.resolve(next);
      i += 1;
    } else if (arg === "--locale" && next) {
      args.locale = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/audit-current-equipment-stats.mjs [options]

Options:
  --input <file>          probe_factor_vdata JSON. Default: DEV_exports/factor-vdata-current-equipment.json
  --item-names <file>     generated itemnames.json. Default: parser-data/generated/itemnames.json
  --mirage-audit <file>   optional Mirage scaling audit JSON
  --out-json <file>       output JSON report
  --out-md <file>         output Markdown report
  --out-csv <file>        output selected gear line CSV
  --locale <locale>       item-name locale. Default: en
`);
}

function readJson(filePath, fallback = undefined) {
  if (!filePath || !fs.existsSync(filePath)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing input file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildItemNameMap(itemNamesPath, locale) {
  const rows = readJson(itemNamesPath, []);
  const map = new Map();
  for (const row of rows) {
    const id = Number(row?.Id);
    if (!Number.isFinite(id)) continue;
    const localized = row?.Names?.[locale] ?? row?.Names?.en ?? row?.NameDesign ?? null;
    if (localized) map.set(id, localized);
  }
  return map;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function flattenAttrLines(attr, prefix = "") {
  if (!attr) return [];
  const lines = [];
  for (const lane of ["base_attrs", "basic_attr", "advance_attr", "recast_attr", "rare_quality_attr"]) {
    for (const entry of asArray(attr[lane])) {
      const key = Number(entry?.key);
      const value = Number(entry?.value);
      if (!Number.isFinite(key)) continue;
      lines.push({
        lane: prefix ? `${prefix}.${lane}` : lane,
        pairId: key,
        pairValue: Number.isFinite(value) ? value : null,
      });
    }
  }
  if (attr.equip_attr_set) {
    lines.push(...flattenAttrLines(attr.equip_attr_set, prefix ? `${prefix}.equip_attr_set` : "equip_attr_set"));
  }
  return lines;
}

function buildLineRows(equipment, itemNameById) {
  const rows = [];
  for (const item of asArray(equipment?.equipped_items)) {
    const slot = Number(item?.equip_slot);
    const itemId = Number(item?.item_config_id);
    const itemName = itemNameById.get(itemId) ?? "";
    const slotName = SLOT_NAMES.get(slot) ?? `slot-${slot}`;
    const isAccessory = ACCESSORY_SLOTS.has(slot);
    for (const line of flattenAttrLines(item?.item_equip_attr)) {
      rows.push({
        slot,
        slotName,
        itemId,
        itemName,
        quality: item?.quality ?? null,
        lane: line.lane,
        pairId: line.pairId,
        pairValue: line.pairValue,
        isAccessory,
        isAccessoryRare: isAccessory && line.lane === "rare_quality_attr",
        contextKey: `${itemId}:${line.lane}:${line.pairId}`,
      });
    }
  }
  return rows.sort((left, right) =>
    left.slot - right.slot ||
    left.itemId - right.itemId ||
    left.lane.localeCompare(right.lane) ||
    left.pairId - right.pairId
  );
}

function summarizePairContexts(rows) {
  const byPair = new Map();
  for (const row of rows) {
    const bucket = byPair.get(row.pairId) ?? {
      pairId: row.pairId,
      contexts: new Map(),
      selectedCount: 0,
      accessoryRareCount: 0,
    };
    bucket.selectedCount += 1;
    if (row.isAccessoryRare) bucket.accessoryRareCount += 1;
    const context = bucket.contexts.get(row.contextKey) ?? {
      contextKey: row.contextKey,
      itemId: row.itemId,
      itemName: row.itemName,
      slot: row.slot,
      slotName: row.slotName,
      lane: row.lane,
      count: 0,
    };
    context.count += 1;
    bucket.contexts.set(row.contextKey, context);
    byPair.set(row.pairId, bucket);
  }

  return [...byPair.values()]
    .map((bucket) => ({
      pairId: bucket.pairId,
      selectedCount: bucket.selectedCount,
      accessoryRareCount: bucket.accessoryRareCount,
      contextCount: bucket.contexts.size,
      contexts: [...bucket.contexts.values()].sort((left, right) =>
        left.slot - right.slot || left.itemId - right.itemId || left.lane.localeCompare(right.lane)
      ),
      singleSelectedContext: bucket.contexts.size === 1,
    }))
    .sort((left, right) => right.contextCount - left.contextCount || left.pairId - right.pairId);
}

function loadMirageComparison(mirageAuditPath, accessoryRareCount) {
  const audit = readJson(mirageAuditPath, null);
  const file = asArray(audit?.files).find((entry) => entry?.panelAttackInference?.capComparison);
  if (!file) return null;

  const inference = file.panelAttackInference;
  const observedPerStack = Number(inference.capComparison?.observedPerStack);
  const observedVsTooltipCap = Number(inference.capComparison?.observedVsTooltipCap);
  const hypotheticalAccessoryAtkPercent = accessoryRareCount * ACCESSORY_RARE_ATK_PERCENT_HYPOTHESIS;
  const hypotheticalMultiplier = 1 + hypotheticalAccessoryAtkPercent / 100;
  const rawPerStackIfAccessoryRareAtk = Number.isFinite(observedPerStack)
    ? observedPerStack / hypotheticalMultiplier
    : null;

  return {
    sourceFile: file.file,
    attrId: inference.attrId,
    attrName: inference.attrName,
    tooltipCapPerStack: MIRAGE_TOOLTIP_CAP_PER_STACK,
    observedPerStack,
    observedVsTooltipCap,
    accessoryRareAtkPercentHypothesis: hypotheticalAccessoryAtkPercent,
    accessoryRareAtkMultiplierHypothesis: hypotheticalMultiplier,
    rawPerStackIfAccessoryRareAtk,
    matchesTooltipCap:
      rawPerStackIfAccessoryRareAtk !== null &&
      Math.abs(rawPerStackIfAccessoryRareAtk - MIRAGE_TOOLTIP_CAP_PER_STACK) < 0.000001,
    status: "math-fit-pending-rare-quality-decode",
  };
}

function toCsv(rows) {
  const headers = [
    "slot",
    "slotName",
    "itemId",
    "itemName",
    "quality",
    "lane",
    "pairId",
    "pairValue",
    "isAccessory",
    "isAccessoryRare",
    "contextKey",
  ];
  const escape = (value) => {
    const text = value == null ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: Number.isInteger(value) ? 0 : Math.min(digits, 2),
  });
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Current Equipment Stat Audit");
  lines.push("");
  lines.push("Dev-only audit. This extracts selected equipment stat lines from `detailed_playerdata.vdata_bytes`; it does not yet decode every pair ID into a shipped stat table.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Player: ${report.playerId ?? "-"}`);
  lines.push(`- Last seen ms: ${report.lastSeenMs ?? "-"}`);
  lines.push(`- Equipped items: ${report.summary.equippedItemCount}`);
  lines.push(`- Selected stat lines: ${report.summary.selectedStatLineCount}`);
  lines.push(`- Selected accessory rare-quality lines: ${report.summary.accessoryRareLineCount}`);
  lines.push(`- Pair IDs seen in multiple selected item contexts: ${report.summary.multiContextPairIds.length ? report.summary.multiContextPairIds.join(", ") : "none"}`);
  lines.push("");

  if (report.mirageComparison) {
    lines.push("## Mirage Math Check");
    lines.push("");
    lines.push(`- Observed panel step: +${formatNumber(report.mirageComparison.observedPerStack)} ${report.mirageComparison.attrName}`);
    lines.push(`- Tooltip cap: +${report.mirageComparison.tooltipCapPerStack} per stack`);
    lines.push(`- Accessory rare hypothesis: ${report.summary.accessoryRareLineCount} lines x ${ACCESSORY_RARE_ATK_PERCENT_HYPOTHESIS}% = +${formatNumber(report.mirageComparison.accessoryRareAtkPercentHypothesis)}%`);
    lines.push(`- Raw stack if that hypothesis is true: +${formatNumber(report.mirageComparison.rawPerStackIfAccessoryRareAtk)}`);
    lines.push(`- Status: ${report.mirageComparison.status}`);
    lines.push("");
  }

  lines.push("## Selected Rare Quality Lines");
  lines.push("");
  for (const row of report.rows.filter((entry) => entry.lane === "rare_quality_attr")) {
    const scope = row.isAccessory ? "accessory" : "non-accessory";
    lines.push(`- ${row.slotName} ${row.itemName || row.itemId}: pair ${row.pairId}:${row.pairValue} (${scope})`);
  }
  lines.push("");
  lines.push("## Pair Contexts");
  lines.push("");
  for (const pair of report.pairContexts.filter((entry) => entry.contextCount > 1 || entry.accessoryRareCount > 0)) {
    lines.push(`- pair ${pair.pairId}: ${pair.selectedCount} selected lines, ${pair.contextCount} contexts, single-selected-context=${pair.singleSelectedContext}`);
    for (const context of pair.contexts) {
      lines.push(`  - ${context.slotName} ${context.itemName || context.itemId} / ${context.lane}`);
    }
  }
  lines.push("");
  lines.push("## Next Step");
  lines.push("");
  lines.push("- Decode `rare_quality_attr` by item context through the EquipAttrLib / EquipEffect tables, then promote only `(itemId, lane, pairId)` rows with proven labels and values into the runtime equipment-state table.");
  return `${lines.join("\n")}\n`;
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const probe = readJson(args.input);
  const itemNameById = buildItemNameMap(args.itemNames, args.locale);
  const equipment = probe?.equipment_snapshot;
  const rows = buildLineRows(equipment, itemNameById);
  const pairContexts = summarizePairContexts(rows);
  const accessoryRareLineCount = rows.filter((row) => row.isAccessoryRare).length;
  const mirageComparison = loadMirageComparison(args.mirageAudit, accessoryRareLineCount);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputs: {
      input: path.relative(repoRoot, args.input),
      itemNames: path.relative(repoRoot, args.itemNames),
      mirageAudit: fs.existsSync(args.mirageAudit) ? path.relative(repoRoot, args.mirageAudit) : null,
      locale: args.locale,
    },
    playerId: probe?.player_id ?? null,
    lastSeenMs: probe?.last_seen_ms ?? null,
    summary: {
      equippedItemCount: asArray(equipment?.equipped_items).length,
      selectedStatLineCount: rows.length,
      accessoryRareLineCount,
      selectedRareQualityLineCount: rows.filter((row) => row.lane === "rare_quality_attr").length,
      multiContextPairIds: pairContexts.filter((entry) => entry.contextCount > 1).map((entry) => entry.pairId),
    },
    mirageComparison,
    rows,
    pairContexts,
    notes: [
      "Pair IDs are not treated as globally safe stat IDs. Use itemId + lane + pairId when promoting equipment rows.",
      "The Mirage comparison is a math fit only until the selected rare-quality lines are decoded from game tables.",
    ],
  };

  ensureParent(args.outJson);
  fs.writeFileSync(args.outJson, `${JSON.stringify(report, null, 2)}\n`);
  ensureParent(args.outMd);
  fs.writeFileSync(args.outMd, buildMarkdown(report));
  ensureParent(args.outCsv);
  fs.writeFileSync(args.outCsv, `${toCsv(rows)}\n`);

  console.log(`Wrote equipment stat audit JSON: ${path.relative(repoRoot, args.outJson)}`);
  console.log(`Wrote equipment stat audit MD: ${path.relative(repoRoot, args.outMd)}`);
  console.log(`Wrote equipment stat audit CSV: ${path.relative(repoRoot, args.outCsv)}`);
  console.log(`Selected accessory rare-quality lines: ${accessoryRareLineCount}`);
  if (mirageComparison) {
    console.log(
      `Mirage math fit: observed ${formatNumber(mirageComparison.observedPerStack)} / ${formatNumber(mirageComparison.accessoryRareAtkMultiplierHypothesis, 3)} = ${formatNumber(mirageComparison.rawPerStackIfAccessoryRareAtk)}`
    );
  }
}

main();
