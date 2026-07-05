<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { Button } from "$lib/components/ui/button/index.js";
  import { commands, type EventLoggerSessionDirectoryPayload } from "$lib/bindings";
  import { syncDiscordPresenceConfig } from "$lib/discord-presence";
  import { setEventLoggerAlwaysOnTop, showEventLoggerWindow } from "$lib/event-logger-window";
  import { uiT } from "$lib/i18n";
  import { tooltip } from "$lib/utils.svelte";
  import CircleHelp from "virtual:icons/lucide/circle-help";
  import {
    loadProfileLibraryFromSettings,
    openProfileLibraryFolder,
    profileLibraryRuntime,
    saveActiveProfileToLibrary,
  } from "$lib/profile-library.svelte";
  import {
    notifySettingsChanged,
    persistProfileLibrarySettings,
    SETTINGS,
  } from "$lib/settings-store";
  import {
    activeProfileOrDefault,
    updateActiveProfile,
  } from "$lib/skill-monitor-profile.svelte";
  import SettingsSelect from "../../dps/settings/settings-select.svelte";
  import SettingsSwitch from "../../dps/settings/settings-switch.svelte";
  import ProfileSwitcher from "../../skill-monitor/profile-switcher.svelte";

  const tShell = uiT("shell", () => SETTINGS.live.general.state.language);
  const tCustom = uiT("custom-triggers/general", () => SETTINGS.live.general.state.language);

  let loadingLoggerSessionDir = $state(false);
  let loggerSessionDirectory = $state<EventLoggerSessionDirectoryPayload | null>(null);
  let restoreRoseOrbsMeme = $state(false);
  let discordPresenceSettingsTimer: ReturnType<typeof setTimeout> | null = null;
  const activeProfile = $derived.by(() => activeProfileOrDefault());

  function ensureLoggerSettingsShape() {
    SETTINGS.customTriggers.state.loggerCaptureEvents ??= true;
    SETTINGS.customTriggers.state.loggerCaptureSnapshots ??= true;
  }

  ensureLoggerSettingsShape();

  function scheduleDiscordPresenceSettingsSync() {
    if (discordPresenceSettingsTimer) clearTimeout(discordPresenceSettingsTimer);
    discordPresenceSettingsTimer = setTimeout(() => {
      discordPresenceSettingsTimer = null;
      notifySettingsChanged();
      void syncDiscordPresenceConfig();
    }, 75);
  }

  function discordPresenceRateLimitTooltip(): string {
    return tShell(
      "settings.discordPresence.rateLimitTooltip",
      "Discord rate-limits Rich Presence updates, so Resonance Logs sends meaningful changes at a paced interval instead of every DPS tick. Combat and death updates are limited to about every 5 seconds, idle updates are slower, and duplicate states are skipped so Discord is less likely to ignore bursts.",
    );
  }

  $effect(() => {
    SETTINGS.discordPresence.state.enabled;
    SETTINGS.discordPresence.state.showScene;
    SETTINGS.discordPresence.state.showLine;
    SETTINGS.discordPresence.state.showBoss;
    SETTINGS.discordPresence.state.showTimer;
    SETTINGS.discordPresence.state.showDps;
    SETTINGS.discordPresence.state.dpsMetric;
    SETTINGS.discordPresence.state.showDeaths;
    scheduleDiscordPresenceSettingsSync();
  });

  onMount(() => {
    void refreshEventLoggerSessionDirectory();
    void syncEventLoggerCaptureOptions();
  });


  async function syncEventLoggerCaptureOptions() {
    try {
      const result = await commands.setEventLoggerCaptureOptions(
        SETTINGS.customTriggers.state.loggerCaptureEvents,
        SETTINGS.customTriggers.state.loggerCaptureSnapshots,
      );
      if (result.status === "error") throw new Error(result.error);
    } catch (error) {
      console.error("Failed to sync event logger capture options", error);
    }
  }

  async function refreshEventLoggerSessionDirectory() {
    loadingLoggerSessionDir = true;
    try {
      const result = await commands.getEventLoggerSessionDirectory();
      if (result.status === "error") throw new Error(result.error);
      loggerSessionDirectory = result.data;
    } catch (error) {
      console.error("Failed to load event logger session directory", error);
      toast.error(`Failed to load logger session folder: ${error}`);
    } finally {
      loadingLoggerSessionDir = false;
    }
  }

  async function chooseEventLoggerSessionDirectory() {
    try {
      const defaultPath =
        loggerSessionDirectory?.configuredDirectory ?? loggerSessionDirectory?.resolvedDirectory;
      const selected = await open({
        directory: true,
        multiple: false,
        ...(defaultPath ? { defaultPath } : {}),
        title: tCustom("sessionLogs.chooseFolder", "Choose session log folder"),
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      const result = await commands.setEventLoggerSaveDirectory(selected);
      if (result.status === "error") throw new Error(result.error);
      loggerSessionDirectory = result.data;
      toast.success(tCustom("sessionLogs.folderUpdated", "Logger session folder updated."));
    } catch (error) {
      console.error("Failed to choose event logger session directory", error);
      toast.error(`Failed to update logger session folder: ${error}`);
    }
  }

  async function chooseProfileLibraryFolder() {
    try {
      const defaultPath = SETTINGS.profileLibrary.state.folder || undefined;
      const selected = await open({
        directory: true,
        multiple: false,
        ...(defaultPath ? { defaultPath } : {}),
        title: tShell("settings.profileLibrary.chooseFolder", "Choose profile library folder"),
      });

      if (!selected || Array.isArray(selected)) return;

      SETTINGS.profileLibrary.state.folder = selected;
      await persistProfileLibrarySettings();
      const loaded = await loadProfileLibraryFromSettings();
      if (loaded) {
        toast.success(tShell("settings.profileLibrary.loaded", "Profile library loaded."));
      } else {
        toast.warning(tShell("settings.profileLibrary.noProfiles", "No valid profiles were found in that folder."));
      }
    } catch (error) {
      console.error("Failed to choose profile library folder", error);
      toast.error(`Failed to update profile library folder: ${error}`);
    }
  }

  async function reloadProfileLibraryFolder() {
    try {
      const loaded = await loadProfileLibraryFromSettings();
      if (loaded) {
        toast.success(tShell("settings.profileLibrary.reloaded", "Profile library reloaded."));
      } else {
        toast.warning(tShell("settings.profileLibrary.noProfiles", "No valid profiles were found in that folder."));
      }
    } catch (error) {
      console.error("Failed to reload profile library", error);
      toast.error(`Failed to reload profile library: ${error}`);
    }
  }

  async function saveActiveProfileLibraryFile() {
    try {
      await saveActiveProfileToLibrary();
      toast.success(tShell("settings.profileLibrary.saved", "Active profile saved."));
    } catch (error) {
      console.error("Failed to save active profile", error);
      toast.error(`Failed to save active profile: ${error}`);
    }
  }

  async function openProfileLibraryFolderFromSettings() {
    try {
      await openProfileLibraryFolder();
    } catch (error) {
      console.error("Failed to open profile library folder", error);
      toast.error(`Failed to open profile library folder: ${error}`);
    }
  }

  async function resetProfileLibraryFolder() {
    SETTINGS.profileLibrary.state.folder = "";
    SETTINGS.profileLibrary.state.lastSelectedProfileId = "";
    SETTINGS.profileLibrary.state.lastSelectedProfileFile = "";
    SETTINGS.profileLibrary.state.profileFiles = {};
    await persistProfileLibrarySettings();
    profileLibraryRuntime.loadedCount = 0;
    profileLibraryRuntime.skippedFiles = [];
    profileLibraryRuntime.lastError = "";
    toast.success(tShell("settings.profileLibrary.reset", "Profile library reset to internal profiles."));
  }

  function setAutoHideWindowsOnGameBlur(enabled: boolean) {
    updateActiveProfile((profile) => ({
      ...profile,
      autoHideWindowsOnGameBlur: enabled,
    }));
  }

  function setHighlightDpsHealerSpecIcons(enabled: boolean) {
    updateActiveProfile((profile) => ({
      ...profile,
      highlightDpsHealerSpecIcons: enabled,
    }));
  }

  async function resetEventLoggerSessionDirectory() {
    try {
      const result = await commands.setEventLoggerSaveDirectory(null);
      if (result.status === "error") throw new Error(result.error);
      loggerSessionDirectory = result.data;
      toast.success(tCustom("sessionLogs.folderReset", "Logger session folder reset to default."));
    } catch (error) {
      console.error("Failed to reset event logger session directory", error);
      toast.error(`Failed to reset logger session folder: ${error}`);
    }
  }

  async function openEventLoggerSessionDirectory() {
    try {
      const result = await commands.openEventLoggerSessionDir();
      if (result.status === "error") throw new Error(result.error);
    } catch (error) {
      console.error("Failed to open event logger session directory", error);
      toast.error(`Failed to open logger session folder: ${error}`);
    }
  }
</script>

<div class="space-y-4">
  <div class="overflow-hidden rounded-lg border border-border/60 bg-card/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]">
    <div class="space-y-4 px-4 py-3">
      <div>
        <h2 class="text-base font-semibold text-foreground">{tShell("settings.profile", "Profile")}</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          {tShell(
            "settings.profile.subtitle",
            "Create and manage skill monitor profiles, and configure event logger behavior and session log storage.",
          )}
        </p>
      </div>

      <ProfileSwitcher />

      <SettingsSwitch
        checked={activeProfile.autoHideWindowsOnGameBlur === true}
        onchange={setAutoHideWindowsOnGameBlur}
        label={tShell("settings.profile.autoHideWindowsOnGameBlur", "Auto-hide live and overlays when game is inactive")}
        description={tShell(
          "settings.profile.autoHideWindowsOnGameBlurDescription",
          "When this profile is active, the live meter and visible overlay windows hide while another app has focus, then return when Blue Protocol: Star Resonance or Resonance Logs - Global is active again. This checks the OS foreground window only and does not read game memory.",
        )}
      />

      <SettingsSwitch
        checked={activeProfile.highlightDpsHealerSpecIcons === true}
        onchange={setHighlightDpsHealerSpecIcons}
        label={tShell("settings.profile.highlightDpsHealerSpecIcons", "Highlight DPS healer specs")}
        description={tShell(
          "settings.profile.highlightDpsHealerSpecIconsDescription",
          "Smite and Dissonance stay healer-green, with an optional red glow to mark their DPS-healer role in live and history rows.",
        )}
      />

      <label
        class="group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-popover/50"
        title={tShell(
          "settings.profile.restore8165RoseOrbsTooltip",
          "Added option to restore 8165 orbs for players affected by scam. This option doesn't do anything. It's just here for the vibes. #NeverForget",
        )}
      >
        <div class="relative flex shrink-0 items-center justify-center">
          <input
            type="checkbox"
            bind:checked={restoreRoseOrbsMeme}
            class="peer h-5 w-5 cursor-pointer appearance-none rounded border-2 border-border bg-popover transition-all checked:border-primary checked:bg-primary hover:border-border/80 checked:hover:border-primary/80 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-0"
          />
          <svg
            class="pointer-events-none absolute h-3.5 w-3.5 text-white opacity-0 transition-opacity peer-checked:opacity-100"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-foreground transition-colors group-hover:text-foreground">
            {tShell("settings.profile.restore8165RoseOrbs", "Restore 8165 Rose Orbs")}
          </div>
        </div>
      </label>

      <div class="space-y-3 rounded-lg border border-border/60 bg-background/40 p-4 text-sm">
        <div>
          <div class="flex items-center gap-2">
            <div class="font-medium">
              {tShell("settings.discordPresence.title", "Discord Rich Presence")}
            </div>
            <button
              type="button"
              class="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={discordPresenceRateLimitTooltip()}
              {@attach tooltip(discordPresenceRateLimitTooltip)}
            >
              <CircleHelp class="h-4 w-4" />
            </button>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            {tShell(
              "settings.discordPresence.description",
              "Publish your current scene, boss, true DPS timer, personal DPS, and deaths to Discord when Discord is running.",
            )}
          </p>
        </div>

        <SettingsSwitch
          bind:checked={SETTINGS.discordPresence.state.enabled}
          label={tShell("settings.discordPresence.enabled", "Enable Discord Rich Presence")}
          description={tShell(
            "settings.discordPresence.enabledDescription",
            "Shows Resonance Logs activity in Discord while Discord is running. Presence is cleared when this is disabled.",
          )}
        />

        <div class="grid gap-2 md:grid-cols-2">
          <SettingsSwitch
            bind:checked={SETTINGS.discordPresence.state.showScene}
            label={tShell("settings.discordPresence.showScene", "Show scene")}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.discordPresence.state.showLine}
            label={tShell("settings.discordPresence.showLine", "Show line")}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.discordPresence.state.showBoss}
            label={tShell("settings.discordPresence.showBoss", "Show boss")}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.discordPresence.state.showTimer}
            label={tShell("settings.discordPresence.showTimer", "Show timer")}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.discordPresence.state.showDps}
            label={tShell("settings.discordPresence.showDps", "Show DPS")}
          />
          {#if SETTINGS.discordPresence.state.showDps}
            <SettingsSelect
              bind:selected={SETTINGS.discordPresence.state.dpsMetric}
              label={tShell("settings.discordPresence.dpsMetric", "DPS metric")}
              description={tShell(
                "settings.discordPresence.dpsMetricDescription",
                "Choose whether Discord shows your DPS or true DPS.",
              )}
              values={[
                { label: "DPS", value: "dps" },
                { label: "T.DPS", value: "tdps" },
              ]}
            />
          {/if}
          <SettingsSwitch
            bind:checked={SETTINGS.discordPresence.state.showDeaths}
            label={tShell("settings.discordPresence.showDeaths", "Show deaths")}
          />
        </div>
      </div>

      <div class="space-y-3 rounded-lg border border-border/60 bg-background/40 p-4 text-sm">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-1">
            <div class="font-medium">{tShell("settings.profileLibrary.title", "Profile library folder")}</div>
            <p class="text-xs text-muted-foreground">
              {tShell(
                "settings.profileLibrary.description",
                "Load profile JSON files from a folder. Missing fields are added from the current defaults, and the last selected profile is remembered outside the JSON files.",
              )}
            </p>
          </div>

          <div class="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onclick={() => void chooseProfileLibraryFolder()}>
              {tShell("settings.profileLibrary.chooseFolder", "Choose Folder")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!SETTINGS.profileLibrary.state.folder || profileLibraryRuntime.loading}
              onclick={() => void reloadProfileLibraryFolder()}
            >
              {profileLibraryRuntime.loading
                ? tShell("settings.profileLibrary.loading", "Loading...")
                : tShell("settings.profileLibrary.reload", "Reload")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!SETTINGS.profileLibrary.state.folder}
              onclick={() => void saveActiveProfileLibraryFile()}
            >
              {tShell("settings.profileLibrary.saveActive", "Save Active")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!SETTINGS.profileLibrary.state.folder}
              onclick={() => void openProfileLibraryFolderFromSettings()}
            >
              {tShell("settings.profileLibrary.openFolder", "Open Folder")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!SETTINGS.profileLibrary.state.folder}
              onclick={resetProfileLibraryFolder}
            >
              {tShell("settings.profileLibrary.useInternal", "Use Internal")}
            </Button>
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-2">
          <div class="space-y-1">
            <div class="text-xs uppercase tracking-wide text-muted-foreground">
              {tShell("settings.profileLibrary.currentFolder", "Current folder")}
            </div>
            <div class="break-all rounded-md border border-border/60 bg-background px-3 py-2 font-mono text-xs">
              {SETTINGS.profileLibrary.state.folder || tShell("settings.profileLibrary.internalProfiles", "Internal profiles")}
            </div>
          </div>

          <div class="space-y-1">
            <div class="text-xs uppercase tracking-wide text-muted-foreground">
              {tShell("settings.profileLibrary.loadedProfiles", "Loaded profiles")}
            </div>
            <div class="rounded-md border border-border/60 bg-background px-3 py-2 font-mono text-xs">
              {profileLibraryRuntime.loadedCount}
              {#if SETTINGS.profileLibrary.state.lastSelectedProfileFile}
                <span class="text-muted-foreground">
                  · {SETTINGS.profileLibrary.state.lastSelectedProfileFile}
                </span>
              {/if}
            </div>
          </div>
        </div>

        {#if profileLibraryRuntime.lastError}
          <p class="text-xs text-destructive">{profileLibraryRuntime.lastError}</p>
        {/if}

        {#if profileLibraryRuntime.skippedFiles.length > 0}
          <div class="space-y-1 text-xs text-muted-foreground">
            <div class="font-medium text-foreground">
              {tShell("settings.profileLibrary.skippedFiles", "Skipped files")}
            </div>
            {#each profileLibraryRuntime.skippedFiles as skipped}
              <div class="break-all">{skipped.fileName}: {skipped.reason}</div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div class="overflow-hidden rounded-lg border border-border/60 bg-card/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]">
    <div class="space-y-4 px-4 py-3">
      <div>
        <h2 class="text-base font-semibold text-foreground">
          {tShell("settings.appBehavior", "Application Behavior")}
        </h2>
        <p class="mt-1 text-sm text-muted-foreground">
          {tShell(
            "settings.appBehavior.subtitle",
            "Control process-wide app behavior that is not tied to a single overlay or meter view.",
          )}
        </p>
      </div>

      <SettingsSwitch
        bind:checked={SETTINGS.appBehavior.state.hideMainWindowToTray}
        label={tShell("settings.hideMainWindowToTray", "Hide main window to tray")}
        description={tShell(
          "settings.hideMainWindowToTrayDescription",
          "When enabled, closing the main window hides it instead of exiting. Use the tray icon to restore it or Quit to fully exit.",
        )}
      />
    </div>
  </div>

  <div class="overflow-hidden rounded-lg border border-border/60 bg-card/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]">
    <div class="space-y-4 px-4 py-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-foreground">{tCustom("loggerSettings", "Logger Settings")}</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {tCustom(
              "openLoggerHint",
              "The logger stays closed by default and only captures lightweight event batches while it is visible.",
            )}
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onclick={() => void refreshEventLoggerSessionDirectory()}>
            {loadingLoggerSessionDir ? tCustom("sessionLogs.loading", "Loading…") : tCustom("reload", "Reload")}
          </Button>
          <Button size="sm" onclick={() => void showEventLoggerWindow()}>
            {tCustom("openLogger", "Open Event Logger")}
          </Button>
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            bind:checked={SETTINGS.customTriggers.state.loggerAlwaysOnTop}
            onchange={(event) =>
              void setEventLoggerAlwaysOnTop((event.currentTarget as HTMLInputElement).checked)}
          />
          {tCustom("alwaysOnTop", "Always on top")}
        </label>

        <label class="space-y-1 text-sm">
          <span>{tCustom("bufferSize", "Buffer size")}</span>
          <input
            type="number"
            min="100"
            max="5000"
            class="w-full rounded-md border border-border bg-background px-3 py-2"
            bind:value={SETTINGS.customTriggers.state.loggerBufferSize}
          />
        </label>

        <div class="space-y-1 text-sm">
          <span>{tCustom("displayMode", "Display mode")}</span>
          <div class="flex flex-wrap gap-2">
            <Button
              variant={SETTINGS.customTriggers.state.loggerDisplayMode === "name" ? "default" : "outline"}
              size="sm"
              onclick={() => (SETTINGS.customTriggers.state.loggerDisplayMode = "name")}
            >
              {tCustom("displayMode.name", "Name")}
            </Button>
            <Button
              variant={SETTINGS.customTriggers.state.loggerDisplayMode === "name_uid" ? "default" : "outline"}
              size="sm"
              onclick={() => (SETTINGS.customTriggers.state.loggerDisplayMode = "name_uid")}
            >
              {tCustom("displayMode.nameUid", "Name + UID")}
            </Button>
            <Button
              variant={SETTINGS.customTriggers.state.loggerDisplayMode === "uid" ? "default" : "outline"}
              size="sm"
              onclick={() => (SETTINGS.customTriggers.state.loggerDisplayMode = "uid")}
            >
              {tCustom("displayMode.uid", "UID")}
            </Button>
          </div>
        </div>
        <div class="space-y-2 rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
          <div class="font-medium">{tCustom("eventCapture", "Event Capture")}</div>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={SETTINGS.customTriggers.state.loggerCaptureEvents}
              onchange={(event) => {
                SETTINGS.customTriggers.state.loggerCaptureEvents = (event.currentTarget as HTMLInputElement).checked;
                void syncEventLoggerCaptureOptions();
              }}
            />
            <span>{tCustom("eventCapture.events", "Events")}</span>
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={SETTINGS.customTriggers.state.loggerCaptureSnapshots}
              onchange={(event) => {
                SETTINGS.customTriggers.state.loggerCaptureSnapshots = (event.currentTarget as HTMLInputElement).checked;
                void syncEventLoggerCaptureOptions();
              }}
            />
            <span>{tCustom("eventCapture.snapshots", "Snapshots")}</span>
          </label>
        </div>
      </div>

      <div class="space-y-3 rounded-lg border border-border/60 bg-background/40 p-4 text-sm">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-1">
            <div class="font-medium">{tCustom("sessionLogs.title", "Session log folder")}</div>
            <p class="text-xs text-muted-foreground">
              {tCustom(
                "sessionLogs.description",
                "Each reset or scene/session rollover saves the current logger session as a separate JSON file so one giant log file never builds up.",
              )}
            </p>
          </div>

          <div class="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onclick={() => void chooseEventLoggerSessionDirectory()}>
              {tCustom("sessionLogs.chooseFolder", "Choose Folder")}
            </Button>
            <Button size="sm" variant="outline" onclick={() => void openEventLoggerSessionDirectory()}>
              {tCustom("sessionLogs.openFolder", "Open Folder")}
            </Button>
            <Button size="sm" variant="ghost" onclick={() => void resetEventLoggerSessionDirectory()}>
              {tCustom("sessionLogs.useDefault", "Use Default")}
            </Button>
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-2">
          <div class="space-y-1">
            <div class="text-xs uppercase tracking-wide text-muted-foreground">
              {tCustom("sessionLogs.currentFolder", "Current folder")}
            </div>
            <div class="break-all rounded-md border border-border/60 bg-background px-3 py-2 font-mono text-xs">
              {#if loggerSessionDirectory}
                {loggerSessionDirectory.resolvedDirectory}
              {:else if loadingLoggerSessionDir}
                {tCustom("sessionLogs.loading", "Loading…")}
              {:else}
                {tCustom("sessionLogs.unavailable", "Unavailable")}
              {/if}
            </div>
          </div>

          <div class="space-y-1">
            <div class="text-xs uppercase tracking-wide text-muted-foreground">
              {tCustom("sessionLogs.filePattern", "File pattern")}
            </div>
            <div class="rounded-md border border-border/60 bg-background px-3 py-2 font-mono text-xs">
              &lt;characterName&gt;.&lt;characterUid&gt;.&lt;sceneName&gt;.&lt;DDMMYYYY-HHMMSS&gt;.json
            </div>
          </div>
        </div>

        <p class="text-xs text-muted-foreground">
          {#if loggerSessionDirectory?.usingDefault}
            {tCustom("sessionLogs.defaultNotice", "Using the default app log folder for event logger sessions.")}
          {:else}
            {tCustom("sessionLogs.customNotice", "Using your custom folder for event logger sessions.")}
          {/if}
        </p>
      </div>
    </div>
  </div>
</div>
