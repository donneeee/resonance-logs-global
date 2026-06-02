#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import * as common from "../../BPSR-UID-Extractors/generator-common.mjs";

const repoRoot = process.cwd();
const generatedRoot = path.join(repoRoot, "parser-data", "generated");
const defaultOutJson = path.join(repoRoot, "DEV_exports", "enemy-skill-localization-trace.json");
const defaultOutMd = path.join(repoRoot, "DEV_exports", "enemy-skill-localization-trace.md");
const STRING_POOL = 6;
const MiB = 1024 * 1024;

const DEFAULT_IDS = [
  133500510101,
  133500520101,
  133500580101,
];

const KNOWN_TABLE_NAMES = [
  "DamageAttrTable.ctb",
  "SkillTable.ctb",
  "SkillEffectTable.ctb",
  "SkillFightLevelTable.ctb",
  "MonsterTable.ctb",
  "RecountTable.ctb",
  "BuffTable.ctb",
  "TempAttrTable.ctb",
  "TalentTable.ctb",
  "PassiveSkillTable.ctb",
];

const KNOWN_HASH_LABELS = new Map(
  KNOWN_TABLE_NAMES.map((name) => [common.hash33(name), name]),
);
KNOWN_HASH_LABELS.set(3345237628, "TalentTable.ctb");
KNOWN_HASH_LABELS.set(3518555200, "CTB:3518555200");

function parseArgs(argv) {
  const options = {
    ids: DEFAULT_IDS,
    game: "",
    outJson: defaultOutJson,
    outMd: defaultOutMd,
    maxEntryMb: 80,
    maxRowsPerId: 24,
    maxStringMatches: 40,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };

    switch (arg) {
      case "--ids":
        options.ids = parseIdList(next());
        break;
      case "--game":
        options.game = next();
        break;
      case "--out-json":
        options.outJson = path.resolve(next());
        break;
      case "--out-md":
        options.outMd = path.resolve(next());
        break;
      case "--max-entry-mb":
        options.maxEntryMb = Math.max(1, Number(next()) || 1);
        break;
      case "--max-rows-per-id":
        options.maxRowsPerId = Math.max(1, Number(next()) || 1);
        break;
      case "--max-string-matches":
        options.maxStringMatches = Math.max(1, Number(next()) || 1);
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
  console.log(`Enemy Skill Localization Trace

Usage:
  node scripts/audit-enemy-skill-localization-trace.mjs [options]

Options:
  --ids <ids>                     Comma-separated damage IDs to trace.
  --game <path|preset>            Game path or launcher preset.
  --out-json <file>               JSON report path.
  --out-md <file>                 Markdown report path.
  --max-entry-mb <n>              Skip package entries larger than this. Default: 80.
  --max-rows-per-id <n>           Stored CTB rows per target ID. Default: 24.
  --max-string-matches <n>        Stored localization string matches. Default: 40.
  --help                          Show this help.
`);
}

function parseIdList(value) {
  return String(value || "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(generatedRoot, fileName), "utf8"));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function preferredText(names, fallback = "") {
  return common.choosePreferredLocaleText(names, fallback) || fallback;
}

function addLabel(labels, value) {
  const text = cleanText(value);
  if (text) labels.add(text);
}

function addNamesLabels(labels, names) {
  if (!isRecord(names)) return;
  for (const value of Object.values(names)) {
    addLabel(labels, value);
  }
}

function generatedRow(data, id) {
  return data?.[String(id)] && isRecord(data[String(id)]) ? data[String(id)] : null;
}

function collectGeneratedTrace(ids) {
  const damageRows = readJson("DamageAttrIdName.json");
  const detailRows = readJson("SkillBreakdownDetails.json");
  const skillRows = readJson("skillnames.json");
  const traces = [];
  const targetIds = new Set(ids);
  const labelsById = new Map();
  const terms = new Set();

  for (const id of ids) {
    const damage = generatedRow(damageRows, id);
    const detail = generatedRow(detailRows, id);
    const labels = new Set();
    const linkedIds = new Set();

    for (const row of [damage, detail]) {
      if (!row) continue;
      for (const field of [
        "Name",
        "NameDesign",
        "DamageName",
        "DisplayName",
        "LinkedName",
        "UnderlyingSkillName",
        "DisplayDetailName",
      ]) {
        addLabel(labels, row[field]);
      }
      for (const field of [
        "Names",
        "DamageNames",
        "DisplayNames",
        "LinkedNames",
        "UnderlyingSkillNames",
        "DisplayDetailNames",
      ]) {
        addNamesLabels(labels, row[field]);
      }
      for (const field of [
        "LinkedId",
        "LinkedSkillId",
        "LinkedSkillTableId",
        "LinkedSkillEffectId",
        "LinkedSkillEffectSkillTableId",
        "BaseSkillId",
        "UnderlyingSkillId",
      ]) {
        const value = Number(row[field]);
        if (Number.isFinite(value) && value > 0) linkedIds.add(value);
      }
    }

    for (const linkedId of linkedIds) {
      targetIds.add(linkedId);
      const skill = generatedRow(skillRows, linkedId);
      const linkedLabels = labelsById.get(linkedId) ?? new Set();
      if (skill) {
        addLabel(linkedLabels, skill.Name);
        addLabel(linkedLabels, skill.NameDesign);
        addNamesLabels(linkedLabels, skill.Names);
      }
      labelsById.set(linkedId, linkedLabels);
    }

    labelsById.set(id, labels);
    for (const label of labels) {
      terms.add(normalizeText(label));
    }
    traces.push({
      id,
      labels: [...labels].sort((a, b) => a.localeCompare(b)),
      linkedIds: [...linkedIds].sort((a, b) => a - b),
    });
  }

  for (const id of [...targetIds]) {
    if (!labelsById.has(id)) labelsById.set(id, new Set());
  }

  return {
    traces,
    targetIds,
    labelsById,
    terms: [...terms].filter((term) => term.length >= 3),
  };
}

function buildLocalizationIndex(localizationTables) {
  const entriesByTextId = new Map();
  for (const table of localizationTables) {
    const localeId = common.localeIdFromGameLanguage(table.language);
    for (const [textId, stringIndex] of table.index.entries()) {
      if (stringIndex < 0 || stringIndex >= table.strings.length) continue;
      const text = cleanText(table.strings[stringIndex]);
      if (!text) continue;
      const entries = entriesByTextId.get(textId) ?? [];
      entries.push({ localeId, language: table.language, stringIndex, text });
      entriesByTextId.set(textId, entries);
    }
  }

  const out = new Map();
  for (const [textId, entries] of entriesByTextId.entries()) {
    out.set(textId, {
      textId,
      names: common.buildLocaleTextObject(entries, { includeDesign: false }),
      entries,
    });
  }
  return out;
}

function searchLocalizationStrings(localizationTables, terms, maxMatches) {
  const matches = [];
  const seen = new Set();
  for (const table of localizationTables) {
    const localeId = common.localeIdFromGameLanguage(table.language);
    for (const [textId, stringIndex] of table.index.entries()) {
      const text = cleanText(table.strings[stringIndex]);
      if (!text) continue;
      const normalized = normalizeText(text);
      for (const term of terms) {
        if (!term || normalized !== term) continue;
        const key = `${textId}:${localeId}:${stringIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({ textId, localeId, language: table.language, stringIndex, text });
        if (matches.length >= maxMatches) return matches;
      }
    }
  }
  return matches;
}

function readU32Safe(buffer, offset) {
  if (offset < 0 || offset + 4 > buffer.length) return null;
  return buffer.readUInt32LE(offset);
}

function readU64NumberSafe(buffer, offset) {
  if (offset < 0 || offset + 8 > buffer.length) return null;
  const low = BigInt(buffer.readUInt32LE(offset));
  const high = BigInt(buffer.readUInt32LE(offset + 4));
  const value = low + (high << 32n);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function readRowValues(table, rowOffset) {
  const values = [];
  for (let fieldOffset = 0; fieldOffset + 4 <= table.rowSize; fieldOffset += 4) {
    values.push({
      fieldOffset,
      value: readU32Safe(table.data, rowOffset + fieldOffset),
    });
  }
  return values;
}

function rowStringHints(table, rowValues) {
  const hints = [];
  for (const { fieldOffset, value } of rowValues) {
    if (!Number.isInteger(value) || value < 0) continue;
    const text = common.readCtbString(table, STRING_POOL, value, { allowZero: false, maxLen: 180 });
    if (!text || hints.some((hint) => hint.text === text)) continue;
    if (/^ui[\\/]/i.test(text) || /\.(?:png|dds|tga|ktx)$/i.test(text)) continue;
    hints.push({ fieldOffset, text });
    if (hints.length >= 10) break;
  }
  return hints;
}

function addRowHit(rowsByTargetId, targetId, row, maxRowsPerId) {
  const rows = rowsByTargetId.get(targetId) ?? [];
  const key = `${row.tableKey}:${row.rowIndex}`;
  if (rows.some((entry) => `${entry.tableKey}:${entry.rowIndex}` === key)) return;
  if (rows.length < maxRowsPerId) {
    rows.push(row);
    rowsByTargetId.set(targetId, rows);
  }
}

function summarizeLocalizedText(hit) {
  const names = hit?.names;
  return preferredText(names, "")
    || cleanText(names?.["zh-CN"])
    || cleanText(names?.design)
    || "";
}

function scanCtbTables({
  containerDir,
  metaEntries,
  targetIds,
  localizedTextById,
  maxEntryBytes,
  maxRowsPerId,
}) {
  const rowsByTargetId = new Map();
  const stats = {
    packageEntriesChecked: 0,
    ctbTablesScanned: 0,
    entriesSkippedBySize: 0,
    matchedRows: 0,
  };

  for (const [tableKey, entry] of metaEntries.entries()) {
    stats.packageEntriesChecked += 1;
    if (entry.length > maxEntryBytes) {
      stats.entriesSkippedBySize += 1;
      continue;
    }

    let table;
    try {
      const tableLabel = KNOWN_HASH_LABELS.get(tableKey) ?? `CTB:${tableKey}`;
      table = common.readCtbTableEntry(containerDir, entry, tableLabel, tableKey);
    } catch {
      continue;
    }

    if (!table || table.rowSize < 4 || table.rowSize > 4096 || table.rowCount <= 0) {
      continue;
    }

    stats.ctbTablesScanned += 1;
    const tableLabel = KNOWN_HASH_LABELS.get(tableKey) ?? `CTB:${tableKey}`;
    for (let rowIndex = 0; rowIndex < table.rowCount; rowIndex += 1) {
      const rowOffset = table.rowStart + rowIndex * table.rowSize;
      const rowValues = readRowValues(table, rowOffset);
      const u32Hits = rowValues.filter((entryValue) => targetIds.has(entryValue.value));
      const u64Hits = [];
      for (let fieldOffset = 0; fieldOffset + 8 <= table.rowSize; fieldOffset += 4) {
        const value = readU64NumberSafe(table.data, rowOffset + fieldOffset);
        if (targetIds.has(value)) u64Hits.push({ fieldOffset, value });
      }
      if (!u32Hits.length && !u64Hits.length) continue;

      const localizedTextHits = rowValues
        .map(({ fieldOffset, value }) => {
          const localized = localizedTextById.get(value);
          return localized ? {
            fieldOffset,
            textId: value,
            preferred: summarizeLocalizedText(localized),
            names: localized.names,
          } : null;
        })
        .filter(Boolean)
        .slice(0, 12);

      const row = {
        tableKey,
        tableLabel,
        rowIndex,
        rowSize: table.rowSize,
        rowOffset: table.entry.offset + rowOffset,
        u32Hits,
        u64Hits,
        localizedTextHits,
        stringHints: rowStringHints(table, rowValues),
      };
      stats.matchedRows += 1;

      for (const hit of [...u32Hits, ...u64Hits]) {
        addRowHit(rowsByTargetId, hit.value, row, maxRowsPerId);
      }
    }
  }

  return { rowsByTargetId, stats };
}

function markdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, "<br>")
    .slice(0, 260);
}

function formatCount(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function makeMarkdown(report) {
  const lines = [];
  lines.push("# Enemy Skill Localization Trace");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Game package: \`${report.gamePackage}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| --- | ---: |");
  lines.push(`| Focus damage IDs | ${formatCount(report.focus.length)} |`);
  lines.push(`| Target IDs including linked rows | ${formatCount(report.targetIds.length)} |`);
  lines.push(`| Exact localization string matches | ${formatCount(report.localizationStringMatches.length)} |`);
  lines.push(`| Package entries checked | ${formatCount(report.stats.packageEntriesChecked)} |`);
  lines.push(`| CTB-like tables scanned | ${formatCount(report.stats.ctbTablesScanned)} |`);
  lines.push(`| CTB rows with target IDs | ${formatCount(report.stats.matchedRows)} |`);
  lines.push("");
  lines.push("## Focus IDs");
  lines.push("");
  lines.push("| Damage ID | Labels | Linked IDs |");
  lines.push("| ---: | --- | --- |");
  for (const row of report.focus) {
    lines.push(`| ${row.id} | ${markdownCell(row.labels.join(", "))} | ${row.linkedIds.join(", ")} |`);
  }
  lines.push("");
  lines.push("## Exact Localization String Matches");
  lines.push("");
  if (!report.localizationStringMatches.length) {
    lines.push("_No exact localized string entries matched the generated design labels._");
  } else {
    lines.push("| Text ID | Locale | Text |");
    lines.push("| ---: | --- | --- |");
    for (const match of report.localizationStringMatches) {
      lines.push(`| ${match.textId} | ${match.localeId} | ${markdownCell(match.text)} |`);
    }
  }
  lines.push("");
  lines.push("## CTB Target Rows");
  lines.push("");
  lines.push("| Target ID | Labels | Rows | Localized Text IDs In Same Rows | String Hints |");
  lines.push("| ---: | --- | ---: | --- | --- |");
  for (const target of report.targets) {
    const textHits = [];
    const hints = [];
    for (const row of target.rows) {
      for (const hit of row.localizedTextHits) {
        textHits.push(`${hit.textId}@${row.tableLabel}+${hit.fieldOffset}: ${hit.preferred}`);
      }
      for (const hint of row.stringHints) {
        hints.push(`${row.tableLabel}+${hint.fieldOffset}: ${hint.text}`);
      }
    }
    lines.push([
      target.id,
      markdownCell(target.labels.join(", ")),
      target.rows.length,
      markdownCell([...new Set(textHits)].slice(0, 8).join("; ")),
      markdownCell([...new Set(hints)].slice(0, 8).join("; ")),
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This is an evidence trace only; it does not promote labels.");
  lines.push("- A same-row localized text ID is only a candidate bridge if the table layout proves that field is a display name.");
  lines.push("- Exact string matches prove the label exists in localization bytes; absent matches suggest the generated label is a design/internal string.");
  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const generated = collectGeneratedTrace(options.ids);
  const paths = common.resolvePaths(
    options.game ? { game: options.game, out: options.outJson } : { out: options.outJson },
    path.basename(options.outJson),
  );
  const containerDir = path.dirname(paths.m0Path);
  const metaEntries = common.loadMetaEntries(containerDir);
  const localizationTables = common.loadLocalizationTables(containerDir, { metaEntries });
  const localizedTextById = buildLocalizationIndex(localizationTables);
  const localizationStringMatches = searchLocalizationStrings(
    localizationTables,
    generated.terms,
    options.maxStringMatches,
  );
  const { rowsByTargetId, stats } = scanCtbTables({
    containerDir,
    metaEntries,
    targetIds: generated.targetIds,
    localizedTextById,
    maxEntryBytes: options.maxEntryMb * MiB,
    maxRowsPerId: options.maxRowsPerId,
  });

  const targets = [...generated.targetIds]
    .sort((left, right) => left - right)
    .map((id) => ({
      id,
      labels: [...(generated.labelsById.get(id) ?? new Set())].sort((left, right) => left.localeCompare(right)),
      rows: rowsByTargetId.get(id) ?? [],
    }));

  const report = {
    generatedAt: new Date().toISOString(),
    gamePackage: paths.m0Path,
    focus: generated.traces,
    targetIds: targets.map((target) => target.id),
    localizationStringMatches,
    stats,
    targets,
  };

  fs.mkdirSync(path.dirname(options.outJson), { recursive: true });
  fs.writeFileSync(options.outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(options.outMd, makeMarkdown(report), "utf8");
  console.log(`Enemy skill localization trace written to ${path.relative(repoRoot, options.outMd)}`);
  console.log(`Enemy skill localization trace JSON written to ${path.relative(repoRoot, options.outJson)}`);
  console.log(`Exact localization string matches: ${formatCount(localizationStringMatches.length)}`);
  console.log(`CTB target rows: ${formatCount(stats.matchedRows)}`);
}

main();
