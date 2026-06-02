#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CN_ROOT =
  process.env.CN_RELEASE_ROOT ??
  path.resolve(ROOT, "..", "resonance-logs-cn-main_0.1.5");
const EXPORT_DIR = path.join(ROOT, "DEV_exports");
const APPLY = process.argv.includes("--apply");

const TABLES = [
  {
    name: "SkillEffectTable",
    globalPath: "parser-data/logic/SkillEffectTable.json",
    cnPath: "src-tauri/meter-data/SkillEffectTable.json",
  },
  {
    name: "SkillFightLevelTable",
    globalPath: "parser-data/logic/SkillFightLevelTable.json",
    cnPath: "src-tauri/meter-data/SkillFightLevelTable.json",
  },
  {
    name: "TempAttrTable",
    globalPath: "parser-data/logic/TempAttrTable.json",
    cnPath: "src-tauri/meter-data/TempAttrTable.json",
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function detectNewline(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
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

function loadObject(filePath, tableName) {
  const data = readJson(filePath);
  if (Array.isArray(data) || !data || typeof data !== "object") {
    throw new Error(`${tableName} must be an object map: ${filePath}`);
  }
  return data;
}

function readStringAt(text, start) {
  let value = "";
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") return { value, end: index + 1 };
    value += char;
  }
  throw new Error("Unterminated JSON string while extracting row text.");
}

function findValueEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error("Unterminated JSON value while extracting row text.");
}

function extractObjectPropertyBlock(text, key) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      if (depth === 1) {
        const stringStart = index;
        const { value, end } = readStringAt(text, index);
        let cursor = end;
        while (/\s/.test(text[cursor] ?? "")) cursor += 1;
        if (text[cursor] === ":" && value === key) {
          const lineStart = text.lastIndexOf("\n", stringStart - 1) + 1;
          cursor += 1;
          while (/\s/.test(text[cursor] ?? "")) cursor += 1;
          const valueEnd = findValueEnd(text, cursor);
          return text.slice(lineStart, valueEnd).trimEnd();
        }
        index = end - 1;
        continue;
      }
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    if (char === "}" || char === "]") depth -= 1;
  }
  throw new Error(`Could not find top-level row ${key}.`);
}

function appendMissingBlocks(globalPath, cnPath, missingKeys) {
  if (missingKeys.length === 0) return;
  const globalText = fs.readFileSync(globalPath, "utf8");
  const cnText = fs.readFileSync(cnPath, "utf8");
  const newline = detectNewline(globalText);
  const hasFinalNewline = /\r?\n$/.test(globalText);
  const closeIndex = globalText.trimEnd().lastIndexOf("}");
  if (closeIndex < 0) {
    throw new Error(`Could not find object close in ${globalPath}`);
  }

  const blocks = missingKeys.map((key) => extractObjectPropertyBlock(cnText, key));
  const prefix = globalText.slice(0, closeIndex).trimEnd();
  const nextText = `${prefix},${newline}${blocks.join(`,${newline}`)}${newline}}${hasFinalNewline ? newline : ""}`;
  fs.writeFileSync(globalPath, nextText);
}

function summarizeRow(row) {
  const summary = {};
  for (const key of [
    "Id",
    "SkillId",
    "Level",
    "SkillEffectId",
    "Name",
    "Desc",
    "AttrType",
    "LogicType",
    "AttrParams",
    "UpperLimit",
    "FightValue",
  ]) {
    if (row?.[key] !== undefined) summary[key] = row[key];
  }
  return summary;
}

function analyzeTable(table) {
  const globalPath = path.join(ROOT, table.globalPath);
  const cnPath = path.join(CN_ROOT, table.cnPath);
  const globalData = loadObject(globalPath, table.name);
  const cnData = loadObject(cnPath, table.name);
  const missingKeys = sortedKeys(
    Object.keys(cnData).filter((key) => globalData[key] === undefined),
  );

  if (APPLY) {
    appendMissingBlocks(globalPath, cnPath, missingKeys);
  }

  return {
    name: table.name,
    globalPath: table.globalPath,
    cnPath: table.cnPath,
    imported: APPLY ? missingKeys.length : 0,
    wouldImport: missingKeys.length,
    missingKeys,
    sampleRows: missingKeys.slice(0, 12).map((key) => ({
      key,
      summary: summarizeRow(cnData[key]),
    })),
  };
}

function writeReport(report) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const jsonPath = path.join(EXPORT_DIR, "cn-0.1.5-logic-table-import.json");
  const mdPath = path.join(EXPORT_DIR, "cn-0.1.5-logic-table-import.md");
  writeJson(jsonPath, report);

  const lines = [];
  lines.push("# CN 0.1.5 Logic Table Import");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Mode: ${report.apply ? "apply" : "dry-run"}`);
  lines.push("");
  lines.push("| Table | Would import | Imported |");
  lines.push("| --- | ---: | ---: |");
  for (const table of report.tables) {
    lines.push(`| ${table.name} | ${table.wouldImport} | ${table.imported} |`);
  }
  lines.push("");
  for (const table of report.tables) {
    lines.push(`## ${table.name}`);
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
    for (const row of table.sampleRows) {
      lines.push(`- \`${row.key}\`: \`${JSON.stringify(row.summary)}\``);
    }
    lines.push("");
  }
  fs.writeFileSync(mdPath, lines.join("\n"));
  return { jsonPath, mdPath };
}

const report = {
  generatedAt: new Date().toISOString(),
  apply: APPLY,
  cnRoot: CN_ROOT,
  tables: TABLES.map(analyzeTable),
};

const paths = writeReport(report);
console.log(APPLY ? "Applied missing CN logic rows." : "Dry run only.");
console.log(`Wrote ${path.relative(ROOT, paths.mdPath)}`);
console.log(`Wrote ${path.relative(ROOT, paths.jsonPath)}`);
