import { invoke } from "@tauri-apps/api/core";
import type { LiveDataPayload, RawEntityData } from "$lib/api";
import { entityUuidFromAliases } from "$lib/entity-id";
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

const DISCORD_CLIENT_ID = "1522412559221915668";
const PRESENCE_COMBAT_UPDATE_MS = 1_000;
const PRESENCE_IDLE_UPDATE_MS = 15_000;
const PRESENCE_DEAD_UPDATE_MS = 1_000;
const PRESENCE_LARPING_UPDATE_MS = 60_000;
const DISCORD_TEXT_LIMIT = 128;

let lastConfigKey = "";
let lastActivityKey = "";
let lastActivitySignatureKey = "";
let lastActivityAtMs = 0;
let lastClearAtMs = 0;
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
  resetDeathTracking();
  await invoke("discord_presence_clear");
}

export async function updateDiscordPresenceFromLiveData(
  payload: LiveDataPayload,
  nowMs = Date.now(),
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

  const hasCombat =
    payload.fightStartTimestampMs > 0 ||
    Number(payload.totalDmg || 0) > 0 ||
    Number(payload.totalHeal || 0) > 0;

  if (!hasCombat) {
    resetDeathTracking();
    const sceneName = displaySceneName(payload);
    const details = config.showScene !== false ? `Larping in ${sceneName}` : "Larping";
    const activity = {
      details: truncateDiscordText(details),
      state: "",
      startTimestamp: null,
      largeImage: largeImageAssetKey(payload, "idle"),
      largeText: "Resonance Logs - Global",
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

  const localEntity = findLocalEntity(payload);
  const deathState = updateDeathTracking(payload, localEntity, nowMs);
  const activity = buildDiscordPresenceActivity(payload, localEntity, deathState, config, nowMs);
  if (!activity) {
    await clearDiscordPresence().catch((error) => {
      console.warn("Failed to clear Discord Rich Presence:", error);
    });
    return;
  }

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

function buildDiscordPresenceActivity(
  payload: LiveDataPayload,
  localEntity: RawEntityData | null,
  deathState: {
    isDead: boolean;
    deadMs: number;
    deathCount: number;
    deathStartedAtMs: number | null;
  },
  config: DiscordPresenceSettings,
  nowMs: number,
): DiscordPresenceActivity | null {
  const sceneName = displaySceneName(payload);
  const bossName = displayBossName(payload);
  const trueDpsMs = trueDpsTimeMs(payload, nowMs);
  const dpsText = formatDps(localTrueDps(payload, localEntity, nowMs));
  const deathCount = Math.max(deathState.deathCount, localDeathCount(localEntity));
  const presenceStatus = deathState.isDead ? "dead" : "combat";
  const startTimestamp = config.showTimer !== false
    ? deathState.isDead
      ? discordTimestampSeconds(deathState.deathStartedAtMs ?? nowMs - deathState.deadMs)
      : discordTimestampSeconds(nowMs - trueDpsMs)
    : null;

  const stateParts: string[] = [];
  if (config.showDps !== false) stateParts.push(`DPS: ${dpsText}`);
  if (config.showDeaths !== false) stateParts.push(`Deaths: ${deathCount}`);

  let details: string;
  if (deathState.isDead) {
    details = config.showScene !== false ? `Floor tanking in ${sceneName}` : "Floor tanking";
  } else if (bossName && config.showBoss !== false) {
    details = config.showScene !== false
      ? `Fighting ${bossName} in ${sceneName}`
      : `Fighting ${bossName}`;
  } else {
    details = config.showScene !== false ? `Mobbing in ${sceneName}` : "Mobbing";
  }

  const state = stateParts.join(" | ");
  if (!details.trim() && !state.trim()) return null;
  return {
    details: truncateDiscordText(details),
    state: truncateDiscordText(state || "In combat"),
    startTimestamp,
    largeImage: largeImageAssetKey(payload, presenceStatus),
    largeText: sceneName || "Resonance Logs - Global",
    smallImage: localSpecAssetKey(localEntity),
    smallText: localSpecAssetText(localEntity),
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
  if (row) return Number(row.tdps || row.dps || 0);

  const activeMs = trueDpsTimeMs(payload, nowMs);
  const total = Number(localEntity?.damage?.total ?? 0);
  return activeMs > 0 ? total / (activeMs / 1000) : 0;
}

function trueDpsTimeMs(payload: LiveDataPayload, nowMs: number): number {
  const displayElapsedMs = liveDisplayElapsedMs(payload, nowMs);
  const activeMs = Math.max(0, Number(payload.activeCombatTimeMs) || 0);
  if (activeMs <= 0) return displayElapsedMs;
  return Math.min(displayElapsedMs, activeMs);
}

function updateDeathTracking(
  payload: LiveDataPayload,
  localEntity: RawEntityData | null,
  nowMs: number,
): { isDead: boolean; deadMs: number; deathCount: number; deathStartedAtMs: number | null } {
  const nextEncounterKey = [
    payload.fightStartTimestampMs,
    payload.sceneId ?? "",
    payload.localPlayerKey ?? payload.localPlayerUuid ?? payload.localPlayerUid ?? "",
  ].join(":");
  if (nextEncounterKey !== currentEncounterKey) {
    currentEncounterKey = nextEncounterKey;
    resetDeathTracking(false);
  }

  const isDead = (localEntity as (RawEntityData & { isDead?: boolean }) | null)?.isDead === true;
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
  const deathCount = Math.max(localDeathCount(localEntity), deadAccumulatedMs > 0 || isDead ? 1 : 0);
  return {
    isDead,
    deadMs: deadAccumulatedMs + activeDeadMs,
    deathCount,
    deathStartedAtMs: isDead ? deadStartedAtMs : null,
  };
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

function displaySceneName(payload: LiveDataPayload): string {
  const language = SETTINGS.live.general.state.language;
  const byId = getLocalizedSceneName(payload.sceneId, payload.sceneName, language);
  if (byId && byId !== "Unknown Scene") return byId;
  return localizeRawSceneName(payload.sceneName, payload.sceneName || "Unknown Scene", language);
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
  const decimalPlaces = SETTINGS.live.general.state.abbreviatedDecimalPlaces ?? 1;
  return formatCompactNumber(value, decimalPlaces, SETTINGS.live.general.state.abbreviationStyle);
}

function formatCompactNumber(
  value: number,
  decimalPlaces: number,
  style: "western" | "cn" = "western",
): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (style === "cn") {
    if (safeValue >= 1e12) return `${(safeValue / 1e12).toFixed(decimalPlaces)}zhao`;
    if (safeValue >= 1e8) return `${(safeValue / 1e8).toFixed(decimalPlaces)}yi`;
    if (safeValue >= 1e4) return `${(safeValue / 1e4).toFixed(decimalPlaces)}wan`;
    return safeValue.toFixed(0);
  }
  if (safeValue >= 1e12) return `${(safeValue / 1e12).toFixed(decimalPlaces)}t`;
  if (safeValue >= 1e9) return `${(safeValue / 1e9).toFixed(decimalPlaces)}b`;
  if (safeValue >= 1e6) return `${(safeValue / 1e6).toFixed(decimalPlaces)}m`;
  if (safeValue >= 1e3) return `${(safeValue / 1e3).toFixed(decimalPlaces)}k`;
  return safeValue.toFixed(0);
}

function truncateDiscordText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= DISCORD_TEXT_LIMIT) return normalized;
  return `${normalized.slice(0, DISCORD_TEXT_LIMIT - 3).trimEnd()}...`;
}

function largeImageAssetKey(payload: LiveDataPayload, status: "idle" | "combat" | "dead"): string {
  const sceneId = Number(payload.sceneId || 0);
  if (sceneId > 0) {
    return `scene_${sceneId}`;
  }
  return `status_${status}`;
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
    activity.smallImage ?? "",
  ].join("\n");
}

function activitySignatureKey(activity: DiscordPresenceActivity): string {
  return [
    activity.details,
    activity.startTimestamp ?? "",
    activity.largeImage ?? "",
    activity.smallImage ?? "",
  ].join("\n");
}
