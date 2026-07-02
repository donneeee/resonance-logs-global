<script lang="ts">
  import { goto } from "$app/navigation";
  import { SETTINGS } from "$lib/settings-store";
  import type { PlayerRow } from "$lib/api";
  import type { ColumnDefinition } from "$lib/column-data";
  import { livePlayerRoute } from "$lib/live-entity-route";
  import ClassSpecIcon from "$lib/components/class-spec-icon.svelte";
  import ChallengeWarningIcon from "$lib/components/ChallengeWarningIcon.svelte";
  import OceanWeaponBadge from "$lib/components/ocean-weapon-badge.svelte";
  import TableRowGlow from "$lib/components/table-row-glow.svelte";
  import AbbreviatedNumber from "$lib/components/abbreviated-number.svelte";
  import PercentFormat from "$lib/components/percent-format.svelte";
  import { scaledBadgeSize } from "$lib/badge-sizing";
  import getDisplayName, {
    getDisplayIconSpecName,
    normalizeNameDisplaySetting,
  } from "$lib/name-display";
  import { formatClassSpecLabel } from "$lib/class-labels";
  import { resolveUiTranslation } from "$lib/i18n";

  type PinnedSelfRowPlacement = "aboveHeader" | "top" | "bottom";
  type TableSettings = {
    playerIconSize: number;
    playerRowHeight: number;
    playerFontSize: number;
    abbreviatedFontSize: number;
  };
  type ThemeColors = {
    tableTextColor: string;
    tableAbbreviatedColor: string;
  };

  let {
    player,
    rank,
    compactMode = false,
    placement = "top",
    topOffset = 0,
    visiblePlayerColumns = [],
    tableSettings,
    settingsYourName,
    settingsOthersName,
    compactDpsKey = "dps",
    maxDamage = 0,
    customThemeColors,
    abbreviatedDecimalPlaces = 1,
  }: {
    player: PlayerRow;
    rank: number;
    compactMode?: boolean;
    placement?: PinnedSelfRowPlacement;
    topOffset?: number;
    visiblePlayerColumns?: ColumnDefinition[];
    tableSettings: TableSettings;
    settingsYourName: string;
    settingsOthersName: string;
    compactDpsKey?: string;
    maxDamage?: number;
    customThemeColors: ThemeColors;
    abbreviatedDecimalPlaces?: number;
  } = $props();

  const isLocalPlayer = true;
  const displayName = $derived(getDisplayName({
    player: {
      uid: player.uid,
      name: player.name,
      className: player.className,
      classSpecName: player.classSpecName,
    },
    showYourNameSetting: settingsYourName,
    showOthersNameSetting: settingsOthersName,
    isLocalPlayer,
  }));
  const className = $derived(
    normalizeNameDisplaySetting(settingsYourName) !== "Hide Your Name"
      ? player.className
      : "",
  );
  const iconSpecName = $derived(getDisplayIconSpecName({
    classSpecName: player.classSpecName,
    showYourNameSetting: settingsYourName,
    showOthersNameSetting: settingsOthersName,
    isLocalPlayer,
  }));

  function t(key: string, fallback: string): string {
    return resolveUiTranslation(
      key,
      SETTINGS.live.general.state.language,
      fallback,
    );
  }

  function rankLabel(): string {
    return t("liveDps.rankLabel", "Rank #{rank}").replace("{rank}", String(rank));
  }

  function rankBadgeWidth(): number {
    if (SETTINGS.live.general.state.showPlayerImagineBadges === false) return 0;

    const baseSize = compactMode
      ? Math.max(28, Math.round(tableSettings.playerIconSize * 1.4))
      : Math.max(26, Math.round(tableSettings.playerIconSize * 1.22));
    const badgeSize = scaledBadgeSize(
      baseSize,
      SETTINGS.live.general.state.playerImagineBadgeScale,
    );
    return Math.round(badgeSize * 2 + 4);
  }

  function rowClass(): string {
    const bottomPinned = placement === "bottom";
    return [
      placement === "top" ? "sticky z-40" : "",
      bottomPinned ? "relative z-[60] bg-popover hover:bg-popover" : "bg-amber-500/10 hover:bg-amber-500/15",
      "transition-colors cursor-pointer group shadow-[inset_0_1px_0_rgba(251,191,36,0.85),inset_0_-1px_0_rgba(251,191,36,0.85)]",
    ].filter(Boolean).join(" ");
  }

  function rowStyle(): string {
    const stickyTop = placement === "top" ? `top: ${topOffset}px; ` : "";
    return `${stickyTop}height: ${tableSettings.playerRowHeight}px; font-size: ${tableSettings.playerFontSize}px;`;
  }

  const rankWidthStyle = $derived.by(() => {
    const width = rankBadgeWidth();
    return width > 0
      ? `width: ${width}px; min-width: ${width}px; max-width: ${width}px; box-sizing: border-box;`
      : "";
  });

  function cellClass(baseClass: string): string {
    return placement === "bottom" ? `${baseClass} bg-popover` : baseClass;
  }

  function rowGlowPercentage(): number {
    return SETTINGS.live.general.state.relativeToTopDPSPlayer
      ? maxDamage > 0
        ? (player.totalDmg / maxDamage) * 100
        : 0
      : player.dmgPct;
  }

</script>

{#if compactMode}
  <tr
    data-pinned-self-row="true"
    data-pinned-self-row-placement={placement}
    class={rowClass()}
    style={rowStyle()}
    onclick={() => goto(livePlayerRoute("/live/dps/skills", player))}
  >
    <td
      colspan={visiblePlayerColumns.length + 1}
      class={cellClass("px-3 py-1 relative z-10")}
      style="color: {customThemeColors.tableTextColor};"
    >
      <div class="flex items-center justify-between gap-3">
        <span class="flex min-w-0 items-center gap-2">
          <ClassSpecIcon
            style="width: {tableSettings.playerIconSize}px; height: {tableSettings.playerIconSize}px;"
            class="object-contain"
            {className}
            classSpecName={iconSpecName}
            alt={t("historyDetail.classIcon", "Class icon")}
          />
          <span
            class="inline-flex shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded border border-amber-300/70 bg-amber-400/15 px-0 py-0.5 text-[0.74em] font-semibold tabular-nums text-amber-100"
            style={rankWidthStyle}
          >
            {rankLabel()}
          </span>
          {#if player.abilityScore > 0 || player.seasonStrength > 0}
            <span class="tabular-nums text-muted-foreground">
              ({player.abilityScore}{player.seasonStrength > 0 ? ` - ${player.seasonStrength}` : ""})
            </span>
          {/if}
          {#if SETTINGS.live.general.state.showOceanWeaponBadge !== false}
            <OceanWeaponBadge
              weapon={player.oceanWeapon}
              size={scaledBadgeSize(
                Math.max(25, Math.round(tableSettings.playerIconSize * 1.3)),
                SETTINGS.live.general.state.oceanWeaponBadgeScale,
              )}
            />
          {/if}
          <span class="truncate font-medium">{displayName || `#${player.uid}`}</span>
          {#if player.forbiddenHit}
            <ChallengeWarningIcon ids={player.forbiddenHitIds} />
          {/if}
          {#if player.classSpecName || player.className}
            <span class="text-muted-foreground truncate">
              {formatClassSpecLabel(player.className, player.classSpecName)}
            </span>
          {/if}
        </span>
        <span class="flex shrink-0 items-baseline gap-2 tabular-nums">
          <span class="font-semibold">
            {#if SETTINGS.live.general.state.shortenDps}
              <AbbreviatedNumber
                num={player.totalDmg}
                decimalPlaces={abbreviatedDecimalPlaces}
                suffixFontSize={tableSettings.abbreviatedFontSize}
                suffixColor={customThemeColors.tableAbbreviatedColor}
              />
            {:else}
              {player.totalDmg.toLocaleString()}
            {/if}
          </span>
          <span class="text-muted-foreground">
            {#if SETTINGS.live.general.state.shortenDps}
              <AbbreviatedNumber
                num={compactDpsKey === "tdps" ? player.tdps : player.dps}
                decimalPlaces={abbreviatedDecimalPlaces}
                suffixFontSize={tableSettings.abbreviatedFontSize}
                suffixColor={customThemeColors.tableAbbreviatedColor}
              />
            {:else}
              {Math.round(compactDpsKey === "tdps" ? player.tdps : player.dps).toLocaleString()}
            {/if}
          </span>
          <PercentFormat
            val={player.dmgPct}
            fractionDigits={0}
            suffixFontSize={tableSettings.abbreviatedFontSize}
            suffixColor={customThemeColors.tableAbbreviatedColor}
          />
        </span>
      </div>
    </td>
    {#if placement !== "bottom"}
      <TableRowGlow
        {className}
        classSpecName={player.classSpecName}
        percentage={rowGlowPercentage()}
      />
    {/if}
  </tr>
{:else}
  <tr
    data-pinned-self-row="true"
    data-pinned-self-row-placement={placement}
    class={rowClass()}
    style={rowStyle()}
    onclick={() => goto(livePlayerRoute("/live/dps/skills", player))}
  >
    <td class={cellClass("px-3 py-1 relative z-10")}>
      <div class="flex items-center h-full gap-2">
        <ClassSpecIcon
          style="width: {tableSettings.playerIconSize}px; height: {tableSettings.playerIconSize}px;"
          class="object-contain"
          {className}
          classSpecName={iconSpecName}
          alt={t("historyDetail.classIcon", "Class icon")}
          tooltipText={formatClassSpecLabel(player.className, player.classSpecName) ||
            t("historyDetail.unknownClass", "Unknown Class")}
        />
        <span
          class="inline-flex shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded border border-amber-300/70 bg-amber-400/15 px-0 py-0.5 text-[0.74em] font-semibold tabular-nums text-amber-100"
          style={rankWidthStyle}
        >
          {rankLabel()}
        </span>
        {#if (player.abilityScore > 0 && SETTINGS.live.general.state.showYourAbilityScore) || (player.seasonStrength > 0 && SETTINGS.live.general.state.showYourSeasonStrength)}
          <span
            class="inline-flex items-center gap-1 tabular-nums whitespace-nowrap"
            style="color: {customThemeColors.tableTextColor};"
          >
            {#if player.abilityScore > 0 && SETTINGS.live.general.state.showYourAbilityScore}
              {#if SETTINGS.live.general.state.shortenAbilityScore}
                <AbbreviatedNumber
                  num={player.abilityScore}
                  suffixFontSize={tableSettings.abbreviatedFontSize}
                  suffixColor={customThemeColors.tableAbbreviatedColor}
                />
              {:else}
                <span>{player.abilityScore}</span>
              {/if}
            {/if}
            {#if player.seasonStrength > 0 && SETTINGS.live.general.state.showYourSeasonStrength}
              <span
                class="tabular-nums"
                style="color: {customThemeColors.tableTextColor};"
                >({player.seasonStrength})</span
              >
            {/if}
          </span>
        {/if}
        {#if SETTINGS.live.general.state.showOceanWeaponBadge !== false}
          <OceanWeaponBadge
            weapon={player.oceanWeapon}
            size={scaledBadgeSize(
              Math.max(20, Math.round(tableSettings.playerIconSize * 1.05)),
              SETTINGS.live.general.state.oceanWeaponBadgeScale,
            )}
          />
        {/if}
        <span
          class="truncate font-medium"
          style="color: {customThemeColors.tableTextColor};"
          >{displayName || `#${player.uid}`}</span
        >
        {#if player.forbiddenHit}
          <ChallengeWarningIcon ids={player.forbiddenHitIds} />
        {/if}
      </div>
    </td>
    {#each visiblePlayerColumns as col (col.key)}
      <td
        class={cellClass("px-3 py-1 text-right relative z-10 tabular-nums font-medium")}
        style="color: {customThemeColors.tableTextColor};"
      >
        {#if col.key === "totalDmg" || col.key === "effectiveTotal"}
          {#if SETTINGS.live.general.state.shortenDps}
            <AbbreviatedNumber
              num={col.key === "totalDmg" ? player.totalDmg : player.effectiveTotal}
              decimalPlaces={abbreviatedDecimalPlaces}
              suffixFontSize={tableSettings.abbreviatedFontSize}
              suffixColor={customThemeColors.tableAbbreviatedColor}
            />
          {:else}
            {(col.key === "totalDmg" ? player.totalDmg : player.effectiveTotal).toLocaleString()}
          {/if}
        {:else if col.key === "bossDmg"}
          {#if SETTINGS.live.general.state.shortenDps}
            <AbbreviatedNumber
              num={player.bossDmg}
              decimalPlaces={abbreviatedDecimalPlaces}
              suffixFontSize={tableSettings.abbreviatedFontSize}
              suffixColor={customThemeColors.tableAbbreviatedColor}
            />
          {:else}
            {player.bossDmg.toLocaleString()}
          {/if}
        {:else if col.key === "bossDps"}
          {#if SETTINGS.live.general.state.shortenDps}
            <AbbreviatedNumber
              num={player.bossDps}
              decimalPlaces={abbreviatedDecimalPlaces}
              suffixFontSize={tableSettings.abbreviatedFontSize}
              suffixColor={customThemeColors.tableAbbreviatedColor}
            />
          {:else}
            {Math.round(player.bossDps).toLocaleString()}
          {/if}
        {:else if col.key === "trueBossDps"}
          {#if SETTINGS.live.general.state.shortenDps}
            <AbbreviatedNumber
              num={player.trueBossDps}
              decimalPlaces={abbreviatedDecimalPlaces}
              suffixFontSize={tableSettings.abbreviatedFontSize}
              suffixColor={customThemeColors.tableAbbreviatedColor}
            />
          {:else}
            {Math.round(player.trueBossDps).toLocaleString()}
          {/if}
        {:else if col.key === "dps" || col.key === "effectiveDps"}
          {#if SETTINGS.live.general.state.shortenDps}
            <AbbreviatedNumber
              num={col.key === "dps" ? player.dps : player.effectiveDps}
              decimalPlaces={abbreviatedDecimalPlaces}
              suffixFontSize={tableSettings.abbreviatedFontSize}
              suffixColor={customThemeColors.tableAbbreviatedColor}
            />
          {:else}
            {Math.round(col.key === "dps" ? player.dps : player.effectiveDps).toLocaleString()}
          {/if}
        {:else if col.key === "tdps"}
          {#if SETTINGS.live.general.state.shortenDps}
            <AbbreviatedNumber
              num={player.tdps}
              decimalPlaces={abbreviatedDecimalPlaces}
              suffixFontSize={tableSettings.abbreviatedFontSize}
              suffixColor={customThemeColors.tableAbbreviatedColor}
            />
          {:else}
            {Math.round(player.tdps).toLocaleString()}
          {/if}
        {:else if col.key === "dmgPct"}
          <PercentFormat
            val={player.dmgPct}
            fractionDigits={0}
            suffixFontSize={tableSettings.abbreviatedFontSize}
            suffixColor={customThemeColors.tableAbbreviatedColor}
          />
        {:else if col.key === "critRate" || col.key === "critDmgRate" || col.key === "luckyRate" || col.key === "luckyDmgRate"}
          <PercentFormat
            val={player[col.key]}
            suffixFontSize={tableSettings.abbreviatedFontSize}
            suffixColor={customThemeColors.tableAbbreviatedColor}
          />
        {:else}
          {col.format(player[col.key as keyof typeof player] as number ?? 0)}
        {/if}
      </td>
    {/each}
    {#if placement !== "bottom"}
      <TableRowGlow
        {className}
        classSpecName={player.classSpecName}
        percentage={rowGlowPercentage()}
      />
    {/if}
  </tr>
{/if}
