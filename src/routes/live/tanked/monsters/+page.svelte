<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { settings, SETTINGS, DEFAULT_STATS } from "$lib/settings-store";
  import {
    getLiveData,
    getLiveDisplayNowMs,
  } from "$lib/stores/live-meter-store.svelte";
  import {
    computePlayerRows,
    computePlayerRowsFromEntities,
    liveDisplayElapsedMs,
  } from "$lib/live-derived";
  import { liveTankedPlayerColumns, orderColumnsByKey } from "$lib/column-data";
  import {
    buildSourceEntities,
    sourceMonsterKey,
    UNKNOWN_SOURCE_KEY,
  } from "$lib/tanked-source-derived";
  import TableRowGlow from "$lib/components/table-row-glow.svelte";
  import AbbreviatedNumber from "$lib/components/abbreviated-number.svelte";
  import PercentFormat from "$lib/components/percent-format.svelte";
  import { normalizeNameDisplaySetting } from "$lib/name-display";
  import { resolveNavigationTranslation, resolveUiTranslation } from "$lib/i18n";

  const playerUid = Number(page.url.searchParams.get("playerUid") ?? "-1");

  let liveData = $derived(getLiveData());
  let liveDisplayNow = $derived(getLiveDisplayNowMs());
  let tankedPlayers = $derived(
    liveData ? computePlayerRows(liveData, "tanked", liveDisplayNow) : [],
  );
  let currentPlayer = $derived(
    tankedPlayers.find((player) => player.uid === playerUid) ?? null,
  );
  let currentEntity = $derived(
    liveData?.entities.find((entity) => entity.uid === playerUid) ?? null,
  );

  let monsterRows = $derived.by(() => {
    if (!liveData || !currentEntity) return [];
    const entities = buildSourceEntities(
      currentEntity,
      currentEntity.takenPerSource,
      SETTINGS.live.general.state.language,
    );
    return computePlayerRowsFromEntities(
      {
        entities,
        elapsedMs: liveDisplayElapsedMs(liveData, liveDisplayNow),
        activeCombatTimeMs: liveData.activeCombatTimeMs,
        totalDmg: 0,
        totalHeal: 0,
        totalDmgBossOnly: 0,
      },
      "tanked",
    );
  });

  let sortKey = $derived(SETTINGS.live.sorting.tankedPlayers.state.sortKey);
  let sortDesc = $derived(SETTINGS.live.sorting.tankedPlayers.state.sortDesc);
  let columnOrder = $derived(
    SETTINGS.live.columnOrder.tankedPlayers.state.order,
  );

  function handleSort(key: string) {
    if (SETTINGS.live.sorting.tankedPlayers.state.sortKey === key) {
      SETTINGS.live.sorting.tankedPlayers.state.sortDesc =
        !SETTINGS.live.sorting.tankedPlayers.state.sortDesc;
    } else {
      SETTINGS.live.sorting.tankedPlayers.state.sortKey = key;
      SETTINGS.live.sorting.tankedPlayers.state.sortDesc = true;
    }
  }

  function t(key: string, fallback: string): string {
    return resolveUiTranslation(
      "ui/dps/history.json",
      key,
      SETTINGS.live.general.state.language,
      fallback,
    );
  }

  function thLabel(
    col: { headerKey?: string; labelKey?: string; header: string; label?: string },
  ): string {
    const language = SETTINGS.live.general.state.language;

    if (col.headerKey) {
      const translatedHeader = resolveNavigationTranslation(col.headerKey, language, "");
      if (translatedHeader?.trim()) return translatedHeader;
    }

    if (col.labelKey) {
      const translatedLabel = resolveNavigationTranslation(
        col.labelKey,
        language,
        col.label ?? col.header,
      );
      if (translatedLabel?.trim()) return translatedLabel;
    }

    return col.header;
  }

  function sourceKeyFromRowUid(uid: number): string {
    return uid === 0 ? UNKNOWN_SOURCE_KEY : sourceMonsterKey(uid);
  }

  function openSkills(monsterKey: string) {
    goto(`/live/tanked/skills?playerUid=${playerUid}&monsterId=${monsterKey}`);
  }

  let tableSettings = $derived(SETTINGS.live.tableCustomization.state);
  let compactMode = $derived(tableSettings.compactMode);
  let abbreviatedDecimalPlaces = $derived(
    SETTINGS.live.general.state.abbreviatedDecimalPlaces ?? 1,
  );
  let customThemeColors = $derived(
    SETTINGS.accessibility.state.customThemeColors,
  );
  let SETTINGS_SHORTEN_TPS = $derived(settings.state.live.general.shortenTps);
  let SETTINGS_RELATIVE_TO_TOP = $derived(
    settings.state.live.general.relativeToTopTankedPlayer,
  );
  let SETTINGS_YOUR_NAME = $derived(settings.state.live.general.showYourName);
  let SETTINGS_OTHERS_NAME = $derived(
    settings.state.live.general.showOthersName,
  );

  let glowClassName = $derived.by(() => {
    if (!currentPlayer) return "";
    const isLocalPlayer =
      liveData?.localPlayerUid != null && currentPlayer.uid === liveData.localPlayerUid;
    return isLocalPlayer
      ? normalizeNameDisplaySetting(SETTINGS_YOUR_NAME) !== "Hide Your Name"
        ? currentPlayer.className
        : ""
      : normalizeNameDisplaySetting(SETTINGS_OTHERS_NAME) !==
          "Hide Others' Name"
        ? currentPlayer.className
        : "";
  });
  let glowClassSpecName = $derived(currentPlayer?.classSpecName ?? "");

  let maxTaken = $derived(
    monsterRows.reduce((max, row) => (row.totalDmg > max ? row.totalDmg : max), 0),
  );

  let sortedRows = $derived.by(() => {
    const data = [...monsterRows];
    data.sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortKey] ?? 0;
      const bVal = (b as Record<string, unknown>)[sortKey] ?? 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDesc ? bVal - aVal : aVal - bVal;
      }
      return 0;
    });
    return data;
  });

  let displayedRows = $derived.by(() =>
    compactMode
      ? [...monsterRows].sort((a, b) => b.totalDmg - a.totalDmg)
      : sortedRows,
  );

  let visiblePlayerColumns = $derived.by(() => {
    const visible = liveTankedPlayerColumns.filter((col) => {
      if (col.key === "effectiveTotal" || col.key === "effectiveDps") return false;
      const defaultValue =
        DEFAULT_STATS[col.key as keyof typeof DEFAULT_STATS] ?? true;
      const setting =
        SETTINGS.live.tanked.players.state[
          col.key as keyof typeof SETTINGS.live.tanked.players.state
        ];
      return typeof setting === "boolean" ? setting : defaultValue;
    });
    return orderColumnsByKey(visible, columnOrder);
  });
</script>

<svelte:window oncontextmenu={() => window.history.back()} />

<div class="relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden rounded-lg ring-1 ring-border/60 bg-card/30 backdrop-blur-sm">
  <table class="w-full border-separate border-spacing-0">
    {#if tableSettings.showTableHeader && !compactMode}
      <thead class="sticky top-0 z-50">
        <tr
          class="bg-popover"
          style="height: {tableSettings.tableHeaderHeight}px;"
        >
          <th
            class="sticky top-0 z-50 bg-popover px-3 py-1 text-left font-medium uppercase tracking-wide shadow-[0_1px_0_hsl(var(--border)/0.6)]"
            style="font-size: {tableSettings.tableHeaderFontSize}px; color: {tableSettings.tableHeaderTextColor};"
            >{t("tanked.monster.source", "Source")}</th
          >
          {#each visiblePlayerColumns as col (col.key)}
            <th
              class="sticky top-0 z-50 bg-popover px-3 py-1 text-right font-medium uppercase tracking-wide cursor-pointer select-none shadow-[0_1px_0_hsl(var(--border)/0.6)] hover:bg-muted transition-colors"
              style="font-size: {tableSettings.tableHeaderFontSize}px; color: {tableSettings.tableHeaderTextColor};"
              onclick={() => handleSort(col.key)}
            >
              <span class="inline-flex items-center gap-1 justify-end">
                {thLabel(col)}
                {#if sortKey === col.key}
                  <span class="text-primary">{sortDesc ? "v" : "^"}</span>
                {/if}
              </span>
            </th>
          {/each}
        </tr>
      </thead>
    {/if}
    <tbody>
      {#if currentPlayer}
        <tr
          class="relative bg-background/40 hover:bg-muted/60 transition-colors cursor-pointer group"
          style="height: {tableSettings.playerRowHeight}px; font-size: {tableSettings.playerFontSize}px;"
          onclick={() => openSkills("total")}
        >
          <td class="px-3 py-1 relative z-10">
            <span
              class="truncate font-medium"
              style="color: {customThemeColors.tableTextColor};"
              >{t("tanked.monster.total", "Total")}</span
            >
          </td>
          {#each visiblePlayerColumns as col (col.key)}
            <td
              class="px-3 py-1 text-right relative z-10 tabular-nums font-medium"
              style="color: {customThemeColors.tableTextColor};"
            >
              {#if col.key === "totalDmg" || col.key === "effectiveTotal"}
                {#if SETTINGS_SHORTEN_TPS}
                  <AbbreviatedNumber
                    num={col.key === "totalDmg" ? currentPlayer.totalDmg : currentPlayer.effectiveTotal}
                    decimalPlaces={abbreviatedDecimalPlaces}
                    suffixFontSize={tableSettings.abbreviatedFontSize}
                    suffixColor={customThemeColors.tableAbbreviatedColor}
                  />
                {:else}
                  {(col.key === "totalDmg" ? currentPlayer.totalDmg : currentPlayer.effectiveTotal).toLocaleString()}
                {/if}
              {:else if col.key === "dps" || col.key === "effectiveDps"}
                {#if SETTINGS_SHORTEN_TPS}
                  <AbbreviatedNumber
                    num={col.key === "dps" ? currentPlayer.dps : currentPlayer.effectiveDps}
                    decimalPlaces={abbreviatedDecimalPlaces}
                    suffixFontSize={tableSettings.abbreviatedFontSize}
                    suffixColor={customThemeColors.tableAbbreviatedColor}
                  />
                {:else}
                  {currentPlayer.dps.toFixed(1)}
                {/if}
              {:else if col.key === "dmgPct"}
                <PercentFormat
                  val={100}
                  fractionDigits={0}
                  suffixFontSize={tableSettings.abbreviatedFontSize}
                  suffixColor={customThemeColors.tableAbbreviatedColor}
                />
              {:else if col.key === "critRate" || col.key === "critDmgRate" || col.key === "luckyRate" || col.key === "luckyDmgRate" || col.key === "blockRate" || col.key === "luckyBlockRate"}
                <PercentFormat
                  val={currentPlayer[col.key]}
                  suffixFontSize={tableSettings.abbreviatedFontSize}
                  suffixColor={customThemeColors.tableAbbreviatedColor}
                />
              {:else}
                {col.format(currentPlayer[col.key as keyof typeof currentPlayer] as number ?? 0)}
              {/if}
            </td>
          {/each}
          <TableRowGlow
            className={glowClassName}
            classSpecName={glowClassSpecName}
            percentage={100}
          />
        </tr>
      {/if}

      {#each displayedRows as row (row.uid)}
        <tr
          class="relative bg-background/40 hover:bg-muted/60 transition-colors cursor-pointer group"
          style="height: {tableSettings.playerRowHeight}px; font-size: {tableSettings.playerFontSize}px;"
          onclick={() => openSkills(sourceKeyFromRowUid(row.uid))}
        >
          <td class="px-3 py-1 relative z-10">
            <span
              class="truncate font-medium"
              style="color: {customThemeColors.tableTextColor};"
              >{row.name}</span
            >
          </td>
          {#each visiblePlayerColumns as col (col.key)}
            <td
              class="px-3 py-1 text-right relative z-10 tabular-nums font-medium"
              style="color: {customThemeColors.tableTextColor};"
            >
              {#if col.key === "totalDmg" || col.key === "effectiveTotal"}
                {#if SETTINGS_SHORTEN_TPS}
                  <AbbreviatedNumber
                    num={col.key === "totalDmg" ? row.totalDmg : row.effectiveTotal}
                    decimalPlaces={abbreviatedDecimalPlaces}
                    suffixFontSize={tableSettings.abbreviatedFontSize}
                    suffixColor={customThemeColors.tableAbbreviatedColor}
                  />
                {:else}
                  {(col.key === "totalDmg" ? row.totalDmg : row.effectiveTotal).toLocaleString()}
                {/if}
              {:else if col.key === "dps" || col.key === "effectiveDps"}
                {#if SETTINGS_SHORTEN_TPS}
                  <AbbreviatedNumber
                    num={col.key === "dps" ? row.dps : row.effectiveDps}
                    decimalPlaces={abbreviatedDecimalPlaces}
                    suffixFontSize={tableSettings.abbreviatedFontSize}
                    suffixColor={customThemeColors.tableAbbreviatedColor}
                  />
                {:else}
                  {row.dps.toFixed(1)}
                {/if}
              {:else if col.key === "dmgPct"}
                <PercentFormat
                  val={row.dmgPct}
                  fractionDigits={0}
                  suffixFontSize={tableSettings.abbreviatedFontSize}
                  suffixColor={customThemeColors.tableAbbreviatedColor}
                />
              {:else if col.key === "critRate" || col.key === "critDmgRate" || col.key === "luckyRate" || col.key === "luckyDmgRate" || col.key === "blockRate" || col.key === "luckyBlockRate"}
                <PercentFormat
                  val={row[col.key]}
                  suffixFontSize={tableSettings.abbreviatedFontSize}
                  suffixColor={customThemeColors.tableAbbreviatedColor}
                />
              {:else}
                {col.format(row[col.key as keyof typeof row] as number ?? 0)}
              {/if}
            </td>
          {/each}
          <TableRowGlow
            className={glowClassName}
            classSpecName={glowClassSpecName}
            percentage={SETTINGS_RELATIVE_TO_TOP
              ? maxTaken > 0
                ? (row.totalDmg / maxTaken) * 100
                : 0
              : row.dmgPct}
          />
        </tr>
      {/each}
    </tbody>
  </table>
</div>
