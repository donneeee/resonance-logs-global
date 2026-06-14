<script lang="ts">
  import type { BuffAlertState } from "../../routes/game-overlay/overlay-types";

  interface Props {
    label: string;
    prefixText?: string | undefined;
    valueText: string;
    metaText?: string | undefined;
    timerText?: string | undefined;
    progressPercent: number;
    showProgress: boolean;
    nameColor: string;
    valueColor: string;
    progressColor: string;
    progressOpacity?: number | undefined;
    fontSize: number;
    columnGap?: number | undefined;
    reserveTimerColumn?: boolean | undefined;
    placeholder?: boolean | undefined;
    alert?: BuffAlertState | undefined;
  }

  let {
    label,
    prefixText,
    valueText,
    metaText,
    timerText,
    progressPercent,
    showProgress,
    nameColor,
    valueColor,
    progressColor,
    progressOpacity = 0.4,
    fontSize,
    columnGap = 8,
    reserveTimerColumn = false,
    placeholder = false,
    alert = undefined,
  }: Props = $props();
</script>

<div
  class="text-buff-row"
  class:placeholder
  class:alert-flash={alert?.flash === true}
  class:has-timer-column={reserveTimerColumn || Boolean(timerText)}
  class:reserved-timer-column={reserveTimerColumn}
  style:--alert-color={alert?.highlightColor}
  style:--alert-flash-duration={alert
    ? `${alert.flashIntervalMs}ms`
    : undefined}
>
  {#if showProgress}
    <div class="text-buff-progress-track">
      <div
        class="text-buff-progress-fill"
        style:width={`${progressPercent}%`}
        style:background={alert?.applyToProgress
          ? alert.highlightColor
          : progressColor}
        style:opacity={progressOpacity}
      ></div>
    </div>
  {/if}

  <div class="text-buff-main" style:--content-gap={`${columnGap}px`}>
    <div class="text-buff-content">
      {#if prefixText}
        <span
          class="text-buff-prefix"
          style:color={alert?.highlightColor ?? valueColor}
          style:font-size={`${fontSize}px`}
        >
          {prefixText}
        </span>
      {/if}
      <span
        class="text-buff-name"
        style:color={alert?.highlightColor ?? nameColor}
        style:font-size={`${fontSize}px`}
      >
        {label}
      </span>
      <span class="text-buff-right">
        {#if metaText}
          <span
            class="text-buff-meta"
            style:color={alert?.highlightColor ?? valueColor}
            style:font-size={`${Math.max(10, fontSize - 1)}px`}
          >
            {metaText}
          </span>
        {/if}
        <span
          class="text-buff-value"
          style:color={alert?.highlightColor ?? valueColor}
          style:font-size={`${fontSize}px`}
        >
          {valueText}
        </span>
      </span>
    </div>
    <span class="text-buff-timer-slot">
      {#if timerText}
        <span
          class="text-buff-timer"
          style:color={alert?.highlightColor ?? valueColor}
          style:font-size={`${Math.max(10, fontSize - 1)}px`}
        >
          {timerText}
        </span>
      {/if}
    </span>
  </div>
</div>

<style>
  .text-buff-row {
    --timer-column-gap: 0px;
    --timer-column-width: 0px;
    --timer-track-inset: 0px;

    position: relative;
    min-height: 20px;
    border-radius: 6px;
    overflow: hidden;
  }

  .text-buff-row.has-timer-column {
    --timer-column-gap: 12px;
    --timer-column-width: 3.6em;
    --timer-track-inset: calc(
      var(--timer-column-width) + var(--timer-column-gap) + 6px
    );
  }

  .text-buff-row.reserved-timer-column {
    --timer-column-gap: 6px;
    --timer-column-width: 4.8em;
  }

  .text-buff-row.placeholder {
    opacity: 0.6;
  }

  .text-buff-row.alert-flash {
    animation: buff-alert-flash var(--alert-flash-duration, 600ms) ease-in-out
      infinite alternate;
  }

  .text-buff-progress-track {
    position: absolute;
    top: 0;
    right: var(--timer-track-inset);
    bottom: 0;
    left: 0;
    border-radius: inherit;
    background: rgba(255, 255, 255, 0.16);
    overflow: hidden;
  }

  .text-buff-progress-fill {
    height: 100%;
    transition: width 100ms linear;
  }

  .text-buff-main {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--timer-column-width);
    column-gap: var(--timer-column-gap);
    align-items: center;
    min-width: 0;
    padding: 2px 6px;
    text-shadow:
      0 0 3px rgba(0, 0, 0, 1),
      0 0 6px rgba(0, 0, 0, 0.7),
      0 1px 2px rgba(0, 0, 0, 0.9);
  }

  .text-buff-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--content-gap, 8px);
    min-width: 0;
  }

  .text-buff-name {
    min-width: 0;
    flex: 1 1 auto;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .text-buff-prefix {
    flex: 0 0 2.2em;
    line-height: 1.1;
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .text-buff-right {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    flex: 0 0 auto;
    min-width: 0;
  }

  .text-buff-timer-slot {
    display: inline-flex;
    align-items: baseline;
    justify-content: flex-end;
    min-width: 0;
  }

  .text-buff-row.reserved-timer-column .text-buff-timer-slot {
    justify-content: flex-start;
  }

  .text-buff-meta,
  .text-buff-timer,
  .text-buff-value {
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .text-buff-timer {
    text-align: right;
    opacity: 0.92;
  }

  .text-buff-row.reserved-timer-column .text-buff-timer {
    text-align: left;
  }

  .text-buff-value {
    font-weight: 600;
  }

  @keyframes buff-alert-flash {
    0% {
      opacity: 1;
      filter: brightness(1);
    }

    100% {
      opacity: 0.45;
      filter: brightness(1.6);
    }
  }
</style>
