<script lang="ts">
  /**
   * @file Settings file picker component for importing files (images, fonts)
   */
  import { open } from "@tauri-apps/plugin-dialog";
  import UploadIcon from "virtual:icons/lucide/upload";
  import XIcon from "virtual:icons/lucide/x";

  interface Props {
    label: string;
    description?: string;
    value: string;
    displayName?: string;
    accept: string;
    storage?: "dataUrl" | "path";
    onchange: (value: string, fileName: string) => void | Promise<void>;
    onclear: () => void | Promise<void>;
  }

  let {
    label,
    description,
    value,
    displayName: storedDisplayName = "",
    accept,
    storage = "dataUrl",
    onchange,
    onclear,
  }: Props = $props();

  let fileInput: HTMLInputElement;
  let fileName = $state('');
  let isLoading = $state(false);

  // Extract filename from value if it's a data URL with name
  $effect(() => {
    if (!value) {
      fileName = '';
    }
  });

  const displayValue = $derived(
    fileName || storedDisplayName || fileNameFromPath(value) || (value ? 'File loaded' : ''),
  );

  function fileNameFromPath(pathOrUrl: string): string {
    if (!pathOrUrl || pathOrUrl.startsWith("data:")) return "";
    const normalized = pathOrUrl.replace(/\\/g, "/");
    const name = normalized.split("/").pop() ?? "";
    return name ? decodeURIComponent(name) : "";
  }

  function dialogExtensionsFromAccept(value: string): string[] {
    if (value.includes("image/*")) {
      return ["png", "jpg", "jpeg", "webp", "gif", "bmp"];
    }
    return value
      .split(",")
      .map((part) => part.trim().replace(/^\./, ""))
      .filter((part) => part.length > 0 && !part.includes("/"));
  }

  async function handleBrowseClick() {
    if (storage !== "path") {
      fileInput?.click();
      return;
    }

    isLoading = true;
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: label,
            extensions: dialogExtensionsFromAccept(accept).length
              ? dialogExtensionsFromAccept(accept)
              : ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
          },
        ],
      });
      const selectedPath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof selectedPath !== "string" || !selectedPath) {
        return;
      }
      fileName = fileNameFromPath(selectedPath);
      await onchange(selectedPath, fileName);
    } catch (error) {
      console.error("Failed to choose file", error);
    } finally {
      isLoading = false;
    }
  }

  function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    isLoading = true;
    fileName = file.name;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      await onchange(dataUrl, file.name);
      isLoading = false;
    };
    reader.onerror = () => {
      console.error('Failed to read file');
      isLoading = false;
    };
    reader.readAsDataURL(file);
  }

  async function handleClear() {
    fileName = '';
    if (fileInput) {
      fileInput.value = '';
    }
    await onclear();
  }
</script>

<div class="flex items-center justify-between py-2.5 px-3 min-h-[48px] rounded-lg hover:bg-popover/40 transition-colors gap-4">
  <div class="flex flex-col min-w-0 flex-1">
    <span class="text-sm font-medium text-foreground">{label}</span>
    {#if description}
      <span class="text-xs text-muted-foreground mt-0.5">{description}</span>
    {/if}
  </div>
  
  <div class="flex items-center gap-2 shrink-0">
    {#if value || fileName}
      <span class="text-xs text-muted-foreground max-w-[150px] truncate">
        {displayValue}
      </span>
      <button
        type="button"
        class="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
        onclick={handleClear}
        title="Clear"
      >
        <XIcon class="w-4 h-4" />
      </button>
    {/if}
    
    <button
      type="button"
      class="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-foreground text-sm font-medium cursor-pointer transition-colors disabled:opacity-60"
      onclick={handleBrowseClick}
      disabled={isLoading}
    >
      <UploadIcon class="w-4 h-4" />
      <span>{value || fileName ? 'Change' : 'Browse'}</span>
    </button>
    <input
      bind:this={fileInput}
      type="file"
      {accept}
      class="hidden"
      onchange={handleFileSelect}
      disabled={isLoading}
    />
  </div>
</div>
