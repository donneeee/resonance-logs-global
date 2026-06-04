<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { Button } from "$lib/components/ui/button/index.js";
  import { setEventLoggerAlwaysOnTop, showEventLoggerWindow } from "$lib/event-logger-window";
  import { uiT } from "$lib/i18n";
  import {
    loadProfileLibraryFromSettings,
    openProfileLibraryFolder,
    profileLibraryRuntime,
    saveActiveProfileToLibrary,
  } from "$lib/profile-library.svelte";
  import { SETTINGS } from "$lib/settings-store";
  import SettingsSwitch from "../../dps/settings/settings-switch.svelte";
  import ProfileSwitcher from "../../skill-monitor/profile-switcher.svelte";

  type EventLoggerSessionDirectoryPayload = {
    configuredDirectory: string | null;
    resolvedDirectory: string;
    usingDefault: boolean;
  };

  const tShell = uiT("shell", () => SETTINGS.live.general.state.language);
  const tCustom = uiT("custom-triggers/general", () => SETTINGS.live.general.state.language);

  let loadingLoggerSessionDir = $state(false);
  let loggerSessionDirectory = $state<EventLoggerSessionDirectoryPayload | null>(null);

  function ensureLoggerSettingsShape() {
    SETTINGS.customTriggers.state.loggerCaptureEvents ??= true;
    SETTINGS.customTriggers.state.loggerCaptureSnapshots ??= true;
  }

  ensureLoggerSettingsShape();

  onMount(() => {
    void refreshEventLoggerSessionDirectory();
    void syncEventLoggerCaptureOptions();
  });


  async function syncEventLoggerCaptureOptions() {
    try {
      await invoke("set_event_logger_capture_options", {
        captureEvents: SETTINGS.customTriggers.state.loggerCaptureEvents,
        captureSnapshots: SETTINGS.customTriggers.state.loggerCaptureSnapshots,
      });
    } catch (error) {
      console.error("Failed to sync event logger capture options", error);
    }
  }

  async function refreshEventLoggerSessionDirectory() {
    loadingLoggerSessionDir = true;
    try {
      loggerSessionDirectory = await invoke<EventLoggerSessionDirectoryPayload>("get_event_logger_session_directory");
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

      loggerSessionDirectory = await invoke<EventLoggerSessionDirectoryPayload>(
        "set_event_logger_save_directory",
        { directory: selected },
      );
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

  function resetProfileLibraryFolder() {
    SETTINGS.profileLibrary.state.folder = "";
    SETTINGS.profileLibrary.state.lastSelectedProfileId = "";
    SETTINGS.profileLibrary.state.lastSelectedProfileFile = "";
    SETTINGS.profileLibrary.state.profileFiles = {};
    profileLibraryRuntime.loadedCount = 0;
    profileLibraryRuntime.skippedFiles = [];
    profileLibraryRuntime.lastError = "";
    toast.success(tShell("settings.profileLibrary.reset", "Profile library reset to internal profiles."));
  }

  async function resetEventLoggerSessionDirectory() {
    try {
      loggerSessionDirectory = await invoke<EventLoggerSessionDirectoryPayload>(
        "set_event_logger_save_directory",
        { directory: null },
      );
      toast.success(tCustom("sessionLogs.folderReset", "Logger session folder reset to default."));
    } catch (error) {
      console.error("Failed to reset event logger session directory", error);
      toast.error(`Failed to reset logger session folder: ${error}`);
    }
  }

  async function openEventLoggerSessionDirectory() {
    try {
      await invoke("open_event_logger_session_dir");
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
