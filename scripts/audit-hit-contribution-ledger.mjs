#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const DEFAULT_LATEST_INPUTS = 3;
const DEFAULT_MAX_ROWS = 40;
const DEFAULT_MAX_HIT_ROWS = 10000;
const DEFAULT_OUT_JSON = "DEV_exports/hit-contribution-ledger-audit.json";
const DEFAULT_OUT_MD = "DEV_exports/hit-contribution-ledger-audit.md";

const PROOF_LEVELS = [
  "exact-produced-damage",
  "formula-candidate",
  "active-only",
  "unknown-active",
  "no-evidence",
];

function parseArgs(argv) {
  const options = {
    inputs: [],
    latest: DEFAULT_LATEST_INPUTS,
    outJson: DEFAULT_OUT_JSON,
    outMd: DEFAULT_OUT_MD,
    maxRows: DEFAULT_MAX_ROWS,
    maxHitRows: DEFAULT_MAX_HIT_ROWS,
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
    } else if (arg === "--max-hit-rows") {
      options.maxHitRows = Math.max(0, Number(argv[++index]) || 0);
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
  console.log(`Usage: node scripts/audit-hit-contribution-ledger.mjs [options]

Options:
  --input <path>          Add a specific modifier-entity export. Repeatable.
  --latest <count>        Use latest DEV_exports/modifier-entity-*.json files when no inputs are provided. Default: ${DEFAULT_LATEST_INPUTS}
  --out-json <path>       JSON report path. Default: ${DEFAULT_OUT_JSON}
  --out-md <path>         Markdown report path. Default: ${DEFAULT_OUT_MD}
  --max-rows <count>      Max Markdown rows per table. Default: ${DEFAULT_MAX_ROWS}
  --max-hit-rows <count>  Max per-hit ledger rows in JSON. Use 0 to omit. Default: ${DEFAULT_MAX_HIT_ROWS}
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

function uniqueSortedNumbers(values) {
  return [...new Set(values.map(Number).filter(Number.isFinite))].sort((left, right) => left - right);
}

function topEntries(map, limit, mapper = (value) => value) {
  return [...map.values()]
    .map(mapper)
    .sort((left, right) => {
      const valueDelta = (right.totalValue ?? 0) - (left.totalValue ?? 0);
      if (valueDelta !== 0) return valueDelta;
      return (right.hits ?? 0) - (left.hits ?? 0);
    })
    .slice(0, limit);
}

function addMapCount(map, key, amount = 1) {
  if (!key) return;
  map.set(String(key), (map.get(String(key)) ?? 0) + amount);
}

function addToSetMap(map, key, value) {
  if (!key || value === null || value === undefined || value === "") return;
  const stringKey = String(key);
  if (!map.has(stringKey)) map.set(stringKey, new Set());
  map.get(stringKey).add(String(value));
}

function setMapToObject(map, limit = 12) {
  return Object.fromEntries(
    [...map.entries()].map(([key, set]) => [key, [...set].sort((left, right) => left.localeCompare(right)).slice(0, limit)]),
  );
}

function countMapToObject(map, limit = 12) {
  return Object.fromEntries(
    [...map.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit),
  );
}

function buildIndexes() {
  const recount = readGenerated("RecountTable.json");
  const modifierRecount = readGenerated("ModifierRecountTable.json");
  const contribution = readGenerated("ModifierContributionRuntime.json");
  const display = readGenerated("ModifierDisplayTable.json");
  const skillDetails = readGenerated("SkillBreakdownDetails.json");
  const damageRows = readGenerated("DamageAttrIdName.json");

  const recountByDamageId = new Map();
  for (const [recountId, row] of Object.entries(asObject(recount))) {
    for (const damageId of asArray(row?.DamageId)) {
      const key = String(damageId);
      if (!recountByDamageId.has(key)) recountByDamageId.set(key, []);
      recountByDamageId.get(key).push({
        recountId: Number(recountId),
        name: localizedName(row?.Names, row?.Name ?? row?.RecountName ?? `recount:${recountId}`),
      });
    }
  }

  const ruleIdsByBuffId = new Map();
  for (const [buffId, ruleIds] of Object.entries(asObject(modifierRecount.byBuffId))) {
    ruleIdsByBuffId.set(String(buffId), asArray(ruleIds).map(String));
  }

  return {
    recount,
    modifierRecount,
    contribution,
    display,
    skillDetails,
    damageRows,
    recountByDamageId,
    ruleIdsByBuffId,
    ignoredBuffIds: new Set(asArray(modifierRecount.ignoredBuffIds).map(Number).filter(Number.isFinite)),
  };
}

function damageDisplayName(damageId, indexes) {
  const key = String(damageId);
  const detail = asObject(indexes.skillDetails[key]);
  const damage = asObject(indexes.damageRows[key]);
  const recountParents = indexes.recountByDamageId.get(key) ?? [];
  return (
    localizedName(detail.names)
    || localizedName(detail.damageNames)
    || localizedName(damage.Names)
    || damage.Name
    || damage.NameDesign
    || recountParents[0]?.name
    || `damage:${key}`
  );
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

function activeModifierEntries(hit) {
  const entries = [];
  for (const modifier of asArray(hit?.activeModifiers)) {
    const modifierBaseId = positiveNumber(modifier?.modifierBaseId);
    const modifierSourceConfigId = positiveNumber(modifier?.modifierSourceConfigId);
    const modifierHostUid = positiveNumber(modifier?.modifierHostUid);
    const modifierSourceUid = positiveNumber(modifier?.modifierSourceUid);
    const modifierLayer = finiteNumber(modifier?.modifierLayer);
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
      });
    }
  }
  return entries;
}

function activeRuleLinks(hit, indexes) {
  const byRule = new Map();
  const unmapped = new Map();

  for (const entry of activeModifierEntries(hit)) {
    const ruleIds = indexes.ruleIdsByBuffId.get(String(entry.buffId)) ?? [];
    if (!ruleIds.length) {
      if (!indexes.ignoredBuffIds.has(entry.buffId)) {
        const key = `${entry.buffId}:${entry.field}`;
        let row = unmapped.get(key);
        if (!row) {
          row = {
            buffId: entry.buffId,
            field: entry.field,
            entries: [],
          };
          unmapped.set(key, row);
        }
        row.entries.push(entry);
      }
      continue;
    }

    for (const ruleId of ruleIds) {
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

  const links = [...byRule.values()].map((link) => ({
    ...link,
    buffIds: [...link.buffIds].sort((left, right) => left - right),
  }));
  return {
    links,
    unmapped: [...unmapped.values()],
  };
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

function providerForLink(entity, actorIndex, link, hit) {
  const sourceUid = sourceUidForLink(link);
  const hostUid = hostUidForLink(link);
  const actorUid = positiveNumber(hit?.originalAttackerUid) ?? positiveNumber(hit?.attackerUid) ?? positiveNumber(entity.uid);
  const sourceActor = sourceUid !== null ? actorIndex.get(sourceUid) : undefined;
  const hostActor = hostUid !== null ? actorIndex.get(hostUid) : undefined;
  const ownerUid = positiveNumber(sourceActor?.ownerUid) ?? positiveNumber(hostActor?.ownerUid) ?? sourceUid;
  const ownerName = sourceActor?.ownerName ?? hostActor?.ownerName;
  const providerName = ownerName
    ?? sourceActor?.name
    ?? hostActor?.name
    ?? (sourceUid === entity.uid ? entity.name : null)
    ?? (sourceUid !== null ? `#${sourceUid}` : "unknown");

  const isOwner = sourceUid === actorUid || ownerUid === actorUid || sourceUid === entity.uid || ownerUid === entity.uid;
  return {
    sourceUid,
    hostUid,
    ownerUid,
    providerName,
    scope: isOwner ? "owner" : "party",
  };
}

function targetIdsForRule(ruleId, indexes) {
  const source = indexes.modifierRecount.sourcesById?.[ruleId] ?? {};
  return {
    targetDamageIds: new Set(asArray(source.targetDamageIds).map(Number).filter(Number.isFinite)),
    targetRecountIds: new Set(asArray(source.targetRecountIds).map(Number).filter(Number.isFinite)),
  };
}

function recountParentsForHit(hit, indexes) {
  const parents = [];
  for (const id of uniqueSortedNumbers([hit?.damageId, hit?.skillKey])) {
    for (const parent of indexes.recountByDamageId.get(String(id)) ?? []) {
      if (!parents.some((candidate) => candidate.recountId === parent.recountId)) {
        parents.push(parent);
      }
    }
  }
  return parents;
}

function ruleMatchesHitTargets(ruleId, hit, recountParents, indexes) {
  const { targetDamageIds, targetRecountIds } = targetIdsForRule(ruleId, indexes);
  const candidateDamageIds = uniqueSortedNumbers([hit?.damageId, hit?.skillKey, hit?.ownerId]);
  const damageMatch = candidateDamageIds.some((id) => targetDamageIds.has(id));
  const recountMatch = recountParents.some((parent) => targetRecountIds.has(parent.recountId));
  return {
    hasStaticTargets: targetDamageIds.size > 0 || targetRecountIds.size > 0,
    damageMatch,
    recountMatch,
    targetMatch: damageMatch || recountMatch,
  };
}

function selectHintValue(hint, selectedScope) {
  const values = asArray(hint?.values);
  const directValue = finiteNumber(hint?.decimalValue);
  const normalizedValues = values.length
    ? values
    : directValue !== null
      ? [{ scope: hint?.valueScope ?? hint?.scope ?? "global", decimalValue: directValue, rawText: hint?.rawText ?? "" }]
      : [];
  if (!normalizedValues.length) return { status: "missing-value" };

  const scope = String(selectedScope ?? "").toLowerCase();
  const exact = normalizedValues.filter((value) => String(value.scope ?? "").toLowerCase() === scope);
  if (exact.length === 1) return { status: "ok", value: exact[0] };
  const global = normalizedValues.filter((value) => ["", "global", "all"].includes(String(value.scope ?? "").toLowerCase()));
  if (global.length === 1) return { status: "ok", value: global[0] };
  if (normalizedValues.length === 1) return { status: "ok", value: normalizedValues[0] };
  return { status: "ambiguous-value", values: normalizedValues };
}

function formulaReadiness(rule, provider) {
  const blockers = [];
  const termIds = asArray(rule?.formulaTermIds).map(String).filter(Boolean);
  const hints = asArray(rule?.componentValueHints);
  if (!termIds.length) blockers.push("missing-formula-term");
  if (!hints.length) blockers.push("missing-component-value-hints");

  let resolvedHints = 0;
  for (const hint of hints) {
    const selected = selectHintValue(hint, provider.scope);
    if (selected.status === "ok" && finiteNumber(selected.value?.decimalValue) !== null) {
      resolvedHints += 1;
    } else {
      blockers.push(`component:${hint?.componentKey ?? "unknown"}:${selected.status}`);
    }
  }

  return {
    termIds,
    componentHintCount: hints.length,
    resolvedHintCount: resolvedHints,
    blockers: [...new Set(blockers)],
  };
}

function classifyRuleLink(entity, actorIndex, hit, link, recountParents, indexes) {
  const ruleId = link.ruleId;
  const source = indexes.modifierRecount.sourcesById?.[ruleId] ?? {};
  const rule = indexes.contribution.sourcesByRuleId?.[ruleId] ?? {};
  const mode = rule.contributionMode ?? source.contributionMode ?? source.attributionModel?.status ?? "unknown";
  const tier = rule.contributionTier ?? source.contributionTier ?? source.attributionModel?.confidence ?? "unknown";
  const provider = providerForLink(entity, actorIndex, link, hit);
  const target = ruleMatchesHitTargets(ruleId, hit, recountParents, indexes);
  const formula = mode === "formula-replay-candidate" ? formulaReadiness(rule, provider) : null;

  let proofCategory = "active-only";
  if (mode === "exact-produced-damage" && tier === "exact" && target.targetMatch) {
    proofCategory = "exact-produced-damage";
  } else if (mode === "formula-replay-candidate" && (!target.hasStaticTargets || target.targetMatch)) {
    proofCategory = "formula-candidate";
  } else if (mode === "defensive" || tier === "non-damage") {
    proofCategory = "non-damage-active";
  } else if (target.hasStaticTargets && !target.targetMatch) {
    proofCategory = "active-target-mismatch";
  } else if (mode === "timing-only") {
    proofCategory = "timing-only";
  }

  return {
    ruleId,
    sourceId: rule.sourceId ?? source.sourceId ?? null,
    sourceName: sourceLabel(ruleId, indexes),
    sourceKind: source.sourceKind ?? null,
    mode,
    tier,
    proofCategory,
    buffIds: link.buffIds,
    provider,
    target,
    formula,
  };
}

function proofLevelForLinks(links, unmapped) {
  if (links.some((link) => link.proofCategory === "exact-produced-damage")) return "exact-produced-damage";
  if (links.some((link) => link.proofCategory === "formula-candidate")) return "formula-candidate";
  if (links.some((link) => ["active-only", "timing-only", "active-target-mismatch"].includes(link.proofCategory))) return "active-only";
  if (unmapped.length > 0) return "unknown-active";
  return "no-evidence";
}

function createProofStats() {
  return Object.fromEntries(PROOF_LEVELS.map((level) => [level, { hits: 0, totalValue: 0 }]));
}

function hitIdentity(fileReport, hit, index, indexes) {
  const damageId = positiveNumber(hit?.damageId) ?? positiveNumber(hit?.skillKey) ?? 0;
  const recountParents = recountParentsForHit(hit, indexes);
  return {
    file: fileReport.file,
    row: index,
    timestampMs: positiveNumber(hit?.timestampMs),
    damageId,
    skillKey: positiveNumber(hit?.skillKey),
    damageName: damageDisplayName(damageId, indexes),
    recountParents,
    value: numberValue(hit?.value),
    effectiveValue: numberValue(hit?.effectiveValue),
    hpLossValue: numberValue(hit?.hpLossValue),
    shieldLossValue: numberValue(hit?.shieldLossValue),
    isCrit: Boolean(hit?.isCrit),
    isLucky: Boolean(hit?.isLucky),
    attackerUid: positiveNumber(hit?.attackerUid),
    originalAttackerUid: positiveNumber(hit?.originalAttackerUid),
    targetUid: positiveNumber(hit?.targetUid),
    targetMonsterTypeId: positiveNumber(hit?.targetMonsterTypeId),
  };
}

function sourceSummaryKey(link) {
  return `${link.ruleId}:${link.proofCategory}:${link.provider.providerName}:${link.provider.scope}`;
}

function ensureSourceSummary(map, link) {
  const key = sourceSummaryKey(link);
  let row = map.get(key);
  if (!row) {
    row = {
      key,
      ruleId: link.ruleId,
      sourceId: link.sourceId,
      sourceName: link.sourceName,
      sourceKind: link.sourceKind,
      mode: link.mode,
      tier: link.tier,
      proofCategory: link.proofCategory,
      providerName: link.provider.providerName,
      providerScope: link.provider.scope,
      providerUids: new Set(),
      buffIds: new Set(),
      formulaTermIds: new Set(),
      formulaBlockers: new Map(),
      hits: 0,
      totalValue: 0,
      targetMatchHits: 0,
      targetMismatchHits: 0,
      critHits: 0,
      luckyHits: 0,
    };
    map.set(key, row);
  }
  return row;
}

function updateSourceSummary(map, link, hitInfo) {
  const row = ensureSourceSummary(map, link);
  row.hits += 1;
  row.totalValue += hitInfo.value;
  if (hitInfo.isCrit) row.critHits += 1;
  if (hitInfo.isLucky) row.luckyHits += 1;
  if (link.target.targetMatch) row.targetMatchHits += 1;
  if (link.target.hasStaticTargets && !link.target.targetMatch) row.targetMismatchHits += 1;
  for (const buffId of link.buffIds) row.buffIds.add(buffId);
  for (const uid of [link.provider.sourceUid, link.provider.hostUid, link.provider.ownerUid]) {
    if (uid !== null && uid !== undefined) row.providerUids.add(uid);
  }
  for (const term of link.formula?.termIds ?? []) row.formulaTermIds.add(term);
  for (const blocker of link.formula?.blockers ?? []) addMapCount(row.formulaBlockers, blocker);
}

function finalizeSourceSummary(row) {
  return {
    ...row,
    providerUids: uniqueSortedNumbers([...row.providerUids]),
    buffIds: uniqueSortedNumbers([...row.buffIds]),
    formulaTermIds: [...row.formulaTermIds].sort((left, right) => left.localeCompare(right)),
    formulaBlockers: countMapToObject(row.formulaBlockers),
  };
}

function damageSummaryKey(hitInfo) {
  return String(hitInfo.damageId);
}

function ensureDamageSummary(map, hitInfo) {
  const key = damageSummaryKey(hitInfo);
  let row = map.get(key);
  if (!row) {
    row = {
      damageId: hitInfo.damageId,
      damageName: hitInfo.damageName,
      recountParents: hitInfo.recountParents,
      hits: 0,
      totalValue: 0,
      critHits: 0,
      luckyHits: 0,
      proofLevels: createProofStats(),
      exactSources: new Map(),
      formulaSources: new Map(),
      unknownBuffIds: new Map(),
    };
    map.set(key, row);
  }
  return row;
}

function updateDamageSummary(map, hitInfo, proofLevel, links, unmapped) {
  const row = ensureDamageSummary(map, hitInfo);
  row.hits += 1;
  row.totalValue += hitInfo.value;
  if (hitInfo.isCrit) row.critHits += 1;
  if (hitInfo.isLucky) row.luckyHits += 1;
  row.proofLevels[proofLevel].hits += 1;
  row.proofLevels[proofLevel].totalValue += hitInfo.value;
  for (const link of links) {
    if (link.proofCategory === "exact-produced-damage") addMapCount(row.exactSources, link.sourceName);
    if (link.proofCategory === "formula-candidate") addMapCount(row.formulaSources, link.sourceName);
  }
  for (const unknown of unmapped) addMapCount(row.unknownBuffIds, `${unknown.buffId}:${unknown.field}`);
}

function finalizeDamageSummary(row) {
  return {
    ...row,
    exactSources: countMapToObject(row.exactSources, 8),
    formulaSources: countMapToObject(row.formulaSources, 8),
    unknownBuffIds: countMapToObject(row.unknownBuffIds, 8),
  };
}

function unknownSummaryKey(unknown) {
  return `${unknown.buffId}:${unknown.field}`;
}

function ensureUnknownSummary(map, unknown) {
  const key = unknownSummaryKey(unknown);
  let row = map.get(key);
  if (!row) {
    row = {
      key,
      buffId: unknown.buffId,
      field: unknown.field,
      hits: 0,
      totalValue: 0,
      damageIds: new Map(),
      providers: new Map(),
      sampleFiles: new Map(),
    };
    map.set(key, row);
  }
  return row;
}

function updateUnknownSummary(map, entity, actorIndex, unknown, hitInfo) {
  const row = ensureUnknownSummary(map, unknown);
  row.hits += 1;
  row.totalValue += hitInfo.value;
  addMapCount(row.damageIds, `${hitInfo.damageId} ${hitInfo.damageName}`);
  addMapCount(row.sampleFiles, hitInfo.file);
  for (const entry of unknown.entries) {
    const actor = entry.modifierSourceUid !== null ? actorIndex.get(entry.modifierSourceUid) : null;
    const name = actor?.ownerName
      ?? actor?.name
      ?? (entry.modifierSourceUid === entity.uid ? entity.name : null)
      ?? (entry.modifierSourceUid !== null ? `#${entry.modifierSourceUid}` : "unknown");
    addMapCount(row.providers, name);
  }
}

function finalizeUnknownSummary(row) {
  return {
    ...row,
    damageIds: countMapToObject(row.damageIds, 8),
    providers: countMapToObject(row.providers, 8),
    sampleFiles: countMapToObject(row.sampleFiles, 5),
  };
}

function analyzeFile(filePath, indexes, global, options) {
  const entity = readJson(filePath);
  const fileReport = {
    file: path.relative(repoRoot, filePath).replaceAll("\\", "/"),
    uid: entity.uid ?? null,
    name: entity.name ?? "",
    classId: entity.classId ?? null,
    classSpec: entity.classSpec ?? null,
  };
  const actorIndex = buildActorIndex(entity);
  const replayHits = asArray(entity.modifierReplayHits)
    .filter((hit) => !hit?.isHeal && numberValue(hit?.value) > 0);

  const proofLevels = createProofStats();
  const sourceSummaries = new Map();
  const damageSummaries = new Map();
  const unknownSummaries = new Map();
  let linkObservations = 0;

  for (const [index, hit] of replayHits.entries()) {
    const hitInfo = hitIdentity(fileReport, hit, index, indexes);
    const active = activeRuleLinks(hit, indexes);
    const links = active.links.map((link) => classifyRuleLink(entity, actorIndex, hit, link, hitInfo.recountParents, indexes));
    const proofLevel = proofLevelForLinks(links, active.unmapped);

    proofLevels[proofLevel].hits += 1;
    proofLevels[proofLevel].totalValue += hitInfo.value;
    global.summary.proofLevels[proofLevel].hits += 1;
    global.summary.proofLevels[proofLevel].totalValue += hitInfo.value;
    global.summary.hits += 1;
    global.summary.totalValue += hitInfo.value;
    if (hitInfo.isCrit) global.summary.critHits += 1;
    if (hitInfo.isLucky) global.summary.luckyHits += 1;

    for (const link of links) {
      linkObservations += 1;
      global.summary.linkProofCategories[link.proofCategory] = (global.summary.linkProofCategories[link.proofCategory] ?? 0) + 1;
      updateSourceSummary(sourceSummaries, link, hitInfo);
      updateSourceSummary(global.sourceSummaries, link, hitInfo);
      if (link.formula?.blockers.length) {
        for (const blocker of link.formula.blockers) {
          global.summary.formulaBlockers[blocker] = (global.summary.formulaBlockers[blocker] ?? 0) + 1;
        }
      }
    }

    for (const unknown of active.unmapped) {
      global.summary.unknownActiveModifierObservations += 1;
      updateUnknownSummary(unknownSummaries, entity, actorIndex, unknown, hitInfo);
      updateUnknownSummary(global.unknownSummaries, entity, actorIndex, unknown, hitInfo);
    }

    updateDamageSummary(damageSummaries, hitInfo, proofLevel, links, active.unmapped);
    updateDamageSummary(global.damageSummaries, hitInfo, proofLevel, links, active.unmapped);

    if (global.hitLedger.length < options.maxHitRows) {
      global.hitLedger.push({
        ...hitInfo,
        recountParents: hitInfo.recountParents,
        proofLevel,
        sourceLinkCounts: {
          exactProducedDamage: links.filter((link) => link.proofCategory === "exact-produced-damage").length,
          formulaCandidate: links.filter((link) => link.proofCategory === "formula-candidate").length,
          activeOnly: links.filter((link) => ["active-only", "timing-only", "active-target-mismatch"].includes(link.proofCategory)).length,
          nonDamageActive: links.filter((link) => link.proofCategory === "non-damage-active").length,
        },
        exactRuleIds: links
          .filter((link) => link.proofCategory === "exact-produced-damage")
          .map((link) => link.ruleId),
        formulaRuleIds: links
          .filter((link) => link.proofCategory === "formula-candidate")
          .map((link) => link.ruleId),
        activeOnlyRuleIds: links
          .filter((link) => ["active-only", "timing-only", "active-target-mismatch"].includes(link.proofCategory))
          .slice(0, 12)
          .map((link) => link.ruleId),
        sourceNames: [...new Set(links.map((link) => link.sourceName))].slice(0, 16),
        providers: [...new Set(links.map((link) => link.provider.providerName))].slice(0, 16),
        unknownActiveBuffIds: active.unmapped.map((unknown) => ({
          buffId: unknown.buffId,
          field: unknown.field,
        })),
      });
    }
  }

  return {
    ...fileReport,
    hits: replayHits.length,
    totalValue: replayHits.reduce((sum, hit) => sum + numberValue(hit.value), 0),
    linkObservations,
    proofLevels,
    topDamageRows: topEntries(damageSummaries, options.maxRows, finalizeDamageSummary),
    topSources: topEntries(sourceSummaries, options.maxRows, finalizeSourceSummary),
    topUnknownActiveModifiers: topEntries(unknownSummaries, options.maxRows, finalizeUnknownSummary),
  };
}

function createGlobalState() {
  return {
    summary: {
      files: 0,
      hits: 0,
      totalValue: 0,
      critHits: 0,
      luckyHits: 0,
      unknownActiveModifierObservations: 0,
      proofLevels: createProofStats(),
      linkProofCategories: {},
      formulaBlockers: {},
    },
    sourceSummaries: new Map(),
    damageSummaries: new Map(),
    unknownSummaries: new Map(),
    hitLedger: [],
  };
}

function finalizeReport(inputFiles, fileReports, global, options) {
  const summary = {
    ...global.summary,
    proofLevelPct: Object.fromEntries(
      Object.entries(global.summary.proofLevels).map(([level, row]) => [
        level,
        {
          hitPct: global.summary.hits > 0 ? row.hits / global.summary.hits : 0,
          valuePct: global.summary.totalValue > 0 ? row.totalValue / global.summary.totalValue : 0,
        },
      ]),
    ),
  };
  const exactSourceSummaries = [...global.sourceSummaries.values()]
    .filter((row) => row.proofCategory === "exact-produced-damage")
    .map(finalizeSourceSummary)
    .sort((left, right) => numberValue(right.totalValue) - numberValue(left.totalValue));

  return {
    generatedAt: new Date().toISOString(),
    inputs: inputFiles.map((filePath) => path.relative(repoRoot, filePath).replaceAll("\\", "/")),
    notes: [
      "This is a dev-only evidence ledger. It does not change runtime totals or contribution math.",
      "Per-hit proof level is the highest evidence lane observed on that final hit. It is not a net contribution amount.",
      "Source summary totalValue is link-weighted final hit value and can exceed player damage when multiple sources are active on the same hit.",
    ],
    summary,
    files: fileReports,
    exactSourceSummaries,
    topDamageRows: topEntries(global.damageSummaries, options.maxRows, finalizeDamageSummary),
    topSources: topEntries(global.sourceSummaries, options.maxRows, finalizeSourceSummary),
    topUnknownActiveModifiers: topEntries(global.unknownSummaries, options.maxRows, finalizeUnknownSummary),
    hitLedger: global.hitLedger,
  };
}

function proofLevelLabel(level) {
  switch (level) {
    case "exact-produced-damage":
      return "Exact produced damage";
    case "formula-candidate":
      return "Formula candidate";
    case "active-only":
      return "Active only";
    case "unknown-active":
      return "Unknown active";
    default:
      return "No evidence";
  }
}

function formatSourceNames(names) {
  return Object.entries(names ?? {})
    .map(([name, count]) => `${name} (${formatNumber(count)})`)
    .join(", ");
}

function writeMarkdown(report, outPath, options) {
  const lines = [
    "# Hit Contribution Ledger Audit",
    "",
    "Dev-only evidence report. This does not change runtime totals or modifier contribution math.",
    "",
    "> Value columns are covered final hit value, not proven net-added contribution. Source totals are link-weighted and can overlap.",
    "",
    "## Summary",
    "",
    `- Files scanned: ${formatNumber(report.summary.files)}`,
    `- Non-heal replay hits: ${formatNumber(report.summary.hits)}`,
    `- Final hit value scanned: ${formatNumber(report.summary.totalValue)}`,
    `- Crit hits: ${formatNumber(report.summary.critHits)} (${formatPct(report.summary.critHits, report.summary.hits)})`,
    `- Lucky hits: ${formatNumber(report.summary.luckyHits)} (${formatPct(report.summary.luckyHits, report.summary.hits)})`,
    `- Unknown active modifier observations: ${formatNumber(report.summary.unknownActiveModifierObservations)}`,
    "",
    "## Hit Proof Coverage",
    "",
    "| Proof level | Hits | Hit % | Covered value | Value % |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];

  for (const level of PROOF_LEVELS) {
    const row = report.summary.proofLevels[level];
    lines.push(
      `| ${proofLevelLabel(level)} | ${formatNumber(row.hits)} | ${formatPct(row.hits, report.summary.hits)} | ${formatNumber(row.totalValue)} | ${formatPct(row.totalValue, report.summary.totalValue)} |`,
    );
  }

  lines.push(
    "",
    "## Source Link Categories",
    "",
    "| Category | Link observations |",
    "| --- | ---: |",
  );
  for (const [category, count] of Object.entries(report.summary.linkProofCategories).sort((left, right) => right[1] - left[1])) {
    lines.push(`| ${category} | ${formatNumber(count)} |`);
  }

  lines.push("", "## Formula Blockers", "");
  const formulaBlockers = Object.entries(report.summary.formulaBlockers).sort((left, right) => right[1] - left[1]);
  if (formulaBlockers.length) {
    lines.push("| Blocker | Observations |", "| --- | ---: |");
    for (const [blocker, count] of formulaBlockers.slice(0, options.maxRows)) {
      lines.push(`| ${blocker} | ${formatNumber(count)} |`);
    }
  } else {
    lines.push("- None found for active formula candidates in this scan.");
  }

  lines.push(
    "",
    "## Top Damage Rows",
    "",
    "| Damage id | Name | Hits | Value | Top proof | Exact sources | Formula sources | Unknown active IDs |",
    "| ---: | --- | ---: | ---: | --- | --- | --- | --- |",
  );
  for (const row of report.topDamageRows) {
    const topProof = [...Object.entries(row.proofLevels)]
      .sort((left, right) => right[1].totalValue - left[1].totalValue)[0]?.[0] ?? "no-evidence";
    lines.push(
      `| ${row.damageId} | ${row.damageName} | ${formatNumber(row.hits)} | ${formatNumber(row.totalValue)} | ${proofLevelLabel(topProof)} | ${formatSourceNames(row.exactSources)} | ${formatSourceNames(row.formulaSources)} | ${formatSourceNames(row.unknownBuffIds)} |`,
    );
  }

  lines.push(
    "",
    "## Top Sources",
    "",
    "| Source | Provider | Proof category | Mode | Hits | Linked value | Target match | Formula terms | Formula blockers |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |",
  );
  for (const row of report.topSources) {
    lines.push(
      `| ${row.sourceName} | ${row.providerName} (${row.providerScope}) | ${row.proofCategory} | ${row.mode} | ${formatNumber(row.hits)} | ${formatNumber(row.totalValue)} | ${formatNumber(row.targetMatchHits)} | ${row.formulaTermIds.join(", ")} | ${formatSourceNames(row.formulaBlockers)} |`,
    );
  }

  lines.push(
    "",
    "## Top Unknown Active Modifier IDs",
    "",
    "| Buff id | Field | Hits | Linked value | Providers | Damage rows |",
    "| ---: | --- | ---: | ---: | --- | --- |",
  );
  if (report.topUnknownActiveModifiers.length) {
    for (const row of report.topUnknownActiveModifiers) {
      lines.push(
        `| ${row.buffId} | ${row.field} | ${formatNumber(row.hits)} | ${formatNumber(row.totalValue)} | ${formatSourceNames(row.providers)} | ${formatSourceNames(row.damageIds)} |`,
      );
    }
  } else {
    lines.push("| - | - | 0 | 0 | - | - |");
  }

  lines.push(
    "",
    "## Per File",
    "",
    "| File | Player | Hits | Value | Exact | Formula candidate | Active only | Unknown active | No evidence |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const file of report.files) {
    lines.push(
      `| ${file.file} | ${file.name || file.uid || ""} | ${formatNumber(file.hits)} | ${formatNumber(file.totalValue)} | ${formatNumber(file.proofLevels["exact-produced-damage"].hits)} | ${formatNumber(file.proofLevels["formula-candidate"].hits)} | ${formatNumber(file.proofLevels["active-only"].hits)} | ${formatNumber(file.proofLevels["unknown-active"].hits)} | ${formatNumber(file.proofLevels["no-evidence"].hits)} |`,
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
  const fileReports = inputFiles.map((filePath) => analyzeFile(filePath, indexes, global, options));
  const report = finalizeReport(inputFiles, fileReports, global, options);

  const outJson = resolveRepoPath(options.outJson);
  const outMd = resolveRepoPath(options.outMd);
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`);
  writeMarkdown(report, outMd, options);

  console.log(`Wrote ${path.relative(repoRoot, outJson)}`);
  console.log(`Wrote ${path.relative(repoRoot, outMd)}`);
  console.log(`Files scanned: ${report.summary.files}`);
  console.log(`Hits scanned: ${formatNumber(report.summary.hits)}`);
  for (const level of PROOF_LEVELS) {
    const row = report.summary.proofLevels[level];
    console.log(`${proofLevelLabel(level)}: ${formatNumber(row.hits)} hits (${formatPct(row.hits, report.summary.hits)})`);
  }
}

main();
