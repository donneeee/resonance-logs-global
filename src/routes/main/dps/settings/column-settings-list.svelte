<script lang="ts">
  import {
    columnAliasKey,
    columnAliasValue,
    type ColumnAliasState,
    type ColumnDefinition,
  } from "$lib/column-data";
  import { notifySettingsChanged } from "$lib/settings-store";
  import ChevronDown from "virtual:icons/lucide/chevron-down";
  import ChevronUp from "virtual:icons/lucide/chevron-up";
  import SettingsSwitch from "./settings-switch.svelte";

  type ColumnVisibilityState = Record<string, boolean | undefined>;
  type ColumnOrderState = { order: string[] };

  let {
    columns,
    visibilityState,
    orderState,
    hiddenKeys = [],
    hint = "",
    colLabel,
    colDescription,
    aliasState,
    aliasPlaceholder = "Alias",
  }: {
    columns: readonly ColumnDefinition[];
    visibilityState: ColumnVisibilityState;
    orderState: ColumnOrderState;
    hiddenKeys?: string[];
    hint?: string;
    colLabel: (col: ColumnDefinition) => string;
    colDescription: (col: ColumnDefinition) => string;
    aliasState?: ColumnAliasState;
    aliasPlaceholder?: string;
  } = $props();

  const hiddenKeySet = $derived(new Set(hiddenKeys));
  const columnKeys = $derived(columns.map((column) => column.key));
  const fullOrder = $derived([
    ...orderState.order.filter((key) => columnKeys.includes(key)),
    ...columnKeys.filter((key) => !orderState.order.includes(key)),
  ]);
  const visibleOrder = $derived(fullOrder.filter((key) => !hiddenKeySet.has(key)));

  function moveColumn(visibleIndex: number, direction: -1 | 1) {
    const currentKey = visibleOrder[visibleIndex];
    const swapKey = visibleOrder[visibleIndex + direction];
    if (!currentKey || !swapKey) return;

    const nextOrder = [...fullOrder];
    const currentIndex = nextOrder.indexOf(currentKey);
    const swapIndex = nextOrder.indexOf(swapKey);
    if (currentIndex < 0 || swapIndex < 0) return;

    nextOrder[currentIndex] = swapKey;
    nextOrder[swapIndex] = currentKey;
    orderState.order = nextOrder;
    notifySettingsChanged();
  }

  function setColumnAlias(col: ColumnDefinition, value: string) {
    if (!aliasState) return;
    aliasState[columnAliasKey(col)] = value;
    notifySettingsChanged();
  }
</script>

{#if hint}
  <p class="text-xs text-muted-foreground mb-2">
    {hint}
  </p>
{/if}

{#each visibleOrder as colKey, idx (colKey)}
  {@const col = columns.find((column) => column.key === colKey)}
  {#if col}
    <div class="flex items-center gap-2 px-2 py-1 rounded bg-muted/20 border border-border/30">
      <div class="flex flex-col">
        <button
          type="button"
          class="p-0.5 hover:bg-muted/50 rounded disabled:opacity-30"
          disabled={idx === 0}
          onclick={() => moveColumn(idx, -1)}
          aria-label="Move column up"><ChevronUp class="size-3" /></button
        >
        <button
          type="button"
          class="p-0.5 hover:bg-muted/50 rounded disabled:opacity-30"
          disabled={idx === visibleOrder.length - 1}
          onclick={() => moveColumn(idx, 1)}
          aria-label="Move column down"><ChevronDown class="size-3" /></button
        >
      </div>
      <div class="min-w-0 flex-1">
        <SettingsSwitch
          bind:checked={visibilityState[col.key]}
          label={colLabel(col)}
          description={colDescription(col)}
        />
      </div>
      {#if aliasState}
        <input
          type="text"
          class="h-9 w-36 shrink-0 rounded-md border border-border/60 bg-background/80 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/70 focus:ring-2 focus:ring-primary/30"
          value={columnAliasValue(aliasState, col)}
          placeholder={aliasPlaceholder}
          aria-label={`Alias for ${colLabel(col)}`}
          oninput={(event) => setColumnAlias(col, event.currentTarget.value)}
        />
      {/if}
    </div>
  {/if}
{/each}
