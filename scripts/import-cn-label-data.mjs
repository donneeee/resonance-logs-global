#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GLOBAL_ROOT = path.resolve(__dirname, "..");
const BETA_ROOT = path.resolve(GLOBAL_ROOT, "..");
const DEFAULT_CN_ROOT = path.join(BETA_ROOT, "resonance-logs-cn-main_0.1.7");
const DEFAULT_PREVIOUS_CN_ROOT = path.join(BETA_ROOT, "resonance-logs-cn-main_0.1.6");
const OUTPUT_DIR = path.join(GLOBAL_ROOT, "DEV_exports");

const LOCALES = [
  "de",
  "en",
  "es",
  "fr",
  "id",
  "ja",
  "ko-KR",
  "pt-BR",
  "th",
  "zh-CN",
  "zh-TW",
];

const DATASETS = [
  {
    name: "Buff names",
    keyField: "Id",
    globalPath: "parser-data/generated/BuffName.json",
    cnPath: "src/lib/config/BuffName.json",
    cnLocalePaths: {
      en: "src/lib/config/en-US/BuffName.json",
      ja: "src/lib/config/ja-JP/BuffName.json",
    },
    outputShape: "array",
    importKind: "buff",
  },
  {
    name: "Scene names",
    keyField: "Id",
    globalPath: "parser-data/generated/scenenames.json",
    cnPath: "src/lib/config/SceneName.json",
    cnLocalePaths: {
      en: "src/lib/config/en-US/SceneName.json",
      ja: "src/lib/config/ja-JP/SceneName.json",
    },
    outputShape: "object",
    importKind: "scene",
  },
  {
    name: "Monster names",
    keyField: "Id",
    globalPath: "parser-data/generated/monsternames.json",
    cnPath: "src/lib/config/MonsterIdNameType.json",
    cnLocalePaths: {
      en: "src/lib/config/en-US/MonsterIdNameType.json",
      ja: "src/lib/config/ja-JP/MonsterIdNameType.json",
    },
    outputShape: "object",
    importKind: "monster",
  },
  {
    name: "Recount table",
    keyField: "Id",
    globalPath: "parser-data/generated/RecountTable.json",
    cnPath: "src/lib/config/RecountTable.json",
    cnLocalePaths: {
      en: "src/lib/config/en-US/RecountTable.json",
      ja: "src/lib/config/ja-JP/RecountTable.json",
    },
    outputShape: "object",
    importKind: "recount",
  },
  {
    name: "DBM table",
    keyField: "Id",
    globalPath: "parser-data/generated/DbmTable.json",
    cnPath: "src/lib/config/DbmTable.json",
    cnLocalePaths: {
      en: "src/lib/config/en-US/DbmTable.json",
      ja: "src/lib/config/ja-JP/DbmTable.json",
    },
    outputShape: "object",
    importKind: "dbm",
  },
  {
    name: "Damage attribute names",
    keyField: "Id",
    globalPath: "parser-data/generated/DamageAttrIdName.json",
    cnPath: "src/lib/config/DamageAttrIdName.json",
    cnLocalePaths: {
      en: "src/lib/config/en-US/DamageAttrIdName.json",
      ja: "src/lib/config/ja-JP/DamageAttrIdName.json",
    },
    outputShape: "object",
    importKind: "damageAttr",
  },
  {
    name: "Skill icons",
    keyField: "id",
    globalPath: "parser-data/generated/skill_aoyi_icons.json",
    cnPath: "src/lib/config/skill_aoyi_icons.json",
    cnLocalePaths: {
      en: "src/lib/config/en-US/skill_aoyi_icons.json",
      ja: "src/lib/config/ja-JP/skill_aoyi_icons.json",
    },
    outputShape: "array",
    importKind: "skillIcon",
  },
];

function parseArgs(argv) {
  const args = {
    cnRoot: DEFAULT_CN_ROOT,
    previousCnRoot: DEFAULT_PREVIOUS_CN_ROOT,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--cn-root") {
      const value = argv[i + 1];
      if (!value) throw new Error("--cn-root requires a path");
      args.cnRoot = path.resolve(value);
      i += 1;
    } else if (arg === "--previous-cn-root") {
      const value = argv[i + 1];
      if (!value) throw new Error("--previous-cn-root requires a path");
      args.previousCnRoot = path.resolve(value);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function resolveReleaseRoot(candidate) {
  if (fs.existsSync(path.join(candidate, "src", "lib", "config"))) return candidate;
  const nested = path.join(candidate, "resonance-logs-cn-main");
  if (fs.existsSync(path.join(nested, "src", "lib", "config"))) return nested;
  return candidate;
}

function inferCnReleaseLabel(root) {
  const normalized = path.resolve(root);
  const candidates = [
    path.basename(normalized),
    path.basename(path.dirname(normalized)),
  ];
  for (const candidate of candidates) {
    const match = candidate.match(/(\d+\.\d+\.\d+)/);
    if (match) return match[1];
  }
  return path.basename(normalized).replace(/^resonance-logs-cn-main_?/, "") || "unknown";
}

function reportPaths(releaseLabel) {
  return {
    json: path.join(OUTPUT_DIR, `cn-${releaseLabel}-label-import-analysis.json`),
    markdown: path.join(OUTPUT_DIR, `cn-${releaseLabel}-label-import-analysis.md`),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value, dryRun) {
  if (dryRun) return;
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function numericKey(key) {
  const value = Number(key);
  return Number.isFinite(value) ? value : null;
}

function compareKeys(left, right) {
  const leftNum = numericKey(left);
  const rightNum = numericKey(right);
  if (leftNum !== null && rightNum !== null && leftNum !== rightNum) {
    return leftNum - rightNum;
  }
  return String(left).localeCompare(String(right), "en", { numeric: true });
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function pickName(entry) {
  if (typeof entry === "string") return entry;
  return entry?.Name ?? entry?.NameDesign ?? entry?.DesignName ?? entry?.RecountName ?? entry?.Content ?? entry?.name ?? null;
}

function getKey(entry, keyField, fallbackKey) {
  if (entry && typeof entry === "object") {
    for (const field of [keyField, "Id", "id", "skillId"]) {
      if (entry[field] !== undefined && entry[field] !== null && String(entry[field]).trim()) {
        return String(entry[field]);
      }
    }
  }
  return String(fallbackKey);
}

function entriesFromRaw(raw, keyField) {
  if (Array.isArray(raw)) {
    return raw.map((entry) => ({
      key: getKey(entry, keyField),
      entry,
    }));
  }

  return Object.entries(raw).map(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entry = { ...value };
      if (entry[keyField] === undefined) entry[keyField] = numericKey(key) ?? key;
      return { key: getKey(entry, keyField, key), entry };
    }
    return {
      key: String(key),
      entry: {
        [keyField]: numericKey(key) ?? key,
        Name: value,
        NameDesign: value,
      },
    };
  });
}

function mapByKey(raw, keyField) {
  return new Map(entriesFromRaw(raw, keyField).map(({ key, entry }) => [key, entry]));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function collectTexts(entry) {
  const out = [];
  for (const value of [entry?.Name, entry?.NameDesign, entry?.DesignName, entry?.RecountName, entry?.Content, entry?.name]) {
    if (hasText(value)) out.push(value.trim());
  }
  for (const record of [entry?.Names, entry?.MonsterNames, entry?.QuoteTexts]) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    for (const value of Object.values(record)) {
      if (hasText(value)) out.push(value.trim());
    }
  }
  return [...new Set(out)];
}

function buildNameIndex(globalEntries) {
  const index = new Map();
  for (const { key, entry } of globalEntries) {
    for (const text of collectTexts(entry)) {
      const normalized = normalizeText(text);
      if (!normalized) continue;
      const list = index.get(normalized) ?? [];
      list.push({ key, text });
      index.set(normalized, list);
    }
  }
  return index;
}

function loadLocaleMaps(root, dataset) {
  const out = {};
  for (const [locale, relativePath] of Object.entries(dataset.cnLocalePaths ?? {})) {
    const filePath = path.join(root, relativePath);
    out[locale] = fs.existsSync(filePath)
      ? mapByKey(readJson(filePath), dataset.keyField)
      : new Map();
  }
  return out;
}

function buildNames(baseEntry, localeMaps, key) {
  const base = pickName(baseEntry);
  const en = pickName(localeMaps.en?.get(key));
  const ja = pickName(localeMaps.ja?.get(key));
  const enFallback = hasText(en) ? en.trim() : hasText(base) ? base.trim() : `#${key}`;
  const zhFallback = hasText(base) ? base.trim() : enFallback;
  const jaFallback = hasText(ja) ? ja.trim() : enFallback;
  const out = {
    design: zhFallback,
    en: enFallback,
    "zh-CN": zhFallback,
    ja: jaFallback,
  };
  for (const locale of LOCALES) {
    if (out[locale]) continue;
    out[locale] = locale === "zh-CN" ? zhFallback : locale === "ja" ? jaFallback : enFallback;
  }
  return out;
}

function cnTextsForAnalysis(entry, localeMaps, key) {
  const names = buildNames(entry, localeMaps, key);
  return [...new Set([pickName(entry), names.en, names["zh-CN"], names.ja].filter(hasText))];
}

function sameNameMatches(entry, localeMaps, key, nameIndex) {
  const matchesByKey = new Map();
  for (const text of cnTextsForAnalysis(entry, localeMaps, key)) {
    const normalized = normalizeText(text);
    if (!normalized) continue;
    for (const match of nameIndex.get(normalized) ?? []) {
      const list = matchesByKey.get(match.key) ?? [];
      list.push(match.text);
      matchesByKey.set(match.key, list);
    }
  }
  return [...matchesByKey.entries()]
    .sort(([left], [right]) => compareKeys(left, right))
    .slice(0, 10)
    .map(([matchKey, texts]) => ({
      key: matchKey,
      texts: [...new Set(texts)].slice(0, 3),
    }));
}

function createImportedEntry(dataset, key, cnEntry, names, sourceLabel) {
  const numericId = numericKey(key);
  const idValue = numericId ?? key;
  const baseName = names["zh-CN"] ?? names.en ?? names.design ?? `#${key}`;

  if (dataset.importKind === "buff") {
    return {
      Id: idValue,
      Name: names.en,
      NameDesign: baseName,
      DesignName: baseName,
      Names: names,
      ...(hasText(cnEntry.Icon) ? { Icon: cnEntry.Icon.trim() } : {}),
      ...(hasText(cnEntry.SpriteFile) ? { SpriteFile: cnEntry.SpriteFile.trim() } : {}),
      Source: `CN ${sourceLabel} BuffName.json`,
    };
  }

  if (dataset.importKind === "scene") {
    return {
      Id: idValue,
      Name: names.en,
      NameDesign: baseName,
      NameId: null,
      Names: names,
      Source: `CN ${sourceLabel} SceneName.json`,
    };
  }

  if (dataset.importKind === "monster") {
    return {
      Id: idValue,
      Name: names.en,
      NameDesign: baseName,
      Names: names,
      MonsterType: Number(cnEntry.MonsterType ?? 0),
      Source: `CN ${sourceLabel} MonsterIdNameType.json`,
    };
  }

  if (dataset.importKind === "recount") {
    return {
      ...cnEntry,
      Id: idValue,
      Name: names.en,
      RecountName: names.en,
      NameDesign: baseName,
      Names: names,
      Source: `CN ${sourceLabel} RecountTable.json`,
    };
  }

  if (dataset.importKind === "dbm") {
    return {
      Id: idValue,
      CountCDTime: Number(cnEntry.CountCDTime ?? 0),
      Content: names.en,
      ContentDesign: baseName,
      Contents: names,
      Names: names,
      Source: `CN ${sourceLabel} DbmTable.json`,
    };
  }

  if (dataset.importKind === "damageAttr") {
    return {
      Id: idValue,
      Name: names.en,
      NameDesign: baseName,
      Names: names,
      Source: `CN ${sourceLabel} DamageAttrIdName.json`,
    };
  }

  return {
    id: idValue,
    Name: names.en,
    NameDesign: baseName,
    Names: names,
    Icon: cnEntry.Icon ?? cnEntry.icon ?? "",
    Source: `CN ${sourceLabel} skill_aoyi_icons.json`,
  };
}

function sortArrayByKey(entries, keyField) {
  return [...entries].sort((left, right) =>
    compareKeys(getKey(left, keyField), getKey(right, keyField)),
  );
}

function sortObjectByNumericKey(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort(compareKeys)) {
    out[key] = obj[key];
  }
  return out;
}

function analyzeDataset(dataset, roots) {
  const globalPath = path.join(GLOBAL_ROOT, dataset.globalPath);
  const cnPath = path.join(roots.cnRoot, dataset.cnPath);
  const previousPath = path.join(roots.previousCnRoot, dataset.cnPath);

  const globalRaw = fs.existsSync(globalPath)
    ? readJson(globalPath)
    : dataset.outputShape === "array"
      ? []
      : {};
  const cnRaw = readJson(cnPath);
  const previousRaw = fs.existsSync(previousPath) ? readJson(previousPath) : null;
  const localeMaps = loadLocaleMaps(roots.cnRoot, dataset);

  const globalEntries = entriesFromRaw(globalRaw, dataset.keyField);
  const cnEntries = entriesFromRaw(cnRaw, dataset.keyField);
  const previousByKey = previousRaw ? mapByKey(previousRaw, dataset.keyField) : new Map();
  const globalByKey = new Map(globalEntries.map(({ key, entry }) => [key, entry]));
  const nameIndex = buildNameIndex(globalEntries);

  const missing = [];
  const olderCnOnlyMissing = [];
  const present = [];
  const changedSincePrevious = [];
  const importedEntries = [];

  for (const { key, entry } of cnEntries) {
    const previous = previousByKey.get(key);
    const isCnReleaseAdded = !previous;
    if (isCnReleaseAdded || canonical(previous) !== canonical(entry)) {
      changedSincePrevious.push(key);
    }
    if (globalByKey.has(key)) {
      present.push(key);
      continue;
    }

    const names = buildNames(entry, localeMaps, key);
    const matches = sameNameMatches(entry, localeMaps, key, nameIndex);
    missing.push({
      key,
      name: names.en,
      zhCN: names["zh-CN"],
      ja: names.ja,
      sameNameMatches: matches,
    });
    if (isCnReleaseAdded) {
      importedEntries.push(createImportedEntry(dataset, key, entry, names, roots.sourceLabel));
    } else {
      olderCnOnlyMissing.push({
        key,
        name: names.en,
        zhCN: names["zh-CN"],
        ja: names.ja,
        sameNameMatches: matches,
      });
    }
  }

  const possibleAliases = missing.filter((entry) => entry.sameNameMatches.length > 0);
  const importedKeys = new Set(importedEntries.map((entry) => String(entry[dataset.keyField] ?? entry.Id ?? entry.id)));
  const releaseMissing = missing.filter((entry) => importedKeys.has(entry.key));
  return {
    dataset,
    globalRaw,
    globalPath,
    missing,
    releaseMissing,
    olderCnOnlyMissing,
    presentCount: present.length,
    changedSincePrevious,
    possibleAliases,
    importedEntries,
    counts: {
      global: globalEntries.length,
      cn: cnEntries.length,
      missing: missing.length,
      releaseMissing: releaseMissing.length,
      olderCnOnlyMissing: olderCnOnlyMissing.length,
      sameNameMissing: possibleAliases.length,
      releaseSameNameMissing: releaseMissing.filter((entry) => entry.sameNameMatches.length > 0).length,
      changedSincePrevious: changedSincePrevious.length,
    },
  };
}

function applyImports(result, dryRun) {
  const { dataset, globalRaw, importedEntries, globalPath } = result;
  if (importedEntries.length === 0) return;

  if (dataset.outputShape === "array") {
    const merged = sortArrayByKey([...globalRaw, ...importedEntries], dataset.keyField);
    writeJson(globalPath, merged, dryRun);
    return;
  }

  const merged = { ...globalRaw };
  for (const entry of importedEntries) {
    const key = String(entry[dataset.keyField] ?? entry.Id ?? entry.id);
    merged[key] = entry;
  }
  writeJson(globalPath, sortObjectByNumericKey(merged), dryRun);
}

function markdownTable(rows, headers, renderRow) {
  if (rows.length === 0) return "_None._\n";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${renderRow(row).map(markdownCell).join(" | ")} |`),
  ].join("\n") + "\n";
}

function markdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function writeReport(results, dryRun, releaseLabel, paths) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const json = {
    dryRun,
    releaseLabel,
    generatedAt: new Date().toISOString(),
    datasets: results.map((result) => ({
      name: result.dataset.name,
      path: result.dataset.globalPath,
      counts: result.counts,
      missing: result.missing,
      releaseMissing: result.releaseMissing,
      olderCnOnlyMissing: result.olderCnOnlyMissing,
      possibleAliases: result.possibleAliases,
    })),
  };
  fs.writeFileSync(paths.json, `${JSON.stringify(json, null, 2)}\n`, "utf8");

  const lines = [
    `# CN ${releaseLabel} Label Import Analysis`,
    "",
    `Mode: ${dryRun ? "dry-run" : "write"}`,
    "",
    "| Dataset | Global | CN | Release-new IDs imported | Older CN-only IDs left alone | Imported IDs with same-name matches | CN changed vs previous |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const result of results) {
    lines.push(
      `| ${result.dataset.name} | ${result.counts.global} | ${result.counts.cn} | ${result.counts.releaseMissing} | ${result.counts.olderCnOnlyMissing} | ${result.counts.releaseSameNameMissing} | ${result.counts.changedSincePrevious} |`,
    );
  }
  lines.push("");
  lines.push("Same-name matches are advisory only. Runtime lookup is UID/key based, so release-new missing IDs are still imported unless the exact ID already exists. Older CN-only gaps are reported but left untouched in this slice.");
  lines.push("");

  for (const result of results) {
    lines.push(`## ${result.dataset.name}`);
    lines.push("");
    lines.push("### Release-new missing IDs imported");
    lines.push("");
    lines.push(markdownTable(result.releaseMissing.slice(0, 100), ["ID", "en", "zh-CN", "Same-name Global IDs"], (row) => [
      row.key,
      row.name,
      row.zhCN,
      row.sameNameMatches.map((match) => `${match.key}: ${match.texts.join(" / ")}`).join("<br>"),
    ]));
    lines.push("");
    lines.push("### Older CN-only IDs left alone");
    lines.push("");
    lines.push(markdownTable(result.olderCnOnlyMissing.slice(0, 40), ["ID", "en", "zh-CN", "Same-name Global IDs"], (row) => [
      row.key,
      row.name,
      row.zhCN,
      row.sameNameMatches.map((match) => `${match.key}: ${match.texts.join(" / ")}`).join("<br>"),
    ]));
    lines.push("");
  }

  fs.writeFileSync(paths.markdown, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const roots = {
    cnRoot: resolveReleaseRoot(path.resolve(args.cnRoot)),
    previousCnRoot: resolveReleaseRoot(path.resolve(args.previousCnRoot)),
  };
  roots.sourceLabel = inferCnReleaseLabel(roots.cnRoot);
  const paths = reportPaths(roots.sourceLabel);

  const results = DATASETS.map((dataset) => analyzeDataset(dataset, roots));
  for (const result of results) {
    applyImports(result, args.dryRun);
  }
  writeReport(results, args.dryRun, roots.sourceLabel, paths);

  console.log(args.dryRun ? "Dry run complete." : "Imported CN label/icon additions.");
  for (const result of results) {
    console.log(
      `${result.dataset.name}: release-new=${result.counts.releaseMissing}, older-cn-only=${result.counts.olderCnOnlyMissing}, release-same-name=${result.counts.releaseSameNameMissing}, changed-vs-previous=${result.counts.changedSincePrevious}`,
    );
  }
  console.log(`Wrote ${path.relative(GLOBAL_ROOT, paths.markdown)}`);
  console.log(`Wrote ${path.relative(GLOBAL_ROOT, paths.json)}`);
}

main();
