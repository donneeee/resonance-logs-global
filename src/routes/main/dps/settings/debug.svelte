<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { Button } from "$lib/components/ui/button";
  import { save } from "@tauri-apps/plugin-dialog";
  import { toast } from "svelte-sonner";
  import { commands } from "$lib/bindings";
  import { uiT } from "$lib/i18n";
  import { collectSettingsDiagnosticsSnapshot } from "$lib/settings-diagnostics";
  import { SETTINGS } from "$lib/settings-store";

  const t = uiT("dps/settings-debug", () => SETTINGS.live.general.state.language);
  let cleanupDays = $state("30");
  let cleanupIncludeEventSessions = $state(true);
  let cleanupRunning = $state(false);

  function parseCleanupDays(): number | null {
    const trimmed = cleanupDays.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }

  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  async function openLogDir() {
    try {
      await invoke("open_log_dir");
    } catch (e) {
      console.error(e);
      toast.error(`${t("openLogDirFailed", "Failed to open log folder:")} ${String(e)}`);
    }
  }

  async function createDiagnosticsBundle() {
    try {
      const ts = new Date();
      const pad = (n: number) => n.toString().padStart(2, "0");
      const defaultName = `debug_${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())}_${pad(ts.getHours())}-${pad(ts.getMinutes())}-${pad(ts.getSeconds())}.zip`;

      const destinationPath = await save({
        title: t("bundleSaveTitle", "Save Diagnostics Bundle"),
        defaultPath: defaultName,
        filters: [{ name: "Zip", extensions: ["zip"] }],
      });

      if (!destinationPath) {
        return;
      }

      const settingsSnapshot = await collectSettingsDiagnosticsSnapshot();
      const result = await commands.createDiagnosticsBundle(destinationPath, settingsSnapshot);
      if (result.status === "error") throw new Error(result.error);
      const path = result.data;
      try {
        await navigator.clipboard.writeText(path);
        toast.success(`${t("bundleCreatedCopied", "Diagnostics bundle created and path copied:")} ${path}`);
      } catch {
        toast.success(`${t("bundleCreated", "Diagnostics bundle created:")} ${path}`);
      }
    } catch (e) {
      console.error(e);
      toast.error(`${t("bundleFailed", "Failed to create diagnostics bundle:")} ${String(e)}`);
    }
  }

  async function cleanupDiagnosticsFiles() {
    cleanupRunning = true;
    try {
      const result = await commands.cleanupDiagnosticsFiles(
        parseCleanupDays(),
        cleanupIncludeEventSessions,
      );
      if (result.status === "error") throw new Error(result.error);
      const summary = `${result.data.deletedFiles} ${t("cleanupFilesUnit", "files")}, ${formatBytes(result.data.deletedBytes)}`;
      if (result.data.errors.length > 0) {
        toast.warning(`${t("cleanupPartial", "Cleanup finished with warnings:")} ${summary}`);
        console.warn("Diagnostics cleanup warnings:", result.data.errors);
      } else {
        toast.success(`${t("cleanupSuccess", "Diagnostics cleanup complete:")} ${summary}`);
      }
    } catch (e) {
      console.error(e);
      toast.error(`${t("cleanupFailed", "Failed to clean diagnostics:")} ${String(e)}`);
    } finally {
      cleanupRunning = false;
    }
  }
</script>

<div class="space-y-3">
  <div
    class="overflow-hidden rounded-lg border border-border/60 bg-card/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
  >
    <div class="px-4 py-3">
      <h2 class="mb-4 text-base font-semibold text-foreground">
        {t("title", "调试")}
      </h2>

      <div class="flex items-center justify-between gap-3">
        <div class="text-sm text-muted-foreground">
          <div class="font-medium text-foreground">
            {t("logFiles", "日志文件")}
          </div>
          {t("openLogDir", "打开应用日志所在文件夹")}
        </div>
        <Button variant="outline" onclick={openLogDir}>
          {t("openLogsButton", "打开日志")}
        </Button>
      </div>

      <div class="mt-4 flex items-center justify-between gap-3">
        <div class="text-sm text-muted-foreground">
          <div class="font-medium text-foreground">
            {t("bundleTitle", "调试压缩包")}
          </div>
          {t("bundleDescription", "生成包含最近日志的 ZIP，便于支持与排查")}
        </div>
        <Button variant="outline" onclick={createDiagnosticsBundle}>
          {t("bundleButton", "创建调试压缩包")}
        </Button>
      </div>
      <div class="mt-4 border-t border-border/50 pt-4">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div class="min-w-0 text-sm text-muted-foreground">
            <div class="font-medium text-foreground">
              {t("cleanupTitle", "Diagnostic File Cleanup")}
            </div>
            {t("cleanupDescription", "Delete old debug bundles and app-data Event Logger session files. This does not delete profiles, settings, or saved encounters.")}
          </div>
          <div class="flex flex-wrap items-end gap-3">
            <label class="flex flex-col gap-1 text-sm text-muted-foreground">
              <span>{t("cleanupOlderThanDays", "Older than days")}</span>
              <input
                class="h-9 w-24 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                type="number"
                min="0"
                step="1"
                bind:value={cleanupDays}
                aria-label={t("cleanupOlderThanDays", "Older than days")}
              />
            </label>
            <label class="flex h-9 items-center gap-2 rounded-md border border-border/60 bg-background px-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                bind:checked={cleanupIncludeEventSessions}
              />
              <span>{t("cleanupIncludeEventSessions", "Include Event Logger sessions")}</span>
            </label>
            <Button variant="outline" onclick={cleanupDiagnosticsFiles} disabled={cleanupRunning}>
              {cleanupRunning ? t("cleanupRunning", "Cleaning...") : t("cleanupButton", "Clean Diagnostics")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
