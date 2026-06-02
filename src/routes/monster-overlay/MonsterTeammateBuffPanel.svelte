<script lang="ts">
  import { uiT } from "$lib/i18n";
  import { SETTINGS } from "$lib/settings-store";
  import {
    getTeammatePanelPosition,
    getTeammatePanelScale,
    isMonsterEditing,
    monsterTeammateColumns,
    monsterTeammateRows,
    startMonsterDrag,
    startMonsterResize,
    teammatePanelStyle,
  } from "./monster-state.svelte.js";

  const editing = $derived(isMonsterEditing());
  const rows = $derived(monsterTeammateRows());
  const columns = $derived(monsterTeammateColumns());
  const styleConfig = $derived(teammatePanelStyle());
  const panelPos = $derived(getTeammatePanelPosition());
  const panelScale = $derived(getTeammatePanelScale());
  const t = uiT("overlay/monster-monitor", () => SETTINGS.live.general.state.language);
</script>

{#if rows.length > 0 || editing}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="overlay-group teammate-buff-panel"
    class:editable={editing}
    style:left={`${panelPos.x}px`}
    style:top={`${panelPos.y}px`}
    style:transform={`scale(${panelScale})`}
    style:transform-origin="top left"
    style:--row-gap={`${styleConfig.gap}px`}
    style:--column-gap={`${styleConfig.columnGap}px`}
    style:--font-size={`${styleConfig.fontSize}px`}
    style:--name-color={styleConfig.nameColor}
    style:--value-color={styleConfig.valueColor}
    style:--progress-color={styleConfig.progressColor}
    style:--progress-opacity={String(styleConfig.progressOpacity ?? 0.4)}
    style:--columns={String(Math.max(1, columns.length))}
    onpointerdown={(event) =>
      startMonsterDrag(event, { kind: "teammatePanel" }, panelPos)}
  >
    {#if editing}
      <div class="group-tag">{t("overlay.teammateBuff", "Teammate Buff Area")}</div>
    {/if}

    <div class="matrix-grid header-row">
      <div class="teammate-header">{t("teammate.nameHeader", "Teammate")}</div>
      {#each columns as column (column.key)}
        <div class="buff-header" title={column.label}>{column.label}</div>
      {/each}
    </div>

    <div class="teammate-rows">
      {#each rows as row (row.teammateEntityUuid)}
        <div class="matrix-grid teammate-row" class:placeholder={row.isPlaceholder}>
          <div class="teammate-name" title={row.teammateName}>{row.teammateName}</div>
          {#each row.cells as cell (cell.key)}
            <div
              class="buff-cell"
              class:active={cell.hasBuff}
              class:placeholder={row.isPlaceholder}
              class:alert={cell.alert?.flash === true}
              style:--cell-alert-color={cell.alert?.highlightColor ?? styleConfig.progressColor}
              title={cell.buffName}
            >
              {#if cell.hasBuff}
                <div
                  class="cell-progress"
                  style:width={`${Math.max(0, Math.min(100, cell.progressPercent))}%`}
                ></div>
                <span class="cell-value">{cell.valueText || "--"}</span>
                {#if cell.metaText}
                  <span class="cell-meta">{cell.metaText}</span>
                {/if}
              {:else}
                <span class="cell-empty">--</span>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>

    {#if editing}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="resize-handle"
        onpointerdown={(event) =>
          startMonsterResize(event, { kind: "teammatePanel" }, panelScale)}
      ></div>
    {/if}
  </div>
{/if}

<style>
  .teammate-buff-panel {
    min-width: 280px;
    max-width: 760px;
    color: var(--value-color);
    font-size: var(--font-size);
    pointer-events: auto;
  }

  .matrix-grid {
    display: grid;
    grid-template-columns: minmax(96px, 1.15fr) repeat(var(--columns, 1), minmax(64px, 0.85fr));
    gap: var(--row-gap) var(--column-gap);
    align-items: stretch;
  }

  .header-row {
    margin-bottom: var(--row-gap);
    color: var(--name-color);
    opacity: 0.92;
  }

  .teammate-rows {
    display: flex;
    flex-direction: column;
    gap: var(--row-gap);
  }

  .teammate-name,
  .teammate-header,
  .buff-header,
  .buff-cell {
    min-width: 0;
    border-radius: 6px;
    padding: 4px 7px;
    background: rgba(15, 23, 42, 0.42);
    border: 1px solid rgba(148, 163, 184, 0.22);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .teammate-name {
    color: var(--name-color);
    font-weight: 700;
  }

  .buff-header {
    color: var(--name-color);
    text-align: center;
    font-size: 0.82em;
  }

  .buff-cell {
    position: relative;
    display: flex;
    justify-content: center;
    gap: 4px;
    color: var(--value-color);
  }

  .buff-cell.active {
    border-color: color-mix(in srgb, var(--progress-color), transparent 40%);
  }

  .cell-progress {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--progress-color);
    opacity: var(--progress-opacity);
    pointer-events: none;
  }

  .cell-value,
  .cell-meta,
  .cell-empty {
    position: relative;
    z-index: 1;
  }

  .cell-meta {
    opacity: 0.8;
  }

  .buff-cell.alert {
    box-shadow: 0 0 10px color-mix(in srgb, var(--cell-alert-color), transparent 30%);
  }
</style>
