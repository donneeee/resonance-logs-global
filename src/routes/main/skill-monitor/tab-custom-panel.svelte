<script lang="ts">
  import BuffSearchResultGrid from "$lib/components/BuffSearchResultGrid.svelte";
  import type { BuffDefinition, BuffNameInfo } from "$lib/config/buff-name-table";
  import type {
    CustomPanelGroup,
    CustomPanelGroupKind,
    CustomPanelStyle,
    InlineBuffEntry,
  } from "$lib/settings-store";
  import type { CounterRulePreset, SourceTemplate, SlotTemplate } from "$lib/skill-mappings";
  import { SETTINGS } from "$lib/settings-store";
  import { uiT } from "$lib/i18n";

  type CounterRuleOption = CounterRulePreset & { origin: "preset" | "user" };

  interface Props {
    counterRules: CounterRuleOption[];
    sourceTemplates: SourceTemplate[];
    slotTemplates: SlotTemplate[];
    availableBuffMap: Map<number, BuffDefinition>;
    getBuffDisplayName: (buffId: number) => string;
    inlineBuffSearch: string;
    filteredInlineBuffSearchResults: BuffNameInfo[];
    customPanelGroups: CustomPanelGroup[];
    factorSlotLabels: Record<string, string>;
    setFactorSlotLabel: (slotTemplateId: string, name: string) => void;
    setInlineBuffSearch: (value: string) => void;
    addCustomPanelGroup: (kind?: CustomPanelGroupKind) => void;
    removeCustomPanelGroup: (groupId: string) => void;
    renameCustomPanelGroup: (groupId: string, name: string) => void;
    setCustomPanelGroupHideZeroCounters: (
      groupId: string,
      checked: boolean,
    ) => void;
    setCustomPanelGroupAutoShowStasisFactors: (
      groupId: string,
      checked: boolean,
    ) => void;
    updateCustomPanelGroupStyle: (
      groupId: string,
      updater: (style: CustomPanelStyle) => CustomPanelStyle,
    ) => void;
    addCustomPanelEntry: (
      groupId: string,
      sourceType: "buff" | "counter",
      sourceId: number,
      counterSlotId?: number,
    ) => void;
    addUserCounterRule: (name: string, sourceRefs: string[], slotRefs: string[]) => void;
    removeUserCounterRule: (ruleId: number) => void;
    removeCustomPanelEntry: (groupId: string, entryId: string) => void;
    setCustomPanelEntryLabel: (groupId: string, entryId: string, label: string) => void;
    setCustomPanelEntryHideWhenZero: (
      groupId: string,
      entryId: string,
      checked: boolean,
    ) => void;
    moveCustomPanelEntry: (
      groupId: string,
      entryId: string,
      direction: "up" | "down",
    ) => void;
  }

  const t = uiT("overlay/skill-monitor/custom-panel", () => SETTINGS.live.general.state.language);

  let {
    counterRules,
    sourceTemplates,
    slotTemplates,
    availableBuffMap,
    getBuffDisplayName,
    inlineBuffSearch,
    filteredInlineBuffSearchResults,
    customPanelGroups,
    factorSlotLabels,
    setFactorSlotLabel,
    setInlineBuffSearch,
    addCustomPanelGroup,
    removeCustomPanelGroup,
    renameCustomPanelGroup,
    setCustomPanelGroupHideZeroCounters,
    setCustomPanelGroupAutoShowStasisFactors,
    updateCustomPanelGroupStyle,
    addCustomPanelEntry,
    addUserCounterRule,
    removeUserCounterRule,
    removeCustomPanelEntry,
    setCustomPanelEntryLabel,
    setCustomPanelEntryHideWhenZero,
    moveCustomPanelEntry,
  }: Props = $props();

  let selectedGroupId = $state<string | null>(null);
  let isCreatingUserRule = $state(false);
  let draftRuleName = $state("");
  let draftSourceRefs = $state<string[]>([]);
  let draftSlotRefs = $state<string[]>([]);
  let factorSlotSearch = $state("");

  $effect(() => {
    if (customPanelGroups.length === 0) {
      selectedGroupId = null;
      return;
    }
    if (!selectedGroupId || !customPanelGroups.some((group) => group.id === selectedGroupId)) {
      selectedGroupId = customPanelGroups[0]?.id ?? null;
    }
  });

  const selectedGroup = $derived.by(
    () => customPanelGroups.find((group) => group.id === selectedGroupId) ?? null,
  );
  const isSelectedManualGroup = $derived(selectedGroup?.kind !== "seasonCultivateFactor");
  const slotTemplateMap = $derived.by(
    () => new Map(slotTemplates.map((template) => [template.slotTemplateId, template])),
  );
  const customizedFactorSlots = $derived.by(() =>
    Object.entries(factorSlotLabels)
      .map(([slotTemplateId, label]) => ({
        slotTemplateId,
        label,
        template: slotTemplateMap.get(slotTemplateId) ?? null,
      }))
      .sort((left, right) =>
        (left.template?.name ?? left.slotTemplateId).localeCompare(
          right.template?.name ?? right.slotTemplateId,
        ),
      ),
  );
  const filteredSlotTemplates = $derived.by(() => {
    const keyword = factorSlotSearch.trim().toLowerCase();
    if (!keyword) return [] as SlotTemplate[];
    return slotTemplates.filter(
      (template) =>
        template.name.toLowerCase().includes(keyword) ||
        template.description.toLowerCase().includes(keyword) ||
        template.slotTemplateId.toLowerCase().includes(keyword),
    );
  });
  const canSaveDraftRule = $derived(
    draftRuleName.trim().length > 0 && draftSourceRefs.length > 0 && draftSlotRefs.length > 0,
  );

  function getEntryLocation(
    sourceType: InlineBuffEntry["sourceType"],
    sourceId: number,
    counterSlotId?: number,
  ): { groupId: string; groupName: string } | null {
    for (const group of customPanelGroups) {
      if (group.kind === "seasonCultivateFactor") continue;
      if (group.entries.some((entry) =>
        entry.sourceType === sourceType
        && entry.sourceId === sourceId
        && (sourceType !== "counter" || entry.counterSlotId === counterSlotId)
      )) {
        return { groupId: group.id, groupName: group.name };
      }
    }
    return null;
  }

  function buffStatusLabel(buffId: number): string | null {
    const location = getEntryLocation("buff", buffId);
    if (!location) return null;
    return location.groupId === selectedGroup?.id ? t("currentGroupAdded", "Already in Current Group") : `${t("alreadyInGroup", "Already in ")}${location.groupName}`;
  }

  function toggleDraftRef(
    current: string[],
    value: string,
  ): string[] {
    return current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
  }

  function resetDraftRule() {
    draftRuleName = "";
    draftSourceRefs = [];
    draftSlotRefs = [];
    isCreatingUserRule = false;
  }

  function submitDraftRule() {
    if (!canSaveDraftRule) return;
    addUserCounterRule(draftRuleName, draftSourceRefs, draftSlotRefs);
    resetDraftRule();
  }

  function updateSelectedGroupStyle(
    updater: (style: CustomPanelStyle) => CustomPanelStyle,
  ) {
    if (!selectedGroup) return;
    updateCustomPanelGroupStyle(selectedGroup.id, updater);
  }

  function setSelectedGroupGap(value: number) {
    const nextValue = Math.max(0, Math.min(24, Math.round(value)));
    updateSelectedGroupStyle((style) => ({ ...style, gap: nextValue }));
  }

  function setSelectedGroupFontSize(value: number) {
    const nextValue = Math.max(10, Math.min(28, Math.round(value)));
    updateSelectedGroupStyle((style) => ({ ...style, fontSize: nextValue }));
  }

  function setSelectedGroupColumnGap(value: number) {
    const nextValue = Math.max(0, Math.min(240, Math.round(value)));
    updateSelectedGroupStyle((style) => ({ ...style, columnGap: nextValue }));
  }

  function setSelectedGroupNameColor(value: string) {
    updateSelectedGroupStyle((style) => ({ ...style, nameColor: value }));
  }

  function setSelectedGroupValueColor(value: string) {
    updateSelectedGroupStyle((style) => ({ ...style, valueColor: value }));
  }

  function setSelectedGroupProgressColor(value: string) {
    updateSelectedGroupStyle((style) => ({ ...style, progressColor: value }));
  }

  function setSelectedGroupProgressOpacity(value: number) {
    updateSelectedGroupStyle((style) => ({
      ...style,
      progressOpacity: Math.max(0, Math.min(1, value)),
    }));
  }
</script>

<div class="space-y-6">
  <div class="rounded-lg border border-border/60 bg-card/40 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)] space-y-4">
    <div>
      <h2 class="text-base font-semibold text-foreground">{t("customPanel.title", "Custom Monitor Areas")}</h2>
      <p class="text-xs text-muted-foreground">
        {t("customPanel.subtitle", "Create multiple text monitor areas. The same buff or counter is globally unique across all areas.")}
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <button
        type="button"
        class="min-h-11 rounded-lg border border-border/60 bg-muted/20 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 cursor-pointer"
        onclick={() => addCustomPanelGroup("manual")}
      >
        {t("customPanel.newGroup", "New Monitor Area")}
      </button>
      <button
        type="button"
        class="min-h-11 rounded-lg border border-border/60 bg-muted/20 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 cursor-pointer"
        onclick={() => addCustomPanelGroup("seasonCultivateFactor")}
      >
        {t("customPanel.newFactor", "New Factor Area")}
      </button>
      <div class="text-xs text-muted-foreground" role="status" aria-live="polite">
        {#if selectedGroup}
          {t("customPanel.editing", "Currently Editing: ")}{selectedGroup.name}
        {:else}
          {t("customPanel.selectOrCreate", "Please select or create a monitor area")}
        {/if}
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {#each customPanelGroups as group (group.id)}
        {@const isSelected = group.id === selectedGroup?.id}
        <div
          class="rounded-lg border px-3 py-3 transition-colors {isSelected
            ? 'border-primary bg-primary/10'
            : 'border-border/60 bg-muted/20'}"
        >
          <div class="flex items-start justify-between gap-3">
            <button
              type="button"
              class="flex-1 text-left cursor-pointer"
              onclick={() => (selectedGroupId = group.id)}
            >
              <div class="text-sm font-medium text-foreground">{group.name}</div>
              <div class="mt-1 text-xs text-muted-foreground">
                {#if group.kind === "seasonCultivateFactor"}
                  {t("customPanel.newFactor", "New Factor Area")}
                {:else}
                  {t("entries", "Entries")} {group.entries.length}
                {/if}
              </div>
            </button>
            <button
              type="button"
              class="min-h-11 rounded-md border border-border/60 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10 cursor-pointer"
              onclick={() => removeCustomPanelGroup(group.id)}
            >
              {t("deleteGroup", "Delete Group")}
            </button>
          </div>
        </div>
      {/each}
    </div>
  </div>

  {#if selectedGroup}
    <div class="rounded-lg border border-border/60 bg-card/40 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)] space-y-4">
      <div class="space-y-1">
        <div class="text-sm font-medium text-foreground">{t("customPanel.currentGroup", "Current Monitor Area")}</div>
        <p class="text-xs text-muted-foreground">
          {t("customPanel.currentGroupDescription", "Entries in this area are shown in the overlay as an independent text block and can be dragged and resized separately.")}
        </p>
      </div>
      <label class="block text-xs text-muted-foreground">
        {t("customPanel.groupName", "Monitor Area Name")}
        <input
          class="mt-1 w-full max-w-sm rounded border border-border/60 bg-muted/30 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          value={selectedGroup.name}
          oninput={(event) =>
            renameCustomPanelGroup(selectedGroup.id, (event.currentTarget as HTMLInputElement).value)}
        />
      </label>
    </div>

    {#if isSelectedManualGroup}
    <div class="rounded-lg border border-border/60 bg-card/40 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)] space-y-3">
      <div class="space-y-1">
        <div class="text-sm font-medium text-foreground">{t("customPanel.addBuff", "Add Buff")}</div>
        <p class="text-xs text-muted-foreground">{t("customPanel.addBuffDescription", "Add only to the current monitor area text block")}</p>
      </div>
      <input
        class="w-full sm:w-80 rounded border border-border/60 bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        placeholder={t("customPanel.searchAddBuff", "Search and add buff")}
        value={inlineBuffSearch}
        oninput={(event) => setInlineBuffSearch((event.currentTarget as HTMLInputElement).value)}
      />
      {#if inlineBuffSearch.trim().length > 0}
        <BuffSearchResultGrid
          items={filteredInlineBuffSearchResults}
          {availableBuffMap}
          onSelect={(buffId) => addCustomPanelEntry(selectedGroup.id, "buff", buffId)}
          isDisabled={(buffId) => Boolean(getEntryLocation("buff", buffId))}
          getStatusLabel={buffStatusLabel}
          emptyMessage={t("noMatchingBuff", "No matching buffs")}
        />
      {/if}
    </div>

    <div class="rounded-lg border border-border/60 bg-card/40 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)] space-y-3">
      <div class="space-y-1">
        <div class="text-sm font-medium text-foreground">{t("customPanel.addCounter", "Add Counter")}</div>
        <p class="text-xs text-muted-foreground">{t("customPanel.addCounterDescription", "Counters are also globally unique and can only belong to one monitor area.")}</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
        {#each counterRules as rule (rule.ruleId)}
          {@const location = getEntryLocation("counter", rule.ruleId)}
          {@const exists = Boolean(location)}
          <div
            role="button"
            tabindex="0"
            class="min-h-11 rounded-lg border border-border/60 bg-muted/20 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 cursor-pointer"
            onclick={() => {
              isCreatingUserRule = !isCreatingUserRule;
              if (!isCreatingUserRule) {
                draftRuleName = "";
                draftSourceRefs = [];
                draftSlotRefs = [];
              }
            }}
            onkeydown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                isCreatingUserRule = !isCreatingUserRule;
                if (!isCreatingUserRule) {
                  draftRuleName = "";
                  draftSourceRefs = [];
                  draftSlotRefs = [];
                }
              }
            }}
          >
            <div class="flex items-center justify-between gap-2">
              <div class="text-sm font-medium text-foreground">{rule.name}</div>
              <div class="text-xs {exists ? 'text-primary' : 'text-muted-foreground'}">
                {#if !exists}
                  {t("clickToAdd", "Click to Add")}
                {:else if location?.groupId === selectedGroup.id}
                  {t("currentGroupAdded", "Already in Current Group")}
                {:else}
                  {t("alreadyInGroup", "Already in ")}{location?.groupName}
                {/if}
              </div>
              <button
                type="button"
                class="min-h-11 rounded-md border border-border/60 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10 cursor-pointer"
                onclick={(event) => { event.stopPropagation(); removeUserCounterRule(rule.ruleId); }}
              >
                {t("delete", "Delete")}
              </button>
            </div>
          </div>
        {/each}
      </div>

      {#if isCreatingUserRule}
        <div class="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-4">
          <label class="block text-xs text-muted-foreground">
            {t("customPanel.ruleName", "Rule Name")}
            <input
              class="mt-1 w-full rounded border border-border/60 bg-muted/30 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              value={draftRuleName}
              placeholder={t("customPanel.ruleNamePlaceholder", "For example: Iaijutsu + Tick Energy")}
              oninput={(event) => (draftRuleName = (event.currentTarget as HTMLInputElement).value)}
            />
          </label>

          <div class="space-y-2">
            <div class="text-sm font-medium text-foreground">{t("customPanel.selectSources", "Select Sources")}</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              {#each sourceTemplates as template (template.sourceId)}
                {@const selected = draftSourceRefs.includes(template.sourceId)}
                <button
                  type="button"
                  class="min-h-11 text-left rounded border px-3 py-2 transition-colors cursor-pointer {selected
                    ? 'border-primary bg-primary/10'
                    : 'border-border/60 bg-muted/20 hover:bg-muted/40'}"
                  onclick={() => (draftSourceRefs = toggleDraftRef(draftSourceRefs, template.sourceId))}
                >
                  <div class="text-sm font-medium text-foreground">{template.name}</div>
                </button>
              {/each}
            </div>
          </div>

          <div class="space-y-2">
            <div class="text-sm font-medium text-foreground">{t("customPanel.selectSlots", "Select Slots")}</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              {#each slotTemplates as template (template.slotTemplateId)}
                {@const selected = draftSlotRefs.includes(template.slotTemplateId)}
                <button
                  type="button"
                  class="min-h-11 text-left rounded border px-3 py-2 transition-colors cursor-pointer {selected
                    ? 'border-primary bg-primary/10'
                    : 'border-border/60 bg-muted/20 hover:bg-muted/40'}"
                  onclick={() => (draftSlotRefs = toggleDraftRef(draftSlotRefs, template.slotTemplateId))}
                >
                  <div class="text-sm font-medium text-foreground">{template.name}</div>
                </button>
              {/each}
            </div>
          </div>

          <div class="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              class="min-h-11 rounded border border-border/60 px-4 py-2 text-sm text-foreground hover:bg-muted/40 cursor-pointer"
              onclick={resetDraftRule}
            >
              {t("cancel", "Cancel")}
            </button>
            <button
              type="button"
              class="min-h-11 rounded border border-primary/60 bg-primary/15 px-4 py-2 text-sm font-medium text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
              onclick={submitDraftRule}
              disabled={!canSaveDraftRule}
            >
              {t("customPanel.saveRule", "Save Rule")}
            </button>
          </div>
        </div>
      {/if}
    </div>

    <div class="rounded-lg border border-border/60 bg-card/40 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)] space-y-3">
      <div class="space-y-1">
        <div class="text-sm font-medium text-foreground">{t("customPanel.addCounter", "Add Counter")}</div>
        <p class="text-xs text-muted-foreground">
          {t("customPanel.addCounterListDescription", "Counter slots are globally unique and can only belong to one monitor area. Preset and custom rules are shown together.")}
        </p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
        {#each counterRules as rule (rule.ruleId)}
          {#each rule.effectSlots as slot (slot.slotId)}
            {@const location = getEntryLocation("counter", rule.ruleId, slot.slotId)}
            {@const exists = Boolean(location)}
            <button
              type="button"
              class="min-h-11 text-left rounded border px-3 py-2 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-100 {exists
                ? 'border-primary bg-primary/10'
                : 'border-border/60 bg-muted/20 hover:bg-muted/40'}"
              onclick={() => addCustomPanelEntry(selectedGroup.id, "counter", rule.ruleId, slot.slotId)}
              disabled={exists}
            >
              <div class="flex items-center justify-between gap-2">
                <div>
                  <div class="text-sm font-medium text-foreground">
                    {rule.name}{rule.effectSlots.length > 1 ? ` #${slot.slotId}` : ""}
                  </div>
                  <div class="mt-1 text-xs text-muted-foreground">
                    <span class="inline-block rounded border border-border/60 bg-muted/30 px-1.5 py-0.5">
                      {rule.origin === "user" ? t("custom", "Custom") : t("preset", "Preset")}
                    </span>
                  </div>
                </div>
                <div class="text-xs {exists ? 'text-primary' : 'text-muted-foreground'}">
                  {#if !exists}
                    {t("clickToAdd", "Click to Add")}
                  {:else if location?.groupId === selectedGroup.id}
                    {t("currentGroupAdded", "Already in Current Group")}
                  {:else}
                    {t("alreadyInGroup", "Already in ")}{location?.groupName}
                  {/if}
                </div>
              </div>
            </button>
          {/each}
        {/each}
      </div>
    </div>

    <div class="rounded-lg border border-border/60 bg-card/40 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)] space-y-3">
      <div class="text-sm font-medium text-foreground">{t("customPanel.currentGroupEntries", "Current Group Entries")}</div>
      {#if selectedGroup.entries.length === 0}
        <div class="rounded-lg border border-dashed border-border/60 bg-muted/10 px-3 py-6 text-center text-sm text-muted-foreground">
          {t("customPanel.noEntries", "No entries in the current monitor area")}
        </div>
      {/if}
      {#each selectedGroup.entries as entry, idx (entry.id)}
        {@const counterRule = entry.sourceType === "counter"
          ? counterRules.find((item) => item.ruleId === entry.sourceId)
          : null}
        {@const buffName = entry.sourceType === "buff" ? getBuffDisplayName(entry.sourceId) : null}
        <div class="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
          <div class="text-xs text-muted-foreground">
            {t("source", "Source")}：{entry.sourceType === "counter"
              ? `${t("counter", "Counter")} - ${counterRule?.name ?? `#${entry.sourceId}`}`
              : `Buff - ${buffName}`}
          </div>
          {#if entry.sourceType === "counter"}
            <input
              class="w-full rounded border border-border/60 bg-muted/30 px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              value={entry.label}
              placeholder={t("displayName", "Display Name")}
              oninput={(event) =>
                setCustomPanelEntryLabel(
                  selectedGroup.id,
                  entry.id,
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <label class="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-border bg-muted/30 text-primary focus:ring-primary/50"
                checked={entry.hideWhenZero === true}
                onchange={(event) =>
                  setCustomPanelEntryHideWhenZero(
                    selectedGroup.id,
                    entry.id,
                    (event.currentTarget as HTMLInputElement).checked,
                  )}
              />
              <span>{t("customPanel.hideWhenZero", "Hide when count is 0")}</span>
            </label>
          {:else}
            <div class="rounded border border-border/60 bg-muted/30 px-2 py-1.5 text-sm text-foreground">
              {buffName}
            </div>
          {/if}
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="min-h-11 rounded border border-border/60 px-3 py-1 text-xs hover:bg-muted/40 disabled:opacity-50 cursor-pointer"
              onclick={() => moveCustomPanelEntry(selectedGroup.id, entry.id, "up")}
              disabled={idx === 0}
            >
              {t("moveUp", "Move Up")}
            </button>
            <button
              type="button"
              class="min-h-11 rounded border border-border/60 px-3 py-1 text-xs hover:bg-muted/40 disabled:opacity-50 cursor-pointer"
              onclick={() => moveCustomPanelEntry(selectedGroup.id, entry.id, "down")}
              disabled={idx === selectedGroup.entries.length - 1}
            >
              {t("moveDown", "Move Down")}
            </button>
            <button
              type="button"
              class="min-h-11 rounded border border-border/60 px-3 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10 cursor-pointer"
              onclick={() => removeCustomPanelEntry(selectedGroup.id, entry.id)}
            >
              {t("deleteGroup", "Delete Group")}
            </button>
          </div>
        </div>
      {/each}
    </div>
    {:else}
    <div class="rounded-lg border border-border/60 bg-card/40 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)] space-y-4">
      <div class="space-y-1">
        <div class="text-sm font-medium text-foreground">{t("customPanel.factorSlots.title", "Factor Display Names")}</div>
        <p class="text-xs text-muted-foreground">{t("customPanel.factorSlots.description", "Set custom display names for factor slots. Names are saved per slot template, so they persist across build switches whenever that slot is shown.")}</p>
      </div>

      <label class="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm text-foreground">
        <input
          type="checkbox"
          class="h-4 w-4 rounded border-border bg-muted/30 text-primary focus:ring-primary/50"
          checked={selectedGroup.hideZeroCounters === true}
          onchange={(event) =>
            setCustomPanelGroupHideZeroCounters(
              selectedGroup.id,
              (event.currentTarget as HTMLInputElement).checked,
            )}
        />
        <span>{t("customPanel.hideWhenZero", "Hide when count is 0")}</span>
      </label>

      <label class="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm text-foreground">
        <input
          type="checkbox"
          class="h-4 w-4 rounded border-border bg-muted/30 text-primary focus:ring-primary/50"
          checked={selectedGroup.autoShowStasisFactors !== false}
          onchange={(event) =>
            setCustomPanelGroupAutoShowStasisFactors(
              selectedGroup.id,
              (event.currentTarget as HTMLInputElement).checked,
            )}
        />
        <span>{t("customPanel.autoShowStasisFactors", "Auto-show Stasis factors")}</span>
      </label>

      {#if customizedFactorSlots.length > 0}
        <div class="space-y-2">
          <div class="text-xs font-medium text-muted-foreground">{t("customPanel.factorSlots.currentList", "Configured")}</div>
          {#each customizedFactorSlots as item (item.slotTemplateId)}
            <div class="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
              <div class="text-xs text-muted-foreground">
                {t("customPanel.factorSlots.defaultName", "Default: {name}").replace(
                  "{name}",
                  item.template?.name ?? item.slotTemplateId,
                )}
              </div>
              <div class="flex items-center gap-2">
                <input
                  class="flex-1 rounded border border-border/60 bg-muted/30 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={item.label}
                  placeholder={t("customPanel.factorSlots.customNamePlaceholder", "Custom display name")}
                  oninput={(event) =>
                    setFactorSlotLabel(item.slotTemplateId, (event.currentTarget as HTMLInputElement).value)}
                />
                <button
                  type="button"
                  class="min-h-11 rounded-md border border-border/60 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10 cursor-pointer"
                  onclick={() => setFactorSlotLabel(item.slotTemplateId, "")}
                >
                  {t("customPanel.factorSlots.clear", "Clear")}
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="space-y-2 border-t border-border/60 pt-4">
        <div class="text-xs font-medium text-muted-foreground">{t("customPanel.factorSlots.searchTitle", "Search & set")}</div>
        <input
          class="w-full sm:w-80 rounded border border-border/60 bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          placeholder={t("customPanel.factorSlots.searchPlaceholder", "Search factor slots (name / description)")}
          value={factorSlotSearch}
          oninput={(event) => (factorSlotSearch = (event.currentTarget as HTMLInputElement).value)}
        />
        {#if factorSlotSearch.trim().length > 0}
          {#if filteredSlotTemplates.length === 0}
            <div class="rounded-lg border border-dashed border-border/60 bg-muted/10 px-3 py-6 text-center text-sm text-muted-foreground">
              {t("customPanel.factorSlots.noMatch", "No matching factor slot")}
            </div>
          {:else}
            <div class="grid grid-cols-1 gap-2">
              {#each filteredSlotTemplates as template (template.slotTemplateId)}
                <div class="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
                  <div class="text-sm font-medium text-foreground">{template.name}</div>
                  {#if template.description}
                    <div class="text-xs text-muted-foreground">{template.description}</div>
                  {/if}
                  <input
                    class="w-full rounded border border-border/60 bg-muted/30 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={factorSlotLabels[template.slotTemplateId] ?? ""}
                    placeholder={t("customPanel.factorSlots.customNamePlaceholder", "Custom display name")}
                    oninput={(event) =>
                      setFactorSlotLabel(template.slotTemplateId, (event.currentTarget as HTMLInputElement).value)}
                  />
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </div>
    {/if}
  {:else}
    <div class="rounded-lg border border-border/60 bg-card/40 p-6 text-sm text-muted-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]">
      {t("customPanel.emptyState", "There are no custom monitor areas yet. Click “New Monitor Area” above first, then add buffs or counters.")}
    </div>
  {/if}

  {#if selectedGroup}
  <div class="rounded-lg border border-border/60 bg-card/40 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)] space-y-4">
    <div>
      <h2 class="text-base font-semibold text-foreground">{t("customPanel.sharedStyleTitle", "Shared Style")}</h2>
      <p class="text-xs text-muted-foreground">{t("customPanel.sharedStyleDescription", "All custom monitor areas share the following text and progress bar styles.")}</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      <label class="text-xs text-muted-foreground">
        {t("buff.gap", "Gap")}: {selectedGroup.style.gap}px
        <input
          class="mt-1 w-full"
          type="range"
          min="0"
          max="24"
          step="1"
          value={selectedGroup.style.gap}
          oninput={(event) => setSelectedGroupGap(Number((event.currentTarget as HTMLInputElement).value))}
        />
      </label>
      <label class="text-xs text-muted-foreground">
        {t("textBuff.fontSize", "Font Size")}: {selectedGroup.style.fontSize}px
        <input
          class="mt-1 w-full"
          type="range"
          min="10"
          max="28"
          step="1"
          value={selectedGroup.style.fontSize}
          oninput={(event) => setSelectedGroupFontSize(Number((event.currentTarget as HTMLInputElement).value))}
        />
      </label>
      <label class="text-xs text-muted-foreground">
        {t("textBuff.nameValueGap", "Name-Value Gap")}: {selectedGroup.style.columnGap}px
        <input
          class="mt-1 w-full"
          type="range"
          min="0"
          max="240"
          step="1"
          value={selectedGroup.style.columnGap}
          oninput={(event) => setSelectedGroupColumnGap(Number((event.currentTarget as HTMLInputElement).value))}
        />
      </label>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <label class="flex items-center justify-between gap-2 rounded border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        {t("nameColor", "Name Color")}
        <input
          type="color"
          value={selectedGroup.style.nameColor}
          class="h-7 w-12 rounded border border-border/60 bg-transparent p-0"
          onchange={(event) => setSelectedGroupNameColor((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="flex items-center justify-between gap-2 rounded border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        {t("valueColor", "Value Color")}
        <input
          type="color"
          value={selectedGroup.style.valueColor}
          class="h-7 w-12 rounded border border-border/60 bg-transparent p-0"
          onchange={(event) => setSelectedGroupValueColor((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="flex items-center justify-between gap-2 rounded border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        {t("progressColor", "Progress Bar Color")}
        <input
          type="color"
          value={selectedGroup.style.progressColor}
          class="h-7 w-12 rounded border border-border/60 bg-transparent p-0"
          onchange={(event) => setSelectedGroupProgressColor((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="rounded border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <div>{t("progressOpacity", "Progress Bar Opacity")}: {Math.round(selectedGroup.style.progressOpacity * 100)}%</div>
        <input
          class="mt-2 w-full"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={selectedGroup.style.progressOpacity}
          oninput={(event) =>
            setSelectedGroupProgressOpacity(Number((event.currentTarget as HTMLInputElement).value))}
        />
      </label>
    </div>
  </div>
  {/if}
</div>
