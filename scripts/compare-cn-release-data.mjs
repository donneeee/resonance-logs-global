import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const betaRoot = path.resolve(projectRoot, "..");

const currentCnRoot = resolveReleaseRoot(
  path.resolve(process.argv[2] ?? path.join(betaRoot, "resonance-logs-cn-main_0.1.7")),
);
const previousCnRoot = resolveReleaseRoot(
  path.resolve(process.argv[3] ?? path.join(betaRoot, "resonance-logs-cn-main_0.1.6")),
);
const currentCnLabel = inferCnReleaseLabel(currentCnRoot);
const previousCnLabel = inferCnReleaseLabel(previousCnRoot);

const outputDir = path.join(projectRoot, "DEV_exports");
const markdownPath = path.join(outputDir, `cn-${currentCnLabel}-data-diff.md`);
const jsonPath = path.join(outputDir, `cn-${currentCnLabel}-data-diff.json`);

const DATASETS = [
  {
    name: "Buff names",
    category: "labels",
    globalPath: "parser-data/generated/BuffName.json",
    cnPath: "src/lib/config/BuffName.json",
    cnLocalePaths: {
      "en-US": "src/lib/config/en-US/BuffName.json",
      "ja-JP": "src/lib/config/ja-JP/BuffName.json",
    },
    keyFields: ["Id", "id"],
  },
  {
    name: "Scene names",
    category: "labels",
    globalPath: "parser-data/generated/scenenames.json",
    cnPath: "src/lib/config/SceneName.json",
    cnLocalePaths: {
      "en-US": "src/lib/config/en-US/SceneName.json",
      "ja-JP": "src/lib/config/ja-JP/SceneName.json",
    },
    keyFields: ["Id", "id"],
  },
  {
    name: "Recount table",
    category: "labels",
    globalPath: "parser-data/generated/RecountTable.json",
    cnPath: "src/lib/config/RecountTable.json",
    cnLocalePaths: {
      "en-US": "src/lib/config/en-US/RecountTable.json",
      "ja-JP": "src/lib/config/ja-JP/RecountTable.json",
    },
    keyFields: ["Id", "id", "Uid", "uid"],
  },
  {
    name: "DBM table",
    category: "labels",
    globalPath: "parser-data/generated/DbmTable.json",
    cnPath: "src/lib/config/DbmTable.json",
    cnLocalePaths: {
      "en-US": "src/lib/config/en-US/DbmTable.json",
      "ja-JP": "src/lib/config/ja-JP/DbmTable.json",
    },
    keyFields: ["Id", "id"],
  },
  {
    name: "Monster names",
    category: "labels",
    globalPath: "parser-data/generated/monsternames.json",
    cnPath: "src/lib/config/MonsterIdNameType.json",
    cnLocalePaths: {
      "en-US": "src/lib/config/en-US/MonsterIdNameType.json",
      "ja-JP": "src/lib/config/ja-JP/MonsterIdNameType.json",
    },
    keyFields: ["Id", "id", "MonsterId", "monsterId"],
  },
  {
    name: "Damage attribute names",
    category: "labels",
    globalPath: "parser-data/generated/DamageAttrIdName.json",
    cnPath: "src/lib/config/DamageAttrIdName.json",
    cnLocalePaths: {
      "en-US": "src/lib/config/en-US/DamageAttrIdName.json",
      "ja-JP": "src/lib/config/ja-JP/DamageAttrIdName.json",
    },
    keyFields: ["Id", "id", "AttrId", "attrId"],
  },
  {
    name: "Skill icons",
    category: "skill-monitor",
    globalPath: "parser-data/generated/skill_aoyi_icons.json",
    cnPath: "src/lib/config/skill_aoyi_icons.json",
    keyFields: ["id", "Id", "skillId"],
  },
  {
    name: "Class skill configs",
    category: "skill-monitor",
    globalPath: "parser-data/app-rules/class_skill_configs.json",
    cnPath: "src/lib/config/class_skill_configs.json",
    cnLocalePaths: {
      "en-US": "src/lib/config/en-US/class_skill_configs.json",
      "ja-JP": "src/lib/config/ja-JP/class_skill_configs.json",
    },
    keyFields: ["classKey", "classId"],
  },
  {
    name: "Class resources",
    category: "skill-monitor",
    globalPath: "parser-data/app-rules/class_resources.json",
    cnPath: "src/lib/config/class_resources.json",
    keyFields: ["classKey", "classId", "type"],
  },
  {
    name: "Special buff displays",
    category: "skill-monitor",
    globalPath: "parser-data/app-rules/class_special_buff_displays.json",
    cnPath: "src/lib/config/class_special_buff_displays.json",
    keyFields: ["buffBaseId", "buffId", "Id"],
  },
  {
    name: "Counter rules",
    category: "skill-monitor",
    globalPath: "parser-data/app-rules/counter_rules.json",
    cnPath: "src/lib/config/counter_rules.json",
    cnLocalePaths: {
      "en-US": "src/lib/config/en-US/counter_rules.json",
      "ja-JP": "src/lib/config/ja-JP/counter_rules.json",
    },
    keyFields: ["ruleId", "id"],
  },
  {
    name: "Counter slot templates",
    category: "skill-monitor",
    globalPath: "parser-data/app-rules/counter_slot_templates.json",
    cnPath: "src/lib/config/counter_slot_templates.json",
    cnLocalePaths: {
      "en-US": "src/lib/config/en-US/counter_slot_templates.json",
      "ja-JP": "src/lib/config/ja-JP/counter_slot_templates.json",
    },
    keyFields: ["slotTemplateId", "id"],
  },
  {
    name: "Counter source templates",
    category: "skill-monitor",
    globalPath: "parser-data/app-rules/counter_source_templates.json",
    cnPath: "src/lib/config/counter_source_templates.json",
    cnLocalePaths: {
      "en-US": "src/lib/config/en-US/counter_source_templates.json",
      "ja-JP": "src/lib/config/ja-JP/counter_source_templates.json",
    },
    keyFields: ["sourceId", "id"],
  },
  {
    name: "Extra monitored monsters",
    category: "meter-data",
    globalPath: "parser-data/logic/ExtraBuffMonitoredMonsters.json",
    cnPath: "src-tauri/meter-data/ExtraBuffMonitoredMonsters.json",
    keyFields: ["Id", "id", "monsterId"],
  },
  {
    name: "Skill effect table",
    category: "meter-data",
    globalPath: "parser-data/logic/SkillEffectTable.json",
    cnPath: "src-tauri/meter-data/SkillEffectTable.json",
    keyFields: ["Id", "id", "SkillEffectId", "skillEffectId"],
  },
  {
    name: "Skill fight level table",
    category: "meter-data",
    globalPath: "parser-data/logic/SkillFightLevelTable.json",
    cnPath: "src-tauri/meter-data/SkillFightLevelTable.json",
    keyFields: ["Id", "id", "SkillId", "skillId"],
  },
  {
    name: "Temp attr table",
    category: "meter-data",
    globalPath: "parser-data/logic/TempAttrTable.json",
    cnPath: "src-tauri/meter-data/TempAttrTable.json",
    keyFields: ["Id", "id", "AttrId", "attrId"],
  },
];

const GLOBAL_ONLY_DATASETS = [
  "parser-data/generated/SkillCooldowns.json",
  "parser-data/generated/SeasonPhantomFactors.json",
  "parser-data/generated/SeasonEffectDescriptions.json",
  "parser-data/generated/skillnames.json",
  "parser-data/generated/SkillBreakdownDetails.json",
];

const ASSET_DIRS = [
  {
    name: "Season phantom factor images",
    globalPath: "static/images/season_phantom_factor",
    cnPath: "static/images/season_phantom_factor",
  },
  {
    name: "Buff images",
    globalPath: "static/images/buff",
    cnPath: "static/images/buff",
  },
];

const INTERESTING_KEYWORDS = [
  "fairy",
  "tail",
  "happy",
  "charle",
  "charla",
  "factor",
  "fantasy",
  "infinite",
  "ensemble",
  "center of attention",
  "ascension",
  "thunder shadow",
  "soul",
  "marksman",
  "frost",
  "ice mage",
  "wind",
  "shield",
  "giant blade",
  "dual axe",
  "block",
  "lucky",
];

const SUPPORTED_COUNTER_SOURCE_KINDS = new Set([
  "damageBySkillKey",
  "damageBySkillKeyOnce",
  "damageBySkillKeySelfTarget",
  "anyDamage",
  "damageTaken",
  "fightResourceSpent",
  "buffAdded",
  "buffLayerSpent",
  "buffDurationTick",
  "skillCast",
  "skillDurationTick",
  "skillCastComplete",
  "movementDistance",
]);

const SUPPORTED_COUNTER_ACTIONS = new Set([
  "reset",
  "freeze",
  "resetAndFreeze",
  "resetAndFreezeKeepCounting",
  "resetAndStartCount",
  "startCount",
  "noOp",
]);

const SUPPORTED_SLOT_FIELDS = new Set([
  "threshold",
  "resetBuffId",
  "resetSourceConfigId",
  "onBuffAdd",
  "onBuffChange",
  "onBuffRemove",
  "freezeDurationMs",
  "onFreezeExpire",
  "altFreeze",
  "thresholdModifier",
  "freezeDurationModifier",
  "resetSkillKeys",
  "onResetSkill",
  "displayMode",
]);

function resolveReleaseRoot(candidate) {
  if (fs.existsSync(path.join(candidate, "src")) && fs.existsSync(path.join(candidate, "src-tauri"))) {
    return candidate;
  }
  if (!fs.existsSync(candidate)) return candidate;
  const nested = fs
    .readdirSync(candidate, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(candidate, entry.name))
    .find(
      (entryPath) =>
        fs.existsSync(path.join(entryPath, "src")) && fs.existsSync(path.join(entryPath, "src-tauri")),
    );
  return nested ?? candidate;
}

function inferCnReleaseLabel(root) {
  const normalized = path.resolve(root);
  const candidates = [
    path.basename(normalized),
    path.basename(path.dirname(normalized)),
  ];
  for (const candidate of candidates) {
    const match = candidate.match(/(\d+\.\d+\.\d+)/);
    if (match) return match[1];
  }
  return path.basename(normalized).replace(/^resonance-logs-cn-main_?/, "") || "unknown";
}

function readJson(root, relPath) {
  const absPath = path.join(root, relPath);
  if (!fs.existsSync(absPath)) return null;
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value) {
  return crypto.createHash("sha1").update(stableStringify(value)).digest("hex");
}

function cnChangeCoveredByGlobal(datasetName, globalValue, cnValue) {
  if (datasetName === "Buff names") {
    return buffNameCoverageIssues(globalValue, cnValue).length === 0;
  }
  if (datasetName === "Class skill configs") {
    return classSkillConfigCoverageIssues(globalValue, cnValue).length === 0;
  }
  return hashValue(globalValue) === hashValue(cnValue);
}

function normalizedText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buffNameDesignTexts(value) {
  return new Set([
    normalizedText(value?.NameDesign),
    normalizedText(value?.DesignName),
    normalizedText(value?.Name),
    normalizedText(value?.Names?.design),
  ].filter(Boolean));
}

function buffNameCoverageIssues(globalValue, cnValue) {
  const issues = [];
  if (!globalValue || !cnValue) return ["missing row"];
  if (String(globalValue.Id ?? globalValue.id) !== String(cnValue.Id ?? cnValue.id)) {
    issues.push("id differs");
  }

  const cnName = normalizedText(cnValue.NameDesign);
  if (cnName && !buffNameDesignTexts(globalValue).has(cnName)) {
    issues.push("NameDesign differs");
  }

  const cnIcon = normalizedText(cnValue.Icon);
  if (cnIcon) {
    const globalIcon = new Set([
      normalizedText(globalValue.Icon),
      normalizedText(globalValue.IconPath).split(/[\\/]/).pop() ?? "",
    ].filter(Boolean));
    if (!globalIcon.has(cnIcon)) issues.push("Icon missing");
  }

  const cnSpriteFile = normalizedText(cnValue.SpriteFile);
  if (cnSpriteFile && normalizedText(globalValue.SpriteFile) !== cnSpriteFile) {
    issues.push("SpriteFile missing");
  }

  return issues;
}

function toRecordMap(raw, keyFields = []) {
  const map = new Map();
  const duplicates = [];
  let totalRows = 0;
  const rows = Array.isArray(raw)
    ? raw.map((value, index) => ({ value, fallbackKey: String(index) }))
    : raw && typeof raw === "object"
      ? Object.entries(raw).map(([key, value]) => ({ value, fallbackKey: key }))
      : [];

  for (const { value, fallbackKey } of rows) {
    totalRows += 1;
    const key = getRecordKey(value, fallbackKey, keyFields);
    if (key === null) continue;
    const normalized = normalizeRecordValue(key, value);
    if (map.has(key)) duplicates.push(key);
    map.set(key, normalized);
  }

  return { map, totalRows, duplicates };
}

function getRecordKey(value, fallbackKey, keyFields) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const field of keyFields) {
      if (value[field] !== undefined && value[field] !== null && value[field] !== "") {
        return String(value[field]);
      }
    }
    for (const field of ["Id", "id", "ID", "uid", "Uid", "key", "name"]) {
      if (value[field] !== undefined && value[field] !== null && value[field] !== "") {
        return String(value[field]);
      }
    }
  }
  if (fallbackKey !== undefined && fallbackKey !== null && fallbackKey !== "") {
    return String(fallbackKey);
  }
  return null;
}

function normalizeRecordValue(key, value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { key, value };
  }
  return { key, value: { value } };
}

function compareMaps(left, right) {
  const leftKeys = new Set(left.keys());
  const rightKeys = new Set(right.keys());
  const onlyLeft = [];
  const onlyRight = [];
  const changed = [];

  for (const key of leftKeys) {
    if (!rightKeys.has(key)) {
      onlyLeft.push(key);
    } else if (hashValue(left.get(key)?.value) !== hashValue(right.get(key)?.value)) {
      changed.push(key);
    }
  }

  for (const key of rightKeys) {
    if (!leftKeys.has(key)) onlyRight.push(key);
  }

  onlyLeft.sort(sortKeys);
  onlyRight.sort(sortKeys);
  changed.sort(sortKeys);

  return { onlyLeft, onlyRight, changed };
}

function sortKeys(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b), "en-US");
}

function getDisplayText(record) {
  if (!record) return "";
  const value = record.value ?? record;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";

  const fields = [
    "Name",
    "name",
    "NameDesign",
    "DesignName",
    "RecountName",
    "Content",
    "Description",
    "description",
    "className",
    "label",
    "Icon",
  ];
  const parts = [];
  for (const field of fields) {
    if (typeof value[field] === "string" && value[field].trim()) parts.push(value[field].trim());
  }
  if (value.Names && typeof value.Names === "object") {
    for (const locale of ["en-US", "zh-CN", "ja-JP", "design"]) {
      const text = value.Names[locale];
      if (typeof text === "string" && text.trim()) parts.push(text.trim());
    }
  }
  return [...new Set(parts)].join(" | ");
}

function summarizeKeys(keys, map, localeMaps = {}, limit = 12) {
  return keys.slice(0, limit).map((key) => {
    const names = [];
    const baseText = getDisplayText(map.get(key));
    if (baseText) names.push(baseText);
    for (const [locale, localeMap] of Object.entries(localeMaps)) {
      const localeText = getDisplayText(localeMap.get(key));
      if (localeText) names.push(`${locale}: ${localeText}`);
    }
    return {
      key,
      text: names.length > 0 ? names.join(" / ") : "",
    };
  });
}

function buildLocaleMaps(root, localePaths, keyFields) {
  const maps = {};
  for (const [locale, relPath] of Object.entries(localePaths ?? {})) {
    const raw = readJson(root, relPath);
    if (!raw) continue;
    maps[locale] = toRecordMap(raw, keyFields).map;
  }
  return maps;
}

function keywordHits(keys, map, localeMaps = {}, limit = 20) {
  const hits = [];
  for (const key of keys) {
    const text = [
      getDisplayText(map.get(key)),
      ...Object.values(localeMaps).map((localeMap) => getDisplayText(localeMap.get(key))),
    ]
      .join(" ")
      .toLowerCase();
    const matched = INTERESTING_KEYWORDS.filter((keyword) => text.includes(keyword));
    if (matched.length === 0) continue;
    hits.push({ key, keywords: [...new Set(matched)], text: text.slice(0, 240) });
    if (hits.length >= limit) break;
  }
  return hits;
}

function analyzeDataset(dataset) {
  const globalRaw = readJson(projectRoot, dataset.globalPath);
  const cnRaw = readJson(currentCnRoot, dataset.cnPath);
  const previousCnRaw = readJson(previousCnRoot, dataset.cnPath);

  const globalRecords = globalRaw ? toRecordMap(globalRaw, dataset.keyFields) : null;
  const cnRecords = cnRaw ? toRecordMap(cnRaw, dataset.keyFields) : null;
  const previousCnRecords = previousCnRaw ? toRecordMap(previousCnRaw, dataset.keyFields) : null;

  const cnLocaleMaps = buildLocaleMaps(currentCnRoot, dataset.cnLocalePaths, dataset.keyFields);
  const previousVsCurrent =
    previousCnRecords && cnRecords ? compareMaps(previousCnRecords.map, cnRecords.map) : null;
  const globalVsCurrent =
    globalRecords && cnRecords ? compareMaps(globalRecords.map, cnRecords.map) : null;

  const cnAdded = previousVsCurrent?.onlyRight ?? (previousCnRecords ? [] : [...(cnRecords?.map.keys() ?? [])].sort(sortKeys));
  const cnChanged = previousVsCurrent?.changed ?? [];
  const globalMissingCnAdded =
    cnRecords
      ? cnAdded.filter((key) => !globalRecords?.map.has(key)).sort(sortKeys)
      : [];
  const globalDifferentCnChanged =
    globalRecords && cnRecords
      ? cnChanged
          .filter((key) => globalRecords.map.has(key))
          .filter((key) => !cnChangeCoveredByGlobal(
            dataset.name,
            globalRecords.map.get(key)?.value,
            cnRecords.map.get(key)?.value,
          ))
          .sort(sortKeys)
      : [];

  const compatibility = analyzeCompatibility(
    dataset.name,
    cnRecords?.map ?? new Map(),
    globalRecords?.map ?? new Map(),
  );

  return {
    name: dataset.name,
    category: dataset.category,
    paths: {
      global: dataset.globalPath,
      cn: dataset.cnPath,
      previousCnExists: Boolean(previousCnRaw),
      cnLocales: Object.keys(cnLocaleMaps),
    },
    counts: {
      globalRows: globalRecords?.totalRows ?? null,
      globalKeys: globalRecords?.map.size ?? null,
      cnRows: cnRecords?.totalRows ?? null,
      cnKeys: cnRecords?.map.size ?? null,
      previousCnRows: previousCnRecords?.totalRows ?? null,
      previousCnKeys: previousCnRecords?.map.size ?? null,
    },
    duplicateKeys: {
      global: globalRecords?.duplicates.slice(0, 20) ?? [],
      cn: cnRecords?.duplicates.slice(0, 20) ?? [],
    },
    deltas: {
      cnAddedSincePrevious: cnAdded.length,
      cnRemovedSincePrevious: previousVsCurrent?.onlyLeft.length ?? null,
      cnChangedSincePrevious: cnChanged.length,
      cnOnlyVsGlobal: globalVsCurrent?.onlyRight.length ?? null,
      globalOnlyVsCn: globalVsCurrent?.onlyLeft.length ?? null,
      changedVsGlobal: globalVsCurrent?.changed.length ?? null,
      globalMissingCnAdded: globalMissingCnAdded.length,
      globalDifferentCnChanged: globalDifferentCnChanged.length,
    },
    samples: {
      cnAddedSincePrevious: summarizeKeys(cnAdded, cnRecords?.map ?? new Map(), cnLocaleMaps),
      cnRemovedSincePrevious: summarizeKeys(
        previousVsCurrent?.onlyLeft ?? [],
        previousCnRecords?.map ?? new Map(),
      ),
      cnChangedSincePrevious: summarizeKeys(cnChanged, cnRecords?.map ?? new Map(), cnLocaleMaps),
      globalMissingCnAdded: summarizeKeys(
        globalMissingCnAdded,
        cnRecords?.map ?? new Map(),
        cnLocaleMaps,
      ),
      globalDifferentCnChanged: summarizeKeys(
        globalDifferentCnChanged,
        cnRecords?.map ?? new Map(),
        cnLocaleMaps,
      ),
      cnOnlyVsGlobal: summarizeKeys(globalVsCurrent?.onlyRight ?? [], cnRecords?.map ?? new Map(), cnLocaleMaps),
      interestingCnAdded: keywordHits(cnAdded, cnRecords?.map ?? new Map(), cnLocaleMaps),
      interestingCnOnly: keywordHits(globalVsCurrent?.onlyRight ?? [], cnRecords?.map ?? new Map(), cnLocaleMaps),
    },
    compatibility,
  };
}

function analyzeCompatibility(datasetName, map, globalMap = new Map()) {
  if (datasetName === "Counter source templates") {
    const unsupported = [];
    const kindCounts = new Map();
    for (const [key, record] of map) {
      const source = record.value?.source;
      if (!source || typeof source !== "object" || Array.isArray(source)) continue;
      const kinds = Object.keys(source);
      for (const kind of kinds) {
        kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
        if (!SUPPORTED_COUNTER_SOURCE_KINDS.has(kind)) {
          unsupported.push({ key, kind, text: getDisplayText(record) });
        }
      }
    }
    return {
      sourceKindCounts: Object.fromEntries([...kindCounts.entries()].sort(([a], [b]) => sortKeys(a, b))),
      unsupportedSourceTemplates: unsupported,
    };
  }

  if (datasetName === "Counter slot templates") {
    const unsupportedActions = [];
    const unknownFields = [];
    for (const [key, record] of map) {
      const slot = record.value?.slot;
      if (!slot || typeof slot !== "object" || Array.isArray(slot)) continue;
      for (const [field, value] of Object.entries(slot)) {
        if (!SUPPORTED_SLOT_FIELDS.has(field)) {
          unknownFields.push({ key, field, text: getDisplayText(record) });
        }
        if (field.startsWith("on") && typeof value === "string" && !SUPPORTED_COUNTER_ACTIONS.has(value)) {
          unsupportedActions.push({ key, field, action: value, text: getDisplayText(record) });
        }
      }
    }
    return {
      unsupportedSlotActions: unsupportedActions,
      unknownSlotFields: unknownFields,
    };
  }

  if (datasetName === "Class skill configs") {
    return analyzeClassSkillConfigCompatibility(map, globalMap);
  }

  return null;
}

function analyzeClassSkillConfigCompatibility(cnMap, globalMap) {
  const missingSemantics = [];
  const coveredDifferences = [];

  for (const [key, cnRecord] of cnMap) {
    const globalRecord = globalMap.get(key);
    if (!globalRecord) continue;
    const issues = classSkillConfigCoverageIssues(globalRecord.value, cnRecord.value);
    if (issues.length > 0) {
      missingSemantics.push({ key, text: issues.join("; ") });
    } else if (hashValue(globalRecord.value) !== hashValue(cnRecord.value)) {
      coveredDifferences.push({
        key,
        text: "CN semantics are covered; Global keeps extra skills, localized labels, or alternate icon paths",
      });
    }
  }

  return {
    classSkillMissingSemantics: missingSemantics,
    classSkillCoveredDifferences: coveredDifferences,
  };
}

function classSkillConfigCoverageIssues(globalConfig, cnConfig) {
  const issues = [];
  if (!globalConfig || !cnConfig) return ["missing config object"];

  if (cnConfig.classId !== undefined && globalConfig.classId !== cnConfig.classId) {
    issues.push(`classId ${cnConfig.classId} missing`);
  }

  const globalBuffIds = new Set(globalConfig.defaultMonitoredBuffIds ?? []);
  for (const buffId of cnConfig.defaultMonitoredBuffIds ?? []) {
    if (!globalBuffIds.has(buffId)) issues.push(`defaultMonitoredBuffIds missing ${buffId}`);
  }

  const globalSkills = new Map((globalConfig.skills ?? []).map((skill) => [String(skill.skillId), skill]));
  for (const cnSkill of cnConfig.skills ?? []) {
    const globalSkill = globalSkills.get(String(cnSkill.skillId));
    if (!globalSkill) {
      issues.push(`skill ${cnSkill.skillId} missing`);
      continue;
    }
    for (const issue of objectCoverageIssues(globalSkill, cnSkill, ["name"])) {
      issues.push(`skill ${cnSkill.skillId} ${issue}`);
    }
  }

  const globalDerivations = new Map(
    (globalConfig.derivations ?? []).map((derivation) => [
      derivationKey(derivation),
      derivation,
    ]),
  );
  for (const cnDerivation of cnConfig.derivations ?? []) {
    const globalDerivation = globalDerivations.get(derivationKey(cnDerivation));
    if (!globalDerivation) {
      issues.push(`derivation ${derivationKey(cnDerivation)} missing`);
      continue;
    }
    for (const issue of objectCoverageIssues(globalDerivation, cnDerivation, ["derivedName", "derivedImagePath"])) {
      issues.push(`derivation ${derivationKey(cnDerivation)} ${issue}`);
    }
  }

  return issues;
}

function derivationKey(derivation) {
  return [
    derivation.sourceSkillId,
    derivation.derivedSkillId,
    derivation.triggerBuffBaseId,
  ].map((value) => String(value)).join(":");
}

function objectCoverageIssues(globalValue, cnValue, ignoredFields = []) {
  const ignored = new Set(ignoredFields);
  const issues = [];
  for (const [field, cnFieldValue] of Object.entries(cnValue ?? {})) {
    if (ignored.has(field)) continue;
    if (hashValue(globalValue?.[field]) !== hashValue(cnFieldValue)) {
      issues.push(`${field} differs`);
    }
  }
  return issues;
}

function analyzeGlobalOnlyDataset(relPath) {
  const raw = readJson(projectRoot, relPath);
  const records = raw ? toRecordMap(raw, ["Id", "id", "skillId", "buffId", "factorId"]) : null;
  return {
    path: relPath,
    exists: Boolean(raw),
    rows: records?.totalRows ?? null,
    keys: records?.map.size ?? null,
  };
}

function listFiles(root, relPath) {
  const absPath = path.join(root, relPath);
  if (!fs.existsSync(absPath)) return [];
  return fs
    .readdirSync(absPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort(sortKeys);
}

function analyzeAssetDir(assetDir) {
  const globalFiles = listFiles(projectRoot, assetDir.globalPath);
  const cnFiles = listFiles(currentCnRoot, assetDir.cnPath);
  const previousFiles = listFiles(previousCnRoot, assetDir.cnPath);
  const currentSet = new Set(cnFiles);
  const globalSet = new Set(globalFiles);
  const previousSet = new Set(previousFiles);
  const addedSincePrevious = cnFiles.filter((name) => !previousSet.has(name));
  const cnOnlyVsGlobal = cnFiles.filter((name) => !globalSet.has(name));
  const globalOnlyVsCn = globalFiles.filter((name) => !currentSet.has(name));
  return {
    name: assetDir.name,
    paths: { global: assetDir.globalPath, cn: assetDir.cnPath },
    counts: {
      globalFiles: globalFiles.length,
      cnFiles: cnFiles.length,
      previousCnFiles: previousFiles.length,
    },
    deltas: {
      cnAddedSincePrevious: addedSincePrevious.length,
      cnOnlyVsGlobal: cnOnlyVsGlobal.length,
      globalOnlyVsCn: globalOnlyVsCn.length,
    },
    samples: {
      cnAddedSincePrevious: addedSincePrevious.slice(0, 20),
      cnOnlyVsGlobal: cnOnlyVsGlobal.slice(0, 20),
    },
  };
}

function table(headers, rows) {
  const escapeCell = (value) => String(value ?? "").replace(/\|/g, "\\|");
  return [
    `| ${headers.map(escapeCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ].join("\n");
}

function formatSamples(samples) {
  if (!samples || samples.length === 0) return "_None in first sample window._";
  return samples
    .map((sample) => {
      if (typeof sample === "string") return `- ${sample}`;
      const text = sample.text ? ` - ${sample.text}` : "";
      const keywords = sample.keywords ? ` (${sample.keywords.join(", ")})` : "";
      return `- ${sample.key}${keywords}${text}`;
    })
    .join("\n");
}

function formatCompatibility(compatibility) {
  if (!compatibility) return "";
  const sections = [];
  if (compatibility.sourceKindCounts) {
    sections.push(
      "### Counter Source Compatibility",
      "",
      table(
        ["Source kind", "CN templates"],
        Object.entries(compatibility.sourceKindCounts).map(([kind, count]) => [kind, count]),
      ),
      "",
      "Unsupported by Global today:",
      "",
      formatSamples(
        compatibility.unsupportedSourceTemplates.map((item) => ({
          key: item.key,
          text: `${item.kind}${item.text ? ` - ${item.text}` : ""}`,
        })),
      ),
    );
  }
  if (compatibility.unsupportedSlotActions || compatibility.unknownSlotFields) {
    sections.push(
      "### Counter Slot Compatibility",
      "",
      "Unsupported actions:",
      "",
      formatSamples(
        compatibility.unsupportedSlotActions.map((item) => ({
          key: item.key,
          text: `${item.field}: ${item.action}${item.text ? ` - ${item.text}` : ""}`,
        })),
      ),
      "",
      "Unknown slot fields:",
      "",
      formatSamples(
        compatibility.unknownSlotFields.map((item) => ({
          key: item.key,
          text: `${item.field}${item.text ? ` - ${item.text}` : ""}`,
        })),
      ),
    );
  }
  if (compatibility.classSkillMissingSemantics || compatibility.classSkillCoveredDifferences) {
    sections.push(
      "### Class Skill Config Compatibility",
      "",
      "CN semantics still missing from Global:",
      "",
      formatSamples(compatibility.classSkillMissingSemantics),
      "",
      "Exact CN changes covered by additive Global config:",
      "",
      formatSamples(compatibility.classSkillCoveredDifferences),
    );
  }
  return sections.length ? `\n${sections.join("\n")}\n` : "";
}

function buildMarkdown(report) {
  const datasetRows = report.datasets.map((dataset) => [
    dataset.name,
    dataset.counts.globalKeys ?? "missing",
    dataset.counts.cnKeys ?? "missing",
    dataset.deltas.cnAddedSincePrevious ?? "n/a",
    dataset.deltas.cnChangedSincePrevious ?? "n/a",
    dataset.deltas.globalMissingCnAdded,
    dataset.deltas.globalDifferentCnChanged,
    dataset.deltas.cnOnlyVsGlobal ?? "n/a",
  ]);

  const assetRows = report.assets.map((asset) => [
    asset.name,
    asset.counts.globalFiles,
    asset.counts.cnFiles,
    asset.deltas.cnAddedSincePrevious,
    asset.deltas.cnOnlyVsGlobal,
  ]);

  const sections = [
    `# CN ${currentCnLabel} Data Diff`,
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Global root: \`${report.roots.global}\``,
    `CN current root: \`${report.roots.currentCn}\``,
    `CN previous root: \`${report.roots.previousCn}\``,
    "",
    "## Summary",
    "",
    table(
      [
        "Dataset",
        "Global keys",
        `CN ${currentCnLabel} keys`,
        `CN added vs ${previousCnLabel}`,
        `CN changed vs ${previousCnLabel}`,
        "CN-added missing in Global",
        "CN-changed different in Global",
        "CN-only vs Global",
      ],
      datasetRows,
    ),
    "",
    "## Static Asset Summary",
    "",
    table(["Asset dir", "Global files", `CN ${currentCnLabel} files`, `CN added vs ${previousCnLabel}`, "CN-only vs Global"], assetRows),
    "",
    "## Global-Only Generated Data",
    "",
    `These Global generator outputs do not have a same-shaped CN ${currentCnLabel} config file. Treat CN changes in these areas as source hints, not copyable replacements.`,
    "",
    table(
      ["Path", "Exists", "Rows", "Keys"],
      report.globalOnlyDatasets.map((item) => [item.path, item.exists, item.rows ?? "n/a", item.keys ?? "n/a"]),
    ),
  ];

  for (const dataset of report.datasets) {
    sections.push(
      "",
      `## ${dataset.name}`,
      "",
      `Global: \`${dataset.paths.global}\``,
      `CN: \`${dataset.paths.cn}\``,
      `CN locale files: ${dataset.paths.cnLocales.length ? dataset.paths.cnLocales.map((locale) => `\`${locale}\``).join(", ") : "_none_"}`,
      "",
      "### Actionable CN Additions Missing In Global",
      "",
      formatSamples(dataset.samples.globalMissingCnAdded),
      "",
      `### CN Changes Since ${previousCnLabel} That Differ From Global`,
      "",
      formatSamples(dataset.samples.globalDifferentCnChanged),
      "",
      "### Keyword Hits In CN Additions",
      "",
      formatSamples(dataset.samples.interestingCnAdded),
      formatCompatibility(dataset.compatibility),
    );
  }

  for (const asset of report.assets) {
    sections.push(
      "",
      `## ${asset.name}`,
      "",
      `Global: \`${asset.paths.global}\``,
      `CN: \`${asset.paths.cn}\``,
      "",
      `### CN Assets Added Since ${previousCnLabel}`,
      "",
      formatSamples(asset.samples.cnAddedSincePrevious),
      "",
      "### CN Assets Missing In Global",
      "",
      formatSamples(asset.samples.cnOnlyVsGlobal),
    );
  }

  return `${sections.join("\n")}\n`;
}

const report = {
  generatedAt: new Date().toISOString(),
  roots: {
    global: projectRoot,
    currentCn: currentCnRoot,
    previousCn: previousCnRoot,
  },
  datasets: DATASETS.map(analyzeDataset),
  globalOnlyDatasets: GLOBAL_ONLY_DATASETS.map(analyzeGlobalOnlyDataset),
  assets: ASSET_DIRS.map(analyzeAssetDir),
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
fs.writeFileSync(markdownPath, buildMarkdown(report), "utf8");

console.log(`Wrote ${path.relative(projectRoot, markdownPath)}`);
console.log(`Wrote ${path.relative(projectRoot, jsonPath)}`);
