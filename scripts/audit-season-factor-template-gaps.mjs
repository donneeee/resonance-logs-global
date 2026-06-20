#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FACTOR_PATH = "parser-data/generated/SeasonPhantomFactors.json";
const SOURCE_TEMPLATE_PATH = "parser-data/app-rules/counter_source_templates.json";
const SLOT_TEMPLATE_PATH = "parser-data/app-rules/counter_slot_templates.json";
const LABEL_PATH = "parser-data/app-rules/season_cultivate_factor_skill_labels.json";
const OUT_JSON = "DEV_exports/season-factor-template-gaps.json";
const OUT_MD = "DEV_exports/season-factor-template-gaps.md";
const OUT_CSV = "DEV_exports/season-phantom-factor-list.csv";

function readJson(relPath, fallback = null) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) return fallback;
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function writeFile(relPath, text) {
  const fullPath = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, text);
}

function asArray(value) {
  return Array.isArray(value) ? value : Object.values(value ?? {});
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/<\s*(?:br|break)\s*\/?>/gi, ". ")
    .replace(/<\/\s*break\s*>/gi, ". ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\{\*[^}]+\*\}/g, " ")
    .replace(/\s*([.!?。！？])\s*\.\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function displayFactorName(value) {
  return cleanText(value).replace(/\b(?:Twin Striker|Flame Berserker)\b/g, "Twin Striker");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function factorType(name) {
  if (/\bReality\b/i.test(name)) return "Reality";
  if (/\b(?:Stasis|Steady)\b/i.test(name)) return "Stasis";
  if (/\bPolarity\b/i.test(name)) return "Polarity";
  if (/\bRhapsody\b/i.test(name)) return "Rhapsody";
  return "Inspiration";
}

function seasonStatus(type) {
  return type === "Rhapsody" ? "expired-season-3" : "current-season-3";
}

function classNameFromFactor(name) {
  return displayFactorName(name)
    .replace(/\s+(?:Reality|Stasis|Steady|Polarity|Rhapsody)?\s*Factor\s+X\d+.*$/i, "")
    .replace(/\s+(?:Reality|Stasis|Steady|Polarity|Rhapsody)?\s*X\d+.*$/i, "")
    .trim();
}

function slotNumberFromFactor(name) {
  return cleanText(name).match(/\bX(\d+)\b/i)?.[1] ?? "";
}

function firstItemId(row) {
  return Number(row?.gradeItemIds?.[0]) || 0;
}

function factorDescription(row) {
  const gradeRows = Array.isArray(row?.modifierEvidence?.gradeRows)
    ? row.modifierEvidence.gradeRows
    : [];
  const resolvedGrade = [...gradeRows]
    .sort((left, right) => (Number(right.grade) || 0) - (Number(left.grade) || 0))
    .find((gradeRow) => cleanText(gradeRow.cleanResolvedDescription));
  return cleanText(resolvedGrade?.cleanResolvedDescription)
    || cleanText(row?.cleanDescriptions?.en)
    || cleanText(row?.descriptions?.en);
}

function sourceIds(source) {
  const value = source ?? {};
  if (value.skillCast) return value.skillCast.skillBaseIds ?? [];
  if (value.skillCastComplete) return value.skillCastComplete.skillBaseIds ?? [];
  if (value.skillDurationTick) return [value.skillDurationTick.skillBaseId];
  if (value.damageBySkillKey) return value.damageBySkillKey.skillKeys ?? [];
  if (value.damageBySkillKeyOnce) return value.damageBySkillKeyOnce.skillKeys ?? [];
  if (value.damageBySkillKeySelfTarget) return value.damageBySkillKeySelfTarget.skillKeys ?? [];
  if (value.damageTaken) return value.damageTaken.skillKeys ?? [];
  if (value.buffAdded) return [value.buffAdded.buffId, value.buffAdded.sourceConfigId].filter(Boolean);
  return [];
}

function sourceKind(source) {
  return Object.keys(source ?? {})[0] ?? "";
}

function incrementValue(source) {
  const entry = Object.values(source ?? {})[0];
  return Number(entry?.increment) || "";
}

function templateTimers(sourceTemplates, slotTemplates, description) {
  const timers = new Set();
  for (const template of sourceTemplates) {
    const entry = Object.values(template.source ?? {})[0];
    if (entry?.tickIntervalMs) timers.add(`${Number(entry.tickIntervalMs) / 1000}s source tick`);
    if (entry?.intervalMs) timers.add(`${Number(entry.intervalMs) / 1000}s source interval`);
    if (entry?.cooldownMs) timers.add(`${Number(entry.cooldownMs) / 1000}s source cooldown`);
    if (entry?.hitsRequired) timers.add(`${entry.hitsRequired} hits`);
    if (entry?.unitsRequired) timers.add(`${entry.unitsRequired} units`);
    if (entry?.metersRequired) timers.add(`${entry.metersRequired}m movement`);
  }
  for (const template of slotTemplates) {
    if (template.slot?.freezeDurationMs) timers.add(`${Number(template.slot.freezeDurationMs) / 1000}s freeze`);
  }
  for (const match of cleanText(description).match(/\b\d+(?:\.\d+)?\s*s\b/gi) ?? []) {
    timers.add(match.replace(/\s+/g, ""));
  }
  return [...timers];
}

function weakLabel(value) {
  return /^(?:of\b|the\b|restores?\b|when\b|during\b|points\b)/i.test(cleanText(value));
}

function buildIndexes(sourceTemplates, slotTemplates) {
  const sourcesByItemId = new Map();
  const slotsByItemId = new Map();
  for (const template of sourceTemplates) {
    for (const itemId of template.itemIds ?? []) {
      const list = sourcesByItemId.get(Number(itemId)) ?? [];
      list.push(template);
      sourcesByItemId.set(Number(itemId), list);
    }
  }
  for (const template of slotTemplates) {
    for (const itemId of template.itemIds ?? []) {
      const list = slotsByItemId.get(Number(itemId)) ?? [];
      list.push(template);
      slotsByItemId.set(Number(itemId), list);
    }
  }
  return { sourcesByItemId, slotsByItemId };
}

function main() {
  const factors = asArray(readJson(FACTOR_PATH, {})?.factorsByBuffId)
    .filter((row) => firstItemId(row))
    .sort((left, right) => firstItemId(left) - firstItemId(right));
  const sourceTemplates = asArray(readJson(SOURCE_TEMPLATE_PATH, []));
  const slotTemplates = asArray(readJson(SLOT_TEMPLATE_PATH, []));
  const labels = readJson(LABEL_PATH, { sources: {}, slots: {} });
  const { sourcesByItemId, slotsByItemId } = buildIndexes(sourceTemplates, slotTemplates);

  const rows = factors.map((factor) => {
    const itemId = firstItemId(factor);
    const name = displayFactorName(factor.familyNames?.en) || displayFactorName(factor.familyName);
    const type = factorType(name);
    const sources = sourcesByItemId.get(itemId) ?? [];
    const slots = slotsByItemId.get(itemId) ?? [];
    const firstSource = sources[0];
    const triggerLabel = firstSource ? labels.sources?.[firstSource.sourceId]?.label?.en ?? "" : "";
    const slotLabel = slots
      .map((slot) => labels.slots?.[slot.slotTemplateId]?.label?.en)
      .find(Boolean) ?? "";
    const description = factorDescription(factor);
    const factorSeasonStatus = seasonStatus(type);
    const sourceStatus = factorSeasonStatus === "expired-season-3"
      ? "expired-season-3"
      : sources.length
      ? "present"
      : type === "Reality"
        ? "expected-empty-consumes-total"
        : type === "Inspiration"
          ? "missing-source-template"
          : "optional-or-non-energy";
    return {
      type,
      className: classNameFromFactor(name),
      slot: slotNumberFromFactor(name),
      shortLabel: [
        type === "Reality" ? "Reality" : "",
        `X${slotNumberFromFactor(name)}`,
        triggerLabel || slotLabel ? `- ${triggerLabel || slotLabel}` : "",
      ].filter(Boolean).join(" "),
      name,
      buffId: factor.buffId,
      familyId: factor.familyId,
      triggerSkill: triggerLabel,
      energy: sources.map((source) => incrementValue(source.source)).filter(Boolean).join("; "),
      timers: templateTimers(sources, slots, description).join("; "),
      sourceIds: sources.map((source) => source.sourceId).join("; "),
      sourceKinds: sources.map((source) => sourceKind(source.source)).join("; "),
      linkedIds: sources.flatMap((source) => sourceIds(source.source)).join("; "),
      sourceStatus,
      seasonStatus: factorSeasonStatus,
      slotTemplates: slots.map((slot) => slot.slotTemplateId).join("; "),
      slotLabel,
      effect: description,
    };
  });

  const activeRows = rows.filter((row) => row.seasonStatus !== "expired-season-3");
  const expiredSeason3Rows = rows.filter((row) => row.seasonStatus === "expired-season-3");
  const missingInspirationSources = activeRows.filter((row) => row.sourceStatus === "missing-source-template");
  const missingTriggerLabels = activeRows.filter((row) => row.sourceIds && !row.triggerSkill);
  const weakSlotLabels = activeRows.filter((row) => row.slotLabel && weakLabel(row.slotLabel));
  const timerMentionWithoutTemplate = activeRows.filter((row) => {
    const mentionsTimer = /\b(?:cooldown|CD|once within|\d+(?:\.\d+)?s|per second|every)\b/i.test(row.effect);
    return mentionsTimer && !row.timers;
  });

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      factors: rows.length,
      activeSeason3Factors: activeRows.length,
      expiredSeason3Factors: expiredSeason3Rows.length,
      sourceTemplates: sourceTemplates.length,
      slotTemplates: slotTemplates.length,
      missingInspirationSources: missingInspirationSources.length,
      missingTriggerLabels: missingTriggerLabels.length,
      weakSlotLabels: weakSlotLabels.length,
      timerMentionWithoutTemplate: timerMentionWithoutTemplate.length,
    },
    missingInspirationSources,
    missingTriggerLabels,
    weakSlotLabels,
    timerMentionWithoutTemplate,
    expiredSeason3Rows,
    rows,
  };

  writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  const headers = [
    "type",
    "className",
    "slot",
    "shortLabel",
    "name",
    "buffId",
    "familyId",
    "triggerSkill",
    "energy",
    "timers",
    "sourceIds",
    "sourceKinds",
    "linkedIds",
    "sourceStatus",
    "seasonStatus",
    "slotTemplates",
    "slotLabel",
    "effect",
  ];
  writeFile(OUT_CSV, `${headers.join(",")}\n${rows.map((row) => headers.map((key) => csvCell(row[key])).join(",")).join("\n")}\n`);

  const lines = [];
  lines.push("# Season Factor Template Gaps");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const [key, value] of Object.entries(report.summary)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Missing Inspiration Sources");
  lines.push("");
  for (const row of missingInspirationSources) {
    lines.push(`- ${row.name} (${row.buffId}) -> ${row.effect}`);
  }
  lines.push("");
  lines.push("## Weak Slot Labels");
  lines.push("");
  for (const row of weakSlotLabels) {
    lines.push(`- ${row.name}: ${row.slotLabel}`);
  }
  lines.push("");
  lines.push("Notes:");
  lines.push("- Reality factors normally have no source template because they consume the shared Illusion Energy total.");
  lines.push("- Missing Inspiration source templates are actionable only when a direct runtime trigger/source ID can be proven.");
  lines.push("- Rhapsody factors are marked `expired-season-3` and excluded from current Season 3 actionability checks.");
  if (expiredSeason3Rows.length) {
    lines.push("");
    lines.push("## Expired Season 3 Factors");
    lines.push("");
    lines.push(`- Rhapsody: ${expiredSeason3Rows.length} rows marked expired for Season 3.`);
  }
  writeFile(OUT_MD, `${lines.join("\n")}\n`);

  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_MD}`);
  console.log(`Wrote ${OUT_CSV}`);
  console.log(`Missing Inspiration source templates: ${missingInspirationSources.length}`);
  console.log(`Weak slot labels: ${weakSlotLabels.length}`);
}

main();
