import type { LocaleCode, MultiLangValue } from "$lib/i18n";

export type EquippedItem = {
  slot: number;
  itemConfigId: number;
  itemUuid?: number | null;
  packageKey?: number | null;
  packageType?: number | null;
  itemQuality?: number | null;
  equipSlotRefineLevel?: number | null;
  breakThroughTime?: number | null;
  perfectionLevel?: number | null;
  runtimeSource?: string;
};

export type OceanWeaponInfo = {
  item: EquippedItem;
  itemId: number;
  level: number;
  baseLevel: number;
  maxLevel: number;
  levelSource: "itemInstance" | "configFamily";
  names: MultiLangValue;
};

export const WEAPON_SLOT = 200;

type OceanWeaponMeta = {
  baseLevel: number;
  maxLevel: number;
  breakthroughSteps: readonly number[];
  names: MultiLangValue;
};

const FAR_SEA_BREAKTHROUGH_STEPS = [40, 20, 20] as const;
const EMBER_FAR_SEA_BREAKTHROUGH_STEPS = [20, 20, 20] as const;

const OCEAN_WEAPON_BY_ITEM_ID: Record<number, OceanWeaponMeta> = {
  2000617: { baseLevel: 100, maxLevel: 180, breakthroughSteps: FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Shadow of the Far Sea", "zh-CN": "遥远之海的断影", "zh-TW": "遙遠之海的斷影", ja: "蒼海の断片", "ko-KR": "머나먼 바다의 단영", fr: "Ombre de la mer lointaine", de: "Schatten der Fernen See", es: "Sombra del Mar Lejano", "pt-BR": "Sombra do Mar Distante", id: "Shadowbreak of Far Sea" } },
  2000618: { baseLevel: 100, maxLevel: 180, breakthroughSteps: FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Revelation of the Far Sea", "zh-CN": "遥远之海的启示", "zh-TW": "遙遠之海的啟示", ja: "蒼海の神託", "ko-KR": "머나먼 바다의 계시", fr: "Révélation de la mer lointaine", de: "Offenbarung der Fernen See", es: "Revelación del Mar Lejano", "pt-BR": "Revelação do Mar Distante", id: "Revelation of Far Sea" } },
  2000619: { baseLevel: 100, maxLevel: 180, breakthroughSteps: FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Wish of the Far Sea", "zh-CN": "遥远之海的祈愿", "zh-TW": "遙遠之海的祈願", ja: "蒼海の祈祷", "ko-KR": "머나먼 바다의 기도", fr: "Voeu de la mer lointaine", de: "Wunsch der Fernen See", es: "Deseo del Mar Lejano", "pt-BR": "Desejo do Mar Distante", id: "Wish of Far Sea" } },
  2000620: { baseLevel: 100, maxLevel: 180, breakthroughSteps: FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Grace of the Far Sea", "zh-CN": "遥远之海的恩典", "zh-TW": "遙遠之海的恩典", ja: "蒼海の恩寵", "ko-KR": "머나먼 바다의 은혜", fr: "Grace de la mer lointaine", de: "Gnade der Fernen See", es: "Gracia del Mar Lejano", "pt-BR": "Graça do Mar Distante", id: "Grace of Far Sea" } },
  2000621: { baseLevel: 100, maxLevel: 180, breakthroughSteps: FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Waiting of the Far Sea", "zh-CN": "遥远之海的守候", "zh-TW": "遙遠之海的守候", ja: "蒼海の守護", "ko-KR": "머나먼 바다의 수호", fr: "Attente de la mer lointaine", de: "Wacht der Fernen See", es: "Vigilia del Mar Lejano", "pt-BR": "Vigília do Mar Distante", id: "Watch of Far Sea" } },
  2000622: { baseLevel: 100, maxLevel: 180, breakthroughSteps: FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Gaze of the Far Sea", "zh-CN": "遥远之海的远眺", "zh-TW": "遙遠之海的遠眺", ja: "蒼海の天望", "ko-KR": "머나먼 바다의 관망", fr: "Regard de la mer lointaine", de: "Blick der Fernen See", es: "Mirada del Mar Lejano", "pt-BR": "Olhar do Mar Distante", id: "View of Far Sea" } },
  2000623: { baseLevel: 100, maxLevel: 180, breakthroughSteps: FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Vow of the Far Sea", "zh-CN": "遥远之海的誓约", "zh-TW": "遙遠之海的誓約", ja: "蒼海の誓い", "ko-KR": "머나먼 바다의 서약", fr: "Serment de la mer lointaine", de: "Schwur der Fernen See", es: "Voto del Mar Lejano", "pt-BR": "Voto do Mar Distante", id: "Oath of Far Sea" } },
  2000624: { baseLevel: 100, maxLevel: 180, breakthroughSteps: FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Hymn of the Far Sea", "zh-CN": "遥远之海的颂歌", "zh-TW": "遙遠之海的頌歌", ja: "蒼海の讃歌", "ko-KR": "머나먼 바다의 송가", fr: "Hymne de la mer lointaine", de: "Hymne der Fernen See", es: "Himno del Mar Lejano", "pt-BR": "Hino do Mar Distante", id: "Hymn of Far Sea" } },
  2000625: { baseLevel: 100, maxLevel: 180, breakthroughSteps: FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Fury of the Far Sea", "zh-CN": "遥远之海的狂澜", "zh-TW": "遙遠之海的狂瀾", ja: "蒼海の狂瀾", "ko-KR": "머나먼 바다의 광란", fr: "Fureur de la mer lointaine", de: "Zorn der Fernen See", es: "Furia del Mar Lejano", "pt-BR": "Fúria do Mar Distante", th: "Fury of the Far Sea", id: "Wild Tide of Far Sea" } },
  2000626: { baseLevel: 220, maxLevel: 280, breakthroughSteps: EMBER_FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Ember - Shadow of the Far Sea", "zh-CN": "烬空·遥远之海的断影", "zh-TW": "燼空·遙遠之海的斷影", ja: "燼空・蒼海の断片", "ko-KR": "잔불의 하늘・머나먼 바다의 단영", fr: "Cendres - Ombre de la mer lointaine", de: "Glut - Schatten der Fernen See", es: "Ascuas: Sombra del Mar Lejano", "pt-BR": "Brasa - Sombra do Mar Distante", id: "Greysky - Shadowbreak of Far Sea" } },
  2000627: { baseLevel: 220, maxLevel: 280, breakthroughSteps: EMBER_FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Ember - Revelation of the Far Sea", "zh-CN": "烬空·遥远之海的启示", "zh-TW": "燼空·遙遠之海的啟示", ja: "燼空・蒼海の神託", "ko-KR": "잔불의 하늘・머나먼 바다의 계시", fr: "Cendres - Révélation de la mer lointaine", de: "Glut - Offenbarung der Fernen See", es: "Ascuas: Revelación del Mar Lejano", "pt-BR": "Brasa - Revelação do Mar Distante", id: "Greysky - Revelation of Far Sea" } },
  2000628: { baseLevel: 220, maxLevel: 280, breakthroughSteps: EMBER_FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Ember - Wish of the Far Sea", "zh-CN": "烬空·遥远之海的祈愿", "zh-TW": "燼空·遙遠之海的祈願", ja: "燼空・蒼海の祈祷", "ko-KR": "잔불의 하늘・머나먼 바다의 기도", fr: "Cendres - Voeu de la mer lointaine", de: "Glut - Wunsch der Fernen See", es: "Ascuas: Deseo del Mar Lejano", "pt-BR": "Brasa - Desejo do Mar Distante", id: "Greysky - Wish of Far Sea" } },
  2000629: { baseLevel: 220, maxLevel: 280, breakthroughSteps: EMBER_FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Ember - Grace of the Far Sea", "zh-CN": "烬空·遥远之海的恩典", "zh-TW": "燼空·遙遠之海的恩典", ja: "燼空・蒼海の恩寵", "ko-KR": "잔불의 하늘・머나먼 바다의 은혜", fr: "Cendres - Grace de la mer lointaine", de: "Glut - Gnade der Fernen See", es: "Ascuas: Gracia del Mar Lejano", "pt-BR": "Brasa - Graça do Mar Distante", id: "Greysky - Grace of Far Sea" } },
  2000630: { baseLevel: 220, maxLevel: 280, breakthroughSteps: EMBER_FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Ember - Waiting of the Far Sea", "zh-CN": "烬空·遥远之海的守候", "zh-TW": "燼空·遙遠之海的守候", ja: "燼空・蒼海の守護", "ko-KR": "잔불의 하늘・머나먼 바다의 수호", fr: "Cendres - Attente de la mer lointaine", de: "Glut - Wacht der Fernen See", es: "Ascuas: Vigilia del Mar Lejano", "pt-BR": "Brasa - Vigília do Mar Distante", id: "Greysky - Watch of Far Sea" } },
  2000631: { baseLevel: 220, maxLevel: 280, breakthroughSteps: EMBER_FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Ember - Gaze of the Far Sea", "zh-CN": "烬空·遥远之海的远眺", "zh-TW": "燼空·遙遠之海的遠眺", ja: "燼空・蒼海の天望", "ko-KR": "잔불의 하늘・머나먼 바다의 관망", fr: "Cendres - Regard de la mer lointaine", de: "Glut - Blick der Fernen See", es: "Ascuas: Mirada del Mar Lejano", "pt-BR": "Brasa - Olhar do Mar Distante", id: "Greysky - View of Far Sea" } },
  2000632: { baseLevel: 220, maxLevel: 280, breakthroughSteps: EMBER_FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Ember - Vow of the Far Sea", "zh-CN": "烬空·遥远之海的誓约", "zh-TW": "燼空·遙遠之海的誓約", ja: "燼空・蒼海の誓い", "ko-KR": "잔불의 하늘・머나먼 바다의 서약", fr: "Cendres - Serment de la mer lointaine", de: "Glut - Schwur der Fernen See", es: "Ascuas: Voto del Mar Lejano", "pt-BR": "Brasa - Voto do Mar Distante", id: "Greysky - Oath of Far Sea" } },
  2000633: { baseLevel: 220, maxLevel: 280, breakthroughSteps: EMBER_FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Ember - Hymn of the Far Sea", "zh-CN": "烬空·遥远之海的颂歌", "zh-TW": "燼空·遙遠之海的頌歌", ja: "燼空・蒼海の讃歌", "ko-KR": "잔불의 하늘・머나먼 바다의 송가", fr: "Cendres - Hymne de la mer lointaine", de: "Glut - Hymne der Fernen See", es: "Ascuas: Himno del Mar Lejano", "pt-BR": "Brasa - Hino do Mar Distante", id: "Greysky - Hymn of Far Sea" } },
  2000634: { baseLevel: 220, maxLevel: 280, breakthroughSteps: EMBER_FAR_SEA_BREAKTHROUGH_STEPS, names: { en: "Ember - Fury of the Far Sea", "zh-CN": "烬空·遥远之海的狂澜", "zh-TW": "燼空·遙遠之海的狂瀾", ja: "燼空・蒼海の狂瀾", "ko-KR": "잔불의 하늘・머나먼 바다의 광란", fr: "Cendres - Fureur de la mer lointaine", de: "Glut - Zorn der Fernen See", es: "Ascuas: Furia del Mar Lejano", "pt-BR": "Brasa - Fúria do Mar Distante", th: "Ember - Fury of the Far Sea", id: "Greysky - Wild Tide of Far Sea" } },
};

function breakthroughLevelBonus(meta: OceanWeaponMeta, breakThroughTime: number): number {
  const count = Math.max(0, Math.trunc(breakThroughTime));
  let bonus = 0;
  for (let i = 0; i < count && i < meta.breakthroughSteps.length; i += 1) {
    bonus += meta.breakthroughSteps[i] ?? 0;
  }
  return bonus;
}

function isEmberFarSeaWeapon(meta: OceanWeaponMeta): boolean {
  return meta.breakthroughSteps === EMBER_FAR_SEA_BREAKTHROUGH_STEPS;
}

function oceanWeaponBaseLevel(meta: OceanWeaponMeta): number {
  return isEmberFarSeaWeapon(meta) ? 220 : meta.baseLevel;
}

function oceanWeaponMaxLevel(meta: OceanWeaponMeta): number {
  return isEmberFarSeaWeapon(meta) ? 280 : meta.maxLevel;
}

function deriveOceanWeaponLevel(
  weapon: EquippedItem,
  meta: OceanWeaponMeta,
): { level: number; source: OceanWeaponInfo["levelSource"] } {
  const baseLevel = oceanWeaponBaseLevel(meta);
  const maxLevel = oceanWeaponMaxLevel(meta);
  const breakThroughTime = Number.isFinite(weapon.breakThroughTime)
    ? Math.max(0, Math.trunc(Number(weapon.breakThroughTime)))
    : null;

  if (breakThroughTime === null) {
    return { level: baseLevel, source: "configFamily" };
  }

  const derivedLevel = Math.min(
    maxLevel,
    baseLevel + breakthroughLevelBonus(meta, breakThroughTime),
  );
  return { level: derivedLevel, source: "itemInstance" };
}

export function classifyOceanWeapon(
  equippedItems: readonly EquippedItem[] | null | undefined,
): OceanWeaponInfo | null {
  const weapon = equippedItems?.find((item) => item.slot === WEAPON_SLOT);
  if (!weapon) return null;

  const meta = OCEAN_WEAPON_BY_ITEM_ID[weapon.itemConfigId];
  if (!meta) return null;
  const { level, source } = deriveOceanWeaponLevel(weapon, meta);

  return {
    item: weapon,
    itemId: weapon.itemConfigId,
    level,
    baseLevel: oceanWeaponBaseLevel(meta),
    maxLevel: oceanWeaponMaxLevel(meta),
    levelSource: source,
    names: meta.names,
  };
}

export function resolveEquipmentName(
  names: MultiLangValue | null | undefined,
  locale: LocaleCode,
): string {
  return names?.[locale]?.trim() || names?.en?.trim() || "";
}

export function resolveOceanWeaponName(weapon: OceanWeaponInfo, locale: LocaleCode): string {
  return resolveEquipmentName(weapon.names, locale);
}
