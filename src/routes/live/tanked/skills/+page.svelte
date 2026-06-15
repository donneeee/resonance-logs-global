<script lang="ts">
  import { settings, SETTINGS } from "$lib/settings-store";
  import {
    computePlayerRows,
    computeSkillRows,
    liveDisplayElapsedMs,
  } from "$lib/live-derived";
  import {
    liveEntityMatchesRoute,
    livePlayerRoute,
    liveRouteIdentityFromSearch,
    type LiveEntityRouteSubject,
  } from "$lib/live-entity-route";
  import {
    lookupDamageIdName,
    lookupSkillBreakdownIconPath,
    resolveSkillRuntimeSourceFallbackName,
  } from "$lib/config/recount-table";
  import {
    getLiveData,
    getLiveDisplayNowMs,
  } from "$lib/stores/live-meter-store.svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import TableRowGlow from "$lib/components/table-row-glow.svelte";
  import {
    columnLabelWithAlias,
    liveTankedSkillColumns,
    orderColumnsByKey,
    type ColumnDefinition,
  } from "$lib/column-data";
  import AbbreviatedNumber from "$lib/components/abbreviated-number.svelte";
  import PercentFormat from "$lib/components/percent-format.svelte";
  import getDisplayName from "$lib/name-display";
  import { normalizeNameDisplaySetting } from "$lib/name-display";
  import { toSpecLabel } from "$lib/class-labels";
  import { resolveNavigationTranslation, resolveSkillNote, resolveSkillTranslation, type LocaleCode } from "$lib/i18n";
  import {
    buildSourceNameFallback,
    buildUniqueSkillSourceFallbacks,
    findSourceByKey,
  } from "$lib/tanked-source-derived";

  const routeIdentity = liveRouteIdentityFromSearch(page.url.searchParams);
  const playerUid = routeIdentity.playerUid ?? -1;
  const monsterId = page.url.searchParams.get("monsterId");

  let liveData = $derived(getLiveData());
  let liveDisplayNow = $derived(getLiveDisplayNowMs());
  let tankedPlayers = $derived(
    liveData ? computePlayerRows(liveData, "tanked", liveDisplayNow) : [],
  );
  let currentPlayer = $derived(
    tankedPlayers.find((player) => liveEntityMatchesRoute(player, routeIdentity)) ?? null,
  );
  let currentEntity = $derived(
    liveData?.entities.find((entity) => liveEntityMatchesRoute(entity, routeIdentity)) ?? null,
  );

  type LivePlayerIdentity = { uid: number; entityKey?: string | null };

  function currentRouteSubject(): LiveEntityRouteSubject {
    return currentPlayer ?? { uid: playerUid, entityKey: routeIdentity.entityKey };
  }

  function isLocalPlayerRow(player: LivePlayerIdentity | null | undefined): boolean {
    if (!player) return false;
    const localPlayerKey = liveData?.localPlayerKey?.trim();
    const playerEntityKey = player.entityKey?.trim();
    if (localPlayerKey && playerEntityKey) return localPlayerKey === playerEntityKey;
    return liveData?.localPlayerUid != null && player.uid === liveData.localPlayerUid;
  }

  let selectedSource = $derived(
    monsterId && monsterId !== "total"
      ? findSourceByKey(currentEntity?.takenPerSource, monsterId)
      : null,
  );
  let sourceFallbacks = $derived(
    buildUniqueSkillSourceFallbacks(
      currentEntity?.takenPerSource,
      SETTINGS.live.general.state.language as LocaleCode,
    ),
  );
  let selectedSourceFallback = $derived(
    selectedSource
      ? buildSourceNameFallback(
          selectedSource.sourceMonsterId,
          SETTINGS.live.general.state.language as LocaleCode,
        )
      : null,
  );

  let skillRows = $derived(
    currentEntity && liveData
      ? computeSkillRows(
          selectedSource ? selectedSource.skills : currentEntity.takenSkills,
          liveDisplayElapsedMs(liveData, liveDisplayNow),
          selectedSource ? selectedSource.taken.total : currentEntity.taken.total,
          lookupDamageIdName,
        )
      : [],
  );

  let maxTakenSkill = $state(0);
  let SETTINGS_YOUR_NAME = $state(settings.state.live.general.showYourName);
  let SETTINGS_OTHERS_NAME = $state(settings.state.live.general.showOthersName);
  let SETTINGS_SHORTEN_TPS = $state(settings.state.live.general.shortenTps);
  let SETTINGS_RELATIVE_TO_TOP_TANKED_SKILL = $state(
    settings.state.live.general.relativeToTopTankedSkill,
  );

  let tableSettings = $derived(SETTINGS.live.tableCustomization.state);
  let abbreviatedDecimalPlaces = $derived(
    SETTINGS.live.general.state.abbreviatedDecimalPlaces ?? 1,
  );
  let customThemeColors = $derived(
    SETTINGS.accessibility.state.customThemeColors,
  );

  let sortKey = $derived(SETTINGS.live.sorting.tankedSkills.state.sortKey);
  let sortDesc = $derived(SETTINGS.live.sorting.tankedSkills.state.sortDesc);
  let columnOrder = $derived(
    SETTINGS.live.columnOrder.tankedSkills.state.order,
  );

  function handleSort(key: string) {
    if (SETTINGS.live.sorting.tankedSkills.state.sortKey === key) {
      SETTINGS.live.sorting.tankedSkills.state.sortDesc =
        !SETTINGS.live.sorting.tankedSkills.state.sortDesc;
    } else {
      SETTINGS.live.sorting.tankedSkills.state.sortKey = key;
      SETTINGS.live.sorting.tankedSkills.state.sortDesc = true;
    }
  }

  function buildSkillHoverText(skillId: string | number, language: LocaleCode) {
  const note = hoverDescriptionsEnabled() ? resolveSkillNote(skillId, language).trim() : "";

  return `ID: #${skillId}\nSources:\n- RecountTable.json\n- DamageAttrIdName.json${note ? `\n\nNote:\n${note}` : ""}`;
  }

  function hoverDescriptionsEnabled(): boolean {
    return SETTINGS.live.general.state.showHoverDescriptions !== false;
  }

  function shouldShowUidHover(): boolean {
    return SETTINGS.live.general.state.skillIdDisplayMode === 'hover' || hoverDescriptionsEnabled();
  }

  function skillDisplayName(skill: { skillId: number; name: string }): string {
    const language = SETTINGS.live.general.state.language as LocaleCode;
    const runtimeSource =
      selectedSourceFallback ?? sourceFallbacks.get(skill.skillId);
    const runtimeName = resolveSkillRuntimeSourceFallbackName(
      skill.skillId,
      language,
      skill.name,
      runtimeSource ?? undefined,
    );
    if (runtimeName) return runtimeName;
    return resolveSkillTranslation(skill.skillId, language, skill.name);
  }

  function thLabel(col: ColumnDefinition): string {
    const language = SETTINGS.live.general.state.language;

    if (col.headerKey) {
      const translatedHeader = resolveNavigationTranslation(col.headerKey, language, "");
      if (translatedHeader?.trim()) {
        return columnLabelWithAlias(SETTINGS.live.columnAliases.state, col, translatedHeader);
      }
    }

    if (col.labelKey) {
      const translatedLabel = resolveNavigationTranslation(
        col.labelKey,
        language,
        col.label ?? col.header,
      );
      if (translatedLabel?.trim()) {
        return columnLabelWithAlias(SETTINGS.live.columnAliases.state, col, translatedLabel);
      }
    }

    return columnLabelWithAlias(SETTINGS.live.columnAliases.state, col, col.header);
  }

  function uiLabel(key: string, fallback: string): string {
    return resolveNavigationTranslation(
      key,
      SETTINGS.live.general.state.language,
      fallback,
    );
  }

  let sortedSkillRows = $derived.by(() => {
    const data = [...skillRows];
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

  $effect(() => {
    maxTakenSkill = sortedSkillRows.reduce(
      (max, s) => (s.totalDmg > max ? s.totalDmg : max),
      0,
    );
  });

  $effect(() => {
    SETTINGS_YOUR_NAME = settings.state.live.general.showYourName;
    SETTINGS_OTHERS_NAME = settings.state.live.general.showOthersName;
    SETTINGS_SHORTEN_TPS = settings.state.live.general.shortenTps;
    SETTINGS_RELATIVE_TO_TOP_TANKED_SKILL =
      settings.state.live.general.relativeToTopTankedSkill;
  });

  let visibleSkillColumns = $derived.by(() => {
    const visible = liveTankedSkillColumns.filter((col) => {
      if (col.key === "effectiveTotal" || col.key === "effectiveDps") return false;
      return SETTINGS.live.tanked.skills.state[
        col.key as keyof typeof SETTINGS.live.tanked.skills.state
      ] === true;
    });
    return orderColumnsByKey(visible, columnOrder);
  });
</script>

{#if currentPlayer}
  {@const isLocalPlayer = isLocalPlayerRow(currentPlayer)}
  {@const className = isLocalPlayer
    ? normalizeNameDisplaySetting(SETTINGS_YOUR_NAME) !== "Hide Your Name"
      ? currentPlayer.className
      : ""
    : normalizeNameDisplaySetting(SETTINGS_OTHERS_NAME) !== "Hide Others' Name"
      ? currentPlayer.className
      : ""}
  {@const nameSetting = normalizeNameDisplaySetting(
    isLocalPlayer ? SETTINGS_YOUR_NAME : SETTINGS_OTHERS_NAME,
  )}
  {@const displayName = getDisplayName({
    player: {
      uid: currentPlayer.uid,
      name: currentPlayer.name,
      className: currentPlayer.className,
      classSpecName: currentPlayer.classSpecName,
    },
    showYourNameSetting: SETTINGS_YOUR_NAME,
    showOthersNameSetting: SETTINGS_OTHERS_NAME,
    isLocalPlayer,
  })}
  <div
    class="relative z-30 flex h-8 w-full shrink-0 items-center gap-2 bg-popover/60 px-2 text-xs"
    style="background-color: {`color-mix(in srgb, ${className ? `var(--class-color-${className.toLowerCase().replace(/\s+/g, '-')})` : '#6b7280'} 30%, transparent)`};"
  >
    <button
      class="underline"
      onclick={() =>
        goto(monsterId ? livePlayerRoute("/live/tanked/monsters", currentRouteSubject()) : "/live/tanked")}
      >{uiLabel("detail.back", "Back")}</button
    >
    <span class="font-bold">{displayName || `#${currentPlayer.uid}`}</span>
    {#if nameSetting !== "Show Your Name - Spec" &&
      nameSetting !== "Show Others' Name - Spec" &&
      currentPlayer.classSpecName}
      <span>{toSpecLabel(currentPlayer.classSpecName)}</span>
    {/if}
    <span class="ml-auto">
      <span class="text-xs">{uiLabel("tanked.monster.total", "Total")}: </span>
      {#if SETTINGS_SHORTEN_TPS}
        <AbbreviatedNumber
          num={currentPlayer.totalDmg}
          decimalPlaces={abbreviatedDecimalPlaces}
          suffixFontSize={tableSettings.skillAbbreviatedFontSize}
          suffixColor={customThemeColors.tableAbbreviatedColor}
        />
      {:else}
        {currentPlayer.totalDmg.toLocaleString()}
      {/if}
    </span>
  </div>
{/if}

<div class="relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
  <table class="w-full border-separate border-spacing-0">
    {#if tableSettings.skillShowHeader}
      <thead class="sticky top-0 z-50">
        <tr
          class="bg-popover"
          style="height: {tableSettings.skillHeaderHeight}px;"
        >
          <th
            class="sticky top-0 z-50 bg-popover px-2 py-1 text-left font-medium uppercase tracking-wider shadow-[0_1px_0_hsl(var(--border)/0.6)]"
            style="font-size: {tableSettings.skillHeaderFontSize}px; color: {tableSettings.skillHeaderTextColor};"
            >Skill</th
          >
          {#each visibleSkillColumns as col (col.key)}
            <th
              class="sticky top-0 z-50 bg-popover px-2 py-1 text-right font-medium uppercase tracking-wider cursor-pointer select-none shadow-[0_1px_0_hsl(var(--border)/0.6)] hover:bg-muted transition-colors"
              style="font-size: {tableSettings.skillHeaderFontSize}px; color: {tableSettings.skillHeaderTextColor};"
              onclick={() => handleSort(col.key)}
            >
              <span class="inline-flex items-center gap-1 justify-end">
                {thLabel(col)}
                {#if sortKey === col.key}
                  <span class="text-primary">{sortDesc ? "▼" : "▲"}</span>
                {/if}
              </span>
            </th>
          {/each}
        </tr>
      </thead>
    {/if}
    <tbody>
      {#each sortedSkillRows as skill (skill.skillId)}
        {@const iconPath = lookupSkillBreakdownIconPath(skill.skillId)}
        {@const rowIsLocalPlayer = isLocalPlayerRow(currentPlayer)}
        {@const className = rowIsLocalPlayer
          ? normalizeNameDisplaySetting(SETTINGS_YOUR_NAME) !== "Hide Your Name"
            ? (currentPlayer?.className ?? "")
            : ""
          : normalizeNameDisplaySetting(SETTINGS_OTHERS_NAME) !==
                "Hide Others' Name" && currentPlayer
            ? (currentPlayer.className ?? "")
            : ""}
        <tr
          class="relative hover:bg-muted/60 transition-colors bg-background/40"
          style="height: {tableSettings.skillRowHeight}px; font-size: {tableSettings.skillFontSize}px;"
        >
          <td
            class="px-2 py-1 relative z-10"
            style="color: {customThemeColors.tableTextColor};"
          >
            <div class="flex items-center gap-1 h-full">
              {#if iconPath}
                <img
                  class="size-4 shrink-0 rounded-sm object-cover"
                  src={iconPath}
                  alt=""
                  loading="lazy"
                />
              {/if}
              <span
                class="truncate"
                title={shouldShowUidHover()
                  ? buildSkillHoverText(skill.skillId, SETTINGS.live.general.state.language as LocaleCode)
                  : undefined}
              >
                {skillDisplayName(skill)}
              </span>
              {#if SETTINGS.live.general.state.skillIdDisplayMode === 'column'}
                <span class="text-[10px] text-muted-foreground/50 shrink-0">
                  #{skill.skillId}
                </span>
              {/if}
            </div>
          </td>
          {#each visibleSkillColumns as col (col.key)}
            <td
              class="px-2 py-1 text-right relative z-10"
              style="color: {customThemeColors.tableTextColor};"
            >
              {#if col.key === "totalDmg" || col.key === "effectiveTotal"}
                {#if SETTINGS_SHORTEN_TPS}
                  <AbbreviatedNumber
                    num={col.key === "totalDmg" ? skill.totalDmg : skill.effectiveTotal}
                    decimalPlaces={abbreviatedDecimalPlaces}
                    suffixFontSize={tableSettings.skillAbbreviatedFontSize}
                    suffixColor={customThemeColors.tableAbbreviatedColor}
                  />
                {:else}
                  {(col.key === "totalDmg" ? skill.totalDmg : skill.effectiveTotal).toLocaleString()}
                {/if}
              {:else if col.key === "dps" || col.key === "effectiveDps"}
                {#if SETTINGS_SHORTEN_TPS}
                  <AbbreviatedNumber
                    num={skill.dps}
                    decimalPlaces={abbreviatedDecimalPlaces}
                    suffixFontSize={tableSettings.skillAbbreviatedFontSize}
                    suffixColor={customThemeColors.tableAbbreviatedColor}
                  />
                {:else}
                  {skill.dps.toFixed(1)}
                {/if}
              {:else if col.key === "dmgPct"}
                <PercentFormat
                  val={skill.dmgPct}
                  fractionDigits={0}
                  suffixFontSize={tableSettings.skillAbbreviatedFontSize}
                  suffixColor={customThemeColors.tableAbbreviatedColor}
                />
              {:else if col.key === "critRate" || col.key === "critDmgRate" || col.key === "luckyRate" || col.key === "luckyDmgRate" || col.key === "blockRate" || col.key === "luckyBlockRate"}
                <PercentFormat
                  val={skill[col.key]}
                  suffixFontSize={tableSettings.skillAbbreviatedFontSize}
                  suffixColor={customThemeColors.tableAbbreviatedColor}
                />
              {:else}
                {col.format(skill[col.key] ?? 0)}
              {/if}
            </td>
          {/each}
          <TableRowGlow
            isSkill={true}
            {className}
            classSpecName={currentPlayer?.classSpecName ?? ""}
            percentage={SETTINGS_RELATIVE_TO_TOP_TANKED_SKILL
              ? maxTakenSkill > 0
                ? (skill.totalDmg / maxTakenSkill) * 100
                : 0
              : skill.dmgPct}
          />
        </tr>
      {/each}
    </tbody>
  </table>
</div>
