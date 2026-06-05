<script lang="ts">
  import { notifySettingsChanged } from "$lib/settings-store";

  type SettingsSelectOption =
    | string
    | number
    | {
        label: string;
        value: string | number;
      };

  let {
    label = "",
    description = "",
    selected = $bindable(""),
    values = [],
  }: {
    label: string;
    description?: string | undefined;
    selected: string | number;
    values: SettingsSelectOption[];
  } = $props();
</script>

<div class="flex items-start gap-3 py-2.5 px-3">
  <div class="flex-1 min-w-0 space-y-2">
    <div>
      <!-- Replaced hard-coded neutral colors with semantic theme variables -->
      <div class="text-sm font-medium text-foreground">{label}</div>
      {#if description}
        <div class="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</div>
      {/if}
    </div>
    <div class="flex flex-wrap gap-2">
      {#each values as value (value)}
        {@const option = typeof value === "string"
          || typeof value === "number"
          ? { label: value, value }
          : value}
        <button
          type="button"
          onclick={() => {
            selected = option.value;
            notifySettingsChanged();
          }}
          class="px-3 py-1.5 rounded-md text-xs font-medium transition-all {selected === option.value
            ? 'bg-muted text-foreground shadow-sm border border-border'
            : 'bg-popover/50 text-muted-foreground hover:bg-popover/70 hover:text-foreground border border-border/60'}"
          style="background: {selected === option.value ? 'var(--muted)' : 'color-mix(in oklab, var(--popover) 50%, transparent)'}; color: {selected === option.value ? 'var(--foreground)' : 'var(--muted-foreground)'}; border-color: var(--border);"
        >
          {option.label}
        </button>
      {/each}
    </div>
  </div>
</div>
