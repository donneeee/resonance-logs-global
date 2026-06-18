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
  }: {
    enabled?: boolean;
    image?: string;
    fallbackImage?: string;
    mode?: BackgroundImageMode;
    containColor?: string;
    opacity?: number;
  } = $props();

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

  let renderedImage = $state("");
  let loadToken = 0;

  function isDirectImageSource(source: string): boolean {
    return /^(data:|blob:|https?:|asset:|tauri:)/i.test(source);
  }

  function convertLocalFileSource(source: string): string {
    return convertFileSrc(/^file:/i.test(source) ? fileUrlToPath(source) : source);
  }

  function setConvertedLocalSource(source: string): boolean {
    if (!source.trim()) return false;
    try {
      renderedImage = convertLocalFileSource(source);
      return true;
    } catch (error) {
      console.warn("Failed to convert background image path", error);
      renderedImage = "";
      return false;
    }
  }

  function cssUrlValue(source: string): string {
    return source.replace(/\\/g, "\\\\").replace(/"/g, "%22").replace(/[\r\n]/g, "");
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
    let cancelled = false;

    renderedImage = "";

    invoke<string>("load_background_image_data_url", { imagePath: localPath })
      .then((dataUrl) => {
        if (!cancelled && token === loadToken) {
          renderedImage = dataUrl;
        }
      })
      .catch((error) => {
        if (!cancelled && token === loadToken) {
          console.warn("Failed to load background image data", error);
          if (
            fallbackSource &&
            fallbackSource !== source &&
            setConvertedLocalSource(fallbackSource)
          ) {
            return;
          }
          setConvertedLocalSource(source);
        }
      });

    return () => {
      cancelled = true;
    };
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
    ].join("; ");
  });
</script>

{#if visible}
  <div
    class="pointer-events-none absolute inset-0 z-0"
    style={layerStyle}
  ></div>
{/if}
