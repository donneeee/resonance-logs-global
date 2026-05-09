#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const DEFAULT_LATEST_INPUTS = 5;
const DEFAULT_OUT_JSON = "DEV_exports/mirage-dream-scaling-audit.json";
const DEFAULT_OUT_MD = "DEV_exports/mirage-dream-scaling-audit.md";

const ATTR_ATTACK_POWER = 50;
const ATTR_ATTACK_SPEED = 11720;
const ATTR_PANEL_PHYSICAL_ATTACK = 11330;
const ATTR_PANEL_MAGIC_ATTACK = 11340;
const MIRAGE_TOOLTIP_CAP_PER_STACK = 50;
const ATTR_NAMES = new Map([
  [ATTR_ATTACK_POWER, "AttackPower"],
  [262, "PhysicalAttackLegacy"],
  [263, "MagicAttackLegacy"],
  [11010, "Strength"],
  [11020, "Intelligence"],
  [11030, "Agility"],
  [ATTR_PANEL_PHYSICAL_ATTACK, "PhysicalAttackPanel"],
  [ATTR_PANEL_MAGIC_ATTACK, "MagicAttackPanel"],
  [11710, "CritRatePanel"],
  [ATTR_ATTACK_SPEED, "AttackSpeed"],
  [11730, "CastSpeedPanel"],
  [11760, "CooldownReductionPanel"],
  [11780, "LuckyPanel"],
  [11930, "HastePanel"],
  [11940, "MasteryPanel"],
  [11950, "VersatilityPanel"],
  [11960, "CooldownAccelerationPanel"],
  [11970, "BlockPanel"],
  [12510, "CritDamagePanel"],
  [12530, "LuckyDamageMultiplierPanel"],
  [12540, "BlockDamageReductionPanel"],
  [10030, "AbilityScore"],
  [11440, "SeasonStrength"],
]);
const MIRAGE_ENGINE_BUFF = 3002610;
const MIRAGE_STACK_BUFF = 3002611;
const MIRAGE_LINKED_BUFFS = new Set([3002610, 3002611, 3002630, 3002671, 3002681]);
const CANDIDATE_SOURCE_BUFFS = new Map([
  [3002460, "Beauty of Refinement source buff"],
  [3002670, "Beauty of Refinement / Immortal Stance parent"],
  [3002671, "Immortal Stance max-stack child"],
  [3002680, "Immortal Stance / Grace parent"],
  [3002681, "Grace max-stack child"],
  [3002700, "Grace source buff"],
]);

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
  console.log(`Usage: node scripts/audit-mirage-dream-scaling.mjs [options]

Options:
  --input <path>      Add a specific modifier-entity export. Repeatable.
  --latest <count>    Use latest DEV_exports/modifier-entity-*.json files when no inputs are provided. Default: ${DEFAULT_LATEST_INPUTS}
  --out-json <path>   JSON report path. Default: ${DEFAULT_OUT_JSON}
  --out-md <path>     Markdown report path. Default: ${DEFAULT_OUT_MD}

Notes:
  This is a dev-only audit. It checks whether saved replay hits contain enough
  Mirage Dream stack transitions and attacker panel attack snapshots to prove
  the actual level-scaled per-stack value. It does not calculate contribution.
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

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function attrValue(attrs, attrId) {
  for (const attr of asArray(attrs)) {
    if (finiteNumber(attr?.attrId) !== attrId) continue;
    return finiteNumber(attr.valueInt ?? attr.valueFloat ?? attr.value);
  }
  return null;
}

function rawAttrValue(attr) {
  const value = attr?.valueInt ?? attr?.valueFloat ?? attr?.valueBool ?? attr?.value;
  return value === undefined ? null : value;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, pct) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((pct / 100) * (sorted.length - 1))));
  return sorted[index];
}

function formatNumber(value) {
  return value === null || value === undefined ? "n/a" : Number(value).toLocaleString("en-US");
}

function formatDecimal(value) {
  return value === null || value === undefined ? "n/a" : Number(value).toFixed(2);
}

function formatPercent(value) {
  return value === null || value === undefined ? "n/a" : `${Number(value).toFixed(2)}%`;
}

function buildCapComparison(observedPerStep) {
  if (observedPerStep === null || observedPerStep === undefined) return null;
  const rawIfBeautyRefinement10 = observedPerStep / 1.10;
  const rawIfGearAtk75 = observedPerStep / 1.075;
  const rawIfGearAtk55 = observedPerStep / 1.055;
  const rawIfBoth = observedPerStep / (1.10 * 1.055);
  const observedVsTooltipCap = observedPerStep / MIRAGE_TOOLTIP_CAP_PER_STACK;
  return {
    tooltipCapPerStack: MIRAGE_TOOLTIP_CAP_PER_STACK,
    observedPerStack: observedPerStep,
    observedVsTooltipCap,
    unexplainedPercentVsTooltipCap: (observedVsTooltipCap - 1) * 100,
    rawPerStackIfBeautyOfRefinement10: rawIfBeautyRefinement10,
    rawPerStackIfGearAtk75: rawIfGearAtk75,
    rawPerStackIfGearAtk55: rawIfGearAtk55,
    rawPerStackIfBoth: rawIfBoth,
    candidateHypotheses: [
      {
        label: "Beauty of Refinement",
        sourceId: "season-talent-node:1307",
        multiplier: 1.10,
        rawPerStack: rawIfBeautyRefinement10,
        proofStatus: "generated-source-candidate; selected/passive state still needs proof",
        note: "Generated game data says Refined ATK and Refined Armor +10%. This fits if Mirage's season-scaled raw stack value is below the 50 cap.",
      },
      {
        label: "gear ATK +7.5%",
        multiplier: 1.075,
        rawPerStack: rawIfGearAtk75,
        proofStatus: "player-hypothesis; not proven by this replay audit",
        note: "This is the cleanest math fit if the tooltip cap is exactly +50, but it needs proof from decoded equipped accessories.",
      },
      {
        label: "gear ATK +5.5%",
        multiplier: 1.055,
        rawPerStack: rawIfGearAtk55,
        proofStatus: "alternate player-hypothesis; not proven by this replay audit",
        note: "This is a weaker fit if +50 is a hard cap, because it implies a pre-multiplier stack value above 50.",
      },
      {
        label: "unknown +7.5% attack multiplier",
        multiplier: observedVsTooltipCap,
        rawPerStack: MIRAGE_TOOLTIP_CAP_PER_STACK,
        proofStatus: "math-only fit; source unknown",
        note: "This would make the observed value exactly match a capped +50 stack, but no source UID has been proven yet.",
      },
      {
        label: "Beauty of Refinement + gear ATK +5.5%",
        multiplier: 1.10 * 1.055,
        rawPerStack: rawIfBoth,
        proofStatus: "compound hypothesis; not proven",
        note: "Possible only if multiple attack multipliers stack before the panel value; this would put the raw Mirage stack well below the cap.",
      },
    ],
  };
}

function mirageState(hit) {
  let engineActive = false;
  let stackLayer = null;
  let stackCount = null;
  const records = [];

  for (const modifier of asArray(hit?.activeModifiers)) {
    const baseId = finiteNumber(modifier?.modifierBaseId);
    const sourceConfigId = finiteNumber(modifier?.modifierSourceConfigId);
    const layer = finiteNumber(modifier?.modifierLayer);
    const count = finiteNumber(modifier?.modifierCount);
    if (baseId === MIRAGE_ENGINE_BUFF || sourceConfigId === MIRAGE_ENGINE_BUFF) {
      engineActive = true;
    }
    if (baseId === MIRAGE_STACK_BUFF && layer !== null && layer > 0) {
      if (stackLayer === null || layer > stackLayer) {
        stackLayer = layer;
        stackCount = count;
      }
    }
    if (MIRAGE_LINKED_BUFFS.has(baseId) || MIRAGE_LINKED_BUFFS.has(sourceConfigId)) {
      records.push({
        baseId,
        sourceConfigId,
        layer,
        count,
      });
    }
  }

  const stateKey = stackLayer !== null && stackLayer > 0
    ? `L${stackLayer}`
    : engineActive
      ? "base-only"
      : "inactive";

  return {
    engineActive,
    stackLayer,
    stackCount,
    stateKey,
    records,
  };
}

function ensureGroup(map, key) {
  let row = map.get(key);
  if (!row) {
    row = {
      key,
      hits: 0,
      attackValues: [],
      attrValues: new Map(),
      damageIds: new Map(),
      files: new Map(),
      samples: [],
    };
    map.set(key, row);
  }
  return row;
}

function addCount(map, key, amount = 1) {
  const normalized = String(key ?? "").trim();
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) ?? 0) + amount);
}

function addAttrValue(row, attrId, value) {
  if (value === null || value === undefined) return;
  let values = row.attrValues.get(attrId);
  if (!values) {
    values = new Map();
    row.attrValues.set(attrId, values);
  }
  addCount(values, value);
}

function summarizeAttrValues(row) {
  return [...row.attrValues.entries()]
    .map(([attrId, values]) => {
      const entries = [...values.entries()]
        .sort((left, right) => right[1] - left[1] || Number(left[0]) - Number(right[0]))
        .map(([value, hits]) => ({ value, hits }));
      return {
        attrId,
        name: ATTR_NAMES.get(attrId) ?? `attr:${attrId}`,
        values: entries,
        uniqueValues: entries.length,
      };
    })
    .filter((row) =>
      row.uniqueValues > 1
      || row.attrId === ATTR_ATTACK_POWER
      || row.attrId === ATTR_ATTACK_SPEED
      || row.attrId === ATTR_PANEL_PHYSICAL_ATTACK
      || row.attrId === ATTR_PANEL_MAGIC_ATTACK
    )
    .sort((left, right) =>
      Number(right.uniqueValues > 1) - Number(left.uniqueValues > 1)
      || left.attrId - right.attrId
    );
}

function summarizeGroup(row) {
  return {
    state: row.key,
    hits: row.hits,
    attackPower: {
      min: row.attackValues.length ? Math.min(...row.attackValues) : null,
      p25: percentile(row.attackValues, 25),
      median: median(row.attackValues),
      p75: percentile(row.attackValues, 75),
      max: row.attackValues.length ? Math.max(...row.attackValues) : null,
    },
    attackerAttrs: summarizeAttrValues(row),
    topDamageIds: [...row.damageIds.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 8)
      .map(([damageId, hits]) => ({ damageId, hits })),
    files: Object.fromEntries([...row.files.entries()].sort((left, right) => left[0].localeCompare(right[0]))),
    samples: row.samples,
  };
}

function numericAttrEntries(state, attrId) {
  const attr = state.attackerAttrs.find((entry) => entry.attrId === attrId);
  if (!attr) return [];
  return attr.values
    .map((entry) => ({
      value: finiteNumber(entry.value),
      hits: finiteNumber(entry.hits) ?? 0,
    }))
    .filter((entry) => entry.value !== null);
}

function mergeAttrEntries(states, attrId) {
  const counts = new Map();
  for (const state of states) {
    for (const entry of numericAttrEntries(state, attrId)) {
      counts.set(entry.value, (counts.get(entry.value) ?? 0) + entry.hits);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([value, hits]) => ({ value, hits }));
}

function maxMirageLayer(states) {
  let maxLayer = null;
  for (const state of states) {
    const match = /^L(\d+)$/.exec(state.state);
    if (!match) continue;
    const layer = Number(match[1]);
    if (maxLayer === null || layer > maxLayer) maxLayer = layer;
  }
  return maxLayer;
}

function inferPanelAttackStacks(states) {
  const candidates = [ATTR_PANEL_PHYSICAL_ATTACK, ATTR_PANEL_MAGIC_ATTACK]
    .map((attrId) => ({
      attrId,
      attrName: ATTR_NAMES.get(attrId) ?? `attr:${attrId}`,
      values: mergeAttrEntries(states, attrId),
    }))
    .filter((candidate) => candidate.values.length > 1)
    .sort((left, right) =>
      right.values.length - left.values.length
      || right.values.reduce((sum, entry) => sum + entry.hits, 0) - left.values.reduce((sum, entry) => sum + entry.hits, 0)
      || left.attrId - right.attrId
    );

  const chosen = candidates[0];
  if (!chosen) return null;

  const baselineState = states.find((state) => state.state === "base-only")
    ?? states.find((state) => state.state === "inactive")
    ?? null;
  const baselineEntries = baselineState ? numericAttrEntries(baselineState, chosen.attrId) : [];
  const baseValue = baselineEntries.length
    ? Math.min(...baselineEntries.map((entry) => entry.value))
    : Math.min(...chosen.values.map((entry) => entry.value));
  const ladderValues = chosen.values.filter((entry) => entry.value >= baseValue);
  if (ladderValues.length <= 1) return null;

  const ladder = ladderValues.map((entry, index) => ({
    inferredStackStep: index,
    panelAttack: entry.value,
    deltaFromBase: entry.value - baseValue,
    deltaPerStep: index > 0 ? (entry.value - baseValue) / index : null,
    hits: entry.hits,
  }));
  const maxObservedStackSteps = ladder.length - 1;
  const maxValue = ladder[ladder.length - 1].panelAttack;
  const totalDelta = maxValue - baseValue;
  const averageDeltaPerObservedStep = maxObservedStackSteps > 0 ? totalDelta / maxObservedStackSteps : null;
  return {
    attrId: chosen.attrId,
    attrName: chosen.attrName,
    baselineState: baselineState?.state ?? null,
    baseValue,
    maxValue,
    maxActiveMirageLayer: maxMirageLayer(states),
    maxObservedStackSteps,
    totalDelta,
    averageDeltaPerObservedStep,
    capComparison: buildCapComparison(averageDeltaPerObservedStep),
    adjacentStepDeltas: ladder.slice(1).map((entry, index) => entry.panelAttack - ladder[index].panelAttack),
    ladder,
    note: "Stack step is inferred from the monotonic panel-attack ladder in this controlled parse; modifierLayer can stay pinned at the cap and is not always the live stack count.",
  };
}

function summarizeCandidateSourceBuffs(sortedHits) {
  const summaries = [...CANDIDATE_SOURCE_BUFFS.entries()].map(([buffId, label]) => ({
    buffId,
    label,
    hitCount: 0,
    modifierObservationCount: 0,
    firstTimestampMs: null,
    lastTimestampMs: null,
  }));
  const byId = new Map(summaries.map((row) => [row.buffId, row]));

  for (const row of sortedHits) {
    const matchedIds = new Set();
    for (const modifier of asArray(row.hit?.activeModifiers)) {
      for (const id of [finiteNumber(modifier?.modifierBaseId), finiteNumber(modifier?.modifierSourceConfigId)]) {
        const summary = byId.get(id);
        if (!summary) continue;
        summary.modifierObservationCount += 1;
        matchedIds.add(id);
      }
    }
    for (const id of matchedIds) {
      const summary = byId.get(id);
      summary.hitCount += 1;
      const timestampMs = finiteNumber(row.hit?.timestampMs);
      if (timestampMs !== null) {
        if (summary.firstTimestampMs === null || timestampMs < summary.firstTimestampMs) {
          summary.firstTimestampMs = timestampMs;
        }
        if (summary.lastTimestampMs === null || timestampMs > summary.lastTimestampMs) {
          summary.lastTimestampMs = timestampMs;
        }
      }
    }
  }

  return summaries;
}

function stateOrder(state) {
  if (state === "inactive") return -2;
  if (state === "base-only") return -1;
  const match = /^L(\d+)/.exec(state);
  return match ? Number(match[1]) : 9999;
}

function auditFile(filePath) {
  const entity = readJson(filePath);
  const fileName = path.basename(filePath);
  const groups = new Map();
  const transitions = [];
  const sortedHits = asArray(entity.modifierReplayHits)
    .filter((hit) => !hit?.isHeal)
    .map((hit) => {
      const attackPower = attrValue(hit.attackerAttrs, ATTR_ATTACK_POWER);
      const attackSpeed = attrValue(hit.attackerAttrs, ATTR_ATTACK_SPEED);
      const panelPhysicalAttack = attrValue(hit.attackerAttrs, ATTR_PANEL_PHYSICAL_ATTACK);
      const panelMagicAttack = attrValue(hit.attackerAttrs, ATTR_PANEL_MAGIC_ATTACK);
      return {
        hit,
        attackPower,
        attackSpeed,
        panelPhysicalAttack,
        panelMagicAttack,
        state: mirageState(hit),
      };
    })
    .filter((row) => row.attackPower !== null)
    .sort((left, right) => (finiteNumber(left.hit.timestampMs) ?? 0) - (finiteNumber(right.hit.timestampMs) ?? 0));

  let previous = null;
  for (const row of sortedHits) {
    const group = ensureGroup(groups, row.state.stateKey);
    group.hits += 1;
    group.attackValues.push(row.attackPower);
    for (const attr of asArray(row.hit.attackerAttrs)) {
      const attrId = finiteNumber(attr?.attrId);
      if (attrId === null) continue;
      addAttrValue(group, attrId, rawAttrValue(attr));
    }
    addCount(group.damageIds, row.hit.damageId);
    addCount(group.files, fileName);
    if (group.samples.length < 5) {
      group.samples.push({
        timestampMs: row.hit.timestampMs,
        damageId: row.hit.damageId,
        attackPower: row.attackPower,
        attackSpeed: row.attackSpeed,
        panelPhysicalAttack: row.panelPhysicalAttack,
        panelMagicAttack: row.panelMagicAttack,
        state: row.state.stateKey,
        records: row.state.records,
      });
    }

    if (previous && previous.state.stateKey !== row.state.stateKey) {
      transitions.push({
        from: previous.state.stateKey,
        to: row.state.stateKey,
        timestampMs: row.hit.timestampMs,
        elapsedMs: (finiteNumber(row.hit.timestampMs) ?? 0) - (finiteNumber(previous.hit.timestampMs) ?? 0),
        attackPowerBefore: previous.attackPower,
        attackPowerAfter: row.attackPower,
        delta: row.attackPower - previous.attackPower,
        attackSpeedBefore: previous.attackSpeed,
        attackSpeedAfter: row.attackSpeed,
        attackSpeedDelta: row.attackSpeed !== null && previous.attackSpeed !== null
          ? row.attackSpeed - previous.attackSpeed
          : null,
        panelPhysicalAttackBefore: previous.panelPhysicalAttack,
        panelPhysicalAttackAfter: row.panelPhysicalAttack,
        panelPhysicalAttackDelta: row.panelPhysicalAttack !== null && previous.panelPhysicalAttack !== null
          ? row.panelPhysicalAttack - previous.panelPhysicalAttack
          : null,
        panelMagicAttackBefore: previous.panelMagicAttack,
        panelMagicAttackAfter: row.panelMagicAttack,
        panelMagicAttackDelta: row.panelMagicAttack !== null && previous.panelMagicAttack !== null
          ? row.panelMagicAttack - previous.panelMagicAttack
          : null,
        beforeDamageId: previous.hit.damageId,
        afterDamageId: row.hit.damageId,
        toRecords: row.state.records,
      });
    }
    previous = row;
  }

  const summarizedGroups = [...groups.values()]
    .map(summarizeGroup)
    .sort((left, right) => stateOrder(left.state) - stateOrder(right.state));
  const baseline = summarizedGroups.find((row) => row.state === "base-only")
    ?? summarizedGroups.find((row) => row.state === "inactive")
    ?? null;
  const layerComparisons = baseline
    ? summarizedGroups
        .filter((row) => /^L\d+$/.test(row.state) && row.attackPower.median !== null)
        .map((row) => {
          const layer = Number(row.state.slice(1));
          const delta = row.attackPower.median - baseline.attackPower.median;
          return {
            state: row.state,
            layer,
            baselineState: baseline.state,
            medianDelta: delta,
            medianDeltaPerStack: layer > 0 ? delta / layer : null,
            note: "median comparison only; other buffs or skill-state changes can contaminate this unless a clean transition is present",
          };
        })
    : [];

  const cleanTransitions = transitions.filter((transition) =>
    transition.elapsedMs >= 0
    && transition.elapsedMs <= 2_000
    && (transition.from === "base-only" || /^L\d+$/.test(transition.from))
    && (transition.to === "base-only" || /^L\d+$/.test(transition.to))
  );
  const panelAttackInference = inferPanelAttackStacks(summarizedGroups);
  const candidateSourceBuffs = summarizeCandidateSourceBuffs(sortedHits);

  return {
    file: fileName,
    uid: entity.uid,
    name: entity.name,
    seasonStrength: entity.seasonStrength,
    abilityScore: entity.abilityScore,
    classId: entity.classId,
    classSpec: entity.classSpec,
    hitsWithAttackPower: sortedHits.length,
    states: summarizedGroups,
    panelAttackInference,
    candidateSourceBuffs,
    layerComparisons,
    transitions: transitions.slice(0, 80),
    cleanTransitions: cleanTransitions.slice(0, 40),
    proofStatus: panelAttackInference
      ? "panel-attack-stack-ladder"
      : cleanTransitions.length > 0
        ? "candidate-transition-deltas"
        : baseline && layerComparisons.length
          ? "median-only-baseline"
          : "insufficient-no-baseline-or-transition",
  };
}

function buildMarkdown(output) {
  const lines = [];
  lines.push("# Mirage Dream Scaling Audit");
  lines.push("");
  lines.push("Dev-only audit. This does not calculate contribution; it checks whether saved replay data can prove the actual Mirage Dream per-stack ATK value.");
  lines.push("");
  lines.push(`- Files: ${output.files.length}`);
  lines.push(`- Overall proof status: ${output.summary.proofStatus}`);
  lines.push(`- AttackPower attr id: ${ATTR_ATTACK_POWER}`);
  lines.push(`- Panel attack attr ids: ${ATTR_PANEL_PHYSICAL_ATTACK} physical / ${ATTR_PANEL_MAGIC_ATTACK} magic`);
  lines.push(`- Mirage stack carrier: ${MIRAGE_STACK_BUFF} layer, regardless of source config`);
  lines.push("");
  lines.push("## Interpretation");
  lines.push("");
  for (const note of output.summary.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const file of output.files) {
    lines.push(`## ${file.file}`);
    lines.push("");
    lines.push(`- Player: ${file.name} (${file.uid})`);
    lines.push(`- Season strength: ${file.seasonStrength ?? "n/a"}`);
    lines.push(`- Proof status: ${file.proofStatus}`);
    lines.push(`- Hits with stat snapshots: ${file.hitsWithAttackPower.toLocaleString("en-US")}`);
    lines.push("");
    lines.push("| State | Hits | AP min | AP median | AP max | Top damage ids |");
    lines.push("| --- | ---: | ---: | ---: | ---: | --- |");
    for (const state of file.states) {
      lines.push([
        state.state,
        state.hits.toLocaleString("en-US"),
        formatNumber(state.attackPower.min),
        formatNumber(state.attackPower.median),
        formatNumber(state.attackPower.max),
        state.topDamageIds.map((row) => `${row.damageId} (${row.hits})`).join(", "),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
    }
    if (file.layerComparisons.length) {
      lines.push("");
      lines.push("| Layer comparison | Baseline | Median AP delta | Median delta / stack |");
      lines.push("| --- | --- | ---: | ---: |");
      for (const row of file.layerComparisons) {
        lines.push(`| ${row.state} | ${row.baselineState} | ${formatNumber(row.medianDelta)} | ${formatDecimal(row.medianDeltaPerStack)} |`);
      }
    }
    if (file.panelAttackInference) {
      const inference = file.panelAttackInference;
      lines.push("");
      lines.push("### Panel Attack Stack Inference");
      lines.push("");
      lines.push(`- Attr: ${inference.attrName} (${inference.attrId})`);
      lines.push(`- Baseline state: ${inference.baselineState ?? "n/a"}`);
      lines.push(`- Base panel attack: ${formatNumber(inference.baseValue)}`);
      lines.push(`- Max panel attack: ${formatNumber(inference.maxValue)}`);
      lines.push(`- Max active Mirage layer in replay: ${formatNumber(inference.maxActiveMirageLayer)}`);
      lines.push(`- Observed stack steps: ${formatNumber(inference.maxObservedStackSteps)}`);
      lines.push(`- Total panel attack delta: ${formatNumber(inference.totalDelta)}`);
      lines.push(`- Average delta / observed step: ${formatDecimal(inference.averageDeltaPerObservedStep)}`);
      lines.push(`- Adjacent step deltas: ${inference.adjacentStepDeltas.map(formatNumber).join(", ")}`);
      lines.push(`- Note: ${inference.note}`);
      if (inference.capComparison) {
        const comparison = inference.capComparison;
        lines.push("");
        lines.push("### Cap / Multiplier Check");
        lines.push("");
        lines.push(`- Tooltip cap assumption: +${formatNumber(comparison.tooltipCapPerStack)} per stack`);
        lines.push(`- Observed average step: +${formatDecimal(comparison.observedPerStack)}`);
        lines.push(`- Observed / tooltip cap: ${formatDecimal(comparison.observedVsTooltipCap)}x (${formatPercent(comparison.unexplainedPercentVsTooltipCap)} over cap)`);
        lines.push(`- Raw stack value if Beauty of Refinement +10% applies: +${formatDecimal(comparison.rawPerStackIfBeautyOfRefinement10)}`);
        lines.push(`- Raw stack value if gear ATK +7.5% applies: +${formatDecimal(comparison.rawPerStackIfGearAtk75)}`);
        lines.push(`- Raw stack value if gear ATK +5.5% applies: +${formatDecimal(comparison.rawPerStackIfGearAtk55)}`);
        lines.push(`- Raw stack value if both +10% and +5.5% apply: +${formatDecimal(comparison.rawPerStackIfBoth)}`);
        lines.push("");
        lines.push("| Candidate | Multiplier | Implied raw stack | Status |");
        lines.push("| --- | ---: | ---: | --- |");
        for (const hypothesis of comparison.candidateHypotheses) {
          lines.push(`| ${hypothesis.label} | ${formatDecimal(hypothesis.multiplier)}x | +${formatDecimal(hypothesis.rawPerStack)} | ${hypothesis.proofStatus} |`);
        }
      }
      lines.push("");
      lines.push("| Inferred stack step | Panel attack | Delta from base | Delta / step | Hits |");
      lines.push("| ---: | ---: | ---: | ---: | ---: |");
      for (const row of inference.ladder) {
        lines.push(`| ${row.inferredStackStep} | ${formatNumber(row.panelAttack)} | ${formatNumber(row.deltaFromBase)} | ${formatDecimal(row.deltaPerStep)} | ${formatNumber(row.hits)} |`);
      }
    }
    if (file.candidateSourceBuffs?.length) {
      lines.push("");
      lines.push("### Candidate Source Buff Presence");
      lines.push("");
      lines.push("| Buff ID | Candidate | Hit count | Modifier observations | First timestamp | Last timestamp |");
      lines.push("| ---: | --- | ---: | ---: | ---: | ---: |");
      for (const row of file.candidateSourceBuffs) {
        lines.push(`| ${row.buffId} | ${row.label} | ${formatNumber(row.hitCount)} | ${formatNumber(row.modifierObservationCount)} | ${formatNumber(row.firstTimestampMs)} | ${formatNumber(row.lastTimestampMs)} |`);
      }
    }
    const varyingAttrs = file.states.flatMap((state) =>
      state.attackerAttrs
        .filter((attr) => attr.uniqueValues > 1)
        .map((attr) => ({ state: state.state, ...attr }))
    );
    if (varyingAttrs.length) {
      lines.push("");
      lines.push("| State | Varying attacker attr | Values |");
      lines.push("| --- | --- | --- |");
      for (const row of varyingAttrs.slice(0, 24)) {
        lines.push(`| ${row.state} | ${row.name} (${row.attrId}) | ${row.values.map((value) => `${value.value} (${value.hits})`).join(", ")} |`);
      }
    }
    if (file.cleanTransitions.length) {
      lines.push("");
      lines.push("| Candidate transition | Elapsed ms | AP before | AP after | AP delta | Physical panel before | Physical panel after | Physical panel delta | AttackSpeed delta |");
      lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
      for (const row of file.cleanTransitions.slice(0, 12)) {
        lines.push(`| ${row.from} -> ${row.to} | ${row.elapsedMs} | ${formatNumber(row.attackPowerBefore)} | ${formatNumber(row.attackPowerAfter)} | ${formatNumber(row.delta)} | ${formatNumber(row.panelPhysicalAttackBefore)} | ${formatNumber(row.panelPhysicalAttackAfter)} | ${formatNumber(row.panelPhysicalAttackDelta)} | ${formatNumber(row.attackSpeedDelta)} |`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputs = options.inputs.length
    ? options.inputs.map(resolveRepoPath)
    : latestModifierEntityExports(options.latest);
  if (inputs.length === 0) {
    throw new Error("No modifier entity exports found. Use --input <path>.");
  }

  const files = inputs.map(auditFile);
  const statuses = new Set(files.map((file) => file.proofStatus));
  const summary = {
    proofStatus: statuses.has("panel-attack-stack-ladder")
      ? "panel-attack-stack-ladder"
      : statuses.has("candidate-transition-deltas")
        ? "candidate-transition-deltas"
        : statuses.has("median-only-baseline")
          ? "median-only-baseline"
          : "insufficient-no-baseline-or-transition",
    notes: [],
  };
  if (summary.proofStatus === "panel-attack-stack-ladder") {
    summary.notes.push("At least one file contains a monotonic panel attack ladder while Mirage Dream is active. Use that panel-stat ladder as the controlled proof lane for the current per-stack value.");
    summary.notes.push("The observed panel ladder is not automatically the raw Mirage value. Compare it against tooltip cap and candidate attack multipliers before using it in formula replay.");
  } else if (summary.proofStatus === "candidate-transition-deltas") {
    summary.notes.push("At least one file contains a nearby Mirage stack-state transition with AttackPower snapshots. Inspect transition deltas before promoting a level-scaled value.");
  } else if (summary.proofStatus === "median-only-baseline") {
    summary.notes.push("A baseline and stack state exist, but only median comparisons are available. This can be contaminated by other buffs, so it is not proof by itself.");
  } else {
    summary.notes.push("Current exports do not contain a clean no-stack baseline or stack transition. A controlled sample is needed.");
  }
  summary.notes.push("A conclusive test should capture hits before Mirage Dream stacks and after stack changes in the same combat with minimal other ATK buffs.");
  summary.notes.push("Prefer panel Physical/Magic Attack lanes when present; generic AttackPower can stay flat even while the character-panel attack value changes.");

  const output = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    inputs: inputs.map((input) => path.relative(repoRoot, input).replaceAll("\\", "/")),
    summary,
    files,
  };

  const outJson = resolveRepoPath(options.outJson);
  const outMd = resolveRepoPath(options.outMd);
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.mkdirSync(path.dirname(outMd), { recursive: true });
  fs.writeFileSync(outJson, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  fs.writeFileSync(outMd, buildMarkdown(output), "utf8");
  console.log(`Wrote ${path.relative(repoRoot, outJson)}`);
  console.log(`Wrote ${path.relative(repoRoot, outMd)}`);
  console.log(`Proof status: ${summary.proofStatus}`);
}

main();
