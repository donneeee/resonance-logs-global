#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CN_ROOT =
  process.env.CN_RELEASE_ROOT ??
  path.resolve(ROOT, "..", "resonance-logs-cn-main_0.1.5");
const CN_PREVIOUS_ROOT =
  process.env.CN_PREVIOUS_ROOT ??
  path.resolve(
    ROOT,
    "..",
    "resonance-logs-cn-main_0.1.4",
    "resonance-logs-cn-main",
  );
const EXPORT_DIR = path.join(ROOT, "DEV_exports");

const TABLES = [
  {
    name: "SkillEffectTable",
    globalPath: "parser-data/logic/SkillEffectTable.json",
    cnPath: "src-tauri/meter-data/SkillEffectTable.json",
    primaryFields: ["Id", "id", "SkillEffectId", "skillEffectId"],
    summaryFields: [
      "Id",
      "SkillId",
      "Level",
      "Name",
      "SkillDamageDistance",
      "EffectRange",
      "Tags",
      "BuffTags",
      "HitTags",
      "EntityTags",
      "SkillAttrDes",
      "SkillCoefID",
      "DamageType",
      "OwnerId",
    ],
  },
  {
    name: "SkillFightLevelTable",
    globalPath: "parser-data/logic/SkillFightLevelTable.json",
    cnPath: "src-tauri/meter-data/SkillFightLevelTable.json",
    primaryFields: ["Id", "id", "SkillId", "skillId"],
    summaryFields: [
      "Id",
      "SkillId",
      "Level",
      "SkillEffectId",
      "Name",
      "SkillCost",
      "SkillResCheck",
      "PVECoolTime",
      "FloatParameter",
      "ShowParameter",
      "FightValue",
    ],
  },
  {
    name: "TempAttrTable",
    globalPath: "parser-data/logic/TempAttrTable.json",
    cnPath: "src-tauri/meter-data/TempAttrTable.json",
    primaryFields: ["Id", "id", "AttrId", "attrId"],
    summaryFields: [
      "Id",
      "Name",
      "Desc",
      "AttrType",
      "LogicType",
      "AttrParams",
      "LowerLimit",
      "UpperLimit",
      "IsSyncClient",
      "AttrDesc",
      "AttrIcon",
    ],
  },
];

const BUFF_IDS_TO_DESCRIBE = ["883522", "883719"];

function readJson(relativeOrAbsolute) {
  const filePath = path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.join(ROOT, relativeOrAbsolute);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getRows(data, primaryFields) {
  if (Array.isArray(data)) {
    return data
      .map((row, index) => {
        const key = primaryFields
          .map((field) => row?.[field])
          .find((value) => value !== undefined && value !== null);
        return [String(key ?? index), row];
      })
      .filter(([key]) => key !== "");
  }

  return Object.entries(data);
}

function sortedKeys(keys) {
  return [...keys].sort((left, right) => {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }
    return left.localeCompare(right);
  });
}

function summarizeRow(row, fields) {
  const out = {};
  for (const field of fields) {
    if (row?.[field] !== undefined) {
      out[field] = row[field];
    }
  }
  return out;
}

function collectReferencedNumbers(value, out = new Set()) {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferencedNumbers(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectReferencedNumbers(item, out);
  }
  return out;
}

function loadTableRows(root, relativePath, primaryFields) {
  const data = readJson(path.join(root, relativePath));
  return new Map(getRows(data, primaryFields));
}

function getBuffEntry(root, id, locale) {
  const base = locale
    ? path.join(root, "src/lib/config", locale, "BuffName.json")
    : path.join(root, "src/lib/config/BuffName.json");
  const data = readJsonIfExists(base);
  if (!data) return null;
  return findEntryById(data, id);
}

function findEntryById(data, id) {
  if (Array.isArray(data)) {
    return data.find((entry) => String(entry?.Id ?? entry?.id) === String(id)) ?? null;
  }
  return data?.[id] ?? null;
}

function summarizeBuffId(id) {
  const globalBuffs = readJson("parser-data/generated/BuffName.json");
  const cnBase = getBuffEntry(CN_ROOT, id, null);
  const cnEn = getBuffEntry(CN_ROOT, id, "en-US");
  const cnJa = getBuffEntry(CN_ROOT, id, "ja-JP");
  const globalEntry = findEntryById(globalBuffs, id);

  return {
    id,
    global: globalEntry,
    cn: cnBase,
    cnLocales: {
      "en-US": cnEn,
      "ja-JP": cnJa,
    },
  };
}

function analyzeTable(table) {
  const globalRows = loadTableRows(ROOT, table.globalPath, table.primaryFields);
  const cnRows = loadTableRows(CN_ROOT, table.cnPath, table.primaryFields);
  const previousRows = fs.existsSync(path.join(CN_PREVIOUS_ROOT, table.cnPath))
    ? loadTableRows(CN_PREVIOUS_ROOT, table.cnPath, table.primaryFields)
    : new Map();

  const missingKeys = sortedKeys(
    [...cnRows.keys()].filter((key) => !globalRows.has(key)),
  );
  const addedSincePreviousKeys = sortedKeys(
    [...cnRows.keys()].filter((key) => !previousRows.has(key)),
  );
  const missingAddedSincePreviousKeys = missingKeys.filter((key) =>
    addedSincePreviousKeys.includes(key),
  );

  const rows = missingKeys.map((key) => {
    const row = cnRows.get(key);
    return {
      key,
      addedSinceCn014: !previousRows.has(key),
      summary: summarizeRow(row, table.summaryFields),
      referencedNumbers: sortedKeys(
        [...collectReferencedNumbers(row)].map((value) => String(value)),
      ).slice(0, 80),
    };
  });

  return {
    name: table.name,
    globalPath: table.globalPath,
    cnPath: table.cnPath,
    globalCount: globalRows.size,
    cnCount: cnRows.size,
    cnPreviousCount: previousRows.size,
    cnOnlyMissingInGlobal: missingKeys.length,
    cnAddedSince014: addedSincePreviousKeys.length,
    missingAndAddedSince014: missingAddedSincePreviousKeys.length,
    missingKeys,
    rows,
  };
}

function writeReport(report) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const jsonPath = path.join(EXPORT_DIR, "cn-0.1.5-logic-table-gaps.json");
  const mdPath = path.join(EXPORT_DIR, "cn-0.1.5-logic-table-gaps.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const lines = [];
  lines.push("# CN 0.1.5 Logic Table Gaps");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push(`Global root: \`${ROOT}\``);
  lines.push(`CN root: \`${CN_ROOT}\``);
  lines.push(`CN previous root: \`${CN_PREVIOUS_ROOT}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(
    "| Table | Global rows | CN rows | CN 0.1.4 rows | CN-only missing in Global | CN-added since 0.1.4 | Missing and added since 0.1.4 |",
  );
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const table of report.tables) {
    lines.push(
      `| ${table.name} | ${table.globalCount} | ${table.cnCount} | ${table.cnPreviousCount} | ${table.cnOnlyMissingInGlobal} | ${table.cnAddedSince014} | ${table.missingAndAddedSince014} |`,
    );
  }
  lines.push("");
  lines.push("## Missing Keys");
  lines.push("");
  for (const table of report.tables) {
    lines.push(`### ${table.name}`);
    lines.push("");
    if (table.missingKeys.length === 0) {
      lines.push("_None._");
      lines.push("");
      continue;
    }
    lines.push(
      table.missingKeys.length > 80
        ? `${table.missingKeys.slice(0, 80).join(", ")} ...`
        : table.missingKeys.join(", "),
    );
    lines.push("");
    lines.push("Sample rows:");
    lines.push("");
    for (const row of table.rows.slice(0, 12)) {
      lines.push(`- \`${row.key}\` addedSinceCn014=${row.addedSinceCn014}`);
      lines.push(`  - summary: \`${JSON.stringify(row.summary)}\``);
      if (row.referencedNumbers.length > 0) {
        lines.push(
          `  - referenced numbers: ${row.referencedNumbers.slice(0, 24).join(", ")}`,
        );
      }
    }
    lines.push("");
  }
  lines.push("## Buff Change Details");
  lines.push("");
  for (const buff of report.buffChanges) {
    lines.push(`### ${buff.id}`);
    lines.push("");
    lines.push(`Global: \`${JSON.stringify(buff.global)}\``);
    lines.push("");
    lines.push(`CN base: \`${JSON.stringify(buff.cn)}\``);
    lines.push("");
    lines.push(`CN en-US: \`${JSON.stringify(buff.cnLocales["en-US"])}\``);
    lines.push("");
    lines.push(`CN ja-JP: \`${JSON.stringify(buff.cnLocales["ja-JP"])}\``);
    lines.push("");
  }
  fs.writeFileSync(mdPath, lines.join("\n"));
  return { jsonPath, mdPath };
}

const report = {
  generatedAt: new Date().toISOString(),
  cnRoot: CN_ROOT,
  cnPreviousRoot: CN_PREVIOUS_ROOT,
  tables: TABLES.map(analyzeTable),
  buffChanges: BUFF_IDS_TO_DESCRIBE.map(summarizeBuffId),
};

const paths = writeReport(report);
console.log(`Wrote ${path.relative(ROOT, paths.mdPath)}`);
console.log(`Wrote ${path.relative(ROOT, paths.jsonPath)}`);
