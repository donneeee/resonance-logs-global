<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import {
    getDeathRecords,
    getLiveData,
  } from "$lib/stores/live-meter-store.svelte";
  import DeathReplayDetail from "$lib/components/death-replay/death-replay-detail.svelte";
  import { SETTINGS } from "$lib/settings-store";
  import { uiT } from "$lib/i18n";
  import { deathRecordMatchesRoute } from "$lib/death-record-identity";
  import {
    liveEntityMatchesLocalPlayer,
    liveEntityMatchesRoute,
    liveRouteIdentityFromSearch,
  } from "$lib/live-entity-route";

  const routeIdentity = $derived(liveRouteIdentityFromSearch(page.url.searchParams));
  const deathTs = $derived(Number(page.url.searchParams.get("deathTs") ?? "-1"));

  const liveData = $derived(getLiveData());
  const deathRecords = $derived(getDeathRecords());
  const t = uiT("dps/history", () => SETTINGS.live.general.state.language);

  const record = $derived(
    deathRecords.find(
      (r) =>
        deathRecordMatchesRoute(r, routeIdentity) &&
        Number(r.deathTimestampMs) === deathTs,
    ) ?? null,
  );
  const entity = $derived(
    liveData?.entities.find((entity) => liveEntityMatchesRoute(entity, routeIdentity)) ?? null,
  );
  const isLocalPlayer = $derived(liveEntityMatchesLocalPlayer(entity, liveData));

  function handleFallback() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      goto("/live/death");
    }
  }
</script>

<svelte:window oncontextmenu={() => window.history.back()} />

{#if record}
  <DeathReplayDetail
    playerName=""
    className={entity?.className ?? ""}
    classSpecName={entity?.classSpecName ?? ""}
    {isLocalPlayer}
    {record}
  />
{:else}
  <div
    class="flex h-40 items-center justify-center rounded-lg border border-dashed border-border/60 text-muted-foreground text-xs"
  >
    {t("detail.death.notFound", "Death record not found. It may have been reset.")}
    <button class="ml-2 underline" onclick={handleFallback}>
      {t("detail.death.backToList", "Back to list")}
    </button>
  </div>
{/if}
