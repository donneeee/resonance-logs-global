<script lang="ts">
  /**
   * @file This is the layout for the main application window (Toolbox).
   * It sets up the left sidebar with tool list and right content area.
   */
  import { setupShortcuts } from "./dps/settings/shortcuts";
  import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { goto } from "$app/navigation";
  import {
    onDeathReplay,
    onSceneChange,
    type DeathRecord,
    type LiveDataPayload,
    type SceneChangePayload,
  } from "$lib/api";
  import {
    shouldRefreshDiscordPresenceOnTimer,
    syncDiscordPresenceConfig,
    updateDiscordPresenceFromLiveData,
  } from "$lib/discord-presence";
  import { isDailyScene } from "$lib/config/daily-scene-blacklist";
  import {
    getSettingsStoreReadFailures,
    hasRuntimeCriticalSettingsStoreReadFailure,
    repairPersistedSettingsStores,
    SETTINGS,
  } from '$lib/settings-store';
  import { applyCustomFonts } from "$lib/font-loader";
  import { commands } from "$lib/bindings";
  import { onMount } from 'svelte';
  import ToolSidebar from "./tool-sidebar.svelte";
  import AppBackgroundLayer from "$lib/components/app-background-layer.svelte";
  import ChangelogModal from '$lib/components/ChangelogModal.svelte';
  import UpdateModal from '$lib/components/UpdateModal.svelte';
  import { getVersion } from "@tauri-apps/api/app";

  type RuntimeMonitorSyncModule = typeof import("$lib/runtime-monitor-sync");
  type DiscordPresenceLiveSnapshot = {
    sequence: number;
    liveData: LiveDataPayload | null;
    deathRecords: DeathRecord[];
    scene: SceneChangePayload | null;
  };
  const DISCORD_PRESENCE_REFRESH_MS = 500;

  let { children } = $props();

  let runtimeMonitorSync = $state<RuntimeMonitorSyncModule | null>(null);
  let lastRuntimeSnapshotKey = "";
  let runtimeSnapshotInitialized = false;
  let lastOverlayVisibleState: boolean | null = null;
  let runtimeSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let overlayVisibilityOverride: boolean | null = null;
  let lastSharedOverlayEnabled: boolean | null = null;
  let runtimeSyncBlockedBySettingsFailure = false;
  let currentSceneId = $state<number | null>(null);
  let lastDiscordPresenceSettingsKey = "";
  let latestDiscordLivePayload: LiveDataPayload | null = null;
  let latestDiscordDeathRecords: DeathRecord[] = [];
  let latestDiscordSnapshotSequence = 0;
  let discordPresenceSnapshotRequestInFlight = false;

  function queueRuntimeSnapshotSync(
    sync: RuntimeMonitorSyncModule,
    runtimeSnapshot: ReturnType<RuntimeMonitorSyncModule["buildMonitorRuntimeSnapshot"]>,
    runtimeSnapshotKey: string,
    delayMs = 50,
  ) {
    if (runtimeSyncTimer) {
      clearTimeout(runtimeSyncTimer);
    }
    runtimeSyncTimer = setTimeout(() => {
      void (async () => {
        try {
          lastRuntimeSnapshotKey = runtimeSnapshotKey;
          await sync.saveAndApplyMonitorRuntimeSnapshot(runtimeSnapshot);
        } catch (error) {
          console.error("[runtime-monitor] failed to sync runtime snapshot", error);
        }
      })();
    }, delayMs);
  }

  $effect(() => {
    const sync = runtimeMonitorSync;
    if (!sync) return;
    if (hasRuntimeCriticalSettingsStoreReadFailure()) {
      if (!runtimeSyncBlockedBySettingsFailure) {
        runtimeSyncBlockedBySettingsFailure = true;
        console.warn(
          "[runtime-monitor] blocked runtime snapshot sync because critical settings stores failed to load",
          getSettingsStoreReadFailures(),
        );
      }
      return;
    }
    runtimeSyncBlockedBySettingsFailure = false;

    const runtimeSnapshot = sync.buildMonitorRuntimeSnapshot();
    const runtimeSnapshotKey = sync.createMonitorRuntimeSnapshotSignature(runtimeSnapshot);

    if (!runtimeSnapshotInitialized) {
      runtimeSnapshotInitialized = true;
      queueRuntimeSnapshotSync(sync, runtimeSnapshot, runtimeSnapshotKey, 0);
    } else if (runtimeSnapshotKey !== lastRuntimeSnapshotKey) {
      queueRuntimeSnapshotSync(sync, runtimeSnapshot, runtimeSnapshotKey);
    }

    const dbmOverlayEnabled =
      SETTINGS.minimap.state.showMapPanel ||
      SETTINGS.minimap.state.showInfoPanel ||
      (SETTINGS.monsterMonitor.state.overlayVisibility?.showBossDbmPanel ?? false);
    const sharedOverlayEnabled =
      SETTINGS.skillMonitor.state.enabled ||
      SETTINGS.monsterMonitor.state.enabled ||
      dbmOverlayEnabled;
    const autoHideSharedOverlayInDailyScene =
      currentSceneId !== null &&
      isDailyScene(currentSceneId) &&
      (
        (
          SETTINGS.skillMonitor.state.enabled &&
          (SETTINGS.skillMonitor.state.autoHideInDailyScenes ?? false)
        ) ||
        (
          SETTINGS.monsterMonitor.state.enabled &&
          (SETTINGS.monsterMonitor.state.autoHideInDailyScenes ?? false)
        ) ||
        (
          dbmOverlayEnabled &&
          (SETTINGS.minimap.state.autoHideInDailyScenes ?? false)
        )
      );

    if (lastSharedOverlayEnabled !== sharedOverlayEnabled) {
      lastSharedOverlayEnabled = sharedOverlayEnabled;
      overlayVisibilityOverride = null;
    }

    const desiredOverlayVisible = !autoHideSharedOverlayInDailyScene && (
      overlayVisibilityOverride ?? (
        SETTINGS.skillMonitor.state.overlayStartWithApp ? sharedOverlayEnabled : false
      )
    );

    void (async () => {
      try {
        const overlayWindow = await WebviewWindow.getByLabel("game-overlay");
        if (overlayWindow) {
          if (lastOverlayVisibleState !== desiredOverlayVisible) {
            lastOverlayVisibleState = desiredOverlayVisible;
            if (desiredOverlayVisible) {
              await overlayWindow.setFocusable(false);
              await overlayWindow.show();
              await overlayWindow.unminimize();
            } else {
              await overlayWindow.hide();
            }
          }
        }
      } catch (error) {
        console.error("[skill-monitor] failed to sync monitor state", error);
      }
    })();
  });

  $effect(() => {
    const monsterMonitorEnabled = SETTINGS.monsterMonitor.state.enabled;
    void (async () => {
      try {
        const monsterOverlayWindow = await WebviewWindow.getByLabel("monster-overlay");
        if (!monsterOverlayWindow) return;

        const isVisible = await monsterOverlayWindow.isVisible();
        if (isVisible || monsterMonitorEnabled) {
          await monsterOverlayWindow.hide();
        }
      } catch (error) {
        console.error("[monster-monitor] failed to retire legacy monster overlay window", error);
      }
    })();
  });

  $effect(() => {
    const settingsKey = [
      SETTINGS.discordPresence.state.enabled === true ? 1 : 0,
      SETTINGS.discordPresence.state.showLine !== false ? 1 : 0,
      SETTINGS.discordPresence.state.showBoss !== false ? 1 : 0,
      SETTINGS.discordPresence.state.showTimer !== false ? 1 : 0,
      SETTINGS.discordPresence.state.showDps !== false ? 1 : 0,
      SETTINGS.discordPresence.state.dpsMetric === "dps" ? "dps" : "tdps",
      SETTINGS.discordPresence.state.showDeaths !== false ? 1 : 0,
    ].join(":");
    if (settingsKey === lastDiscordPresenceSettingsKey) return;

    lastDiscordPresenceSettingsKey = settingsKey;
    const nowMs = Date.now();
    void syncDiscordPresenceConfig().catch((error) => {
      console.warn("Failed to sync Discord Rich Presence config:", error);
    });
    if (latestDiscordLivePayload) {
      void updateDiscordPresenceFromLiveData(
        latestDiscordLivePayload,
        nowMs,
        latestDiscordDeathRecords,
      );
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

  // Navigation listener is set up in onMount and properly cleaned up
  let navigateUnlisten: (() => void) | null = null;

  let showChangelog = $state(false);
  let currentVersion = $state('');
  type UpdateInfo = {
    version: string;
    body: string;
    downloadUrl: string;
  };
  const GLOBAL_UPDATE_DOWNLOAD_MARKER = "github.com/donneeee/resonance-logs-global";

  function isGlobalUpdateInfo(update: UpdateInfo): boolean {
    return update.downloadUrl.toLowerCase().includes(GLOBAL_UPDATE_DOWNLOAD_MARKER);
  }

  let updateInfo = $state<UpdateInfo | null>(null);
  let updateUnlisten: UnlistenFn | null = null;
  let overlayToggleUnlisten: UnlistenFn | null = null;
  let overlayChangedUnlisten: UnlistenFn | null = null;
  let sceneChangeUnlisten: UnlistenFn | null = null;
  let discordDeathReplayUnlisten: UnlistenFn | null = null;
  let discordPresenceRefreshTimer: ReturnType<typeof setInterval> | null = null;

  function refreshDiscordPresenceFromMain(nowMs = Date.now()) {
    const payload = latestDiscordLivePayload;
    if (!payload) return;
    if (!shouldRefreshDiscordPresenceOnTimer(payload, latestDiscordDeathRecords, nowMs)) return;
    void updateDiscordPresenceFromLiveData(payload, nowMs, latestDiscordDeathRecords);
  }

  function applyDiscordPresenceSnapshot(snapshot: DiscordPresenceLiveSnapshot, nowMs = Date.now()) {
    const sequence = Number(snapshot.sequence || 0);
    if (sequence <= 0) {
      refreshDiscordPresenceFromMain(nowMs);
      return;
    }
    if (sequence === latestDiscordSnapshotSequence) {
      refreshDiscordPresenceFromMain(nowMs);
      return;
    }

    latestDiscordSnapshotSequence = sequence;
    latestDiscordDeathRecords = snapshot.deathRecords ?? [];

    const payload = snapshot.liveData;
    if (payload) {
      latestDiscordLivePayload = payload;
      void updateDiscordPresenceFromLiveData(payload, nowMs, latestDiscordDeathRecords);
      return;
    }

    if (snapshot.scene) {
      const scenePayload = discordSceneOnlyPayload(snapshot.scene);
      latestDiscordLivePayload = scenePayload;
      void updateDiscordPresenceFromLiveData(scenePayload, nowMs, latestDiscordDeathRecords);
      return;
    }

    refreshDiscordPresenceFromMain(nowMs);
  }

  function pollDiscordPresenceSnapshot(nowMs = Date.now()) {
    if (discordPresenceSnapshotRequestInFlight) {
      refreshDiscordPresenceFromMain(nowMs);
      return;
    }

    discordPresenceSnapshotRequestInFlight = true;
    void commands.getDiscordPresenceLiveSnapshot()
      .then((result) => {
        if (result.status === "error") {
          console.warn("Failed to poll Discord Rich Presence live snapshot:", result.error);
          refreshDiscordPresenceFromMain(Date.now());
          return;
        }
        const snapshotJson = result.data;
        let snapshot: DiscordPresenceLiveSnapshot;
        try {
          snapshot = JSON.parse(snapshotJson) as DiscordPresenceLiveSnapshot;
        } catch (error) {
          console.warn("Failed to parse Discord Rich Presence live snapshot:", error);
          refreshDiscordPresenceFromMain(Date.now());
          return;
        }
        applyDiscordPresenceSnapshot(snapshot, Date.now());
      })
      .catch((error) => {
        console.warn("Failed to poll Discord Rich Presence live snapshot:", error);
        refreshDiscordPresenceFromMain(Date.now());
      })
      .finally(() => {
        discordPresenceSnapshotRequestInFlight = false;
      });
  }

  function sceneNameWithDifficulty(scene: SceneChangePayload): string {
    const sceneName = scene.sceneName?.trim() || "Unknown Scene";
    const difficulty = Number(scene.dungeonDifficulty ?? 0);
    if (!Number.isFinite(difficulty) || difficulty <= 0 || /-\d+$/.test(sceneName)) {
      return sceneName;
    }
    return `${sceneName}-${difficulty}`;
  }

  function discordSceneOnlyPayload(scene: SceneChangePayload): LiveDataPayload {
    return {
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
      sceneName: sceneNameWithDifficulty(scene),
      sceneLineId: scene.sceneLineId ?? null,
      trainingDummy: {
        phase: "idle",
        durationMs: 0,
        remainingMs: 0,
      },
      isPaused: false,
      bosses: [],
      entities: [],
    };
  }

  onMount(() => {
    void repairPersistedSettingsStores()
      .then(() => import("$lib/runtime-monitor-sync"))
      .then((module) => {
        runtimeMonitorSync = module;
      })
      .catch((error) => {
        console.error("[runtime-monitor] failed to load runtime sync module", error);
      });

    void setupShortcuts().catch((err) => {
      console.error("Failed to set up shortcuts", err);
    });

    // Set up navigation listener
    const appWebview = getCurrentWebviewWindow();
    appWebview.listen<string>("navigate", (event) => {
      const route = event.payload;
      goto(route);
    }).then((unlisten) => {
      navigateUnlisten = unlisten;
    }).catch((err) => {
      console.error("Failed to subscribe navigate event", err);
    });

    listen("game-overlay-visibility-toggle", async () => {
      try {
        await commands.toggleGameOverlayWindow();
      } catch (error) {
        console.error("[skill-monitor] failed to toggle overlay visibility", error);
      }
    }).then((unlisten) => {
      overlayToggleUnlisten = unlisten;
    }).catch((err) => {
      console.error("Failed to subscribe game-overlay-visibility-toggle event", err);
    });

    listen<{ visible: boolean }>("game-overlay-visibility-changed", (event) => {
      overlayVisibilityOverride = event.payload.visible;
      lastOverlayVisibleState = event.payload.visible;
    }).then((unlisten) => {
      overlayChangedUnlisten = unlisten;
    }).catch((err) => {
      console.error("Failed to subscribe game-overlay-visibility-changed event", err);
    });

    onDeathReplay((event) => {
      const nowMs = Date.now();
      latestDiscordDeathRecords = event.payload.records;
      if (latestDiscordLivePayload) {
        void updateDiscordPresenceFromLiveData(
          latestDiscordLivePayload,
          nowMs,
          latestDiscordDeathRecords,
        );
      }
    }).then((unlisten) => {
      discordDeathReplayUnlisten = unlisten;
    }).catch((err) => {
      console.error("Failed to subscribe death-replay event for Discord Rich Presence", err);
    });

    discordPresenceRefreshTimer = setInterval(() => {
      pollDiscordPresenceSnapshot(Date.now());
    }, DISCORD_PRESENCE_REFRESH_MS);
    pollDiscordPresenceSnapshot(Date.now());

    onSceneChange((event) => {
      const nowMs = Date.now();
      currentSceneId = event.payload.sceneId ?? null;
      const scenePayload = discordSceneOnlyPayload(event.payload);
      latestDiscordLivePayload = scenePayload;
      latestDiscordDeathRecords = [];
      void updateDiscordPresenceFromLiveData(scenePayload, nowMs, latestDiscordDeathRecords);
    }).then((unlisten) => {
      sceneChangeUnlisten = unlisten;
    }).catch((err) => {
      console.error("Failed to subscribe scene-change event", err);
    });

    listen<UpdateInfo>("update-available", (event) => {
      if (!isGlobalUpdateInfo(event.payload)) {
        console.warn("[updater] ignored unexpected update payload", event.payload.downloadUrl);
        return;
      }
      updateInfo = event.payload;
    }).then((unlisten) => {
      updateUnlisten = unlisten;
    }).catch((err) => {
      console.error("Failed to subscribe update-available event", err);
    });

    // Get app version and check changelog
    getVersion().then((v) => {
      currentVersion = v;
      // Compare persisted last-seen version with current app version
      if ((SETTINGS.appVersion.state as any).value !== v) {
        showChangelog = true;
      }
    }).catch((err) => {
      console.error('Failed to get app version', err);
    });

    // Cleanup on unmount
    return () => {
      if (runtimeSyncTimer) {
        clearTimeout(runtimeSyncTimer);
        runtimeSyncTimer = null;
      }
      if (navigateUnlisten) {
        navigateUnlisten();
        navigateUnlisten = null;
      }
      if (updateUnlisten) {
        updateUnlisten();
        updateUnlisten = null;
      }
      if (overlayToggleUnlisten) {
        overlayToggleUnlisten();
        overlayToggleUnlisten = null;
      }
      if (overlayChangedUnlisten) {
        overlayChangedUnlisten();
        overlayChangedUnlisten = null;
      }
      if (sceneChangeUnlisten) {
        sceneChangeUnlisten();
        sceneChangeUnlisten = null;
      }
      if (discordDeathReplayUnlisten) {
        discordDeathReplayUnlisten();
        discordDeathReplayUnlisten = null;
      }
      if (discordPresenceRefreshTimer) {
        clearInterval(discordPresenceRefreshTimer);
        discordPresenceRefreshTimer = null;
      }
    };
  });

  function handleClose() {
    // mark changelog as seen for this version
    try {
      (SETTINGS.appVersion.state as any).value = currentVersion;
    } catch (e) {
      console.error('Failed to set appVersion setting', e);
    }
    showChangelog = false;
  }

  function openChangelog() {
    showChangelog = true;
  }
</script>

<div class="relative isolate h-screen overflow-hidden text-foreground font-sans">
  <AppBackgroundLayer
    enabled={SETTINGS.accessibility.state.backgroundImageEnabled}
    image={SETTINGS.accessibility.state.backgroundImage}
    fallbackImage={SETTINGS.accessibility.state.backgroundImageSource}
    mode={SETTINGS.accessibility.state.backgroundImageMode || "cover"}
    containColor={SETTINGS.accessibility.state.backgroundImageContainColor || "rgba(0, 0, 0, 0)"}
    opacity={SETTINGS.accessibility.state.backgroundImageOpacity ?? 100}
    onRestored={(imagePath) => {
      SETTINGS.accessibility.state.backgroundImage = imagePath;
    }}
  />
  <div
    class="pointer-events-none absolute inset-0 z-10 {SETTINGS.accessibility.state.backgroundImageEnabled
      ? 'app-background-wash-main'
      : 'bg-background-main'}"
  ></div>

  <div class="relative z-20 flex h-full">
    <!-- Left Sidebar - Tool List -->
    <ToolSidebar onOpenChangelog={openChangelog} />

    <!-- Right Content Area -->
    <main class="flex-1 flex flex-col overflow-hidden">
      <div class="flex-1 overflow-y-auto p-6">
        {@render children()}
      </div>
    </main>
  </div>

  {#if showChangelog}
    <ChangelogModal onclose={handleClose} />
  {/if}

  {#if !showChangelog && updateInfo}
    <UpdateModal
      info={updateInfo}
      {currentVersion}
      onclose={() => {
        updateInfo = null;
      }}
    />
  {/if}
</div>

<style>
  .app-background-wash-main {
    background: color-mix(in srgb, var(--background-main) 72%, transparent);
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
