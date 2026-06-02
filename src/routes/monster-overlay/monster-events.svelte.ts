import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  onBossBuffUpdate,
  onEntityIdentities,
  onEntityNames,
  onHateListUpdate,
  onTeammateBuffUpdate,
  type BuffUpdateState,
  type HateEntry,
} from "$lib/api";
import {
  onGlobalPointerMove,
  onGlobalPointerUp,
  setMonsterEditMode,
  setMonsterOverlayWindow,
} from "./monster-layout.svelte.js";
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
    const next = new Map<number, Map<number, BuffUpdateState>>();
    for (const [uid, buffs] of Object.entries(event.payload.bossBuffs)) {
      next.set(Number(uid), mapBossBuffs(buffs));
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
  const unlistenHateList = onHateListUpdate((event) => {
    const next = new Map<number, HateEntry[]>();
    for (const [uid, entries] of Object.entries(event.payload.hateLists)) {
      next.set(Number(uid), entries);
    }
    monsterRuntime.bossHateMap = next;
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
    monsterRuntime.bossSections = [];
    monsterRuntime.teammateColumns = [];
    monsterRuntime.teammateRows = [];
    monsterRuntime.hateSections = [];
    unlistenEditToggle.then((fn) => fn());
    unlistenSharedEditToggle.then((fn) => fn());
    unlistenBossBuff.then((fn) => fn());
    unlistenTeammateBuff.then((fn) => fn());
    unlistenHateList.then((fn) => fn());
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
