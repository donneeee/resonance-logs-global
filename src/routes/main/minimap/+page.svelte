<script lang="ts">
  import { onMount } from "svelte";
  import { commands } from "$lib/bindings";
  import type { LiveDataPayload } from "$lib/api";
  import {
    createDefaultMinimapConfig,
    notifySettingsChanged,
    SETTINGS,
    type MinimapPlayerWhitelistEntry,
  } from "$lib/settings-store";
  import { t } from "$lib/i18n/index.svelte";
  import SettingsColor from "../dps/settings/settings-color.svelte";
  import SettingsSelect from "../dps/settings/settings-select.svelte";
  import SettingsSlider from "../dps/settings/settings-slider.svelte";
  import SettingsSwitch from "../dps/settings/settings-switch.svelte";

  const defaultMinimapConfig = createDefaultMinimapConfig();
  const DEFAULT_WHITELIST_COLOR = "#facc15";
  const QUICK_ADD_POLL_MS = 2500;

  type DiscordPresenceLiveSnapshot = {
    liveData?: LiveDataPayload | null;
  };

  type ObservedMinimapPlayer = {
    uid: string;
    name: string;
    isLocal: boolean;
  };

  type LegacyMinimapConfig = typeof defaultMinimapConfig & {
    autoHideInDailyScenes?: boolean;
    showBoss?: boolean;
    showMarkers?: boolean;
    mapOrientation?: typeof defaultMinimapConfig.mapOrientation;
    mapRefreshRateMs?: number;
    alwaysShowPlayers?: boolean;
    playerWhitelist?: MinimapPlayerWhitelistEntry[];
    highlightSelfMechanics?: boolean;
    selfMechanicColor?: string;
    entityColors?: Partial<typeof defaultMinimapConfig.entityColors>;
    markerColors?: Partial<typeof defaultMinimapConfig.markerColors>;
    localRing?: Partial<typeof defaultMinimapConfig.localRing>;
    localFacing?: Partial<typeof defaultMinimapConfig.localFacing>;
  };

  function ensureMinimapSettingsDefaults() {
    const state = SETTINGS.minimap.state as LegacyMinimapConfig;
    state.autoHideInDailyScenes ??= defaultMinimapConfig.autoHideInDailyScenes;
    state.showBoss ??= defaultMinimapConfig.showBoss;
    state.showMarkers ??= defaultMinimapConfig.showMarkers;
    state.mapOrientation ??= defaultMinimapConfig.mapOrientation;
    state.mapRefreshRateMs ??= defaultMinimapConfig.mapRefreshRateMs;
    state.alwaysShowPlayers ??= defaultMinimapConfig.alwaysShowPlayers;
    state.playerWhitelist ??= [...defaultMinimapConfig.playerWhitelist];
    state.highlightSelfMechanics ??=
      defaultMinimapConfig.highlightSelfMechanics;
    state.selfMechanicColor ??= defaultMinimapConfig.selfMechanicColor;
    state.entityColors ??= { ...defaultMinimapConfig.entityColors };
    state.entityColors.boss ??= defaultMinimapConfig.entityColors.boss;
    state.markerColors ??= { ...defaultMinimapConfig.markerColors };
    state.markerColors.m1 ??= defaultMinimapConfig.markerColors.m1;
    state.markerColors.m2 ??= defaultMinimapConfig.markerColors.m2;
    state.markerColors.m3 ??= defaultMinimapConfig.markerColors.m3;
    state.markerColors.m4 ??= defaultMinimapConfig.markerColors.m4;
    state.markerColors.m5 ??= defaultMinimapConfig.markerColors.m5;
    state.markerColors.m6 ??= defaultMinimapConfig.markerColors.m6;
    state.localRing ??= { ...defaultMinimapConfig.localRing };
    state.localRing.enabled ??= defaultMinimapConfig.localRing.enabled;
    state.localRing.color ??= defaultMinimapConfig.localRing.color;
    state.localRing.width ??= defaultMinimapConfig.localRing.width;
    state.localFacing ??= { ...defaultMinimapConfig.localFacing };
    state.localFacing.enabled ??= defaultMinimapConfig.localFacing.enabled;
  }

  ensureMinimapSettingsDefaults();

  const minimapSettings = $derived(SETTINGS.minimap.state);
  let manualPlayerUid = $state("");
  let manualPlayerName = $state("");
  let manualPlayerColor = $state(DEFAULT_WHITELIST_COLOR);
  let observedPlayers = $state<ObservedMinimapPlayer[]>([]);
  let observedPlayersError = $state("");

  const whitelistedUids = $derived.by(() => {
    return new Set(
      (minimapSettings.playerWhitelist ?? [])
        .map((entry) => entry.uid.trim())
        .filter(Boolean),
    );
  });

  const quickAddPlayers = $derived.by(() => {
    return observedPlayers.filter((player) => !whitelistedUids.has(player.uid));
  });

  $effect(() => {
    void minimapSettings.showBoss;
    void minimapSettings.showMarkers;
    void minimapSettings.autoHideInDailyScenes;
    void minimapSettings.mapOrientation;
    void minimapSettings.mapRefreshRateMs;
    void minimapSettings.alwaysShowPlayers;
    void minimapSettings.playerWhitelist;
    void minimapSettings.highlightSelfMechanics;
    void minimapSettings.selfMechanicColor;
    void minimapSettings.entityColors;
    void minimapSettings.markerColors;
    void minimapSettings.localRing;
    void minimapSettings.localFacing;
    ensureMinimapSettingsDefaults();
  });

  function visibilityState(value: boolean): string {
    return value
      ? t("minimap.overlay.state.show")
      : t("minimap.overlay.state.hide");
  }

  function normalizedPlayerUid(value: string): string {
    return value.trim();
  }

  function liveEntityUid(entity: LiveDataPayload["entities"][number]): string {
    return (
      entity.entityUuid?.trim() ||
      entity.entityKey?.trim() ||
      (entity.uuid !== null && entity.uuid !== undefined ? String(entity.uuid) : "") ||
      (Number.isFinite(entity.uid) && entity.uid > 0 ? String(entity.uid) : "")
    );
  }

  function liveEntityName(entity: LiveDataPayload["entities"][number]): string {
    const name = entity.name?.trim();
    if (name) return name;
    const uid = liveEntityUid(entity);
    return uid ? `#${uid}` : t("minimap.settings.playerWhitelist.unknownPlayer");
  }

  function replacePlayerWhitelist(entries: MinimapPlayerWhitelistEntry[]) {
    minimapSettings.playerWhitelist = entries;
    notifySettingsChanged();
  }

  function upsertPlayerWhitelistEntry(
    uid: string,
    name: string,
    color = manualPlayerColor,
  ) {
    const nextUid = normalizedPlayerUid(uid);
    if (!nextUid) return;

    const nextName = name.trim();
    const entry: MinimapPlayerWhitelistEntry = {
      uid: nextUid,
      name: nextName,
      color,
      enabled: true,
    };

    const existing = minimapSettings.playerWhitelist ?? [];
    if (existing.some((item) => item.uid === nextUid)) {
      replacePlayerWhitelist(
        existing.map((item) =>
          item.uid === nextUid
            ? { ...item, name: nextName || item.name, color, enabled: true }
            : item,
        ),
      );
    } else {
      replacePlayerWhitelist([...existing, entry]);
    }
  }

  function addManualPlayer() {
    const uid = normalizedPlayerUid(manualPlayerUid);
    if (!uid) return;
    upsertPlayerWhitelistEntry(uid, manualPlayerName, manualPlayerColor);
    manualPlayerUid = "";
    manualPlayerName = "";
  }

  function updateWhitelistEntry(
    uid: string,
    patch: Partial<MinimapPlayerWhitelistEntry>,
  ) {
    replacePlayerWhitelist(
      (minimapSettings.playerWhitelist ?? []).map((entry) =>
        entry.uid === uid ? { ...entry, ...patch } : entry,
      ),
    );
  }

  function updateWhitelistUid(previousUid: string, nextRawUid: string) {
    const nextUid = normalizedPlayerUid(nextRawUid);
    if (!nextUid || nextUid === previousUid) return;

    const entries = minimapSettings.playerWhitelist ?? [];
    const current = entries.find((entry) => entry.uid === previousUid);
    if (!current) return;

    const withoutCurrent = entries.filter((entry) => entry.uid !== previousUid);
    const duplicate = withoutCurrent.find((entry) => entry.uid === nextUid);
    if (duplicate) {
      replacePlayerWhitelist(
        withoutCurrent.map((entry) =>
          entry.uid === nextUid
            ? {
                ...entry,
                name: current.name || entry.name,
                color: current.color || entry.color,
                enabled: current.enabled,
              }
            : entry,
        ),
      );
      return;
    }

    replacePlayerWhitelist(
      entries.map((entry) =>
        entry.uid === previousUid ? { ...entry, uid: nextUid } : entry,
      ),
    );
  }

  function removeWhitelistEntry(uid: string) {
    replacePlayerWhitelist(
      (minimapSettings.playerWhitelist ?? []).filter((entry) => entry.uid !== uid),
    );
  }

  function applyObservedPlayers(payload: LiveDataPayload | null | undefined) {
    if (!payload) return;

    const localUid =
      payload.localPlayerUuid?.trim() ||
      payload.localPlayerKey?.trim() ||
      (payload.localPlayerUid > 0 ? String(payload.localPlayerUid) : "");
    const next = new Map<string, ObservedMinimapPlayer>();
    for (const entity of payload.entities) {
      const uid = liveEntityUid(entity);
      if (!uid) continue;
      next.set(uid, {
        uid,
        name: liveEntityName(entity),
        isLocal: uid === localUid,
      });
    }
    observedPlayers = Array.from(next.values()).sort(
      (a, b) => Number(b.isLocal) - Number(a.isLocal) || a.name.localeCompare(b.name),
    );
  }

  async function refreshObservedPlayers() {
    try {
      const result = await commands.getDiscordPresenceLiveSnapshot();
      if (result.status === "error") {
        observedPlayersError = String(result.error);
        return;
      }
      const snapshot = JSON.parse(result.data) as DiscordPresenceLiveSnapshot;
      applyObservedPlayers(snapshot.liveData);
      observedPlayersError = "";
    } catch (error) {
      observedPlayersError = error instanceof Error ? error.message : String(error);
    }
  }

  onMount(() => {
    let stopped = false;
    const refresh = () => {
      if (!stopped) void refreshObservedPlayers();
    };
    refresh();
    const timer = window.setInterval(refresh, QUICK_ADD_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  });
</script>

<div class="space-y-6">
  <section
    class="border-border/60 bg-card/40 space-y-3 rounded-lg border p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
  >
    <div>
      <h2 class="text-foreground text-base font-semibold">
        {t("minimap.supported.title")}
      </h2>
      <p class="text-muted-foreground text-xs">
        {t("minimap.supported.description")}
      </p>
    </div>

    <div class="grid gap-2 md:grid-cols-3">
      <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
        <div class="text-sm font-medium text-foreground">
          {t("minimap.supported.s3Raid")}
        </div>
        <div class="mt-0.5 text-xs text-muted-foreground">13021 / 13022 / 13023</div>
      </div>
      <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
        <div class="text-sm font-medium text-foreground">
          {t("minimap.supported.s3SeaRingedReef")}
        </div>
        <div class="mt-0.5 text-xs text-muted-foreground">6563 / 6564 / 6565</div>
      </div>
      <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
        <div class="text-sm font-medium text-foreground">
          {t("minimap.supported.s3CursedTomb")}
        </div>
        <div class="mt-0.5 text-xs text-muted-foreground">6513 / 6514 / 6515</div>
      </div>
      <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
        <div class="text-sm font-medium text-foreground">
          {t("minimap.supported.s3GiantTower")}
        </div>
        <div class="mt-0.5 text-xs text-muted-foreground">6613 / 6614 / 6615</div>
      </div>
      <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
        <div class="text-sm font-medium text-foreground">
          {t("minimap.supported.s3TinaMindrealm")}
        </div>
        <div class="mt-0.5 text-xs text-muted-foreground">1631 / 1632 / 1633</div>
      </div>
    </div>
  </section>

    <section
      class="border-border/60 bg-card/40 space-y-4 rounded-lg border p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
    >
      <div>
        <h2 class="text-foreground text-base font-semibold">
          {t("minimap.settings.display.title")}
        </h2>
        <p class="text-muted-foreground text-xs">
          {t("minimap.settings.display.description")}
        </p>
      </div>

      <SettingsSwitch
        bind:checked={minimapSettings.autoHideInDailyScenes}
        label={t("minimap.settings.autoHideInDailyScenes.label")}
        description={t("minimap.settings.autoHideInDailyScenes.description")}
      />

      <SettingsSwitch
        bind:checked={minimapSettings.hideNormalTeammates}
        label={t("minimap.settings.hideNormalTeammates.label")}
        description={t("minimap.settings.hideNormalTeammates.description")}
      />

      {#if minimapSettings.showBoss !== undefined}
        <SettingsSwitch
          bind:checked={minimapSettings.showBoss}
          label={t("minimap.settings.showBoss.label")}
          description={t("minimap.settings.showBoss.description")}
        />
      {/if}

      <SettingsSwitch
        bind:checked={minimapSettings.highlightSelfMechanics}
        label={t("minimap.settings.highlightSelfMechanics.label")}
        description={t("minimap.settings.highlightSelfMechanics.description")}
      />

      <SettingsColor
        bind:value={minimapSettings.selfMechanicColor}
        label={t("minimap.settings.selfMechanicColor.label")}
        description={t("minimap.settings.selfMechanicColor.description")}
      />

      <SettingsSelect
        bind:selected={minimapSettings.mapOrientation}
        label={t("minimap.settings.mapOrientation.label")}
        description={t("minimap.settings.mapOrientation.description")}
        values={[
          {
            label: t("minimap.settings.mapOrientation.northUp"),
            value: "north-up",
          },
          {
            label: t("minimap.settings.mapOrientation.playerFacing"),
            value: "player-facing",
          },
        ]}
      />

      <SettingsSlider
        bind:value={minimapSettings.mapRefreshRateMs}
        label={t("minimap.settings.mapRefreshRate.label")}
        description={t("minimap.settings.mapRefreshRate.description")}
        min={50}
        max={2000}
        step={50}
        unit="ms"
      />
    </section>

    <section
      class="border-border/60 bg-card/40 space-y-4 rounded-lg border p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
    >
      <div>
        <h2 class="text-foreground text-base font-semibold">
          {t("minimap.settings.playerVisibility.title")}
        </h2>
        <p class="text-muted-foreground text-xs">
          {t("minimap.settings.playerVisibility.description")}
        </p>
      </div>

      <SettingsSwitch
        bind:checked={minimapSettings.alwaysShowPlayers}
        label={t("minimap.settings.alwaysShowPlayers.label")}
        description={t("minimap.settings.alwaysShowPlayers.description")}
      />

      <div class="space-y-3 rounded-md border border-border/50 bg-muted/20 p-3">
        <div class="grid gap-2 lg:grid-cols-[1.3fr_1fr_auto_auto]">
          <label class="space-y-1 text-xs text-muted-foreground">
            <span>{t("minimap.settings.playerWhitelist.uid")}</span>
            <input
              bind:value={manualPlayerUid}
              class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              placeholder={t("minimap.settings.playerWhitelist.uidPlaceholder")}
            />
          </label>
          <label class="space-y-1 text-xs text-muted-foreground">
            <span>{t("minimap.settings.playerWhitelist.name")}</span>
            <input
              bind:value={manualPlayerName}
              class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              placeholder={t("minimap.settings.playerWhitelist.namePlaceholder")}
            />
          </label>
          <label class="space-y-1 text-xs text-muted-foreground">
            <span>{t("minimap.settings.playerWhitelist.color")}</span>
            <input
              type="color"
              bind:value={manualPlayerColor}
              class="h-10 w-12 rounded-md border border-border/50 bg-transparent"
            />
          </label>
          <button
            type="button"
            class="self-end rounded-md border border-primary bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!normalizedPlayerUid(manualPlayerUid)}
            onclick={addManualPlayer}
          >
            {t("minimap.settings.playerWhitelist.add")}
          </button>
        </div>
      </div>

      <div class="space-y-2">
        <div class="text-sm font-medium text-foreground">
          {t("minimap.settings.playerWhitelist.quickAdd")}
        </div>
        {#if observedPlayersError}
          <p class="text-xs text-muted-foreground">
            {t("minimap.settings.playerWhitelist.quickAddError")}
          </p>
        {:else if quickAddPlayers.length === 0}
          <p class="text-xs text-muted-foreground">
            {t("minimap.settings.playerWhitelist.quickAddEmpty")}
          </p>
        {:else}
          <div class="flex flex-wrap gap-2">
            {#each quickAddPlayers.slice(0, 16) as player (player.uid)}
              <button
                type="button"
                class="rounded-md border border-border/60 bg-popover/50 px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-popover/80"
                onclick={() =>
                  upsertPlayerWhitelistEntry(
                    player.uid,
                    player.name,
                    manualPlayerColor,
                  )}
              >
                <span class="font-medium">{player.name}</span>
                <span class="ml-2 font-mono text-muted-foreground">{player.uid}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="space-y-2">
        <div class="text-sm font-medium text-foreground">
          {t("minimap.settings.playerWhitelist.title")}
        </div>
        {#if (minimapSettings.playerWhitelist ?? []).length === 0}
          <p class="text-xs text-muted-foreground">
            {t("minimap.settings.playerWhitelist.empty")}
          </p>
        {:else}
          <div class="space-y-2">
            {#each minimapSettings.playerWhitelist ?? [] as entry (entry.uid)}
              <div
                class="grid gap-2 rounded-md border border-border/50 bg-muted/20 p-3 lg:grid-cols-[auto_1.1fr_1fr_auto_auto]"
              >
                <label class="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={entry.enabled !== false}
                    onchange={(event) =>
                      updateWhitelistEntry(entry.uid, {
                        enabled: (event.currentTarget as HTMLInputElement).checked,
                      })}
                    class="h-4 w-4"
                  />
                  <span>{t("minimap.overlay.state.show")}</span>
                </label>
                <label class="space-y-1 text-xs text-muted-foreground">
                  <span>{t("minimap.settings.playerWhitelist.name")}</span>
                  <input
                    value={entry.name}
                    class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                    onchange={(event) =>
                      updateWhitelistEntry(entry.uid, {
                        name: (event.currentTarget as HTMLInputElement).value.trim(),
                      })}
                  />
                </label>
                <label class="space-y-1 text-xs text-muted-foreground">
                  <span>{t("minimap.settings.playerWhitelist.uid")}</span>
                  <input
                    value={entry.uid}
                    class="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
                    onchange={(event) =>
                      updateWhitelistUid(
                        entry.uid,
                        (event.currentTarget as HTMLInputElement).value,
                      )}
                  />
                </label>
                <label class="space-y-1 text-xs text-muted-foreground">
                  <span>{t("minimap.settings.playerWhitelist.color")}</span>
                  <input
                    type="color"
                    value={entry.color}
                    class="h-10 w-12 rounded-md border border-border/50 bg-transparent"
                    oninput={(event) =>
                      updateWhitelistEntry(entry.uid, {
                        color: (event.currentTarget as HTMLInputElement).value,
                      })}
                  />
                </label>
                <button
                  type="button"
                  class="self-end rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  onclick={() => removeWhitelistEntry(entry.uid)}
                >
                  {t("minimap.settings.playerWhitelist.remove")}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>

    <section
      class="border-border/60 bg-card/40 space-y-4 rounded-lg border p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
    >
      <div>
        <h2 class="text-foreground text-base font-semibold">
          {t("minimap.overlay.title")}
        </h2>
        <p class="text-muted-foreground text-xs">
          {t("minimap.overlay.description")}
        </p>
      </div>

      <div class="space-y-2">
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-lg border px-3 py-2 text-sm font-medium transition-colors {minimapSettings.showMapPanel
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border/60 bg-muted/30 text-foreground hover:bg-muted/50'}"
            onclick={() =>
              (minimapSettings.showMapPanel = !minimapSettings.showMapPanel)}
          >
            {t("minimap.overlay.mapPanel", {
              state: visibilityState(minimapSettings.showMapPanel),
            })}
          </button>
          <button
            type="button"
            class="rounded-lg border px-3 py-2 text-sm font-medium transition-colors {minimapSettings.showInfoPanel
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border/60 bg-muted/30 text-foreground hover:bg-muted/50'}"
            onclick={() =>
              (minimapSettings.showInfoPanel = !minimapSettings.showInfoPanel)}
          >
            {t("minimap.overlay.infoPanel", {
              state: visibilityState(minimapSettings.showInfoPanel),
            })}
          </button>
        </div>
        <p class="text-muted-foreground text-xs">
          {t("minimap.overlay.help")}
        </p>
      </div>
    </section>

    <section
      class="border-border/60 bg-card/40 space-y-4 rounded-lg border p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
    >
      <div>
        <h2 class="text-foreground text-base font-semibold">
          {t("minimap.settings.showMarkers.label")}
        </h2>
        <p class="text-muted-foreground text-xs">
          {t("minimap.settings.showMarkers.description")}
        </p>
      </div>

      {#if minimapSettings.showMarkers !== undefined}
        <SettingsSwitch
          bind:checked={minimapSettings.showMarkers}
          label={t("minimap.overlay.state.show")}
        />
      {/if}

      {#if minimapSettings.markerColors}
        <div class="grid gap-2 lg:grid-cols-2">
          <SettingsColor
            bind:value={minimapSettings.markerColors.m1}
            label={t("minimap.settings.colors.marker1")}
          />
          <SettingsColor
            bind:value={minimapSettings.markerColors.m2}
            label={t("minimap.settings.colors.marker2")}
          />
          <SettingsColor
            bind:value={minimapSettings.markerColors.m3}
            label={t("minimap.settings.colors.marker3")}
          />
          <SettingsColor
            bind:value={minimapSettings.markerColors.m4}
            label={t("minimap.settings.colors.marker4")}
          />
          <SettingsColor
            bind:value={minimapSettings.markerColors.m5}
            label={t("minimap.settings.colors.marker5")}
          />
          <SettingsColor
            bind:value={minimapSettings.markerColors.m6}
            label={t("minimap.settings.colors.marker6")}
          />
        </div>
      {/if}
    </section>

    <section
      class="border-border/60 bg-card/40 space-y-4 rounded-lg border p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
    >
      <div>
        <h2 class="text-foreground text-base font-semibold">
          {t("minimap.settings.colors.title")}
        </h2>
        <p class="text-muted-foreground text-xs">
          {t("minimap.settings.colors.description")}
        </p>
      </div>

      <div class="grid gap-2 lg:grid-cols-2">
        <SettingsColor
          bind:value={minimapSettings.entityColors.local}
          label={t("minimap.settings.colors.local")}
        />
        <SettingsColor
          bind:value={minimapSettings.entityColors.teammate}
          label={t("minimap.settings.colors.teammate")}
        />
        {#if minimapSettings.entityColors.boss}
          <SettingsColor
            bind:value={minimapSettings.entityColors.boss}
            label={t("minimap.settings.colors.boss")}
          />
        {/if}
      </div>
    </section>

    <section
      class="border-border/60 bg-card/40 space-y-4 rounded-lg border p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
    >
      <div>
        <h2 class="text-foreground text-base font-semibold">
          {t("minimap.settings.localRing.title")}
        </h2>
        <p class="text-muted-foreground text-xs">
          {t("minimap.settings.localRing.description")}
        </p>
      </div>

      {#if minimapSettings.localRing && minimapSettings.localRing.enabled !== undefined && minimapSettings.localRing.color && minimapSettings.localRing.width !== undefined}
        <div class="space-y-4">
        <SettingsSwitch
          bind:checked={minimapSettings.localRing.enabled}
          label={t("minimap.settings.localRing.enabled.label")}
          description={t("minimap.settings.localRing.enabled.description")}
        />
          {#if minimapSettings.localFacing && minimapSettings.localFacing.enabled !== undefined}
            <SettingsSwitch
              bind:checked={minimapSettings.localFacing.enabled}
              label={t("minimap.settings.localFacing.label")}
              description={t("minimap.settings.localFacing.description")}
            />
          {/if}
          <div class="grid gap-2 lg:grid-cols-2">
            <SettingsColor
              bind:value={minimapSettings.localRing.color}
              label={t("minimap.settings.localRing.color")}
            />
            <SettingsSlider
              bind:value={minimapSettings.localRing.width}
              label={t("minimap.settings.localRing.width")}
              min={1}
              max={6}
              step={1}
              unit="px"
            />
          </div>
        </div>
      {/if}
    </section>
</div>
