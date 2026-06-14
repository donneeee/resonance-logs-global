<script lang="ts">
  import { activeProfileOrDefault } from "$lib/skill-monitor-profile.svelte";
  import {
    DPS_HEALER_SPEC_GLOW,
    getClassIcon,
    getClassIconTintColor,
    isDpsHealerSpec,
    tooltip,
  } from "$lib/utils.svelte";

  let {
    className = "",
    classSpecName = "",
    class: classAttr = "",
    style = "",
    alt = "",
    tooltipText = "",
  }: {
    className?: string;
    classSpecName?: string;
    class?: string;
    style?: string;
    alt?: string;
    tooltipText?: string;
  } = $props();

  const iconUrl = $derived(getClassIcon(className, classSpecName));
  const tintColor = $derived(getClassIconTintColor(className, classSpecName));
  const shouldTint = $derived(Boolean(classSpecName && tintColor));
  const shouldHighlightDpsHealerSpec = $derived(
    Boolean(
      activeProfileOrDefault().highlightDpsHealerSpecIcons === true
        && isDpsHealerSpec(classSpecName),
    ),
  );
  const iconClass = $derived(
    [
      "class-spec-icon",
      shouldTint ? "tinted" : "image",
      shouldHighlightDpsHealerSpec ? "dps-healer-highlight" : "",
      classAttr,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const cssIconUrl = $derived(iconUrl.replace(/"/g, '\\"'));
  const iconStyle = $derived(
    [
      style,
      shouldTint
        ? `--class-icon-url: url("${cssIconUrl}"); --class-icon-color: ${tintColor}`
        : "",
      shouldHighlightDpsHealerSpec ? `--class-icon-highlight: ${DPS_HEALER_SPEC_GLOW}` : "",
    ]
      .filter(Boolean)
      .join("; "),
  );
</script>

{#if shouldTint}
  {#if tooltipText}
    <span
      role="img"
      aria-label={alt}
      class={iconClass}
      style={iconStyle}
      {@attach tooltip(() => tooltipText)}
    ></span>
  {:else}
    <span role="img" aria-label={alt} class={iconClass} style={iconStyle}></span>
  {/if}
{:else if tooltipText}
  <img
    class={iconClass}
    style={iconStyle}
    src={iconUrl}
    {alt}
    {@attach tooltip(() => tooltipText)}
  />
{:else}
  <img class={iconClass} style={iconStyle} src={iconUrl} {alt} />
{/if}

<style>
  .class-spec-icon {
    display: inline-block;
    flex: 0 0 auto;
    vertical-align: middle;
  }

  .class-spec-icon.image {
    object-fit: contain;
  }

  .class-spec-icon.tinted {
    background-color: var(--class-icon-color);
    -webkit-mask-image: var(--class-icon-url);
    mask-image: var(--class-icon-url);
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-size: contain;
    mask-size: contain;
  }

  .class-spec-icon.dps-healer-highlight {
    filter:
      drop-shadow(0 0 2px var(--class-icon-highlight))
      drop-shadow(0 0 5px color-mix(in srgb, var(--class-icon-highlight) 78%, transparent));
  }
</style>
