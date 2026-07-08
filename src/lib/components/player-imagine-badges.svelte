<script lang="ts">
  import { onDestroy } from "svelte";
  import { SETTINGS } from "$lib/settings-store";
  import {
    isLocaleCode,
    resolveUiTranslation,
    type LocaleCode,
  } from "$lib/i18n";
  import {
    resolvePlayerImagineName,
    type PlayerImagineInfo,
  } from "$lib/player-imagines";
  import {
    computePlayerImagineCooldown,
    type PlayerImagineCooldownState,
  } from "$lib/player-imagine-cooldowns";
  import type { SkillCdState } from "$lib/api";

  let {
    imagines = [],
    size = 24,
    cooldownBySkillId = null,
    nowMs = Date.now(),
    class: classAttr = "",
  }: {
    imagines?: PlayerImagineInfo[] | null;
    size?: number;
    cooldownBySkillId?: ReadonlyMap<number, SkillCdState> | null;
    nowMs?: number;
    class?: string;
  } = $props();

  const locale = $derived(
    isLocaleCode(SETTINGS.live.general.state.language)
      ? SETTINGS.live.general.state.language
      : ("en" as LocaleCode),
  );
  const visibleImagines = $derived((imagines ?? []).slice(0, 2));
  const badgeStyle = $derived(
    `width: ${size}px; height: ${size}px; --player-imagine-badge-size: ${size}px;`,
  );
  const wrapperClass = $derived(
    ["player-imagine-badges", classAttr].filter(Boolean).join(" "),
  );
  let tooltipElement: HTMLSpanElement | null = null;
  let hideTooltipTimer: number | null = null;

  function cooldownForImagine(imagine: PlayerImagineInfo): PlayerImagineCooldownState | null {
    return computePlayerImagineCooldown(imagine, cooldownBySkillId, nowMs);
  }

  function cooldownTooltip(cooldown: PlayerImagineCooldownState | null): string {
    if (!cooldown || cooldown.solidFraction >= 1) return "";
    const parts: string[] = [];
    if (cooldown.chargesText) parts.push(`Charges ${cooldown.chargesText}`);
    if (cooldown.remainingText) {
      parts.push(cooldown.usable ? `Next charge ${cooldown.remainingText}` : `Cooldown ${cooldown.remainingText}`);
    } else {
      parts.push("On cooldown");
    }
    return parts.join(" - ");
  }

  function tooltipText(
    imagine: PlayerImagineInfo,
    cooldown: PlayerImagineCooldownState | null,
  ): string {
    const name = resolvePlayerImagineName(imagine, locale);
    const cooldownText = cooldownTooltip(cooldown);
    return cooldownText ? `${name} T${imagine.tier} - ${cooldownText}` : `${name} T${imagine.tier}`;
  }

  function cooldownBadgeStyle(cooldown: PlayerImagineCooldownState | null): string {
    const solidPercent = Math.round(Math.max(0, Math.min(1, cooldown?.solidFraction ?? 1)) * 100);
    return `${badgeStyle} --player-imagine-ready-pct: ${solidPercent}%;`;
  }

  function missingSecondImagineLabel(): string {
    return resolveUiTranslation(
      "liveDps.missingSecondBattleImagine",
      locale,
      "Missing second battle imagine",
    );
  }

  function clearHideTooltipTimer() {
    if (hideTooltipTimer) {
      window.clearTimeout(hideTooltipTimer);
      hideTooltipTimer = null;
    }
  }

  function showBadgeTooltip(
    imagine: PlayerImagineInfo,
    cooldown: PlayerImagineCooldownState | null,
    element: HTMLElement,
  ) {
    clearHideTooltipTimer();
    if (!tooltipElement) {
      tooltipElement = document.createElement("span");
      tooltipElement.className = "player-imagine-tooltip";
      tooltipElement.setAttribute("role", "tooltip");
      document.body.appendChild(tooltipElement);
    }

    const rect = element.getBoundingClientRect();
    tooltipElement.textContent = tooltipText(imagine, cooldown);
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
      {@const cooldown = cooldownForImagine(imagine)}
      {@const isCooldownVisual = cooldown !== null && cooldown.solidFraction < 1}
      <span
        class={`player-imagine-badge tier-${imagine.tier}`}
        class:cooldown-active={isCooldownVisual}
        style={cooldownBadgeStyle(cooldown)}
        aria-label={tooltipText(imagine, cooldown)}
        data-tauri-drag-region="false"
        onpointerenter={(event) => showBadgeTooltip(imagine, cooldown, event.currentTarget)}
        onpointerleave={scheduleHideBadgeTooltip}
        onfocus={(event) => showBadgeTooltip(imagine, cooldown, event.currentTarget)}
        onblur={scheduleHideBadgeTooltip}
      >
        {#if imagine.iconUrl}
          <span class="player-imagine-icon-frame" aria-hidden="true">
            <img
              src={imagine.iconUrl}
              alt=""
              draggable="false"
              class="player-imagine-icon-base"
              class:faded={isCooldownVisual}
            />
            {#if cooldown && cooldown.solidFraction > 0 && cooldown.solidFraction < 1}
              <span class="player-imagine-ready-slice">
                <img
                  src={imagine.iconUrl}
                  alt=""
                  draggable="false"
                  class="player-imagine-icon-solid"
                />
              </span>
            {/if}
          </span>
        {:else}
          <span class="player-imagine-fallback" class:faded={isCooldownVisual}>T{imagine.tier}</span>
        {/if}
        {#if cooldown?.chargesText && cooldown.maxCharges && cooldown.maxCharges > 1}
          <span
            class="player-imagine-charge-badge"
            class:charges-empty={cooldown.chargesAvailable === 0}
            class:charges-partial={(cooldown.chargesAvailable ?? 0) > 0 &&
              (cooldown.chargesAvailable ?? 0) < cooldown.maxCharges}
          >
            {cooldown.chargesText}
          </span>
        {/if}
      </span>
    {/each}
    {#if visibleImagines.length === 1}
      <span
        class="player-imagine-badge player-imagine-missing-slot"
        style={badgeStyle}
        aria-label={missingSecondImagineLabel()}
        title={missingSecondImagineLabel()}
        data-tauri-drag-region="false"
      >
        <span class="player-imagine-missing-x" aria-hidden="true">X</span>
      </span>
    {/if}
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

  .player-imagine-icon-frame {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: 4px;
  }

  .player-imagine-icon-frame img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    max-width: none;
    pointer-events: none;
  }

  .player-imagine-icon-base {
    z-index: 0;
  }

  .player-imagine-icon-base.faded,
  .player-imagine-fallback.faded {
    opacity: 0.54;
    filter: grayscale(45%) brightness(0.46);
  }

  .player-imagine-ready-slice {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: 2;
    width: var(--player-imagine-ready-pct, 100%);
    overflow: hidden;
  }

  .player-imagine-ready-slice img {
    width: var(--player-imagine-badge-size, 24px);
    height: var(--player-imagine-badge-size, 24px);
  }

  .player-imagine-badge.cooldown-active::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.22);
    pointer-events: none;
  }

  .player-imagine-fallback {
    position: relative;
    z-index: 3;
    font-size: 0.55rem;
    font-weight: 800;
    line-height: 1;
  }

  .player-imagine-charge-badge {
    position: absolute;
    z-index: 4;
    right: 1px;
    top: 1px;
    min-width: calc(var(--player-imagine-badge-size, 24px) * 0.42);
    padding: 0 2px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.72);
    color: #e5e7eb;
    font-size: calc(var(--player-imagine-badge-size, 24px) * 0.25);
    font-weight: 800;
    line-height: 1.2;
    text-align: center;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
    pointer-events: none;
  }

  .player-imagine-charge-badge.charges-partial {
    color: #fbbf24;
  }

  .player-imagine-charge-badge.charges-empty {
    color: #cbd5e1;
  }

  .player-imagine-missing-slot {
    border-color: oklch(0.64 0.24 25);
    background:
      linear-gradient(
        135deg,
        color-mix(in oklch, oklch(0.42 0.12 25) 28%, transparent),
        color-mix(in oklch, black 36%, transparent)
      ),
      color-mix(in oklch, var(--background) 82%, black 10%);
    box-shadow:
      0 0 0 1px color-mix(in oklch, black 54%, transparent),
      0 0 5px color-mix(in oklch, oklch(0.68 0.23 25) 34%, transparent);
  }

  .player-imagine-missing-x {
    color: oklch(0.68 0.24 25);
    font-size: calc(var(--player-imagine-badge-size, 24px) * 0.48);
    font-weight: 900;
    line-height: 1;
    text-shadow:
      0 0 2px color-mix(in oklch, black 72%, transparent),
      0 0 4px color-mix(in oklch, oklch(0.66 0.24 25) 42%, transparent);
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
