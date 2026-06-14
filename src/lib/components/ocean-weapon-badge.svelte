<script lang="ts">
  import { SETTINGS } from "$lib/settings-store";
  import {
    isLocaleCode,
    resolveUiTranslation,
    type LocaleCode,
  } from "$lib/i18n";
  import {
    resolveOceanWeaponName,
    type OceanWeaponInfo,
  } from "$lib/player-equipment";
  import { tooltip } from "$lib/utils.svelte";

  let {
    weapon = null,
    size = 20,
    class: classAttr = "",
  }: {
    weapon?: OceanWeaponInfo | null;
    size?: number;
    class?: string;
  } = $props();

  const locale = $derived(
    isLocaleCode(SETTINGS.live.general.state.language)
      ? SETTINGS.live.general.state.language
      : ("en" as LocaleCode),
  );
  const itemName = $derived(weapon ? resolveOceanWeaponName(weapon, locale) : "");
  const levelText = $derived(
    weapon
      ? resolveUiTranslation(
          "ui/equipment.json",
          weapon.levelSource === "itemInstance"
            ? "oceanWeaponLevel"
            : "oceanWeaponLevelRange",
          locale,
          weapon.levelSource === "itemInstance"
            ? "Ocean Weapon Lv.{level}"
            : "Ocean Weapon Lv.{min}-{max}",
        )
          .replace("{level}", String(weapon.level))
          .replace("{min}", String(weapon.baseLevel))
          .replace("{max}", String(weapon.maxLevel))
      : "",
  );
  const tooltipText = $derived(
    weapon ? [itemName, levelText].filter(Boolean).join(" ") : "",
  );
  const badgeStyle = $derived(`width: ${size}px; height: ${size}px;`);
  const isLevel200Plus = $derived(
    weapon ? weapon.baseLevel >= 200 || weapon.level >= 200 : false,
  );
  const badgeClass = $derived(
    [
      "ocean-weapon-badge",
      isLevel200Plus ? "is-200-plus" : "is-under-200",
      classAttr,
    ]
      .filter(Boolean)
      .join(" "),
  );
</script>

{#if weapon}
  <span
    class={badgeClass}
    style={badgeStyle}
    aria-label={levelText}
    {@attach tooltip(() => tooltipText)}
  >
    <span class="wave-glyph" aria-hidden="true">&#127754;</span>
  </span>
{/if}

<style>
  .ocean-weapon-badge {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in oklch, oklch(0.78 0.1 220) 80%, white 20%);
    border-radius: 999px;
    background:
      radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.45), transparent 42%),
      color-mix(in oklch, oklch(0.64 0.16 226) 70%, black 30%);
    color: white;
    box-shadow:
      0 0 0 1px color-mix(in oklch, black 34%, transparent),
      0 0 4px color-mix(in oklch, oklch(0.68 0.14 226) 36%, transparent);
  }

  .ocean-weapon-badge.is-200-plus {
    box-shadow:
      0 0 0 1px color-mix(in oklch, black 34%, transparent),
      0 0 6px color-mix(in oklch, oklch(0.68 0.14 226) 65%, transparent),
      0 0 14px color-mix(in oklch, oklch(0.7 0.16 226) 42%, transparent);
  }

  .wave-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 76%;
    line-height: 1;
  }
</style>
