import { invoke } from "@tauri-apps/api/core";
import type { DeathRecord, LiveDataPayload, RawEntityData, SceneChangePayload } from "$lib/api";
import { entityUuidFromAliases, normalizeEntityUuid } from "$lib/entity-id";
import { computePlayerRows, liveDisplayElapsedMs } from "$lib/live-derived";
import { localizeRawMonsterName } from "$lib/monster-mappings";
import { getLocalizedSceneName, localizeRawSceneName } from "$lib/scene-mappings";
import { SETTINGS } from "$lib/settings-store";

type DiscordPresenceActivity = {
  details: string;
  state: string;
  startTimestamp?: number | null;
  largeImage?: string | null;
  largeText?: string | null;
  smallImage?: string | null;
  smallText?: string | null;
};

type DiscordPresenceSettings = typeof SETTINGS.discordPresence.state;
type DiscordPresenceAssets = Pick<DiscordPresenceActivity, "largeImage" | "largeText" | "smallImage" | "smallText">;

type DiscordDeathState = {
  isDead: boolean;
  currentDeadMs: number;
  totalDeadMs: number;
  deathCount: number;
  deathStartedAtMs: number | null;
};

type DiscordSceneDifficulty =
  | "Easy"
  | "Normal"
  | "Hard"
  | "Nightmare"
  | "Master"
  | "Unstable"
  | "Adept"
  | "Clash"
  | "Brutal"
  | "Purge";

type DiscordSceneAssetGroup = {
  key: string;
  displayName: string;
  sceneIds: readonly number[];
  namePattern: RegExp;
  difficultyBySceneId?: Readonly<Record<number, DiscordSceneDifficulty>>;
};

const DISCORD_CLIENT_ID = "1522412559221915668";
const PRESENCE_COMBAT_UPDATE_MS = 1_000;
const PRESENCE_IDLE_UPDATE_MS = 15_000;
const PRESENCE_DEAD_UPDATE_MS = 1_000;
const PRESENCE_LARPING_UPDATE_MS = 60_000;
const DISCORD_TEXT_LIMIT = 128;
const STIMEN_VAULTS_ASSET_KEY = "scene_stimen_vaults";
const sceneIdRange = (start: number, end: number): number[] =>
  Array.from({ length: end - start + 1 }, (_, index) => start + index);

const DISCORD_SCENE_ASSET_GROUPS: readonly DiscordSceneAssetGroup[] = [
  {
    key: "scene_asterleeds",
    displayName: "Asterleed",
    sceneIds: [8, 5206],
    namePattern: /asterleeds?/i,
  },
  {
    key: "scene_starland",
    displayName: "Starland",
    sceneIds: [11],
    namePattern: /starland/i,
  },
  {
    key: "scene_guild_center",
    displayName: "Guild Center",
    sceneIds: [12000],
    namePattern: /guild (center|hall)/i,
  },
  {
    key: "scene_guild_hunt",
    displayName: "Guild Hunt",
    sceneIds: [12011, 12012, 12013, 12014, 12015, 12018, 12019, 12022, 12023],
    namePattern: /guild hunt/i,
    difficultyBySceneId: {
      12011: "Hard",
      12012: "Normal",
      12013: "Easy",
      12014: "Normal",
      12015: "Hard",
      12018: "Normal",
      12019: "Hard",
      12022: "Normal",
      12023: "Hard",
    },
  },
  {
    key: "scene_world_boss_crusade",
    displayName: "World Boss Crusade",
    sceneIds: [12050, 12051, 12052],
    namePattern: /(world boss crusade|giant golem crusade)/i,
  },
  {
    key: "scene_city_rally",
    displayName: "City Rally",
    sceneIds: [7004],
    namePattern: /city rally/i,
  },
  {
    key: "scene_wondrous_tag",
    displayName: "Wondrous Tag",
    sceneIds: [11001],
    namePattern: /wondrous tag|wonder rumble/i,
  },
  {
    key: "scene_ee_chan_dont_stare_at_me",
    displayName: "Ee-chan, Don't Stare at Me!",
    sceneIds: [12030, 12040],
    namePattern: /ee-chan.*(?:story|stare)|guild party/i,
  },
  {
    key: "scene_homestead",
    displayName: "Homestead",
    sceneIds: [30001, 40001],
    namePattern: /homestead/i,
  },
  {
    key: "scene_asteria_plains",
    displayName: "Asteria Plains",
    sceneIds: [7],
    namePattern: /asteria plains/i,
  },
  {
    key: "scene_bahamar_highlands",
    displayName: "Bahamar Highlands",
    sceneIds: [9],
    namePattern: /bahamar highlands/i,
  },
  {
    key: "scene_underground_district",
    displayName: "Underground District",
    sceneIds: [74],
    namePattern: /underground district/i,
  },
  {
    key: "scene_windhowl_canyon",
    displayName: "Windhowl Canyon",
    sceneIds: [73],
    namePattern: /windhowl canyon/i,
  },
  {
    key: "scene_skimmers_lair",
    displayName: "Skimmer's Lair",
    sceneIds: [75],
    namePattern: /skimmer'?s lair/i,
  },
  {
    key: "scene_duskdye_woods",
    displayName: "Duskdye Woods",
    sceneIds: [71],
    namePattern: /duskdye woods/i,
  },
  {
    key: "scene_everfall_forest",
    displayName: "Everfall Forest",
    sceneIds: [72],
    namePattern: /everfall forest/i,
  },
  {
    key: "scene_moonshadow_wilds",
    displayName: "Moonshadow Wilds",
    sceneIds: [93],
    namePattern: /moonshadow wilds/i,
  },
  {
    key: "scene_stray_starway",
    displayName: "Stray Starway",
    sceneIds: [94],
    namePattern: /stray starway/i,
  },
  {
    key: "scene_sunset_wilds",
    displayName: "Sunset Wilds",
    sceneIds: [95],
    namePattern: /sunset wilds/i,
  },
  {
    key: "scene_sunken_corridor",
    displayName: "Sunken Corridor",
    sceneIds: [91],
    namePattern: /sunken corridor/i,
  },
  {
    key: "scene_gloomy_depths",
    displayName: "Gloomy Depths",
    sceneIds: [92],
    namePattern: /gloomy depths/i,
  },
  {
    key: STIMEN_VAULTS_ASSET_KEY,
    displayName: "Stimen Vaults",
    sceneIds: [...sceneIdRange(30101, 30175), 30200, ...sceneIdRange(31101, 31175), ...sceneIdRange(32101, 32160)],
    namePattern: /stimen vaults/i,
  },
  {
    key: "scene_void_tinas_mindrealm",
    displayName: "Tina's Mindrealm",
    sceneIds: [1001, 1002, 1011, 1021, 1031, 1032, 1033, 1611, 1621, 1631, 1632, 1633],
    namePattern: /tina'?s mindrealm/i,
    difficultyBySceneId: {
      1011: "Unstable",
      1021: "Unstable",
      1031: "Normal",
      1032: "Hard",
      1033: "Master",
      1611: "Unstable",
      1621: "Unstable",
      1631: "Normal",
      1632: "Hard",
      1633: "Master",
    },
  },
  {
    key: "scene_void_towering_ruin",
    displayName: "Towering Ruin",
    sceneIds: [1101, 1102, 1111, 1112, 1121, 1122, 1123, 1150, 1151, 1152, 1153, 1154],
    namePattern: /towering ruin/i,
    difficultyBySceneId: {
      1111: "Unstable",
      1112: "Unstable",
      1121: "Normal",
      1122: "Hard",
      1123: "Master",
      1150: "Master",
      1151: "Hard",
      1152: "Normal",
      1153: "Unstable",
      1154: "Unstable",
    },
  },
  {
    key: "scene_mistveil_hunting_ground",
    displayName: "Mistveil Hunting Ground",
    sceneIds: [5901, 6541, 6542, 6543, 6544, 6545],
    namePattern: /mistveil hunting ground/i,
    difficultyBySceneId: {
      6541: "Unstable",
      6542: "Unstable",
      6543: "Normal",
      6544: "Hard",
      6545: "Master",
    },
  },
  {
    key: "scene_cursed_radiant_tomb",
    displayName: "Cursed Radiant Tomb",
    sceneIds: [5910, 6511, 6512, 6513, 6514, 6515],
    namePattern: /cursed radiant tomb/i,
    difficultyBySceneId: {
      6511: "Unstable",
      6512: "Unstable",
      6513: "Normal",
      6514: "Hard",
      6515: "Master",
    },
  },
  {
    key: "scene_mech_facility",
    displayName: "Mech Facility",
    sceneIds: [6521, 6522, 6523, 6524, 6525],
    namePattern: /mech facility|mechanized processing facility/i,
    difficultyBySceneId: {
      6521: "Unstable",
      6522: "Unstable",
      6523: "Normal",
      6524: "Hard",
      6525: "Master",
    },
  },
  {
    key: "scene_sea_ringed_reef",
    displayName: "Sea-Ringed Reef",
    sceneIds: [6563, 6564, 6565],
    namePattern: /sea[- ]ringed reef|ringsea reef/i,
    difficultyBySceneId: {
      6563: "Normal",
      6564: "Hard",
      6565: "Master",
    },
  },
  {
    key: "scene_dragon_shackles",
    displayName: "Dragon Shackles",
    sceneIds: [9200, 13001, 13002, 13003],
    namePattern: /dragon shackles/i,
    difficultyBySceneId: {
      9200: "Adept",
      13001: "Clash",
      13002: "Brutal",
      13003: "Purge",
    },
  },
  {
    key: "scene_illusion_shroud_woods",
    displayName: "Illusion-Shroud Woods",
    sceneIds: [9205, 9206, 9207],
    namePattern: /illusion[- ]shroud woods/i,
    difficultyBySceneId: {
      9205: "Easy",
      9206: "Hard",
      9207: "Nightmare",
    },
  },
  {
    key: "scene_dreambloom_ruins",
    displayName: "Dreambloom Ruins",
    sceneIds: [13011, 13012, 13013],
    namePattern: /dreambloom ruins/i,
    difficultyBySceneId: {
      13011: "Clash",
      13012: "Brutal",
      13013: "Purge",
    },
  },
  {
    key: "scene_field_of_forgotten_illusions",
    displayName: "Field of Forgotten Illusions",
    sceneIds: [13021, 13022, 13023],
    namePattern: /field of forgotten illusions/i,
    difficultyBySceneId: {
      13021: "Clash",
      13022: "Brutal",
      13023: "Purge",
    },
  },
];

const DISCORD_SCENE_ASSET_BY_ID = new Map(
  DISCORD_SCENE_ASSET_GROUPS.flatMap((group) => group.sceneIds.map((sceneId) => [sceneId, group.key] as const)),
);
const DISCORD_SCENE_GROUP_BY_ID = new Map(
  DISCORD_SCENE_ASSET_GROUPS.flatMap((group) => group.sceneIds.map((sceneId) => [sceneId, group] as const)),
);
const DISCORD_UPLOADED_SCENE_ASSET_KEYS = new Set([
  "scene_asteria_plains",
  "scene_asterleeds",
  "scene_bahamar_highlands",
  "scene_cursed_radiant_tomb",
  "scene_dragon_shackles",
  "scene_dreambloom_ruins",
  "scene_duskdye_woods",
  "scene_everfall_forest",
  "scene_field_of_forgotten_illusions",
  "scene_guild_center",
  "scene_guild_hunt",
  "scene_homestead",
  "scene_illusion_shroud_woods",
  "scene_mech_facility",
  "scene_mistveil_hunting_ground",
  "scene_moonshadow_wilds",
  "scene_sea_ringed_reef",
  "scene_skimmers_lair",
  "scene_starland",
  "scene_stimen_vaults",
  "scene_stray_starway",
  "scene_sunken_corridor",
  "scene_sunset_wilds",
  "scene_underground_district",
  "scene_void_tinas_mindrealm",
  "scene_void_towering_ruin",
  "scene_windhowl_canyon",
  "scene_world_boss_crusade",
  "scene_city_rally",
  "scene_wondrous_tag",
  "scene_ee_chan_dont_stare_at_me",
]);
const DISCORD_LINE_TOOLTIP_SCENE_KEYS = new Set([
  "scene_asterleeds",
  "scene_starland",
  "scene_asteria_plains",
  "scene_bahamar_highlands",
  "scene_underground_district",
  "scene_windhowl_canyon",
  "scene_skimmers_lair",
  "scene_duskdye_woods",
  "scene_everfall_forest",
  "scene_moonshadow_wilds",
  "scene_stray_starway",
  "scene_sunset_wilds",
  "scene_sunken_corridor",
  "scene_gloomy_depths",
]);

let lastConfigKey = "";
let lastActivityKey = "";
let lastActivitySignatureKey = "";
let lastActivityAtMs = 0;
let lastClearAtMs = 0;
let lastLiveActivitySignature = "";
let lastLiveActivityAtMs = 0;
let retainedCombatSceneKey = "";
let retainedCombatActivity: DiscordPresenceActivity | null = null;
let currentEncounterKey = "";
let deadStartedAtMs: number | null = null;
let deadAccumulatedMs = 0;
let localWasDead = false;

export async function syncDiscordPresenceConfig(): Promise<void> {
  const config = SETTINGS.discordPresence.state;
  const enabled = config.enabled === true;
  const key = `${enabled}:${DISCORD_CLIENT_ID}`;
  if (key === lastConfigKey) return;
  lastConfigKey = key;
  lastActivityKey = "";
  lastActivitySignatureKey = "";
  lastActivityAtMs = 0;
  resetLiveActivityTracking();
  resetRetainedCombatPresence();
  if (!enabled) {
    resetDeathTracking();
  }
  await invoke("discord_presence_set_config", {
    enabled,
    clientId: DISCORD_CLIENT_ID,
  });
}

export async function clearDiscordPresence(force = false): Promise<void> {
  const nowMs = Date.now();
  if (!force && nowMs - lastClearAtMs < PRESENCE_IDLE_UPDATE_MS) return;
  lastClearAtMs = nowMs;
  lastActivityKey = "";
  lastActivitySignatureKey = "";
  lastActivityAtMs = 0;
  resetLiveActivityTracking();
  resetRetainedCombatPresence();
  resetDeathTracking();
  await invoke("discord_presence_clear");
}

export async function updateDiscordPresenceFromSceneChange(
  scene: SceneChangePayload,
  nowMs = Date.now(),
): Promise<void> {
  const sceneName = sceneNameWithDifficulty(scene);
  const nextSceneKey = retainedCombatSceneKeyForPayload({
    sceneId: scene.sceneId ?? null,
    sceneName,
  });
  if (retainedCombatSceneKey && retainedCombatSceneKey !== nextSceneKey) {
    resetRetainedCombatPresence();
  }
  await updateDiscordPresenceFromLiveData(
    {
      elapsedMs: 0,
      activeCombatTimeMs: 0,
      fightStartTimestampMs: 0,
      dpsDisplayPaused: false,
      totalDmg: 0,
      totalDmgBossOnly: 0,
      totalHeal: 0,
      totalEffectiveHeal: 0,
      localPlayerUid: 0,
      localPlayerUuid: null,
      localPlayerKey: null,
      sceneId: scene.sceneId ?? null,
      sceneName,
      sceneLineId: scene.sceneLineId ?? null,
      trainingDummy: {
        phase: "idle",
        durationMs: 0,
        remainingMs: 0,
      },
      isPaused: false,
      bosses: [],
      entities: [],
    },
    nowMs,
  );
}

export async function updateDiscordPresenceFromLiveData(
  payload: LiveDataPayload,
  nowMs = Date.now(),
  deathRecords: readonly DeathRecord[] = [],
): Promise<void> {
  const config = SETTINGS.discordPresence.state;
  if (config.enabled !== true) {
    if (lastConfigKey !== "") {
      await syncDiscordPresenceConfig().catch((error) => {
        console.warn("Failed to disable Discord Rich Presence:", error);
      });
    }
    return;
  }

  await syncDiscordPresenceConfig().catch((error) => {
    console.warn("Failed to sync Discord Rich Presence config:", error);
  });

  const localEntity = findLocalEntity(payload);
  const hasCombat = hasActiveDiscordCombat(payload, localEntity, nowMs);

  if (!hasCombat) {
    const retainedActivity = retainedCombatPresenceForPayload(payload);
    if (retainedActivity) {
      const activityKey = activityIdentityKey(retainedActivity);
      const signatureKey = activitySignatureKey(retainedActivity);
      if (activityKey === lastActivityKey) {
        return;
      }
      if (
        signatureKey === lastActivitySignatureKey &&
        nowMs - lastActivityAtMs < PRESENCE_COMBAT_UPDATE_MS
      ) {
        return;
      }

      lastActivityKey = activityKey;
      lastActivitySignatureKey = signatureKey;
      lastActivityAtMs = nowMs;
      await invoke("discord_presence_update", { activity: retainedActivity }).catch((error) => {
        console.warn("Failed to update Discord Rich Presence:", error);
      });
      return;
    }

    resetDeathTracking();
    const sceneName = displaySceneName(payload);
    const sceneHoverText = displaySceneHoverText(payload, sceneName, config.showLine !== false);
    const activity = {
      details: "Larping",
      state: "",
      startTimestamp: null,
      ...discordActivityAssets(payload, "idle", localEntity, sceneHoverText),
    };
    const activityKey = activityIdentityKey(activity);
    const signatureKey = activitySignatureKey(activity);
    if (
      signatureKey === lastActivitySignatureKey &&
      nowMs - lastActivityAtMs < PRESENCE_LARPING_UPDATE_MS
    ) {
      return;
    }
    lastActivityKey = activityKey;
    lastActivitySignatureKey = signatureKey;
    lastActivityAtMs = nowMs;
    await invoke("discord_presence_update", { activity }).catch((error) => {
      console.warn("Failed to update Discord Rich Presence:", error);
    });
    return;
  }

  const deathState = updateDeathTracking(payload, localEntity, nowMs, deathRecords);
  const activity = buildDiscordPresenceActivity(payload, localEntity, deathState, config, nowMs);
  if (!activity) {
    await clearDiscordPresence().catch((error) => {
      console.warn("Failed to clear Discord Rich Presence:", error);
    });
    return;
  }
  retainCombatPresence(payload, activity);

  const activityKey = activityIdentityKey(activity);
  const signatureKey = activitySignatureKey(activity);
  const minUpdateMs = deathState.isDead ? PRESENCE_DEAD_UPDATE_MS : PRESENCE_COMBAT_UPDATE_MS;
  if (activityKey === lastActivityKey) {
    return;
  }
  if (signatureKey === lastActivitySignatureKey && nowMs - lastActivityAtMs < minUpdateMs) {
    return;
  }

  lastActivityKey = activityKey;
  lastActivitySignatureKey = signatureKey;
  lastActivityAtMs = nowMs;
  await invoke("discord_presence_update", { activity }).catch((error) => {
    console.warn("Failed to update Discord Rich Presence:", error);
  });
}

export function shouldRefreshDiscordPresenceOnTimer(payload: LiveDataPayload): boolean {
  const localEntity = findLocalEntity(payload);
  if (localEntityIsDead(localEntity)) return true;

  const hasCombatTotals =
    payload.fightStartTimestampMs > 0 ||
    Number(payload.totalDmg || 0) > 0 ||
    Number(payload.totalHeal || 0) > 0;
  return hasCombatTotals;
}

function hasActiveDiscordCombat(
  payload: LiveDataPayload,
  localEntity: RawEntityData | null,
  nowMs: number,
): boolean {
  const hasCombatTotals =
    payload.fightStartTimestampMs > 0 ||
    Number(payload.totalDmg || 0) > 0 ||
    Number(payload.totalHeal || 0) > 0;
  if (!hasCombatTotals) {
    resetLiveActivityTracking();
    return false;
  }

  if (localEntityIsDead(localEntity)) return true;

  if (
    payload.isPaused ||
    payload.dpsDisplayPaused ||
    payload.trainingDummy?.phase === "finished"
  ) {
    resetLiveActivityTracking();
    return false;
  }

  if (payload.bosses.length > 0 && !isDiscordOverworldScene(payload)) {
    markLiveActivity(payload, nowMs);
    return true;
  }

  return !liveActivityIsIdle(payload, nowMs);
}

function liveActivityIsIdle(payload: LiveDataPayload, nowMs: number): boolean {
  const signature = liveActivitySignature(payload);
  if (signature !== lastLiveActivitySignature) {
    lastLiveActivitySignature = signature;
    lastLiveActivityAtMs = nowMs;
    return false;
  }

  const idleForMs = nowMs - lastLiveActivityAtMs;
  return idleForMs >= idleDisplayPauseDelayMs();
}

function markLiveActivity(payload: LiveDataPayload, nowMs: number): void {
  lastLiveActivitySignature = liveActivitySignature(payload);
  lastLiveActivityAtMs = nowMs;
}

function resetLiveActivityTracking(): void {
  lastLiveActivitySignature = "";
  lastLiveActivityAtMs = 0;
}

function retainCombatPresence(payload: LiveDataPayload, activity: DiscordPresenceActivity): void {
  retainedCombatSceneKey = retainedCombatSceneKeyForPayload(payload);
  retainedCombatActivity = { ...activity };
}

function retainedCombatPresenceForPayload(payload: LiveDataPayload): DiscordPresenceActivity | null {
  if (!retainedCombatActivity) return null;
  const sceneKey = retainedCombatSceneKeyForPayload(payload);
  if (sceneKey !== retainedCombatSceneKey) {
    resetRetainedCombatPresence();
    return null;
  }
  return { ...retainedCombatActivity };
}

function resetRetainedCombatPresence(): void {
  retainedCombatSceneKey = "";
  retainedCombatActivity = null;
}

function retainedCombatSceneKeyForPayload(payload: Pick<LiveDataPayload, "sceneId" | "sceneName">): string {
  const sceneId = Number(payload.sceneId || 0);
  if (Number.isFinite(sceneId) && sceneId > 0) return `id:${Math.trunc(sceneId)}`;

  const group = discordSceneAssetGroup(payload);
  if (group) return `group:${group.key}`;

  const sceneName = payload.sceneName?.trim().toLocaleLowerCase() || "unknown";
  return `name:${sceneName}`;
}

function idleDisplayPauseDelayMs(): number {
  const rawSeconds = Number(SETTINGS.live.general.state.idleDisplayPauseDelaySeconds);
  const seconds = Number.isFinite(rawSeconds) ? rawSeconds : 5;
  return Math.max(1, Math.min(30, Math.round(seconds))) * 1000;
}

function liveActivitySignature(payload: LiveDataPayload): string {
  const bosses = payload.bosses
    .map((boss) => [
      boss.entityKey ?? boss.entityUuid ?? boss.uid,
      boss.name,
      boss.currentHp ?? "",
      boss.maxHp ?? "",
    ].join(":"))
    .join("|");

  const entities = payload.entities
    .map((entity) => [
      entityUuidFromAliases(entity) ?? entity.entityKey ?? entity.uid,
      combatStatsSignature(entity.damage),
      combatStatsSignature(entity.damageBossOnly),
      combatStatsSignature(entity.healing),
      combatStatsSignature(entity.taken),
      entity.isDead === true ? 1 : 0,
      entity.deaths?.length ?? 0,
    ].join(":"))
    .join("|");

  return [
    payload.sceneId ?? "",
    payload.sceneName ?? "",
    payload.sceneLineId ?? "",
    payload.fightStartTimestampMs,
    payload.dpsDisplayPaused ? 1 : 0,
    payload.isPaused ? 1 : 0,
    payload.trainingDummy?.phase ?? "",
    payload.totalDmg,
    payload.totalDmgBossOnly,
    payload.totalHeal,
    payload.totalEffectiveHeal,
    bosses,
    entities,
  ].join("||");
}

function combatStatsSignature(stats: RawEntityData["damage"] | null | undefined): string {
  if (!stats) return "0:0:0:0";
  return [
    stats.total,
    stats.effectiveTotal,
    stats.hits,
    stats.triggerHits,
  ].join(":");
}

function sceneNameWithDifficulty(scene: SceneChangePayload): string {
  const sceneName = scene.sceneName?.trim() || null;
  const difficulty = Number(scene.dungeonDifficulty ?? 0);
  if (!sceneName || !Number.isFinite(difficulty) || difficulty <= 0 || /-\d+$/.test(sceneName)) {
    return sceneName || "Unknown Scene";
  }
  return `${sceneName}-${difficulty}`;
}

function buildDiscordPresenceActivity(
  payload: LiveDataPayload,
  localEntity: RawEntityData | null,
  deathState: DiscordDeathState,
  config: DiscordPresenceSettings,
  nowMs: number,
): DiscordPresenceActivity | null {
  const sceneName = displaySceneName(payload);
  const sceneHoverText = displaySceneHoverText(payload, sceneName, config.showLine !== false);
  const bossName = displayBossName(payload);
  const dpsText = formatDps(localTrueDps(payload, localEntity, nowMs));
  const deathCount = Math.max(deathState.deathCount, localDeathCount(localEntity));
  const presenceStatus = deathState.isDead ? "dead" : "combat";
  const startTimestamp = config.showTimer !== false
    ? discordTimestampSeconds(payload.fightStartTimestampMs)
    : null;

  const stateParts: string[] = [];
  if (config.showDps !== false) stateParts.push(`DPS: ${dpsText}`);
  if (config.showDeaths !== false) stateParts.push(`Deaths: ${deathCount}`);

  let details: string;
  if (deathState.isDead) {
    const deadDuration = formatPresenceDuration(deathState.currentDeadMs);
    details = `Floor tanking for ${deadDuration}`;
  } else if (bossName && config.showBoss !== false) {
    details = `Fighting ${bossName}`;
  } else {
    details = "Mobbing";
  }

  const state = stateParts.join(" | ");
  if (!details.trim() && !state.trim()) return null;
  return {
    details: truncateDiscordText(details),
    state: truncateDiscordText(state || "In combat"),
    startTimestamp,
    ...discordActivityAssets(payload, presenceStatus, localEntity, sceneHoverText || "Resonance Logs - Global"),
  };
}

function findLocalEntity(payload: LiveDataPayload): RawEntityData | null {
  const localKey = payload.localPlayerKey?.trim();
  const localUuid = payload.localPlayerUuid?.trim();
  const localUid = Number(payload.localPlayerUid || 0);
  return payload.entities.find((entity) => {
    const entityUuid = entityUuidFromAliases(entity);
    if (localKey && (entity.entityKey === localKey || entityUuid === localKey)) return true;
    if (localUuid && (entityUuid === localUuid || String(entity.uuid ?? "") === localUuid)) return true;
    return localUid > 0 && Number(entity.uid || 0) === localUid;
  }) ?? null;
}

function localTrueDps(
  payload: LiveDataPayload,
  localEntity: RawEntityData | null,
  nowMs: number,
): number {
  const rows = computePlayerRows(payload, "dps", nowMs);
  const localKey = payload.localPlayerKey?.trim();
  const localUuid = payload.localPlayerUuid?.trim();
  const localUid = Number(payload.localPlayerUid || 0);
  const row = rows.find((candidate) => {
    if (localKey && (candidate.entityKey === localKey || candidate.entityUuid === localKey)) return true;
    if (localUuid && (candidate.entityUuid === localUuid || String(candidate.uuid ?? "") === localUuid)) return true;
    return localUid > 0 && Number(candidate.uid || 0) === localUid;
  });
  if (row) return Number(row.dps || row.tdps || 0);

  const activeMs = liveDisplayElapsedMs(payload, nowMs);
  const total = Number(localEntity?.damage?.total ?? 0);
  return activeMs > 0 ? total / (activeMs / 1000) : 0;
}

function updateDeathTracking(
  payload: LiveDataPayload,
  localEntity: RawEntityData | null,
  nowMs: number,
  deathRecords: readonly DeathRecord[],
): DiscordDeathState {
  const nextEncounterKey = [
    deathTrackingSceneKeyForPayload(payload),
    localPlayerIdentityKey(payload),
  ].join(":");
  if (nextEncounterKey !== currentEncounterKey) {
    currentEncounterKey = nextEncounterKey;
    resetDeathTracking(false);
  }

  const isDead = localEntityIsDead(localEntity);
  if (isDead && !localWasDead) {
    deadStartedAtMs = nowMs;
  } else if (!isDead && localWasDead && deadStartedAtMs !== null) {
    deadAccumulatedMs += Math.max(0, nowMs - deadStartedAtMs);
    deadStartedAtMs = null;
  }
  localWasDead = isDead;

  const activeDeadMs = isDead && deadStartedAtMs !== null
    ? Math.max(0, nowMs - deadStartedAtMs)
    : 0;
  const deathCount = Math.max(
    localDeathCount(localEntity),
    localDeathRecordCount(payload, deathRecords),
    deadAccumulatedMs > 0 || isDead ? 1 : 0,
  );
  return {
    isDead,
    currentDeadMs: activeDeadMs,
    totalDeadMs: deadAccumulatedMs + activeDeadMs,
    deathCount,
    deathStartedAtMs: isDead ? deadStartedAtMs : null,
  };
}

function deathTrackingSceneKeyForPayload(payload: Pick<LiveDataPayload, "sceneId" | "sceneName">): string {
  return retainedCombatSceneKeyForPayload(payload);
}

function localPlayerIdentityKey(payload: Pick<LiveDataPayload, "localPlayerKey" | "localPlayerUuid" | "localPlayerUid">): string {
  return String(payload.localPlayerKey ?? payload.localPlayerUuid ?? payload.localPlayerUid ?? "");
}

function resetDeathTracking(resetEncounter = true): void {
  if (resetEncounter) currentEncounterKey = "";
  deadStartedAtMs = null;
  deadAccumulatedMs = 0;
  localWasDead = false;
}

function localDeathCount(entity: RawEntityData | null): number {
  const deaths = (entity as (RawEntityData & { deaths?: unknown[] }) | null)?.deaths;
  return Array.isArray(deaths) ? deaths.length : 0;
}

function localEntityIsDead(entity: RawEntityData | null): boolean {
  if (!entity) return false;
  const maybeSnakeCase = entity as RawEntityData & { is_dead?: boolean | null };
  return entity.isDead === true || maybeSnakeCase.is_dead === true;
}

function localDeathRecordCount(
  payload: LiveDataPayload,
  deathRecords: readonly DeathRecord[],
): number {
  if (deathRecords.length === 0) return 0;
  return deathRecords.filter((record) => deathRecordMatchesLocalPlayer(payload, record)).length;
}

function deathRecordMatchesLocalPlayer(payload: LiveDataPayload, record: DeathRecord): boolean {
  const localKey =
    normalizeEntityUuid(payload.localPlayerUuid) ??
    normalizeEntityUuid(payload.localPlayerKey);
  const recordKey =
    normalizeEntityUuid(record.victimEntityUuid) ??
    normalizeEntityUuid(record.victimKey) ??
    normalizeEntityUuid(record.victimUuid == null ? null : String(record.victimUuid));
  if (localKey && recordKey) return localKey === recordKey;

  const localUid = Number(payload.localPlayerUid || 0);
  return localUid > 0 && Number(record.victimUid || 0) === localUid;
}

function displaySceneName(payload: LiveDataPayload): string {
  const language = SETTINGS.live.general.state.language;
  const byId = getLocalizedSceneName(payload.sceneId, payload.sceneName, language);
  const localized = byId && byId !== "Unknown Scene"
    ? byId
    : localizeRawSceneName(payload.sceneName, payload.sceneName || "Unknown Scene", language);
  return formatDiscordSceneName(payload, localized);
}

function displaySceneHoverText(
  payload: LiveDataPayload,
  sceneName = displaySceneName(payload),
  showLine = true,
): string {
  const lineLabel = showLine ? overworldSceneLineLabel(payload) : null;
  return lineLabel ? `${sceneName} - ${lineLabel}` : sceneName;
}

function overworldSceneLineLabel(payload: LiveDataPayload): string | null {
  const lineId = Number(payload.sceneLineId ?? 0);
  if (!Number.isFinite(lineId) || lineId <= 0) return null;

  const group = discordSceneAssetGroup(payload);
  if (!group || !DISCORD_LINE_TOOLTIP_SCENE_KEYS.has(group.key)) return null;
  return String(Math.trunc(lineId));
}

function isDiscordOverworldScene(payload: Pick<LiveDataPayload, "sceneId" | "sceneName">): boolean {
  const group = discordSceneAssetGroup(payload);
  return group !== null && DISCORD_LINE_TOOLTIP_SCENE_KEYS.has(group.key);
}

function discordSceneAssetGroup(payload: Pick<LiveDataPayload, "sceneId" | "sceneName">): DiscordSceneAssetGroup | null {
  const sceneId = Number(payload.sceneId || 0);
  if (sceneId > 0) {
    const byId = DISCORD_SCENE_GROUP_BY_ID.get(sceneId);
    if (byId) return byId;
  }

  const normalized = payload.sceneName?.trim();
  if (!normalized) return null;
  return DISCORD_SCENE_ASSET_GROUPS.find((group) => group.namePattern.test(normalized)) ?? null;
}

function formatDiscordSceneName(payload: LiveDataPayload, localizedSceneName: string): string {
  const sceneId = Number(payload.sceneId || 0);
  const group = discordSceneAssetGroup(payload);
  if (group?.key === STIMEN_VAULTS_ASSET_KEY) {
    const floor = stimenVaultFloorFromSceneId(sceneId) ??
      extractStimenVaultFloor(localizedSceneName) ??
      extractStimenVaultFloor(payload.sceneName);
    return floor === null ? group.displayName : `${group.displayName} Floor ${floor}`;
  }

  const rawDifficulty = extractRawSceneDifficulty(payload.sceneName) ?? extractRawSceneDifficulty(localizedSceneName);
  const knownDifficulty = sceneId > 0 ? group?.difficultyBySceneId?.[sceneId] : undefined;
  const displayName = group && (group.key === "scene_asterleeds" || knownDifficulty || rawDifficulty !== null)
    ? group.displayName
    : stripRawSceneDifficulty(localizedSceneName);
  const difficultyLabel = formatSceneDifficultyLabel(knownDifficulty, rawDifficulty);
  return difficultyLabel ? `${displayName} (${difficultyLabel})` : displayName;
}

function stimenVaultFloorFromSceneId(sceneId: number): number | null {
  if (
    (sceneId >= 30101 && sceneId <= 30175) ||
    (sceneId >= 31101 && sceneId <= 31175) ||
    (sceneId >= 32101 && sceneId <= 32160)
  ) {
    const floor = sceneId % 100;
    return floor > 0 ? floor : null;
  }
  return null;
}

function extractStimenVaultFloor(value: string | null | undefined): number | null {
  const floorMatch = value?.trim().match(/\bfloor\s+(\d+)\b/i);
  const shortMatch = value?.trim().match(/\b(\d+)\s*f\b/i);
  const floor = Number(floorMatch?.[1] ?? shortMatch?.[1] ?? 0);
  return Number.isFinite(floor) && floor > 0 ? floor : null;
}

function formatSceneDifficultyLabel(
  knownDifficulty: DiscordSceneDifficulty | undefined,
  rawDifficulty: number | null,
): string | null {
  if (knownDifficulty === "Master") {
    return rawDifficulty !== null && rawDifficulty > 0 ? `M${rawDifficulty}` : "Master";
  }
  if (knownDifficulty) return knownDifficulty;
  if (rawDifficulty === null) return null;
  if (rawDifficulty === 1) return "Normal";
  if (rawDifficulty === 2) return "Hard";
  return `M${rawDifficulty}`;
}

function extractRawSceneDifficulty(value: string | null | undefined): number | null {
  const match = value?.trim().match(/-(\d+)$/);
  if (!match) return null;
  const difficulty = Number(match[1]);
  return Number.isFinite(difficulty) && difficulty > 0 ? difficulty : null;
}

function stripRawSceneDifficulty(value: string): string {
  return value.replace(/-\d+$/, "").trim();
}

function displayBossName(payload: LiveDataPayload): string | null {
  const boss = payload.bosses.find((candidate) => {
    const maybeDead = (candidate as { isDead?: boolean } | null)?.isDead;
    return candidate && maybeDead !== true;
  });
  if (!boss?.name) return null;
  return localizeRawMonsterName(boss.name, boss.name, SETTINGS.live.general.state.language);
}

function formatDps(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (safeValue >= 1e9) return `${(safeValue / 1e9).toFixed(2)}b`;
  if (safeValue >= 1e6) return `${(safeValue / 1e6).toFixed(2)}m`;
  if (safeValue >= 1e3) return `${(safeValue / 1e3).toFixed(2)}k`;
  return Math.round(safeValue).toLocaleString("en-US");
}

function formatPresenceDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}:${seconds.toString().padStart(2, "0")}`;
  }

  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function truncateDiscordText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= DISCORD_TEXT_LIMIT) return normalized;
  return `${normalized.slice(0, DISCORD_TEXT_LIMIT - 3).trimEnd()}...`;
}

function discordActivityAssets(
  payload: LiveDataPayload,
  status: "idle" | "combat" | "dead",
  localEntity: RawEntityData | null,
  sceneHoverText: string,
): DiscordPresenceAssets {
  const sceneAsset = sceneImageAssetKey(payload);
  const specAsset = localSpecAssetKey(localEntity);
  const specText = localSpecAssetText(localEntity);
  if (sceneAsset) {
    return {
      largeImage: sceneAsset,
      largeText: sceneHoverText,
      smallImage: specAsset,
      smallText: specText,
    };
  }

  if (specAsset) {
    return {
      largeImage: specAsset,
      largeText: sceneHoverText,
      smallImage: null,
      smallText: null,
    };
  }

  return {
    largeImage: `status_${status}`,
    largeText: sceneHoverText,
    smallImage: null,
    smallText: null,
  };
}

function sceneImageAssetKey(payload: Pick<LiveDataPayload, "sceneId" | "sceneName">): string | null {
  const sceneId = Number(payload.sceneId || 0);
  if (sceneId > 0) {
    const knownSceneAsset = DISCORD_SCENE_ASSET_BY_ID.get(sceneId);
    if (knownSceneAsset && DISCORD_UPLOADED_SCENE_ASSET_KEYS.has(knownSceneAsset)) return knownSceneAsset;

    const namedSceneAsset = discordSceneAssetKeyFromName(payload.sceneName);
    if (namedSceneAsset && DISCORD_UPLOADED_SCENE_ASSET_KEYS.has(namedSceneAsset)) return namedSceneAsset;

    return null;
  }
  const namedSceneAsset = discordSceneAssetKeyFromName(payload.sceneName);
  return namedSceneAsset && DISCORD_UPLOADED_SCENE_ASSET_KEYS.has(namedSceneAsset)
    ? namedSceneAsset
    : null;
}

function discordSceneAssetKeyFromName(sceneName: string | null | undefined): string | null {
  const normalized = sceneName?.trim();
  if (!normalized) return null;

  return DISCORD_SCENE_ASSET_GROUPS.find((group) => group.namePattern.test(normalized))?.key ?? null;
}

function localSpecAssetKey(localEntity: RawEntityData | null): string | null {
  const specName = slugForDiscordAsset(localEntity?.classSpecName);
  if (specName) return `spec_${specName}`;
  const className = slugForDiscordAsset(localEntity?.className);
  return className ? `class_${className}` : null;
}

function localSpecAssetText(localEntity: RawEntityData | null): string | null {
  const specName = localEntity?.classSpecName?.trim();
  if (specName) return specName;
  const className = localEntity?.className?.trim();
  return className || null;
}

function slugForDiscordAsset(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function discordTimestampSeconds(ms: number | null | undefined): number | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms / 1000);
}

function activityIdentityKey(activity: DiscordPresenceActivity): string {
  return [
    activity.details,
    activity.state,
    activity.startTimestamp ?? "",
    activity.largeImage ?? "",
    activity.largeText ?? "",
    activity.smallImage ?? "",
    activity.smallText ?? "",
  ].join("\n");
}

function activitySignatureKey(activity: DiscordPresenceActivity): string {
  return [
    activity.details,
    activity.state,
    activity.startTimestamp ?? "",
    activity.largeImage ?? "",
    activity.largeText ?? "",
    activity.smallImage ?? "",
    activity.smallText ?? "",
  ].join("\n");
}
