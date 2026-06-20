import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const inputPath = path.join(root, "parser-data/generated/SeasonPhantomFactors.json");

const factorTypeMatchers = {
  inspiration: {
    outputName: "inspiration",
    matches(name) {
      return /\bX\s*\d+\b/i.test(name)
        && !/\b(?:Polarity|Reality|Stasis|Rhapsody)\b/i.test(name);
    },
    classOf(name) {
      return name.match(/^(.*?)\s+X\s*\d+\b/i)?.[1]?.trim() || "";
    },
  },
  reality: {
    outputName: "reality",
    matches(name) {
      return /\bReality\b/i.test(name);
    },
    classOf(name) {
      return name.match(/^(.*?)\s+Reality(?:\s+Factor)?\s+X\s*\d+\b/i)?.[1]?.trim() || "";
    },
  },
  rhapsody: {
    outputName: "rhapsody",
    matches(name) {
      return /\bRhapsody\b/i.test(name);
    },
    classOf(name) {
      return name.match(/^(.*?)\s+Rhapsody\s+X\s*\d+\b/i)?.[1]?.trim() || "";
    },
  },
};

function parseArgs(argv) {
  const args = {
    type: "",
    inputPath,
    outputPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--type" && next) {
      args.type = next.toLowerCase();
      index += 1;
    } else if (arg === "--input" && next) {
      args.inputPath = path.resolve(next);
      index += 1;
    } else if (arg === "--out" && next) {
      args.outputPath = path.resolve(next);
      index += 1;
    }
  }

  if (args.type === "rhapshody") args.type = "rhapsody";
  if (!factorTypeMatchers[args.type]) {
    throw new Error(`Expected --type inspiration, reality, or rhapsody. Got: ${args.type || "(missing)"}`);
  }

  if (!args.outputPath) {
    args.outputPath = path.join(
      root,
      "DEV_exports",
      `${factorTypeMatchers[args.type].outputName}-factor-grade-descriptions.csv`,
    );
  }

  return args;
}

function slotOf(name) {
  const match = String(name ?? "").match(/\bX\s*(\d+)\b/i);
  return match ? `X${match[1]}` : "";
}

function cleanDescription(value) {
  return String(value ?? "")
    .replace(/<break\s*\/?\s*>/gi, ". ")
    .replace(/<br\s*\/?\s*>/gi, ". ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function csv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function factorSearchName(row) {
  return [
    row.familyName,
    ...Object.values(row.familyNames ?? {}),
  ].filter(Boolean).join(" ");
}

function isExpiredSeasonFactor(row) {
  const gradeRows = row.modifierEvidence?.gradeRows ?? [];
  const texts = [
    row.cleanDescriptions?.en,
    row.descriptions?.en,
    ...gradeRows.map((grade) => grade.cleanResolvedDescription),
  ].filter(Boolean).join(" ");

  return /expired\s+for\s+the\s+current\s+season/i.test(texts);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = JSON.parse(fs.readFileSync(args.inputPath, "utf8"));
  const matcher = factorTypeMatchers[args.type];
  const rows = [];

  for (const factor of Object.values(data.factorsByBuffId ?? {})
    .filter((row) => matcher.matches(factorSearchName(row)))
    .filter((row) => !isExpiredSeasonFactor(row))
    .sort((left, right) => (left.buffId ?? 0) - (right.buffId ?? 0))) {
    const factorName = factor.familyNames?.en || factor.familyName || `Factor ${factor.buffId}`;
    const gradeRows = factor.modifierEvidence?.gradeRows ?? [];

    for (const grade of [...gradeRows].sort((left, right) => (left.grade ?? 0) - (right.grade ?? 0))) {
      rows.push({
        class: matcher.classOf(factorName),
        factor: factorName,
        slot: slotOf(factorName),
        buff_id: factor.buffId,
        family_id: factor.familyId,
        description_id: factor.descriptionId,
        grade: grade.grade,
        grade_item_id: grade.itemId,
        item_quality_tier: grade.itemQualityTier,
        parameter_values: (grade.parameterValues ?? []).join("; "),
        resolved_values: (grade.valueTexts ?? []).join("; "),
        description_en: grade.cleanResolvedDescription ?? "",
        template_en: cleanDescription(factor.cleanDescriptions?.en || factor.descriptions?.en || ""),
        source_offset: grade.sourceOffset,
      });
    }
  }

  const headers = [
    "class",
    "factor",
    "slot",
    "buff_id",
    "family_id",
    "description_id",
    "grade",
    "grade_item_id",
    "item_quality_tier",
    "parameter_values",
    "resolved_values",
    "description_en",
    "template_en",
    "source_offset",
  ];

  const output = [
    headers.map(csv).join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(",")),
  ].join("\r\n") + "\r\n";

  fs.mkdirSync(path.dirname(args.outputPath), { recursive: true });
  fs.writeFileSync(args.outputPath, `\uFEFF${output}`, "utf8");

  console.log(
    `${args.outputPath} rows=${rows.length} factorIds=${new Set(rows.map((row) => row.buff_id)).size} factorNames=${new Set(rows.map((row) => row.factor)).size}`,
  );
}

main();
