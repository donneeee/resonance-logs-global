<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import {
    getDeathRecords,
    getLiveData,
  } from "$lib/stores/live-meter-store.svelte";
  import DeathList from "$lib/components/death-replay/death-list.svelte";
  import {
    deathRecordMatchesRoute,
    deathRecordRouteSubject,
  } from "$lib/death-record-identity";
  import {
    liveEntityMatchesRoute,
    livePlayerRoute,
    liveRouteIdentityFromSearch,
    type LiveEntityRouteSubject,
  } from "$lib/live-entity-route";

  const routeIdentity = $derived(liveRouteIdentityFromSearch(page.url.searchParams));
  const playerUid = $derived(routeIdentity.playerUid ?? -1);

  const liveData = $derived(getLiveData());
  const deathRecords = $derived(getDeathRecords());

  const deaths = $derived(
    deathRecords.filter((record) => deathRecordMatchesRoute(record, routeIdentity)),
  );
  const entity = $derived(
    liveData?.entities.find((entity) => liveEntityMatchesRoute(entity, routeIdentity)) ?? null,
  );
  const isLocalPlayer = $derived(
    liveData?.localPlayerKey && entity?.entityKey
      ? liveData.localPlayerKey === entity.entityKey
      : liveData?.localPlayerUid != null && playerUid === liveData.localPlayerUid,
  );

  const routeSubject = $derived.by<LiveEntityRouteSubject>(() => {
    const firstRecord = deaths[0];
    return (
      entity ??
      (firstRecord
        ? deathRecordRouteSubject(firstRecord)
        : {
            uid: playerUid,
            entityKey: routeIdentity.entityKey,
          })
    );
  });

  function handleSelect(deathTimestampMs: number) {
    goto(
      livePlayerRoute("/live/death/replay", routeSubject, { deathTs: deathTimestampMs }),
    );
  }
</script>

<svelte:window oncontextmenu={() => window.history.back()} />

<DeathList
  playerName=""
  className={entity?.className ?? ""}
  classSpecName={entity?.classSpecName ?? ""}
  {isLocalPlayer}
  {deaths}
  fightStartTimestampMs={Number(liveData?.fightStartTimestampMs ?? 0) || null}
  onSelect={handleSelect}
/>
