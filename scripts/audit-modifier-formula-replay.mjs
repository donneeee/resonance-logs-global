#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const DEFAULT_LATEST_INPUTS = 3;
const DEFAULT_MAX_ROWS = 80;

function parseArgs(argv) {
  const options = {
    inputs: [],
    latest: DEFAULT_LATEST_INPUTS,
    maxRows: DEFAULT_MAX_ROWS,
    childMaxRows: 1000,
    outJson: path.join(repoRoot, "DEV_exports", "modifier-formula-replay-audit.json"),
    outMd: path.join(repoRoot, "DEV_exports", "modifier-formula-replay-audit.md"),
    ledgerJson: path.join(repoRoot, "DEV_exports", "modifier-formula-replay-hit-ledger.json"),
    ledgerMd: path.join(repoRoot, "DEV_exports", "modifier-formula-replay-hit-ledger.md"),
    readinessJson: path.join(repoRoot, "DEV_exports", "modifier-formula-replay-readiness.json"),
    readinessMd: path.join(repoRoot, "DEV_exports", "modifier-formula-replay-readiness.md"),
    stripJson: path.join(repoRoot, "DEV_exports", "modifier-formula-replay-strip.json"),
    stripMd: path.join(repoRoot, "DEV_exports", "modifier-formula-replay-strip.md"),
    derivedJson: path.join(repoRoot, "DEV_exports", "modifier-formula-replay-derived-contributions.json"),
    derivedMd: path.join(repoRoot, "DEV_exports", "modifier-formula-replay-derived-contributions.md"),
    thresholds: new Map(),
    help: false,
  };

  const thresholdOptions = new Set([
    "--stability-limit",
    "--toggle-error-limit",
    "--min-toggle-hits",
    "--chance-error-limit",
    "--min-chance-toggle-hits",
    "--attack-error-limit",
    "--min-attack-toggle-hits",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };

    if (arg === "--input") {
      options.inputs.push(resolveRepoPath(next()));
    } else if (arg === "--latest") {
      options.latest = Math.max(1, Number(next()) || DEFAULT_LATEST_INPUTS);
    } else if (arg === "--max-rows") {
      options.maxRows = Math.max(1, Number(next()) || DEFAULT_MAX_ROWS);
    } else if (arg === "--child-max-rows") {
      options.childMaxRows = Math.max(1, Number(next()) || 1000);
    } else if (arg === "--out-json") {
      options.outJson = resolveRepoPath(next());
    } else if (arg === "--out-md") {
      options.outMd = resolveRepoPath(next());
    } else if (arg === "--ledger-json") {
      options.ledgerJson = resolveRepoPath(next());
    } else if (arg === "--ledger-md") {
      options.ledgerMd = resolveRepoPath(next());
    } else if (arg === "--readiness-json") {
      options.readinessJson = resolveRepoPath(next());
    } else if (arg === "--readiness-md") {
      options.readinessMd = resolveRepoPath(next());
    } else if (arg === "--strip-json") {
      options.stripJson = resolveRepoPath(next());
    } else if (arg === "--strip-md") {
      options.stripMd = resolveRepoPath(next());
    } else if (arg === "--derived-json") {
      options.derivedJson = resolveRepoPath(next());
    } else if (arg === "--derived-md") {
      options.derivedMd = resolveRepoPath(next());
    } else if (thresholdOptions.has(arg)) {
      options.thresholds.set(arg, next());
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Modifier Formula Replay Proof Audit

Usage:
  node scripts/audit-modifier-formula-replay.mjs [options]

Options:
  --input <path>       Modifier entity export. Repeatable.
  --latest <count>     Use latest DEV_exports/modifier-entity-*.json files when no inputs are provided. Default: ${DEFAULT_LATEST_INPUTS}
  --max-rows <count>   Max Markdown rows per table. Default: ${DEFAULT_MAX_ROWS}
  --child-max-rows <n> Wide internal row cap for child reports. Default: 1000
  --out-json <path>    Combined JSON report. Default: DEV_exports/modifier-formula-replay-audit.json
  --out-md <path>      Combined Markdown report. Default: DEV_exports/modifier-formula-replay-audit.md

Forwarded strip thresholds:
  --stability-limit <n>
  --toggle-error-limit <n>
  --min-toggle-hits <n>
  --chance-error-limit <n>
  --min-chance-toggle-hits <n>
  --attack-error-limit <n>
  --min-attack-toggle-hits <n>

Notes:
  This command is dev-only. It reruns the hit ledger, formula readiness resolver,
  and modifier strip proof audit, then combines them into a proof ladder:
  exact, formula-proven, formula-close, overlap-only, and blocked.
`);
}

function resolveRepoPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runNodeScript(label, scriptRelativePath, args) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, scriptRelativePath), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${label} failed with exit code ${result.status}`);
  }

  return {
    label,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function sharedInputArgs(options) {
  if (options.inputs.length) {
    return options.inputs.flatMap((input) => ["--input", input]);
  }
  return ["--latest", String(options.latest)];
}

function thresholdArgs(options) {
  return [...options.thresholds.entries()].flatMap(([key, value]) => [key, value]);
}

function rerunSourceAudits(options) {
  const common = sharedInputArgs(options);
  const maxRows = ["--max-rows", String(Math.max(options.maxRows, options.childMaxRows))];
  const runs = [];

  runs.push(runNodeScript("hit contribution ledger", "scripts/audit-hit-contribution-ledger.mjs", [
    ...common,
    ...maxRows,
    "--max-hit-rows",
    "0",
    "--out-json",
    options.ledgerJson,
    "--out-md",
    options.ledgerMd,
  ]));

  runs.push(runNodeScript("formula readiness resolver", "scripts/audit-formula-readiness-resolver.mjs", [
    ...common,
    ...maxRows,
    "--out-json",
    options.readinessJson,
    "--out-md",
    options.readinessMd,
  ]));

  runs.push(runNodeScript("modifier strip proof", "scripts/audit-skill-modifier-strip.mjs", [
    ...common,
    ...maxRows,
    ...thresholdArgs(options),
    "--out-json",
    options.stripJson,
    "--out-md",
    options.stripMd,
    "--out-derived-json",
    options.derivedJson,
    "--out-derived-md",
    options.derivedMd,
  ]));

  return runs;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberValue(value) {
  return finiteNumber(value) ?? 0;
}

function formatNumber(value, digits = 0) {
  const number = finiteNumber(value) ?? 0;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(number);
}

function formatPct(value, digits = 1) {
  const number = finiteNumber(value);
  if (number === null) return "";
  return `${(number * 100).toFixed(digits)}%`;
}

function table(headers, rows) {
  if (!rows.length) return "No rows.";
  const escape = (value) => String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
  ].join("\n");
}

function contributionKey(row) {
  const amount = finiteNumber(row?.amount);
  return [
    row?.ruleId ?? "",
    row?.componentKey ?? "",
    row?.term ?? "",
    amount === null ? "" : amount.toFixed(8),
    row?.valueScope ?? "",
  ].join(":");
}

function proofRowKey(row) {
  return [
    row?.proofType ?? row?.proofCategory ?? "",
    row?.ruleId ?? "",
    row?.providerName ?? "",
    row?.providerScope ?? "",
    row?.componentKey ?? "",
    row?.term ?? "",
    finiteNumber(row?.amount) === null ? "" : finiteNumber(row.amount).toFixed(8),
    row?.valueScope ?? "",
  ].join(":");
}

function compactBlockers(blockers) {
  if (Array.isArray(blockers)) return blockers.join("; ");
  return Object.entries(blockers ?? {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 4)
    .map(([key, count]) => `${key} (${formatNumber(count)})`)
    .join("; ");
}

function componentSummary(components) {
  return asArray(components)
    .slice(0, 4)
    .map((component) => {
      if (component?.value) {
        const value = component.value.rawText || component.value.formulaValue;
        return `${component.componentKey}=${value} [${component.value.method}]`;
      }
      return `${component?.componentKey ?? "component"}:${component?.blocker ?? "blocked"}`;
    })
    .join("; ");
}

function formulaCloseRows(strip, provenKeys) {
  const buckets = [
    ["formula-close", "direct-percent-candidate", strip.contributionRows],
    ["formula-close", "experimental-direct-percent-candidate", strip.experimentalContributionRows],
    ["formula-close", "crit-damage-snapshot-candidate", strip.critDamageContributionRows],
    ["formula-close", "experimental-crit-damage-snapshot-candidate", strip.experimentalCritDamageContributionRows],
    ["formula-close", "crit-rate-expected-value-candidate", strip.chanceExpectedContributionRows],
    ["formula-close", "experimental-crit-rate-expected-value-candidate", strip.experimentalChanceExpectedContributionRows],
    ["formula-close", "attack-snapshot-candidate", strip.attackSnapshotContributionRows],
    ["formula-close", "experimental-attack-snapshot-candidate", strip.experimentalAttackSnapshotContributionRows],
  ];

  const rows = [];
  const seen = new Set();
  for (const [proofTier, proofType, entries] of buckets) {
    for (const entry of asArray(entries)) {
      const key = contributionKey(entry);
      if (provenKeys.has(key) || seen.has(`${proofType}:${key}`)) continue;
      seen.add(`${proofType}:${key}`);
      rows.push({
        proofTier,
        proofType,
        ruleId: entry.ruleId,
        sourceId: entry.sourceId ?? null,
        sourceName: entry.label,
        componentKey: entry.componentKey,
        term: entry.term,
        amount: entry.amount,
        valueScope: entry.valueScope ?? null,
        hits: entry.hits ?? 0,
        candidateFinalContribution: entry.finalContribution ?? 0,
        candidateDecritContribution: entry.decritContribution ?? 0,
        damageRows: entry.damageRows ?? [],
        blocker: "needs same-damage active/inactive validation before runtime promotion",
      });
    }
  }

  return rows.sort(
    (left, right) =>
      Math.abs(right.candidateFinalContribution) - Math.abs(left.candidateFinalContribution) ||
      (right.hits ?? 0) - (left.hits ?? 0),
  );
}

function buildReport(options, runResults) {
  const ledger = readJson(options.ledgerJson);
  const readiness = readJson(options.readinessJson);
  const strip = readJson(options.stripJson);
  const derived = readJson(options.derivedJson);

  const ledgerSourceRows = asArray(ledger.sourceSummaries?.length ? ledger.sourceSummaries : ledger.topSources);
  const ledgerExactSourceRows = asArray(
    ledger.exactSourceSummaries?.length
      ? ledger.exactSourceSummaries
      : ledgerSourceRows.filter((row) => row.proofCategory === "exact-produced-damage"),
  );

  const exactRows = ledgerExactSourceRows
    .filter((row) => row.proofCategory === "exact-produced-damage")
    .sort((left, right) => numberValue(right.totalValue) - numberValue(left.totalValue));

  const provenKeys = new Set(asArray(derived.sourceRows).map(contributionKey));
  const formulaProvenRows = asArray(derived.sourceRows)
    .map((row) => ({
      proofTier: "formula-proven",
      ...row,
    }))
    .sort((left, right) => Math.abs(numberValue(right.finalContribution)) - Math.abs(numberValue(left.finalContribution)));

  const closeRows = formulaCloseRows(strip, provenKeys);
  const overlapRows = ledgerSourceRows
    .filter((row) =>
      ["active-only", "timing-only", "active-target-mismatch", "non-damage-active"].includes(row.proofCategory)
    )
    .sort((left, right) => numberValue(right.totalValue) - numberValue(left.totalValue));

  const blockedRows = asArray(readiness.groups)
    .filter((row) => !row.ready)
    .sort((left, right) => numberValue(right.totalValue) - numberValue(left.totalValue));

  return {
    generatedAt: new Date().toISOString(),
    inputs: ledger.inputs ?? readiness.inputs ?? strip.inputs ?? [],
    notes: [
      "This is a dev-only proof report. It does not change runtime UI contribution math.",
      "Exact rows are factual emitted damage rows. Formula-proven rows passed active/inactive validation.",
      "Formula-close rows have enough formula/value evidence for a candidate delta, but are not runtime-safe until validated.",
      "Overlap-only rows are real active source evidence, not mathematical contribution.",
    ],
    childReports: {
      hitLedgerJson: relativePath(options.ledgerJson),
      hitLedgerMarkdown: relativePath(options.ledgerMd),
      readinessJson: relativePath(options.readinessJson),
      readinessMarkdown: relativePath(options.readinessMd),
      stripJson: relativePath(options.stripJson),
      stripMarkdown: relativePath(options.stripMd),
      derivedJson: relativePath(options.derivedJson),
      derivedMarkdown: relativePath(options.derivedMd),
    },
    runResults: runResults.map((run) => ({
      label: run.label,
      stdout: run.stdout.trim().split(/\r?\n/).slice(-8),
      stderr: run.stderr.trim() ? run.stderr.trim().split(/\r?\n/) : [],
    })),
    summary: {
      filesScanned: ledger.summary?.files ?? 0,
      hitsScanned: ledger.summary?.hits ?? 0,
      finalHitValueScanned: ledger.summary?.totalValue ?? 0,
      exactSources: exactRows.length,
      exactHits: exactRows.reduce((sum, row) => sum + numberValue(row.hits), 0),
      exactLinkedValue: exactRows.reduce((sum, row) => sum + numberValue(row.totalValue), 0),
      formulaProvenSources: formulaProvenRows.length,
      formulaProvenDamageRows: derived.summary?.validatedDamageRows ?? 0,
      formulaProvenFinalContribution: derived.summary?.validatedFinalContribution ?? 0,
      formulaProvenDecritContribution: derived.summary?.validatedDecritContribution ?? 0,
      formulaCloseSources: closeRows.length,
      formulaCloseCandidateFinalContribution: closeRows.reduce(
        (sum, row) => sum + numberValue(row.candidateFinalContribution),
        0,
      ),
      formulaReadyGroups: readiness.summary?.readyGroups ?? 0,
      formulaBlockedGroups: readiness.summary?.unresolvedGroups ?? 0,
      formulaBlockedObservations: readiness.summary?.unresolvedObservations ?? 0,
      overlapOnlySources: overlapRows.length,
      unknownActiveModifierObservations: ledger.summary?.unknownActiveModifierObservations ?? 0,
      proofLevels: ledger.summary?.proofLevels ?? {},
      formulaBlockers: readiness.summary?.blockerObservations ?? ledger.summary?.formulaBlockers ?? {},
    },
    exactRows,
    formulaProvenRows,
    formulaCloseRows: closeRows,
    blockedRows,
    overlapRows,
  };
}

function renderMarkdown(report, options) {
  const exactTable = report.exactRows.slice(0, options.maxRows).map((row) => [
    row.sourceName,
    row.providerName,
    row.providerScope,
    row.ruleId,
    row.sourceId ?? "",
    formatNumber(row.hits),
    formatNumber(row.totalValue),
    formatNumber(row.targetMatchHits),
  ]);

  const provenTable = report.formulaProvenRows.slice(0, options.maxRows).map((row) => [
    row.label,
    row.proofType,
    row.ruleId,
    row.sourceId ?? "",
    row.componentKey,
    row.term,
    formatPct(row.amount, 2),
    formatNumber(row.validatedDamageRows),
    `${formatNumber(row.activeHits)}/${formatNumber(row.inactiveHits)}`,
    row.weightedObservedDelta === null ? "" : formatPct(row.weightedObservedDelta, 2),
    formatPct(row.maxDeltaError, 2),
    formatNumber(row.finalContribution),
  ]);

  const closeTable = report.formulaCloseRows.slice(0, options.maxRows).map((row) => [
    row.sourceName,
    row.proofType,
    row.ruleId,
    row.sourceId ?? "",
    row.componentKey,
    row.term,
    formatPct(row.amount, 2),
    formatNumber(row.hits),
    formatNumber(row.candidateFinalContribution),
    asArray(row.damageRows).slice(0, 5).join(", "),
  ]);

  const blockedTable = report.blockedRows.slice(0, options.maxRows).map((row) => [
    row.sourceName,
    row.providerName,
    row.providerScope,
    row.ruleId,
    row.sourceId ?? "",
    formatNumber(row.hits),
    formatNumber(row.totalValue),
    asArray(row.formulaTermIds).join(", "),
    compactBlockers(row.blockers),
    componentSummary(row.components),
  ]);

  const overlapTable = report.overlapRows.slice(0, options.maxRows).map((row) => [
    row.sourceName,
    row.providerName,
    row.providerScope,
    row.proofCategory,
    row.mode,
    row.ruleId,
    formatNumber(row.hits),
    formatNumber(row.totalValue),
    formatNumber(row.targetMatchHits),
  ]);

  return [
    "# Modifier Formula Replay Proof Audit",
    "",
    "Dev-only proof ladder for modifier contribution math. This report does not change runtime totals or the history UI.",
    "",
    "## Summary",
    "",
    `- Files scanned: ${formatNumber(report.summary.filesScanned)}`,
    `- Replay hits scanned: ${formatNumber(report.summary.hitsScanned)}`,
    `- Final hit value scanned: ${formatNumber(report.summary.finalHitValueScanned)}`,
    `- Exact emitted sources: ${formatNumber(report.summary.exactSources)} (${formatNumber(report.summary.exactHits)} hits)`,
    `- Formula-proven sources: ${formatNumber(report.summary.formulaProvenSources)}`,
    `- Formula-proven final contribution: ${formatNumber(report.summary.formulaProvenFinalContribution)}`,
    `- Formula-close candidate sources: ${formatNumber(report.summary.formulaCloseSources)}`,
    `- Formula-ready groups from resolver: ${formatNumber(report.summary.formulaReadyGroups)}`,
    `- Formula-blocked groups from resolver: ${formatNumber(report.summary.formulaBlockedGroups)}`,
    `- Overlap-only/timing/mismatch sources: ${formatNumber(report.summary.overlapOnlySources)}`,
    `- Unknown active modifier observations: ${formatNumber(report.summary.unknownActiveModifierObservations)}`,
    "",
    "## Proof Ladder",
    "",
    "- `exact`: emitted child damage rows that can be counted directly.",
    "- `formula-proven`: candidate formula rows that passed same-damage active/inactive validation.",
    "- `formula-close`: rows with formula terms and component values, but without enough validation yet.",
    "- `blocked`: rows with unresolved component values or missing generated value hints.",
    "- `overlap-only`: real active source evidence that is not numeric contribution.",
    "",
    "## Exact Emitted Sources",
    "",
    table(["Source", "Provider", "Scope", "Rule", "Source ID", "Hits", "Linked Value", "Target Hits"], exactTable),
    "",
    "## Formula-Proven Sources",
    "",
    table(
      [
        "Source",
        "Proof",
        "Rule",
        "Source ID",
        "Component",
        "Term",
        "Expected",
        "Damage Rows",
        "Active/Inactive",
        "Observed",
        "Max Error",
        "Final Contribution",
      ],
      provenTable,
    ),
    "",
    "## Formula-Close Candidates",
    "",
    table(
      ["Source", "Proof", "Rule", "Source ID", "Component", "Term", "Expected", "Hits", "Candidate Final", "Damage IDs"],
      closeTable,
    ),
    "",
    "## Blocked Formula Rows",
    "",
    table(
      ["Source", "Provider", "Scope", "Rule", "Source ID", "Hits", "Linked Value", "Terms", "Blockers", "Components"],
      blockedTable,
    ),
    "",
    "## Overlap-Only / Timing / Target-Mismatch Rows",
    "",
    table(["Source", "Provider", "Scope", "Category", "Mode", "Rule", "Hits", "Linked Value", "Target Hits"], overlapTable),
    "",
    "## Child Reports",
    "",
    ...Object.entries(report.childReports).map(([key, file]) => `- ${key}: ${file}`),
    "",
    "## Inputs",
    "",
    ...asArray(report.inputs).map((file) => `- ${file}`),
    "",
  ].join("\n");
}

function writeReport(report, options) {
  fs.mkdirSync(path.dirname(options.outJson), { recursive: true });
  fs.mkdirSync(path.dirname(options.outMd), { recursive: true });
  fs.writeFileSync(options.outJson, JSON.stringify(report, null, 2));
  fs.writeFileSync(options.outMd, renderMarkdown(report, options));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const runs = rerunSourceAudits(options);
  const report = buildReport(options, runs);
  writeReport(report, options);

  console.log(`Files scanned: ${report.summary.filesScanned}`);
  console.log(`Replay hits scanned: ${report.summary.hitsScanned}`);
  console.log(`Exact emitted sources: ${report.summary.exactSources}`);
  console.log(`Formula-proven sources: ${report.summary.formulaProvenSources}`);
  console.log(`Formula-close candidate sources: ${report.summary.formulaCloseSources}`);
  console.log(`Formula-blocked groups: ${report.summary.formulaBlockedGroups}`);
  console.log(`Overlap-only/timing/mismatch sources: ${report.summary.overlapOnlySources}`);
  console.log(`Output: ${relativePath(options.outJson)}`);
  console.log(`Markdown: ${relativePath(options.outMd)}`);
}

main();
