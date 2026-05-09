#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const DEFAULT_LATEST_INPUTS = 5;
const DEFAULT_OUT_JSON = "DEV_exports/final-damage-field-audit.json";
const DEFAULT_OUT_MD = "DEV_exports/final-damage-field-audit.md";
const NEAR_RATIO = 1.5;
const RATIO_TOLERANCE = 0.06;

function parseArgs(argv) {
  const options = {
    inputs: [],
    latest: DEFAULT_LATEST_INPUTS,
    outJson: DEFAULT_OUT_JSON,
    outMd: DEFAULT_OUT_MD,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      options.inputs.push(argv[++index]);
    } else if (arg === "--latest") {
      options.latest = Math.max(1, Number(argv[++index]) || DEFAULT_LATEST_INPUTS);
    } else if (arg === "--out-json") {
      options.outJson = argv[++index];
    } else if (arg === "--out-md") {
      options.outMd = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/audit-final-damage-fields.mjs [options]

Options:
  --input <path>       Add a specific modifier-entity export. Repeatable.
  --latest <count>     Use the latest DEV_exports/modifier-entity-*.json files when no inputs are provided.
  --out-json <path>    JSON report path. Default: ${DEFAULT_OUT_JSON}
  --out-md <path>      Markdown report path. Default: ${DEFAULT_OUT_MD}
`);
}

function resolveRepoPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

function latestModifierEntityExports(count) {
  const dir = path.join(repoRoot, "DEV_exports");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^modifier-entity-.+\.json$/i.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);
      return { fullPath, stat: fs.statSync(fullPath) };
    })
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)
    .slice(0, count)
    .map((entry) => entry.fullPath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function pct(value, total) {
  return total > 0 ? (value / total) * 100 : 0;
}

function ratio(value, total) {
  return total > 0 ? value / total : null;
}

function nearRatio(value) {
  return value !== null && Math.abs(value - NEAR_RATIO) <= RATIO_TOLERANCE;
}

function formatNumber(value) {
  return Math.round(Number(value) || 0).toLocaleString("en-US");
}

function formatRatio(value) {
  return value === null ? "n/a" : value.toFixed(4);
}

function formatPct(value) {
  return `${value.toFixed(2)}%`;
}

function statTotal(stats, key = "total") {
  return numberValue(asObject(stats)[key]);
}

function sumSkillStats(skills) {
  const totals = {
    totalValue: 0,
    effectiveTotalValue: 0,
    hits: 0,
    critHits: 0,
    critTotalValue: 0,
    luckyHits: 0,
    luckyTotalValue: 0,
    rows: 0,
  };

  for (const row of Object.values(asObject(skills))) {
    totals.rows += 1;
    totals.totalValue += numberValue(row?.totalValue);
    totals.effectiveTotalValue += numberValue(row?.effectiveTotalValue);
    totals.hits += numberValue(row?.hits);
    totals.critHits += numberValue(row?.critHits);
    totals.critTotalValue += numberValue(row?.critTotalValue);
    totals.luckyHits += numberValue(row?.luckyHits);
    totals.luckyTotalValue += numberValue(row?.luckyTotalValue);
  }

  return totals;
}

function makeReplayTotals() {
  return {
    hits: 0,
    allHits: 0,
    positiveHits: 0,
    value: 0,
    effectiveValue: 0,
    hpLossValue: 0,
    shieldLossValue: 0,
    hpPlusShield: 0,
    valuePlusShield: 0,
    maxValueEffective: 0,
    critHits: 0,
    critValue: 0,
    luckyHits: 0,
    luckyValue: 0,
  };
}

function addReplayHit(totals, hit) {
  const value = numberValue(hit?.value);
  const effectiveValue = numberValue(hit?.effectiveValue);
  const hpLossValue = numberValue(hit?.hpLossValue);
  const shieldLossValue = numberValue(hit?.shieldLossValue);

  totals.allHits += 1;
  if (value > 0 || effectiveValue > 0 || hpLossValue > 0 || shieldLossValue > 0) {
    totals.positiveHits += 1;
  }
  totals.hits += 1;
  totals.value += value;
  totals.effectiveValue += effectiveValue;
  totals.hpLossValue += hpLossValue;
  totals.shieldLossValue += shieldLossValue;
  totals.hpPlusShield += hpLossValue + shieldLossValue;
  totals.valuePlusShield += value + shieldLossValue;
  totals.maxValueEffective += Math.max(value, effectiveValue);
  if (hit?.isCrit) {
    totals.critHits += 1;
    totals.critValue += value;
  }
  if (hit?.isLucky) {
    totals.luckyHits += 1;
    totals.luckyValue += value;
  }
}

function summarizePerTarget(replayHits) {
  const byTarget = new Map();
  for (const hit of replayHits) {
    if (hit?.isHeal) continue;
    const key = String(hit?.targetUid ?? "unknown");
    let row = byTarget.get(key);
    if (!row) {
      row = makeReplayTotals();
      row.targetUid = key;
      row.targetMonsterTypeId = hit?.targetMonsterTypeId ?? null;
      byTarget.set(key, row);
    }
    addReplayHit(row, hit);
  }

  return [...byTarget.values()]
    .sort((left, right) => right.value - left.value)
    .slice(0, 12)
    .map((row) => ({
      targetUid: row.targetUid,
      targetMonsterTypeId: row.targetMonsterTypeId,
      hits: row.hits,
      value: row.value,
      effectiveValue: row.effectiveValue,
      hpPlusShield: row.hpPlusShield,
      shieldLossValue: row.shieldLossValue,
    }));
}

function fieldRatios(totals, denominator) {
  const fields = [
    "value",
    "effectiveValue",
    "hpLossValue",
    "shieldLossValue",
    "hpPlusShield",
    "valuePlusShield",
    "maxValueEffective",
  ];

  return Object.fromEntries(
    fields.map((field) => [
      field,
      {
        total: totals[field],
        ratioToDamageTotal: ratio(totals[field], denominator),
        nearOnePointFive: nearRatio(ratio(totals[field], denominator)),
      },
    ]),
  );
}

function analyzeFile(filePath) {
  const entity = readJson(filePath);
  const replayHits = asArray(entity.modifierReplayHits);
  const nonHealReplayHits = replayHits.filter((hit) => !hit?.isHeal);
  const replayTotals = makeReplayTotals();
  for (const hit of nonHealReplayHits) addReplayHit(replayTotals, hit);

  const skillTotals = sumSkillStats(entity.dmgSkills);
  const damageTotal = statTotal(entity.damage, "total");
  const bossDamageTotal = statTotal(entity.damageBossOnly, "total");
  const damageHits = statTotal(entity.damage, "hits");
  const damageCritHits = statTotal(entity.damage, "critHits");
  const damageLuckyHits = statTotal(entity.damage, "luckyHits");
  const damageCritTotal = statTotal(entity.damage, "critTotal");
  const damageLuckyTotal = statTotal(entity.damage, "luckyTotal");

  const ratioChecks = [
    {
      label: "sum(dmgSkills.totalValue) / damage.total",
      numerator: skillTotals.totalValue,
      denominator: damageTotal,
      ratio: ratio(skillTotals.totalValue, damageTotal),
    },
    {
      label: "sum(replay.value) / damage.total",
      numerator: replayTotals.value,
      denominator: damageTotal,
      ratio: ratio(replayTotals.value, damageTotal),
    },
    {
      label: "sum(replay.effectiveValue) / damage.total",
      numerator: replayTotals.effectiveValue,
      denominator: damageTotal,
      ratio: ratio(replayTotals.effectiveValue, damageTotal),
    },
    {
      label: "sum(replay.hpLossValue + shieldLossValue) / damage.total",
      numerator: replayTotals.hpPlusShield,
      denominator: damageTotal,
      ratio: ratio(replayTotals.hpPlusShield, damageTotal),
    },
    {
      label: "damageBossOnly.total / damage.total",
      numerator: bossDamageTotal,
      denominator: damageTotal,
      ratio: ratio(bossDamageTotal, damageTotal),
    },
  ].map((row) => ({
    ...row,
    nearOnePointFive: nearRatio(row.ratio),
  }));

  return {
    file: path.relative(repoRoot, filePath).replaceAll("\\", "/"),
    uid: entity.uid ?? null,
    name: entity.name ?? "",
    classId: entity.classId ?? null,
    classSpec: entity.classSpec ?? null,
    damage: {
      total: damageTotal,
      hits: damageHits,
      critHits: damageCritHits,
      critTotal: damageCritTotal,
      luckyHits: damageLuckyHits,
      luckyTotal: damageLuckyTotal,
      bossOnlyTotal: bossDamageTotal,
    },
    skillTotals,
    replayTotals,
    replayFieldRatios: fieldRatios(replayTotals, damageTotal),
    ratioChecks,
    topTargets: summarizePerTarget(replayHits),
    exactMatches: {
      skillsMatchDamageTotal: skillTotals.totalValue === damageTotal,
      skillsMatchDamageHits: skillTotals.hits === damageHits,
      replayValueMatchesDamageTotal: replayTotals.value === damageTotal,
      replayHitsMatchDamageHits: replayTotals.hits === damageHits,
      replayCritMatchesDamage: replayTotals.critHits === damageCritHits && replayTotals.critValue === damageCritTotal,
      replayLuckyMatchesDamage: replayTotals.luckyHits === damageLuckyHits && replayTotals.luckyValue === damageLuckyTotal,
    },
  };
}

function summarize(files) {
  const aggregate = {
    files: files.length,
    damageTotal: 0,
    skillTotal: 0,
    replayValueTotal: 0,
    replayEffectiveTotal: 0,
    replayHpPlusShieldTotal: 0,
    damageHits: 0,
    replayHits: 0,
    nearOnePointFiveChecks: [],
    mismatches: [],
  };

  for (const file of files) {
    aggregate.damageTotal += file.damage.total;
    aggregate.skillTotal += file.skillTotals.totalValue;
    aggregate.replayValueTotal += file.replayTotals.value;
    aggregate.replayEffectiveTotal += file.replayTotals.effectiveValue;
    aggregate.replayHpPlusShieldTotal += file.replayTotals.hpPlusShield;
    aggregate.damageHits += file.damage.hits;
    aggregate.replayHits += file.replayTotals.hits;

    for (const check of file.ratioChecks) {
      if (check.nearOnePointFive) {
        aggregate.nearOnePointFiveChecks.push({
          file: file.file,
          label: check.label,
          ratio: check.ratio,
          numerator: check.numerator,
          denominator: check.denominator,
        });
      }
    }

    for (const [key, value] of Object.entries(file.exactMatches)) {
      if (!value) aggregate.mismatches.push({ file: file.file, check: key });
    }
  }

  aggregate.ratios = {
    skillTotalToDamageTotal: ratio(aggregate.skillTotal, aggregate.damageTotal),
    replayValueToDamageTotal: ratio(aggregate.replayValueTotal, aggregate.damageTotal),
    replayEffectiveToDamageTotal: ratio(aggregate.replayEffectiveTotal, aggregate.damageTotal),
    replayHpPlusShieldToDamageTotal: ratio(aggregate.replayHpPlusShieldTotal, aggregate.damageTotal),
    replayHitsToDamageHits: ratio(aggregate.replayHits, aggregate.damageHits),
  };

  return aggregate;
}

function writeMarkdown(report, outPath) {
  const lines = [
    "# Final Damage Field Audit",
    "",
    "Dev-only evidence report. This does not change runtime totals.",
    "",
    "## Summary",
    "",
    `- Files scanned: ${formatNumber(report.summary.files)}`,
    `- Saved damage total: ${formatNumber(report.summary.damageTotal)}`,
    `- Sum of dmgSkills.totalValue: ${formatNumber(report.summary.skillTotal)} (${formatRatio(report.summary.ratios.skillTotalToDamageTotal)}x saved total)`,
    `- Sum of replay value: ${formatNumber(report.summary.replayValueTotal)} (${formatRatio(report.summary.ratios.replayValueToDamageTotal)}x saved total)`,
    `- Sum of replay effectiveValue: ${formatNumber(report.summary.replayEffectiveTotal)} (${formatRatio(report.summary.ratios.replayEffectiveToDamageTotal)}x saved total)`,
    `- Sum of replay hpLossValue + shieldLossValue: ${formatNumber(report.summary.replayHpPlusShieldTotal)} (${formatRatio(report.summary.ratios.replayHpPlusShieldToDamageTotal)}x saved total)`,
    `- Damage hits vs replay hits: ${formatNumber(report.summary.damageHits)} / ${formatNumber(report.summary.replayHits)} (${formatRatio(report.summary.ratios.replayHitsToDamageHits)}x)`,
    `- 1.5x-ish alternate-field checks: ${formatNumber(report.summary.nearOnePointFiveChecks.length)}`,
    `- Exact-match mismatches: ${formatNumber(report.summary.mismatches.length)}`,
    "",
    "## Files",
    "",
    "| File | Player | Damage | Hits | Skills/Damage | Replay/Damage | Effective/Damage | HP+Shield/Damage | Boss/Damage | 1.5x flags |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const file of report.files) {
    const ratioByLabel = new Map(file.ratioChecks.map((check) => [check.label, check]));
    const skills = ratioByLabel.get("sum(dmgSkills.totalValue) / damage.total");
    const replay = ratioByLabel.get("sum(replay.value) / damage.total");
    const effective = ratioByLabel.get("sum(replay.effectiveValue) / damage.total");
    const hpShield = ratioByLabel.get("sum(replay.hpLossValue + shieldLossValue) / damage.total");
    const boss = ratioByLabel.get("damageBossOnly.total / damage.total");
    const flags = file.ratioChecks.filter((check) => check.nearOnePointFive).length;
    lines.push(
      `| ${file.file} | ${file.name || file.uid || ""} | ${formatNumber(file.damage.total)} | ${formatNumber(file.damage.hits)} | ${formatRatio(skills?.ratio ?? null)} | ${formatRatio(replay?.ratio ?? null)} | ${formatRatio(effective?.ratio ?? null)} | ${formatRatio(hpShield?.ratio ?? null)} | ${formatRatio(boss?.ratio ?? null)} | ${flags} |`,
    );
  }

  if (report.summary.nearOnePointFiveChecks.length) {
    lines.push("", "## 1.5x-ish Checks", "");
    for (const check of report.summary.nearOnePointFiveChecks) {
      lines.push(
        `- ${check.file}: ${check.label} = ${formatRatio(check.ratio)} (${formatNumber(check.numerator)} / ${formatNumber(check.denominator)})`,
      );
    }
  } else {
    lines.push("", "## 1.5x-ish Checks", "", "- None found in the scanned saved exports.");
  }

  lines.push("", "## Per File Details", "");
  for (const file of report.files) {
    lines.push(
      `### ${file.file}`,
      "",
      `- Player: ${file.name || file.uid || ""}`,
      `- Damage: ${formatNumber(file.damage.total)} over ${formatNumber(file.damage.hits)} hits`,
      `- Crit: ${formatNumber(file.damage.critHits)} hits / ${formatNumber(file.damage.critTotal)} (${formatPct(pct(file.damage.critTotal, file.damage.total))} of damage)`,
      `- Lucky: ${formatNumber(file.damage.luckyHits)} hits / ${formatNumber(file.damage.luckyTotal)} (${formatPct(pct(file.damage.luckyTotal, file.damage.total))} of damage)`,
      `- Exact matches: ${Object.entries(file.exactMatches)
        .map(([key, value]) => `${key}=${value ? "yes" : "no"}`)
        .join(", ")}`,
      "",
      "| Packet field | Total | Ratio to saved damage | Near 1.5x |",
      "| --- | ---: | ---: | --- |",
    );
    for (const [field, fieldReport] of Object.entries(file.replayFieldRatios)) {
      lines.push(
        `| ${field} | ${formatNumber(fieldReport.total)} | ${formatRatio(fieldReport.ratioToDamageTotal)} | ${fieldReport.nearOnePointFive ? "yes" : "no"} |`,
      );
    }
    lines.push("");
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${lines.join("\n")}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputFiles = options.inputs.length
    ? options.inputs.map(resolveRepoPath)
    : latestModifierEntityExports(options.latest);

  if (!inputFiles.length) {
    throw new Error("No modifier-entity exports found. Pass --input or place exports under DEV_exports.");
  }

  const files = inputFiles.map(analyzeFile);
  const report = {
    generatedAt: new Date().toISOString(),
    inputs: inputFiles.map((filePath) => path.relative(repoRoot, filePath).replaceAll("\\", "/")),
    summary: summarize(files),
    files,
  };

  const outJson = resolveRepoPath(options.outJson);
  const outMd = resolveRepoPath(options.outMd);
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`);
  writeMarkdown(report, outMd);

  console.log(`Wrote ${path.relative(repoRoot, outJson)}`);
  console.log(`Wrote ${path.relative(repoRoot, outMd)}`);
  console.log(`Files scanned: ${report.summary.files}`);
  console.log(`Replay value / saved damage: ${formatRatio(report.summary.ratios.replayValueToDamageTotal)}x`);
  console.log(`Replay HP+shield / saved damage: ${formatRatio(report.summary.ratios.replayHpPlusShieldToDamageTotal)}x`);
  console.log(`1.5x-ish alternate-field checks: ${report.summary.nearOnePointFiveChecks.length}`);
}

main();
