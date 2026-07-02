<script lang="ts">
  import { convertFileSrc, invoke } from "@tauri-apps/api/core";

  type BackgroundImageMode = "cover" | "contain" | "fit-width";

  let {
    enabled = false,
    image = "",
    fallbackImage = "",
    mode = "cover",
    containColor = "rgba(0, 0, 0, 0)",
    opacity = 100,
    onRestored,
  }: {
    enabled?: boolean;
    image?: string;
    fallbackImage?: string;
    mode?: BackgroundImageMode;
    containColor?: string;
    opacity?: number;
    onRestored?: (imagePath: string) => void;
  } = $props();

  let renderedImage = $state("");
  let loadToken = 0;

  function fileUrlToPath(source: string): string {
    const url = new URL(source);
    let pathname = decodeURIComponent(url.pathname);
    if (url.hostname) {
      return `\\\\${url.hostname}${pathname.replace(/\//g, "\\")}`;
    }
    if (/^\/[a-zA-Z]:\//.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname.replace(/\//g, "\\");
  }

  function isDirectImageSource(source: string): boolean {
    return /^(data:|blob:|https?:|asset:|tauri:)/i.test(source);
  }

  function cssUrlValue(source: string): string {
    return source
      .replace(/\\/g, "\\\\")
      .replace(/"/g, "%22")
      .replace(/[\r\n]/g, "");
  }

  function localImageUrl(localPath: string): string {
    return convertFileSrc(localPath);
  }

  function restoreFallbackBackground(
    token: number,
    originalSource: string,
    fallbackSource: string,
  ) {
    if (!fallbackSource || fallbackSource === originalSource) {
      return;
    }
    invoke<string>("import_background_image", { sourcePath: fallbackSource })
      .then((restoredPath) => {
        if (token !== loadToken) return;
        onRestored?.(restoredPath);
        renderedImage = localImageUrl(restoredPath);
      })
      .catch((restoreError) => {
        if (token !== loadToken) return;
        console.warn("Failed to restore imported background image", restoreError);
      });
  }

  function loadLocalBackground(
    localPath: string,
    token: number,
    originalSource: string,
    fallbackSource: string,
  ) {
    try {
      renderedImage = localImageUrl(localPath);
    } catch (error) {
      if (token !== loadToken) return;
      console.warn("Failed to convert background image path", error);
      restoreFallbackBackground(token, originalSource, fallbackSource);
    }
  }

  $effect(() => {
    const source = image.trim();
    const fallbackSource = fallbackImage.trim();
    const token = ++loadToken;
    if (!source) {
      renderedImage = "";
      return;
    }
    if (isDirectImageSource(source)) {
      renderedImage = source;
      return;
    }

    const localPath = /^file:/i.test(source) ? fileUrlToPath(source) : source;
    renderedImage = "";
    loadLocalBackground(localPath, token, source, fallbackSource);
  });

  const visible = $derived(enabled && renderedImage.length > 0);
  const normalizedOpacity = $derived(Math.max(0, Math.min(100, opacity)) / 100);
  const layerStyle = $derived.by(() => {
    if (!visible) return "";
    const size = mode === "fit-width" ? "100% auto" : mode;
    const position = mode === "fit-width" ? "top center" : "center";

    return [
      `opacity: ${normalizedOpacity}`,
      `background-image: url("${cssUrlValue(renderedImage)}")`,
      `background-size: ${size}`,
      `background-position: ${position}`,
      "background-repeat: no-repeat",
      `background-color: ${mode === "cover" ? "transparent" : containColor}`,
    ].filter(Boolean).join("; ");
  });
</script>

{#if visible}
  <div
    class="app-background-layer pointer-events-none absolute inset-0 z-0"
    style={layerStyle}
  ></div>
{/if}

<style>
  .app-background-layer {
    backface-visibility: hidden;
    contain: paint;
    transform: translateZ(0);
    overflow: hidden;
    will-change: opacity, transform;
  }
</style>
