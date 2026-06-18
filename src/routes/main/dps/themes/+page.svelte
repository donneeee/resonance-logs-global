<script lang="ts">
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import SettingsSelect from "../settings/settings-select.svelte";
  import SettingsSlider from "../settings/settings-slider.svelte";
  import SettingsSwitch from "../settings/settings-switch.svelte";
  import SettingsColorAlpha from "../settings/settings-color-alpha.svelte";
  import SettingsFilePicker from "../settings/settings-file-picker.svelte";
  import { commands } from "$lib/bindings";
  import {
    SETTINGS,
    DEFAULT_CLASS_COLORS,
    DEFAULT_CLASS_SPEC_COLORS,
    CLASS_SPEC_NAMES,
    DEFAULT_CUSTOM_THEME_COLORS,
    CUSTOM_THEME_COLOR_LABELS,
  } from "$lib/settings-store";
  import { CLASS_NAMES, getClassColorRaw } from "$lib/utils.svelte";
  import ChevronDown from "virtual:icons/lucide/chevron-down";
  import { uiT } from "$lib/i18n";

  const themesTabs = [
    { id: "general", key: "tab.general", label: "通用" },
    { id: "presets", key: "tab.presets", label: "预设" },
  ];

  const t = uiT("dps/themes", () => SETTINGS.live.general.state.language);
  let backgroundImageError = $state("");

  function errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error) return error;
    return fallback;
  }

  async function importBackgroundImage(sourcePath: string, fileName: string) {
    backgroundImageError = "";
    try {
      const result = await commands.importBackgroundImage(sourcePath);
      if (result.status === "error") {
        throw new Error(result.error || "Background image import failed");
      }
      SETTINGS.accessibility.state.backgroundImage = result.data;
      SETTINGS.accessibility.state.backgroundImageSource = sourcePath;
      SETTINGS.accessibility.state.backgroundImageName = fileName;
      SETTINGS.accessibility.state.backgroundImageEnabled = true;
    } catch (error) {
      backgroundImageError = errorMessage(
        error,
        "Failed to import background image",
      );
      console.error("Failed to import background image", error);
      throw error;
    }
  }

  async function clearBackgroundImage() {
    backgroundImageError = "";
    try {
      const result = await commands.clearImportedBackgroundImage();
      if (result.status === "error") {
        throw new Error(result.error || "Background image clear failed");
      }
    } catch (error) {
      backgroundImageError = errorMessage(
        error,
        "Failed to clear imported background image",
      );
      console.warn("Failed to clear imported background image", error);
      throw error;
    } finally {
      SETTINGS.accessibility.state.backgroundImage = "";
      SETTINGS.accessibility.state.backgroundImageSource = "";
      SETTINGS.accessibility.state.backgroundImageName = "";
    }
  }

  function themeLabel(colorKey: keyof typeof DEFAULT_CUSTOM_THEME_COLORS, fallback: string): string {
    return t(`themeLabel.${String(colorKey)}.label`, fallback);
  }

  function themeDescription(colorKey: keyof typeof DEFAULT_CUSTOM_THEME_COLORS, fallback: string): string {
    return t(`themeLabel.${String(colorKey)}.description`, fallback);
  }

  function themeCategoryName(category: string): string {
    switch (category) {
      case "Base":
        return t("themeCategory.base", "基础");
      case "Surfaces":
        return t("themeCategory.surfaces", "表面");
      case "Tooltip":
        return t("themeCategory.tooltip", "提示");
      case "Accents":
        return t("themeCategory.accents", "强调");
      case "Tables":
        return t("themeCategory.tables", "表格");
      case "Utility":
        return t("themeCategory.utility", "工具");
      default:
        return category;
    }
  }

  // === COLOR THEME PRESETS (matching CSS data-theme selectors) ===
  // Color presets now include full variable mappings (from CSS data-theme blocks)
  const COLOR_PRESETS: Record<
    string,
    {
      name: string;
      description: string;
      theme: string;
      preview: { bg: string; primary: string; accent: string; fg: string };
      vars?: Record<string, string>;
    }
  > = {
    dark: {
      name: "Dark",
      description: "Clean dark theme with neutral grays",
      theme: "dark",
      preview: {
        bg: "#212121",
        primary: "#a6a6a6",
        accent: "#525252",
        fg: "#e2e2e2",
      },
      vars: {
        backgroundMain: "oklch(0.2178 0 0)",
        backgroundLive: "oklch(0.2178 0 0)",
        foreground: "oklch(0.8853 0 0)",
        surface: "oklch(0.2435 0 0)",
        surfaceForeground: "oklch(0.8853 0 0)",
        primary: "oklch(0.7058 0 0)",
        primaryForeground: "oklch(0.2178 0 0)",
        secondary: "oklch(0.3092 0 0)",
        secondaryForeground: "oklch(0.8853 0 0)",
        muted: "oklch(0.2850 0 0)",
        mutedForeground: "oklch(0.5999 0 0)",
        accent: "oklch(0.3715 0 0)",
        accentForeground: "oklch(0.8853 0 0)",
        destructive: "oklch(0.6591 0.1530 22.1703)",
        destructiveForeground: "oklch(1 0 0)",
        border: "oklch(0.3290 0 0)",
        input: "oklch(0.3092 0 0)",
        tooltipBg: "oklch(0.275 0 0 / 0.92)",
        tooltipBorder: "oklch(0.38 0 0 / 0.55)",
        tooltipFg: "oklch(0.8853 0 0)",
        tableTextColor: "#ffffff",
        tableAbbreviatedColor: "#71717a",
      },
    },
    light: {
      name: "Light",
      description: "Bright theme suitable for daytime use",
      theme: "light",
      preview: {
        bg: "#fbfbf9",
        primary: "#5b7fc7",
        accent: "#d4a84a",
        fg: "#2a2e40",
      },
      vars: {
        backgroundMain: "oklch(0.985 0.01 95)",
        backgroundLive: "oklch(0.985 0.01 95)",
        foreground: "oklch(0.19 0.02 250)",
        surface: "oklch(0.97 0.01 95)",
        surfaceForeground: "oklch(0.19 0.02 250)",
        primary: "oklch(0.65 0.12 250)",
        primaryForeground: "oklch(0.99 0.01 95)",
        secondary: "oklch(0.92 0.02 95)",
        secondaryForeground: "oklch(0.34 0.04 250)",
        muted: "oklch(0.9 0.015 95)",
        mutedForeground: "oklch(0.48 0.02 240)",
        accent: "oklch(0.78 0.14 60)",
        accentForeground: "oklch(0.18 0.03 250)",
        destructive: "oklch(0.62 0.24 25)",
        destructiveForeground: "oklch(0.98 0.01 95)",
        border: "oklch(0.88 0.02 95)",
        input: "oklch(0.94 0.015 95)",
        tooltipBg: "oklch(0.86 0.01 95 / 0.96)",
        tooltipBorder: "oklch(0.78 0.02 95 / 0.65)",
        tooltipFg: "oklch(0.19 0.02 250)",
        tableTextColor: "#2a2e40",
        tableAbbreviatedColor: "#71717a",
      },
    },
    pink: {
      name: "Pink UwU",
      description: "Cute soft pink theme",
      theme: "pink",
      preview: {
        bg: "#F8E8EE",
        primary: "#F2BED1",
        accent: "#F2BED1",
        fg: "#582F3B",
      },
      vars: {
        backgroundMain: "#F8E8EE",
        backgroundLive: "#F8E8EE",
        foreground: "#582F3B",
        surface: "#F9F5F6",
        surfaceForeground: "#582F3B",
        primary: "#F2BED1",
        primaryForeground: "#402028",
        secondary: "#FDCEDF",
        secondaryForeground: "#5A2F3D",
        muted: "#F9F5F6",
        mutedForeground: "#7A5461",
        accent: "#F2BED1",
        accentForeground: "#402028",
        destructive: "#D35D6E",
        destructiveForeground: "#FFF9FB",
        border: "#F2BED1",
        input: "#FDCEDF",
        tooltipBg: "#F2BED1EE",
        tooltipBorder: "#F2BED1",
        tooltipFg: "#582F3B",
        tableTextColor: "#582F3B",
        tableAbbreviatedColor: "#7A5461",
      },
    },
    green: {
      name: "Soft Green",
      description: "Soft natural green palette",
      theme: "green",
      preview: {
        bg: "#e0f0e0",
        primary: "#6fbf6f",
        accent: "#7fcf8f",
        fg: "#1a2a1a",
      },
      vars: {
        backgroundMain: "oklch(0.94 0.03 150)",
        backgroundLive: "oklch(0.94 0.03 150)",
        foreground: "oklch(0.20 0.03 150)",
        surface: "oklch(0.95 0.025 150)",
        surfaceForeground: "oklch(0.20 0.03 150)",
        primary: "oklch(0.75 0.09 150)",
        primaryForeground: "oklch(0.98 0.015 95)",
        secondary: "oklch(0.90 0.02 145)",
        secondaryForeground: "oklch(0.34 0.04 160)",
        muted: "oklch(0.90 0.02 150)",
        mutedForeground: "oklch(0.42 0.03 140)",
        accent: "oklch(0.78 0.08 160)",
        accentForeground: "oklch(0.22 0.03 160)",
        destructive: "oklch(0.62 0.24 25)",
        destructiveForeground: "oklch(0.99 0.01 95)",
        border: "oklch(0.86 0.02 150)",
        input: "oklch(0.92 0.015 150)",
        tooltipBg: "oklch(0.90 0.02 150 / 0.96)",
        tooltipBorder: "oklch(0.80 0.02 150 / 0.55)",
        tooltipFg: "oklch(0.20 0.03 150)",
        tableTextColor: "#1a2a1a",
        tableAbbreviatedColor: "#71717a",
      },
    },
    matcha: {
      name: "Matcha",
      description: "Earthy green / matcha mood",
      theme: "matcha",
      preview: {
        bg: "#d8e8d0",
        primary: "#5a9f5a",
        accent: "#6ab06a",
        fg: "#283828",
      },
      vars: {
        backgroundMain: "oklch(0.90 0.03 125)",
        backgroundLive: "oklch(0.90 0.03 125)",
        foreground: "oklch(0.24 0.04 125)",
        surface: "oklch(0.92 0.03 125)",
        surfaceForeground: "oklch(0.24 0.04 125)",
        primary: "oklch(0.70 0.11 125)",
        primaryForeground: "oklch(0.98 0.015 95)",
        secondary: "oklch(0.88 0.02 125)",
        secondaryForeground: "oklch(0.36 0.05 125)",
        muted: "oklch(0.87 0.02 125)",
        mutedForeground: "oklch(0.42 0.03 130)",
        accent: "oklch(0.74 0.10 135)",
        accentForeground: "oklch(0.25 0.04 125)",
        destructive: "oklch(0.62 0.24 25)",
        destructiveForeground: "oklch(0.99 0.01 95)",
        border: "oklch(0.84 0.02 125)",
        input: "oklch(0.90 0.02 125)",
        tooltipBg: "oklch(0.88 0.02 125 / 0.96)",
        tooltipBorder: "oklch(0.78 0.02 125 / 0.55)",
        tooltipFg: "oklch(0.24 0.04 125)",
        tableTextColor: "#283828",
        tableAbbreviatedColor: "#71717a",
      },
    },
    rainbow: {
      name: "Rainbow Gradient",
      description: "Colorful gradient background",
      theme: "rainbow",
      preview: {
        bg: "linear-gradient(120deg,#ffe5ec,#e0f7fa,#f3e8ff,#e9fbd5)",
        primary: "#b87fd0",
        accent: "#d09050",
        fg: "#383848",
      },
      vars: {
        backgroundMain:
          "linear-gradient(120deg,#ffe5ec,#e0f7fa,#f3e8ff,#e9fbd5)",
        backgroundLive:
          "linear-gradient(120deg,#ffe5ec,#e0f7fa,#f3e8ff,#e9fbd5)",
        foreground: "oklch(0.25 0.03 250)",
        surface: "oklch(0.97 0.02 95)",
        surfaceForeground: "oklch(0.25 0.03 250)",
        primary: "oklch(0.72 0.14 300)",
        primaryForeground: "oklch(0.99 0.01 95)",
        secondary: "oklch(0.80 0.10 140)",
        secondaryForeground: "oklch(0.28 0.03 240)",
        muted: "oklch(0.90 0.02 95)",
        mutedForeground: "oklch(0.45 0.03 250)",
        accent: "oklch(0.78 0.13 40)",
        accentForeground: "oklch(0.22 0.03 250)",
        destructive: "oklch(0.60 0.22 25)",
        destructiveForeground: "oklch(0.99 0.01 95)",
        border: "oklch(0.88 0.02 95)",
        input: "oklch(0.94 0.02 95)",
        tooltipBg: "oklch(0.93 0.02 95 / 0.94)",
        tooltipBorder: "oklch(0.83 0.02 95 / 0.5)",
        tooltipFg: "oklch(0.25 0.03 250)",
        tableTextColor: "#383848",
        tableAbbreviatedColor: "#71717a",
      },
    },
  };

  function applyColorPreset(presetKey: string) {
    const preset = COLOR_PRESETS[presetKey];
    if (preset) {
      SETTINGS.accessibility.state.customThemeColors = {
        ...SETTINGS.accessibility.state.customThemeColors,
        ...preset.vars,
      };
    }
  }

  let activeTab = $state("general");

  // Collapsible section state - all collapsed by default
  let expandedSections = $state({
    colorThemes: false,
    classSpecColors: false,
    backgroundImage: false,
    customFonts: false,
  });

  function toggleSection(section: keyof typeof expandedSections) {
    expandedSections[section] = !expandedSections[section];
  }


  // Class/Spec colors tab state - 'class' or 'spec'
  let colorMode = $state<"class" | "spec">("class");

  // Sync useClassSpecColors setting with colorMode
  $effect(() => {
    SETTINGS.accessibility.state.useClassSpecColors = colorMode === "spec";
  });

  $effect(() => {
    if (
      typeof SETTINGS.accessibility.state.backgroundImageOpacity !== "number"
    ) {
      SETTINGS.accessibility.state.backgroundImageOpacity = 100;
    }
  });

  // Group custom theme colors by category
  const colorCategories = $derived.by(() => {
    const categories: Record<
      string,
      Array<keyof typeof DEFAULT_CUSTOM_THEME_COLORS>
    > = {};
    for (const [key, info] of Object.entries(CUSTOM_THEME_COLOR_LABELS)) {
      if (!categories[info.category]) {
        categories[info.category] = [];
      }
      categories[info.category]!.push(
        key as keyof typeof DEFAULT_CUSTOM_THEME_COLORS,
      );
    }
    return categories;
  });

  // Category order for display
  const categoryOrder = [
    "Base",
    "Surfaces",
    "Tooltip",
    "Accents",
    "Tables",
    "Utility",
  ];


  function updateClassColor(className: string, color: string) {
    SETTINGS.accessibility.state.classColors = {
      ...SETTINGS.accessibility.state.classColors,
      [className]: color,
    };
  }

  function updateClassSpecColor(specName: string, color: string) {
    SETTINGS.accessibility.state.classSpecColors = {
      ...SETTINGS.accessibility.state.classSpecColors,
      [specName]: color,
    };
  }

  function resetClassColors() {
    SETTINGS.accessibility.state.classColors = { ...DEFAULT_CLASS_COLORS };
  }

  function resetClassSpecColors() {
    SETTINGS.accessibility.state.classSpecColors = {
      ...DEFAULT_CLASS_SPEC_COLORS,
    };
  }

  function updateCustomThemeColor(
    key: keyof typeof DEFAULT_CUSTOM_THEME_COLORS,
    value: string,
  ) {
    SETTINGS.accessibility.state.customThemeColors = {
      ...SETTINGS.accessibility.state.customThemeColors,
      [key]: value,
    };
  }

  function resetCustomThemeColors() {
    SETTINGS.accessibility.state.customThemeColors = {
      ...DEFAULT_CUSTOM_THEME_COLORS,
    };
  }

</script>

<Tabs.Root bind:value={activeTab}>
  <Tabs.List>
    {#each themesTabs as themesTab (themesTab.id)}
      <Tabs.Trigger value={themesTab.id}>{t(themesTab.key, themesTab.label)}</Tabs.Trigger>
    {/each}
  </Tabs.List>

  {#if activeTab === "general"}
    <Tabs.Content value="general">
      <div class="space-y-3">
        <!-- Color Themes Section -->
        <div
          class="rounded-lg border bg-card/40 border-border/60 overflow-hidden shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
        >
          <button
            type="button"
            class="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
            onclick={() => toggleSection("colorThemes")}
          >
            <h2 class="text-base font-semibold text-foreground">
              {t("themes.general.colorThemes", "主题颜色")}
            </h2>
            <ChevronDown
              class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.colorThemes
                ? 'rotate-180'
                : ''}"
            />
          </button>
          {#if expandedSections.colorThemes}
            <div class="px-4 pb-4 space-y-3">
              <div class="mt-3 pt-3 border-t border-border/50">
                <div class="flex items-center justify-between mb-3">
                  <div>
                    <h3 class="text-sm font-semibold text-foreground">
                      {t("themes.general.customColorThemeTitle", "自定义颜色主题")}
                    </h3>
                    <p class="text-xs text-muted-foreground mt-0.5">
                      {t("themes.general.customColorThemeDescription", "自定义每个颜色变量（支持设置透明度）")}
                    </p>
                  </div>
                  <button
                    onclick={resetCustomThemeColors}
                    class="px-3 py-1.5 text-xs font-medium rounded-md bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                    >{t("common.reset", "重置")}</button
                  >
                </div>

                {#each categoryOrder as category}
                  {#if colorCategories[category]}
                    <div class="mb-4">
                      <h4
                        class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 px-1"
                      >
                        {themeCategoryName(category)}
                      </h4>
                      <div class="space-y-1">
                        {#each colorCategories[category] ?? [] as colorKey}
                          {@const colorInfo =
                            CUSTOM_THEME_COLOR_LABELS[colorKey]}
                          {#if colorInfo}
                            <SettingsColorAlpha
                              label={themeLabel(colorKey, colorInfo.label)}
                              description={themeDescription(colorKey, colorInfo.description)}
                              value={SETTINGS.accessibility.state
                                .customThemeColors?.[colorKey] ??
                                DEFAULT_CUSTOM_THEME_COLORS[colorKey] ??
                                "rgba(128, 128, 128, 1)"}
                              oninput={(value: string) =>
                                updateCustomThemeColor(colorKey, value)}
                            />
                          {/if}
                        {/each}
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <!-- Class & Spec Colors Section -->
        <div
          class="rounded-lg border bg-card/40 border-border/60 overflow-hidden shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
        >
          <button
            type="button"
            class="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
            onclick={() => toggleSection("classSpecColors")}
          >
            <h2 class="text-base font-semibold text-foreground">
              {t("themes.general.classSpecColors", "职业与专精颜色")}
            </h2>
            <ChevronDown
              class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.classSpecColors
                ? 'rotate-180'
                : ''}"
            />
          </button>
          {#if expandedSections.classSpecColors}
            <div class="px-4 pb-4 space-y-3">
              <p class="text-xs text-muted-foreground">
                {t("themes.general.classSpecIntro", "自定义职业或专精的颜色。选择“专精颜色”可在检测到专精时显示特定颜色。")}
              </p>

              <!-- Tab buttons for Class/Spec -->
              <div
                class="flex items-center border border-border rounded-lg overflow-hidden bg-popover/30 w-fit"
              >
                <button
                  type="button"
                  class="px-4 py-2 text-sm font-medium transition-colors {colorMode ===
                  'class'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-popover/60'}"
                  onclick={() => (colorMode = "class")}
                >
                  {t("themes.general.classColorsTab", "职业颜色")}
                </button>
                <button
                  type="button"
                  class="px-4 py-2 text-sm font-medium transition-colors border-l border-border {colorMode ===
                  'spec'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-popover/60'}"
                  onclick={() => (colorMode = "spec")}
                >
                  {t("themes.general.specColorsTab", "专精颜色")}
                </button>
              </div>

              {#if colorMode === "class"}
                <div class="flex items-center justify-between">
                  <p class="text-xs text-muted-foreground">
                    {t("themes.general.classColorsDescription", "自定义实时统计中各职业的颜色。")}
                  </p>
                  <button
                    onclick={resetClassColors}
                    class="px-3 py-1.5 text-xs font-medium rounded-md bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                    >{t("common.reset", "重置")}</button
                  >
                </div>
                <div class="grid grid-cols-2 gap-2 mt-2">
                  {#each CLASS_NAMES as className}
                    <label
                      class="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-popover/50 transition-colors"
                    >
                      <input
                        type="color"
                        value={getClassColorRaw(className)}
                        oninput={(e) =>
                          updateClassColor(className, e.currentTarget.value)}
                        class="w-8 h-8 rounded cursor-pointer border border-border/50"
                      />
                      <span class="text-sm font-medium text-foreground"
                        >{className}</span
                      >
                    </label>
                  {/each}
                </div>
              {:else}
                <div class="flex items-center justify-between">
                  <p class="text-xs text-muted-foreground">
                    {t("themes.general.specColorsDescription", "自定义各专精的颜色。")}
                  </p>
                  <button
                    onclick={resetClassSpecColors}
                    class="px-3 py-1.5 text-xs font-medium rounded-md bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                    >{t("common.reset", "重置")}</button
                  >
                </div>
                <div class="grid grid-cols-2 gap-2 mt-2">
                  {#each CLASS_SPEC_NAMES as specName}
                    <label
                      class="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-popover/50 transition-colors"
                    >
                      <input
                        type="color"
                        value={getClassColorRaw("", specName)}
                        oninput={(e) =>
                          updateClassSpecColor(specName, e.currentTarget.value)}
                        class="w-8 h-8 rounded cursor-pointer border border-border/50"
                      />
                      <span class="text-sm font-medium text-foreground"
                        >{specName}</span
                      >
                    </label>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Background Image Section -->
        <div
          class="rounded-lg border bg-card/40 border-border/60 overflow-hidden shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
        >
          <button
            type="button"
            class="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
            onclick={() => toggleSection("backgroundImage")}
          >
            <h2 class="text-base font-semibold text-foreground">
              {t("themes.general.backgroundImage", "背景图片")}
            </h2>
            <ChevronDown
              class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.backgroundImage
                ? 'rotate-180'
                : ''}"
            />
          </button>
          {#if expandedSections.backgroundImage}
            <div class="px-4 pb-4 space-y-2">
              <p class="text-xs text-muted-foreground">
                {t("themes.general.backgroundImageDescription", "为所有窗口使用自定义背景图片。注意：需要将背景颜色设置为半透明，图片才能显示出来。")}
              </p>
              <SettingsSwitch
                bind:checked={
                  SETTINGS.accessibility.state.backgroundImageEnabled
                }
                label={t("themes.general.enableBackgroundImage", "启用背景图片")}
                description={t("themes.general.enableBackgroundImageDescription", "使用图片作为背景")}
              />
              {#if SETTINGS.accessibility.state.backgroundImageEnabled}
                <div class="mt-2 space-y-2">
                  <SettingsFilePicker
                    label={t("themes.general.selectImage", "选择图片")}
                    description={t("themes.general.selectImageDescription", "选择图片文件（PNG/JPG/WebP/GIF）")}
                    accept="image/*"
                    value={SETTINGS.accessibility.state.backgroundImage}
                    displayName={SETTINGS.accessibility.state.backgroundImageName}
                    storage="path"
                    onchange={importBackgroundImage}
                    onclear={clearBackgroundImage}
                  />
                  {#if backgroundImageError}
                    <p class="px-3 text-xs text-destructive">
                      {backgroundImageError}
                    </p>
                  {/if}
                  <SettingsSlider
                    bind:value={
                      SETTINGS.accessibility.state.backgroundImageOpacity
                    }
                    min={0}
                    max={100}
                    step={1}
                    unit="%"
                    label={t("themes.general.backgroundImageOpacity", "Background image opacity")}
                    description={t(
                      "themes.general.backgroundImageOpacityDescription",
                      "Controls how strongly the background image is drawn behind the app.",
                    )}
                  />
                  <SettingsSelect
                    label={t("themes.general.imageMode", "图片模式")}
                    description={t("themes.general.imageModeDescription", "图片如何适配窗口")}
                    bind:selected={
                      SETTINGS.accessibility.state.backgroundImageMode
                    }
                    values={[
                      {
                        label: t("themes.general.imageMode.cover", "Cover"),
                        value: "cover",
                      },
                      {
                        label: t("themes.general.imageMode.contain", "Contain"),
                        value: "contain",
                      },
                      {
                        label: t("themes.general.imageMode.fitWidth", "Fit Width"),
                        value: "fit-width",
                      },
                    ]}
                  />
                  {#if SETTINGS.accessibility.state.backgroundImageMode !== "cover"}
                    <SettingsColorAlpha
                      label={t("themes.general.containFillColor", "空白区域填充颜色")}
                      description={t("themes.general.containFillColorDescription", "当图片使用“包含”或“适应宽度”模式时，空白区域使用的背景色")}
                      value={SETTINGS.accessibility.state
                        .backgroundImageContainColor}
                      oninput={(value: string) => {
                        SETTINGS.accessibility.state.backgroundImageContainColor =
                          value;
                      }}
                    />
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>
        <div
          class="rounded-lg border bg-card/40 border-border/60 overflow-hidden shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
        >
          <button
            type="button"
            class="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
            onclick={() => toggleSection("customFonts")}
          >
            <h2 class="text-base font-semibold text-foreground">
              {t("themes.general.customFonts", "自定义字体")}
            </h2>
            <ChevronDown
              class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.customFonts
                ? 'rotate-180'
                : ''}"
            />
          </button>
          {#if expandedSections.customFonts}
            <div class="px-4 pb-4 space-y-4">
              <p class="text-xs text-muted-foreground">
                {t("themes.general.customFontsIntro", "Import custom fonts to replace the defaults. Supported font file formats: .woff2, .woff, .ttf, and .otf.")}
              </p>

              <!-- Sans-serif Font -->
              <div class="space-y-2 pt-2 border-t border-border/30">
                <h3 class="text-sm font-semibold text-foreground">
                  {t("themes.general.sansFont", "无衬线字体（UI 文本）")}
                </h3>
                <p class="text-xs text-muted-foreground">
                  {t("themes.general.sansFontDefault", "默认：Inter Variable")}
                </p>
                <SettingsSwitch
                  bind:checked={
                    SETTINGS.accessibility.state.customFontSansEnabled
                  }
                  label={t("themes.general.enableCustomSans", "启用自定义无衬线字体")}
                  description={t("themes.general.enableCustomSansDescription", "UI 文本使用自定义字体")}
                />
                {#if SETTINGS.accessibility.state.customFontSansEnabled}
                  <SettingsFilePicker
                    label={t("themes.general.pickFontFile", "选择字体文件")}
                    description={t("themes.general.pickFontFileDescription", "选择字体文件（.woff2/.woff/.ttf/.otf）")}
                    accept=".woff2,.woff,.ttf,.otf"
                    value={SETTINGS.accessibility.state.customFontSansUrl}
                    onchange={(dataUrl, fileName) => {
                      SETTINGS.accessibility.state.customFontSansUrl = dataUrl;
                      // Extract font name from file name (remove extension)
                      const fontName = fileName.replace(
                        /\.(woff2?|ttf|otf)$/i,
                        "",
                      );
                      SETTINGS.accessibility.state.customFontSansName =
                        fontName;
                      // Register the font face
                      const fontFace = new FontFace(
                        fontName,
                        `url(${dataUrl})`,
                      );
                      fontFace
                        .load()
                        .then((loadedFace) => {
                          document.fonts.add(loadedFace);
                        })
                        .catch((e) => console.error("Failed to load font:", e));
                    }}
                    onclear={() => {
                      SETTINGS.accessibility.state.customFontSansUrl = "";
                      SETTINGS.accessibility.state.customFontSansName = "";
                    }}
                  />
                  {#if SETTINGS.accessibility.state.customFontSansName}
                    <p class="text-xs text-muted-foreground pl-3">
                      Loaded: {SETTINGS.accessibility.state.customFontSansName}
                    </p>
                  {/if}
                {/if}
              </div>

              <!-- Monospace Font -->
              <div class="space-y-2 pt-3 border-t border-border/30">
                <h3 class="text-sm font-semibold text-foreground">
                  {t("themes.general.monoFont", "等宽字体（数字、代码）")}
                </h3>
                <p class="text-xs text-muted-foreground">
                  {t("themes.general.monoFontDefault", "默认：Geist Mono Variable")}
                </p>
                <SettingsSwitch
                  bind:checked={
                    SETTINGS.accessibility.state.customFontMonoEnabled
                  }
                  label={t("themes.general.enableCustomMono", "启用自定义等宽字体")}
                  description={t("themes.general.enableCustomMonoDescription", "数字/代码使用自定义等宽字体")}
                />
                {#if SETTINGS.accessibility.state.customFontMonoEnabled}
                  <SettingsFilePicker
                    label={t("themes.general.pickFontFile", "选择字体文件")}
                    description={t("themes.general.pickFontFileDescription", "选择字体文件（.woff2/.woff/.ttf/.otf）")}
                    accept=".woff2,.woff,.ttf,.otf"
                    value={SETTINGS.accessibility.state.customFontMonoUrl}
                    onchange={(dataUrl, fileName) => {
                      SETTINGS.accessibility.state.customFontMonoUrl = dataUrl;
                      // Extract font name from file name (remove extension)
                      const fontName = fileName.replace(
                        /\.(woff2?|ttf|otf)$/i,
                        "",
                      );
                      SETTINGS.accessibility.state.customFontMonoName =
                        fontName;
                      // Register the font face
                      const fontFace = new FontFace(
                        fontName,
                        `url(${dataUrl})`,
                      );
                      fontFace
                        .load()
                        .then((loadedFace) => {
                          document.fonts.add(loadedFace);
                        })
                        .catch((e) => console.error("Failed to load font:", e));
                    }}
                    onclear={() => {
                      SETTINGS.accessibility.state.customFontMonoUrl = "";
                      SETTINGS.accessibility.state.customFontMonoName = "";
                    }}
                  />
                  {#if SETTINGS.accessibility.state.customFontMonoName}
                    <p class="text-xs text-muted-foreground pl-3">
                      Loaded: {SETTINGS.accessibility.state.customFontMonoName}
                    </p>
                  {/if}
                {/if}
              </div>
            </div>
          {/if}
        </div>
      </div>
    </Tabs.Content>
  {:else if activeTab === "presets"}
    <Tabs.Content value="presets">
      <div class="space-y-6">
        <!-- Color Theme Presets -->
        <div class="space-y-3">
          <div>
            <h2 class="text-base font-semibold text-foreground">
              {t("presets.colorThemes", "颜色主题")}
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">
              {t("presets.colorThemes.description", "选择一个预设颜色主题")}
            </p>
          </div>
          <div class="grid grid-cols-2 gap-3">
            {#each Object.entries(COLOR_PRESETS) as [key, preset]}
              <button
                type="button"
                class="group relative flex flex-col items-start p-4 rounded-lg border border-border/60 bg-card/40 hover:bg-card/60 hover:border-primary/50 transition-all text-left"
                onclick={() => applyColorPreset(key)}
              >
                <!-- Color preview dots -->
                <div class="flex gap-1.5 mb-2">
                  <span
                    class="w-4 h-4 rounded-full border border-black/20"
                    style="background: {preset.preview.bg}"
                  ></span>
                  <span
                    class="w-4 h-4 rounded-full border border-black/20"
                    style="background: {preset.preview.primary}"
                  ></span>
                  <span
                    class="w-4 h-4 rounded-full border border-black/20"
                    style="background: {preset.preview.accent}"
                  ></span>
                  <span
                    class="w-4 h-4 rounded-full border border-black/20"
                    style="background: {preset.preview.fg}"
                  ></span>
                </div>
                <span class="text-sm font-medium text-foreground"
                  >{t(`presets.colorPreset.${key}.name`, preset.name)}</span
                >
                <span class="text-xs text-muted-foreground mt-0.5"
                  >{t(`presets.colorPreset.${key}.description`, preset.description)}</span
                >
              </button>
            {/each}
          </div>
        </div>

      </div>
    </Tabs.Content>
  {/if}
</Tabs.Root>
