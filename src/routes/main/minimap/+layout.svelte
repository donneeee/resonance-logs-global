<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";

  onMount(() => {
    void goto("/main/overlay/dbm", { replaceState: true });
  });
</script>

<div class="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
  {t("minimap.redirect")}
</div>
