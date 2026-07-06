<script lang="ts">
  import type { MinimapEntity, MinimapSnapshot } from "$lib/api";
  import { t } from "$lib/i18n/index.svelte";
  import { SETTINGS } from "$lib/settings-store";
  import { overlayNow } from "../game-overlay/overlay-clock.svelte.js";
  import {
    minimapPlayerNames,
    minimapSkillCasts,
  } from "./minimap-runtime.svelte.js";
  import { slotColor } from "./colors";
  import { resolveScene } from "./scene-registry";
  import type { MechanicRow } from "./scene-types";

  let { snapshot }: { snapshot: MinimapSnapshot | null } = $props();
  const minimapSettings = $derived(SETTINGS.minimap.state);

  type SkillGroup = { group: string; rows: MechanicRow[] };

  function displayName(entity: MinimapEntity): string {
    if (entity.name) return entity.name;
    const cached = minimapPlayerNames().get(entity.entityUuid);
    if (cached) return cached;
    return entity.entityUuid.length > 6
      ? `...${entity.entityUuid.slice(-4)}`
      : entity.entityUuid;
  }

  const groups = $derived.by<SkillGroup[]>(() => {
    if (!snapshot) return [];
    const scene = resolveScene(snapshot.sceneId);
    const skillCasts = minimapSkillCasts();
    const view = scene?.resolveView(snapshot, displayName, skillCasts);
    if (!view) return [];
    const skillRows =
      scene?.resolveSkillRows?.({
        skillCasts,
        displayName,
      }) ?? [];
    const groups: SkillGroup[] = [];
    for (const row of [...view.rows, ...skillRows]) {
      const existing = groups.find((group) => group.group === row.group);
      if (existing) {
        existing.rows.push(row);
      } else {
        groups.push({ group: row.group, rows: [row] });
      }
    }
    return groups.map((group) => ({
      ...group,
      rows: group.rows.sort(
        (a, b) => a.colorSlot - b.colorSlot || a.label.localeCompare(b.label),
      ),
    }));
  });

  function remainingMs(row: MechanicRow): number {
    if (row.durationMs <= 0 || row.createTimeMs <= 0)
      return Number.POSITIVE_INFINITY;
    return Math.max(0, row.createTimeMs + row.durationMs - overlayNow());
  }

  function remainingText(row: MechanicRow): string {
    const ms = remainingMs(row);
    if (!Number.isFinite(ms)) return "--";
    return `${Math.ceil(ms / 1000)}s`;
  }

  function targetText(row: MechanicRow): string {
    return row.targets.length > 0 ? row.targets.join(", ") : "";
  }

  function normalizedTargetName(value: string): string {
    return value.trim().toLocaleLowerCase();
  }

  const localTargetNames = $derived.by(() => {
    const names = new Set<string>();
    if (!snapshot) return names;

    const local =
      snapshot.entities.find(
        (entity) => entity.entityUuid === snapshot.localPlayerUuid,
      ) ?? snapshot.entities.find((entity) => entity.kind === "local");
    if (!local) return names;

    for (const name of [
      local.name,
      minimapPlayerNames().get(local.entityUuid),
      displayName(local),
    ]) {
      if (name) names.add(normalizedTargetName(name));
    }
    return names;
  });

  function isLocalTarget(target: string): boolean {
    if (!minimapSettings.highlightSelfMechanics) return false;
    return localTargetNames.has(normalizedTargetName(target));
  }

  function rowHasLocalTarget(row: MechanicRow): boolean {
    return row.targets.some(isLocalTarget);
  }

  function selfMechanicColor(): string {
    const color = minimapSettings.selfMechanicColor;
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#facc15";
  }

  function selfMechanicRgb(): string {
    const color = selfMechanicColor();
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    return `${red}, ${green}, ${blue}`;
  }

  function selfMechanicTextColor(): string {
    const color = selfMechanicColor();
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
    return luminance > 145 ? "#020617" : "#f8fafc";
  }
</script>

<div class="infobar">
  {#if groups.length === 0}
    <p class="empty">{t("minimap.infobar.empty")}</p>
  {:else}
    {#each groups as group (group.group)}
      {@const head = slotColor(group.rows[0]?.colorSlot ?? 0)}
      <section class="skill-group" style:--accent={head}>
        <h3>{group.group}</h3>
        {#each group.rows as row (row.key)}
          {@const color = slotColor(row.colorSlot)}
          {@const selfTargeted = rowHasLocalTarget(row)}
          <div
            class="buff-row"
            class:self-targeted={selfTargeted}
            style={selfTargeted
              ? `--self-target-color: ${selfMechanicColor()}; --self-target-rgb: ${selfMechanicRgb()}; --self-target-text: ${selfMechanicTextColor()};`
              : undefined}
          >
            <span class="dot" style:background={color} style:color></span>
            <span class="text" title={targetText(row)}>
              <span class="label">{row.label}</span>
              {#if row.targets.length > 0}
                <span class="targets">
                  {#each row.targets as target, index (target)}
                    <span
                      class="target-chip"
                      class:self-target={isLocalTarget(target)}
                    >
                      {target}{#if index < row.targets.length - 1},
                      {/if}
                    </span>
                  {/each}
                </span>
              {/if}
            </span>
            {#if !row.hideTimer}
              <span class="time">{remainingText(row)}</span>
            {/if}
          </div>
        {/each}
      </section>
    {/each}
  {/if}
</div>

<style>
  .infobar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: min(72vh, 520px);
    padding: 10px;
    overflow-y: auto;
    color: #e2e8f0;
    font-size: 12px;
    background: rgba(15, 23, 42, 0.76);
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 14px;
    box-shadow:
      0 16px 44px rgba(15, 23, 42, 0.32),
      inset 0 1px 0 rgba(248, 250, 252, 0.06);
    backdrop-filter: blur(12px);
  }
  .empty {
    margin: 0;
    color: #94a3b8;
    font-size: 12px;
    line-height: 1.5;
  }
  .skill-group {
    padding: 2px 0 2px 8px;
    border-left: 2px solid var(--accent, #fbbf24);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    color: #cbd5e1;
  }
  .buff-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-height: 24px;
    margin-left: -4px;
    padding: 2px 4px;
    border-radius: 8px;
  }
  .buff-row.self-targeted {
    background: rgba(var(--self-target-rgb, 250, 204, 21), 0.14);
    box-shadow:
      inset 0 0 0 1px rgba(var(--self-target-rgb, 250, 204, 21), 0.34),
      0 0 14px rgba(var(--self-target-rgb, 250, 204, 21), 0.22);
    animation: self-target-pulse 1.25s ease-in-out infinite;
  }
  .dot {
    width: 9px;
    height: 9px;
    margin-top: 7px;
    border-radius: 50%;
    flex: none;
    box-shadow: 0 0 8px currentColor;
  }
  .text {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 1px;
    font-size: 13px;
    color: #f1f5f9;
    line-height: 1.25;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 700;
  }
  .targets {
    display: flex;
    flex-wrap: wrap;
    gap: 0 4px;
    width: 100%;
    min-width: 0;
    color: #cbd5e1;
    font-size: 11px;
  }
  .target-chip {
    max-width: 100%;
    min-width: 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .target-chip.self-target {
    padding: 0 4px;
    border-radius: 5px;
    color: var(--self-target-text, #020617);
    background: var(--self-target-color, #facc15);
    font-weight: 900;
    text-shadow: none;
    box-shadow: 0 0 10px rgba(var(--self-target-rgb, 250, 204, 21), 0.48);
  }
  .time {
    flex: none;
    margin-top: 2px;
    min-width: 3ch;
    padding: 2px 6px;
    border-radius: 999px;
    color: #e0f2fe;
    background: rgba(14, 165, 233, 0.12);
    border: 1px solid rgba(125, 211, 252, 0.28);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    font-weight: 800;
    text-align: right;
  }
  @keyframes self-target-pulse {
    0%,
    100% {
      box-shadow:
        inset 0 0 0 1px rgba(var(--self-target-rgb, 250, 204, 21), 0.3),
        0 0 10px rgba(var(--self-target-rgb, 250, 204, 21), 0.18);
    }
    50% {
      box-shadow:
        inset 0 0 0 1px rgba(var(--self-target-rgb, 250, 204, 21), 0.56),
        0 0 18px rgba(var(--self-target-rgb, 250, 204, 21), 0.4);
    }
  }
</style>
