<script lang="ts">
  /**
   * @file This is the layout for the live meter.
   * It sets up event listeners for live data, manages the pause state,
   * and handles scroll position restoration.
   *
   * It also displays the header, footer, boss health, and notification toasts.
   *
   * @packageDocumentation
   */
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import {
    refreshLiveWindowSettingsFromBackend,
    SETTINGS,
    SETTINGS_CHANGED_EVENT,
  } from "$lib/settings-store";
  import { activeProfileOrDefault } from "$lib/skill-monitor-profile.svelte";
  import {
    LIVE_WINDOW_MANUAL_SHOW_EVENT,
    hideVisiblePassiveOverlayWindows,
    restoreLiveWindowInteractivity,
    restorePassiveOverlayWindows,
    showLiveWindowWithoutFocus,
  } from "$lib/utils.svelte";
  import { resolveUiTranslation } from "$lib/i18n";
  import {
    onLiveData,
    onResetEncounter,
    onEncounterUpdate,
    onSceneChange,
    onPauseEncounter,
    onTrainingDummyUpdate,
    onDeathReplay,
  } from "$lib/api";
  import type { LiveDataPayload, RawCombatStats, RawSkillStats } from "$lib/api";
  import { applyCustomFonts } from "$lib/font-loader";
  import AppBackgroundLayer from "$lib/components/app-background-layer.svelte";
  import { writable } from "svelte/store";
  import { beforeNavigate, afterNavigate } from "$app/navigation";
  import { liveEntityRenderKey } from "$lib/live-entity-route";


  function t(key: string, fallback: string): string {
    return resolveUiTranslation(
      "ui/dps/live.json",
      key,
      SETTINGS.live.general.state.language,
      fallback,
    );
  }

  // Store for pause state
  export const isPaused = writable(false);

  // Store for scroll positions
  const scrollPositions = writable<Record<string, number>>({});

  import {
    setLiveData,
    setLiveDisplayNowMs,
    isCrowdedLiveSession,
    setDeathRecords,
    setTrainingDummyState,
    clearMeterData,
    cleanupStores,
  } from "$lib/stores/live-meter-store.svelte";
  import HeaderCustom from "./header-custom.svelte";

  import NotificationToast from "./notification-toast.svelte";

  let { children } = $props();
  // let screenshotDiv: HTMLDivElement | undefined = $state();

  let notificationToast: NotificationToast;
  let rootElement: HTMLElement | undefined = undefined;
  let mainElement: HTMLElement | undefined = undefined;
  let unlisten: (() => void) | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let dynamicResizeFrame = 0;
  let dynamicResizeCooldownTimer: ReturnType<typeof setTimeout> | null = null;
  let dynamicResizeInFlight = false;
  let dynamicResizePending = false;
  let lastDynamicResizeAtMs = 0;
  let lastDynamicHeight = 0;
  let dynamicHeightConstraint = 0;
  let dynamicWindowEnabled = $derived(SETTINGS.live.dynamicWindow.state.enabled === true);
  const activeProfile = $derived.by(() => activeProfileOrDefault());
  const autoHideOnGameBlurEnabled = $derived(
    activeProfile.autoHideWindowsOnGameBlur === true,
  );
  const DYNAMIC_WINDOW_MIN_HEIGHT = 80;

  // Prevent concurrent setupEventListeners runs which can attach duplicate listeners
  let listenersSetupInProgress = false;
  let lastEventTime = Date.now();
  let hadAnyEvent = false; // becomes true after the first live event arrives
  // Persist last known pause state across listener reconnections so we don't
  // show a spurious "Encounter resumed" toast every time listeners are
  // re-attached (e.g. on window focus/visibility change).
  let lastPauseState: boolean | null = null;
  let reconnectInterval: ReturnType<typeof setInterval> | null = null;
  let isReconnecting = false;
  let reconnectDelay = 1000; // exponential backoff base
  const DISCONNECT_THRESHOLD = 5000;
  // Track if component is destroyed to prevent callbacks from firing after unmount
  let isDestroyed = false;
  let autoHideRecentlyDamaged = false;
  let autoHideLastObservedDamageTotal = 0;
  let autoHideHiddenByFeature = false;
  let autoHideHiddenOverlayLabels = new Set<string>();
  let autoHideOperation: Promise<void> = Promise.resolve();
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  let gameBlurHiddenLiveWindow = false;
  let gameBlurHiddenOverlayLabels = new Set<string>();
  let gameBlurLastForeground: boolean | null = null;
  let gameBlurOperation: Promise<void> = Promise.resolve();
  let gameBlurPollInterval: ReturnType<typeof setInterval> | null = null;
  let manualShowUnlisten: UnlistenFn | null = null;
  let settingsChangedUnlisten: UnlistenFn | null = null;
  let settingsRefreshInterval: ReturnType<typeof setInterval> | null = null;
  let latestLivePayload: LiveDataPayload | null = null;
  let lastLiveActivitySignature = "";
  let lastLiveActivityAtMs = Date.now();
  let frozenLiveDisplayNowMs: number | null = null;
  let suppressEmptyClearAfterSceneChange = false;
  const CROWDED_SESSION_MIN_REFRESH_MS = 1000;
  const GAME_FOREGROUND_POLL_MS = 750;
  const LIVE_SETTINGS_REFRESH_FALLBACK_MS = 3000;
  const DYNAMIC_WINDOW_HEIGHT_BUFFER_PX = 2;
  const DYNAMIC_WINDOW_RESIZE_EPSILON_PX = 4;
  const DYNAMIC_WINDOW_MIN_RESIZE_INTERVAL_MS = 250;

  function clampLiveRefreshRateMs(value: unknown): number {
    const numberValue = Number(value);
    const base = Number.isFinite(numberValue) ? numberValue : 200;
    return Math.max(50, Math.min(2000, Math.round(base / 50) * 50));
  }

  function liveDisplayRefreshRateMs(): number {
    const configuredRate = clampLiveRefreshRateMs(
      SETTINGS.live.general.state.eventUpdateRateMs,
    );
    return isCrowdedLiveSession()
      ? Math.max(configuredRate, CROWDED_SESSION_MIN_REFRESH_MS)
      : configuredRate;
  }

  function idleDisplayPauseDelayMs(): number {
    const rawSeconds = Number(SETTINGS.live.general.state.idleDisplayPauseDelaySeconds);
    const seconds = Number.isFinite(rawSeconds) ? rawSeconds : 5;
    return Math.max(1, Math.min(30, Math.round(seconds))) * 1000;
  }

  function combatStatsSignature(stats: RawCombatStats | null | undefined): string {
    if (!stats) return "0:0:0:0:0:0:0:0:0:0";
    return [
      stats.total,
      stats.effectiveTotal,
      stats.hits,
      stats.critHits,
      stats.critTotal,
      stats.luckyHits,
      stats.luckyTotal,
      stats.triggerHits,
      stats.blockHits,
      stats.luckyBlockHits,
    ].join(":");
  }

  function skillStatsSignature(
    skills: Partial<Record<number, RawSkillStats>> | null | undefined,
  ): string {
    if (!skills) return "";
    return Object.entries(skills)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([skillId, stats]) => {
        if (!stats) return `${skillId}=0`;
        return [
          skillId,
          stats.totalValue,
          stats.effectiveTotalValue,
          stats.hits,
          stats.critHits,
          stats.critTotalValue,
          stats.luckyHits,
          stats.luckyTotalValue,
          stats.triggerHits,
          stats.blockHits,
          stats.luckyBlockHits,
        ].join(":");
      })
      .join(",");
  }

  function liveActivitySignature(payload: LiveDataPayload): string {
    const bosses = payload.bosses
      .map((boss) => [
        liveEntityRenderKey(boss),
        boss.name,
        boss.currentHp ?? "",
        boss.maxHp ?? "",
      ].join(":"))
      .join("|");

    const entities = payload.entities
      .map((entity) => [
        liveEntityRenderKey(entity),
        entity.uuid ?? "",
        entity.name,
        entity.classId,
        entity.classSpec,
        combatStatsSignature(entity.damage),
        combatStatsSignature(entity.damageBossOnly),
        combatStatsSignature(entity.healing),
        combatStatsSignature(entity.taken),
        skillStatsSignature(entity.dmgSkills),
        skillStatsSignature(entity.healSkills),
        skillStatsSignature(entity.takenSkills),
        entity.deaths?.length ?? 0,
      ].join("~"))
      .join("|");

    return [
      payload.sceneId ?? "",
      payload.sceneName ?? "",
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

  function markLiveActivity(nowMs = Date.now()): void {
    lastLiveActivityAtMs = nowMs;
    frozenLiveDisplayNowMs = null;
  }

  function resetLiveActivityTracking(nowMs = Date.now()): void {
    latestLivePayload = null;
    lastLiveActivitySignature = "";
    markLiveActivity(nowMs);
    setLiveDisplayNowMs(nowMs);
  }

  function updateLiveActivityFromPayload(
    payload: LiveDataPayload,
    nowMs = Date.now(),
  ): void {
    latestLivePayload = payload;
    const signature = liveActivitySignature(payload);
    if (signature !== lastLiveActivitySignature) {
      lastLiveActivitySignature = signature;
      markLiveActivity(nowMs);
    }
  }

  function currentLiveDisplayNowMs(nowMs = Date.now()): number {
    const payload = latestLivePayload;
    if (
      !payload ||
      SETTINGS.live.general.state.idleDisplayPauseEnabled !== true ||
      payload.fightStartTimestampMs <= 0 ||
      payload.isPaused ||
      payload.dpsDisplayPaused ||
      payload.trainingDummy?.phase === "finished"
    ) {
      frozenLiveDisplayNowMs = null;
      return nowMs;
    }

    const delayMs = idleDisplayPauseDelayMs();
    if (nowMs - lastLiveActivityAtMs < delayMs) {
      frozenLiveDisplayNowMs = null;
      return nowMs;
    }

    if (frozenLiveDisplayNowMs === null) {
      frozenLiveDisplayNowMs = lastLiveActivityAtMs + delayMs;
    }
    return frozenLiveDisplayNowMs;
  }

  function ingestLiveDataPayload(
    payload: LiveDataPayload,
    nowMs = Date.now(),
  ): void {
    suppressEmptyClearAfterSceneChange = false;
    updateLiveActivityFromPayload(payload, nowMs);
  }

  function shouldSuppressEmptyLiveClear(): boolean {
    return suppressEmptyClearAfterSceneChange
      && SETTINGS.live.general.state.autoClearOnSceneChange === false;
  }

  function clearEmptyLivePayload(nowMs = Date.now()): void {
    if (shouldSuppressEmptyLiveClear()) {
      setLiveDisplayNowMs(nowMs);
      return;
    }
    resetLiveActivityTracking(nowMs);
    clearMeterData();
  }

  function refreshLiveDisplay(nowMs = Date.now()): void {
    const payload = latestLivePayload;
    if (payload && payload.fightStartTimestampMs > 0) {
      setLiveData(payload);
    }
    setLiveDisplayNowMs(currentLiveDisplayNowMs(nowMs));
  }

  $effect(() => {
    if (typeof window === "undefined") return;
    const refreshRateMs = liveDisplayRefreshRateMs();
    refreshLiveDisplay(Date.now());
    const timer = setInterval(() => {
      refreshLiveDisplay(Date.now());
    }, refreshRateMs);
    return () => clearInterval(timer);
  });

  $effect(() => {
    const liveAutoHideEnabled = SETTINGS.live.general.state.autoHideLiveWindow === true;
    const overlayAutoHideEnabled =
      SETTINGS.live.general.state.autoHideOverlaysWithLiveWindow === true;
    if (!liveAutoHideEnabled) {
      void syncAutoHideLiveWindow(autoHideRecentlyDamaged, true);
      return;
    }
    if (!overlayAutoHideEnabled) {
      void restoreAutoHiddenOverlays();
    }
  });

  function damageNumber(value: unknown): number {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? Math.max(0, numberValue) : 0;
  }

  function recordObservedDamageTotal(total: number): boolean {
    const currentTotal = Math.max(0, total);
    const hasNewDamage = currentTotal > autoHideLastObservedDamageTotal;
    autoHideLastObservedDamageTotal = currentTotal;
    return hasNewDamage;
  }

  function livePayloadDamageTotal(payload: LiveDataPayload): number {
    const payloadTotal = Math.max(
      damageNumber(payload.totalDmg),
      damageNumber(payload.totalDmgBossOnly),
    );
    if (payloadTotal > 0) return payloadTotal;

    return payload.entities.reduce(
      (sum, entity) =>
        sum +
        damageNumber(entity.damage?.total) +
        damageNumber(entity.damageBossOnly?.total) +
        damageNumber(entity.taken?.total),
      0,
    );
  }

  function livePayloadHasDamageEvent(payload: LiveDataPayload): boolean {
    return recordObservedDamageTotal(livePayloadDamageTotal(payload));
  }

  function headerHasDamageEvent(headerInfo: { totalDmg: number }): boolean {
    return recordObservedDamageTotal(damageNumber(headerInfo.totalDmg));
  }

  function clearAutoHideTimer(): void {
    if (!autoHideTimer) return;
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }

  function autoHideDelayMs(): number {
    const rawSeconds = Number(SETTINGS.live.general.state.autoHideLiveWindowDelaySeconds);
    const seconds = Number.isFinite(rawSeconds) ? rawSeconds : 5;
    return Math.max(0, Math.min(60, seconds)) * 1000;
  }

  async function restoreLiveWindowCursorMode(
    liveWindow = getCurrentWindow(),
  ): Promise<void> {
    try {
      await restoreLiveWindowInteractivity(liveWindow);
    } catch (error) {
      console.warn("Failed to restore live window clickthrough state:", error);
    }
  }

  async function hideLiveWindowForAutoHide(): Promise<void> {
    if (isDestroyed || autoHideHiddenByFeature) return;

    const liveWindow = getCurrentWindow();

    try {
      const [isVisible, isMinimized] = await Promise.all([
        liveWindow.isVisible().catch(() => true),
        liveWindow.isMinimized().catch(() => false),
      ]);

      if (!isVisible || isMinimized) {
        return;
      }

      await liveWindow.setFocusable(false);
      await liveWindow.setIgnoreCursorEvents(true);
      await liveWindow.hide();
      await liveWindow.setIgnoreCursorEvents(true);
      autoHideHiddenByFeature = true;
      if (SETTINGS.live.general.state.autoHideOverlaysWithLiveWindow === true) {
        autoHideHiddenOverlayLabels = await hideVisiblePassiveOverlayWindows();
      }
    } catch (error) {
      console.warn("Failed to hide live window after auto-hide delay:", error);
      await restoreLiveWindowCursorMode(liveWindow);
    }
  }

  async function queryGameOrParserWindowForeground(): Promise<boolean> {
    try {
      return await invoke<boolean>("is_game_window_foreground");
    } catch (error) {
      console.warn("Failed to check foreground game/parser window:", error);
      return true;
    }
  }

  async function hideWindowsForGameBlur(): Promise<void> {
    if (isDestroyed) return;

    const liveWindow = getCurrentWindow();

    try {
      const [isVisible, isMinimized] = await Promise.all([
        liveWindow.isVisible().catch(() => true),
        liveWindow.isMinimized().catch(() => false),
      ]);

      if (isVisible && !isMinimized && !gameBlurHiddenLiveWindow) {
        await liveWindow.setFocusable(false);
        await liveWindow.setIgnoreCursorEvents(true);
        await liveWindow.hide();
        await liveWindow.setIgnoreCursorEvents(true);
        gameBlurHiddenLiveWindow = true;
      }

      const labels = await hideVisiblePassiveOverlayWindows();
      for (const label of labels) {
        gameBlurHiddenOverlayLabels.add(label);
      }
    } catch (error) {
      console.warn("Failed to hide live/overlay windows after game lost focus:", error);
      await restoreLiveWindowCursorMode(liveWindow);
    }
  }

  async function restoreGameBlurHiddenWindows(): Promise<void> {
    const liveWindow = getCurrentWindow();
    const hiddenLabels = gameBlurHiddenOverlayLabels;
    gameBlurHiddenOverlayLabels = new Set();

    if (gameBlurHiddenLiveWindow) {
      gameBlurHiddenLiveWindow = false;
      const keepHiddenForDamageAutoHide =
        SETTINGS.live.general.state.autoHideLiveWindow === true && !autoHideRecentlyDamaged;

      if (!keepHiddenForDamageAutoHide) {
        await showLiveWindowWithoutFocus(liveWindow);
      }

      await restoreLiveWindowCursorMode(liveWindow);
    }

    await restorePassiveOverlayWindows(hiddenLabels);
  }

  async function applyGameBlurAutoHideState(gameOrParserIsForeground: boolean): Promise<void> {
    if (isDestroyed) return;

    if (!autoHideOnGameBlurEnabled) {
      gameBlurLastForeground = null;
      await restoreGameBlurHiddenWindows();
      return;
    }

    if (!gameOrParserIsForeground) {
      await hideWindowsForGameBlur();
      return;
    }

    await restoreGameBlurHiddenWindows();
    void syncAutoHideLiveWindow(autoHideRecentlyDamaged, true);
  }

  function syncGameBlurAutoHide(force = false): Promise<void> {
    gameBlurOperation = gameBlurOperation
      .catch(() => undefined)
      .then(async () => {
        const gameOrParserIsForeground = autoHideOnGameBlurEnabled
          ? await queryGameOrParserWindowForeground()
          : true;
        if (!force && gameBlurLastForeground === gameOrParserIsForeground) {
          return;
        }
        gameBlurLastForeground = gameOrParserIsForeground;
        await applyGameBlurAutoHideState(gameOrParserIsForeground);
      });
    return gameBlurOperation;
  }

  function startGameBlurPolling(): void {
    if (gameBlurPollInterval) return;
    gameBlurPollInterval = setInterval(() => {
      void syncGameBlurAutoHide();
    }, GAME_FOREGROUND_POLL_MS);
    void syncGameBlurAutoHide(true);
  }

  function stopGameBlurPolling(): void {
    if (!gameBlurPollInterval) return;
    clearInterval(gameBlurPollInterval);
    gameBlurPollInterval = null;
  }

  async function restoreAutoHiddenOverlays(): Promise<void> {
    if (autoHideHiddenOverlayLabels.size === 0) return;
    const labels = autoHideHiddenOverlayLabels;
    autoHideHiddenOverlayLabels = new Set();
    await restorePassiveOverlayWindows(labels);
  }

  function reconcileManualLiveWindowShow(): void {
    clearAutoHideTimer();
    autoHideHiddenByFeature = false;
    void restoreAutoHiddenOverlays();
    void syncAutoHideLiveWindow(autoHideRecentlyDamaged, true);
  }

  function queueAutoHideAfterDelay(): void {
    if (autoHideHiddenByFeature || autoHideTimer) return;

    const delayMs = autoHideDelayMs();
    if (delayMs <= 0) {
      autoHideOperation = autoHideOperation
        .catch(() => undefined)
        .then(() => hideLiveWindowForAutoHide());
      return;
    }

    autoHideTimer = setTimeout(() => {
      autoHideTimer = null;
      if (
        isDestroyed ||
        autoHideRecentlyDamaged ||
        SETTINGS.live.general.state.autoHideLiveWindow !== true
      ) {
        return;
      }

      autoHideOperation = autoHideOperation
        .catch(() => undefined)
        .then(() => hideLiveWindowForAutoHide());
    }, delayMs);
  }

  async function applyAutoHideLiveWindow(rescheduleDelay = false): Promise<void> {
    const hasDamage = autoHideRecentlyDamaged;

    if (isDestroyed || typeof window === "undefined") return;

    const autoHideEnabled = SETTINGS.live.general.state.autoHideLiveWindow === true;
    const liveWindow = getCurrentWindow();

    try {
      if (!autoHideEnabled) {
        clearAutoHideTimer();
        if (autoHideHiddenByFeature) {
          autoHideHiddenByFeature = false;
          if (!(autoHideOnGameBlurEnabled && gameBlurLastForeground === false)) {
            await showLiveWindowWithoutFocus(liveWindow);
          }
        }
        await restoreAutoHiddenOverlays();
        await restoreLiveWindowCursorMode(liveWindow);
        return;
      }

      if (hasDamage) {
        clearAutoHideTimer();
        if (autoHideOnGameBlurEnabled && gameBlurLastForeground === false) {
          return;
        }
        if (autoHideHiddenByFeature) {
          autoHideHiddenByFeature = false;
          await showLiveWindowWithoutFocus(liveWindow);
        }
        await restoreAutoHiddenOverlays();
        await restoreLiveWindowCursorMode(liveWindow);
        return;
      }

      if (rescheduleDelay) {
        clearAutoHideTimer();
      }

      queueAutoHideAfterDelay();
    } catch (error) {
      console.warn("Failed to sync auto-hide live window state:", error);
    }
  }

  function syncAutoHideLiveWindow(
    hasDamage = autoHideRecentlyDamaged,
    rescheduleDelay = false,
  ): Promise<void> {
    autoHideRecentlyDamaged = hasDamage;
    autoHideOperation = autoHideOperation
      .catch(() => undefined)
      .then(() => applyAutoHideLiveWindow(rescheduleDelay));
    return autoHideOperation;
  }

  async function setupEventListeners() {
    if (isDestroyed || isReconnecting || listenersSetupInProgress) return;
    listenersSetupInProgress = true;

    // If listeners are already attached, skip setup to avoid duplicates.
    if (unlisten) {
      listenersSetupInProgress = false;
      return;
    }

    try {
      // Set up unified live-data listener
      const playersUnlisten = await onLiveData((event) => {
        if (isDestroyed) return;
        lastEventTime = Date.now();
        hadAnyEvent = true;
        void syncAutoHideLiveWindow(livePayloadHasDamageEvent(event.payload));
        if (event.payload.fightStartTimestampMs > 0) {
          ingestLiveDataPayload(event.payload, lastEventTime);
        } else if (event.payload.totalDmg === 0 && event.payload.totalHeal === 0) {
          clearEmptyLivePayload(lastEventTime);
        }
      });

      if (isDestroyed) {
        playersUnlisten();
        listenersSetupInProgress = false;
        return;
      }

      // Set up reset encounter listener
      const resetUnlisten = await onResetEncounter(() => {
        if (isDestroyed) return;
        lastEventTime = Date.now();
        hadAnyEvent = true;
        suppressEmptyClearAfterSceneChange = false;
        autoHideLastObservedDamageTotal = 0;
        resetLiveActivityTracking(lastEventTime);
        void syncAutoHideLiveWindow(false);
        clearMeterData();
        notificationToast?.showToast(
          "notice",
t("live.resetToast", "Encounter reset"),
        );
      });

      if (isDestroyed) {
        playersUnlisten();
        resetUnlisten();
        listenersSetupInProgress = false;
        return;
      }

      // Set up encounter update listener (pause/resume)
      const encounterUnlisten = await onEncounterUpdate((event) => {
        if (isDestroyed) return;
        // Treat encounter updates as keep-alive too so reconnect logic doesn't fire
        lastEventTime = Date.now();
        hadAnyEvent = true;
        markLiveActivity(lastEventTime);
        const newPaused = event.payload.isPaused;
        const elapsedMs = event.payload.headerInfo.elapsedMs;
        void syncAutoHideLiveWindow(headerHasDamageEvent(event.payload.headerInfo));
        // update the store regardless
        isPaused.set(newPaused);
        if (
          event.payload.headerInfo.fightStartTimestampMs <= 0 &&
          event.payload.headerInfo.totalDmg === 0
        ) {
          clearEmptyLivePayload(lastEventTime);
        }
        // only show a toast if the pause state actually changed AND we've started receiving combat data
        // Note: do NOT show a toast on the initial listener attach (lastPauseState === null)
        // to avoid spurious "Encounter resumed" messages when reattaching listeners
        if (
          elapsedMs > 0 &&
          lastPauseState !== null &&
          lastPauseState !== newPaused
        ) {
          if (newPaused) {
            notificationToast?.showToast(
              "notice",
t("live.pauseToast", "战斗已暂停"),
            );
          } else {
            notificationToast?.showToast(
              "notice",
t("live.resumeToast", "战斗已继续"),
            );
          }
        }
        lastPauseState = newPaused;
      });

      if (isDestroyed) {
        playersUnlisten();
        resetUnlisten();
        encounterUnlisten();
        listenersSetupInProgress = false;
        return;
      }

      // Set up scene change listener
      const sceneChangeUnlisten = await onSceneChange(() => {
        if (isDestroyed) return;
        // Treat scene change as a keep-alive
        lastEventTime = Date.now();
        hadAnyEvent = true;
        if (SETTINGS.live.general.state.autoClearOnSceneChange !== false) {
          suppressEmptyClearAfterSceneChange = false;
          resetLiveActivityTracking(lastEventTime);
          autoHideLastObservedDamageTotal = 0;
          void syncAutoHideLiveWindow(false);
        } else {
          suppressEmptyClearAfterSceneChange = true;
          setLiveDisplayNowMs(lastEventTime);
        }
        // notificationToast?.showToast('notice', `Scene changed to ${event.payload.sceneName}`);
      });

      if (isDestroyed) {
        playersUnlisten();
        resetUnlisten();
        encounterUnlisten();
        sceneChangeUnlisten();
        listenersSetupInProgress = false;
        return;
      }

      const trainingDummyUnlisten = await onTrainingDummyUpdate((event) => {
        if (isDestroyed) return;
        lastEventTime = Date.now();
        hadAnyEvent = true;
        markLiveActivity(lastEventTime);
        setTrainingDummyState(event.payload);
      });

      if (isDestroyed) {
        playersUnlisten();
        resetUnlisten();
        encounterUnlisten();
        sceneChangeUnlisten();
        trainingDummyUnlisten();
        listenersSetupInProgress = false;
        return;
      }

      const deathReplayUnlisten = await onDeathReplay((event) => {
        if (isDestroyed) return;
        lastEventTime = Date.now();
        hadAnyEvent = true;
        markLiveActivity(lastEventTime);
        setDeathRecords(event.payload.records);
      });

      if (isDestroyed) {
        playersUnlisten();
        resetUnlisten();
        encounterUnlisten();
        sceneChangeUnlisten();
        trainingDummyUnlisten();
        deathReplayUnlisten();
        listenersSetupInProgress = false;
        return;
      }

      // Listen for explicit pause/resume events as a keep-alive as well
      const pauseUnlisten = await onPauseEncounter((event) => {
        if (isDestroyed) return;
        lastEventTime = Date.now();
        hadAnyEvent = true;
        markLiveActivity(lastEventTime);
        isPaused.set(!!event.payload);
      });

      if (isDestroyed) {
        playersUnlisten();
        resetUnlisten();
        encounterUnlisten();
        sceneChangeUnlisten();
        trainingDummyUnlisten();
        deathReplayUnlisten();
        pauseUnlisten();
        listenersSetupInProgress = false;
        return;
      }

      // Combine all unlisten functions
      unlisten = () => {
        try {
          playersUnlisten();
        } catch {}
        try {
          resetUnlisten();
        } catch {}
        try {
          encounterUnlisten();
        } catch {}
        try {
          sceneChangeUnlisten();
        } catch {}
        try {
          trainingDummyUnlisten();
        } catch {}
        try {
          deathReplayUnlisten();
        } catch {}
        try {
          pauseUnlisten();
        } catch {}
      };

      listenersSetupInProgress = false;
    } catch (e) {
      console.error("Failed to set up event listeners:", e);
      listenersSetupInProgress = false;
      if (isDestroyed) return;
      isReconnecting = true;
      setTimeout(() => {
        isReconnecting = false;
        if (!isDestroyed) setupEventListeners();
      }, reconnectDelay);
      // increase backoff cap at ~10s
      reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
    }
  }

  function startReconnectCheck() {
    reconnectInterval = setInterval(() => {
      if (isDestroyed) return;
      const now = Date.now();
      if (hadAnyEvent && now - lastEventTime > DISCONNECT_THRESHOLD) {
        console.warn("Live event stream disconnected, attempting reconnection");
        if (unlisten) {
          unlisten();
          unlisten = null;
        }
        // reset timer to avoid tight loop spam
        lastEventTime = now;
        setupEventListeners();
        // backoff after each timer-triggered reconnect
        reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
      }
    }, 1000);
  }

  async function clearDynamicWindowHeightConstraint() {
    if (dynamicHeightConstraint <= 0 && lastDynamicHeight <= 0) return;
    dynamicHeightConstraint = 0;
    lastDynamicHeight = 0;

    try {
      await getCurrentWindow().setSizeConstraints(null);
    } catch (error) {
      console.warn("Failed to clear dynamic live window height constraint:", error);
    }
  }

  async function applyDynamicWindowHeight(targetHeight: number) {
    const liveWindow = getCurrentWindow();

    try {
      if (
        dynamicHeightConstraint > 0 &&
        Math.abs(targetHeight - dynamicHeightConstraint) > DYNAMIC_WINDOW_RESIZE_EPSILON_PX
      ) {
        await liveWindow.setSizeConstraints(null);
        dynamicHeightConstraint = 0;
      }

      await liveWindow.setSize(
        new LogicalSize(Math.ceil(window.innerWidth), targetHeight),
      );
      await liveWindow.setSizeConstraints({
        minHeight: targetHeight,
        maxHeight: targetHeight,
      });
      dynamicHeightConstraint = targetHeight;
    } catch (error) {
      console.warn("Failed to resize dynamic live window:", error);
    }
  }

  function scheduleDynamicResize() {
    if (!dynamicWindowEnabled || !rootElement || typeof window === "undefined") {
      dynamicResizePending = false;
      if (dynamicResizeCooldownTimer) {
        clearTimeout(dynamicResizeCooldownTimer);
        dynamicResizeCooldownTimer = null;
      }
      void clearDynamicWindowHeightConstraint();
      return;
    }

    dynamicResizePending = true;
    const timeUntilNextResize = Math.max(
      0,
      DYNAMIC_WINDOW_MIN_RESIZE_INTERVAL_MS - (Date.now() - lastDynamicResizeAtMs),
    );
    if (dynamicResizeInFlight || timeUntilNextResize > 0) {
      if (!dynamicResizeCooldownTimer) {
        dynamicResizeCooldownTimer = setTimeout(() => {
          dynamicResizeCooldownTimer = null;
          scheduleDynamicResize();
        }, dynamicResizeInFlight ? DYNAMIC_WINDOW_MIN_RESIZE_INTERVAL_MS : timeUntilNextResize);
      }
      return;
    }
    if (dynamicResizeFrame) return;

    dynamicResizeFrame = requestAnimationFrame(async () => {
      dynamicResizeFrame = 0;
      dynamicResizePending = false;
      if (!dynamicWindowEnabled || !rootElement) {
        void clearDynamicWindowHeightConstraint();
        return;
      }

      const targetHeight = Math.max(
        DYNAMIC_WINDOW_MIN_HEIGHT,
        Math.ceil(rootElement.scrollHeight) + DYNAMIC_WINDOW_HEIGHT_BUFFER_PX,
      );
      if (
        Math.abs(targetHeight - lastDynamicHeight) <= DYNAMIC_WINDOW_RESIZE_EPSILON_PX
        && Math.abs(targetHeight - dynamicHeightConstraint) <= DYNAMIC_WINDOW_RESIZE_EPSILON_PX
      ) {
        return;
      }
      lastDynamicHeight = targetHeight;

      dynamicResizeInFlight = true;
      try {
        await applyDynamicWindowHeight(targetHeight);
        lastDynamicResizeAtMs = Date.now();
      } finally {
        dynamicResizeInFlight = false;
        if (dynamicResizePending) scheduleDynamicResize();
      }
    });
  }

  // Save scroll position before navigating away
  beforeNavigate(({ from }) => {
    if (mainElement && from?.url.pathname) {
      scrollPositions.update((positions) => ({
        ...positions,
        [from.url.pathname]: mainElement!.scrollTop,
      }));
    }
  });

  // Restore scroll position after navigation
  afterNavigate(({ to }) => {
    if (mainElement && to?.url.pathname) {
      const savedPosition = $scrollPositions[to.url.pathname];
      if (savedPosition !== undefined) {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          if (mainElement) {
            mainElement.scrollTop = savedPosition;
          }
        });
      }
    }
  });

  onMount(() => {
    isDestroyed = false;
    autoHideLastObservedDamageTotal = 0;
    void refreshLiveWindowSettingsFromBackend();
    settingsRefreshInterval = setInterval(() => {
      void refreshLiveWindowSettingsFromBackend();
    }, LIVE_SETTINGS_REFRESH_FALLBACK_MS);
    void listen(SETTINGS_CHANGED_EVENT, () => {
      void refreshLiveWindowSettingsFromBackend();
    })
      .then((unlistenSettingsChanged) => {
        if (isDestroyed) {
          unlistenSettingsChanged();
          return;
        }
        settingsChangedUnlisten = unlistenSettingsChanged;
      })
      .catch((error) => {
        console.warn("Failed to listen for settings updates:", error);
      });
    void syncAutoHideLiveWindow(false);
    void listen(LIVE_WINDOW_MANUAL_SHOW_EVENT, reconcileManualLiveWindowShow)
      .then((unlistenManualShow) => {
        if (isDestroyed) {
          unlistenManualShow();
          return;
        }
        manualShowUnlisten = unlistenManualShow;
      })
      .catch((error) => {
        console.warn("Failed to listen for live window manual show:", error);
      });
    setupEventListeners();
    startReconnectCheck();
    resizeObserver = new ResizeObserver(() => scheduleDynamicResize());
    if (rootElement) resizeObserver.observe(rootElement);
    scheduleDynamicResize();

    return () => {
      isDestroyed = true;
      if (dynamicResizeFrame) cancelAnimationFrame(dynamicResizeFrame);
      if (dynamicResizeCooldownTimer) clearTimeout(dynamicResizeCooldownTimer);
      clearAutoHideTimer();
      stopGameBlurPolling();
      void clearDynamicWindowHeightConstraint();
      resizeObserver?.disconnect();
      if (reconnectInterval) clearInterval(reconnectInterval);
      if (settingsRefreshInterval) clearInterval(settingsRefreshInterval);
      settingsChangedUnlisten?.();
      manualShowUnlisten?.();
      if (unlisten) unlisten();
      cleanupStores();
    };
  });

  $effect(() => {
    SETTINGS.live.general.state.autoHideLiveWindow;
    SETTINGS.live.general.state.autoHideLiveWindowDelaySeconds;
    void syncAutoHideLiveWindow(autoHideRecentlyDamaged, true);
  });

  $effect(() => {
    SETTINGS.accessibility.state.clickthrough;
    if (autoHideHiddenByFeature) {
      void getCurrentWindow()
        .setIgnoreCursorEvents(true)
        .catch((error) => {
          console.warn("Failed to keep hidden live window clickthrough:", error);
        });
    } else {
      void restoreLiveWindowCursorMode();
    }
  });

  $effect(() => {
    if (autoHideOnGameBlurEnabled) {
      startGameBlurPolling();
    } else {
      stopGameBlurPolling();
      void syncGameBlurAutoHide(true);
    }
  });

  $effect(() => {
    applyCustomFonts({
      sansEnabled: SETTINGS.accessibility.state.customFontSansEnabled,
      sansName: SETTINGS.accessibility.state.customFontSansName,
      sansUrl: SETTINGS.accessibility.state.customFontSansUrl,
      monoEnabled: SETTINGS.accessibility.state.customFontMonoEnabled,
      monoName: SETTINGS.accessibility.state.customFontMonoName,
      monoUrl: SETTINGS.accessibility.state.customFontMonoUrl,
    });
  });

  $effect(() => {
    SETTINGS.live.dynamicWindow.state.enabled;
    SETTINGS.live.dynamicWindow.state.maxPlayerRows;
    SETTINGS.live.tableCustomization.state.playerRowHeight;
    SETTINGS.live.tableCustomization.state.tableHeaderHeight;
    SETTINGS.live.headerCustomization.state.windowPadding;
    if (dynamicWindowEnabled) {
      scheduleDynamicResize();
    } else {
      void clearDynamicWindowHeightConstraint();
    }
  });

</script>

<!-- flex flex-col min-h-screen → makes the page stretch full height and stack header, body, and footer. -->
<!-- flex-1 on <main> → makes the body expand to fill leftover space, pushing the footer down. -->
<div
  bind:this={rootElement}
  class="relative isolate {dynamicWindowEnabled ? 'min-h-0' : 'h-screen'} overflow-hidden rounded-xl text-[13px] text-foreground font-sans shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)]"
  style="padding: {SETTINGS.live.headerCustomization.state.windowPadding}px"
  data-tauri-drag-region
>
  <AppBackgroundLayer
    enabled={SETTINGS.accessibility.state.backgroundImageEnabled}
    image={SETTINGS.accessibility.state.backgroundImage}
    fallbackImage={SETTINGS.accessibility.state.backgroundImageSource}
    mode={SETTINGS.accessibility.state.backgroundImageMode || "cover"}
    containColor={SETTINGS.accessibility.state.backgroundImageContainColor || "rgba(0, 0, 0, 0)"}
    opacity={SETTINGS.accessibility.state.backgroundImageOpacity ?? 100}
  />
  <div
    class="pointer-events-none absolute inset-0 z-10 {SETTINGS.accessibility.state.backgroundImageEnabled
      ? 'app-background-wash-live'
      : 'bg-background-live'}"
  ></div>

  <div class="relative z-20 flex {dynamicWindowEnabled ? 'h-auto' : 'h-full'} flex-col">
    <div class="relative z-40 shrink-0">
      <HeaderCustom />
    </div>
    <main
      bind:this={mainElement}
      class="{dynamicWindowEnabled ? '' : 'flex-1'} relative z-0 flex min-h-0 flex-col overflow-hidden gap-4 rounded-lg bg-card/20"
    >
      {@render children()}
    </main>
    <!-- Footer removed; navigation and version moved into Header -->
    <NotificationToast bind:this={notificationToast} />
  </div>
</div>

<style>
  .app-background-wash-live {
    background: color-mix(in srgb, var(--background-live) 72%, transparent);
  }

  :global {
    html,
    body {
      background: transparent;
    }

    /* Hide scrollbars globally but keep scrolling functional */
    * {
      -ms-overflow-style: none; /* IE and Edge */
      scrollbar-width: none; /* Firefox */
    }
    *::-webkit-scrollbar {
      display: none; /* Chrome, Safari, Edge */
    }
  }
</style>
