import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  onBossBuffUpdate,
  onBossDbmUpdate,
  onEntityIdentities,
  onEntityNames,
  onHateListUpdate,
  onStunUpdate,
  onTeammateBuffUpdate,
  onTeammateFantasyClear,
  onTeammateFantasyUpdate,
  type BuffUpdateState,
  type HateEntry,
  type StunEntry,
  type TeammateFantasyState,
} from "$lib/api";
import {
  onGlobalPointerMove,
  onGlobalPointerUp,
  setMonsterEditMode,
  setMonsterOverlayWindow,
} from "./monster-layout.svelte.js";
import {
  fantasyEntryKey,
  withPreservedFantasySummonerName,
} from "./monster-fantasy";
import { updateMonsterDisplay } from "./monster-display.svelte.js";
import { monsterRuntime } from "./monster-runtime.svelte.js";

function mapBossBuffs(buffs: BuffUpdateState[]) {
  const next = new Map<number, BuffUpdateState>();
  for (const buff of buffs) {
    const existing = next.get(buff.baseId);
    if (!existing || buff.createTimeMs >= existing.createTimeMs) {
      next.set(buff.baseId, buff);
    }
  }
  return next;
}

function mapTeammateBuffs(buffs: BuffUpdateState[]) {
  const next = new Map<number, BuffUpdateState>();
  for (const buff of buffs) {
    const existing = next.get(buff.baseId);
    if (!existing || buff.createTimeMs >= existing.createTimeMs) {
      next.set(buff.baseId, buff);
    }
  }
  return next;
}

function mergeFantasyEntries(entries: TeammateFantasyState[]) {
  const next = new Map(
    monsterRuntime.fantasyEntries.map((entry) => [
      fantasyEntryKey(entry),
      entry,
    ]),
  );
  for (const entry of entries) {
    const key = fantasyEntryKey(entry);
    const existing = next.get(key);
    if (!existing) {
      next.set(key, entry);
      continue;
    }

    if (!existing || entry.detectedAtMs >= existing.detectedAtMs) {
      next.set(key, withPreservedFantasySummonerName(entry, existing));
      continue;
    }

    if (!existing.summonerName && entry.summonerName) {
      next.set(key, { ...existing, summonerName: entry.summonerName });
    }
  }
  monsterRuntime.fantasyEntries = [...next.values()];
}

function clearFantasyEntries() {
  monsterRuntime.fantasyEntries = [];
  monsterRuntime.fantasyRows = [];
}

export function initMonsterOverlay() {
  if (monsterRuntime.cleanup) return monsterRuntime.cleanup;
  if (typeof window === "undefined") {
    return () => {};
  }

  monsterRuntime.isMounted = true;
  monsterRuntime.isInitialized = true;
  setMonsterOverlayWindow(getCurrentWindow());

  document.documentElement.style.setProperty(
    "background",
    "transparent",
    "important",
  );
  document.body.style.setProperty("background", "transparent", "important");

  void setMonsterEditMode(false);

  const handleEditToggle = () => {
    void setMonsterEditMode(!monsterRuntime.isEditing);
  };

  const unlistenEditToggle = listen("monster-overlay-edit-toggle", handleEditToggle);
  const unlistenSharedEditToggle = listen("overlay-edit-toggle", handleEditToggle);
  const unlistenBossBuff = onBossBuffUpdate((event) => {
    const next = new Map<string, Map<number, BuffUpdateState>>();
    for (const [entityKey, buffs] of Object.entries(event.payload.bossBuffs)) {
      next.set(entityKey, mapBossBuffs(buffs));
    }
    monsterRuntime.bossBuffMap = next;
  });
  const unlistenTeammateBuff = onTeammateBuffUpdate((event) => {
    const next = new Map<string, Map<number, BuffUpdateState>>();
    for (const [entityUuid, buffs] of Object.entries(event.payload.teammateBuffs)) {
      next.set(entityUuid, mapTeammateBuffs(buffs));
    }
    monsterRuntime.teammateBuffMap = next;
  });
  const unlistenTeammateFantasy = onTeammateFantasyUpdate((event) => {
    mergeFantasyEntries(event.payload.fantasies);
  });
  const unlistenTeammateFantasyClear = onTeammateFantasyClear(() => {
    clearFantasyEntries();
  });
  const unlistenHateList = onHateListUpdate((event) => {
    const next = new Map<string, HateEntry[]>();
    for (const [entityKey, entries] of Object.entries(event.payload.hateLists)) {
      next.set(entityKey, entries);
    }
    monsterRuntime.bossHateMap = next;
  });
  const unlistenBossDbm = onBossDbmUpdate((event) => {
    const next = new Map(monsterRuntime.bossDbmMap);
    for (const dbmEvent of event.payload.events) {
      next.set(dbmEvent.baseSkillId, dbmEvent);
    }
    monsterRuntime.bossDbmMap = next;
  });
  const unlistenStun = onStunUpdate((event) => {
    const next = new Map<string, StunEntry>();
    for (const entry of event.payload.entries) {
      next.set(entry.bossEntityUuid, entry);
    }
    monsterRuntime.bossStunMap = next;
  });
  const unlistenNames = onEntityNames((event) => {
    const next = new Map(monsterRuntime.nameCache);
    for (const [uid, name] of Object.entries(event.payload.names)) {
      next.set(Number(uid), name);
    }
    monsterRuntime.nameCache = next;
  });
  const unlistenIdentities = onEntityIdentities((event) => {
    const nextPlayerNames = new Map(monsterRuntime.playerNameCache);
    const nextPlayerNamesByEntityKey = new Map(monsterRuntime.playerNameByEntityKey);
    for (const [uid, name] of Object.entries(event.payload.playerNames)) {
      const numericUid = Number(uid);
      if (Number.isSafeInteger(numericUid)) {
        nextPlayerNames.set(numericUid, name);
      }
      nextPlayerNamesByEntityKey.set(uid, name);
    }

    const nextMonsterIds = new Map(monsterRuntime.monsterIdCache);
    const nextMonsterIdsByEntityKey = new Map(monsterRuntime.monsterIdByEntityKey);
    for (const [uid, monsterId] of Object.entries(event.payload.monsterIds)) {
      const numericUid = Number(uid);
      if (Number.isSafeInteger(numericUid)) {
        nextMonsterIds.set(numericUid, monsterId);
      }
      nextMonsterIdsByEntityKey.set(uid, monsterId);
    }

    monsterRuntime.playerNameCache = nextPlayerNames;
    monsterRuntime.playerNameByEntityKey = nextPlayerNamesByEntityKey;
    monsterRuntime.monsterIdCache = nextMonsterIds;
    monsterRuntime.monsterIdByEntityKey = nextMonsterIdsByEntityKey;
  });

  window.addEventListener("pointermove", onGlobalPointerMove);
  window.addEventListener("pointerup", onGlobalPointerUp);
  monsterRuntime.rafId = requestAnimationFrame(updateMonsterDisplay);

  monsterRuntime.cleanup = () => {
    monsterRuntime.isMounted = false;
    monsterRuntime.isInitialized = false;
    monsterRuntime.dragState = null;
    monsterRuntime.resizeState = null;
    monsterRuntime.nameCache = new Map();
    monsterRuntime.playerNameCache = new Map();
    monsterRuntime.playerNameByEntityKey = new Map();
    monsterRuntime.monsterIdCache = new Map();
    monsterRuntime.monsterIdByEntityKey = new Map();
    monsterRuntime.bossBuffMap = new Map();
    monsterRuntime.teammateBuffMap = new Map();
    monsterRuntime.bossHateMap = new Map();
    monsterRuntime.bossStunMap = new Map();
    monsterRuntime.bossDbmMap = new Map();
    monsterRuntime.fantasyEntries = [];
    monsterRuntime.bossSections = [];
    monsterRuntime.teammateColumns = [];
    monsterRuntime.teammateRows = [];
    monsterRuntime.hateSections = [];
    monsterRuntime.stunSections = [];
    monsterRuntime.dbmRows = [];
    monsterRuntime.fantasyRows = [];
    unlistenEditToggle.then((fn) => fn());
    unlistenSharedEditToggle.then((fn) => fn());
    unlistenBossBuff.then((fn) => fn());
    unlistenTeammateBuff.then((fn) => fn());
    unlistenTeammateFantasy.then((fn) => fn());
    unlistenTeammateFantasyClear.then((fn) => fn());
    unlistenHateList.then((fn) => fn());
    unlistenBossDbm.then((fn) => fn());
    unlistenStun.then((fn) => fn());
    unlistenNames.then((fn) => fn());
    unlistenIdentities.then((fn) => fn());
    window.removeEventListener("pointermove", onGlobalPointerMove);
    window.removeEventListener("pointerup", onGlobalPointerUp);
    if (monsterRuntime.rafId) {
      cancelAnimationFrame(monsterRuntime.rafId);
      monsterRuntime.rafId = null;
    }
    setMonsterOverlayWindow(null);
    monsterRuntime.cleanup = null;
  };

  return monsterRuntime.cleanup;
}
