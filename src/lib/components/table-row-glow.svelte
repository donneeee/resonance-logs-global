<script lang="ts">
  import { activeProfileOrDefault } from "$lib/skill-monitor-profile.svelte";
  import { getClassRowGlowColor } from '$lib/utils.svelte';
  import { SETTINGS } from '$lib/settings-store';

  let {
    className,
    classSpecName = "",
    percentage,
    isSkill = false
  }: {
    className: string;
    classSpecName?: string;
    percentage: number;
    isSkill?: boolean;
  } = $props();

  let classColor = $derived.by(() =>
    getClassRowGlowColor(className, classSpecName, {
      highlightDpsHealerSpecIcons: activeProfileOrDefault().highlightDpsHealerSpecIcons === true,
    }),
  );
  let clampedPercentage = $derived(
    Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : 0,
  );

  // derive customization from live table settings using runes-friendly $derived
  // Choose skill-specific settings when rendering skill rows
  let mode = $derived.by(() => isSkill ? SETTINGS.live.tableCustomization.state.skillRowGlowMode : SETTINGS.live.tableCustomization.state.rowGlowMode);
  let opacity = $derived.by(() => isSkill ? SETTINGS.live.tableCustomization.state.skillRowGlowOpacity : SETTINGS.live.tableCustomization.state.rowGlowOpacity);
  let borderHeight = $derived(SETTINGS.live.tableCustomization.state.rowGlowBorderHeight);
  let rowBorderRadius = $derived.by(() => isSkill ? SETTINGS.live.tableCustomization.state.skillRowBorderRadius : SETTINGS.live.tableCustomization.state.rowBorderRadius);
  

  // glowColor is always the class/spec color
  let glowColor = $derived.by(() => classColor);

  let anchor: HTMLTableCellElement | undefined = $state();

  function percent(value: number): string {
    return `${Math.max(0, Math.min(100, value)).toFixed(3)}%`;
  }

  function alphaColor(color: string, alpha: number): string {
    const weight = Math.max(0, Math.min(100, alpha * 100));
    return `color-mix(in srgb, ${color} ${weight.toFixed(1)}%, transparent)`;
  }

  $effect(() => {
    const row = anchor?.parentElement as HTMLElement | null | undefined;
    if (!row) return;

    const width = percent(clampedPercentage);
    const fillColor = alphaColor(glowColor, opacity);
    const softFillColor = alphaColor(glowColor, opacity * 0.72);
    const layers: string[] = [];
    const sizes: string[] = [];

    if (mode === "solid") {
      layers.push(`linear-gradient(to right, ${fillColor}, ${fillColor})`);
      sizes.push(`${width} 100%`);
    } else {
      if (mode !== "gradient") {
        layers.push(`linear-gradient(to right, ${glowColor}, ${glowColor})`);
        sizes.push(`${width} ${Math.max(1, borderHeight)}px`);
      }
      layers.push(`linear-gradient(to top, ${softFillColor}, transparent)`);
      sizes.push(`${width} 100%`);
      layers.push(`linear-gradient(to right, ${fillColor} 0%, ${fillColor} 70%, transparent 100%)`);
      sizes.push(`${width} 100%`);
    }

    row.style.backgroundImage = layers.join(", ");
    row.style.backgroundSize = sizes.join(", ");
    row.style.backgroundRepeat = layers.map(() => "no-repeat").join(", ");
    row.style.backgroundPosition = layers.map(() => "left bottom").join(", ");
    row.style.borderRadius = `${rowBorderRadius}px`;

    return () => {
      row.style.removeProperty("background-image");
      row.style.removeProperty("background-size");
      row.style.removeProperty("background-repeat");
      row.style.removeProperty("background-position");
      row.style.removeProperty("border-radius");
    };
  });
</script>

<td
  bind:this={anchor}
  aria-hidden="true"
  class="table-row-glow-anchor"
  style="display: none !important;"
></td>

<style>
  .table-row-glow-anchor {
    display: none;
  }
</style>
