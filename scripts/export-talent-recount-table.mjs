import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const generatedDir = path.join(repoRoot, 'parser-data', 'generated');
const outputDir = path.join(generatedDir, 'talent-recount');

const readJson = (relativePath) => {
  const fullPath = path.join(repoRoot, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
};

const writeJson = (fullPath, value) => {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`);
};

const uniqueSorted = (values) => {
  return Array.from(new Set(values.filter((value) => value !== undefined && value !== null)))
    .sort((a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b));
    });
};

const cleanText = (value) => {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<br\s*\/?>/gi, '. ')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\*Decision\.[^}]+\*\}/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+\./g, '.')
    .trim();
};

const englishTextFor = (row) => {
  return cleanText(
    row?.cleanDescription ||
      row?.description ||
      row?.cleanDescriptions?.en ||
      row?.descriptions?.en ||
      '',
  );
};

const allLocaleTextFor = (row) => {
  const values = [];
  for (const source of [row?.cleanDescriptions, row?.descriptions]) {
    if (!source || typeof source !== 'object') continue;
    for (const value of Object.values(source)) {
      values.push(cleanText(value));
    }
  }
  return values.join(' ');
};

const hasAny = (text, patterns) => patterns.some((pattern) => pattern.test(text));

const semanticPatterns = {
  cooldownAcceleration: [
    /\bcd boost\b/i,
    /\bcooldown acceleration\b/i,
    /\bcooldown accelerate\b/i,
    /\bcooldown speed\b/i,
    /\bcd acceleration\b/i,
    /\bcdr boost\b/i,
    /冷却加速/,
    /冷卻加速/,
  ],
  flatCooldownReduction: [
    /\breduces? (?:the )?(?:remaining )?(?:cd|cooldown)\b/i,
    /\b(?:cd|cooldown).{0,36}(?:reduced|reduction|reduce)/i,
    /-\s*\d+(?:\.\d+)?s\b/i,
    /减少.{0,24}冷却/,
    /減少.{0,24}冷卻/,
  ],
  percentCooldownReduction: [
    /\breduces? (?:the )?(?:cd|cooldown).{0,28}\d+(?:\.\d+)?%/i,
    /\b(?:cd|cooldown).{0,36}(?:reduced|reduction|reduce).{0,28}\d+(?:\.\d+)?%/i,
    /冷却.{0,24}\d+(?:\.\d+)?%/,
    /冷卻.{0,24}\d+(?:\.\d+)?%/,
  ],
  cooldownDuration: [
    /\bduration\b/i,
    /\bfor \d+(?:\.\d+)?s\b/i,
    /\blasts? \d+(?:\.\d+)?s\b/i,
    /持续/,
    /持續/,
  ],
  hasteScaled: [/\bhaste\b/i, /急速/, /celeridade/i, /c[eé]l[eé]rit[eé]/i, /tempo/i],
  stackScaled: [/\bstack/i, /\blayer/i, /层/, /層/],
  resourceSpend: [/\bconsume/i, /\bspend/i, /\bcost\b/i, /\bresource\b/i, /消耗/],
  lucky: [/\blucky\b/i, /\bluck\b/i, /幸运/, /幸運/],
  crit: [/\bcrit/i, /暴击/, /暴擊/],
  procTrigger: [/\btrigger/i, /\bproc/i, /\bwhen\b/i, /触发/, /觸發/],
};

const classifySemantics = (row, ownership) => {
  const english = englishTextFor(row);
  const localeText = allLocaleTextFor(row);
  const text = `${english} ${localeText} ${ownership?.name || ''}`;
  const tags = [];
  for (const [tag, patterns] of Object.entries(semanticPatterns)) {
    if (hasAny(text, patterns)) tags.push(tag);
  }
  const hasFlatSecondReduction = hasAny(text, [
    /-\s*\d+(?:\.\d+)?s\b/i,
    /\b(?:remaining )?(?:cd|cooldown).{0,40}\d+(?:\.\d+)?s\b/i,
    /\b\d+(?:\.\d+)?s\b.{0,40}(?:remaining )?(?:cd|cooldown)/i,
  ]);
  if (
    tags.includes('flatCooldownReduction') &&
    tags.includes('percentCooldownReduction') &&
    !hasFlatSecondReduction
  ) {
    tags.splice(tags.indexOf('flatCooldownReduction'), 1);
  }

  const cooldownRuleCandidates = [];
  if (tags.includes('cooldownAcceleration')) {
    cooldownRuleCandidates.push({
      kind: 'cooldownAcceleration',
      status: 'needs-runtime-bridge',
      reason: 'description mentions cooldown/CD boost or cooldown acceleration',
    });
  }
  if (tags.includes('flatCooldownReduction')) {
    cooldownRuleCandidates.push({
      kind: 'flatCooldownReduction',
      status: 'needs-runtime-bridge',
      reason: 'description mentions flat/remaining cooldown reduction',
    });
  }
  if (tags.includes('percentCooldownReduction')) {
    cooldownRuleCandidates.push({
      kind: 'percentCooldownReduction',
      status: 'needs-runtime-bridge',
      reason: 'description mentions percent cooldown reduction',
    });
  }
  if (tags.includes('cooldownDuration')) {
    cooldownRuleCandidates.push({
      kind: 'durationOrTimer',
      status: 'evidence-only',
      reason: 'description mentions duration or timed state',
    });
  }

  return {
    tags,
    cooldownRuleCandidates,
  };
};

const inferSpecIds = (talent, classRow) => {
  if (!classRow) return [];
  if (talent.ownershipKind === 'class-wide-candidate') {
    return classRow.specIds || [];
  }

  const ids = [];
  const fields = [
    talent.specId,
    talent.ownerSpecId,
    talent.specSelectorId,
    talent.specInteractionId,
    talent.specLeaningId,
  ];
  for (const value of fields) {
    if (Number.isFinite(value)) ids.push(value);
  }
  for (const key of ['specIds', 'ownerSpecIds', 'hardFilterSpecIds', 'candidateSpecIds']) {
    if (Array.isArray(talent[key])) ids.push(...talent[key]);
  }

  return uniqueSorted(ids);
};

const ownership = readJson('parser-data/generated/TalentSpecOwnership.json');
const seasonDescriptions = readJson('parser-data/generated/SeasonEffectDescriptions.json');

const classesById = ownership.classesById || {};
const specsById = ownership.specsById || {};
const talentsById = ownership.talentsById || {};
const descriptionsByBuffId = new Map();
for (const row of seasonDescriptions.rows || []) {
  const ids = [row.id, row.Id, row.buffId, row.observedBuffId].filter((id) => Number.isFinite(id));
  for (const id of ids) {
    if (!descriptionsByBuffId.has(id)) descriptionsByBuffId.set(id, []);
    descriptionsByBuffId.get(id).push(row);
  }
}

const recountTalentsById = {};
const byClassSpec = {};
let descriptionRowsLinked = 0;
let cooldownRelevantCount = 0;

for (const [talentIdString, talent] of Object.entries(talentsById)) {
  const talentId = Number(talentIdString);
  const classId = talent.classId ?? 0;
  const classRow = classesById[String(classId)];
  const specIds = inferSpecIds(talent, classRow);
  const descriptionRows = [];
  for (const sourceBuffId of talent.sourceBuffIds || []) {
    descriptionRows.push(...(descriptionsByBuffId.get(sourceBuffId) || []));
  }
  if (!descriptionRows.length) {
    descriptionRows.push(...(descriptionsByBuffId.get(talentId) || []));
  }
  const uniqueDescriptionRows = Array.from(
    new Map(
      descriptionRows.map((row) => [
        `${row.buffId ?? row.id ?? row.Id}:${row.descriptionId ?? row.DescriptionId ?? ''}:${row.sourceRow ?? ''}`,
        row,
      ]),
    ).values(),
  );
  descriptionRowsLinked += uniqueDescriptionRows.length ? 1 : 0;

  const primaryDescription = uniqueDescriptionRows[0] || null;
  const semantic = classifySemantics(primaryDescription, talent);
  if (semantic.cooldownRuleCandidates.length) cooldownRelevantCount += 1;

  const linkedTerms = uniqueSorted([
    ...(talent.linkedSkillTerms || []),
    ...uniqueDescriptionRows.flatMap((row) => (row.linkTexts || []).map((link) => link.label)),
  ]);

  const sourceBuffIds = uniqueSorted([
    ...(talent.sourceBuffIds || []),
    ...uniqueDescriptionRows.map((row) => row.buffId).filter(Number.isFinite),
  ]);

  const recountRow = {
    talentId,
    name: talent.name,
    names: talent.names || {},
    classId,
    className: talent.className || classRow?.className || null,
    classNames: talent.classNames || classRow?.classNames || {},
    specIds,
    specs: specIds.map((specId) => {
      const spec = specsById[String(specId)] || {};
      return {
        specId,
        specName: spec.specName || null,
        specNames: spec.specNames || {},
      };
    }),
    ownershipKind: talent.ownershipKind || 'unknown',
    ownershipStatus: talent.ownershipStatus || 'unknown',
    confidence: talent.confidence ?? null,
    hardFilterEligible: talent.hardFilterEligible === true,
    sourceBuffIds,
    linkedTerms,
    dpsRelevance: talent.dpsRelevance || null,
    description: primaryDescription ? englishTextFor(primaryDescription) : null,
    descriptions: primaryDescription?.cleanDescriptions || null,
    descriptionParagraphs: primaryDescription?.descriptionParagraphs || [],
    descriptionParagraphsByLocale: primaryDescription?.descriptionParagraphsByLocale || {},
    valueTexts: uniqueSorted(uniqueDescriptionRows.flatMap((row) => row.valueTexts || [])),
    semanticTags: semantic.tags,
    cooldownRuleCandidates: semantic.cooldownRuleCandidates,
    evidence: {
      ownershipSource: 'TalentSpecOwnership.json',
      descriptionBuffIds: uniqueDescriptionRows.map((row) => row.buffId).filter(Number.isFinite),
      descriptionRows: uniqueDescriptionRows.map((row) => ({
        buffId: row.buffId,
        descriptionId: row.descriptionId,
        sourceRow: row.sourceRow,
      })),
    },
  };

  recountTalentsById[talentIdString] = recountRow;

  const classKey = String(classId);
  if (!byClassSpec[classKey]) {
    byClassSpec[classKey] = {
      classId,
      className: recountRow.className,
      classNames: recountRow.classNames,
      classTalentIds: [],
      specs: {},
    };
  }
  if (talent.ownershipKind === 'class-wide-candidate' || !specIds.length) {
    byClassSpec[classKey].classTalentIds.push(talentId);
  }
  for (const specId of specIds) {
    const specKey = String(specId);
    if (!byClassSpec[classKey].specs[specKey]) {
      const spec = specsById[specKey] || {};
      byClassSpec[classKey].specs[specKey] = {
        specId,
        specName: spec.specName || null,
        specNames: spec.specNames || {},
        talentIds: [],
      };
    }
    byClassSpec[classKey].specs[specKey].talentIds.push(talentId);
  }
}

for (const classSlice of Object.values(byClassSpec)) {
  classSlice.classTalentIds = uniqueSorted(classSlice.classTalentIds);
  for (const specSlice of Object.values(classSlice.specs)) {
    specSlice.talentIds = uniqueSorted(specSlice.talentIds);
  }
}

const master = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    ownership: 'parser-data/generated/TalentSpecOwnership.json',
    descriptions: 'parser-data/generated/SeasonEffectDescriptions.json',
  },
  runtimeBoundary:
    'This is a compact evidence/recount table. Runtime should load the local class/spec slice, then apply only rules that are explicitly bridged to selected talent/effect state.',
  summary: {
    talentCount: Object.keys(recountTalentsById).length,
    classCount: Object.keys(byClassSpec).length,
    descriptionRowsLinked,
    cooldownRelevantCount,
  },
  byClassSpec,
  talentsById: recountTalentsById,
};

writeJson(path.join(generatedDir, 'TalentRecountTable.json'), master);

for (const [classId, classSlice] of Object.entries(byClassSpec)) {
  const talentIds = uniqueSorted([
    ...classSlice.classTalentIds,
    ...Object.values(classSlice.specs).flatMap((spec) => spec.talentIds),
  ]);
  const talents = {};
  for (const talentId of talentIds) {
    talents[String(talentId)] = recountTalentsById[String(talentId)];
  }
  writeJson(path.join(outputDir, `class-${classId}.json`), {
    schemaVersion: master.schemaVersion,
    generatedAt: master.generatedAt,
    runtimeBoundary: master.runtimeBoundary,
    class: classSlice,
    talentsById: talents,
  });
}

const cooldownRows = Object.values(recountTalentsById)
  .filter((row) => row.cooldownRuleCandidates.length)
  .map((row) => ({
    talentId: row.talentId,
    name: row.name,
    className: row.className,
    specIds: row.specIds,
    semanticTags: row.semanticTags,
    cooldownRuleCandidates: row.cooldownRuleCandidates,
    description: row.description,
  }));

writeJson(path.join(repoRoot, 'DEV_exports', 'talent-recount-cooldown-candidates.json'), {
  generatedAt: master.generatedAt,
  count: cooldownRows.length,
  rows: cooldownRows,
});

console.log(`Wrote parser-data/generated/TalentRecountTable.json (${master.summary.talentCount} talents)`);
console.log(`Wrote ${Object.keys(byClassSpec).length} parser-data/generated/talent-recount/class-*.json slices`);
console.log(`Wrote DEV_exports/talent-recount-cooldown-candidates.json (${cooldownRows.length} candidates)`);
