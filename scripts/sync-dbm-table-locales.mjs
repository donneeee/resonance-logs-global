#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DBM_TABLE_PATH = path.resolve("parser-data/generated/DbmTable.json");
const SCRIPT_SOURCE = "scripts/sync-dbm-table-locales.mjs";
const LOCALES = ["de", "en", "es", "fr", "id", "ja", "ko-KR", "pt-BR", "th", "zh-CN", "zh-TW"];
const NON_CHINESE_LOCALES = LOCALES.filter((locale) => locale !== "zh-CN" && locale !== "zh-TW");
const CJK_PATTERN = /[\u3400-\u9fff]/;

const MANUAL_DBM_TRANSLATIONS = {
  3320110: { en: "Burrow", zhTW: "遁地" },
  3320111: { en: "Death Screech", zhTW: "死亡尖嘯" },
  3320120: { en: "Energy Absorption", zhTW: "能量吸收" },
  3320122: { en: "Charged Breath", zhTW: "聚能吐息" },
  3340102: { en: "Piercing Arrow", zhTW: "貫穿箭" },
  6920007: { en: "Pestilent Seed", zhTW: "惡疫之種" },
  6920010: { en: "Wicked Dive", zhTW: "惡之俯衝" },
  10140301: { en: "Frost Slam", zhTW: "冰霜重擊" },
  10140701: { en: "Weather Shift", zhTW: "天氣切換" },
  10141601: { en: "Frozen Vessel", zhTW: "冰封之器" },
  10240110: { en: "Release Void Erosion", zhTW: "解放虛蝕之力" },
  10240130: { en: "Void Erosion Ruin", zhTW: "虛蝕毀滅" },
  10240131: { en: "Void Erosion Banishment", zhTW: "虛蝕放逐" },
  10240132: { en: "Bindings Released", zhTW: "束縛解除" },
  10300105: { en: "Ashen Trail", zhTW: "燼滅軌跡" },
  10300106: { en: "Greater Flame Ring", zhTW: "大炎戒" },
  10300107: { en: "Confusion", zhTW: "迷亂" },
  10300108: { en: "Avatar of the End", zhTW: "終焉化身" },
  10300204: { en: "Flame Arc Slash", zhTW: "炎弧斬" },
  10300205: { en: "Eroding Flower Mark", zhTW: "蝕花刻印" },
  10300206: { en: "Crimson Lotus Waltz", zhTW: "紅蓮圓舞" },
  10300214: { en: "Heart-Eroding Seed", zhTW: "蝕心之種" },
  10300305: { en: "Prisonbreaker Mark", zhTW: "斷獄刻印" },
  10310010: { en: "Phantom: Final Singularity", zhTW: "幻·終焉奇點" },
  10310011: { en: "Annihilation Beam", zhTW: "湮滅光束" },
  10310012: { en: "Phantom Husk Sync", zhTW: "幻骸同調" },
  10320001: { en: "Phantom: Annihilation Orbital Cannon", zhTW: "幻·殲滅軌道炮" },
  10320005: { en: "Disintegration Shockwave", zhTW: "崩解震盪" },
  10330009: { en: "Preset Return", zhTW: "預置的歸途" },
  10330010: { en: "Causal Warp", zhTW: "因果折躍" },
  10330011: { en: "Final Symphony", zhTW: "終焉交響" },
  10330012: { en: "Divine Banishment", zhTW: "神之放逐" },
  10330013: { en: "Stacked Sentence", zhTW: "累刑宣告" },
  10330014: { en: "Link Trial", zhTW: "連結試煉" },
  10330016: { en: "Illusion Mapping", zhTW: "幻象映射" },
  11110501: { en: "Adhesive Bomb: Phantom", zhTW: "黏著彈·幻" },
  14013601: { en: "Wind Spirit Summon", zhTW: "風靈召喚" },
  14014401: { en: "Thunder Rend", zhTW: "裂雷" },
  17025601: { en: "Void Erosion Pierce", zhTW: "虛蝕穿刺" },
  30003101: { en: "Void Erosion Mark", zhTW: "虛蝕印記" },
  333010801: { en: "Omen of Ruin", zhTW: "毀滅徵兆" },
  333011001: { en: "Hatred Combo", zhTW: "恨意連擊" },
  333011401: { en: "Purifying Blast", zhTW: "淨化爆破" },
  338010101: { en: "Splintering Wind Blade", zhTW: "散裂風刃" },
  338010201: { en: "Crushing Bite", zhTW: "強力咬合" },
  338010401: { en: "Hunt", zhTW: "狩獵" },
  338010501: { en: "Mixed Combo", zhTW: "混合連擊" },
  338010601: { en: "Expanding Tornado", zhTW: "膨脹龍捲" },
  338010801: { en: "Wind Blade Call", zhTW: "風刃呼喚" },
  338010901: { en: "Compressed Hurricane", zhTW: "壓縮颶風" },
  338011001: { en: "Opportunistic Pounce", zhTW: "伺機飛撲" },
  339010101: { en: "Disintegration Beam", zhTW: "崩解光束" },
  404001401: { en: "Soul Pool Prayer", zhTW: "魂池祈禱" },
  405000601: { en: "Execution Dagger", zhTW: "斬殺之匕" },
  405001001: { en: "Undead Revival", zhTW: "亡靈還魂" },
  405001101: { en: "Soulbinding Chain", zhTW: "縛魂之鏈" },
  405001201: { en: "Infectious Laser", zhTW: "感染雷射" },
  405001301: { en: "Evil Spirit Gate", zhTW: "惡靈之門" },
  1027011601: { en: "Spacetime Collapse", zhTW: "時空坍縮" },
  1027011701: { en: "Twin Void Pact", zhTW: "虛空雙契" },
  1027011801: { en: "Purifying Light: Scatter", zhTW: "淨化之光·散" },
  1027011901: { en: "Spacetime Flash Strike", zhTW: "時空閃擊" },
  1027012001: { en: "End of Spacetime", zhTW: "時空的終焉" },
  1027012201: { en: "Radiant Seed", zhTW: "芒輝之種" },
  1027012301: { en: "Purifying Light: Gather", zhTW: "淨化之光·聚" },
  1027012401: { en: "Purifying Light: Scatter-Gather", zhTW: "淨化之光·散·聚" },
  1027012501: { en: "Purifying Light: Gather-Scatter", zhTW: "淨化之光·聚·散" },
  1028120201: { en: "Judgment Hour", zhTW: "裁定時刻" },
  1028120301: { en: "Phantom Dance: Charge", zhTW: "幻影之舞·衝" },
  1028120401: { en: "Guard to the Death", zhTW: "誓死守護" },
  1028120501: { en: "Territory Expulsion Order", zhTW: "領地驅逐指令" },
  1028120601: { en: "Territory Resonance", zhTW: "領地共鳴" },
  1028120701: { en: "Flame Shadow Annihilation", zhTW: "炎影湮滅" },
  1029011101: { en: "Earthshatter Punch", zhTW: "碎地重拳" },
  1029011401: { en: "Stone-Splitting Storm", zhTW: "裂石風暴" },
  1029012401: { en: "Earthshatter Punch: Combo", zhTW: "碎地重拳·連襲" },
};

function makeNames(entry, translation) {
  const design = entry.ContentDesign || entry.Contents?.design || entry.Names?.design || entry.Content;
  const names = {
    design,
    en: translation.en,
    "zh-CN": entry.Contents?.["zh-CN"] || entry.Names?.["zh-CN"] || design,
    "zh-TW": translation.zhTW,
  };

  for (const locale of NON_CHINESE_LOCALES) {
    names[locale] = translation.en;
  }

  return names;
}

function applyManualTranslations(data) {
  let changed = 0;
  for (const [id, translation] of Object.entries(MANUAL_DBM_TRANSLATIONS)) {
    const entry = data[id];
    if (!entry) {
      throw new Error(`Missing DBM row ${id} for manual translation ${translation.en}`);
    }

    const names = makeNames(entry, translation);
    entry.Content = translation.en;
    entry.Contents = names;
    entry.Names = { ...names };
    entry.LocalizationSource = SCRIPT_SOURCE;
    changed += 1;
  }
  return changed;
}

function untranslatedEnglishRows(data) {
  return Object.values(data).filter((entry) => {
    const en = String(entry?.Contents?.en || entry?.Names?.en || entry?.Content || "");
    return CJK_PATTERN.test(en);
  });
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const before = fs.readFileSync(DBM_TABLE_PATH, "utf8");
  const data = JSON.parse(before);
  const translated = applyManualTranslations(data);
  const remaining = untranslatedEnglishRows(data);

  if (remaining.length > 0) {
    const preview = remaining
      .slice(0, 12)
      .map((entry) => `${entry.Id}: ${entry.Contents?.en || entry.Content}`)
      .join("\n");
    throw new Error(`DBM table still has ${remaining.length} untranslated English row(s):\n${preview}`);
  }

  const after = `${JSON.stringify(data, null, 2)}\n`;
  if (checkOnly) {
    if (before !== after) {
      throw new Error(`DBM localization sync is out of date; run node ${SCRIPT_SOURCE}`);
    }
    console.log(`DBM localization check passed (${translated} manual translations).`);
    return;
  }

  if (before !== after) {
    fs.writeFileSync(DBM_TABLE_PATH, after);
  }
  console.log(`Synced ${translated} DBM manual translations.`);
}

main();
