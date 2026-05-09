#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_CONTRACT = path.join(repoRoot, "src", "lib", "config", "damage-formula-zone-contract.json");
const DEFAULT_INVENTORY = path.join(repoRoot, "DEV_exports", "game-formula-source-inventory.json");
const DEFAULT_LUCKY_RUNTIME = path.join(repoRoot, "parser-data", "generated", "LuckyStrikeRuntime.json");
const DEFAULT_OUT_JSON = path.join(repoRoot, "DEV_exports", "formula-zone-contract-audit.json");
const DEFAULT_OUT_MD = path.join(repoRoot, "DEV_exports", "formula-zone-contract-audit.md");

function parseArgs(argv) {
  const options = {
    contract: DEFAULT_CONTRACT,
    inventory: DEFAULT_INVENTORY,
    luckyRuntime: DEFAULT_LUCKY_RUNTIME,
    outJson: DEFAULT_OUT_JSON,
    outMd: DEFAULT_OUT_MD,
    maxExamples: 4,
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
      case "--contract":
        options.contract = resolvePath(next());
        break;
      case "--inventory":
        options.inventory = resolvePath(next());
        break;
      case "--lucky-runtime":
        options.luckyRuntime = resolvePath(next());
        break;
      case "--out-json":
        options.outJson = resolvePath(next());
        break;
      case "--out-md":
        options.outMd = resolvePath(next());
        break;
      case "--max-examples":
        options.maxExamples = Math.max(0, Number(next()) || 0);
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
  console.log(`Formula Zone Contract Audit

Usage:
  node scripts/audit-formula-zone-contract.mjs [options]

Options:
  --contract <file>       Formula zone contract JSON.
  --inventory <file>      game-formula-source-inventory JSON.
  --lucky-runtime <file>  LuckyStrikeRuntime JSON.
  --out-json <file>       Output JSON path.
  --out-md <file>         Output Markdown path.
  --max-examples <n>      Example sources per zone. Default: 4.
  --help                  Show this help.
`);
}

function resolvePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonOptional(filePath, fallback) {
  return fs.existsSync(filePath) ? readJson(filePath) : fallback;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("en-US").format(number) : "";
}

function escapeMd(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.map(escapeMd).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeMd).join(" | ")} |`),
  ].join("\n");
}

function sourceName(source) {
  return source?.name ?? source?.sourceName ?? source?.sourceId ?? "";
}

function sourceKind(source) {
  return source?.sourceKind ?? source?.sourceType ?? "";
}

function buildBucketIndex(sources) {
  const byBucket = new Map();
  for (const source of sources) {
    for (const bucket of asArray(source?.formulaBuckets)) {
      if (!byBucket.has(bucket)) {
        byBucket.set(bucket, {
          bucket,
          sources: [],
          externalCandidateCount: 0,
          sourceKinds: new Map(),
        });
      }
      const entry = byBucket.get(bucket);
      entry.sources.push(source);
      if (source?.externalCandidate) entry.externalCandidateCount += 1;
      const kind = sourceKind(source) || "unknown";
      entry.sourceKinds.set(kind, (entry.sourceKinds.get(kind) ?? 0) + 1);
    }
  }
  return byBucket;
}

function uniqueSourcesForBuckets(sources, buckets) {
  const wanted = new Set(buckets);
  return sources.filter((source) => asArray(source?.formulaBuckets).some((bucket) => wanted.has(bucket)));
}

function buildLuckyTermIndex(luckyRuntime) {
  const termCounts = luckyRuntime?.stats?.termCounts ?? {};
  const sourceTermCounts = {};
  for (const source of Object.values(luckyRuntime?.sourcesById ?? {})) {
    for (const term of asArray(source?.luckyTerms)) {
      const termId = term?.termId;
      if (!termId) continue;
      sourceTermCounts[termId] = (sourceTermCounts[termId] ?? 0) + 1;
    }
  }
  return {
    stats: luckyRuntime?.stats ?? {},
    termCounts,
    sourceTermCounts,
  };
}

function zoneStatus(zone, sourceCount, luckyTermCount, missingBuckets) {
  if (zone.captureStatus === "classifier-gap") return "classifier gap";
  if (zone.captureStatus === "captured-when-emitted" && (sourceCount || luckyTermCount)) return "exact when emitted";
  if (sourceCount || luckyTermCount) return "mapped candidates";
  if (missingBuckets.length) return "missing classifier bucket";
  return "unmapped";
}

function buildReport(options) {
  if (!fs.existsSync(options.contract)) throw new Error(`Missing contract: ${options.contract}`);
  if (!fs.existsSync(options.inventory)) {
    throw new Error(`Missing inventory: ${options.inventory}. Run npm run lab:game-formula-sources first.`);
  }

  const contract = readJson(options.contract);
  const inventory = readJson(options.inventory);
  const luckyRuntime = readJsonOptional(options.luckyRuntime, { stats: {}, sourcesById: {} });
  const sources = asArray(inventory.sources);
  const bucketIndex = buildBucketIndex(sources);
  const knownBuckets = new Set(bucketIndex.keys());
  const luckyTerms = buildLuckyTermIndex(luckyRuntime);

  const zoneRows = asArray(contract.zones)
    .slice()
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((zone) => {
      const buckets = asArray(zone.formulaBuckets);
      const matchedSources = uniqueSourcesForBuckets(sources, buckets);
      const sourceKinds = [...new Set(matchedSources.map(sourceKind).filter(Boolean))].sort();
      const missingBuckets = buckets.filter((bucket) => !knownBuckets.has(bucket));
      const luckyTermIds = asArray(zone.luckyTerms);
      const luckyTermCount = luckyTermIds.reduce(
        (sum, termId) => sum + Number(luckyTerms.termCounts?.[termId] ?? luckyTerms.sourceTermCounts?.[termId] ?? 0),
        0,
      );
      const examples = matchedSources
        .slice()
        .sort((left, right) => sourceName(left).localeCompare(sourceName(right)))
        .slice(0, options.maxExamples)
        .map((source) => ({
          sourceId: source.sourceId,
          sourceKind: sourceKind(source),
          name: sourceName(source),
          formulaBuckets: asArray(source.formulaBuckets),
        }));

      return {
        id: zone.id,
        order: zone.order,
        label: zone.label,
        formula: zone.formula,
        appliesTo: asArray(zone.appliesTo),
        formulaBuckets: buckets,
        missingBuckets,
        sourceCount: matchedSources.length,
        externalCandidateCount: matchedSources.filter((source) => source.externalCandidate).length,
        sourceKinds,
        luckyTerms: luckyTermIds,
        luckyTermCount,
        captureStatus: zone.captureStatus,
        contributionMath: zone.contributionMath,
        status: zoneStatus(zone, matchedSources.length, luckyTermCount, missingBuckets),
        examples,
        notes: asArray(zone.notes),
      };
    });

  const contractBuckets = new Set(zoneRows.flatMap((zone) => zone.formulaBuckets));
  const unassignedBuckets = [...knownBuckets]
    .filter((bucket) => !contractBuckets.has(bucket))
    .sort()
    .map((bucket) => {
      const entry = bucketIndex.get(bucket);
      return {
        bucket,
        sourceCount: entry?.sources.length ?? 0,
        externalCandidateCount: entry?.externalCandidateCount ?? 0,
        sourceKinds: [...(entry?.sourceKinds.keys() ?? [])].sort(),
      };
    });

  const classifierGapZones = zoneRows.filter((zone) => zone.status === "classifier gap" || zone.missingBuckets.length);
  const mappedZones = zoneRows.filter((zone) => zone.sourceCount || zone.luckyTermCount);

  return {
    generatedAt: new Date().toISOString(),
    inputPaths: {
      contract: path.relative(repoRoot, options.contract),
      inventory: path.relative(repoRoot, options.inventory),
      luckyRuntime: fs.existsSync(options.luckyRuntime) ? path.relative(repoRoot, options.luckyRuntime) : null,
    },
    sourceNote: contract.sourceNote,
    hitTypes: asArray(contract.hitTypes),
    summary: {
      inventorySources: sources.length,
      inventoryFormulaBuckets: knownBuckets.size,
      contractZones: zoneRows.length,
      mappedZones: mappedZones.length,
      classifierGapZones: classifierGapZones.length,
      unassignedInventoryBuckets: unassignedBuckets.length,
      luckyRuntimeStats: luckyTerms.stats,
    },
    zones: zoneRows,
    unassignedBuckets,
  };
}

function buildMarkdown(report) {
  const lines = [
    "# Formula Zone Contract Audit",
    "",
    report.sourceNote,
    "",
    "## Summary",
    "",
    `- Inventory sources: ${formatNumber(report.summary.inventorySources)}`,
    `- Inventory formula buckets: ${formatNumber(report.summary.inventoryFormulaBuckets)}`,
    `- Contract zones: ${formatNumber(report.summary.contractZones)}`,
    `- Zones with mapped candidate evidence: ${formatNumber(report.summary.mappedZones)}`,
    `- Classifier gap zones: ${formatNumber(report.summary.classifierGapZones)}`,
    `- Unassigned current inventory buckets: ${formatNumber(report.summary.unassignedInventoryBuckets)}`,
    "",
    "## Hit Formulas",
    "",
    markdownTable(
      ["Hit Type", "Formula", "Notes"],
      report.hitTypes.map((hitType) => [
        hitType.label,
        hitType.formula,
        asArray(hitType.notes).join(" "),
      ]),
    ),
    "",
    "## Zone Coverage",
    "",
    markdownTable(
      ["Order", "Zone", "Status", "Buckets", "Sources", "Lucky Terms", "Contribution Math"],
      report.zones.map((zone) => [
        zone.order,
        zone.label,
        zone.status,
        zone.formulaBuckets.join(", "),
        zone.sourceCount,
        zone.luckyTerms.length ? `${zone.luckyTermCount} (${zone.luckyTerms.join(", ")})` : "",
        zone.contributionMath,
      ]),
    ),
    "",
    "## Classifier Gaps",
    "",
    report.zones.some((zone) => zone.missingBuckets.length)
      ? markdownTable(
          ["Zone", "Missing Buckets", "Why It Matters"],
          report.zones
            .filter((zone) => zone.missingBuckets.length)
            .map((zone) => [zone.label, zone.missingBuckets.join(", "), zone.formula]),
        )
      : "No missing contract buckets.",
    "",
    "## Unassigned Current Buckets",
    "",
    report.unassignedBuckets.length
      ? markdownTable(
          ["Bucket", "Sources", "External Candidates", "Source Kinds"],
          report.unassignedBuckets.map((row) => [
            row.bucket,
            row.sourceCount,
            row.externalCandidateCount,
            row.sourceKinds.join(", "),
          ]),
        )
      : "Every current inventory bucket is referenced by the contract.",
    "",
    "## Examples",
    "",
  ];

  for (const zone of report.zones.filter((entry) => entry.examples.length)) {
    lines.push(`### ${zone.label}`, "");
    lines.push(markdownTable(
      ["Source", "Kind", "Buckets"],
      zone.examples.map((example) => [example.name, example.sourceKind, example.formulaBuckets.join(", ")]),
    ));
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const report = buildReport(options);
  writeJson(options.outJson, report);
  writeText(options.outMd, buildMarkdown(report));

  console.log(`Formula zones: ${report.summary.contractZones}`);
  console.log(`Mapped zones: ${report.summary.mappedZones}`);
  console.log(`Classifier gap zones: ${report.summary.classifierGapZones}`);
  console.log(`Wrote ${path.relative(repoRoot, options.outJson)}`);
  console.log(`Wrote ${path.relative(repoRoot, options.outMd)}`);
}

main();
