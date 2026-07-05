import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const generatedDir = path.join(repoRoot, "parser-data", "generated");

const configs = [
  {
    in: "itemnames.json",
    out: "ItemNamesRuntime.json",
    mode: "array",
    fields: ["Id", "Name", "NameDesign", "Names"],
  },
  {
    in: "DamageAttrIdName.json",
    out: "DamageAttrIdNameRuntime.json",
    mode: "record",
    fields: [
      "Id",
      "Name",
      "Names",
      "DamageName",
      "DamageKind",
      "LinkedId",
      "LinkedSource",
      "LinkedBuffId",
      "BuffSourceId",
      "LinkedSkillEffectSkillTableName",
      "LinkedSkillEffectSkillTableNames",
      "LinkedSkillTableName",
      "LinkedSkillTableNames",
      "IconPath",
      "IconPaths",
      "LinkedBaseSkillIconPath",
      "LinkedTalentIconPath",
      "LinkedSourceTalentIconPath",
      "LinkedSkillEffectSkillTableIconPath",
      "LinkedSkillEffectSkillTableParentIconPath",
      "LinkedSkillTableIconPath",
      "LinkedSkillTableParentIconPath",
      "LinkedBuffIconFamilySourceId",
      "LinkedBuffIconFamilySourceName",
    ],
  },
  {
    in: "BuffName.json",
    out: "BuffNameRuntime.json",
    mode: "array",
    fields: ["Id", "Name", "Names", "NameDesign", "DesignName", "Icon", "IconPath", "SpriteFile"],
  },
  {
    in: "SkillBreakdownDetails.json",
    out: "SkillBreakdownDetailsRuntime.json",
    mode: "record",
    fields: [
      "Id",
      "DisplayName",
      "DisplayNames",
      "DisplayDetailName",
      "DisplayDetailNames",
      "DisplayDetailKind",
      "DisplayDetailSource",
      "DisplayDetailEvidence",
      "DisplayVariantName",
      "DisplayVariantNames",
      "DisplayVariantSource",
      "DisplayVariantEvidence",
      "Category",
      "CategoryLabel",
      "Badge",
      "SourceRole",
      "Reason",
      "DamageName",
      "DamageNames",
      "DamageKind",
      "ParentRecountId",
      "ParentRecountName",
      "ParentRecountNames",
      "ParentBaseSkillId",
      "ParentTalentId",
      "ParentTalentName",
      "ParentTalentNames",
      "SourceTalentId",
      "SourceTalentName",
      "SourceTalentNames",
      "SourceTalentBridge",
      "LinkedSource",
      "LinkedId",
      "LinkedName",
      "LinkedNames",
      "LinkedSkillId",
      "LinkedBuffId",
      "BuffSourceId",
      "RecountOwnerSkillId",
      "RecountOwnerSkillName",
      "RecountOwnerSkillNames",
      "MonsterOwnerIds",
      "MonsterOwnerName",
      "MonsterOwnerNames",
      "MonsterOwnerSource",
      "UnderlyingSkillId",
      "UnderlyingSkillName",
      "UnderlyingSkillNames",
      "IsRecountOwnerSkillMismatch",
      "IsRecountOwnerNameMismatch",
      "IconPath",
      "IconPaths",
      "IconSource",
      "LinkedBaseSkillIconPath",
      "LinkedTalentIconPath",
      "LinkedSourceTalentIconPath",
      "SourceFiles",
    ],
  },
  {
    in: "SeasonPhantomFactors.json",
    out: "SeasonPhantomFactorsRuntime.json",
    mode: "seasonFactors",
    factorFields: [
      "familyId",
      "buffId",
      "familyName",
      "familyNames",
      "classGateIds",
      "descriptionId",
      "descriptions",
      "cleanDescriptions",
      "modifierEvidence",
      "iconPath",
      "affectedDamageIds",
      "affectedRecountIds",
      "affectedDamageEvidence",
      "affectedRecountEvidence",
    ],
  },
  {
    in: "SkillCooldowns.json",
    out: "SkillCooldownsRuntime.json",
    mode: "skillCooldowns",
    levelFields: [
      "skillLevelId",
      "skillId",
      "level",
      "pveCooldownSeconds",
      "noCdReduce",
    ],
    skillFields: [
      "skillId",
      "levelIds",
      "maxPveCooldownSeconds",
      "minPveCooldownSeconds",
      "noCdReduce",
    ],
  },
  {
    in: "EffectSources.json",
    out: "EffectSourcesRuntime.json",
    mode: "effectSources",
    sourceFields: [
      "sourceId",
      "sourceKind",
      "sourceType",
      "sourceName",
      "sourceNames",
      "descriptions",
      "cleanDescriptions",
      "modifierEvidence",
      "iconPath",
      "sourceEntityId",
      "runtimeDetection",
      "familyId",
      "buffIds",
      "targets",
      "evidence",
      "attributionModel",
      "talentOwnership",
    ],
  },
  {
    in: "ModifierDisplayTable.json",
    out: "ModifierDisplayRuntime.json",
    mode: "modifierDisplay",
    sourceFields: ["sourceId", "sourceName", "sourceNames", "iconPath", "displayOwnerKind"],
  },
  {
    in: "ModifierRecountTable.json",
    out: "ModifierRecountRuntime.json",
    mode: "modifierRecount",
    sourceFields: [
      "sourceId",
      "sourceKind",
      "sourceType",
      "sourceEntityId",
      "sourceName",
      "sourceNames",
      "description",
      "descriptions",
      "iconPath",
      "runtimeDetection",
      "providerAggregation",
      "displayOwnerKind",
      "buffIds",
      "evidence",
      "reportPolicy",
      "runtimeSourceConfigIds",
      "runtimeBaseIds",
      "rowPolicy",
      "contributionStatus",
      "formulaZoneIds",
      "contributionGroups",
      "predicateTags",
      "relationshipKinds",
      "componentClasses",
      "attributionModel",
      "contributionModel",
      "talentOwnership",
      "classification",
      "uidEdges",
      "targetDamageIds",
      "targetRecountIds",
    ],
  },
];

for (const config of configs) {
  const inputPath = path.join(generatedDir, config.in);
  const outputPath = path.join(generatedDir, config.out);
  const input = readJson(inputPath);
  const output = compactTable(input, config);
  fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`, "utf8");
  const inputSize = fs.statSync(inputPath).size;
  const outputSize = fs.statSync(outputPath).size;
  console.log(`${config.out}: ${formatSize(inputSize)} -> ${formatSize(outputSize)}`);
}

function compactTable(input, config) {
  if (config.mode === "array") {
    return input.map((entry) => pick(entry, config.fields));
  }
  if (config.mode === "record") {
    return Object.fromEntries(
      Object.entries(input).map(([key, entry]) => [key, pick(entry, config.fields)]),
    );
  }
  if (config.mode === "seasonFactors") {
    return stripEmpty({
      factorsByBuffId: mapRecord(input.factorsByBuffId ?? {}, (entry) => pick(entry, config.factorFields)),
      damageIdToFactorBuffIds: input.damageIdToFactorBuffIds,
      recountIdToFactorBuffIds: input.recountIdToFactorBuffIds,
    });
  }
  if (config.mode === "effectSources") {
    return stripEmpty({
      effectSourcesById: mapRecord(input.effectSourcesById ?? {}, (entry) => pickEffectSource(entry, config.sourceFields)),
      buffIdToEffectSourceIds: input.buffIdToEffectSourceIds,
      damageIdToEffectSourceIds: input.damageIdToEffectSourceIds,
      recountIdToEffectSourceIds: input.recountIdToEffectSourceIds,
    });
  }
  if (config.mode === "skillCooldowns") {
    return stripEmpty({
      skillCooldownsByLevelId: mapRecord(input.skillCooldownsByLevelId ?? {}, (entry) => pick(entry, config.levelFields)),
      skillCooldownsBySkillId: mapRecord(input.skillCooldownsBySkillId ?? {}, (entry) => pick(entry, config.skillFields)),
    });
  }
  if (config.mode === "modifierDisplay") {
    return stripEmpty({
      sourcesByRuleId: mapRecord(input.sourcesByRuleId ?? {}, (entry) => pick(entry, config.sourceFields)),
    });
  }
  if (config.mode === "modifierRecount") {
    return stripEmpty({
      sourcesById: mapRecord(input.sourcesById ?? {}, (entry) => pick(entry, config.sourceFields)),
      byBuffId: input.byBuffId,
      ignoredBuffIds: input.ignoredBuffIds,
      reportableBuffIds: input.reportableBuffIds,
      debugBuffIds: input.debugBuffIds,
    });
  }
  throw new Error(`Unknown compact mode: ${config.mode}`);
}

function pickEffectSource(entry, fields) {
  const picked = pick(entry, fields);
  if (Array.isArray(picked.evidence)) {
    picked.evidence = picked.evidence.map((item) => pick(item, ["source", "relationshipPolicy"]));
  }
  return stripEmpty(picked);
}

function mapRecord(record, fn) {
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, value]) => [key, fn(value)])
      .filter(([, value]) => value !== undefined),
  );
}

function pick(entry, fields) {
  if (entry === null || typeof entry !== "object") return entry;
  const out = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(entry, field)) {
      out[field] = entry[field];
    }
  }
  return stripEmpty(out);
}

function stripEmpty(value) {
  if (Array.isArray(value)) {
    const items = value
      .map(stripEmpty)
      .filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined || entry === null || entry === "") continue;
      const cleaned = stripEmpty(entry);
      if (cleaned !== undefined) {
        out[key] = cleaned;
      }
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
