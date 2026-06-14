<script lang="ts">
  import { onDestroy } from "svelte";
  import { SETTINGS } from "$lib/settings-store";
  import {
    isLocaleCode,
    type LocaleCode,
  } from "$lib/i18n";
  import {
    resolvePlayerImagineName,
    type PlayerImagineInfo,
  } from "$lib/player-imagines";

  let {
    imagines = [],
    size = 24,
    class: classAttr = "",
  }: {
    imagines?: PlayerImagineInfo[] | null;
    size?: number;
    class?: string;
  } = $props();

  const locale = $derived(
    isLocaleCode(SETTINGS.live.general.state.language)
      ? SETTINGS.live.general.state.language
      : ("en" as LocaleCode),
  );
  const visibleImagines = $derived((imagines ?? []).slice(0, 2));
  const badgeStyle = $derived(`width: ${size}px; height: ${size}px;`);
  const wrapperClass = $derived(
    ["player-imagine-badges", classAttr].filter(Boolean).join(" "),
  );
  let tooltipElement: HTMLSpanElement | null = null;
  let hideTooltipTimer: number | null = null;

  function tooltipText(imagine: PlayerImagineInfo): string {
    const name = resolvePlayerImagineName(imagine, locale);
    return `${name} T${imagine.tier}`;
  }

  function clearHideTooltipTimer() {
    if (hideTooltipTimer) {
      window.clearTimeout(hideTooltipTimer);
      hideTooltipTimer = null;
    }
  }

  function showBadgeTooltip(imagine: PlayerImagineInfo, element: HTMLElement) {
    clearHideTooltipTimer();
    if (!tooltipElement) {
      tooltipElement = document.createElement("span");
      tooltipElement.className = "player-imagine-tooltip";
      tooltipElement.setAttribute("role", "tooltip");
      document.body.appendChild(tooltipElement);
    }

    const rect = element.getBoundingClientRect();
    tooltipElement.textContent = tooltipText(imagine);
    tooltipElement.style.left = `${Math.min(Math.max(rect.left + rect.width / 2, 12), window.innerWidth - 12)}px`;
    tooltipElement.style.top = `${Math.max(rect.top - 8, 12)}px`;
    tooltipElement.dataset["visible"] = "true";
  }

  function scheduleHideBadgeTooltip() {
    clearHideTooltipTimer();
    hideTooltipTimer = window.setTimeout(() => {
      if (tooltipElement) {
        tooltipElement.dataset["visible"] = "false";
      }
      hideTooltipTimer = null;
    }, 180);
  }

  onDestroy(() => {
    clearHideTooltipTimer();
    tooltipElement?.remove();
    tooltipElement = null;
  });
</script>

{#if visibleImagines.length > 0}
  <span class={wrapperClass} data-tauri-drag-region="false">
    {#each visibleImagines as imagine (`${imagine.slot ?? "remote"}:${imagine.skillId}`)}
      <span
        class={`player-imagine-badge tier-${imagine.tier}`}
        style={badgeStyle}
        aria-label={tooltipText(imagine)}
        data-tauri-drag-region="false"
        onpointerenter={(event) => showBadgeTooltip(imagine, event.currentTarget)}
        onpointerleave={scheduleHideBadgeTooltip}
        onfocus={(event) => showBadgeTooltip(imagine, event.currentTarget)}
        onblur={scheduleHideBadgeTooltip}
      >
        {#if imagine.iconUrl}
          <img src={imagine.iconUrl} alt="" draggable="false" />
        {:else}
          <span class="player-imagine-fallback">T{imagine.tier}</span>
        {/if}
      </span>
    {/each}
  </span>
{/if}

<style>
  .player-imagine-badges {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 4px;
    pointer-events: auto;
    position: relative;
    z-index: 2;
  }

  .player-imagine-badge {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 2px solid transparent;
    border-radius: 6px;
    background: color-mix(in oklch, var(--background) 78%, white 8%);
    box-shadow: 0 0 0 1px color-mix(in oklch, black 45%, transparent);
    pointer-events: auto;
    position: relative;
    z-index: 2;
  }

  .player-imagine-badge img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .player-imagine-fallback {
    font-size: 0.55rem;
    font-weight: 800;
    line-height: 1;
  }

  :global(.player-imagine-tooltip) {
    position: fixed;
    z-index: 2147483647;
    max-width: min(360px, calc(100vw - 16px));
    padding: 6px 8px;
    border: 1px solid color-mix(in oklch, white 18%, transparent);
    border-radius: 4px;
    background: oklch(0.18 0.02 260 / 0.96);
    color: white;
    box-shadow: 0 8px 20px color-mix(in oklch, black 42%, transparent);
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1.25;
    pointer-events: none;
    transform: translate(-50%, -100%);
    white-space: nowrap;
    opacity: 0;
    transition: opacity 80ms ease-out;
  }

  :global(.player-imagine-tooltip[data-visible="true"]) {
    opacity: 1;
  }

  .tier-1 {
    border-color: oklch(0.82 0.03 250);
    box-shadow:
      0 0 0 1px color-mix(in oklch, black 48%, transparent),
      0 0 3px color-mix(in oklch, white 62%, transparent),
      0 0 9px color-mix(in oklch, oklch(0.9 0.06 250) 32%, transparent);
  }

  .tier-2 {
    border-color: oklch(0.68 0.16 145);
    box-shadow:
      0 0 0 1px color-mix(in oklch, black 48%, transparent),
      0 0 3px color-mix(in oklch, oklch(0.9 0.22 145) 62%, transparent),
      0 0 9px color-mix(in oklch, oklch(0.76 0.22 145) 34%, transparent);
  }

  .tier-3 {
    border-color: oklch(0.66 0.16 240);
    box-shadow:
      0 0 0 1px color-mix(in oklch, black 48%, transparent),
      0 0 3px color-mix(in oklch, oklch(0.88 0.2 232) 62%, transparent),
      0 0 9px color-mix(in oklch, oklch(0.68 0.24 232) 36%, transparent);
  }

  .tier-4 {
    border-color: oklch(0.67 0.18 305);
    box-shadow:
      0 0 0 1px color-mix(in oklch, black 48%, transparent),
      0 0 3px color-mix(in oklch, oklch(0.9 0.2 305) 62%, transparent),
      0 0 9px color-mix(in oklch, oklch(0.7 0.25 305) 38%, transparent);
  }

  .tier-5 {
    border-color: oklch(0.78 0.16 82);
    box-shadow:
      0 0 0 1px color-mix(in oklch, black 48%, transparent),
      0 0 3px color-mix(in oklch, oklch(0.92 0.18 82) 62%, transparent),
      0 0 9px color-mix(in oklch, oklch(0.78 0.18 82) 36%, transparent);
  }
</style>
