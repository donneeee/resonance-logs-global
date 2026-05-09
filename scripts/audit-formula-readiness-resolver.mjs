#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const DEFAULT_LATEST_INPUTS = 3;
const DEFAULT_MAX_ROWS = 60;
const DEFAULT_OUT_JSON = "DEV_exports/formula-readiness-resolver-audit.json";
const DEFAULT_OUT_MD = "DEV_exports/formula-readiness-resolver-audit.md";

const PERCENT_COMPONENT_KEYS = new Set([
  "critical-damage",
  "critical-rate",
  "elemental-damage",
  "generic-damage",
]);

const STAT_AMOUNT_COMPONENT_KEYS = new Set([
  "atk",
  "attack",
  "base-atk",
  "max-hp",
  "hp",
  "def",
]);

function parseArgs(argv) {
  const options = {
    inputs: [],
    latest: DEFAULT_LATEST_INPUTS,
    outJson: DEFAULT_OUT_JSON,
    outMd: DEFAULT_OUT_MD,
    maxRows: DEFAULT_MAX_ROWS,
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
    } else if (arg === "--max-rows") {
      options.maxRows = Math.max(1, Number(argv[++index]) || DEFAULT_MAX_ROWS);
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
  console.log(`Usage: node scripts/audit-formula-readiness-resolver.mjs [options]

Options:
  --input <path>      Add a specific modifier-entity export. Repeatable.
  --latest <count>    Use latest DEV_exports/modifier-entity-*.json files when no inputs are provided. Default: ${DEFAULT_LATEST_INPUTS}
  --out-json <path>   JSON report path. Default: ${DEFAULT_OUT_JSON}
  --out-md <path>     Markdown report path. Default: ${DEFAULT_OUT_MD}
  --max-rows <count>  Max Markdown rows per table. Default: ${DEFAULT_MAX_ROWS}
`);
}

function resolveRepoPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readGenerated(fileName) {
  return readJson(path.join(repoRoot, "parser-data", "generated", fileName));
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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function numberValue(value) {
  return finiteNumber(value) ?? 0;
}

function formatNumber(value) {
  return Math.round(Number(value) || 0).toLocaleString("en-US");
}

function formatPct(value, total) {
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "0.0%";
}

function localizedName(map, fallback = "") {
  if (map && typeof map === "object" && !Array.isArray(map)) {
    return (
      map.en
      ?? map.design
      ?? Object.values(map).find((value) => typeof value === "string" && value.trim())
      ?? fallback
    );
  }
  return fallback;
}

function addCount(object, key, amount = 1) {
  if (!key) return;
  object[key] = (object[key] ?? 0) + amount;
}

function addMapCount(map, key, amount = 1) {
  if (!key) return;
  map.set(String(key), (map.get(String(key)) ?? 0) + amount);
}

function countMapToObject(map, limit = 12) {
  return Object.fromEntries(
    [...map.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit),
  );
}

function uniqueSortedNumbers(values) {
  return [...new Set(values.map(Number).filter(Number.isFinite))].sort((left, right) => left - right);
}

function uniqueSortedStrings(values) {
  return [...new Set(values.map(String).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function buildIndexes() {
  const modifierRecount = readGenerated("ModifierRecountTable.json");
  const contribution = readGenerated("ModifierContributionRuntime.json");
  const display = readGenerated("ModifierDisplayTable.json");
  const descriptions = readGenerated("ModifierDescriptions.json");
  const damageRows = readGenerated("DamageAttrIdName.json");
  const skillDetails = readGenerated("SkillBreakdownDetails.json");
  const seasonFactors = readGenerated("SeasonPhantomFactors.json");

  const ruleIdsByBuffId = new Map();
  for (const [buffId, ruleIds] of Object.entries(asObject(modifierRecount.byBuffId))) {
    ruleIdsByBuffId.set(String(buffId), asArray(ruleIds).map(String));
  }

  return {
    modifierRecount,
    contribution,
    display,
    descriptions,
    damageRows,
    seasonFactors,
    skillDetails,
    ruleIdsByBuffId,
  };
}

function sourceLabel(ruleId, indexes) {
  const display = indexes.display.sourcesByRuleId?.[ruleId];
  const source = indexes.modifierRecount.sourcesById?.[ruleId];
  const contribution = indexes.contribution.sourcesByRuleId?.[ruleId];
  return (
    display?.sourceName
    ?? localizedName(display?.sourceNames)
    ?? localizedName(source?.sourceNames)
    ?? source?.sourceName
    ?? contribution?.sourceId
    ?? source?.sourceId
    ?? ruleId
  );
}

function sourceDescription(ruleId, indexes) {
  const entry = indexes.descriptions.sourcesByRuleId?.[ruleId];
  return localizedName(entry?.descriptions, entry?.description ?? "");
}

function descriptionValueHintBlocker(descriptionText) {
  const text = String(descriptionText ?? "").trim();
  if (!text) return "missing-component-value-hints";
  return /[+\-]?\s*\d+(?:\.\d+)?\s*%?/.test(text)
    ? "description-has-unparsed-numeric-value-hints"
    : "description-has-no-numeric-value-hints";
}

function damageDisplayName(damageId, indexes) {
  const key = String(damageId);
  const detail = asObject(indexes.skillDetails[key]);
  const damage = asObject(indexes.damageRows[key]);
  return (
    localizedName(detail.names)
    || localizedName(detail.damageNames)
    || localizedName(damage.Names)
    || damage.Name
    || damage.NameDesign
    || `damage:${key}`
  );
}

function activeModifierEntries(hit) {
  const entries = [];
  for (const modifier of asArray(hit?.activeModifiers)) {
    const modifierBaseId = positiveNumber(modifier?.modifierBaseId);
    const modifierSourceConfigId = positiveNumber(modifier?.modifierSourceConfigId);
    const modifierHostUid = positiveNumber(modifier?.modifierHostUid);
    const modifierSourceUid = positiveNumber(modifier?.modifierSourceUid);
    const modifierLayer = finiteNumber(modifier?.modifierLayer);
    const modifierCount = finiteNumber(modifier?.modifierCount);
    for (const [field, buffId] of [
      ["modifierBaseId", modifierBaseId],
      ["modifierSourceConfigId", modifierSourceConfigId],
    ]) {
      if (buffId === null) continue;
      entries.push({
        buffId,
        field,
        modifierBaseId,
        modifierSourceConfigId,
        modifierHostUid,
        modifierSourceUid,
        modifierLayer,
        modifierCount,
      });
    }
  }
  return entries;
}

function activeRuleLinks(hit, indexes) {
  const byRule = new Map();
  for (const entry of activeModifierEntries(hit)) {
    for (const ruleId of indexes.ruleIdsByBuffId.get(String(entry.buffId)) ?? []) {
      let current = byRule.get(ruleId);
      if (!current) {
        current = {
          ruleId,
          buffIds: new Set(),
          entries: [],
        };
        byRule.set(ruleId, current);
      }
      current.buffIds.add(entry.buffId);
      current.entries.push(entry);
    }
  }
  return [...byRule.values()].map((link) => ({
    ...link,
    buffIds: [...link.buffIds].sort((left, right) => left - right),
  }));
}

function buildActorIndex(entity) {
  const byUid = new Map();
  for (const actor of asArray(entity.modifierSourceActors)) {
    const uid = positiveNumber(actor?.uid);
    if (uid !== null) byUid.set(uid, actor);
  }
  return byUid;
}

function sourceUidForLink(link) {
  return link.entries.find((entry) => entry.modifierSourceUid !== null)?.modifierSourceUid ?? null;
}

function hostUidForLink(link) {
  return link.entries.find((entry) => entry.modifierHostUid !== null)?.modifierHostUid ?? null;
}

function providerForLink(entity, actorIndex, link) {
  const sourceUid = sourceUidForLink(link);
  const hostUid = hostUidForLink(link);
  const sourceActor = sourceUid !== null ? actorIndex.get(sourceUid) : undefined;
  const hostActor = hostUid !== null ? actorIndex.get(hostUid) : undefined;
  const ownerUid = positiveNumber(sourceActor?.ownerUid) ?? positiveNumber(hostActor?.ownerUid) ?? sourceUid;
  const ownerName = sourceActor?.ownerName ?? hostActor?.ownerName;
  const providerName = ownerName
    ?? sourceActor?.name
    ?? hostActor?.name
    ?? (sourceUid === entity.uid ? entity.name : null)
    ?? (sourceUid !== null ? `#${sourceUid}` : "unknown");
  const isOwner = sourceUid === entity.uid || ownerUid === entity.uid;
  return {
    sourceUid,
    hostUid,
    ownerUid,
    providerName,
    scope: isOwner ? "owner" : "party",
  };
}

function normalizedHintValues(hint) {
  const values = asArray(hint?.values).map((value) => normalizeHintValue(value));
  if (values.length) return values;

  const direct = normalizeHintValue({
    scope: hint?.valueScope ?? hint?.scope ?? "global",
    rawText: hint?.rawText ?? "",
    unit: hint?.unit ?? null,
    value: hint?.value,
    decimalValue: hint?.decimalValue,
    formulaAmount: hint?.formulaAmount,
  });
  return direct.numericValue !== null || direct.decimalValue !== null ? [direct] : [];
}

function normalizeHintValue(value) {
  const decimalValue = finiteNumber(value?.decimalValue);
  const numericValue = finiteNumber(value?.value);
  const unit = String(value?.unit ?? "").toLowerCase();
  return {
    scope: String(value?.scope ?? "").toLowerCase(),
    rawText: String(value?.rawText ?? ""),
    unit,
    value: numericValue,
    decimalValue,
    formulaValue: decimalValue ?? numericValue,
    formulaAmount: Boolean(value?.formulaAmount) || decimalValue !== null,
    inferredFrom: value?.inferredFrom ?? null,
    tier: finiteNumber(value?.tier),
    tierKind: value?.tierKind ?? null,
  };
}

function sourceFactorBuffId(rule) {
  const sourceId = String(rule?.sourceId ?? "");
  const fromSourceId = sourceId.startsWith("phantom-factor:")
    ? positiveNumber(sourceId.slice("phantom-factor:".length))
    : null;
  return fromSourceId ?? positiveNumber(rule?.sourceEntityId);
}

function normalizeFactorItem(item) {
  const factorBuffId = positiveNumber(item?.factorBuffId ?? item?.factor_buff_id);
  const itemConfigId = positiveNumber(item?.itemConfigId ?? item?.item_config_id);
  if (factorBuffId === null || itemConfigId === null) return null;
  return {
    factorBuffId,
    itemConfigId,
    itemUuid: finiteNumber(item?.itemUuid ?? item?.item_uuid),
    grade: finiteNumber(item?.grade),
    familyId: finiteNumber(item?.familyId ?? item?.family_id),
    runtimeSource: String(item?.runtimeSource ?? item?.runtime_source ?? ""),
  };
}

function isTrustedSelectedFactorItem(item) {
  const source = String(item?.runtimeSource ?? "").toLowerCase();
  if (!source) return false;
  return !source.includes("item_package.packages.items");
}

function factorItemsForEntity(entity) {
  return asArray(entity?.activeFactorItems ?? entity?.active_factor_items)
    .map(normalizeFactorItem)
    .filter(Boolean);
}

function factorGradeRowForSelection(indexes, factorBuffId, factorItem) {
  const factor = indexes.seasonFactors.factorsByBuffId?.[String(factorBuffId)];
  const rows = asArray(factor?.modifierEvidence?.gradeRows);
  if (!rows.length || !factorItem) return null;
  return rows.find((row) => positiveNumber(row?.itemId) === factorItem.itemConfigId)
    ?? rows.find((row) => finiteNumber(row?.grade) === factorItem.grade)
    ?? null;
}

function runtimeSelectionForRule(entity, rule, indexes) {
  const factorBuffId = sourceFactorBuffId(rule);
  if (factorBuffId === null) return null;
  const factorItem = factorItemsForEntity(entity)
    .filter(isTrustedSelectedFactorItem)
    .find((item) => item.factorBuffId === factorBuffId);
  if (!factorItem) return null;
  const factorGradeRow = factorGradeRowForSelection(indexes, factorBuffId, factorItem);
  if (!factorGradeRow) return null;
  return {
    type: "factor-grade",
    key: `factor:${factorBuffId}:item:${factorItem.itemConfigId}:grade:${factorItem.grade ?? "?"}`,
    factorBuffId,
    factorItem,
    factorGradeRow,
  };
}

function isPercentFormulaValue(value) {
  return value.formulaAmount && value.decimalValue !== null && value.unit === "percent";
}

function isFlatFormulaValue(value) {
  return value.formulaAmount && value.formulaValue !== null && value.unit === "flat";
}

function selectedValue(value, method) {
  return {
    method,
    scope: value.scope,
    rawText: value.rawText,
    unit: value.unit,
    value: value.value,
    decimalValue: value.decimalValue,
    formulaValue: value.formulaValue,
    inferredFrom: value.inferredFrom,
    tier: value.tier,
    tierKind: value.tierKind,
  };
}

function valueForNumericAmount(values, amount) {
  return values.find((value) =>
    isFlatFormulaValue(value)
    && Math.abs(Number(value.formulaValue) - amount) < 0.000001
  );
}

function statPerStackValueFromDescription(hint, values, descriptionText) {
  const componentKey = String(hint?.componentKey ?? "").toLowerCase();
  const looksLikeStatAmount = STAT_AMOUNT_COMPONENT_KEYS.has(componentKey)
    || String(hint?.direction ?? "").toLowerCase() === "stat"
    || String(hint?.effectClass ?? "").toLowerCase().includes("stat");
  if (!looksLikeStatAmount) return null;

  const text = String(descriptionText ?? "").replace(/\s+/g, " ");
  const matches = [
    ...text.matchAll(/\b(?:atk|attack|matk|magic attack|def|defense|hp)\b[^.;\n]{0,32}?[+＋]\s*(\d+(?:\.\d+)?)[^.;\n]{0,24}?\bper\s+stack\b/gi),
    ...text.matchAll(/\bper\s+stack\b[^.;\n]{0,24}?\b(?:atk|attack|matk|magic attack|def|defense|hp)\b[^.;\n]{0,32}?[+＋]\s*(\d+(?:\.\d+)?)/gi),
  ];
  for (const match of matches) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) continue;
    const value = valueForNumericAmount(values, amount);
    if (value) return value;
  }
  return null;
}

function mechanicDescriptionSignals(descriptionText) {
  const text = String(descriptionText ?? "").toLowerCase();
  const signals = [];
  if (/\bstack(?:s|ing|able|ed)?\b|stacking up|stackable|cumulable|tumpuk|叠加|層|层|スタック|스택/.test(text)) {
    signals.push("stack");
  }
  if (/\bcount(?:s|er|ing)?\b|hit(?:s)? to|hits? every|每造成|カウント|회\b/.test(text)) {
    signals.push("counter");
  }
  if (/\btrigger(?:s|ed|ing)?\b|triggers?|触发|發動|発動|déclenche/.test(text)) {
    signals.push("trigger");
  }
  if (/\bduration\b|\bsec(?:ond)?s?\b|\d+\s*s\b|秒|秒間|초|Sek\./i.test(descriptionText ?? "")) {
    signals.push("duration");
  }
  return uniqueSortedStrings(signals);
}

function mechanicValueEvidence(hint, values, descriptionText) {
  const componentKey = String(hint?.componentKey ?? "").toLowerCase();
  const formulaValues = values.filter((value) => value.formulaAmount && value.formulaValue !== null);
  const percentValues = values.filter(isPercentFormulaValue);
  const hasDurationValue = values.some((value) => value.unit === "seconds" || /\d+\s*s\b/i.test(value.rawText));
  const signals = mechanicDescriptionSignals(descriptionText);
  const looksLikeStatAmount = STAT_AMOUNT_COMPONENT_KEYS.has(componentKey)
    || String(hint?.direction ?? "").toLowerCase() === "stat"
    || String(hint?.effectClass ?? "").toLowerCase().includes("stat");

  if (!looksLikeStatAmount) return null;
  if (percentValues.length) return null;
  if (formulaValues.length < 2) return null;
  if (!hasDurationValue && !signals.length) return null;

  return {
    rawTexts: uniqueSortedStrings(values.map((value) => value.rawText).filter(Boolean)),
    units: uniqueSortedStrings(values.map((value) => value.unit).filter(Boolean)),
    descriptionSignals: signals,
  };
}

function strictResolveHint(hint, selectedScope) {
  const values = normalizedHintValues(hint);
  if (!values.length) return { status: "blocked", blocker: "missing-value" };

  const scope = String(selectedScope ?? "").toLowerCase();
  const exact = values.filter((value) => value.scope === scope && value.formulaValue !== null);
  if (exact.length === 1) return { status: "ready", value: selectedValue(exact[0], `scope:${scope}`) };

  const global = values.filter((value) => ["", "global", "all"].includes(value.scope) && value.formulaValue !== null);
  if (global.length === 1) return { status: "ready", value: selectedValue(global[0], "global") };

  const formulaValues = values.filter((value) => value.formulaValue !== null);
  if (formulaValues.length === 1) return { status: "ready", value: selectedValue(formulaValues[0], "single") };

  return { status: "blocked", blocker: "ambiguous-value", values };
}

function runtimeSelectionBlockerForHint(hint, values = normalizedHintValues(hint)) {
  const valueTextSource = String(hint?.valueTextSource ?? "");
  const valueResolution = String(hint?.valueResolution ?? "");
  if (
    valueTextSource === "SkillAoyiStarTable.tierRows"
    || valueTextSource.includes("SkillAoyiStarTable")
    || valueResolution.includes("modification-tier")
    || valueResolution.includes("tiered")
  ) {
    const formulaValues = values.filter((value) => value.formulaAmount && value.formulaValue !== null);
    const tiers = uniqueSortedNumbers(formulaValues.map((value) => value.tier).filter((value) => value !== null));
    return tiers.length > 1 ? "runtime-tier-selection-required" : null;
  }
  if (valueTextSource !== "modifierEvidence.gradeRows") return null;
  const formulaValues = values.filter((value) => value.formulaAmount && value.formulaValue !== null);
  return formulaValues.length > 1 ? "runtime-grade-selection-required" : null;
}

function factorGradeValueFromRuntimeSelection(hint, runtimeSelection) {
  if (String(hint?.valueTextSource ?? "") !== "modifierEvidence.gradeRows") return null;
  if (runtimeSelection?.type !== "factor-grade" || !runtimeSelection.factorGradeRow) return null;

  const valuesByRawText = new Map(normalizedHintValues(hint).map((value) => [value.rawText, value]));
  const candidates = asArray(runtimeSelection.factorGradeRow.valueTexts)
    .map((rawText) => valuesByRawText.get(String(rawText)))
    .filter(Boolean);
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) return null;

  const componentKey = String(hint?.componentKey ?? "").toLowerCase();
  const formulaTermIds = asArray(hint?.formulaTermIds).map(String);
  const description = String(runtimeSelection.factorGradeRow.cleanResolvedDescription ?? "").toLowerCase();

  if (componentKey === "critical-rate") return candidates[0];
  if (componentKey === "season-damage" || formulaTermIds.includes("seasonDamagePct")) {
    if (description.includes("dream dmg") || description.includes("damage")) {
      return candidates[candidates.length - 1];
    }
  }

  return null;
}

function resolveHint(hint, selectedScope, descriptionText, runtimeSelection) {
  const strict = strictResolveHint(hint, selectedScope);
  if (strict.status === "ready") return { ...strict, strictReady: true };

  const values = normalizedHintValues(hint);
  const scope = String(selectedScope ?? "").toLowerCase();
  const componentKey = String(hint?.componentKey ?? "");
  const factorGradeValue = factorGradeValueFromRuntimeSelection(hint, runtimeSelection);
  if (factorGradeValue) {
    return {
      status: "ready",
      strictReady: false,
      value: selectedValue(
        factorGradeValue,
        `runtime-factor-grade:${runtimeSelection.factorItem.grade ?? runtimeSelection.factorItem.itemConfigId}`,
      ),
    };
  }
  const perStackStatValue = statPerStackValueFromDescription(hint, values, descriptionText);
  if (perStackStatValue) {
    return {
      status: "ready",
      strictReady: false,
      value: selectedValue(perStackStatValue, "explicit-stat-per-stack-value"),
    };
  }
  const mechanicEvidence = mechanicValueEvidence(hint, values, descriptionText);
  if (mechanicEvidence) {
    return {
      status: "blocked",
      strictReady: false,
      blocker: "mechanic-values-not-stat",
      values,
      mechanicEvidence,
    };
  }

  const percentValues = values.filter(isPercentFormulaValue);
  if (["owner", "party"].includes(scope) && percentValues.length === 2) {
    const sorted = [...percentValues].sort((left, right) => (right.decimalValue ?? 0) - (left.decimalValue ?? 0));
    const chosen = scope === "owner" ? sorted[0] : sorted[1];
    return {
      status: "ready",
      strictReady: false,
      value: selectedValue(chosen, "inferred-owner-party-split"),
    };
  }

  if (PERCENT_COMPONENT_KEYS.has(componentKey) && percentValues.length === 1) {
    return {
      status: "ready",
      strictReady: false,
      value: selectedValue(percentValues[0], "single-formula-percent"),
    };
  }

  const formulaValues = values.filter((value) => value.formulaAmount && value.formulaValue !== null);
  if (formulaValues.length === 1) {
    return {
      status: "ready",
      strictReady: false,
      value: selectedValue(formulaValues[0], "single-formula-amount"),
    };
  }

  const runtimeSelectionBlocker = runtimeSelectionBlockerForHint(hint, values);
  return {
    status: "blocked",
    strictReady: false,
    blocker: runtimeSelectionBlocker ?? strict.blocker ?? "ambiguous-value",
    values,
  };
}

function evaluateRule(ruleId, rule, providerScope, indexes, runtimeSelection = null) {
  const blockers = [];
  const strictBlockers = [];
  const components = [];
  const formulaTermIds = asArray(rule?.formulaTermIds).map(String).filter(Boolean);
  const hints = asArray(rule?.componentValueHints);
  const descriptionText = sourceDescription(ruleId, indexes);

  if (!formulaTermIds.length) blockers.push("missing-formula-term");
  if (!hints.length) blockers.push(descriptionValueHintBlocker(descriptionText));

  for (const hint of hints) {
    const componentKey = String(hint?.componentKey ?? "unknown");
    const resolved = resolveHint(hint, providerScope, descriptionText, runtimeSelection);
    const strict = strictResolveHint(hint, providerScope);
    if (strict.status !== "ready") {
      const strictBlocker = runtimeSelectionBlockerForHint(hint, asArray(strict.values).length ? strict.values : undefined)
        ?? strict.blocker
        ?? "blocked";
      strictBlockers.push(`component:${componentKey}:${strictBlocker}`);
    }

    if (resolved.status === "ready") {
      components.push({
        componentKey,
        label: hint?.label ?? componentKey,
        formulaTermIds: asArray(hint?.formulaTermIds).map(String).filter(Boolean),
        valueTextSource: hint?.valueTextSource,
        value: resolved.value,
        strictReady: Boolean(resolved.strictReady),
      });
    } else {
      const blocker = `component:${componentKey}:${resolved.blocker ?? "blocked"}`;
      blockers.push(blocker);
      components.push({
        componentKey,
        label: hint?.label ?? componentKey,
        formulaTermIds: asArray(hint?.formulaTermIds).map(String).filter(Boolean),
        valueTextSource: hint?.valueTextSource,
        blocker,
        candidateValues: asArray(resolved.values).map((value) => ({
          scope: value.scope,
          rawText: value.rawText,
          unit: value.unit,
          value: value.value,
          decimalValue: value.decimalValue,
          formulaAmount: value.formulaAmount,
          tier: value.tier,
          tierKind: value.tierKind,
        })),
        mechanicEvidence: resolved.mechanicEvidence,
      });
    }
  }

  const ready = blockers.length === 0;
  const strictReady = ready && strictBlockers.length === 0 && components.every((component) => component.strictReady);
  return {
    ready,
    strictReady,
    newlyReadyByResolver: ready && !strictReady,
    blockers: uniqueSortedStrings(blockers),
    strictBlockers: uniqueSortedStrings(strictBlockers),
    formulaTermIds,
    componentCount: hints.length,
    resolvedComponentCount: components.filter((component) => component.value).length,
    components,
  };
}

function groupKey(ruleId, provider, runtimeSelection) {
  return `${ruleId}:${provider.scope}:${provider.providerName}:${runtimeSelection?.key ?? "no-runtime-selection"}`;
}

function uniqueModifierRecords(entries) {
  const records = new Map();
  for (const entry of entries) {
    const key = [
      entry.modifierBaseId ?? "?",
      entry.modifierSourceConfigId ?? "?",
      entry.modifierHostUid ?? "?",
      entry.modifierSourceUid ?? "?",
      entry.modifierLayer ?? "?",
      entry.modifierCount ?? "?",
    ].join(":");
    records.set(key, entry);
  }
  return [...records.values()];
}

function ensureRuleGroup(map, ruleId, rule, provider, indexes, runtimeSelection = null) {
  const key = groupKey(ruleId, provider, runtimeSelection);
  let row = map.get(key);
  if (!row) {
    const readiness = evaluateRule(ruleId, rule, provider.scope, indexes, runtimeSelection);
    row = {
      key,
      ruleId,
      sourceId: rule.sourceId ?? indexes.modifierRecount.sourcesById?.[ruleId]?.sourceId ?? null,
      sourceName: sourceLabel(ruleId, indexes),
      sourceDescription: sourceDescription(ruleId, indexes),
      providerName: provider.providerName,
      providerScope: provider.scope,
      runtimeSelection: runtimeSelection
        ? {
            type: runtimeSelection.type,
            factorBuffId: runtimeSelection.factorBuffId,
            itemConfigId: runtimeSelection.factorItem.itemConfigId,
            grade: runtimeSelection.factorItem.grade,
            itemUuid: runtimeSelection.factorItem.itemUuid,
            runtimeSource: runtimeSelection.factorItem.runtimeSource,
            valueTexts: asArray(runtimeSelection.factorGradeRow.valueTexts).map(String),
            description: runtimeSelection.factorGradeRow.cleanResolvedDescription ?? "",
          }
        : null,
      providerUids: new Set(),
      buffIds: new Set(),
      formulaTermIds: readiness.formulaTermIds,
      ready: readiness.ready,
      strictReady: readiness.strictReady,
      newlyReadyByResolver: readiness.newlyReadyByResolver,
      blockers: readiness.blockers,
      strictBlockers: readiness.strictBlockers,
      components: readiness.components,
      componentCount: readiness.componentCount,
      resolvedComponentCount: readiness.resolvedComponentCount,
      hits: 0,
      totalValue: 0,
      critHits: 0,
      luckyHits: 0,
      damageRows: new Map(),
      files: new Map(),
      activeModifierPairs: new Map(),
      stackLayers: new Map(),
      stackCounts: new Map(),
    };
    map.set(key, row);
  }
  return row;
}

function updateRuleGroup(row, link, provider, hit, fileLabel, indexes) {
  row.hits += 1;
  row.totalValue += numberValue(hit?.value);
  if (hit?.isCrit) row.critHits += 1;
  if (hit?.isLucky) row.luckyHits += 1;
  for (const buffId of link.buffIds) row.buffIds.add(buffId);
  for (const uid of [provider.sourceUid, provider.hostUid, provider.ownerUid]) {
    if (uid !== null && uid !== undefined) row.providerUids.add(uid);
  }
  const damageId = positiveNumber(hit?.damageId) ?? positiveNumber(hit?.skillKey);
  if (damageId !== null) addMapCount(row.damageRows, `${damageId} ${damageDisplayName(damageId, indexes)}`);
  for (const entry of uniqueModifierRecords(link.entries)) {
    const pair = `${entry.modifierBaseId ?? "?"}<-${entry.modifierSourceConfigId ?? "?"}`;
    addMapCount(row.activeModifierPairs, pair);
    if (entry.modifierLayer !== null && entry.modifierLayer !== undefined && entry.modifierLayer > 0) {
      addMapCount(row.stackLayers, `${pair} L${entry.modifierLayer}`);
    }
    if (entry.modifierCount !== null && entry.modifierCount !== undefined && entry.modifierCount >= 0) {
      addMapCount(row.stackCounts, `${pair} C${entry.modifierCount}`);
    }
  }
  addMapCount(row.files, fileLabel);
}

function finalizeRuleGroup(row) {
  return {
    ...row,
    providerUids: uniqueSortedNumbers([...row.providerUids]),
    buffIds: uniqueSortedNumbers([...row.buffIds]),
    damageRows: countMapToObject(row.damageRows, 10),
    files: countMapToObject(row.files, 5),
    activeModifierPairs: countMapToObject(row.activeModifierPairs, 10),
    stackLayers: countMapToObject(row.stackLayers, 10),
    stackCounts: countMapToObject(row.stackCounts, 10),
  };
}

function createGlobalState() {
  return {
    summary: {
      files: 0,
      formulaLinkObservations: 0,
      totalLinkedValue: 0,
      readyObservations: 0,
      readyLinkedValue: 0,
      strictReadyObservations: 0,
      strictReadyLinkedValue: 0,
      newlyReadyObservations: 0,
      newlyReadyLinkedValue: 0,
      unresolvedObservations: 0,
      unresolvedLinkedValue: 0,
      uniqueGroups: 0,
      readyGroups: 0,
      strictReadyGroups: 0,
      newlyReadyGroups: 0,
      unresolvedGroups: 0,
      blockerObservations: {},
      strictBlockerObservations: {},
      resolutionMethods: {},
      formulaTermObservations: {},
    },
    groups: new Map(),
  };
}

function analyzeFile(filePath, indexes, global) {
  const entity = readJson(filePath);
  const fileLabel = path.relative(repoRoot, filePath).replaceAll("\\", "/");
  const actorIndex = buildActorIndex(entity);
  const replayHits = asArray(entity.modifierReplayHits)
    .filter((hit) => !hit?.isHeal && numberValue(hit?.value) > 0);

  let formulaLinks = 0;
  let readyLinks = 0;
  let newlyReadyLinks = 0;
  let unresolvedLinks = 0;

  for (const hit of replayHits) {
    for (const link of activeRuleLinks(hit, indexes)) {
      const rule = indexes.contribution.sourcesByRuleId?.[link.ruleId];
      if (!rule || rule.contributionMode !== "formula-replay-candidate") continue;

      const provider = providerForLink(entity, actorIndex, link);
      const runtimeSelection = runtimeSelectionForRule(entity, rule, indexes);
      const row = ensureRuleGroup(global.groups, link.ruleId, rule, provider, indexes, runtimeSelection);
      updateRuleGroup(row, link, provider, hit, fileLabel, indexes);

      formulaLinks += 1;
      global.summary.formulaLinkObservations += 1;
      global.summary.totalLinkedValue += numberValue(hit?.value);
      for (const term of row.formulaTermIds) addCount(global.summary.formulaTermObservations, term);

      if (row.ready) {
        readyLinks += 1;
        global.summary.readyObservations += 1;
        global.summary.readyLinkedValue += numberValue(hit?.value);
      } else {
        unresolvedLinks += 1;
        global.summary.unresolvedObservations += 1;
        global.summary.unresolvedLinkedValue += numberValue(hit?.value);
      }

      if (row.strictReady) {
        global.summary.strictReadyObservations += 1;
        global.summary.strictReadyLinkedValue += numberValue(hit?.value);
      }
      if (row.newlyReadyByResolver) {
        newlyReadyLinks += 1;
        global.summary.newlyReadyObservations += 1;
        global.summary.newlyReadyLinkedValue += numberValue(hit?.value);
      }

      for (const blocker of row.blockers) addCount(global.summary.blockerObservations, blocker);
      for (const blocker of row.strictBlockers) addCount(global.summary.strictBlockerObservations, blocker);
      for (const component of row.components) {
        if (component.value?.method) addCount(global.summary.resolutionMethods, component.value.method);
      }
    }
  }

  return {
    file: fileLabel,
    uid: entity.uid ?? null,
    name: entity.name ?? "",
    hits: replayHits.length,
    formulaLinks,
    readyLinks,
    newlyReadyLinks,
    unresolvedLinks,
  };
}

function finalizeReport(inputFiles, fileReports, global, options) {
  const groups = [...global.groups.values()].map(finalizeRuleGroup);
  const readyGroups = groups.filter((row) => row.ready);
  const strictReadyGroups = groups.filter((row) => row.strictReady);
  const newlyReadyGroups = groups.filter((row) => row.newlyReadyByResolver);
  const unresolvedGroups = groups.filter((row) => !row.ready);

  global.summary.uniqueGroups = groups.length;
  global.summary.readyGroups = readyGroups.length;
  global.summary.strictReadyGroups = strictReadyGroups.length;
  global.summary.newlyReadyGroups = newlyReadyGroups.length;
  global.summary.unresolvedGroups = unresolvedGroups.length;

  const sortByValue = (left, right) => right.totalValue - left.totalValue || right.hits - left.hits;

  return {
    generatedAt: new Date().toISOString(),
    inputs: inputFiles.map((filePath) => path.relative(repoRoot, filePath).replaceAll("\\", "/")),
    notes: [
      "This is a dev-only formula readiness audit. It does not calculate net contribution.",
      "Linked value is repeated per active formula source and can exceed player final damage.",
      "Resolver-inferred owner/party splits only apply to two percent component values: larger owner/self, smaller party/others.",
      "Stack/counter/duration numbers attached to stat components are blocked as mechanic values until a real stat amount is found.",
    ],
    summary: global.summary,
    files: fileReports,
    topReady: readyGroups.sort(sortByValue).slice(0, options.maxRows),
    topNewlyReady: newlyReadyGroups.sort(sortByValue).slice(0, options.maxRows),
    topUnresolved: unresolvedGroups.sort(sortByValue).slice(0, options.maxRows),
    groups: groups.sort(sortByValue),
  };
}

function formatComponents(components) {
  return components
    .map((component) => {
      if (component.value) {
        const raw = component.value.rawText || component.value.formulaValue;
        return `${component.componentKey}=${raw} [${component.value.method}]`;
      }
      const evidence = component.mechanicEvidence
        ? ` (${component.mechanicEvidence.rawTexts.join(", ")}; ${component.mechanicEvidence.descriptionSignals.join("/") || "mechanic"})`
        : "";
      return `${component.componentKey}: ${component.blocker}${evidence}`;
    })
    .join("; ");
}

function formatRuntimeSelection(selection) {
  if (!selection) return "";
  if (selection.type === "factor-grade") {
    const values = asArray(selection.valueTexts).join(", ");
    const source = selection.runtimeSource ? ` ${selection.runtimeSource}` : "";
    return `factor:${selection.factorBuffId} item:${selection.itemConfigId} grade:${selection.grade ?? "?"}${source}${values ? ` (${values})` : ""}`;
  }
  return selection.type ?? "";
}

function formatBlockers(blockers) {
  return blockers?.length ? blockers.join("; ") : "";
}

function formatCellText(value, limit = 140) {
  const text = String(value ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function formatCountObject(object, limit = 8) {
  return Object.entries(object ?? {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key, count]) => `${key} (${formatNumber(count)})`)
    .join(", ");
}

function formatStackEvidence(row) {
  const parts = [];
  const layers = formatCountObject(row.stackLayers, 4);
  const counts = formatCountObject(row.stackCounts, 4);
  const pairs = formatCountObject(row.activeModifierPairs, 4);
  if (layers) parts.push(`layers: ${layers}`);
  if (counts) parts.push(`counts: ${counts}`);
  if (!parts.length && pairs) parts.push(`pairs: ${pairs}`);
  return parts.join("; ");
}

function writeMarkdown(report, outPath, options) {
  const summary = report.summary;
  const lines = [
    "# Formula Readiness Resolver Audit",
    "",
    "Dev-only formula readiness report. This does not change runtime totals or calculate net contribution.",
    "",
    "> Linked value is repeated per active formula source, so it is coverage pressure, not additive damage.",
    "",
    "## Summary",
    "",
    `- Files scanned: ${formatNumber(summary.files)}`,
    `- Formula link observations: ${formatNumber(summary.formulaLinkObservations)}`,
    `- Linked final-hit value: ${formatNumber(summary.totalLinkedValue)}`,
    `- Ready after resolver: ${formatNumber(summary.readyObservations)} observations (${formatPct(summary.readyObservations, summary.formulaLinkObservations)})`,
    `- Strict-ready before resolver: ${formatNumber(summary.strictReadyObservations)} observations (${formatPct(summary.strictReadyObservations, summary.formulaLinkObservations)})`,
    `- Newly ready by resolver: ${formatNumber(summary.newlyReadyObservations)} observations (${formatPct(summary.newlyReadyObservations, summary.formulaLinkObservations)})`,
    `- Still unresolved: ${formatNumber(summary.unresolvedObservations)} observations (${formatPct(summary.unresolvedObservations, summary.formulaLinkObservations)})`,
    `- Rule/provider groups: ${formatNumber(summary.uniqueGroups)} total, ${formatNumber(summary.readyGroups)} ready, ${formatNumber(summary.unresolvedGroups)} unresolved`,
    "",
    "## Resolver Methods",
    "",
    "| Method | Component observations |",
    "| --- | ---: |",
  ];

  for (const [method, count] of Object.entries(summary.resolutionMethods).sort((left, right) => right[1] - left[1])) {
    lines.push(`| ${method} | ${formatNumber(count)} |`);
  }

  lines.push("", "## Remaining Blockers", "", "| Blocker | Observations |", "| --- | ---: |");
  for (const [blocker, count] of Object.entries(summary.blockerObservations).sort((left, right) => right[1] - left[1])) {
    lines.push(`| ${blocker} | ${formatNumber(count)} |`);
  }
  if (!Object.keys(summary.blockerObservations).length) lines.push("| - | 0 |");

  lines.push("", "## Formula Terms", "", "| Term | Observations |", "| --- | ---: |");
  for (const [term, count] of Object.entries(summary.formulaTermObservations).sort((left, right) => right[1] - left[1])) {
    lines.push(`| ${term} | ${formatNumber(count)} |`);
  }

  lines.push(
    "",
    "## Top Newly Ready",
    "",
    "| Source | Provider | Hits | Linked value | Terms | Components | Runtime selection |",
    "| --- | --- | ---: | ---: | --- | --- | --- |",
  );
  if (report.topNewlyReady.length) {
    for (const row of report.topNewlyReady) {
      lines.push(
        `| ${row.sourceName} | ${row.providerName} (${row.providerScope}) | ${formatNumber(row.hits)} | ${formatNumber(row.totalValue)} | ${row.formulaTermIds.join(", ")} | ${formatComponents(row.components)} | ${formatRuntimeSelection(row.runtimeSelection)} |`,
      );
    }
  } else {
    lines.push("| - | - | 0 | 0 | - | - | - |");
  }

  lines.push(
    "",
    "## Top Ready",
    "",
    "| Source | Provider | Hits | Linked value | Terms | Components | Runtime selection |",
    "| --- | --- | ---: | ---: | --- | --- | --- |",
  );
  for (const row of report.topReady.slice(0, options.maxRows)) {
    lines.push(
      `| ${row.sourceName} | ${row.providerName} (${row.providerScope}) | ${formatNumber(row.hits)} | ${formatNumber(row.totalValue)} | ${row.formulaTermIds.join(", ")} | ${formatComponents(row.components)} | ${formatRuntimeSelection(row.runtimeSelection)} |`,
    );
  }

  lines.push(
    "",
    "## Top Unresolved",
    "",
    "| Source | Provider | Hits | Linked value | Terms | Blockers | Components | Runtime selection | Description | Stack evidence | Top damage rows |",
    "| --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |",
  );
  if (report.topUnresolved.length) {
    for (const row of report.topUnresolved) {
      lines.push(
        `| ${row.sourceName} | ${row.providerName} (${row.providerScope}) | ${formatNumber(row.hits)} | ${formatNumber(row.totalValue)} | ${row.formulaTermIds.join(", ")} | ${formatBlockers(row.blockers)} | ${formatComponents(row.components)} | ${formatRuntimeSelection(row.runtimeSelection)} | ${formatCellText(row.sourceDescription)} | ${formatStackEvidence(row)} | ${formatCountObject(row.damageRows, 5)} |`,
      );
    }
  } else {
    lines.push("| - | - | 0 | 0 | - | - | - | - | - | - | - |");
  }

  lines.push(
    "",
    "## Per File",
    "",
    "| File | Player | Hits | Formula links | Ready | Newly ready | Unresolved |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const file of report.files) {
    lines.push(
      `| ${file.file} | ${file.name || file.uid || ""} | ${formatNumber(file.hits)} | ${formatNumber(file.formulaLinks)} | ${formatNumber(file.readyLinks)} | ${formatNumber(file.newlyReadyLinks)} | ${formatNumber(file.unresolvedLinks)} |`,
    );
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

  const indexes = buildIndexes();
  const global = createGlobalState();
  global.summary.files = inputFiles.length;
  const fileReports = inputFiles.map((filePath) => analyzeFile(filePath, indexes, global));
  const report = finalizeReport(inputFiles, fileReports, global, options);

  const outJson = resolveRepoPath(options.outJson);
  const outMd = resolveRepoPath(options.outMd);
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`);
  writeMarkdown(report, outMd, options);

  console.log(`Wrote ${path.relative(repoRoot, outJson)}`);
  console.log(`Wrote ${path.relative(repoRoot, outMd)}`);
  console.log(`Formula links: ${formatNumber(report.summary.formulaLinkObservations)}`);
  console.log(`Ready after resolver: ${formatNumber(report.summary.readyObservations)} (${formatPct(report.summary.readyObservations, report.summary.formulaLinkObservations)})`);
  console.log(`Newly ready by resolver: ${formatNumber(report.summary.newlyReadyObservations)} (${formatPct(report.summary.newlyReadyObservations, report.summary.formulaLinkObservations)})`);
  console.log(`Still unresolved: ${formatNumber(report.summary.unresolvedObservations)} (${formatPct(report.summary.unresolvedObservations, report.summary.formulaLinkObservations)})`);
}

main();
