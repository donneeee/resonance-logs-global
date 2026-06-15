<script lang="ts">
  import { page } from "$app/state";
  import { settings, SETTINGS } from "$lib/settings-store";
  import {
    getLiveData,
    getLiveDisplayNowMs,
  } from "$lib/stores/live-meter-store.svelte";
  import {
    computePlayerRows,
    computeSkillRows,
    liveDisplayElapsedMs,
  } from "$lib/live-derived";
  import {
    liveEntityMatchesRoute,
    liveRouteIdentityFromSearch,
  } from "$lib/live-entity-route";
  import { lookupDamageIdName, lookupSkillBreakdownIconPath } from "$lib/config/recount-table";
  import TableRowGlow from "$lib/components/table-row-glow.svelte";
  import {
    columnLabelWithAlias,
    liveHealSkillColumns,
    orderColumnsByKey,
    type ColumnDefinition,
  } from "$lib/column-data";
  import AbbreviatedNumber from "$lib/components/abbreviated-number.svelte";
  import PercentFormat from "$lib/components/percent-format.svelte";
  import { normalizeNameDisplaySetting } from "$lib/name-display";
  import { resolveNavigationTranslation, resolveSkillNote, resolveSkillTranslation, type LocaleCode } from "$lib/i18n";

  const routeIdentity = liveRouteIdentityFromSearch(page.url.searchParams);

  let liveData = $derived(getLiveData());
  let liveDisplayNow = $derived(getLiveDisplayNowMs());
  let healPlayers = $derived(
    liveData ? computePlayerRows(liveData, "heal", liveDisplayNow) : [],
  );
  let currPlayer = $derived(
    healPlayers.find((player) => liveEntityMatchesRoute(player, routeIdentity)),
  );
  let currEntity = $derived(
    liveData?.entities.find((entity) => liveEntityMatchesRoute(entity, routeIdentity)) ?? null,
  );

  type LivePlayerIdentity = { uid: number; entityKey?: string | null };

  function isLocalPlayerRow(player: LivePlayerIdentity | null | undefined): boolean {
    if (!player) return false;
    const localPlayerKey = liveData?.localPlayerKey?.trim();
    const playerEntityKey = player.entityKey?.trim();
    if (localPlayerKey && playerEntityKey) return localPlayerKey === playerEntityKey;
    return liveData?.localPlayerUid != null && player.uid === liveData.localPlayerUid;
  }

  let healSkillRows = $derived(
    currEntity && liveData
      ? computeSkillRows(
          currEntity.healSkills,
          liveDisplayElapsedMs(liveData, liveDisplayNow),
          currEntity.healing.total,
          lookupDamageIdName,
        )
      : [],
  );

  let maxSkillValue = $state(0);
  let SETTINGS_YOUR_NAME = $state(settings.state.live.general.showYourName);
  let SETTINGS_OTHERS_NAME = $state(settings.state.live.general.showOthersName);
  let SETTINGS_SHORTEN_DPS = $state(settings.state.live.general.shortenDps);

  let tableSettings = $derived(SETTINGS.live.tableCustomization.state);
  let abbreviatedDecimalPlaces = $derived(
    SETTINGS.live.general.state.abbreviatedDecimalPlaces ?? 1,
  );
  let customThemeColors = $derived(
    SETTINGS.accessibility.state.customThemeColors,
  );

  let sortKey = $derived(SETTINGS.live.sorting.healSkills.state.sortKey);
  let sortDesc = $derived(SETTINGS.live.sorting.healSkills.state.sortDesc);
  let columnOrder = $derived(SETTINGS.live.columnOrder.healSkills.state.order);

  function handleSort(key: string) {
    if (SETTINGS.live.sorting.healSkills.state.sortKey === key) {
      SETTINGS.live.sorting.healSkills.state.sortDesc =
        !SETTINGS.live.sorting.healSkills.state.sortDesc;
    } else {
      SETTINGS.live.sorting.healSkills.state.sortKey = key;
      SETTINGS.live.sorting.healSkills.state.sortDesc = true;
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

  let sortedSkillRows = $derived.by(() => {
    const data = [...healSkillRows];
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
    maxSkillValue = sortedSkillRows.reduce(
      (max, p) => (p.totalDmg > max ? p.totalDmg : max),
      0,
    );
  });

  $effect(() => {
    SETTINGS_YOUR_NAME = settings.state.live.general.showYourName;
    SETTINGS_OTHERS_NAME = settings.state.live.general.showOthersName;
    SETTINGS_SHORTEN_DPS = settings.state.live.general.shortenDps;
  });

  let visibleSkillColumns = $derived.by(() => {
    const visible = liveHealSkillColumns.filter(
      (col) =>
        SETTINGS.live.heal.skillBreakdown.state[
          col.key as keyof typeof SETTINGS.live.heal.skillBreakdown.state
        ] === true,
    );
    return orderColumnsByKey(visible, columnOrder);
  });
</script>

<svelte:window oncontextmenu={() => window.history.back()} />

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
        {#if currPlayer}
          {@const isLocalPlayer = isLocalPlayerRow(currPlayer)}
          {@const className = isLocalPlayer
            ? normalizeNameDisplaySetting(SETTINGS_YOUR_NAME) !== "Hide Your Name"
              ? currPlayer.className
              : ""
            : normalizeNameDisplaySetting(SETTINGS_OTHERS_NAME) !==
                "Hide Others' Name"
              ? currPlayer.className
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
                  {resolveSkillTranslation(skill.skillId, SETTINGS.live.general.state.language, skill.name)}
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
                  {#if SETTINGS_SHORTEN_DPS}
                    <AbbreviatedNumber
                      num={col.key === "totalDmg" ? skill.totalDmg : skill.effectiveTotal}
                      decimalPlaces={abbreviatedDecimalPlaces}
                      suffixFontSize={tableSettings.skillAbbreviatedFontSize}
                      suffixColor={customThemeColors.tableAbbreviatedColor}
                    />
                  {:else}
                    {col.format(skill[col.key] ?? 0)}
                  {/if}
                {:else if col.key === "dmgPct"}
                  <PercentFormat
                    val={skill.dmgPct}
                    fractionDigits={0}
                    suffixFontSize={tableSettings.skillAbbreviatedFontSize}
                    suffixColor={customThemeColors.tableAbbreviatedColor}
                  />
                {:else if col.key === "critRate" || col.key === "critDmgRate" || col.key === "luckyRate" || col.key === "luckyDmgRate"}
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
              classSpecName={currPlayer.classSpecName}
              percentage={SETTINGS.live.general.state.relativeToTopHealSkill
                ? maxSkillValue > 0
                  ? (skill.totalDmg / maxSkillValue) * 100
                  : 0
                : skill.dmgPct}
            />
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
</div>
