import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const defaultProbePath = path.resolve(
  repoRoot,
  "..",
  "BPSR-UID-Extractors",
  "output",
  "probing-reports",
  "SeasonPhantomFactorProbe.json",
);
const defaultBreakdownPath = path.join(
  repoRoot,
  "parser-data",
  "generated",
  "SkillBreakdownDetails.json",
);
const defaultEffectDescriptionsPath = path.join(
  repoRoot,
  "parser-data",
  "generated",
  "SeasonEffectDescriptions.json",
);
const defaultOutPath = path.join(
  repoRoot,
  "parser-data",
  "generated",
  "SeasonPhantomFactors.json",
);

function parseArgs(argv) {
  const args = {
    probePath: defaultProbePath,
    breakdownPath: defaultBreakdownPath,
    effectDescriptionsPath: defaultEffectDescriptionsPath,
    outPath: defaultOutPath,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--probe" && next) {
      args.probePath = path.resolve(next);
      index += 1;
    } else if (arg === "--breakdown" && next) {
      args.breakdownPath = path.resolve(next);
      index += 1;
    } else if (arg === "--effect-descriptions" && next) {
      args.effectDescriptionsPath = path.resolve(next);
      index += 1;
    } else if (arg === "--out" && next) {
      args.outPath = path.resolve(next);
      index += 1;
    }
  }

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function uniqueNumbers(values) {
  return [...new Set(values.map(toNumber).filter((value) => value !== null))].sort(
    (left, right) => left - right,
  );
}

function extractValueTexts(value) {
  return [...new Set(
    String(value || "")
      .match(/[+-]?\d+(?:[.,]\d+)?\s*(?:%|s|sec|seconds?)?/gi) ?? [],
  )].map((entry) => entry.trim());
}

function preferredText(values) {
  return values?.en
    ?? values?.["zh-CN"]
    ?? values?.design
    ?? Object.values(values ?? {}).find(Boolean)
    ?? "";
}

function nonEmptyObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function descriptionByBuffId(effectDescriptions) {
  if (!effectDescriptions) return {};
  if (nonEmptyObject(effectDescriptions.byBuffId)) return effectDescriptions.byBuffId;

  const byBuffId = {};
  for (const row of effectDescriptions.rows ?? []) {
    const buffId = toNumber(row.buffId ?? row.Id ?? row.id);
    if (buffId !== null) byBuffId[String(buffId)] = row;
  }
  return byBuffId;
}

const rawEffectStatRenderers = new Map([
  [11012, { label: "Strength", divisor: 1, suffix: "" }],
  [11014, { label: "Strength", divisor: 100, suffix: "%" }],
  [11022, { label: "Intellect", divisor: 1, suffix: "" }],
  [11024, { label: "Intellect", divisor: 100, suffix: "%" }],
  [11032, { label: "Agility", divisor: 1, suffix: "" }],
  [11034, { label: "Agility", divisor: 100, suffix: "%" }],
  [11042, { label: "Endurance", divisor: 1, suffix: "" }],
  [11044, { label: "Endurance", divisor: 100, suffix: "%" }],
  [11322, { label: "Max HP", divisor: 1, suffix: "" }],
  [11324, { label: "Max HP", divisor: 100, suffix: "%" }],
  [11352, { label: "Armor", divisor: 1, suffix: "" }],
  [11354, { label: "Armor", divisor: 100, suffix: "%" }],
  [11802, { label: "Healing Received", divisor: 100, suffix: "%" }],
  [11812, { label: "Shield Strength", divisor: 100, suffix: "%" }],
  [13002, { label: "Element Strength", divisor: 1, suffix: "" }],
  [13202, { label: "Element Resistance", divisor: 100, suffix: "%" }],
]);

function formatEffectNumber(value) {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  return Number(value.toFixed(2)).toString();
}

function formatSignedEffectValue(value, suffix) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatEffectNumber(value)}${suffix}`;
}

function rawEffectRecordText(row) {
  const effectRecords = Array.isArray(row.effectRecords) ? row.effectRecords : [];
  const parts = [];

  for (const record of effectRecords) {
    const rawValues = Array.isArray(record.rawValues) ? record.rawValues : [];
    const opcode = toNumber(rawValues[0]);
    const effectId = toNumber(rawValues[1]);
    const value = toNumber(rawValues[2]);
    const renderer = rawEffectStatRenderers.get(effectId);

    if (opcode !== 1 || effectId === null || value === null || !renderer) {
      continue;
    }

    parts.push(`${renderer.label} ${formatSignedEffectValue(value / renderer.divisor, renderer.suffix)}`);
  }

  return parts.join("; ");
}

function buildFactorModifierEvidence(gradeRows) {
  const rows = gradeRows
    .map((row) => {
      const resolvedText = preferredText(row.cleanResolvedDescriptions)
        || preferredText(row.resolvedDescriptions)
        || row.resolvedDescription
        || "";
      const rawText = rawEffectRecordText(row);
      const text = resolvedText || rawText || "";
      return stripUndefined({
        grade: toNumber(row.grade),
        itemId: toNumber(row.itemId),
        itemQualityTier: toNumber(row.itemQualityTier),
        parameterValues: uniqueNumbers(row.parameterValues ?? []),
        valueTexts: extractValueTexts(text),
        cleanResolvedDescription: text,
        descriptionSource: !resolvedText && rawText ? "effectRecords.rawValues" : undefined,
        sourceOffset: toNumber(row.sourceOffset),
      });
    })
    .filter((row) => row.grade !== undefined || row.cleanResolvedDescription);

  if (!rows.length) return undefined;
  const hasRawEffectRecordDescriptions = rows.some((row) => row.descriptionSource === "effectRecords.rawValues");

  return {
    source: "SeasonPhantomFactorProbe.gradeRows",
    valueStatus: hasRawEffectRecordDescriptions
      ? "grade-table-rendered-description-or-raw-effect-record"
      : "grade-table-rendered-description",
    runtimeSelectionStatus: "active-buff-observed-grade-not-exposed",
    gradeRows: rows,
  };
}

function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, stripUndefined(entryValue)]),
    );
  }
  return value;
}

function inferredBuffIdForFamily(family) {
  const familyId = toNumber(family.familyId);
  if (familyId === null) return null;

  const buffId = 3_050_000 + (familyId - 200_100) * 10;
  return buffId >= 3_050_000 && buffId <= 3_069_990 ? buffId : null;
}

function seasonEffectBuffIdForCurrentFamily(family, effectDescriptionsByBuffId) {
  const familyId = toNumber(family.familyId);
  if (familyId === null) return null;

  const familyName = preferredText(family.familyNames) || family.familyName || "";
  const slot = toNumber(familyName.match(/\bX(\d+)\b/i)?.[1]);
  if (slot === null) return null;

  const currentSeasonEffectRows = [
    {
      minFamilyId: 202_189,
      maxFamilyId: 202_199,
      namePattern: /\bPolarity\b/i,
      buffBase: 3_058_000,
      source: "season-effect-description-polarity-slot-id",
    },
    {
      minFamilyId: 202_200,
      maxFamilyId: 202_208,
      namePattern: /\bStasis\b/i,
      buffBase: 3_059_000,
      source: "season-effect-description-stasis-slot-id",
    },
  ];

  for (const row of currentSeasonEffectRows) {
    if (familyId < row.minFamilyId || familyId > row.maxFamilyId || !row.namePattern.test(familyName)) {
      continue;
    }

    const buffId = row.buffBase + slot * 10;
    if (effectDescriptionsByBuffId[String(buffId)]) {
      return {
        buffId,
        source: row.source,
      };
    }
  }

  return null;
}

function factorBuffRowsForFamily(family, effectDescriptionsByBuffId) {
  const primaryBuffIds = uniqueNumbers(family.primaryBuffIds ?? []);
  if (primaryBuffIds.length > 0) {
    return primaryBuffIds.map((buffId) => ({
      buffId,
      buffIdSource: "probe-primary-buff-id",
      runtimeDetection: "active-buff-or-selected-factor-grade-item",
    }));
  }

  const seasonEffectBuffId = seasonEffectBuffIdForCurrentFamily(family, effectDescriptionsByBuffId);
  if (seasonEffectBuffId !== null) {
    return [{
      buffId: seasonEffectBuffId.buffId,
      buffIdSource: seasonEffectBuffId.source,
      runtimeDetection: "selected-factor-grade-item",
    }];
  }

  const gradeRows = Array.isArray(family.gradeRows) ? family.gradeRows : [];
  const inferredBuffId = gradeRows.length > 0 ? inferredBuffIdForFamily(family) : null;
  if (inferredBuffId === null) return [];

  return [{
    buffId: inferredBuffId,
    buffIdSource: "family-id-derived-stat-factor-id",
    runtimeDetection: "selected-factor-grade-item",
  }];
}

function buildFactorsByBuffId(probe, effectDescriptionsByBuffId) {
  const factorsByBuffId = {};
  const factorBuffIds = [];

  for (const family of probe.families ?? []) {
    for (const buffRow of factorBuffRowsForFamily(family, effectDescriptionsByBuffId)) {
      const { buffId, buffIdSource, runtimeDetection } = buffRow;
      factorBuffIds.push(buffId);
      const gradeRows = Array.isArray(family.gradeRows) ? family.gradeRows : [];
      const effectDescription = effectDescriptionsByBuffId[String(buffId)] ?? {};
      const descriptions = nonEmptyObject(family.descriptions)
        ? family.descriptions
        : effectDescription.descriptions;
      const cleanDescriptions = nonEmptyObject(family.cleanDescriptions)
        ? family.cleanDescriptions
        : effectDescription.cleanDescriptions;
      factorsByBuffId[String(buffId)] = stripUndefined({
        familyId: toNumber(family.familyId),
        buffId,
        buffIdSource,
        familyName: family.familyName ?? "",
        familyNames: family.familyNames ?? {},
        iconPath: family.iconPath,
        runtimeDetection,
        classGateIds: uniqueNumbers(family.classGateIds ?? []),
        descriptionId: toNumber(family.descriptionId ?? effectDescription.descriptionId),
        descriptions: descriptions ?? {},
        cleanDescriptions: cleanDescriptions ?? {},
        gradeCount: gradeRows.length,
        gradeIds: uniqueNumbers(gradeRows.map((row) => row.grade)),
        gradeItemIds: uniqueNumbers(gradeRows.map((row) => row.itemId)),
        modifierEvidence: buildFactorModifierEvidence(gradeRows),
        affectedDamageIds: [],
        affectedRecountIds: [],
        affectedDamageEvidence: {},
        affectedRecountEvidence: {},
      });
    }
  }

  return {
    factorBuffIds: uniqueNumbers(factorBuffIds),
    factorsByBuffId,
  };
}

function directLinkedFactorIds(detail, factorBuffIdSet) {
  const candidates = [
    ["LinkedBuffId", detail.LinkedBuffId],
    ["BuffSourceId", detail.BuffSourceId],
    ["LinkedId", detail.LinkedId],
  ];
  const linkedSource = String(detail.LinkedSource ?? "");
  const directIds = [];

  for (const [field, rawId] of candidates) {
    const id = toNumber(rawId);
    if (id === null || !factorBuffIdSet.has(id)) continue;
    if (field === "LinkedId" && linkedSource && linkedSource !== "BuffName") continue;
    directIds.push({ field, id });
  }

  const byId = new Map();
  for (const row of directIds) {
    if (!byId.has(row.id)) byId.set(row.id, row.field);
  }
  return [...byId].map(([id, field]) => ({ id, field }));
}

function applyDamageLinks(factorsByBuffId, factorBuffIds, breakdown) {
  const factorBuffIdSet = new Set(factorBuffIds);
  const damageIdToFactorBuffIds = {};

  for (const detail of Object.values(breakdown)) {
    const damageId = toNumber(detail.Id);
    if (damageId === null) continue;

    for (const link of directLinkedFactorIds(detail, factorBuffIdSet)) {
      const key = String(link.id);
      const factor = factorsByBuffId[key];
      if (!factor) continue;

      factor.affectedDamageIds = uniqueNumbers([
        ...(factor.affectedDamageIds ?? []),
        damageId,
      ]);
      factor.affectedDamageEvidence[String(damageId)] = stripUndefined({
        source: `SkillBreakdownDetails.${link.field}`,
        category: detail.Category,
        categoryLabel: detail.CategoryLabel,
        sourceKind: detail.SourceKind,
        sourceType: detail.SourceType,
        linkedSource: detail.LinkedSource,
        linkedId: toNumber(detail.LinkedId),
        linkedBuffId: toNumber(detail.LinkedBuffId),
        buffSourceId: toNumber(detail.BuffSourceId),
      });

      damageIdToFactorBuffIds[String(damageId)] = uniqueNumbers([
        ...(damageIdToFactorBuffIds[String(damageId)] ?? []),
        link.id,
      ]);
    }
  }

  return damageIdToFactorBuffIds;
}

function applyRecountLinks(factorsByBuffId, probe) {
  const recountIdToFactorBuffIds = {};

  for (const family of probe.families ?? []) {
    const primaryBuffIds = uniqueNumbers(family.primaryBuffIds ?? []);
    const targets = Array.isArray(family.descriptionTargetRecountRows)
      ? family.descriptionTargetRecountRows
      : [];

    for (const target of targets) {
      const recountId = toNumber(target.recountId);
      if (recountId === null || target.relationshipKind !== "affected-dream-damage-target") {
        continue;
      }

      for (const buffId of primaryBuffIds) {
        const factor = factorsByBuffId[String(buffId)];
        if (!factor) continue;

        const firstEvidence = Array.isArray(target.evidence) ? target.evidence[0] : null;
        factor.affectedRecountIds = uniqueNumbers([
          ...(factor.affectedRecountIds ?? []),
          recountId,
        ]);
        factor.affectedRecountEvidence[String(recountId)] = stripUndefined({
          source: target.evidenceSource ?? firstEvidence?.source,
          sourceTable: firstEvidence?.sourceTable,
          relationshipKind: target.relationshipKind,
          evidenceStatuses: target.evidenceStatuses ?? [],
          descriptionId: firstEvidence?.descriptionId ?? family.descriptionId,
          localeId: firstEvidence?.localeId,
          targetText: firstEvidence?.targetText,
          candidateText: firstEvidence?.candidateText,
          matchedText: firstEvidence?.matchedText,
          recountName: target.recountName,
          damageIds: uniqueNumbers(target.damageIds ?? []),
        });

        recountIdToFactorBuffIds[String(recountId)] = uniqueNumbers([
          ...(recountIdToFactorBuffIds[String(recountId)] ?? []),
          buffId,
        ]);
      }
    }
  }

  return recountIdToFactorBuffIds;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const probe = readJson(args.probePath);
  const breakdown = readJson(args.breakdownPath);
  const effectDescriptionsByBuffId = fs.existsSync(args.effectDescriptionsPath)
    ? descriptionByBuffId(readJson(args.effectDescriptionsPath))
    : {};

  const { factorBuffIds, factorsByBuffId } = buildFactorsByBuffId(probe, effectDescriptionsByBuffId);
  const damageIdToFactorBuffIds = applyDamageLinks(
    factorsByBuffId,
    factorBuffIds,
    breakdown,
  );
  const recountIdToFactorBuffIds = applyRecountLinks(factorsByBuffId, probe);

  const data = {
    summary: {
      source: "SeasonPhantomFactorProbe",
      sourcePath: path.relative(repoRoot, args.probePath).replaceAll("\\", "/"),
      breakdownSource: path.relative(repoRoot, args.breakdownPath).replaceAll("\\", "/"),
      effectDescriptionSource: fs.existsSync(args.effectDescriptionsPath)
        ? path.relative(repoRoot, args.effectDescriptionsPath).replaceAll("\\", "/")
        : null,
      factorFamilies: Object.values(factorsByBuffId).length,
      factorBuffIds: factorBuffIds.length,
      directlyLinkedDamageRows: Object.keys(damageIdToFactorBuffIds).length,
      descriptionTargetRecountRows: Object.keys(recountIdToFactorBuffIds).length,
      gradeProvenByRuntime: false,
      relationshipPolicy:
        "Direct game-file ID links map child damage rows. Structured Dream DMG target clauses from localized factor descriptions map parent Recount rows as description-target evidence, not formula evidence.",
    },
    factorBuffIds,
    factorsByBuffId,
    damageIdToFactorBuffIds,
    recountIdToFactorBuffIds,
  };

  fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
  fs.writeFileSync(args.outPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${path.relative(repoRoot, args.outPath)} (${factorBuffIds.length} factor buff IDs, ${Object.keys(damageIdToFactorBuffIds).length} linked damage rows, ${Object.keys(recountIdToFactorBuffIds).length} linked recount rows).`,
  );
}

main();
