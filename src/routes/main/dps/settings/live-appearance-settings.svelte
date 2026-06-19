<script lang="ts">
  import { uiT } from "$lib/i18n";
  import { SETTINGS } from "$lib/settings-store";
  import { setClickthrough } from "$lib/utils.svelte";
  import ChevronDown from "virtual:icons/lucide/chevron-down";
  import HeaderLayoutEditor from "./header-layout-editor.svelte";
  import SettingsColor from "./settings-color.svelte";
  import SettingsInput from "./settings-input.svelte";
  import SettingsSelect from "./settings-select.svelte";
  import SettingsSlider from "./settings-slider.svelte";
  import SettingsSwitch from "./settings-switch.svelte";

  type Preset = {
    name: string;
    description: string;
    table: Record<string, number | string | boolean>;
    header: Record<string, number | boolean>;
  };

  const t = uiT("dps/themes", () => SETTINGS.live.general.state.language);
  const liveT = uiT("dps/settings-live", () => SETTINGS.live.general.state.language);

  const SIZE_PRESETS: Record<string, Preset> = {
    compact: {
      name: "Minimal",
      description: "Minimal: no padding, no header",
      table: {
        playerRowHeight: 20,
        playerFontSize: 10,
        playerIconSize: 14,
        showTableHeader: false,
        tableHeaderHeight: 18,
        tableHeaderFontSize: 8,
        abbreviatedFontSize: 7,
        skillRowHeight: 18,
        skillFontSize: 9,
        skillIconSize: 12,
        skillShowHeader: false,
        skillHeaderHeight: 16,
        skillHeaderFontSize: 7,
        skillAbbreviatedFontSize: 6,
        rowGlowMode: "gradient-underline",
        skillRowGlowMode: "gradient-underline",
        rowGlowOpacity: 0.5,
        skillRowGlowOpacity: 0.5,
        rowBorderRadius: 0,
        skillRowBorderRadius: 0,
      },
      header: {
        windowPadding: 0,
        headerPadding: 0,
        showTimer: false,
        showActiveTimer: false,
        showSceneName: false,
        showResetButton: false,
        showPauseButton: false,
        showBossOnlyButton: false,
        showSettingsButton: false,
        showMinimizeButton: false,
        showTotalDamage: false,
        showTotalDps: false,
        showBossHealth: false,
        showNavigationTabs: false,
        timerLabelFontSize: 9,
        timerFontSize: 12,
        activeTimerFontSize: 12,
        sceneNameFontSize: 10,
        resetButtonSize: 14,
        resetButtonPadding: 4,
        pauseButtonSize: 14,
        pauseButtonPadding: 4,
        bossOnlyButtonSize: 14,
        bossOnlyButtonPadding: 4,
        settingsButtonSize: 14,
        settingsButtonPadding: 4,
        minimizeButtonSize: 14,
        minimizeButtonPadding: 4,
        totalDamageLabelFontSize: 9,
        totalDamageValueFontSize: 12,
        totalDpsLabelFontSize: 9,
        totalDpsValueFontSize: 12,
        bossHealthLabelFontSize: 9,
        bossHealthNameFontSize: 10,
        bossHealthValueFontSize: 10,
        bossHealthPercentFontSize: 10,
        navTabFontSize: 8,
        navTabPaddingX: 6,
        navTabPaddingY: 3,
      },
    },
    small: {
      name: "Small",
      description: "Compact layout that shows more rows",
      table: {
        playerRowHeight: 22,
        playerFontSize: 11,
        playerIconSize: 16,
        showTableHeader: true,
        tableHeaderHeight: 20,
        tableHeaderFontSize: 9,
        abbreviatedFontSize: 8,
        skillRowHeight: 20,
        skillFontSize: 10,
        skillIconSize: 14,
        skillShowHeader: true,
        skillHeaderHeight: 18,
        skillHeaderFontSize: 8,
        skillAbbreviatedFontSize: 7,
        rowGlowMode: "gradient-underline",
        skillRowGlowMode: "gradient-underline",
        rowGlowOpacity: 0.5,
        skillRowGlowOpacity: 0.5,
        rowBorderRadius: 0,
        skillRowBorderRadius: 0,
      },
      header: {
        windowPadding: 0,
        headerPadding: 6,
        showTimer: true,
        showActiveTimer: false,
        showSceneName: true,
        showResetButton: true,
        showPauseButton: true,
        showBossOnlyButton: false,
        showSettingsButton: false,
        showMinimizeButton: false,
        showTotalDamage: false,
        showTotalDps: false,
        showBossHealth: false,
        showNavigationTabs: false,
        timerLabelFontSize: 10,
        timerFontSize: 14,
        activeTimerFontSize: 14,
        sceneNameFontSize: 11,
        resetButtonSize: 16,
        resetButtonPadding: 6,
        pauseButtonSize: 16,
        pauseButtonPadding: 6,
        bossOnlyButtonSize: 16,
        bossOnlyButtonPadding: 6,
        settingsButtonSize: 16,
        settingsButtonPadding: 6,
        minimizeButtonSize: 16,
        minimizeButtonPadding: 6,
        totalDamageLabelFontSize: 10,
        totalDamageValueFontSize: 14,
        totalDpsLabelFontSize: 10,
        totalDpsValueFontSize: 14,
        bossHealthLabelFontSize: 10,
        bossHealthNameFontSize: 11,
        bossHealthValueFontSize: 11,
        bossHealthPercentFontSize: 11,
        navTabFontSize: 9,
        navTabPaddingX: 8,
        navTabPaddingY: 4,
      },
    },
    medium: {
      name: "Medium",
      description: "Balanced size for most screens",
      table: {
        playerRowHeight: 28,
        playerFontSize: 13,
        playerIconSize: 20,
        showTableHeader: true,
        tableHeaderHeight: 24,
        tableHeaderFontSize: 11,
        abbreviatedFontSize: 10,
        skillRowHeight: 24,
        skillFontSize: 12,
        skillIconSize: 18,
        skillShowHeader: true,
        skillHeaderHeight: 22,
        skillHeaderFontSize: 10,
        skillAbbreviatedFontSize: 9,
        rowGlowMode: "gradient-underline",
        skillRowGlowMode: "gradient-underline",
        rowGlowOpacity: 0.5,
        skillRowGlowOpacity: 0.5,
        rowBorderRadius: 0,
        skillRowBorderRadius: 0,
      },
      header: {
        windowPadding: 12,
        headerPadding: 8,
        showTimer: true,
        showActiveTimer: false,
        showSceneName: true,
        showResetButton: true,
        showPauseButton: true,
        showBossOnlyButton: true,
        showSettingsButton: true,
        showMinimizeButton: true,
        showTotalDamage: true,
        showTotalDps: true,
        showBossHealth: true,
        showNavigationTabs: true,
        timerLabelFontSize: 12,
        timerFontSize: 18,
        activeTimerFontSize: 18,
        sceneNameFontSize: 14,
        resetButtonSize: 20,
        resetButtonPadding: 8,
        pauseButtonSize: 20,
        pauseButtonPadding: 8,
        bossOnlyButtonSize: 20,
        bossOnlyButtonPadding: 8,
        settingsButtonSize: 20,
        settingsButtonPadding: 8,
        minimizeButtonSize: 20,
        minimizeButtonPadding: 8,
        totalDamageLabelFontSize: 14,
        totalDamageValueFontSize: 18,
        totalDpsLabelFontSize: 14,
        totalDpsValueFontSize: 18,
        bossHealthLabelFontSize: 12,
        bossHealthNameFontSize: 14,
        bossHealthValueFontSize: 14,
        bossHealthPercentFontSize: 14,
        navTabFontSize: 11,
        navTabPaddingX: 12,
        navTabPaddingY: 6,
      },
    },
    large: {
      name: "Large",
      description: "Larger UI for high-resolution screens",
      table: {
        playerRowHeight: 36,
        playerFontSize: 16,
        playerIconSize: 26,
        showTableHeader: true,
        tableHeaderHeight: 30,
        tableHeaderFontSize: 13,
        abbreviatedFontSize: 12,
        skillRowHeight: 30,
        skillFontSize: 14,
        skillIconSize: 22,
        skillShowHeader: true,
        skillHeaderHeight: 26,
        skillHeaderFontSize: 12,
        skillAbbreviatedFontSize: 11,
        rowGlowMode: "gradient-underline",
        skillRowGlowMode: "gradient-underline",
        rowGlowOpacity: 0.5,
        skillRowGlowOpacity: 0.5,
        rowBorderRadius: 0,
        skillRowBorderRadius: 0,
      },
      header: {
        windowPadding: 16,
        headerPadding: 12,
        showTimer: true,
        showActiveTimer: false,
        showSceneName: true,
        showResetButton: true,
        showPauseButton: true,
        showBossOnlyButton: true,
        showSettingsButton: true,
        showMinimizeButton: true,
        showTotalDamage: true,
        showTotalDps: true,
        showBossHealth: true,
        showNavigationTabs: true,
        timerLabelFontSize: 14,
        timerFontSize: 24,
        activeTimerFontSize: 24,
        sceneNameFontSize: 18,
        resetButtonSize: 26,
        resetButtonPadding: 10,
        pauseButtonSize: 26,
        pauseButtonPadding: 10,
        bossOnlyButtonSize: 26,
        bossOnlyButtonPadding: 10,
        settingsButtonSize: 26,
        settingsButtonPadding: 10,
        minimizeButtonSize: 26,
        minimizeButtonPadding: 10,
        totalDamageLabelFontSize: 16,
        totalDamageValueFontSize: 24,
        totalDpsLabelFontSize: 16,
        totalDpsValueFontSize: 24,
        bossHealthLabelFontSize: 14,
        bossHealthNameFontSize: 18,
        bossHealthValueFontSize: 18,
        bossHealthPercentFontSize: 18,
        navTabFontSize: 13,
        navTabPaddingX: 16,
        navTabPaddingY: 8,
      },
    },
  };

  let expandedSections = $state({
    liveDisplay: false,
    headerSettings: false,
    playerTableSettings: false,
    skillTableSettings: false,
    sizePresets: false,
  });

  $effect(() => {
    void setClickthrough(SETTINGS.accessibility.state.clickthrough);
  });

  function toggleSection(section: keyof typeof expandedSections) {
    expandedSections[section] = !expandedSections[section];
  }

  function applySizePreset(presetKey: string) {
    const preset = SIZE_PRESETS[presetKey];
    if (!preset) return;

    const tableState = SETTINGS.live.tableCustomization.state as Record<string, unknown>;
    const headerState = SETTINGS.live.headerCustomization.state as Record<string, unknown>;

    for (const [key, value] of Object.entries(preset.table)) {
      tableState[key] = value;
    }

    for (const [key, value] of Object.entries(preset.header)) {
      headerState[key] = value;
    }
  }
</script>

<div
  class="rounded-lg border bg-card/40 border-border/60 overflow-hidden shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
>
  <button
    type="button"
    class="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
    onclick={() => toggleSection("liveDisplay")}
  >
    <h2 class="text-base font-semibold text-foreground">
      {t("liveWindowDisplay.title", "Live Window Behavior")}
    </h2>
    <ChevronDown
      class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.liveDisplay ? 'rotate-180' : ''}"
    />
  </button>
  {#if expandedSections.liveDisplay}
    <div class="px-4 pb-4 space-y-4">
      <div class="space-y-2 pt-2">
        <h3 class="text-sm font-semibold text-foreground">
          {t("liveWindowBehavior.interaction", "Window Interaction")}
        </h3>
        <SettingsSwitch
          bind:checked={SETTINGS.accessibility.state.clickthrough}
          label={t("liveWindowDisplay.clickthroughMode", "Clickthrough Mode")}
          description={SETTINGS.accessibility.state.clickthrough
            ? t("liveWindowDisplay.clickthroughEnabledDescription", "Clickthrough Enabled - Mouse clicks pass through window")
            : t("liveWindowDisplay.clickthroughMode.description", "Enable Clickthrough Mode")}
        />
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">
          {t("liveWindowBehavior.autoHide", "Auto-hide")}
        </h3>
        <SettingsSwitch
          bind:checked={SETTINGS.live.general.state.autoHideLiveWindow}
          label={liveT("autoHideLiveWindow", "Auto-hide Live Window")}
          description={liveT("autoHideLiveWindowDescription", "Hide the live meter after the delay when no new damage is detected, then show it automatically as soon as damage appears.")}
        />
        <SettingsSwitch
          bind:checked={SETTINGS.live.general.state.autoHideOverlaysWithLiveWindow}
          disabled={!SETTINGS.live.general.state.autoHideLiveWindow}
          label={liveT("autoHideOverlaysWithLiveWindow", "Auto-hide Overlays with Live Window")}
          description={liveT("autoHideOverlaysWithLiveWindowDescription", "When Auto-hide Live Window is enabled, hide any visible game or monster overlay with the live meter and restore only the overlays that were visible before auto-hide.")}
        />
        <SettingsSlider
          bind:value={SETTINGS.live.general.state.autoHideLiveWindowDelaySeconds}
          label={liveT("autoHideLiveWindowDelaySeconds", "Auto-hide Delay")}
          description={liveT("autoHideLiveWindowDelaySecondsDescription", "Seconds to wait after no new damage is detected before hiding the live meter. Set to 0 to hide immediately.")}
          min={0}
          max={60}
          step={1}
          unit={liveT("secondsUnit", "s")}
        />
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">
          {t("liveWindowBehavior.pauseAndReset", "Pause & Reset")}
        </h3>
        <SettingsSwitch
          bind:checked={SETTINGS.live.general.state.idleDisplayPauseEnabled}
          label={liveT("idleDisplayPauseEnabled", "Pause DPS after No Live Changes")}
          description={liveT("idleDisplayPauseEnabledDescription", "Freeze the live DPS clock when combat totals and boss data stop changing. It resumes automatically when new combat or objective data arrives.")}
        />
        <SettingsSlider
          bind:value={SETTINGS.live.general.state.idleDisplayPauseDelaySeconds}
          disabled={!SETTINGS.live.general.state.idleDisplayPauseEnabled}
          label={liveT("idleDisplayPauseDelaySeconds", "No-change Pause Delay")}
          description={liveT("idleDisplayPauseDelaySecondsDescription", "Seconds to wait without live combat changes before freezing DPS.")}
          min={1}
          max={30}
          step={1}
          unit={liveT("secondsUnit", "s")}
        />
        <SettingsSwitch
          bind:checked={SETTINGS.live.general.state.autoClearOnSceneChange}
          label={liveT("autoClearOnSceneChange", "Clear Meter on Scene Change")}
          description={liveT("autoClearOnSceneChangeDescription", "Automatically save and clear the current meter when the game changes scene or server. Turn this off to keep the finished meter visible after scene changes; the next combat starts a new meter automatically.")}
        />
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">
          {t("liveWindowBehavior.performance", "Performance")}
        </h3>
        <SettingsSlider
          bind:value={SETTINGS.live.general.state.eventUpdateRateMs}
          label={liveT("refreshRate", "Refresh Rate")}
          description={liveT("refreshRateDescription", "Live stats refresh interval (50-2000ms). Lower is smoother but uses more CPU.")}
          min={50}
          max={2000}
          step={50}
          unit="ms"
        />
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">
          {t("liveWindowBehavior.dynamicHeight", "Dynamic Height")}
        </h3>
        <SettingsSwitch
          bind:checked={SETTINGS.live.dynamicWindow.state.enabled}
          label={t("dynamicLiveWindow.enabled", "Enable dynamic height")}
          description={SETTINGS.live.dynamicWindow.state.enabled
            ? t("dynamicLiveWindow.enabledDescription", "The live window grows to fit player rows. After the max visible player count, the player table becomes scrollable.")
            : t("dynamicLiveWindow.disabledDescription", "Keep the live window at its manually resized height.")}
        />
        <SettingsSlider
          bind:value={SETTINGS.live.dynamicWindow.state.maxPlayerRows}
          label={t("dynamicLiveWindow.maxPlayerRows", "Max visible players")}
          description={t("dynamicLiveWindow.maxPlayerRows.description", "Number of player rows shown before the player table becomes scrollable.")}
          min={5}
          max={20}
          step={1}
          unit={` ${t("dynamicLiveWindow.playersUnit", "players")}`}
        />
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">
          {t("liveWindowBehavior.playerRows", "Player Rows")}
        </h3>
        <SettingsSwitch
          bind:checked={SETTINGS.live.general.state.alwaysShowYourDpsRow}
          label={liveT("alwaysShowYourDpsRow", "Always show your DPS row")}
          description={liveT("alwaysShowYourDpsRowDescription", "When your row falls outside the visible live DPS list, show a copy of it with your true rank. The pinned row hides battle imagine badges but keeps the ocean weapon badge.")}
        />
        {#if SETTINGS.live.general.state.alwaysShowYourDpsRow}
          <SettingsSelect
            bind:selected={SETTINGS.live.general.state.alwaysShowYourDpsRowPlacement}
            label={liveT("alwaysShowYourDpsRowPlacement", "Pinned row position")}
            description={liveT("alwaysShowYourDpsRowPlacementDescription", "Choose where your copied row appears when it is inside the visible player list.")}
            values={[
              { label: liveT("alwaysShowYourDpsRowPlacementBottom", "Bottom of visible list"), value: "bottom" },
              { label: liveT("alwaysShowYourDpsRowPlacementTop", "Top of visible list"), value: "top" },
            ]}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.live.general.state.pinYourDpsRowAboveHeader}
            label={liveT("pinYourDpsRowAboveHeader", "Pin your DPS row above the header")}
            description={liveT("pinYourDpsRowAboveHeaderDescription", "Show your copied row above the player table header instead of inside the visible player list.")}
          />
        {/if}
      </div>
    </div>
  {/if}
</div>

<div
  class="rounded-lg border bg-card/40 border-border/60 overflow-hidden shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
>
  <button
    type="button"
    class="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
    onclick={() => toggleSection("headerSettings")}
  >
    <h2 class="text-base font-semibold text-foreground">
      {t("common.headerSettings", "Header Settings")}
    </h2>
    <ChevronDown
      class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.headerSettings ? 'rotate-180' : ''}"
    />
  </button>
  {#if expandedSections.headerSettings}
    <div class="px-4 pb-4 space-y-4">
      <div class="space-y-2 pt-2">
        <h3 class="text-sm font-semibold text-foreground">{t("liveHeader.layoutPadding", "Layout & Padding")}</h3>
        <SettingsSlider
          bind:value={SETTINGS.live.headerCustomization.state.windowPadding}
          min={0}
          max={24}
          step={1}
          label={t("liveHeader.windowPadding", "Window Padding")}
          description={t("liveHeader.windowPadding.description", "Overall live window padding")}
          unit="px"
        />
        <SettingsSlider
          bind:value={SETTINGS.live.headerCustomization.state.headerPadding}
          min={0}
          max={16}
          step={1}
          label={t("liveHeader.headerPadding", "Header Padding")}
          description={t("liveHeader.headerPadding.description", "Inner spacing inside the header area")}
          unit="px"
        />
      </div>

      <div class="space-y-3 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">{t("liveHeader.headerLayout", "Title Bar Layout")}</h3>
        <SettingsSelect
          bind:selected={SETTINGS.live.headerCustomization.state.headerLayoutMode}
          label={t("liveHeader.headerLayoutMode", "Layout Mode")}
          description={t("liveHeader.headerLayoutMode.description", "Classic keeps the current two-row layout. Free layout lets you arrange title bar components across rows.")}
          values={[
            { label: t("liveHeader.headerLayoutMode.classic", "Classic Layout"), value: "classic" },
            { label: t("liveHeader.headerLayoutMode.custom", "Free Layout"), value: "custom" },
          ]}
        />
        {#if SETTINGS.live.headerCustomization.state.headerLayoutMode === "custom"}
          <HeaderLayoutEditor bind:layout={SETTINGS.live.headerCustomization.state.headerCustomLayout} />
        {/if}
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">{t("liveHeader.timer", "Timer")}</h3>
        <SettingsSwitch
          bind:checked={SETTINGS.live.headerCustomization.state.showTimer}
          label={t("liveHeader.showTimer", "Show Timer")}
          description={t("liveHeader.showTimer.description", "Show encounter timer")}
        />
        {#if SETTINGS.live.headerCustomization.state.showTimer}
          <SettingsSwitch
            bind:checked={SETTINGS.live.headerCustomization.state.showActiveTimer}
            label={t("liveHeader.showActiveCombatTime", "Show Active Combat Time")}
            description={t("liveHeader.showActiveCombatTime.description", "Show global active combat time next to the main timer for true DPS")}
          />
          <SettingsSlider
            bind:value={SETTINGS.live.headerCustomization.state.timerLabelFontSize}
            min={0}
            max={20}
            step={1}
            label={t("common.labelFontSize", "Label Font Size")}
            description={t("liveHeader.timerLabelFontSize.description", "\"Timer\" label font size (0 = hidden)")}
            unit="px"
          />
          <SettingsSlider
            bind:value={SETTINGS.live.headerCustomization.state.timerFontSize}
            min={10}
            max={32}
            step={1}
            label={t("liveHeader.timerFontSize", "Timer Font Size")}
            description={t("liveHeader.timerFontSize.description", "Timer value font size")}
            unit="px"
          />
          {#if SETTINGS.live.headerCustomization.state.showActiveTimer}
            <SettingsSlider
              bind:value={SETTINGS.live.headerCustomization.state.activeTimerFontSize}
              min={10}
              max={32}
              step={1}
              label={t("liveHeader.activeTimeFontSize", "Active Time Font Size")}
              description={t("liveHeader.activeTimeFontSize.description", "Active combat time value font size")}
              unit="px"
            />
          {/if}
        {/if}
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">{t("liveHeader.showSceneName", "Scene Name")}</h3>
        <SettingsSwitch
          bind:checked={SETTINGS.live.headerCustomization.state.showSceneName}
          label={t("liveHeader.showSceneName", "Show Scene Name")}
          description={t("liveHeader.showSceneName.description", "Show current dungeon / scene name")}
        />
        {#if SETTINGS.live.headerCustomization.state.showSceneName}
          <SettingsSlider
            bind:value={SETTINGS.live.headerCustomization.state.sceneNameFontSize}
            min={10}
            max={24}
            step={1}
            label={t("liveHeader.sceneNameFontSize", "Scene Name Font Size")}
            description={t("liveHeader.sceneNameFontSize.description", "Scene name font size")}
            unit="px"
          />
        {/if}
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">{t("liveHeader.controlButtons", "Control Buttons")}</h3>

        <SettingsSwitch
          bind:checked={SETTINGS.live.headerCustomization.state.showResetButton}
          label={t("liveHeader.showResetButton", "Show Reset Button")}
          description={t("liveHeader.showResetButton.description", "Button used to reset the encounter")}
        />
        {#if SETTINGS.live.headerCustomization.state.showResetButton}
          <div class="grid grid-cols-2 gap-2 pl-4">
            <SettingsSlider bind:value={SETTINGS.live.headerCustomization.state.resetButtonSize} min={12} max={32} step={1} label={t("common.iconSize", "Icon Size")} unit="px" />
            <SettingsSlider bind:value={SETTINGS.live.headerCustomization.state.resetButtonPadding} min={2} max={16} step={1} label={t("common.padding", "Padding")} unit="px" />
          </div>
        {/if}

        <SettingsSwitch
          bind:checked={SETTINGS.live.headerCustomization.state.showPauseButton}
          label={t("liveHeader.showPauseButton", "Show Pause Button")}
          description={t("liveHeader.showPauseButton.description", "Button used to pause / resume the encounter")}
        />
        {#if SETTINGS.live.headerCustomization.state.showPauseButton}
          <div class="grid grid-cols-2 gap-2 pl-4">
            <SettingsSlider bind:value={SETTINGS.live.headerCustomization.state.pauseButtonSize} min={12} max={32} step={1} label={t("common.iconSize", "Icon Size")} unit="px" />
            <SettingsSlider bind:value={SETTINGS.live.headerCustomization.state.pauseButtonPadding} min={2} max={16} step={1} label={t("common.padding", "Padding")} unit="px" />
          </div>
        {/if}

        <SettingsSwitch
          bind:checked={SETTINGS.live.headerCustomization.state.showSettingsButton}
          label={t("liveHeader.showSettingsButton", "Show Settings Button")}
          description={t("liveHeader.showSettingsButton.description", "Button used to open the settings window")}
        />
        {#if SETTINGS.live.headerCustomization.state.showSettingsButton}
          <div class="grid grid-cols-2 gap-2 pl-4">
            <SettingsSlider bind:value={SETTINGS.live.headerCustomization.state.settingsButtonSize} min={12} max={32} step={1} label={t("common.iconSize", "Icon Size")} unit="px" />
            <SettingsSlider bind:value={SETTINGS.live.headerCustomization.state.settingsButtonPadding} min={2} max={16} step={1} label={t("common.padding", "Padding")} unit="px" />
          </div>
        {/if}

        <SettingsSwitch
          bind:checked={SETTINGS.live.headerCustomization.state.showMinimizeButton}
          label={t("liveHeader.showMinimizeButton", "Show Minimize Button")}
          description={t("liveHeader.showMinimizeButton.description", "Button used to minimize the live window")}
        />
        {#if SETTINGS.live.headerCustomization.state.showMinimizeButton}
          <div class="grid grid-cols-2 gap-2 pl-4">
            <SettingsSlider bind:value={SETTINGS.live.headerCustomization.state.minimizeButtonSize} min={12} max={32} step={1} label={t("common.iconSize", "Icon Size")} unit="px" />
            <SettingsSlider bind:value={SETTINGS.live.headerCustomization.state.minimizeButtonPadding} min={2} max={16} step={1} label={t("common.padding", "Padding")} unit="px" />
          </div>
        {/if}
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">{t("liveHeader.showTotalDamage", "Total Damage")}</h3>
        <SettingsSwitch
          bind:checked={SETTINGS.live.headerCustomization.state.showTotalDamage}
          label={t("liveHeader.showTotalDamage", "Show Total Damage")}
          description={t("liveHeader.showTotalDamage.description", "Show total damage dealt")}
        />
        {#if SETTINGS.live.headerCustomization.state.showTotalDamage}
          <SettingsInput
            bind:value={SETTINGS.live.headerCustomization.state.totalDamageLabelAlias}
            label={t("liveHeader.totalDamageLabelAlias", "Label Alias")}
            description={t("liveHeader.totalDamageLabelAlias.description", "Rename the total damage label. Leave blank to use T.DMG.")}
            placeholder="T.DMG"
          />
          <SettingsSlider
            bind:value={SETTINGS.live.headerCustomization.state.totalDamageLabelFontSize}
            min={8}
            max={20}
            step={1}
            label={t("common.labelFontSize", "Label Font Size")}
            description={t("liveHeader.totalDamageLabelFontSize.description", "\"T.DMG\" label font size")}
            unit="px"
          />
          <SettingsSlider
            bind:value={SETTINGS.live.headerCustomization.state.totalDamageValueFontSize}
            min={10}
            max={32}
            step={1}
            label={t("common.valueFontSize", "Value Font Size")}
            description={t("liveHeader.totalDamageValueFontSize.description", "Damage value font size")}
            unit="px"
          />
        {/if}
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">{t("liveHeader.showTotalDps", "Total DPS")}</h3>
        <SettingsSwitch
          bind:checked={SETTINGS.live.headerCustomization.state.showTotalDps}
          label={t("liveHeader.showTotalDps", "Show Total DPS")}
          description={t("liveHeader.showTotalDps.description", "Show total damage per second")}
        />
        {#if SETTINGS.live.headerCustomization.state.showTotalDps}
          <SettingsInput
            bind:value={SETTINGS.live.headerCustomization.state.totalDpsLabelAlias}
            label={t("liveHeader.totalDpsLabelAlias", "Label Alias")}
            description={t("liveHeader.totalDpsLabelAlias.description", "Rename the total DPS label. Leave blank to use T.DPS.")}
            placeholder="T.DPS"
          />
          <SettingsSlider
            bind:value={SETTINGS.live.headerCustomization.state.totalDpsLabelFontSize}
            min={8}
            max={20}
            step={1}
            label={t("common.labelFontSize", "Label Font Size")}
            description={t("liveHeader.totalDpsLabelFontSize.description", "\"T.DPS\" label font size")}
            unit="px"
          />
          <SettingsSlider
            bind:value={SETTINGS.live.headerCustomization.state.totalDpsValueFontSize}
            min={10}
            max={32}
            step={1}
            label={t("common.valueFontSize", "Value Font Size")}
            description={t("liveHeader.totalDpsValueFontSize.description", "DPS value font size")}
            unit="px"
          />
        {/if}
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">{t("liveHeader.abbreviatedNumbers", "Abbreviated Numbers")}</h3>
        <SettingsSlider
          bind:value={SETTINGS.live.headerCustomization.state.headerAbbreviatedFontSize}
          min={6}
          max={22}
          step={1}
          label={t("liveHeader.abbreviatedSuffixFontSize", "Suffix Font Size")}
          description={t("liveHeader.abbreviatedSuffixFontSize.description", "Controls the K/M suffix size for live header numbers.")}
          unit="px"
        />
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">{t("liveHeader.showBossHealth", "Boss Health")}</h3>
        <SettingsSwitch
          bind:checked={SETTINGS.live.headerCustomization.state.showBossHealth}
          label={t("liveHeader.showBossHealth", "Show Boss Health")}
          description={t("liveHeader.showBossHealth.description", "Show current boss health bar")}
        />
        {#if SETTINGS.live.headerCustomization.state.showBossHealth}
          <SettingsSelect
            bind:selected={SETTINGS.live.headerCustomization.state.bossHealthLayout}
            label={t("liveHeader.bossHealthLayout", "Boss Health Direction")}
            description={t("liveHeader.bossHealthLayout.description", "Horizontal display keeps boss health on one line for custom title bar layouts.")}
            values={[
              { label: t("liveHeader.bossHealthLayout.vertical", "Vertical"), value: "vertical" },
              { label: t("liveHeader.bossHealthLayout.horizontal", "Horizontal"), value: "horizontal" },
            ]}
          />
          <SettingsSlider bind:value={SETTINGS.live.headerCustomization.state.bossHealthLabelFontSize} min={0} max={20} step={1} label={t("common.labelFontSize", "Label Font Size")} description={t("liveHeader.bossHealthLabelFontSize.description", "\"BOSS\" label font size")} unit="px" />
          <SettingsColor
            bind:value={SETTINGS.live.headerCustomization.state.noBossTextColor}
            label={t("liveHeader.noBossTextColor", "No Boss Text Color")}
            description={t("liveHeader.noBossTextColor.description", "Text color used when no boss is detected.")}
          />
          <SettingsSlider bind:value={SETTINGS.live.headerCustomization.state.bossHealthNameFontSize} min={0} max={24} step={1} label={t("liveHeader.bossNameFontSize", "Boss Name Font Size")} description={t("liveHeader.bossNameFontSize.description", "Boss name font size")} unit="px" />
          <SettingsSlider bind:value={SETTINGS.live.headerCustomization.state.bossHealthValueFontSize} min={0} max={24} step={1} label={t("liveHeader.healthValueFontSize", "Health Value Font Size")} description={t("liveHeader.healthValueFontSize.description", "Health value font size (1.5M / 3M)")} unit="px" />
          <SettingsSlider bind:value={SETTINGS.live.headerCustomization.state.bossHealthPercentFontSize} min={0} max={24} step={1} label={t("liveHeader.percentageFontSize", "Percentage Font Size")} description={t("liveHeader.percentageFontSize.description", "Health percentage font size")} unit="px" />
        {/if}
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">{t("liveHeader.showNavigationTabs", "Navigation Tabs")}</h3>
        <SettingsSwitch
          bind:checked={SETTINGS.live.headerCustomization.state.showNavigationTabs}
          label={t("liveHeader.showNavigationTabs", "Show Navigation Tabs")}
          description={t("liveHeader.showNavigationTabs.description", "Show DPS / Heal / Tanked switch buttons")}
        />
        <SettingsSwitch
          bind:checked={SETTINGS.live.headerCustomization.state.showDeathTab}
          label={t("liveHeader.showDeathTab", "Show Death Tab")}
          description={t("liveHeader.showDeathTab.description", "Add the death replay tab to the live navigation.")}
        />
        {#if SETTINGS.live.headerCustomization.state.showNavigationTabs}
          <SettingsSlider bind:value={SETTINGS.live.headerCustomization.state.navTabFontSize} min={8} max={18} step={1} label={t("common.labelFontSize", "Label Font Size")} description={t("liveHeader.navigationTabLabelFontSize.description", "Tab label font size")} unit="px" />
          <SettingsSlider bind:value={SETTINGS.live.headerCustomization.state.navTabPaddingX} min={4} max={24} step={1} label={t("liveHeader.horizontalPadding", "Horizontal Padding")} description={t("liveHeader.horizontalPadding.description", "Left and right padding for tabs")} unit="px" />
          <SettingsSlider bind:value={SETTINGS.live.headerCustomization.state.navTabPaddingY} min={2} max={16} step={1} label={t("liveHeader.verticalPadding", "Vertical Padding")} description={t("liveHeader.verticalPadding.description", "Top and bottom padding for tabs")} unit="px" />
        {/if}
      </div>
    </div>
  {/if}
</div>

<div
  class="rounded-lg border bg-card/40 border-border/60 overflow-hidden shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
>
  <button
    type="button"
    class="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
    onclick={() => toggleSection("playerTableSettings")}
  >
    <h2 class="text-base font-semibold text-foreground">
      {t("playerTableSettings.title", "Player Table Settings")}
    </h2>
    <ChevronDown
      class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.playerTableSettings ? 'rotate-180' : ''}"
    />
  </button>
  {#if expandedSections.playerTableSettings}
    <div class="px-4 pb-4 space-y-4">
      <p class="text-xs text-muted-foreground">
        {t("playerTableSettings.description", "Control row appearance and highlight mode. These settings apply to all live tables.")}
      </p>
      <div class="space-y-2">
        <h3 class="text-sm font-semibold text-foreground">{t("playerTableSettings.playerRows", "Player Rows")}</h3>
        <SettingsSwitch
          bind:checked={SETTINGS.live.tableCustomization.state.compactMode}
          label={t("playerTableSettings.compactMode", "Compact Mode")}
          description={t("playerTableSettings.compactMode.description", "Show live rows as single-line summaries with total, rate, and share.")}
        />
        {#if SETTINGS.live.tableCustomization.state.compactMode}
          <SettingsSelect
            label={t("playerTableSettings.compactDpsKey", "Compact DPS Metric")}
            description={t("playerTableSettings.compactDpsKey.description", "Choose whether compact DPS rows show DPS or true DPS.")}
            bind:selected={SETTINGS.live.tableCustomization.state.compactDpsKey}
            values={[
              { label: "DPS", value: "dps" },
              { label: "T.DPS", value: "tdps" },
            ]}
          />
        {/if}
        <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.playerRowHeight} min={0} max={100} step={1} label={t("common.rowHeight", "Row Height")} description={t("playerTableSettings.rowHeight.description", "Height of each player row (pixels)")} unit="px" />
        <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.playerFontSize} min={0} max={100} step={1} label={t("common.fontSize", "Font Size")} description={t("playerTableSettings.fontSize.description", "Font size for player names and stats")} unit="px" />
        <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.playerIconSize} min={0} max={100} step={1} label={t("common.iconSize", "Icon Size")} description={t("playerTableSettings.iconSize.description", "Class/spec icon size")} unit="px" />

        <div class="flex items-center gap-2">
          <span class="text-sm text-muted-foreground">{t("common.mode", "Mode")}</span>
          <div class="flex items-center gap-1">
            <button type="button" class="px-2 py-1 text-xs rounded {SETTINGS.live.tableCustomization.state.rowGlowMode === 'gradient-underline' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-popover/30'}" onclick={() => (SETTINGS.live.tableCustomization.state.rowGlowMode = "gradient-underline")}>{t("common.gradientUnderline", "Gradient (Underline)")}</button>
            <button type="button" class="px-2 py-1 text-xs rounded {SETTINGS.live.tableCustomization.state.rowGlowMode === 'gradient' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-popover/30'}" onclick={() => (SETTINGS.live.tableCustomization.state.rowGlowMode = "gradient")}>{t("common.gradient", "Gradient")}</button>
            <button type="button" class="px-2 py-1 text-xs rounded {SETTINGS.live.tableCustomization.state.rowGlowMode === 'solid' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-popover/30'}" onclick={() => (SETTINGS.live.tableCustomization.state.rowGlowMode = "solid")}>{t("common.solid", "Solid")}</button>
          </div>
        </div>

        <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.rowGlowOpacity} min={0} max={1} step={0.01} label={t("playerTableSettings.rowHighlightOpacity", "Row Highlight Opacity")} description={t("playerTableSettings.rowHighlightOpacity.description", "Row highlight fill opacity (0 = transparent, 1 = opaque)")} />
        <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.rowBorderRadius} min={0} max={24} step={1} label={t("playerTableSettings.rowCornerRadius", "Row Corner Radius")} description={t("playerTableSettings.rowCornerRadius.description", "Corner radius for row highlight")} unit="px" />
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">{t("common.headerSettings", "Header Settings")}</h3>
        <SettingsSwitch
          bind:checked={SETTINGS.live.tableCustomization.state.showTableHeader}
          label={t("common.showHeader", "Show Header")}
          description={t("playerTableSettings.showHeader.description", "Toggle column title visibility")}
        />
        {#if SETTINGS.live.tableCustomization.state.showTableHeader}
          <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.tableHeaderHeight} min={0} max={100} step={1} label={t("common.headerHeight", "Header Height")} description={t("playerTableSettings.headerHeight.description", "Header row height")} unit="px" />
          <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.tableHeaderFontSize} min={0} max={100} step={1} label={t("common.headerFontSize", "Header Font Size")} description={t("playerTableSettings.headerFontSize.description", "Column title font size")} unit="px" />
          <SettingsColor bind:value={SETTINGS.live.tableCustomization.state.tableHeaderTextColor} label={t("playerTableSettings.headerTextColor", "Header Text Color")} description={t("playerTableSettings.headerTextColor.description", "Column title text color")} />
        {/if}
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">{t("playerTableSettings.suffixFontSize", "Suffix Font Size")}</h3>
        <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.abbreviatedFontSize} min={0} max={100} step={1} label={t("playerTableSettings.suffixFontSize", "Suffix Font Size")} description={t("playerTableSettings.suffixFontSize.description", "Font size for K/M/% suffixes")} unit="px" />
      </div>
    </div>
  {/if}
</div>

<div
  class="rounded-lg border bg-card/40 border-border/60 overflow-hidden shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
>
  <button
    type="button"
    class="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
    onclick={() => toggleSection("skillTableSettings")}
  >
    <h2 class="text-base font-semibold text-foreground">
      {t("skillTableSettings.title", "Skill Table Settings")}
    </h2>
    <ChevronDown
      class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.skillTableSettings ? 'rotate-180' : ''}"
    />
  </button>
  {#if expandedSections.skillTableSettings}
    <div class="px-4 pb-4 space-y-4">
      <p class="text-xs text-muted-foreground">
        {t("skillTableSettings.description", "Customize size, headers, and abbreviated-number styling for the skill table.")}
      </p>

      <div class="space-y-2">
        <h3 class="text-sm font-semibold text-foreground">{t("skillTableSettings.skillRows", "Skill Rows")}</h3>
        <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.skillRowHeight} min={0} max={100} step={1} label={t("skillTableSettings.skillRowHeight", "Skill Row Height")} description={t("skillTableSettings.skillRowHeight.description", "Height of each skill row (pixels)")} unit="px" />
        <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.skillFontSize} min={0} max={100} step={1} label={t("skillTableSettings.skillFontSize", "Skill Font Size")} description={t("skillTableSettings.skillFontSize.description", "Font size for skill names and stats")} unit="px" />
        <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.skillIconSize} min={0} max={100} step={1} label={t("skillTableSettings.skillIconSize", "Skill Icon Size")} description={t("skillTableSettings.skillIconSize.description", "Skill icon size")} unit="px" />

        <div class="flex items-center gap-2">
          <span class="text-sm text-muted-foreground">{t("common.mode", "Mode")}</span>
          <div class="flex items-center gap-1">
            <button type="button" class="px-2 py-1 text-xs rounded {SETTINGS.live.tableCustomization.state.skillRowGlowMode === 'gradient-underline' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-popover/30'}" onclick={() => (SETTINGS.live.tableCustomization.state.skillRowGlowMode = "gradient-underline")}>{t("common.gradientUnderline", "Gradient (Underline)")}</button>
            <button type="button" class="px-2 py-1 text-xs rounded {SETTINGS.live.tableCustomization.state.skillRowGlowMode === 'gradient' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-popover/30'}" onclick={() => (SETTINGS.live.tableCustomization.state.skillRowGlowMode = "gradient")}>{t("common.gradient", "Gradient")}</button>
            <button type="button" class="px-2 py-1 text-xs rounded {SETTINGS.live.tableCustomization.state.skillRowGlowMode === 'solid' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-popover/30'}" onclick={() => (SETTINGS.live.tableCustomization.state.skillRowGlowMode = "solid")}>{t("common.solid", "Solid")}</button>
          </div>
        </div>

        <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.skillRowGlowOpacity} min={0} max={1} step={0.01} label={t("skillTableSettings.skillRowHighlightOpacity", "Skill Row Highlight Opacity")} description={t("skillTableSettings.skillRowHighlightOpacity.description", "Skill row highlight fill opacity (0 = transparent, 1 = opaque)")} />
        <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.skillRowBorderRadius} min={0} max={24} step={1} label={t("skillTableSettings.skillRowCornerRadius", "Skill Row Corner Radius")} description={t("skillTableSettings.skillRowCornerRadius.description", "Corner radius for skill row highlight")} unit="px" />
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">{t("skillTableSettings.showSkillHeader", "Skill Header")}</h3>
        <SettingsSwitch
          bind:checked={SETTINGS.live.tableCustomization.state.skillShowHeader}
          label={t("skillTableSettings.showSkillHeader", "Show Skill Header")}
          description={t("skillTableSettings.showSkillHeader.description", "Toggle skill table column title visibility")}
        />
        {#if SETTINGS.live.tableCustomization.state.skillShowHeader}
          <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.skillHeaderHeight} min={0} max={100} step={1} label={t("skillTableSettings.skillHeaderHeight", "Skill Header Height")} description={t("skillTableSettings.skillHeaderHeight.description", "Skill header row height")} unit="px" />
          <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.skillHeaderFontSize} min={0} max={100} step={1} label={t("skillTableSettings.skillHeaderFontSize", "Skill Header Font Size")} description={t("skillTableSettings.skillHeaderFontSize.description", "Skill table column title font size")} unit="px" />
          <SettingsColor bind:value={SETTINGS.live.tableCustomization.state.skillHeaderTextColor} label={t("skillTableSettings.skillHeaderTextColor", "Skill Header Text Color")} description={t("skillTableSettings.skillHeaderTextColor.description", "Skill table column title text color")} />
        {/if}
      </div>

      <div class="space-y-2 pt-3 border-t border-border/30">
        <h3 class="text-sm font-semibold text-foreground">{t("skillTableSettings.skillSuffixFontSize", "Skill Suffix Font Size")}</h3>
        <SettingsSlider bind:value={SETTINGS.live.tableCustomization.state.skillAbbreviatedFontSize} min={0} max={100} step={1} label={t("skillTableSettings.skillSuffixFontSize", "Skill Suffix Font Size")} description={t("skillTableSettings.skillSuffixFontSize.description", "Font size for K/M/% suffixes in skill rows")} unit="px" />
      </div>
    </div>
  {/if}
</div>

<div
  class="rounded-lg border bg-card/40 border-border/60 overflow-hidden shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
>
  <button
    type="button"
    class="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
    onclick={() => toggleSection("sizePresets")}
  >
    <h2 class="text-base font-semibold text-foreground">
      {t("presets.sizePresets", "Size Presets")}
    </h2>
    <ChevronDown
      class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.sizePresets ? 'rotate-180' : ''}"
    />
  </button>
  {#if expandedSections.sizePresets}
    <div class="px-4 pb-4 space-y-3">
      <p class="text-xs text-muted-foreground">
        {t("presets.sizePresets.description", "Adjust table and header sizes based on your display")}
      </p>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        {#each Object.entries(SIZE_PRESETS) as [key, preset]}
          <button
            type="button"
            class="group flex flex-col items-center justify-center p-4 rounded-lg border border-border/60 bg-card/40 hover:bg-card/60 hover:border-primary/50 transition-all"
            onclick={() => applySizePreset(key)}
          >
            <div class="flex items-end gap-0.5 mb-2 h-6">
              <span class="w-2 bg-primary/30 rounded-sm" style="height: {key === 'compact' ? 8 : key === 'small' ? 12 : key === 'medium' ? 18 : 24}px"></span>
              <span class="w-2 bg-primary/50 rounded-sm" style="height: {key === 'compact' ? 12 : key === 'small' ? 16 : key === 'medium' ? 22 : 28}px"></span>
              <span class="w-2 bg-primary/70 rounded-sm" style="height: {key === 'compact' ? 16 : key === 'small' ? 20 : key === 'medium' ? 26 : 32}px"></span>
            </div>
            <span class="text-sm font-medium text-foreground">
              {t(`presets.sizePreset.${key}.name`, preset.name)}
            </span>
            <span class="text-xs text-muted-foreground text-center mt-0.5">
              {t(`presets.sizePreset.${key}.description`, preset.description)}
            </span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
