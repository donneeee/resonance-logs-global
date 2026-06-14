#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_JSON = "DEV_exports/factor-runtime-evidence-gaps.json";
const OUT_MD = "DEV_exports/factor-runtime-evidence-gaps.md";

const PATHS = {
  gaps: "DEV_exports/season-factor-template-gaps.json",
  behavior: "DEV_exports/factor-behavior-audit.json",
  sourceTemplates: "parser-data/app-rules/counter_source_templates.json",
  slotTemplates: "parser-data/app-rules/counter_slot_templates.json",
  gearSetEffects: "DEV_exports/raid-gear-set-effects.json",
  effectSources: "parser-data/generated/EffectSources.json",
  modifierSourceIndex: "parser-data/generated/ModifierSourceIndex.json",
  seasonFactors: "parser-data/generated/SeasonPhantomFactors.json",
};

const SOURCE_RUNTIME_SUPPORT = {
  anyDamage: {
    status: "runtime-supported",
    evidence: "local damage events",
  },
  damageBySkillKey: {
    status: "runtime-supported",
    evidence: "damage event skill keys, including crit/lucky hit flags",
  },
  damageBySkillKeyOnce: {
    status: "runtime-supported",
    evidence: "damage event skill keys with per-target max-hit dedupe for multi-target casts",
  },
  damageBySkillKeySelfTarget: {
    status: "runtime-supported",
    evidence: "damage event skill keys scoped to self-target hits",
  },
  damageTaken: {
    status: "runtime-supported",
    evidence: "local damage-taken events",
  },
  skillCast: {
    status: "runtime-supported",
    evidence: "skill cooldown-start edges, deduped by skill and cooldown begin time",
  },
  skillCastComplete: {
    status: "runtime-supported",
    evidence: "skill completion events when present",
  },
  skillDurationTick: {
    status: "runtime-supported",
    evidence: "skill cast opens a finite tick window",
  },
  buffAdded: {
    status: "runtime-supported",
    evidence: "buff add events with source config and source/host UUIDs",
  },
  buffDurationTick: {
    status: "runtime-supported",
    evidence: "buff add/change/remove events plus finite duration expiry",
  },
  buffLayerSpent: {
    status: "runtime-supported",
    evidence: "buff layer change events where previous layer is greater than current layer",
  },
  fightResourceSpent: {
    status: "runtime-supported-local",
    evidence: "local fight resource value decreases from SyncToMe resource packets",
  },
  movementDistance: {
    status: "runtime-supported",
    evidence: "runtime movement-distance accumulator",
  },
};

function fullPath(relPath) {
  return path.join(ROOT, relPath);
}

function readJson(relPath, fallback = null) {
  const filePath = fullPath(relPath);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeFile(relPath, text) {
  const filePath = fullPath(relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/<\s*(?:br|break)\s*\/?>/gi, ". ")
    .replace(/<\/\s*break\s*>/gi, ". ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSemi(value) {
  return String(value ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function unique(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function sourceKind(source) {
  if (!source || typeof source !== "object") return "";
  return Object.keys(source)[0] ?? "";
}

function sourceConfig(source) {
  const kind = sourceKind(source);
  const config = source?.[kind];
  return config && typeof config === "object" ? config : {};
}

function sourceLinkedIds(source) {
  const config = sourceConfig(source);
  return unique([
    ...asArray(config.skillBaseIds),
    ...asArray(config.skillKeys),
    config.skillBaseId,
    config.buffId,
    config.sourceConfigId,
    config.resourceId,
    config.attrId,
  ]);
}

function extractNumbers(pattern, text) {
  const values = [];
  for (const match of cleanText(text).matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) values.push(value);
  }
  return unique(values);
}

function extractFlatCooldownSeconds(text) {
  const normalized = cleanText(text);
  return unique([
    ...extractNumbers(/(?:-|−)\s*(\d+(?:\.\d+)?)\s*s/gi, normalized),
    ...extractNumbers(/(?:reduces?|reduce).*?(?:CD|cooldown).*?by\s+(\d+(?:\.\d+)?)\s*s/gi, normalized),
    ...extractNumbers(/(?:CD|cooldown).*?(?:reduces?|reduce).*?by\s+(\d+(?:\.\d+)?)\s*s/gi, normalized),
  ]).filter((value) => value > 0);
}

function extractAtMostOnceSeconds(text) {
  return extractNumbers(/at most once within\s+(\d+(?:\.\d+)?)\s*s/gi, text).filter((value) => value > 0);
}

function extractWhileActiveTarget(text) {
  const normalized = cleanText(text);
  const match = normalized.match(/\bwhile\s+(.{1,80}?)\s+is active\b/i);
  return cleanText(match?.[1] ?? "");
}

function splitEffectClauses(text) {
  return cleanText(text)
    .split(/(?:[.;。；])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasWhileActiveEnergyGrant(text) {
  return splitEffectClauses(text).some((clause) => {
    const lower = clause.toLowerCase();
    return /\bwhile\b/.test(lower) && /\b(?:active|state)\b/.test(lower) && /\bgrants?\b/.test(lower) && /\billusion energy\b/.test(lower);
  });
}

function hasConditionalEnergyGrant(text, condition) {
  const conditionPattern =
    condition === "lucky" ? /\blucky\b|lucky strike/i : /\bcrit\b|critical/i;
  return splitEffectClauses(text).some((clause) => {
    return conditionPattern.test(clause) && /\bgrants?\b/i.test(clause) && /\billusion energy\b/i.test(clause);
  });
}

function hasHitFilter(sourceTemplates, key, expectedValue = true) {
  return sourceTemplates.some((template) => {
    const filter = sourceConfig(template.source)?.hitFilter;
    return filter && filter[key] === expectedValue;
  });
}

function classifyText(row, sourceTemplates) {
  const text = cleanText(row.effect);
  const sourceKinds = splitSemi(row.sourceKinds);
  const hasSourceKind = (kind) => sourceKinds.includes(kind);
  const lower = text.toLowerCase();

  const flags = {
    whileActiveTick: hasSourceKind("buffDurationTick") || /\bwhile\b.+\bis active\b/.test(lower),
    cooldownFlat: extractFlatCooldownSeconds(text).length > 0,
    atMostOnce: extractAtMostOnceSeconds(text).length > 0,
    multiTargetOnce: /once when hitting multiple targets/i.test(text),
    lucky: /\blucky\b|lucky strike/i.test(text) || hasHitFilter(sourceTemplates, "lucky", true),
    crit: /\bcrit\b|critical/i.test(text) || hasHitFilter(sourceTemplates, "crit", true),
    resourceSpent:
      hasSourceKind("fightResourceSpent") ||
      /\b(consumes?|consumed|spends?|spent|resource|sigil|seeds?|photon energy|luminous energy|flame essence|rage)\b/i.test(text),
    stackLayer:
      hasSourceKind("buffLayerSpent") ||
      /\b(stacks?|stacking|layers?|layer)\b/i.test(text),
  };

  return flags;
}

function classifyImplementation(row, sourceTemplates, slotTemplates, behaviorRow) {
  const flags = classifyText(row, sourceTemplates);
  const sourceKinds = unique([
    ...splitSemi(row.sourceKinds),
    ...sourceTemplates.map((template) => sourceKind(template.source)).filter(Boolean),
  ]);
  const supported = sourceKinds.map((kind) => SOURCE_RUNTIME_SUPPORT[kind]?.status ?? "unknown");
  const reasons = [];
  let status = "runtime-ready";
  const text = cleanText(row.effect);
  const stasisOrPolarity = row.type === "Stasis" || row.type === "Polarity";
  const hasProcOrTimerText =
    Boolean(row.timers) ||
    flags.atMostOnce ||
    flags.cooldownFlat ||
    flags.whileActiveTick ||
    /\b(?:during|after casting|when taking|incoming damage|no damage is taken|per second|for the next|chance|consumed|restores?)\b/i.test(text);

  if (row.seasonStatus === "expired-season-3") {
    return {
      status: "ignored-expired-season",
      reasons: ["rhapsody/expired row should not participate in season 3 runtime math"],
    };
  }

  if (row.sourceStatus === "missing-source-template") {
    status = "needs-source-template";
    reasons.push("no source template is linked to this factor item");
  }

  if (sourceKinds.some((kind) => !SOURCE_RUNTIME_SUPPORT[kind])) {
    status = status === "runtime-ready" ? "needs-runtime-hook-review" : status;
    reasons.push(`unsupported or unknown source kind: ${sourceKinds.filter((kind) => !SOURCE_RUNTIME_SUPPORT[kind]).join(", ")}`);
  }

  if (row.type === "Reality" && row.sourceStatus === "expected-empty-consumes-total") {
    status = "static-reality-ready";
    reasons.push("reality factor consumes the shared illusion-energy total through its slot threshold");
  }

  if (flags.atMostOnce) {
    reasons.push(`reality/effect lockout windows: ${extractAtMostOnceSeconds(row.effect).join(", ")}s`);
  }

  if (flags.cooldownFlat) {
    status = status === "runtime-ready" ? "static-cooldown-change-needs-target-route" : status;
    reasons.push(`literal flat cooldown reduction: ${extractFlatCooldownSeconds(row.effect).join(", ")}s`);
  }

  if (flags.multiTargetOnce) {
    if (sourceKinds.includes("damageBySkillKeyOnce")) {
      reasons.push("multi-target once semantics are already represented by damageBySkillKeyOnce");
    } else {
      status = status === "runtime-ready" ? "needs-once-per-cast-source-template" : status;
      reasons.push("description says once when hitting multiple targets, but template is not damageBySkillKeyOnce");
    }
  }

  if (flags.whileActiveTick) {
    const whileActiveEnergyGrant = hasWhileActiveEnergyGrant(row.effect);
    if (sourceKinds.includes("buffDurationTick")) {
      reasons.push("while-active tick is represented by buffDurationTick");
    } else if (sourceKinds.includes("skillDurationTick")) {
      reasons.push("while-active tick is represented by a skill duration window");
    } else if (!whileActiveEnergyGrant && sourceKinds.length > 0) {
      reasons.push("while-active text is a passive bonus; the energy grant is represented by a separate runtime source");
    } else {
      status = status === "runtime-ready" ? "needs-active-buff-uid-bridge" : status;
      reasons.push(`while-active text needs buff UID/source bridge${extractWhileActiveTarget(row.effect) ? ` for ${extractWhileActiveTarget(row.effect)}` : ""}`);
    }
  }

  if (
    flags.lucky &&
    hasConditionalEnergyGrant(row.effect, "lucky") &&
    !hasHitFilter(sourceTemplates, "lucky", true) &&
    sourceKinds.some((kind) => kind.startsWith("damage"))
  ) {
    status = status === "runtime-ready" ? "needs-lucky-hit-filter-review" : status;
    reasons.push("lucky wording appears in description, but linked damage source does not require hitFilter.lucky");
  } else if (flags.lucky && !hasConditionalEnergyGrant(row.effect, "lucky") && sourceKinds.some((kind) => kind.startsWith("damage"))) {
    reasons.push("lucky wording is separate bonus text; the energy grant is not lucky-filtered");
  }

  if (
    flags.crit &&
    hasConditionalEnergyGrant(row.effect, "crit") &&
    !hasHitFilter(sourceTemplates, "crit", true) &&
    sourceKinds.some((kind) => kind.startsWith("damage"))
  ) {
    reasons.push("crit wording appears in description; verify whether the source should require hitFilter.crit");
  } else if (flags.crit && !hasConditionalEnergyGrant(row.effect, "crit") && sourceKinds.some((kind) => kind.startsWith("damage"))) {
    reasons.push("crit wording is separate bonus text; the energy grant is not crit-filtered");
  }

  if (flags.resourceSpent && sourceKinds.includes("fightResourceSpent")) {
    status = status === "runtime-ready" ? "runtime-resource-ready-local" : status;
    reasons.push("resource spent can be observed from local fight resource decreases");
  } else if (flags.resourceSpent && sourceKinds.includes("buffLayerSpent")) {
    reasons.push("resource/stack spend is represented by buffLayerSpent");
  } else if (flags.resourceSpent && !sourceKinds.includes("fightResourceSpent") && /spent|spend|consume/i.test(row.effect)) {
    status = status === "runtime-ready" ? "needs-resource-uid-bridge" : status;
    reasons.push("resource spend wording needs resource ID/stack bridge");
  }

  if (flags.stackLayer && sourceKinds.includes("buffLayerSpent")) {
    reasons.push("stack/layer spend is represented by buffLayerSpent");
  } else if (flags.stackLayer && !slotTemplates.some((template) => asArray(template.effectBuffIds).length > 0)) {
    status = status === "runtime-ready" ? "needs-stack-layer-buff-uid-bridge" : status;
    reasons.push("stack/layer wording has no effect buff IDs in matching slot template");
  }

  if (sourceKinds.length === 0 && status === "runtime-ready") {
    if (stasisOrPolarity && hasProcOrTimerText) {
      status = "needs-proc-timer-source-template";
      reasons.push("stasis/polarity row has proc, timer, or active-state text but no runtime source template");
    } else {
      status = "static-or-display-only";
      reasons.push("no runtime source template; keep as display/static unless a source bridge proves it");
    }
  }

  if (behaviorRow?.configuredThreshold !== undefined && behaviorRow?.configuredThreshold !== null) {
    reasons.push(`slot threshold currently configured: ${behaviorRow.configuredThreshold}`);
  }
  if (behaviorRow?.configuredFreezeSeconds) {
    reasons.push(`slot freeze currently configured: ${behaviorRow.configuredFreezeSeconds}s`);
  }

  return {
    status,
    reasons: unique(reasons),
    sourceSupport: unique(supported),
  };
}

function summarizeCounts(rows, key) {
  const counts = {};
  for (const row of rows) counts[row[key]] = (counts[row[key]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function mdList(lines, title, rows, formatRow, limit = 60) {
  lines.push(`## ${title}`);
  lines.push("");
  if (rows.length === 0) {
    lines.push("- None");
    lines.push("");
    return;
  }
  for (const row of rows.slice(0, limit)) {
    lines.push(`- ${formatRow(row)}`);
  }
  if (rows.length > limit) lines.push(`- ... ${rows.length - limit} more rows in JSON`);
  lines.push("");
}

function compactGradeEvidence(source) {
  const gradeRows = asArray(source?.modifierEvidence?.gradeRows);
  if (gradeRows.length === 0) return null;
  return {
    valueStatus: source?.modifierEvidence?.valueStatus ?? "",
    runtimeSelectionStatus: source?.modifierEvidence?.runtimeSelectionStatus ?? "",
    gradeCount: gradeRows.length,
    firstGrade: gradeRows[0]?.grade ?? null,
    firstItemId: gradeRows[0]?.itemId ?? null,
    firstDescription: cleanText(gradeRows[0]?.cleanResolvedDescription ?? "").slice(0, 240),
    lastGrade: gradeRows.at(-1)?.grade ?? null,
    lastItemId: gradeRows.at(-1)?.itemId ?? null,
    lastDescription: cleanText(gradeRows.at(-1)?.cleanResolvedDescription ?? "").slice(0, 240),
  };
}

function compactEffectSource(source) {
  if (!source || typeof source !== "object") return null;
  return {
    sourceId: source.sourceId ?? "",
    sourceKind: source.sourceKind ?? "",
    sourceType: source.sourceType ?? "",
    sourceEntityId: source.sourceEntityId ?? null,
    familyId: source.familyId ?? null,
    runtimeDetection: source.runtimeDetection ?? "",
    buffIds: asArray(source.buffIds),
    damageIds: asArray(source.damageIds),
    recountIds: asArray(source.recountIds),
    classGateIds: asArray(source.classGateIds),
    gradeEvidence: compactGradeEvidence(source),
    bridgeCaution:
      source.runtimeDetection === "active-buff-or-selected-factor-grade-item"
        ? "selection/active-factor evidence only; does not prove the proc or per-tick runtime source"
        : "",
  };
}

function buildGeneratedBridgeLookup(effectSources, modifierSourceIndex, seasonFactors) {
  const effectSourcesById = effectSources?.effectSourcesById ?? {};
  const effectIdsByBuffId = effectSources?.buffIdToEffectSourceIds ?? {};
  const sourceIndexByBuffId = modifierSourceIndex?.byBuffId ?? {};
  const factorsByBuffId = seasonFactors?.factorsByBuffId ?? {};

  return (row) => {
    const buffId = String(row.buffId ?? row.uid ?? "");
    if (!buffId) return [];

    const candidates = [];
    for (const sourceId of asArray(effectIdsByBuffId[buffId])) {
      const candidate = compactEffectSource(effectSourcesById[sourceId]);
      if (candidate) {
        candidates.push({
          table: "EffectSources.buffIdToEffectSourceIds",
          match: "buffId",
          ...candidate,
        });
      }
    }

    for (const source of asArray(sourceIndexByBuffId[buffId])) {
      candidates.push({
        table: "ModifierSourceIndex.byBuffId",
        match: "buffId",
        sourceId: source.sourceId ?? "",
        sourceKind: source.sourceKind ?? "",
        sourceType: source.sourceType ?? "",
        sourceEntityId: source.sourceEntityId ?? null,
        familyId: source.familyId ?? null,
        runtimeDetection: source.runtimeDetection ?? "",
        buffIds: asArray(source.buffIds),
        damageIds: asArray(source.damageIds),
        recountIds: asArray(source.recountIds),
        classGateIds: asArray(source.classGateIds),
        gradeEvidence: compactGradeEvidence(source),
        bridgeCaution:
          source.runtimeDetection === "active-buff-or-selected-factor-grade-item"
            ? "selection/active-factor evidence only; does not prove the proc or per-tick runtime source"
            : "",
      });
    }

    const factor = factorsByBuffId[buffId];
    if (factor?.modifierEvidence?.gradeRows) {
      candidates.push({
        table: "SeasonPhantomFactors.factorsByBuffId",
        match: "buffId",
        sourceId: `season-factor:${buffId}`,
        sourceKind: "season-factor-grade-table",
        sourceType: "static-grade-values",
        sourceEntityId: Number(buffId),
        familyId: factor.familyId ?? null,
        runtimeDetection: factor.runtimeDetection ?? "",
        buffIds: [Number(buffId)],
        damageIds: asArray(factor.affectedDamageIds),
        recountIds: asArray(factor.affectedRecountIds),
        classGateIds: asArray(factor.classGateIds),
        gradeEvidence: compactGradeEvidence(factor),
        bridgeCaution: "static per-grade values only; does not prove runtime trigger/proc source",
      });
    }

    const seen = new Set();
    return candidates.filter((candidate) => {
      const key = `${candidate.table}:${candidate.sourceId}:${candidate.sourceKind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
}

function formatBridgeCandidate(candidate) {
  const ids = unique([
    ...asArray(candidate.buffIds).map((value) => `buff:${value}`),
    ...asArray(candidate.damageIds).map((value) => `damage:${value}`),
    ...asArray(candidate.recountIds).map((value) => `recount:${value}`),
  ]);
  const grade = candidate.gradeEvidence
    ? `; grades=${candidate.gradeEvidence.gradeCount} (${candidate.gradeEvidence.firstGrade}->${candidate.gradeEvidence.lastGrade})`
    : "";
  const caution = candidate.bridgeCaution ? `; caution=${candidate.bridgeCaution}` : "";
  return `${candidate.table}:${candidate.sourceId || "-"} kind=${candidate.sourceKind || "-"} detection=${candidate.runtimeDetection || "-"} ids=${ids.join(",") || "-"}${grade}${caution}`;
}

function main() {
  const gaps = readJson(PATHS.gaps, { rows: [] });
  const behavior = readJson(PATHS.behavior, { reportRows: [] });
  const sourceTemplates = asArray(readJson(PATHS.sourceTemplates, []));
  const slotTemplates = asArray(readJson(PATHS.slotTemplates, []));
  const gearSetEffects = readJson(PATHS.gearSetEffects, { cooldownRelevantSetRows: [], summary: {} });
  const generatedBridgeLookup = buildGeneratedBridgeLookup(
    readJson(PATHS.effectSources, {}),
    readJson(PATHS.modifierSourceIndex, {}),
    readJson(PATHS.seasonFactors, {}),
  );

  const sourcesById = new Map(sourceTemplates.map((template) => [template.sourceId, template]));
  const slotsById = new Map(slotTemplates.map((template) => [template.slotTemplateId, template]));
  const behaviorBySlotId = new Map(behavior.reportRows.map((row) => [row.slotTemplateId, row]));

  const rows = asArray(gaps.rows).map((row) => {
    const sourceIds = splitSemi(row.sourceIds);
    const slotTemplateIds = splitSemi(row.slotTemplates);
    const matchingSources = sourceIds.map((id) => sourcesById.get(id)).filter(Boolean);
    const matchingSlots = slotTemplateIds.map((id) => slotsById.get(id)).filter(Boolean);
    const behaviorRows = slotTemplateIds.map((id) => behaviorBySlotId.get(id)).filter(Boolean);
    const classification = classifyImplementation(row, matchingSources, matchingSlots, behaviorRows[0]);
    const flags = classifyText(row, matchingSources);
    return {
      ...row,
      behaviorFlags: flags,
      implementationStatus: classification.status,
      implementationReasons: classification.reasons,
      sourceSupport: classification.sourceSupport,
      runtimeSourceKinds: unique(matchingSources.map((template) => sourceKind(template.source))),
      runtimeLinkedIds: unique(matchingSources.flatMap((template) => sourceLinkedIds(template.source))),
      slotThresholds: unique(behaviorRows.map((item) => item.configuredThreshold).filter((value) => value !== null && value !== undefined)),
      slotFreezeSeconds: unique(behaviorRows.map((item) => item.configuredFreezeSeconds).filter(Boolean)),
      flatCooldownSeconds: extractFlatCooldownSeconds(row.effect),
      atMostOnceSeconds: extractAtMostOnceSeconds(row.effect),
      hasLuckyFilter: hasHitFilter(matchingSources, "lucky", true),
      hasCritFilter: hasHitFilter(matchingSources, "crit", true),
      generatedBridgeCandidates: generatedBridgeLookup(row),
    };
  });

  const activeRows = rows.filter((row) => row.seasonStatus !== "expired-season-3");
  const staticReadyRows = activeRows.filter((row) => row.implementationStatus === "static-reality-ready");
  const runtimeReadyRows = activeRows.filter((row) =>
    ["runtime-ready", "runtime-resource-ready-local"].includes(row.implementationStatus),
  );
  const reviewRows = activeRows.filter((row) =>
    !["runtime-ready", "runtime-resource-ready-local", "static-reality-ready", "ignored-expired-season"].includes(row.implementationStatus),
  );
  const cooldownRows = activeRows.filter((row) => row.behaviorFlags.cooldownFlat);
  const whileActiveRows = activeRows.filter((row) => row.behaviorFlags.whileActiveTick);
  const onceRows = activeRows.filter((row) => row.behaviorFlags.multiTargetOnce);
  const realityLockoutRows = activeRows.filter((row) => row.behaviorFlags.atMostOnce);
  const luckyRows = activeRows.filter((row) => row.behaviorFlags.lucky);
  const resourceRows = activeRows.filter((row) => row.behaviorFlags.resourceSpent);
  const stackRows = activeRows.filter((row) => row.behaviorFlags.stackLayer);
  const reviewBridgeRows = reviewRows.filter((row) => asArray(row.generatedBridgeCandidates).length > 0);

  const report = {
    generatedAt: new Date().toISOString(),
    runtimeSignals: SOURCE_RUNTIME_SUPPORT,
    summary: {
      totalRows: rows.length,
      activeSeason3Rows: activeRows.length,
      expiredSeason3Rows: rows.length - activeRows.length,
      runtimeReadyRows: runtimeReadyRows.length,
      staticRealityReadyRows: staticReadyRows.length,
      reviewRows: reviewRows.length,
      reviewRowsWithGeneratedBridgeCandidates: reviewBridgeRows.length,
      implementationStatusCounts: summarizeCounts(rows, "implementationStatus"),
      sourceKindCounts: (() => {
        const counts = {};
        for (const row of rows) {
          for (const kind of splitSemi(row.sourceKinds || row.runtimeSourceKinds?.join(";"))) {
            counts[kind] = (counts[kind] ?? 0) + 1;
          }
        }
        return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
      })(),
      behaviorCounts: {
        whileActiveTick: whileActiveRows.length,
        flatCooldownChange: cooldownRows.length,
        multiTargetOnce: onceRows.length,
        realityAtMostOnce: realityLockoutRows.length,
        luckyMentionOrFilter: luckyRows.length,
        resourceSpentMentionOrSource: resourceRows.length,
        stackLayerMentionOrSource: stackRows.length,
      },
      gearSetCooldownRelevantRows: asArray(gearSetEffects.cooldownRelevantSetRows).length,
      gearSetRuntimeBridge: gearSetEffects.summary?.runtimePieceCountRequirement ?? "",
    },
    lists: {
      reviewRows,
      whileActiveRows,
      cooldownRows,
      multiTargetOnceRows: onceRows,
      realityLockoutRows,
      luckyRows,
      resourceRows,
      stackLayerRows: stackRows,
      reviewBridgeRows,
      gearSetCooldownRows: asArray(gearSetEffects.cooldownRelevantSetRows).map((row) => ({
        id: row.id,
        className: row.className,
        pieceThreshold: row.parsedSet?.pieceThreshold ?? null,
        branch: row.parsedSet?.branch ?? "",
        categories: row.categories ?? [],
        values: row.valueTexts ?? [],
        effect: row.englishDescription ?? "",
        runtimeBridgeStatus: row.runtimeActivationBridge?.status ?? "",
        runtimeBridgeExpectedSource: row.runtimeActivationBridge?.expectedSource ?? "",
      })),
    },
    rows,
  };

  writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);

  const lines = [];
  lines.push("# Factor Runtime Evidence Gaps");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Active season 3 factor rows: ${report.summary.activeSeason3Rows}`);
  lines.push(`- Runtime-ready rows: ${report.summary.runtimeReadyRows}`);
  lines.push(`- Static reality-ready rows: ${report.summary.staticRealityReadyRows}`);
  lines.push(`- Rows needing review/bridges: ${report.summary.reviewRows}`);
  lines.push(`- Review rows with generated bridge candidates: ${report.summary.reviewRowsWithGeneratedBridgeCandidates}`);
  lines.push(`- Gear set cooldown-relevant rows needing equipped-set proof: ${report.summary.gearSetCooldownRelevantRows}`);
  lines.push("");
  lines.push("### Implementation Status Counts");
  lines.push("");
  for (const [key, count] of Object.entries(report.summary.implementationStatusCounts)) {
    lines.push(`- ${key}: ${count}`);
  }
  lines.push("");
  lines.push("### Runtime Signal Notes");
  lines.push("");
  lines.push("- Buff active/off is observable when add/change/remove packets arrive; finite durations can also expire locally.");
  lines.push("- Lucky and crit are already damage-event flags and can be used by counter hit filters.");
  lines.push("- Multi-target once is represented by damageBySkillKeyOnce, which counts max hits per target group instead of summing every target hit.");
  lines.push("- Fight resource spending is observable for the local player; remote-player resources still need proof before using them globally.");
  lines.push("- Gear set effects must wait for equipped suit family plus 2/4-piece proof before they affect cooldown or factor math.");
  lines.push("");

  mdList(
    lines,
    "Rows Needing Review Or Bridges",
    reviewRows,
    (row) =>
      `${row.name} (${row.sourceStatus}) -> ${row.implementationStatus}; ${row.implementationReasons.join("; ")}; generatedCandidates=${asArray(row.generatedBridgeCandidates).length}`,
    80,
  );
  mdList(
    lines,
    "Generated Bridge Candidates For Review Rows",
    reviewBridgeRows,
    (row) =>
      `${row.name}: ${asArray(row.generatedBridgeCandidates)
        .slice(0, 3)
        .map(formatBridgeCandidate)
        .join(" | ")}`,
    80,
  );
  mdList(
    lines,
    "While-Active Tick Rows",
    whileActiveRows,
    (row) => `${row.name}: sourceKinds=${row.sourceKinds || "-"} ids=${row.linkedIds || "-"}; ${row.implementationStatus}`,
    80,
  );
  mdList(
    lines,
    "Flat Cooldown Change Rows",
    cooldownRows,
    (row) => `${row.name}: ${row.flatCooldownSeconds.join(", ")}s; sourceKinds=${row.sourceKinds || "-"}; ${row.implementationReasons.join("; ")}`,
    80,
  );
  mdList(
    lines,
    "Multi-Target Once Rows",
    onceRows,
    (row) => `${row.name}: sourceKinds=${row.sourceKinds || "-"} linked=${row.linkedIds || "-"}; ${row.implementationStatus}`,
    80,
  );
  mdList(
    lines,
    "Reality At-Most-Once Lockout Rows",
    realityLockoutRows,
    (row) => `${row.name}: ${row.atMostOnceSeconds.join(", ")}s; threshold=${row.slotThresholds.join(",") || "-"}; ${row.implementationStatus}`,
    80,
  );
  mdList(
    lines,
    "Lucky Rows",
    luckyRows,
    (row) => `${row.name}: sourceKinds=${row.sourceKinds || "-"} luckyFilter=${row.hasLuckyFilter}; ${row.implementationStatus}`,
    80,
  );
  mdList(
    lines,
    "Resource Spend / Resource-State Rows",
    resourceRows,
    (row) => `${row.name}: sourceKinds=${row.sourceKinds || "-"} linked=${row.linkedIds || "-"}; ${row.implementationStatus}`,
    80,
  );
  mdList(
    lines,
    "Stack / Layer Rows",
    stackRows,
    (row) => `${row.name}: sourceKinds=${row.sourceKinds || "-"} linked=${row.linkedIds || "-"}; ${row.implementationStatus}`,
    80,
  );
  mdList(
    lines,
    "Gear Set Cooldown-Relevant Rows",
    report.lists.gearSetCooldownRows,
    (row) => `${row.className} set ${row.pieceThreshold || "?"}${row.branch}: ${row.effect}; bridge=${row.runtimeBridgeStatus}`,
    80,
  );

  writeFile(OUT_MD, `${lines.join("\n")}\n`);
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_MD}`);
  console.log(`Rows needing review/bridges: ${reviewRows.length}`);
}

main();
