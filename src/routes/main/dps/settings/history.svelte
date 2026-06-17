<script lang="ts">
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import SettingsSwitch from "./settings-switch.svelte";
  import SettingsSelect from "./settings-select.svelte";
  import SettingsSlider from "./settings-slider.svelte";
  import ColumnSettingsList from "./column-settings-list.svelte";
  import { historyDpsPlayerColumns, historyDpsSkillColumns, historyHealPlayerColumns, historyHealSkillColumns, historyTankedPlayerColumns, historyTankedSkillColumns } from "$lib/column-data";
  import { DEFAULT_HISTORY_SUMMARY_FIELDS, SETTINGS } from "$lib/settings-store";
  import { uiT } from "$lib/i18n";
  import ChevronDown from "virtual:icons/lucide/chevron-down";

  const SETTINGS_CATEGORY = "history";

  // Collapsible section state - all collapsed by default
  let expandedSections = $state({
    general: false,
    summary: false,
    dpsPlayers: false,
    dpsSkills: false,
    healPlayers: false,
    healSkills: false,
    tankedPlayers: false,
    tankedSkills: false,
  });

  function toggleSection(section: keyof typeof expandedSections) {
    expandedSections[section] = !expandedSections[section];
  }

  const t = uiT("dps/settings-history", () => SETTINGS.live.general.state.language);
  const colT = uiT("dps/history", () => SETTINGS.live.general.state.language);
  const hiddenDpsColumns = ["effectiveTotal", "effectiveDps"];
  type SummaryGroupKey = "time" | "damage" | "healing" | "tanked";
  type SummaryField = {
    key: string;
    label: string;
    labelKey: string;
    description: string;
    descriptionKey: string;
  };

  const summaryFieldGroups: {
    key: SummaryGroupKey;
    labelKey: string;
    label: string;
    fields: SummaryField[];
  }[] = [
    {
      key: "time",
      labelKey: "summaryGroup.time",
      label: "Time",
      fields: [
        {
          key: "encounterTime",
          labelKey: "summaryField.encounterTime.label",
          label: "Encounter Time",
          descriptionKey: "summaryField.encounterTime.description",
          description: "Show the full encounter duration in the summary.",
        },
        {
          key: "trueDpsTime",
          labelKey: "summaryField.trueDpsTime.label",
          label: "True DPS Time",
          descriptionKey: "summaryField.trueDpsTime.description",
          description: "Show the active combat time used by true DPS calculations.",
        },
        {
          key: "deaths",
          labelKey: "summaryField.deaths.label",
          label: "Deaths",
          descriptionKey: "summaryField.deaths.description",
          description: "Show death count in the summary.",
        },
      ],
    },
    {
      key: "damage",
      labelKey: "summaryGroup.damage",
      label: "Damage",
      fields: [
        summaryField("totalDmg", "Damage", "Show total damage dealt."),
        summaryField("bossDmg", "Boss Damage", "Show damage dealt to the boss."),
        summaryField("critHits", "Crit Hits", "Show critical hit count."),
        summaryField("luckyHits", "Lucky Hits", "Show lucky hit count."),
        summaryField("dps", "DPS", "Show damage per second."),
        summaryField("bossDps", "Boss DPS", "Show boss damage per second."),
        summaryField("critRate", "Crit%", "Show critical hit rate."),
        summaryField("luckyRate", "Lucky%", "Show lucky hit rate."),
        summaryField("tdps", "True DPS", "Show true damage per second."),
        summaryField("hits", "Hits", "Show total hit count."),
        summaryField("critTotal", "Crit DMG", "Show total critical damage."),
        summaryField("luckyTotal", "Lucky DMG", "Show total lucky damage."),
        summaryField("dmgPct", "Share %", "Show damage share."),
        summaryField("hitsPerMinute", "Hits/min", "Show hits per minute."),
      ],
    },
    {
      key: "healing",
      labelKey: "summaryGroup.healing",
      label: "Healing",
      fields: [
        summaryField("healDealt", "Healing", "Show total healing."),
        summaryField("critHits", "Crit Hits", "Show critical heal count."),
        summaryField("luckyHits", "Lucky Hits", "Show lucky heal count."),
        summaryField("hps", "HPS", "Show healing per second."),
        summaryField("critRate", "Crit%", "Show critical heal rate."),
        summaryField("luckyRate", "Lucky%", "Show lucky heal rate."),
        summaryField("effectiveHeal", "Effective Heals", "Show effective healing."),
        summaryField("critTotal", "Crit Heals", "Show total critical healing."),
        summaryField("luckyTotal", "Lucky Heals", "Show total lucky healing."),
        summaryField("ehps", "eHPS", "Show effective healing per second."),
      ],
    },
    {
      key: "tanked",
      labelKey: "summaryGroup.tanked",
      label: "Tanked",
      fields: [
        summaryField("damageTaken", "Dmg Taken", "Show total damage taken."),
        summaryField("tankedPS", "DTPS", "Show damage taken per second."),
        summaryField("hitsTaken", "Hits Taken", "Show hit count taken."),
        summaryField("tankedPct", "Share %", "Show tanked share."),
        summaryField("blockRate", "Block%", "Show block rate."),
        summaryField("luckyRate", "Lucky%", "Show lucky taken hit rate."),
        summaryField("blockHits", "Blocks", "Show blocked hit count."),
      ],
    },
  ];

  function summaryField(key: string, label: string, description: string): SummaryField {
    return {
      key,
      label,
      labelKey: `summaryField.${key}.label`,
      description,
      descriptionKey: `summaryField.${key}.description`,
    };
  }

  function colLabel(col: { label: string; labelKey?: string }): string {
    return col.labelKey ? colT(col.labelKey, col.label) : col.label;
  }

  function colDescription(col: { description: string; descriptionKey?: string }): string {
    return col.descriptionKey ? colT(col.descriptionKey, col.description) : col.description;
  }

  function summaryGroupLabel(group: { labelKey: string; label: string }): string {
    return t(group.labelKey, group.label);
  }

  function summaryFieldLabel(field: SummaryField): string {
    return field.labelKey ? (field.labelKey.startsWith("summaryField.") ? t(field.labelKey, field.label) : colT(field.labelKey, field.label)) : field.label;
  }

  function summaryFieldDescription(field: SummaryField): string {
    return t(field.descriptionKey, field.description);
  }

  function summaryDefaultsFor(groupKey: SummaryGroupKey): Record<string, boolean> {
    return DEFAULT_HISTORY_SUMMARY_FIELDS[groupKey] as Record<string, boolean>;
  }

  function summaryFieldEnabled(groupKey: SummaryGroupKey, key: string): boolean {
    const state = SETTINGS.history.summary.state[groupKey] as Record<string, boolean>;
    return state[key] ?? summaryDefaultsFor(groupKey)[key] ?? true;
  }

  function setSummaryFieldEnabled(groupKey: SummaryGroupKey, key: string, checked: boolean): void {
    const state = SETTINGS.history.summary.state[groupKey] as Record<string, boolean>;
    state[key] = checked;
  }

  function summaryAliasKey(groupKey: SummaryGroupKey, key: string): string {
    return `${groupKey}.${key}`;
  }

  function summaryAliasValue(groupKey: SummaryGroupKey, key: string): string {
    return SETTINGS.history.summary.state.aliases[summaryAliasKey(groupKey, key)] ?? "";
  }

  function setSummaryAlias(groupKey: SummaryGroupKey, key: string, value: string): void {
    const aliasKey = summaryAliasKey(groupKey, key);
    const aliases = SETTINGS.history.summary.state.aliases;
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      aliases[aliasKey] = trimmed.slice(0, 48);
    } else {
      delete aliases[aliasKey];
    }
  }
</script>

<Tabs.Content value={SETTINGS_CATEGORY}>
  <div class="space-y-3">
    <div class="rounded-lg border bg-card/40 border-border/60 overflow-hidden shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]">
      <button
        type="button"
        class="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
        onclick={() => toggleSection('general')}
      >
        <h2 class="text-base font-semibold text-foreground">{t("generalSettings", "通用设置")}</h2>
        <ChevronDown class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.general ? 'rotate-180' : ''}" />
      </button>
      {#if expandedSections.general}
        <div class="px-4 pb-3 space-y-1">
          <SettingsSelect
            bind:selected={SETTINGS.history.general.state.showYourName}
            values={[
              { label: t("showYourName.option.name", "显示你的名称"), value: "Show Your Name" },
              { label: t("showYourName.option.class", "显示你的职业"), value: "Show Your Class" },
              { label: t("showYourName.option.nameClass", "显示你的名称 - 职业"), value: "Show Your Name - Class" },
              { label: t("showYourName.option.nameSpec", "显示你的名称 - 专精"), value: "Show Your Name - Spec" },
              { label: t("showYourName.option.hide", "隐藏你的名称"), value: "Hide Your Name" },
            ]}
            label={t("showYourName", "显示你的名称")}
            description={t("showYourNameDescription", "“显示你的职业”会用职业替代你的名称；“名称 - 职业/专精”会同时显示两者。")}
          />
          <SettingsSelect
            bind:selected={SETTINGS.history.general.state.showOthersName}
            values={[
              { label: t("showOthersName.option.name", "显示他人名称"), value: "Show Others' Name" },
              { label: t("showOthersName.option.class", "显示他人职业"), value: "Show Others' Class" },
              { label: t("showOthersName.option.nameClass", "显示他人名称 - 职业"), value: "Show Others' Name - Class" },
              { label: t("showOthersName.option.nameSpec", "显示他人名称 - 专精"), value: "Show Others' Name - Spec" },
              { label: t("showOthersName.option.hide", "隐藏他人名称"), value: "Hide Others' Name" },
            ]}
            label={t("showOthersName", "显示他人名称")}
            description={t("showOthersNameDescription", "“显示他人职业”会用职业替代他人名称；“名称 - 职业/专精”会同时显示两者。")}
          />
          <SettingsSwitch bind:checked={SETTINGS.history.general.state.showYourAbilityScore} label={t("showYourAbilityScore", "你的能力评分")} description={t("showYourAbilityScoreDescription", "显示你的能力评分")} />
          <SettingsSwitch bind:checked={SETTINGS.history.general.state.showOthersAbilityScore} label={t("showOthersAbilityScore", "他人能力评分")} description={t("showOthersAbilityScoreDescription", "显示他人的能力评分")} />
          <SettingsSwitch bind:checked={SETTINGS.history.general.state.showYourSeasonStrength} label={t("showYourSeasonStrength", "你的赛季强度")} description={t("showYourSeasonStrengthDescription", "显示你的赛季强度")} />
          <SettingsSwitch bind:checked={SETTINGS.history.general.state.showOthersSeasonStrength} label={t("showOthersSeasonStrength", "他人赛季强度")} description={t("showOthersSeasonStrengthDescription", "显示他人的赛季强度")} />
          <SettingsSwitch bind:checked={SETTINGS.history.general.state.showPlayerImagineBadges} label={t("showPlayerImagineBadges", "Battle Imagine Badges")} description={t("showPlayerImagineBadgesDescription", "Show equipped battle imagine badges beside each player's class icon.")} />
          <SettingsSlider
            bind:value={SETTINGS.history.general.state.playerImagineBadgeScale}
            min={25}
            max={250}
            step={5}
            unit="%"
            label={t("playerImagineBadgeScale", "Battle Imagine Badge Size")}
            description={t("playerImagineBadgeScaleDescription", "Scale battle imagine badges in history player rows without changing class icon size.")}
          />
          <SettingsSwitch bind:checked={SETTINGS.history.general.state.showOceanWeaponBadge} label={t("showOceanWeaponBadge", "Ocean Weapon Badge")} description={t("showOceanWeaponBadgeDescription", "Show the ocean weapon badge before player names when detected.")} />
          <SettingsSlider
            bind:value={SETTINGS.history.general.state.oceanWeaponBadgeScale}
            min={25}
            max={250}
            step={5}
            unit="%"
            label={t("oceanWeaponBadgeScale", "Ocean Weapon Badge Size")}
            description={t("oceanWeaponBadgeScaleDescription", "Scale ocean weapon badges in history player rows without changing class icon size.")}
          />
          <SettingsSlider
            bind:value={SETTINGS.history.general.state.historyGraphBucketSeconds}
            min={1}
            max={10}
            step={1}
            unit="s"
            label={t("historyGraphBucketSeconds", "Graph bucket size")}
            description={t("historyGraphBucketSecondsDescription", "Controls how much timeline data is grouped into each graph point. Smaller values show sharper spikes; larger values smooth noise. Default: 5 secs.")}
          />
          <SettingsSlider
            bind:value={SETTINGS.history.general.state.historyGraphWindowSeconds}
            min={10}
            max={30}
            step={1}
            unit="s"
            label={t("historyGraphWindowSeconds", "Graph moving window")}
            description={t("historyGraphWindowSecondsDescription", "Controls the rolling window used by the moving-average graph. Smaller values react faster; larger values smooth longer bursts. Default: 15 secs.")}
          />
          <SettingsSelect
            bind:selected={SETTINGS.history.general.state.historyGraphGuideLineStyle}
            values={[
              { label: t("historyGraphGuideLineStyle.option.solid", "Solid"), value: "solid" },
              { label: t("historyGraphGuideLineStyle.option.dotted", "Dotted"), value: "dotted" },
              { label: t("historyGraphGuideLineStyle.option.dashed", "Dashed"), value: "dashed" },
            ]}
            label={t("historyGraphGuideLineStyle", "Graph guide line style")}
            description={t("historyGraphGuideLineStyleDescription", "Choose how horizontal guide lines are drawn behind history graph values.")}
          />
          <SettingsSwitch bind:checked={SETTINGS.history.general.state.relativeToTopDPSPlayer} label={t("relativeToTopDPSPlayer", "以最高 DPS 为基准（玩家）")} description={t("relativeToTopDPSPlayerDescription", "颜色条按最高 DPS 玩家进行相对缩放，而不是按所有玩家。适用于 20 人或世界 Boss。")} />
          <SettingsSwitch bind:checked={SETTINGS.history.general.state.relativeToTopDPSSkill} label={t("relativeToTopDPSSkill", "以最高 DPS 为基准（技能）")} description={t("relativeToTopDPSSkillDescription", "颜色条按最高 DPS 技能进行相对缩放，而不是按所有技能。适用于 20 人或世界 Boss。")} />
          <SettingsSwitch bind:checked={SETTINGS.history.general.state.relativeToTopHealPlayer} label={t("relativeToTopHealPlayer", "以最高治疗为基准（玩家）")} description={t("relativeToTopHealPlayerDescription", "颜色条按最高治疗玩家进行相对缩放，而不是按所有玩家。适用于 20 人或世界 Boss。")} />
          <SettingsSwitch bind:checked={SETTINGS.history.general.state.relativeToTopHealSkill} label={t("relativeToTopHealSkill", "以最高治疗为基准（技能）")} description={t("relativeToTopHealSkillDescription", "颜色条按最高治疗技能进行相对缩放，而不是按所有技能。适用于 20 人或世界 Boss。")} />
          <SettingsSwitch bind:checked={SETTINGS.history.general.state.relativeToTopTankedPlayer} label={t("relativeToTopTankedPlayer", "以最高承伤为基准（玩家）")} description={t("relativeToTopTankedPlayerDescription", "颜色条按最高承伤玩家进行相对缩放，而不是按所有玩家。适用于 20 人或世界 Boss。")} />
          <SettingsSwitch bind:checked={SETTINGS.history.general.state.relativeToTopTankedSkill} label={t("relativeToTopTankedSkill", "以最高承伤为基准（技能）")} description={t("relativeToTopTankedSkillDescription", "颜色条按最高承伤技能进行相对缩放，而不是按所有技能。适用于 20 人或世界 Boss。")} />
          <SettingsSwitch bind:checked={SETTINGS.history.general.state.shortenTps} label={t("shortenTps", "缩写 TPS 数值")} description={t("shortenTpsDescription", "将 TPS 显示为 5k、50k 等")} />
          <SettingsSwitch bind:checked={SETTINGS.history.general.state.shortenAbilityScore} label={t("shortenAbilityScore", "缩写能力评分")} description={t("shortenAbilityScoreDescription", "将能力评分显示为缩写形式")} />
          <SettingsSwitch bind:checked={SETTINGS.history.general.state.shortenDps} label={t("shortenDps", "缩写 DPS 数值")} description={t("shortenDpsDescription", "将 DPS 显示为 5k、50k 等")} />
          <SettingsSelect
            bind:selected={SETTINGS.history.general.state.abbreviatedDecimalPlaces}
            label={t("abbreviatedDecimalPlaces", "缩写小数位数")}
            description={t("abbreviatedDecimalPlacesDescription", "设置玩家表与技能明细中的 DPS/HPS/TPS 等缩写数值保留的小数位数")}
            values={[
              { label: t("abbreviatedDecimalPlaces.option1", "1位 (1.2m)"), value: 1 },
              { label: t("abbreviatedDecimalPlaces.option2", "2位 (1.23m)"), value: 2 },
              { label: t("abbreviatedDecimalPlaces.option3", "3位 (1.234m)"), value: 3 },
              { label: t("abbreviatedDecimalPlaces.option4", "4位 (1.2345m)"), value: 4 },
            ]}
          />
          <SettingsSwitch
            bind:checked={SETTINGS.live.general.state.modifierReportsEnabled}
            label={t("modifierReportsEnabled", "Enable Modifier (WIP) Analysis")}
            description={t("modifierReportsEnabledDescription", "Captures and calculates WIP modifier evidence for history reports. Leave this off for lower CPU usage and normal DPS/monitor behavior.")}
          />
        </div>
      {/if}
    </div>

    <div class="bg-popover/40 rounded-lg border border-border/50 overflow-hidden">
      <button
        type="button"
        class="w-full flex items-center justify-between px-4 py-3 hover:bg-popover/50 transition-colors"
        onclick={() => toggleSection('summary')}
      >
        <h2 class="text-base font-semibold text-foreground">{t("summaryFields", "Summary Fields")}</h2>
        <ChevronDown class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.summary ? 'rotate-180' : ''}" />
      </button>
      {#if expandedSections.summary}
        <div class="px-4 pb-4 space-y-4">
          <p class="text-sm text-muted-foreground">{t("summaryFieldsDescription", "Choose which stats appear in the history summary panel.")}</p>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <SettingsSlider
              bind:value={SETTINGS.history.summary.state.style.headingFontSize}
              min={8}
              max={18}
              step={1}
              unit="px"
              label={t("summaryHeadingFontSize", "Summary Header Font Size")}
              description={t("summaryHeadingFontSizeDescription", "Controls the section headers in the history summary panel.")}
            />
            <SettingsSlider
              bind:value={SETTINGS.history.summary.state.style.labelFontSize}
              min={8}
              max={18}
              step={1}
              unit="px"
              label={t("summaryLabelFontSize", "Summary Label Font Size")}
              description={t("summaryLabelFontSizeDescription", "Controls summary field labels.")}
            />
            <SettingsSlider
              bind:value={SETTINGS.history.summary.state.style.valueFontSize}
              min={8}
              max={20}
              step={1}
              unit="px"
              label={t("summaryValueFontSize", "Summary Value Font Size")}
              description={t("summaryValueFontSizeDescription", "Controls summary field values.")}
            />
          </div>
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {#each summaryFieldGroups as group}
              <section class="rounded-md border border-border/40 bg-background/30 p-3">
                <h3 class="text-sm font-semibold text-foreground mb-2">{summaryGroupLabel(group)}</h3>
                <div class="space-y-1">
                  {#each group.fields as field}
                    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(10rem,16rem)] gap-2 rounded-md border border-border/30 bg-background/25 p-2">
                      <SettingsSwitch
                        checked={summaryFieldEnabled(group.key, field.key)}
                        onchange={(checked) => setSummaryFieldEnabled(group.key, field.key, checked)}
                        label={summaryFieldLabel(field)}
                        description={summaryFieldDescription(field)}
                      />
                      <label class="flex min-w-0 flex-col justify-center gap-1">
                        <span class="text-xs font-medium text-muted-foreground">{t("summaryAliasPlaceholder", "Alias")}</span>
                        <input
                          class="w-full rounded-md border border-border bg-popover px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                          value={summaryAliasValue(group.key, field.key)}
                          placeholder={summaryFieldLabel(field)}
                          oninput={(event) => setSummaryAlias(group.key, field.key, event.currentTarget.value)}
                        />
                      </label>
                    </div>
                  {/each}
                </div>
              </section>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div class="bg-popover/40 rounded-lg border border-border/50 overflow-hidden">
      <button
        type="button"
        class="w-full flex items-center justify-between px-4 py-3 hover:bg-popover/50 transition-colors"
        onclick={() => toggleSection('dpsPlayers')}
      >
        <h2 class="text-base font-semibold text-foreground">{t("playerColumns", "DPS（玩家）列")}</h2>
        <ChevronDown class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.dpsPlayers ? 'rotate-180' : ''}" />
      </button>
      {#if expandedSections.dpsPlayers}
        <div class="px-4 pb-3 space-y-1">
          <ColumnSettingsList
            columns={historyDpsPlayerColumns}
            visibilityState={SETTINGS.history.dps.players.state}
            orderState={SETTINGS.history.columnOrder.dpsPlayers.state}
            aliasState={SETTINGS.history.columnAliases.state}
            aliasPlaceholder={t("columnAliasPlaceholder", "Alias")}
            hiddenKeys={hiddenDpsColumns}
            hint={t("reorderColumnsHint", "Use the arrows to reorder; use the switches to show or hide columns.")}
            {colLabel}
            {colDescription}
          />
        </div>
      {/if}
    </div>

    <div class="bg-popover/40 rounded-lg border border-border/50 overflow-hidden">
      <button
        type="button"
        class="w-full flex items-center justify-between px-4 py-3 hover:bg-popover/50 transition-colors"
        onclick={() => toggleSection('dpsSkills')}
      >
        <h2 class="text-base font-semibold text-foreground">{t("skillColumns", "DPS（技能明细）列")}</h2>
        <ChevronDown class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.dpsSkills ? 'rotate-180' : ''}" />
      </button>
      {#if expandedSections.dpsSkills}
        <div class="px-4 pb-3 space-y-1">
          <ColumnSettingsList
            columns={historyDpsSkillColumns}
            visibilityState={SETTINGS.history.dps.skillBreakdown.state}
            orderState={SETTINGS.history.columnOrder.dpsSkills.state}
            aliasState={SETTINGS.history.columnAliases.state}
            aliasPlaceholder={t("columnAliasPlaceholder", "Alias")}
            hiddenKeys={hiddenDpsColumns}
            hint={t("reorderColumnsHint", "Use the arrows to reorder; use the switches to show or hide columns.")}
            {colLabel}
            {colDescription}
          />
        </div>
      {/if}
    </div>

    <div class="bg-popover/40 rounded-lg border border-border/50 overflow-hidden">
      <button
        type="button"
        class="w-full flex items-center justify-between px-4 py-3 hover:bg-popover/50 transition-colors"
        onclick={() => toggleSection('healPlayers')}
      >
        <h2 class="text-base font-semibold text-foreground">{t("healPlayerColumns", "治疗（玩家）列")}</h2>
        <ChevronDown class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.healPlayers ? 'rotate-180' : ''}" />
      </button>
      {#if expandedSections.healPlayers}
        <div class="px-4 pb-3 space-y-1">
          <ColumnSettingsList
            columns={historyHealPlayerColumns}
            visibilityState={SETTINGS.history.heal.players.state}
            orderState={SETTINGS.history.columnOrder.healPlayers.state}
            aliasState={SETTINGS.history.columnAliases.state}
            aliasPlaceholder={t("columnAliasPlaceholder", "Alias")}
            hint={t("reorderColumnsHint", "Use the arrows to reorder; use the switches to show or hide columns.")}
            {colLabel}
            {colDescription}
          />
        </div>
      {/if}
    </div>

    <div class="bg-popover/40 rounded-lg border border-border/50 overflow-hidden">
      <button
        type="button"
        class="w-full flex items-center justify-between px-4 py-3 hover:bg-popover/50 transition-colors"
        onclick={() => toggleSection('healSkills')}
      >
        <h2 class="text-base font-semibold text-foreground">{t("healSkillColumns", "治疗（技能明细）列")}</h2>
        <ChevronDown class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.healSkills ? 'rotate-180' : ''}" />
      </button>
      {#if expandedSections.healSkills}
        <div class="px-4 pb-3 space-y-1">
          <ColumnSettingsList
            columns={historyHealSkillColumns}
            visibilityState={SETTINGS.history.heal.skillBreakdown.state}
            orderState={SETTINGS.history.columnOrder.healSkills.state}
            aliasState={SETTINGS.history.columnAliases.state}
            aliasPlaceholder={t("columnAliasPlaceholder", "Alias")}
            hint={t("reorderColumnsHint", "Use the arrows to reorder; use the switches to show or hide columns.")}
            {colLabel}
            {colDescription}
          />
        </div>
      {/if}
    </div>

    <div class="bg-popover/40 rounded-lg border border-border/50 overflow-hidden">
      <button
        type="button"
        class="w-full flex items-center justify-between px-4 py-3 hover:bg-popover/50 transition-colors"
        onclick={() => toggleSection('tankedPlayers')}
      >
        <h2 class="text-base font-semibold text-foreground">{t("tankedPlayerColumns", "承伤（玩家）列")}</h2>
        <ChevronDown class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.tankedPlayers ? 'rotate-180' : ''}" />
      </button>
      {#if expandedSections.tankedPlayers}
        <div class="px-4 pb-3 space-y-1">
          <ColumnSettingsList
            columns={historyTankedPlayerColumns}
            visibilityState={SETTINGS.history.tanked.players.state}
            orderState={SETTINGS.history.columnOrder.tankedPlayers.state}
            aliasState={SETTINGS.history.columnAliases.state}
            aliasPlaceholder={t("columnAliasPlaceholder", "Alias")}
            hint={t("reorderColumnsHint", "Use the arrows to reorder; use the switches to show or hide columns.")}
            {colLabel}
            {colDescription}
          />
        </div>
      {/if}
    </div>

    <div class="bg-popover/40 rounded-lg border border-border/50 overflow-hidden">
      <button
        type="button"
        class="w-full flex items-center justify-between px-4 py-3 hover:bg-popover/50 transition-colors"
        onclick={() => toggleSection('tankedSkills')}
      >
        <h2 class="text-base font-semibold text-foreground">{t("tankedSkillColumns", "承伤（技能明细）列")}</h2>
        <ChevronDown class="w-5 h-5 text-muted-foreground transition-transform duration-200 {expandedSections.tankedSkills ? 'rotate-180' : ''}" />
      </button>
      {#if expandedSections.tankedSkills}
        <div class="px-4 pb-3 space-y-1">
          <ColumnSettingsList
            columns={historyTankedSkillColumns}
            visibilityState={SETTINGS.history.tanked.skillBreakdown.state}
            orderState={SETTINGS.history.columnOrder.tankedSkills.state}
            aliasState={SETTINGS.history.columnAliases.state}
            aliasPlaceholder={t("columnAliasPlaceholder", "Alias")}
            hint={t("reorderColumnsHint", "Use the arrows to reorder; use the switches to show or hide columns.")}
            {colLabel}
            {colDescription}
          />
        </div>
      {/if}
    </div>
  </div>
</Tabs.Content>
