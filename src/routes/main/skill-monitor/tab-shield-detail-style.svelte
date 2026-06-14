<script lang="ts">
  import { SETTINGS, type ShieldDetailStyle } from "$lib/settings-store";
  import { uiT } from "$lib/i18n";

  interface Props {
    shieldDetailStyle: ShieldDetailStyle;
    setShieldDetailStyleFlag: (
      key:
        | "showHpBar"
        | "showTotalShieldBar"
        | "showShieldEntries",
      value: boolean,
    ) => void;
    setShieldDetailFontSize: (value: number) => void;
    setShieldDetailBarWidth: (value: number) => void;
    setShieldDetailGap: (value: number) => void;
    setShieldDetailColor: (
      key: "hpColor" | "shieldColor" | "healShieldColor",
      value: string,
    ) => void;
  }

  const t = uiT("overlay/skill-monitor/general", () => SETTINGS.live.general.state.language);

  let {
    shieldDetailStyle,
    setShieldDetailStyleFlag,
    setShieldDetailFontSize,
    setShieldDetailBarWidth,
    setShieldDetailGap,
    setShieldDetailColor,
  }: Props = $props();
</script>

<div class="space-y-4">
  <div class="rounded-lg border border-border/60 bg-card/40 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]">
    <div class="space-y-1">
      <h2 class="text-base font-semibold text-foreground">{t("shieldDetail.title", "HP/Shield Area")}</h2>
      <p class="text-xs text-muted-foreground">
        {t("shieldDetail.description", "Configure HP/shield area visibility and bar styles. Saved per profile.")}
      </p>
    </div>
  </div>

  <div class="rounded-lg border border-border/60 bg-card/40 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)] space-y-3">
    <div class="space-y-1">
      <div class="text-sm font-medium text-foreground">{t("shieldDetail.display.title", "Visible Rows")}</div>
      <p class="text-xs text-muted-foreground">
        {t("shieldDetail.display.description", "Choose which HP and shield rows appear in the overlay.")}
      </p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <label class="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm text-foreground">
        <span>{t("shieldDetail.showHpBar", "Show HP row")}</span>
        <input
          type="checkbox"
          class="h-4 w-4 rounded border-border bg-muted/30 text-primary focus:ring-primary/50"
          checked={shieldDetailStyle.showHpBar}
          onchange={(event) =>
            setShieldDetailStyleFlag("showHpBar", (event.currentTarget as HTMLInputElement).checked)}
        />
      </label>
      <label class="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm text-foreground">
        <span>{t("shieldDetail.showTotalShieldBar", "Show total shield row")}</span>
        <input
          type="checkbox"
          class="h-4 w-4 rounded border-border bg-muted/30 text-primary focus:ring-primary/50"
          checked={shieldDetailStyle.showTotalShieldBar}
          onchange={(event) =>
            setShieldDetailStyleFlag("showTotalShieldBar", (event.currentTarget as HTMLInputElement).checked)}
        />
      </label>
      <label class="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm text-foreground">
        <span>{t("shieldDetail.showShieldEntries", "Show shield details")}</span>
        <input
          type="checkbox"
          class="h-4 w-4 rounded border-border bg-muted/30 text-primary focus:ring-primary/50"
          checked={shieldDetailStyle.showShieldEntries}
          onchange={(event) =>
            setShieldDetailStyleFlag("showShieldEntries", (event.currentTarget as HTMLInputElement).checked)}
        />
      </label>
    </div>
  </div>

  <div class="rounded-lg border border-border/60 bg-card/40 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)] space-y-4">
    <div class="space-y-1">
      <div class="text-sm font-medium text-foreground">{t("shieldDetail.style.title", "Bar Style")}</div>
      <p class="text-xs text-muted-foreground">
        {t("shieldDetail.style.description", "Adjust bar size, spacing, and colors.")}
      </p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      <label class="text-xs text-muted-foreground">
        {t("style.fontSize", "Font Size")}: {shieldDetailStyle.fontSize}px
        <input
          class="mt-1 w-full"
          type="range"
          min="10"
          max="28"
          step="1"
          value={shieldDetailStyle.fontSize}
          oninput={(event) =>
            setShieldDetailFontSize(Number((event.currentTarget as HTMLInputElement).value))}
        />
      </label>
      <label class="text-xs text-muted-foreground">
        {t("shieldDetail.barWidth", "Bar width")}: {shieldDetailStyle.barWidth}px
        <input
          class="mt-1 w-full"
          type="range"
          min="120"
          max="520"
          step="1"
          value={shieldDetailStyle.barWidth}
          oninput={(event) =>
            setShieldDetailBarWidth(Number((event.currentTarget as HTMLInputElement).value))}
        />
      </label>
      <label class="text-xs text-muted-foreground">
        {t("style.gap", "Gap")}: {shieldDetailStyle.gap}px
        <input
          class="mt-1 w-full"
          type="range"
          min="0"
          max="24"
          step="1"
          value={shieldDetailStyle.gap}
          oninput={(event) =>
            setShieldDetailGap(Number((event.currentTarget as HTMLInputElement).value))}
        />
      </label>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <label class="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <span>{t("shieldDetail.hpColor", "HP Color")}</span>
        <input
          type="color"
          value={shieldDetailStyle.hpColor}
          class="h-7 w-12 rounded border border-border/60 bg-transparent p-0"
          onchange={(event) =>
            setShieldDetailColor("hpColor", (event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <span>{t("shieldDetail.shieldColor", "Shield Color")}</span>
        <input
          type="color"
          value={shieldDetailStyle.shieldColor}
          class="h-7 w-12 rounded border border-border/60 bg-transparent p-0"
          onchange={(event) =>
            setShieldDetailColor("shieldColor", (event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <span>{t("shieldDetail.healShieldColor", "Heal Shield Color")}</span>
        <input
          type="color"
          value={shieldDetailStyle.healShieldColor}
          class="h-7 w-12 rounded border border-border/60 bg-transparent p-0"
          onchange={(event) =>
            setShieldDetailColor("healShieldColor", (event.currentTarget as HTMLInputElement).value)}
        />
      </label>
    </div>
  </div>
</div>
