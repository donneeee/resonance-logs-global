#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LOCALE_ROOT = path.join(ROOT, "src/lib/locales");
const OUTPUT_JSON = "parser-data/app-rules/season_cultivate_factor_skill_labels.json";
const REPORT_JSON = "DEV_exports/season-cultivate-factor-skill-labels.json";
const REPORT_MD = "DEV_exports/season-cultivate-factor-skill-labels.md";

const SOURCE_ID_OVERRIDES = {
  // The generated localized factor text calls this "Explosive Arrow", but the
  // configured skill cast and current Global skill table both identify 2238 as
  // Blast Shot. Keep the label tied to the ID, not the translated sentence.
  marksman_s3_x10: [2238],
};

const SOURCE_TEXT_OVERRIDES = {
  holy_shield_x3: "Expertise Skill",
};

const SLOT_TEXT_OVERRIDES = {
  giant_blade_s3_x6: "Class Skills",
};

const GENERIC_LABELS = {
  "Basic Attack": {
    en: "Basic Attack",
    "zh-CN": "普通攻击",
    "zh-TW": "普通攻擊",
    ja: "通常攻撃",
    "ko-KR": "일반 공격",
    fr: "Attaque normale",
    de: "Standardangriff",
    es: "Ataque normal",
    "pt-BR": "Ataque Básico",
    th: "Basic Attack",
    id: "Normal Attack",
  },
  Block: {
    en: "Block",
    "zh-CN": "格挡",
    "zh-TW": "格擋",
    ja: "レジスト",
    "ko-KR": "막기",
    fr: "Blocage",
    de: "Blocken",
    es: "Bloqueo",
    "pt-BR": "Bloqueio",
    th: "Block",
    id: "Block",
  },
  "Max HP": {
    en: "Max HP",
    "zh-CN": "生命上限",
    "zh-TW": "生命上限",
    ja: "最大HP",
    "ko-KR": "최대 HP",
    fr: "PV max",
    de: "Max. LP",
    es: "PS máximos",
    "pt-BR": "PV Máx.",
    th: "Max HP",
    id: "Max HP",
  },
  Ultimate: {
    en: "Ultimate",
    "zh-CN": "终极大招",
    "zh-TW": "終極大招",
    ja: "究極スキル",
    "ko-KR": "필살기",
    fr: "Ultime",
    de: "Ultimative",
    es: "Definitiva",
    "pt-BR": "Suprema",
    th: "Ultimate",
    id: "Ultimate",
  },
  "Performance Passion": {
    en: "Performance Passion",
    "zh-CN": "演奏热情",
    "zh-TW": "演奏熱情",
    ja: "熱響",
    "ko-KR": "연주 열정",
    fr: "Passion de performance",
    de: "Auftrittspassion",
    es: "Pasión escénica",
    "pt-BR": "Paixão de Performance",
    th: "Performance Passion",
    id: "Performance Passion",
  },
  "Illusion DMG": {
    en: "Illusion DMG",
    "zh-CN": "破妄伤害",
    "zh-TW": "破妄傷害",
    ja: "滅妄ダメージ",
    "ko-KR": "파망 대미지",
    fr: "DGT brise-illusion",
    de: "Illusionsbrechungs-SCH",
    es: "Daño rompeilusiones",
    "pt-BR": "Dano Quebra-Ilusão",
    th: "Illusion-Breaking DMG",
    id: "Sanity DMG",
  },
  "Expertise Skill": {
    en: "Expertise Skill",
    "zh-CN": "专精技能",
    "zh-TW": "專精技能",
    ja: "マスタリースキル",
    "ko-KR": "마스터리 스킬",
    fr: "Compétence d'expertise",
    de: "Expertisefähigkeit",
    es: "Habilidad de Pericia",
    "pt-BR": "Habilidade de Perícia",
    th: "Skill เฉพาะทาง",
    id: "Expertise Skill",
  },
  "Class Skills": {
    en: "Class Skills",
    "zh-CN": "èŒä¸šæŠ€èƒ½",
    "zh-TW": "è·æ¥­æŠ€èƒ½",
    ja: "ã‚¯ãƒ©ã‚¹ã‚­ãƒ«",
    "ko-KR": "í´ëž˜ìŠ¤ ìŠ¤í‚¬",
    fr: "CompÃ©tences de classe",
    de: "KlassenfÃ¤higkeiten",
    es: "Habilidades de clase",
    "pt-BR": "Habilidades de Classe",
    th: "Class Skills",
    id: "Skill Kelas",
  },
};

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf8"));
}

function writeJson(relPath, value) {
  const fullPath = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`);
}

function asRows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/<\s*(?:br|break)\s*\/?>/gi, ". ")
    .replace(/<\/\s*break\s*>/gi, ". ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\{\*[^}]+\*\}/g, " ")
    .replace(/\s*([.!?。！？])\s*\.\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\bclass skill(?:s)?\b/g, "")
    .replace(/\billusion-breaking\b/g, "")
    .replace(/\bvoid\b/g, "")
    .replace(/\bdmg\b/g, "")
    .replace(/\s*[-:]\s*/g, " ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLocaleDirs() {
  return fs
    .readdirSync(LOCALE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function loadLocalePanel(locale) {
  return readJson(`src/lib/locales/${locale}/ui/overlay/skill-monitor/custom-panel.json`);
}

function buildLocalePanels(locales) {
  const panels = new Map();
  for (const locale of locales) {
    panels.set(locale, loadLocalePanel(locale));
  }
  return panels;
}

function collectNames(row, locales) {
  const out = {};
  const names = row?.Names && typeof row.Names === "object" ? row.Names : {};
  for (const locale of locales) {
    const text = cleanText(names[locale]);
    if (text) out[locale] = text;
  }
  const fallback = cleanText(row?.Name) || cleanText(names.en);
  for (const locale of locales) {
    if (!out[locale] && fallback) out[locale] = fallback;
  }
  return out;
}

function fillLabel(locales, label) {
  const out = {};
  const fallback = cleanText(label.en) || cleanText(label["zh-CN"]);
  for (const locale of locales) {
    out[locale] = cleanText(label[locale]) || fallback;
  }
  return out;
}

function makeTextLabel(locales, text) {
  const clean = cleanText(text);
  const generic = GENERIC_LABELS[clean];
  if (generic) return fillLabel(locales, generic);
  const out = {};
  for (const locale of locales) out[locale] = clean;
  return out;
}

function buildGeneratedLabelIndexes(locales) {
  const skillRows = asRows(readJson("parser-data/generated/skillnames.json"));
  const buffRows = asRows(readJson("parser-data/generated/BuffName.json"));
  const byId = new Map();
  const nameIndex = new Map();

  function addName(row, sourceKind) {
    const label = collectNames(row, locales);
    const en = cleanText(label.en);
    if (!en) return;
    const keys = new Set([
      normalizeName(en),
      normalizeName(en.replace(/\s+-\s+.*$/, "")),
      normalizeName(en.replace(/\s+Charm$/i, "")),
      normalizeName(en.replace(/\s+Rewind$/i, "")),
    ]);
    for (const key of keys) {
      if (!key) continue;
      const existing = nameIndex.get(key) ?? [];
      existing.push({ label, sourceKind, en });
      nameIndex.set(key, existing);
    }
  }

  function addId(id, row) {
    const num = Number(id);
    if (!Number.isInteger(num) || num <= 0) return;
    if (!byId.has(num)) byId.set(num, []);
    byId.get(num).push(row);
  }

  for (const row of skillRows) {
    addId(row.Id, row);
    for (const id of row.RecountIds ?? []) addId(id, row);
    for (const id of row.DamageIds ?? []) addId(id, row);
    addName(row, "skill");
  }

  for (const row of buffRows) {
    addId(row.Id, row);
    addName(row, "buff");
  }

  return { byId, nameIndex };
}

function labelRowsByIds(indexes, ids, locales) {
  const rows = [];
  const seen = new Set();
  for (const id of ids) {
    const candidates = indexes.byId.get(Number(id)) ?? [];
    for (const row of candidates) {
      const label = collectNames(row, locales);
      const en = cleanText(label.en);
      const key = normalizeName(en);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(label);
    }
  }
  return combineLabels(rows, locales);
}

function collapseCommonHyphenPrefix(labels, locales) {
  const enValues = labels.map((item) => cleanText(item.en));
  const prefixes = enValues
    .map((value) => value.match(/^(.+?)\s+-\s+.+$/)?.[1]?.trim())
    .filter(Boolean);
  if (prefixes.length !== labels.length) return null;
  if (new Set(prefixes.map((value) => normalizeName(value))).size !== 1) {
    return null;
  }

  const out = {};
  for (const locale of locales) {
    const localePrefixes = labels
      .map((item) => cleanText(item[locale]).match(/^(.+?)\s+-\s+.+$/)?.[1]?.trim())
      .filter(Boolean);
    if (
      localePrefixes.length === labels.length &&
      new Set(localePrefixes.map((value) => normalizeName(value))).size === 1
    ) {
      out[locale] = localePrefixes[0];
    } else {
      out[locale] = prefixes[0];
    }
  }
  return fillLabel(locales, out);
}

function combineLabels(labels, locales) {
  const cleanLabels = labels.filter((label) => cleanText(label.en));
  if (cleanLabels.length === 0) return null;
  if (cleanLabels.length === 1) return fillLabel(locales, cleanLabels[0]);

  const collapsed = collapseCommonHyphenPrefix(cleanLabels, locales);
  if (collapsed) return collapsed;

  const out = {};
  for (const locale of locales) {
    const seen = new Set();
    const values = [];
    for (const label of cleanLabels) {
      const text = cleanText(label[locale]) || cleanText(label.en);
      const key = normalizeName(text);
      if (!text || seen.has(key)) continue;
      seen.add(key);
      values.push(text);
    }
    out[locale] = values.join(" / ");
  }
  return fillLabel(locales, out);
}

function lookupTextLabel(indexes, text, locales) {
  const clean = cleanText(text)
    .replace(/\bEffect$/i, "")
    .replace(/\bstate$/i, "")
    .trim();
  if (!clean) return null;
  const direct = GENERIC_LABELS[clean];
  if (direct) return fillLabel(locales, direct);

  const candidates = [
    clean,
    clean.replace(/\b(?:charge|count|stack|stacks)$/i, "").trim(),
    clean.replace(/\s+Charm$/i, "").trim(),
  ]
    .map(normalizeName)
    .filter(Boolean);

  for (const key of candidates) {
    const hits = indexes.nameIndex.get(key);
    if (hits?.length) {
      hits.sort((left, right) => {
        const leftSkill = left.sourceKind === "skill" ? 0 : 1;
        const rightSkill = right.sourceKind === "skill" ? 0 : 1;
        if (leftSkill !== rightSkill) return leftSkill - rightSkill;
        return cleanText(left.en).length - cleanText(right.en).length;
      });
      return fillLabel(locales, hits[0].label);
    }
  }

  const looseKey = normalizeName(clean);
  if (looseKey.length >= 4) {
    const looseHits = [];
    for (const [key, hits] of indexes.nameIndex.entries()) {
      if (key.startsWith(looseKey) || looseKey.startsWith(key)) {
        looseHits.push(...hits);
      }
    }
    if (looseHits.length) {
      looseHits.sort((left, right) => {
        const leftSkill = left.sourceKind === "skill" ? 0 : 1;
        const rightSkill = right.sourceKind === "skill" ? 0 : 1;
        if (leftSkill !== rightSkill) return leftSkill - rightSkill;
        return cleanText(left.en).length - cleanText(right.en).length;
      });
      return fillLabel(locales, looseHits[0].label);
    }
  }

  return makeTextLabel(locales, clean);
}

function splitNamedList(value) {
  const clean = cleanText(value)
    .replace(/\s+\(.*?\)/g, "")
    .replace(/\s+during\s+.+$/i, "")
    .replace(/\band\b/g, ",")
    .replace(/\bor\b/g, ",")
    .trim();
  return clean
    .split(/\s*,\s*|\s*\/\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 48);
}

function labelFromTextList(indexes, text, locales) {
  const parts = splitNamedList(text);
  const labels = [];
  for (const part of parts) {
    const label = lookupTextLabel(indexes, part, locales);
    if (label) labels.push(label);
  }
  return combineLabels(labels, locales) ?? lookupTextLabel(indexes, text, locales);
}

function getSourceIds(source) {
  if (source.skillCast) return source.skillCast.skillBaseIds ?? [];
  if (source.skillCastComplete) return source.skillCastComplete.skillBaseIds ?? [];
  if (source.skillDurationTick) return [source.skillDurationTick.skillBaseId];
  if (source.damageBySkillKey) return source.damageBySkillKey.skillKeys ?? [];
  if (source.damageBySkillKeyOnce) return source.damageBySkillKeyOnce.skillKeys ?? [];
  if (source.damageBySkillKeySelfTarget) return source.damageBySkillKeySelfTarget.skillKeys ?? [];
  if (source.damageTaken) return source.damageTaken.skillKeys ?? [];
  return [];
}

function extractSourceText(description) {
  const text = cleanText(description);
  const patterns = [
    /(?:Casting|cast of)\s+([^.;,()]+?)\s+grants\s+Illusion Energy/i,
    /Dealing damage with\s+([^.;()]+?)(?:\s+\(|\s+grants|$)/i,
    /^When\s+([^.;,()]+?)\s+hits/i,
    /^When in the\s+([^.;,]+?),/i,
    /^When HP is above.*?increases\s+([^.;,]+?)\s+by/i,
    /^([^.;]+?)\s+restores\s+/i,
    /^([^.;]+?)\s+ignore\s+/i,
    /^([^.;]+?)\s+charge count/i,
    /^([^.;]+?)\s+Illusion-Breaking DMG/i,
    /While\s+([^.;,]+?)\s+is active/i,
    /While in\s+([^.;,]+?)\s+state/i,
    /A successful\s+([^.;,]+?)\s+grants/i,
    /Triggering\s+([^.;,]+?)\s+grants/i,
    /Gaining\s+([^.;,]+?)\s+grants/i,
  ];
  for (const pattern of patterns) {
    const match = text
      .match(pattern)?.[1]?.trim()
      .replace(/\s+if\s+.+$/i, "")
      .trim();
    if (match && isUsefulLabelText(match)) return match;
  }
  return null;
}

function extractSlotText(description) {
  const text = cleanText(description);
  const patterns = [
    /restores?\s+\d+\s+([^.;,]+?)\s+the next time/i,
    /next cast of\s+([^.;,]+?)\s+(?:does|restores|is|,|\.|$)/i,
    /the next\s+([^.;,]+?)'s\s+AoE/i,
    /the final shield value of the next\s+(shield)/i,
    /the next\s+(Ultimate)\s+is/i,
    /(?:^|,\s*)triggers?\s+([^.;,]+?)(?:;|\.|,|$)/i,
    /remaining CDs? of\s+(?:the\s+)?([^.;,]+?)\s+(?:are|is)\s+reduced/i,
    /reduces? the remaining CD of\s+(?:the\s+)?([^.;,]+?)(?:\s+by|;|\.|,|$)/i,
    /dealing damage(?:\s+to\s+a\s+target)?\s+triggers?\s+([^.;,]+?)(?:\s+and|;|\.|,|$)/i,
    /^When Illusion Energy reaches points,\s+([^.;,]+?)\s+can trigger/i,
    /dealing damage summons?\s+(?:a|an|the)?\s*([^.;,]+?)(?:\s+at|;|\.|,|$)/i,
    /casts?\s+([^.;,]+?)(?:\s+forward|;|\.|,|$)/i,
    /summons?\s+(?:a|an|the)?\s*([^.;,]+?)(?:\s+to|\s+for|;|\.|,|$)/i,
    /(?:a|an|the)\s+([^.;,]+?)\s+is spawned/i,
    /gains?\s+(?:a|an|the)?\s*([^.;,]+?)(?:\s+equal|\s+for|;|\.|,|$)/i,
    /reduces? the remaining CD of\s+([^.;,]+?)(?:\s+by|;|\.|,|$)/i,
    /next cast of\s+([^.;,]+?)(?:\s+restores|\s+does|\s+is|,|\.|$)/i,
    /the next\s+([^.;,]+?)\s+has/i,
    /the next\s+([^.;,]+?)\s+consumes/i,
    /during the next\s+([^.;,]+?)(?:,|\s+)/i,
    /casting\s+([^.;,]+?)\s+adds/i,
    /grants?\s+(?:\d+\s+additional\s+|\d+\s+)?([^.;,]+?)(?:\s+\(|\s+for|\s+and|;|\.|,|$)/i,
    /^When Illusion Energy reaches points,\s+([^.;,]+?)\s+Final DMG/i,
    /^When Illusion Energy reaches points,\s+([^.;,]+?)\s+gains/i,
    /^When Illusion Energy reaches points,\s+([^.;,]+?)\s+increases/i,
    /^When Illusion Energy reaches points,\s+([^.;,]+?)\s+is/i,
    /the next\s+([^.;,]+?)\s+is/i,
    /for the next\s+[^,]+,\s+([^.;,]+?)\s+/i,
  ];
  for (const pattern of patterns) {
    const match = text
      .match(pattern)?.[1]?.trim()
      .replace(/\s+if\s+.+$/i, "")
      .trim();
    if (match && isUsefulLabelText(match)) return match;
  }
  if (/the final shield value of the next shield/i.test(text)) return "Shield";
  if (/next ultimate/i.test(text)) return "Ultimate";
  if (/Illusion DMG Reduction.+Illusion DMG/i.test(text)) return "Illusion DMG";
  return null;
}

function isUsefulLabelText(text) {
  const clean = cleanText(text);
  if (!clean || clean.length > 80) return false;
  return !/^(?:Illusion Energy|Illusion|DMG|ATK|MATK|HP|Crit|Class Skills|battle|points|at most once within|Energy)$/i.test(clean);
}

function localizedTemplateText(panels, locales, kind, id, field, fallback) {
  const out = {};
  const key = `${kind}Template.${id}.${field}`;
  for (const locale of locales) {
    out[locale] = cleanText(panels.get(locale)?.[key]) || cleanText(fallback);
  }
  return fillLabel(locales, out);
}

function buildSourceEntry(template, panels, indexes, locales) {
  const overrideText = SOURCE_TEXT_OVERRIDES[template.sourceId];
  if (overrideText) {
    return {
      label: lookupTextLabel(indexes, overrideText, locales) ?? makeTextLabel(locales, overrideText),
      evidence: {
        kind: "sourceTextOverride",
        text: overrideText,
      },
    };
  }

  const overrideIds = SOURCE_ID_OVERRIDES[template.sourceId];
  const exactIds = overrideIds ?? getSourceIds(template.source);
  const exactLabel = labelRowsByIds(indexes, exactIds, locales);
  if (exactLabel) {
    return {
      label: exactLabel,
      evidence: {
        kind: overrideIds ? "sourceIdOverride" : "sourceIds",
        ids: exactIds,
      },
    };
  }

  const enDescription = localizedTemplateText(
    panels,
    locales,
    "source",
    template.sourceId,
    "description",
    template.description,
  ).en;
  const text = extractSourceText(enDescription);
  const label = text ? labelFromTextList(indexes, text, locales) : null;
  if (!label) return null;
  return {
    label,
    evidence: {
      kind: "descriptionText",
      text,
    },
  };
}

function isRealitySlot(template, panels, locales) {
  const enName = localizedTemplateText(
    panels,
    locales,
    "slot",
    template.slotTemplateId,
    "name",
    template.name,
  ).en;
  return /\bReality Factor\b/i.test(enName);
}

function buildSlotEntry(template, panels, indexes, locales) {
  if (!isRealitySlot(template, panels, locales)) return null;
  const overrideText = SLOT_TEXT_OVERRIDES[template.slotTemplateId];
  if (overrideText) {
    return {
      label: lookupTextLabel(indexes, overrideText, locales) ?? makeTextLabel(locales, overrideText),
      evidence: {
        kind: "slotTextOverride",
        text: overrideText,
      },
    };
  }

  const enDescription = localizedTemplateText(
    panels,
    locales,
    "slot",
    template.slotTemplateId,
    "description",
    template.description,
  ).en;
  const text = extractSlotText(enDescription);
  const label = text ? labelFromTextList(indexes, text, locales) : null;
  if (!label) return null;
  return {
    label,
    evidence: {
      kind: "descriptionText",
      text,
    },
  };
}

function sortedObject(entries) {
  return Object.fromEntries(
    Object.entries(entries).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sameJson(left, right) {
  return JSON.stringify(left, null, 2) === JSON.stringify(right, null, 2);
}

function writeReport(report) {
  writeJson(REPORT_JSON, report);
  const lines = [];
  lines.push("# Season Cultivate Factor Skill Label Bridge");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push(`Status: ${report.errors.length === 0 ? "pass" : "fail"}`);
  lines.push("");
  lines.push("## Coverage");
  lines.push("");
  lines.push(`- Source templates: ${report.coverage.sources.withLabels}/${report.coverage.sources.total}`);
  lines.push(`- Reality slot templates: ${report.coverage.slots.withLabels}/${report.coverage.slots.total}`);
  lines.push(`- Locales: ${report.locales.join(", ")}`);
  lines.push("");
  lines.push("## Source Evidence");
  lines.push("");
  for (const [kind, count] of Object.entries(report.coverage.sources.evidenceKinds)) {
    lines.push(`- ${kind}: ${count}`);
  }
  lines.push("");
  lines.push("## Slot Evidence");
  lines.push("");
  for (const [kind, count] of Object.entries(report.coverage.slots.evidenceKinds)) {
    lines.push(`- ${kind}: ${count}`);
  }
  if (report.coverage.sources.missing.length || report.coverage.slots.missing.length) {
    lines.push("");
    lines.push("## Missing");
    lines.push("");
    for (const sourceId of report.coverage.sources.missing) {
      lines.push(`- source ${sourceId}`);
    }
    for (const slotTemplateId of report.coverage.slots.missing) {
      lines.push(`- slot ${slotTemplateId}`);
    }
  }
  fs.writeFileSync(path.join(ROOT, REPORT_MD), `${lines.join("\n")}\n`);
}

function countEvidence(entries) {
  const counts = {};
  for (const entry of Object.values(entries)) {
    const kind = entry.evidence?.kind ?? "unknown";
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const locales = getLocaleDirs();
  const panels = buildLocalePanels(locales);
  const indexes = buildGeneratedLabelIndexes(locales);
  const sourceTemplates = asRows(readJson("parser-data/app-rules/counter_source_templates.json"));
  const slotTemplates = asRows(readJson("parser-data/app-rules/counter_slot_templates.json"));

  const sources = {};
  const missingSources = [];
  for (const template of sourceTemplates) {
    const entry = buildSourceEntry(template, panels, indexes, locales);
    if (entry) {
      sources[template.sourceId] = entry;
    } else {
      missingSources.push(template.sourceId);
    }
  }

  const slots = {};
  const realitySlots = [];
  const missingSlots = [];
  for (const template of slotTemplates) {
    if (!isRealitySlot(template, panels, locales)) continue;
    realitySlots.push(template.slotTemplateId);
    const entry = buildSlotEntry(template, panels, indexes, locales);
    if (entry) {
      slots[template.slotTemplateId] = entry;
    } else {
      missingSlots.push(template.slotTemplateId);
    }
  }

  const output = {
    version: 1,
    sources: sortedObject(sources),
    slots: sortedObject(slots),
  };
  const report = {
    generatedAt: new Date().toISOString(),
    locales,
    coverage: {
      sources: {
        total: sourceTemplates.length,
        withLabels: Object.keys(sources).length,
        missing: missingSources,
        evidenceKinds: countEvidence(sources),
      },
      slots: {
        total: realitySlots.length,
        withLabels: Object.keys(slots).length,
        missing: missingSlots,
        evidenceKinds: countEvidence(slots),
      },
    },
    errors: [
      ...(missingSources.length ? ["missing source labels"] : []),
      ...(missingSlots.length ? ["missing reality slot labels"] : []),
    ],
  };

  if (checkOnly) {
    const current = fs.existsSync(path.join(ROOT, OUTPUT_JSON))
      ? readJson(OUTPUT_JSON)
      : null;
    if (!sameJson(current, output)) {
      console.error(`${OUTPUT_JSON} is out of date; run npm run sync:season-cultivate:labels`);
      process.exitCode = 1;
    }
  } else {
    writeJson(OUTPUT_JSON, output);
    writeReport(report);
  }

  console.log(
    `sources ${report.coverage.sources.withLabels}/${report.coverage.sources.total}; reality slots ${report.coverage.slots.withLabels}/${report.coverage.slots.total}`,
  );
  if (report.errors.length) {
    console.error(report.errors.join("; "));
    process.exitCode = 1;
  }
}

main();
