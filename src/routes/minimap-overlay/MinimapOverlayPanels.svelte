<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { SETTINGS } from "$lib/settings-store";
  import DraggablePanel from "./draggable-panel.svelte";
  import MinimapCanvas from "./minimap-canvas.svelte";
  import MinimapInfobar from "./minimap-infobar.svelte";
  import { minimapSnapshot } from "./minimap-runtime.svelte.js";

  type Props = {
    editing?: boolean;
    hideWhenInactive?: boolean;
  };

  let { editing = false, hideWhenInactive = false }: Props = $props();

  const snapshot = $derived(minimapSnapshot());
  const minimapSettings = $derived(SETTINGS.minimap.state);
  const shouldRender = $derived(editing || !hideWhenInactive || snapshot !== null);
</script>

{#if shouldRender}
  {#if minimapSettings.showMapPanel}
    <DraggablePanel
      rect={minimapSettings.mapPanel}
      {editing}
      title={t("minimap.panels.map")}
      class="map-panel"
      scaleMode="width"
    >
      <MinimapCanvas {snapshot} />
    </DraggablePanel>
  {/if}

  {#if minimapSettings.showInfoPanel}
    <DraggablePanel
      rect={minimapSettings.infoPanel}
      {editing}
      title={t("minimap.panels.info")}
      class="info-panel"
    >
      <MinimapInfobar {snapshot} />
    </DraggablePanel>
  {/if}
{/if}
