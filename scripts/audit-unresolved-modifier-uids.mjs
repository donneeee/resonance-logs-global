#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const generatedDir = path.join(root, "parser-data", "generated");
const exportsDir = path.join(root, "DEV_exports");
const outJsonPath = path.join(exportsDir, "unresolved-modifier-uids-audit.json");
const outMdPath = path.join(exportsDir, "unresolved-modifier-uids-audit.md");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function maybeReadJson(filePath, fallback) {
  return fs.existsSync(filePath) ? readJson(filePath) : fallback;
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function finitePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function sortedNumbers(values) {
  return [...new Set([...values].map(finitePositiveNumber).filter((value) => value !== null))]
    .sort((left, right) => left - right);
}

function addLimited(set, value, limit = 16) {
  const id = finitePositiveNumber(value);
  if (id !== null && set.size < limit) set.add(id);
}

function localizedNames(row) {
  const names = {};
  const raw = row?.Names ?? row?.names ?? row?.sourceNames ?? row?.DisplayNames ?? row?.DamageNames;
  if (raw && typeof raw === "object") {
    for (const [locale, value] of Object.entries(raw)) {
      const text = String(value ?? "").trim();
      if (text) names[locale] = text;
    }
  }
  for (const key of ["Name", "name", "DisplayName", "DamageName", "sourceName"]) {
    const text = String(row?.[key] ?? "").trim();
    if (text && !names.en) names.en = text;
  }
  for (const key of ["NameDesign", "DesignName"]) {
    const text = String(row?.[key] ?? "").trim();
    if (text && !names.design) names.design = text;
  }
  return names;
}

function compactNames(names) {
  const out = {};
  for (const locale of ["en", "zh-CN", "zh-TW", "ja", "ko-KR", "fr", "de", "es", "pt-BR", "th", "id", "design"]) {
    const text = String(names?.[locale] ?? "").trim();
    if (text) out[locale] = text;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isUnmappedPlaceholder(value) {
  const text = String(value ?? "").trim();
  return /^Unmapped Buff \d+$/i.test(text)
    || /^Buff \d+$/i.test(text)
    || /^Unknown Modifier$/i.test(text)
    || /^未映射增益\s*\d+$/i.test(text)
    || /^未對應增益\s*\d+$/i.test(text)
    || /^未マッピングバフ\s*\d+$/i.test(text)
    || /^매핑되지 않은 버프\s*\d+$/i.test(text)
    || /^Buff non mapp/i.test(text)
    || /^Nicht zugeordneter Buff/i.test(text)
    || /^Mejora sin asignar/i.test(text)
    || /^Bônus não mapeado/i.test(text)
    || /^Buff belum dipetakan/i.test(text);
}

function isRawLabel(value) {
  const text = String(value ?? "").trim();
  return !text
    || isUnmappedPlaceholder(text)
    || /^#\d+$/.test(text)
    || /^(?:buff-source|talent|season-talent-node|season-rogue-entry|phantom-factor):\d+/i.test(text);
}

function preferredLabel(entry) {
  const names = entry?.sourceNames ?? entry?.names ?? {};
  for (const value of [names.en, names["zh-CN"], names.design, entry?.sourceName, entry?.sourceId]) {
    const text = String(value ?? "").trim();
    if (text && !isUnmappedPlaceholder(text)) return text;
  }
  return String(entry?.sourceName ?? entry?.sourceId ?? "").trim();
}

function displayEntryForRule(ruleId, source, displayTable) {
  const display = displayTable.sourcesByRuleId?.[ruleId] ?? {};
  return {
    ...source,
    ...display,
    sourceNames: display.sourceNames ?? source.sourceNames,
    sourceName: display.sourceName ?? source.sourceName,
  };
}

function indexById(table, idField = "Id") {
  const out = new Map();
  for (const row of rows(table)) {
    const id = finitePositiveNumber(row?.[idField] ?? row?.id);
    if (id !== null && !out.has(id)) out.set(id, row);
  }
  return out;
}

function sourceIdsForBuff(effectSources, buffId) {
  const sourceIds = new Set(effectSources.buffIdToEffectSourceIds?.[String(buffId)] ?? []);
  const direct = effectSources.effectSourcesById?.[`buff-source:${buffId}`];
  if (direct) sourceIds.add(`buff-source:${buffId}`);
  return [...sourceIds].sort();
}

function gameEvidenceForBuffId(buffId, indexes) {
  const buff = indexes.buffNames.get(buffId);
  const skill = indexes.skillNames.get(buffId);
  const detail = indexes.skillDetails.get(buffId);
  const sourceIds = sourceIdsForBuff(indexes.effectSources, buffId);
  const effectSourceSamples = sourceIds.slice(0, 4)
    .map((sourceId) => indexes.effectSources.effectSourcesById?.[sourceId])
    .filter(Boolean)
    .map((source) => ({
      sourceId: source.sourceId,
      sourceKind: source.sourceKind,
      sourceType: source.sourceType,
      sourceEntityId: source.sourceEntityId,
      sourceName: source.sourceName,
      sourceNames: compactNames(source.sourceNames),
      relationshipKinds: source.targets?.map((target) => target.relationshipKind).filter(Boolean).slice(0, 4),
      targetDamageIds: sortedNumbers(source.targets?.map((target) => target.damageId ?? target.targetId) ?? []).slice(0, 8),
    }));
  return {
    buffName: buff ? compactNames(localizedNames(buff)) : undefined,
    skillName: skill ? compactNames(localizedNames(skill)) : undefined,
    skillDetailName: detail ? compactNames(localizedNames(detail)) : undefined,
    effectSourceIds: sourceIds.slice(0, 12),
    effectSourceSamples,
  };
}

function addUnresolvedRule(map, fixture, bucket, buffId, role, ruleId, source, displayTable, indexes) {
  const display = displayEntryForRule(ruleId, source, displayTable);
  const label = preferredLabel(display);
  const raw = isRawLabel(label)
    || Object.values(display.sourceNames ?? {}).some((value) => isUnmappedPlaceholder(value));
  if (!raw) return;

  const key = `${ruleId}|${buffId}`;
  let row = map.get(key);
  if (!row) {
    row = {
      ruleId,
      sourceId: source.sourceId,
      sourceKind: source.sourceKind,
      sourceType: source.sourceType,
      sourceEntityId: source.sourceEntityId,
      label,
      sourceNames: compactNames(display.sourceNames),
      buffId,
      roles: new Set(),
      fixtures: new Set(),
      hits: 0,
      totalValue: 0,
      effectiveTotalValue: 0,
      pairedBaseIds: new Set(),
      pairedSourceConfigIds: new Set(),
      sampleSkillIds: new Set(),
      sampleDamageIds: new Set(),
      evidence: gameEvidenceForBuffId(buffId, indexes),
    };
    map.set(key, row);
  }
  row.roles.add(role);
  row.fixtures.add(fixture);
  row.hits += Number(bucket.hits) || 0;
  row.totalValue += Number(bucket.totalValue) || 0;
  row.effectiveTotalValue += Number(bucket.effectiveTotalValue) || 0;
  addLimited(row.pairedBaseIds, bucket.modifierBaseId);
  addLimited(row.pairedSourceConfigIds, bucket.modifierSourceConfigId);
  addLimited(row.sampleSkillIds, bucket.skillKey);
  addLimited(row.sampleDamageIds, bucket.damageId);
}

function addUnmappedObserved(map, fixture, bucket, buffId, role, indexes) {
  const key = String(buffId);
  let row = map.get(key);
  if (!row) {
    row = {
      buffId,
      roles: new Set(),
      fixtures: new Set(),
      hits: 0,
      totalValue: 0,
      effectiveTotalValue: 0,
      pairedBaseIds: new Set(),
      pairedSourceConfigIds: new Set(),
      sampleSkillIds: new Set(),
      sampleDamageIds: new Set(),
      evidence: gameEvidenceForBuffId(buffId, indexes),
    };
    map.set(key, row);
  }
  row.roles.add(role);
  row.fixtures.add(fixture);
  row.hits += Number(bucket.hits) || 0;
  row.totalValue += Number(bucket.totalValue) || 0;
  row.effectiveTotalValue += Number(bucket.effectiveTotalValue) || 0;
  addLimited(row.pairedBaseIds, bucket.modifierBaseId);
  addLimited(row.pairedSourceConfigIds, bucket.modifierSourceConfigId);
  addLimited(row.sampleSkillIds, bucket.skillKey);
  addLimited(row.sampleDamageIds, bucket.damageId);
}

function addObservedPairedAlias(map, fixture, bucket, buffId, role, pairedKnownIds, indexes) {
  const key = String(buffId);
  let row = map.get(key);
  if (!row) {
    row = {
      buffId,
      roles: new Set(),
      fixtures: new Set(),
      hits: 0,
      totalValue: 0,
      effectiveTotalValue: 0,
      pairedKnownIds: new Set(),
      pairedBaseIds: new Set(),
      pairedSourceConfigIds: new Set(),
      sampleSkillIds: new Set(),
      sampleDamageIds: new Set(),
      evidence: gameEvidenceForBuffId(buffId, indexes),
    };
    map.set(key, row);
  }
  row.roles.add(role);
  row.fixtures.add(fixture);
  row.hits += Number(bucket.hits) || 0;
  row.totalValue += Number(bucket.totalValue) || 0;
  row.effectiveTotalValue += Number(bucket.effectiveTotalValue) || 0;
  for (const id of pairedKnownIds) addLimited(row.pairedKnownIds, id);
  addLimited(row.pairedBaseIds, bucket.modifierBaseId);
  addLimited(row.pairedSourceConfigIds, bucket.modifierSourceConfigId);
  addLimited(row.sampleSkillIds, bucket.skillKey);
  addLimited(row.sampleDamageIds, bucket.damageId);
}

function actorDisplayName(actor) {
  const uid = finitePositiveNumber(actor?.uid);
  const idLabel = uid === null ? "#?" : `#${uid}`;
  const owner = String(actor?.ownerName ?? "").trim();
  const name = String(actor?.name ?? "").trim();
  const displayName = owner && owner !== name ? owner : name;
  return displayName && displayName !== idLabel ? displayName : idLabel;
}

function addRawActor(map, fixture, bucket, actor) {
  const uid = finitePositiveNumber(bucket.modifierSourceUid ?? actor?.uid);
  if (uid === null) return;
  const displayName = actorDisplayName(actor ?? { uid });
  if (!/^#\d+$/.test(displayName)) return;
  let row = map.get(uid);
  if (!row) {
    row = {
      uid,
      displayName,
      entityType: actor?.entityType,
      ownerUid: actor?.ownerUid ?? null,
      ownerName: actor?.ownerName ?? null,
      fixtures: new Set(),
      hits: 0,
      totalValue: 0,
      sourceConfigIds: new Set(actor?.sourceConfigIds ?? []),
      baseIds: new Set(actor?.baseIds ?? []),
    };
    map.set(uid, row);
  }
  row.fixtures.add(fixture);
  row.hits += Number(bucket.hits) || 0;
  row.totalValue += Number(bucket.totalValue) || 0;
  addLimited(row.sourceConfigIds, bucket.modifierSourceConfigId);
  addLimited(row.baseIds, bucket.modifierBaseId);
}

function finishSummary(row) {
  return {
    ...row,
    roles: row.roles ? [...row.roles].sort() : undefined,
    fixtures: [...row.fixtures].sort(),
    pairedBaseIds: row.pairedBaseIds ? sortedNumbers(row.pairedBaseIds) : undefined,
    pairedSourceConfigIds: row.pairedSourceConfigIds ? sortedNumbers(row.pairedSourceConfigIds) : undefined,
    sampleSkillIds: row.sampleSkillIds ? sortedNumbers(row.sampleSkillIds) : undefined,
    sampleDamageIds: row.sampleDamageIds ? sortedNumbers(row.sampleDamageIds) : undefined,
    pairedKnownIds: row.pairedKnownIds ? sortedNumbers(row.pairedKnownIds) : undefined,
    sourceConfigIds: row.sourceConfigIds ? sortedNumbers(row.sourceConfigIds) : undefined,
    baseIds: row.baseIds ? sortedNumbers(row.baseIds) : undefined,
  };
}

function formatNumber(value) {
  return Math.round(Number(value) || 0).toLocaleString("en-US");
}

function evidenceLabel(evidence) {
  return evidence?.buffName?.en
    || evidence?.buffName?.design
    || evidence?.skillName?.en
    || evidence?.skillName?.design
    || evidence?.skillDetailName?.en
    || evidence?.skillDetailName?.design
    || evidence?.effectSourceSamples?.[0]?.sourceName
    || "";
}

function writeMarkdown(output) {
  const lines = [
    "# Unresolved Modifier UID Audit",
    "",
    `Generated: ${output.generatedAt}`,
    `Fixtures scanned: ${output.fixtures.length}`,
    "",
    "## Visible Raw Source Rules",
    "",
    "| Label | Source | Buff | Hits | Damage | Evidence | Fixtures |",
    "| --- | --- | ---: | ---: | ---: | --- | --- |",
  ];
  for (const row of output.visibleRawSourceRules.slice(0, 80)) {
    lines.push(`| ${row.label || row.sourceId} | ${row.sourceId} | ${row.buffId} | ${formatNumber(row.hits)} | ${formatNumber(row.totalValue)} | ${evidenceLabel(row.evidence) || "-"} | ${row.fixtures.join(", ")} |`);
  }
  lines.push("", "## Unmapped Observed Buff IDs", "", "| Buff | Roles | Hits | Damage | Paired base/source IDs | Evidence | Fixtures |", "| ---: | --- | ---: | ---: | --- | --- | --- |");
  for (const row of output.unmappedObservedBuffs.slice(0, 80)) {
    const paired = `${(row.pairedBaseIds ?? []).join(", ") || "-"} / ${(row.pairedSourceConfigIds ?? []).join(", ") || "-"}`;
    lines.push(`| ${row.buffId} | ${(row.roles ?? []).join(", ")} | ${formatNumber(row.hits)} | ${formatNumber(row.totalValue)} | ${paired} | ${evidenceLabel(row.evidence) || "-"} | ${row.fixtures.join(", ")} |`);
  }
  lines.push("", "## Observed Paired Aliases", "", "| Buff | Roles | Paired known IDs | Hits | Damage | Paired base/source IDs | Evidence | Fixtures |", "| ---: | --- | --- | ---: | ---: | --- | --- | --- |");
  for (const row of output.observedPairedAliases.slice(0, 80)) {
    const paired = `${(row.pairedBaseIds ?? []).join(", ") || "-"} / ${(row.pairedSourceConfigIds ?? []).join(", ") || "-"}`;
    lines.push(`| ${row.buffId} | ${(row.roles ?? []).join(", ")} | ${(row.pairedKnownIds ?? []).join(", ") || "-"} | ${formatNumber(row.hits)} | ${formatNumber(row.totalValue)} | ${paired} | ${evidenceLabel(row.evidence) || "-"} | ${row.fixtures.join(", ")} |`);
  }
  lines.push("", "## Raw Encounter Actors", "", "| Actor | Owner | Hits | Damage | Source IDs | Base IDs | Fixtures |", "| --- | --- | ---: | ---: | --- | --- | --- |");
  for (const row of output.rawEncounterActors.slice(0, 80)) {
    lines.push(`| #${row.uid} | ${row.ownerName || "-"} | ${formatNumber(row.hits)} | ${formatNumber(row.totalValue)} | ${(row.sourceConfigIds ?? []).join(", ") || "-"} | ${(row.baseIds ?? []).join(", ") || "-"} | ${row.fixtures.join(", ")} |`);
  }
  fs.writeFileSync(outMdPath, `${lines.join("\n")}\n`, "utf8");
}

const modifierRecount = readJson(path.join(generatedDir, "ModifierRecountTable.json"));
const modifierDisplay = readJson(path.join(generatedDir, "ModifierDisplayTable.json"));
const indexes = {
  buffNames: indexById(readJson(path.join(generatedDir, "BuffName.json"))),
  skillNames: indexById(readJson(path.join(generatedDir, "skillnames.json"))),
  skillDetails: indexById(readJson(path.join(generatedDir, "SkillBreakdownDetails.json"))),
  effectSources: maybeReadJson(path.join(generatedDir, "EffectSources.json"), {}),
};

const fixtureFiles = fs.readdirSync(exportsDir)
  .filter((name) => /^modifier-entity-\d+-\d+.*\.json$/.test(name))
  .sort((left, right) => left.localeCompare(right));

const visibleRawSourceRules = new Map();
const unmappedObservedBuffs = new Map();
const observedPairedAliases = new Map();
const rawEncounterActors = new Map();
const reportableBuffIds = new Set((modifierRecount.reportableBuffIds ?? []).map(Number).filter(Number.isFinite));
const ignoredBuffIds = new Set((modifierRecount.ignoredBuffIds ?? []).map(Number).filter(Number.isFinite));

function isKnownModifierBuffId(buffId) {
  if (buffId === null) return false;
  return (modifierRecount.byBuffId?.[String(buffId)] ?? []).length > 0
    || reportableBuffIds.has(buffId)
    || ignoredBuffIds.has(buffId);
}

for (const fixture of fixtureFiles) {
  const entity = readJson(path.join(exportsDir, fixture));
  const actorByUid = new Map((entity.modifierSourceActors ?? [])
    .map((actor) => [finitePositiveNumber(actor.uid), actor])
    .filter(([uid]) => uid !== null));

  for (const bucket of entity.modifierHitBuckets ?? []) {
    if (bucket.isHeal || (Number(bucket.hits) || 0) <= 0) continue;
    const ids = [
      ["base", finitePositiveNumber(bucket.modifierBaseId)],
      ["sourceConfig", finitePositiveNumber(bucket.modifierSourceConfigId)],
    ].filter(([, id]) => id !== null);
    const knownIds = ids
      .map(([, id]) => id)
      .filter((id) => isKnownModifierBuffId(id));
    for (const [role, buffId] of ids) {
      const ruleIds = modifierRecount.byBuffId?.[String(buffId)] ?? [];
      if (ruleIds.length === 0 && !reportableBuffIds.has(buffId) && !ignoredBuffIds.has(buffId)) {
        const pairedKnownIds = knownIds.filter((id) => id !== buffId);
        if (pairedKnownIds.length > 0) {
          addObservedPairedAlias(observedPairedAliases, fixture, bucket, buffId, role, pairedKnownIds, indexes);
        } else {
          addUnmappedObserved(unmappedObservedBuffs, fixture, bucket, buffId, role, indexes);
        }
      }
      for (const ruleId of ruleIds) {
        const source = modifierRecount.sourcesById?.[ruleId];
        if (!source) continue;
        addUnresolvedRule(visibleRawSourceRules, fixture, bucket, buffId, role, ruleId, source, modifierDisplay, indexes);
      }
    }

    const sourceUid = finitePositiveNumber(bucket.modifierSourceUid);
    if (sourceUid !== null) {
      addRawActor(rawEncounterActors, fixture, bucket, actorByUid.get(sourceUid));
    }
  }
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  fixtures: fixtureFiles,
  visibleRawSourceRules: [...visibleRawSourceRules.values()]
    .map(finishSummary)
    .sort((left, right) => right.hits - left.hits || right.totalValue - left.totalValue || left.label.localeCompare(right.label)),
  unmappedObservedBuffs: [...unmappedObservedBuffs.values()]
    .map(finishSummary)
    .sort((left, right) => right.hits - left.hits || right.totalValue - left.totalValue || left.buffId - right.buffId),
  observedPairedAliases: [...observedPairedAliases.values()]
    .map(finishSummary)
    .sort((left, right) => right.hits - left.hits || right.totalValue - left.totalValue || left.buffId - right.buffId),
  rawEncounterActors: [...rawEncounterActors.values()]
    .map(finishSummary)
    .sort((left, right) => right.hits - left.hits || right.totalValue - left.totalValue || left.uid - right.uid),
};

fs.mkdirSync(exportsDir, { recursive: true });
fs.writeFileSync(outJsonPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
writeMarkdown(output);

console.log(`Visible raw source rules: ${output.visibleRawSourceRules.length.toLocaleString()}`);
console.log(`Unmapped observed buff IDs: ${output.unmappedObservedBuffs.length.toLocaleString()}`);
console.log(`Observed paired alias IDs: ${output.observedPairedAliases.length.toLocaleString()}`);
console.log(`Raw encounter actors: ${output.rawEncounterActors.length.toLocaleString()}`);
console.log(`Wrote ${outJsonPath}`);
console.log(`Wrote ${outMdPath}`);
