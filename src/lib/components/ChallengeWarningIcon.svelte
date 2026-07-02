<script lang="ts">
  import AlertTriangle from "virtual:icons/lucide/alert-triangle";
  import { getPresetForDamageId } from "$lib/challenge-presets";
  import { lookupLocalizedDamageIdName } from "$lib/config/recount-table";
  import { uiT } from "$lib/i18n";
  import { SETTINGS } from "$lib/settings-store";
  import { tooltip } from "$lib/utils.svelte";

  let { ids = [] }: { ids?: number[] } = $props();

  const t = uiT("dps/settings-live", () => SETTINGS.live.general.state.language);

  const detail = $derived.by(() => {
    const locale = SETTINGS.live.general.state.language;
    const labels = new Set<string>();
    for (const id of ids) {
      const preset = getPresetForDamageId(id);
      labels.add(
        preset
          ? t(preset.labelKey, "N17 - Cursed Tomb Floating Cannon")
          : lookupLocalizedDamageIdName(id, locale),
      );
    }
    return [...labels].join(", ");
  });

  const tooltipText = $derived(
    t("challengeWatch.warningTooltip", "Forbidden damage detected: {ids}")
      .replace("{ids}", detail || ids.join(", ")),
  );
</script>

<span
  class="inline-flex shrink-0 items-center text-red-500"
  role="img"
  aria-label={t("challengeWatch.warningAria", "Challenge damage warning")}
  {@attach tooltip(() => tooltipText)}
>
  <AlertTriangle class="h-[1em] w-[1em]" />
</span>
