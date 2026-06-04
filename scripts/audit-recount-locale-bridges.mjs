#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const generatedRoot = path.join(repoRoot, "parser-data", "generated");
const defaultOutJson = path.join(repoRoot, "DEV_exports", "recount-locale-bridge-audit.json");
const defaultOutMd = path.join(repoRoot, "DEV_exports", "recount-locale-bridge-audit.md");

const LOCALES = [
  "en",
  "zh-CN",
  "zh-TW",
  "ja",
  "ko-KR",
  "fr",
  "de",
  "es",
  "pt-BR",
  "th",
  "id",
];

const CLOSE_RECOUNT_WINDOW = 12;
const NON_CJK_LOCALES = new Set(["en", "fr", "de", "es", "pt-BR", "id"]);
const NON_LATIN_SCRIPT_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
const HAN_RE = /\p{Script=Han}/u;
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL_RE = /\p{Script=Hangul}/u;
const THAI_RE = /\p{Script=Thai}/u;
const OBVIOUS_INTERNAL_RE = /\b(?:atk|exatk|buff|bullet|projectile|damagearea|virtual|debug|test)\b/i;

function parseArgs(argv) {
  const options = {
    outJson: defaultOutJson,
    outMd: defaultOutMd,
    maxExamples: 80,
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
      case "--out-json":
        options.outJson = path.resolve(next());
        break;
      case "--out-md":
        options.outMd = path.resolve(next());
        break;
      case "--max-examples":
        options.maxExamples = Number(next());
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
  console.log(`Recount Locale Bridge Audit

Usage:
  node scripts/audit-recount-locale-bridges.mjs [options]

Options:
  --out-json <file>       JSON report path. Default: DEV_exports/recount-locale-bridge-audit.json
  --out-md <file>         Markdown report path. Default: DEV_exports/recount-locale-bridge-audit.md
  --max-examples <count>  Markdown examples per issue bucket. Default: 80
  --help                  Show this help.
`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value) {
  return cleanText(value)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/[.。]+$/u, "")
    .toLowerCase();
}

function pickLocalized(names, locale, fallback = "") {
  return cleanText(names?.[locale])
    || cleanText(fallback)
    || cleanText(names?.en)
    || cleanText(names?.["zh-CN"])
    || cleanText(names?.design);
}

function entryId(entry, fallback) {
  return Number(entry?.Id ?? fallback);
}

function recountName(entry, locale) {
  return pickLocalized(entry.Names, locale, entry.RecountName ?? entry.Name ?? "");
}

function damageLinkedName(entry, locale) {
  if (!entry || typeof entry === "string") return "";
  return pickLocalized(entry.LinkedSkillTableNames, locale, entry.LinkedSkillTableName)
    || pickLocalized(entry.LinkedSkillEffectSkillTableNames, locale, entry.LinkedSkillEffectSkillTableName)
    || pickLocalized(entry.LinkedNames, locale, entry.LinkedName)
    || pickLocalized(entry.Names, locale, entry.Name ?? entry.DamageName ?? "");
}

function isPlausibleLocaleCandidate(value, locale) {
  const text = cleanText(value);
  if (!text || /^[\d\s#./:_-]+$/.test(text)) return false;
  if (OBVIOUS_INTERNAL_RE.test(text)) return false;
  if (NON_CJK_LOCALES.has(locale) && NON_LATIN_SCRIPT_RE.test(text)) return false;
  if (locale === "ja" && (HANGUL_RE.test(text) || THAI_RE.test(text))) return false;
  if (locale === "ko-KR" && (HAN_RE.test(text) || KANA_RE.test(text) || THAI_RE.test(text))) return false;
  if (locale === "th" && (HAN_RE.test(text) || KANA_RE.test(text) || HANGUL_RE.test(text))) return false;
  if ((locale === "zh-CN" || locale === "zh-TW") && (HANGUL_RE.test(text) || THAI_RE.test(text))) return false;
  return true;
}

function mode(values) {
  const counts = new Map();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const current = counts.get(normalized) ?? { value, count: 0 };
    current.count += 1;
    counts.set(normalized, current);
  }
  return [...counts.values()].sort((left, right) =>
    right.count - left.count || left.value.localeCompare(right.value)
  )[0];
}

function countByReason(issues) {
  const counts = {};
  for (const issue of issues) {
    for (const reason of issue.reasons) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function pushIssue(issueMap, partial) {
  const key = `${partial.recountId}:${partial.locale}`;
  const existing = issueMap.get(key);
  if (!existing) {
    issueMap.set(key, {
      recountId: partial.recountId,
      recountName: partial.recountName,
      nameId: partial.nameId,
      locale: partial.locale,
      current: partial.current,
      reasons: [],
      evidence: {},
    });
  }
  const issue = issueMap.get(key);
  for (const reason of partial.reasons ?? []) {
    if (!issue.reasons.includes(reason)) issue.reasons.push(reason);
  }
  Object.assign(issue.evidence, partial.evidence ?? {});
}

function buildRows(recountTable) {
  return Object.entries(recountTable)
    .map(([key, entry]) => ({
      key,
      id: entryId(entry, key),
      recountName: cleanText(entry.RecountName ?? entry.Name ?? ""),
      nameId: entry.NameId ?? null,
      names: entry.Names ?? {},
      damageIds: Array.isArray(entry.DamageId) ? entry.DamageId.map(Number).filter(Number.isFinite) : [],
      sourceOffset: entry.SourceOffset ?? null,
    }))
    .filter((row) => Number.isFinite(row.id))
    .sort((left, right) => left.id - right.id);
}

function buildNameIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    for (const locale of LOCALES) {
      const value = recountName({ Names: row.names, RecountName: row.recountName }, locale);
      const normalized = normalizeText(value);
      if (!normalized) continue;
      const bucket = index.get(normalized) ?? [];
      bucket.push({
        recountId: row.id,
        recountName: row.recountName,
        nameId: row.nameId,
        locale,
        value,
      });
      index.set(normalized, bucket);
    }
  }
  return index;
}

function linkedChildCandidate(row, damageAttrIdNames, locale) {
  const names = row.damageIds
    .map((damageId) => damageLinkedName(damageAttrIdNames[String(damageId)], locale))
    .filter((name) => isPlausibleLocaleCandidate(name, locale));
  if (!names.length) return undefined;
  const candidate = mode(names);
  if (!candidate || candidate.count < Math.max(2, Math.ceil(names.length * 0.75))) return undefined;
  return {
    value: candidate.value,
    count: candidate.count,
    total: names.length,
  };
}

function auditRepeatedNameFamilies(rows, issueMap) {
  const families = new Map();
  for (const row of rows) {
    const key = normalizeText(row.recountName);
    if (!key) continue;
    const family = families.get(key) ?? [];
    family.push(row);
    families.set(key, family);
  }

  for (const family of families.values()) {
    if (family.length < 2) continue;
    for (const locale of LOCALES) {
      const values = family.map((row) => recountName({ Names: row.names, RecountName: row.recountName }, locale));
      const candidate = mode(values);
      if (!candidate || candidate.count < 2) continue;
      for (const row of family) {
        const current = recountName({ Names: row.names, RecountName: row.recountName }, locale);
        if (!current || normalizeText(current) === normalizeText(candidate.value)) continue;
        pushIssue(issueMap, {
          recountId: row.id,
          recountName: row.recountName,
          nameId: row.nameId,
          locale,
          current,
          reasons: ["repeated-recount-name-family-disagreement"],
          evidence: {
            familyMajority: {
              value: candidate.value,
              count: candidate.count,
              total: family.length,
            },
          },
        });
      }
    }
  }
}

function auditCloseCrossRecountCollisions(rows, nameIndex, issueMap) {
  for (const row of rows) {
    for (const locale of LOCALES) {
      const current = recountName({ Names: row.names, RecountName: row.recountName }, locale);
      const normalized = normalizeText(current);
      if (!normalized) continue;
      const matches = (nameIndex.get(normalized) ?? [])
        .filter((match) =>
          match.recountId !== row.id
          && normalizeText(match.recountName) !== normalizeText(row.recountName)
          && Math.abs(match.recountId - row.id) <= CLOSE_RECOUNT_WINDOW
        )
        .slice(0, 8);
      if (!matches.length) continue;
      pushIssue(issueMap, {
        recountId: row.id,
        recountName: row.recountName,
        nameId: row.nameId,
          locale,
          current,
          reasons: ["locale-text-close-to-neighbor-recount-row"],
        evidence: {
          crossRecountMatches: matches,
        },
      });
    }
  }
}

function auditLinkedChildDisagreements(rows, damageAttrIdNames, issueMap) {
  for (const row of rows) {
    if (!row.damageIds.length) continue;
    for (const locale of LOCALES) {
      const current = recountName({ Names: row.names, RecountName: row.recountName }, locale);
      const candidate = linkedChildCandidate(row, damageAttrIdNames, locale);
      if (!candidate || normalizeText(candidate.value) === normalizeText(current)) continue;
      pushIssue(issueMap, {
        recountId: row.id,
        recountName: row.recountName,
        nameId: row.nameId,
        locale,
        current,
        reasons: ["linked-child-majority-disagrees"],
        evidence: {
          linkedChildMajority: candidate,
        },
      });
    }
  }
}

function scoreIssue(issue) {
  let score = 0;
  if (issue.reasons.includes("locale-text-close-to-neighbor-recount-row")) score += 4;
  if (issue.reasons.includes("repeated-recount-name-family-disagreement")) score += 3;
  if (issue.reasons.includes("linked-child-majority-disagrees")) {
    score += issue.evidence.linkedChildMajority?.count === issue.evidence.linkedChildMajority?.total ? 2 : 1;
  }
  return score;
}

function issueConfidence(issue) {
  const score = scoreIssue(issue);
  if (score >= 5) return "high";
  if (score >= 3) return "medium";
  return "review";
}

function issueSuggestedAction(issue) {
  if (issue.evidence.familyMajority?.value) {
    return `review replacing with repeated-family majority: ${issue.evidence.familyMajority.value}`;
  }
  if (issue.evidence.linkedChildMajority?.value) {
    return `review linked child candidate: ${issue.evidence.linkedChildMajority.value}`;
  }
  return "review bridge provenance; avoid runtime auto-fix";
}

function summarizeRows(issues) {
  const byRow = new Map();
  for (const issue of issues) {
    const row = byRow.get(issue.recountId) ?? {
      recountId: issue.recountId,
      recountName: issue.recountName,
      nameId: issue.nameId,
      locales: [],
      reasons: new Set(),
      confidenceScore: 0,
      examples: [],
    };
    row.locales.push(issue.locale);
    for (const reason of issue.reasons) row.reasons.add(reason);
    row.confidenceScore = Math.max(row.confidenceScore, scoreIssue(issue));
    if (row.examples.length < 3) {
      row.examples.push(`${issue.locale}: ${issue.current}`);
    }
    byRow.set(issue.recountId, row);
  }

  return [...byRow.values()]
    .map((row) => ({
      ...row,
      locales: [...new Set(row.locales)].sort((left, right) => LOCALES.indexOf(left) - LOCALES.indexOf(right)),
      reasons: [...row.reasons].sort(),
    }))
    .sort((left, right) =>
      right.locales.length - left.locales.length
      || right.confidenceScore - left.confidenceScore
      || left.recountId - right.recountId
    );
}

function renderRowSummaryTable(rowSummaries, limit) {
  const rows = [
    "| Recount | Locales | Reasons | Examples |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of rowSummaries.slice(0, limit)) {
    rows.push([
      `#${row.recountId} ${row.recountName}`,
      row.locales.join(", "),
      row.reasons.join("; "),
      row.examples.join("; "),
    ].map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  return rows.join("\n");
}

function renderIssueTable(issues, limit) {
  const rows = [
    "| Recount | Locale | Current | Confidence | Evidence | Suggested action |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const issue of issues.slice(0, limit)) {
    const evidence = [
      issue.evidence.familyMajority
        ? `family majority ${issue.evidence.familyMajority.count}/${issue.evidence.familyMajority.total}: ${issue.evidence.familyMajority.value}`
        : "",
      issue.evidence.crossRecountMatches?.length
        ? `matches #${issue.evidence.crossRecountMatches[0].recountId} ${issue.evidence.crossRecountMatches[0].recountName}`
        : "",
      issue.evidence.linkedChildMajority
        ? `child majority ${issue.evidence.linkedChildMajority.count}/${issue.evidence.linkedChildMajority.total}: ${issue.evidence.linkedChildMajority.value}`
        : "",
    ].filter(Boolean).join("; ");
    rows.push([
      `#${issue.recountId} ${issue.recountName}`,
      issue.locale,
      issue.current,
      issue.confidence,
      evidence,
      issue.suggestedAction,
    ].map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  return rows.join("\n");
}

function renderMarkdown(report, maxExamples) {
  const high = report.issues.filter((issue) => issue.confidence === "high");
  const medium = report.issues.filter((issue) => issue.confidence === "medium");
  const review = report.issues.filter((issue) => issue.confidence === "review");
  return `# Recount Locale Bridge Audit

Generated: ${report.generatedAt}

## Summary

- Recount rows scanned: ${report.summary.recountRows}
- Locale cells scanned: ${report.summary.localeCells}
- Suspect locale cells: ${report.summary.issueCount}
- High confidence: ${high.length}
- Medium confidence: ${medium.length}
- Review only: ${review.length}

## What This Means

This report is intentionally conservative. It does not say every differing child label is wrong.

Good aggregate rows often differ from child rows because Recount groups can roll up bullets, areas, lucky-hit rows, proc rows, and reused internal hit rows. A broad runtime rule that replaces aggregate labels with child labels would be risky.

The most actionable rows are ones where either:

- a repeated Recount family uses one localized text in most rows but a different localized text in a few rows, or
- a locale value exactly matches a nearby Recount row's name, suggesting a bad bridge shifted between adjacent rows.

Strong linked-child majorities are included as review evidence only. They are useful for detail labels like Rage Cleave stages, but should not automatically replace aggregate parent names.

## Reason Counts

${Object.entries(report.summary.reasonCounts).map(([reason, count]) => `- ${reason}: ${count}`).join("\n")}

## Rows With Multiple Locale Flags

${report.rowSummaries.length ? renderRowSummaryTable(report.rowSummaries, maxExamples) : "_None._"}

## High Confidence Examples

${high.length ? renderIssueTable(high, maxExamples) : "_None._"}

## Medium Confidence Examples

${medium.length ? renderIssueTable(medium, maxExamples) : "_None._"}

## Review-Only Examples

${review.length ? renderIssueTable(review, maxExamples) : "_None._"}

## Recommended Next Step

Do not patch the runtime resolver globally. Use this report to fix the generator/provenance bridge for specific aggregate Recount locale values. If a localized aggregate value is weak or suspicious and there is no strong replacement, omit that locale in generated data and let normal fallback choose English or Simplified Chinese.
`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const recountTable = readJson(path.join(generatedRoot, "RecountTable.json"));
  const damageAttrIdNames = readJson(path.join(generatedRoot, "DamageAttrIdName.json"));
  const rows = buildRows(recountTable);
  const issueMap = new Map();

  auditRepeatedNameFamilies(rows, issueMap);
  auditCloseCrossRecountCollisions(rows, buildNameIndex(rows), issueMap);
  auditLinkedChildDisagreements(rows, damageAttrIdNames, issueMap);

  const issues = [...issueMap.values()]
    .sort((left, right) =>
      scoreIssue(right) - scoreIssue(left)
      || left.recountId - right.recountId
      || left.locale.localeCompare(right.locale)
    );

  for (const issue of issues) {
    issue.confidence = issueConfidence(issue);
    issue.suggestedAction = issueSuggestedAction(issue);
  }
  const rowSummaries = summarizeRows(issues);

  const report = {
    generatedAt: new Date().toISOString(),
    sourceFiles: [
      "parser-data/generated/RecountTable.json",
      "parser-data/generated/DamageAttrIdName.json",
    ],
    summary: {
      recountRows: rows.length,
      localeCells: rows.length * LOCALES.length,
      issueCount: issues.length,
      reasonCounts: countByReason(issues),
    },
    rowSummaries,
    issues,
  };

  fs.mkdirSync(path.dirname(options.outJson), { recursive: true });
  fs.writeFileSync(options.outJson, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(options.outMd, renderMarkdown(report, options.maxExamples));
  console.log(`Wrote ${options.outJson}`);
  console.log(`Wrote ${options.outMd}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
