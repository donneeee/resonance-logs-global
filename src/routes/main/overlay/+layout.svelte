<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import InfoIcon from "virtual:icons/lucide/info";
  import MonitorUpIcon from "virtual:icons/lucide/monitor-up";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { t } from "$lib/i18n/index.svelte";
  import { resolveMonsterMonitorTranslation, uiT } from "$lib/i18n";
  import { SETTINGS } from "$lib/settings-store";
  import { OVERLAY_SUB_ROUTES } from "../routes.svelte";

  let { children } = $props();

  const tShell = uiT("shell", () => SETTINGS.live.general.state.language);
  const tSkill = uiT("overlay/skill-monitor/general", () => SETTINGS.live.general.state.language);

  function isActiveTab(tabPath: string): boolean {
    const pathname = page.url.pathname;
    return pathname === tabPath || pathname.startsWith(tabPath + "/");
  }

  function getOverlaySubRouteLabel(href: string, fallback: string): string {
    if (href === "/main/overlay/skill-monitor") {
      return tSkill("title", fallback);
    }

    if (href === "/main/overlay/monster-monitor") {
      return resolveMonsterMonitorTranslation("title", SETTINGS.live.general.state.language, fallback);
    }

    if (href === "/main/overlay/dbm") {
      const label = t("minimap.tab.dbm");
      return label === "minimap.tab.dbm" ? fallback : label;
    }

    return fallback;
  }

  function navigate(event: MouseEvent, href: string) {
    event.preventDefault();
    void goto(href).catch((error) => {
      console.error("Failed to navigate from overlay layout", href, error);
      window.location.href = href;
    });
  }
</script>

<div class="space-y-6">
  <div class="flex items-center gap-3">
    <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary">
      <MonitorUpIcon class="w-5 h-5" />
    </div>
    <div>
      <h1 class="text-xl font-bold text-foreground">{tShell("tool.overlay", "Overlay")}</h1>
      <p class="text-sm text-muted-foreground">
        {tShell("tool.overlaySubtitle", "Configure skill and monster monitors for the shared overlay")}
      </p>
    </div>
  </div>

  <Alert.Root class="border-primary/30 bg-primary/5 text-foreground">
    <InfoIcon />
    <Alert.Description class="text-xs text-muted-foreground">
      {tShell(
        "tool.overlayEnableNotice",
        "Enable Skill Monitor and Monster Monitor in Settings before using overlay panels.",
      )}
      <a
        href="/main/settings/overlay"
        onclick={(event) => navigate(event, "/main/settings/overlay")}
        class="ml-1 font-medium text-primary underline-offset-4 hover:underline"
      >
        {tShell("tool.overlayEnableNoticeLink", "Open Overlay Settings")}
      </a>
    </Alert.Description>
  </Alert.Root>

  <div class="border-b border-border/60">
    <nav class="flex gap-1 -mb-px">
      {#each Object.entries(OVERLAY_SUB_ROUTES) as [href, route] (route.label)}
        <a
          {href}
          onclick={(event) => navigate(event, href)}
          class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors {isActiveTab(href)
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'}"
          aria-current={isActiveTab(href) ? "page" : undefined}
        >
          <route.icon class="w-4 h-4" />
          <span>{getOverlaySubRouteLabel(href, route.label)}</span>
        </a>
      {/each}
    </nav>
  </div>

  <div class="min-h-0">
    {@render children()}
  </div>
</div>
