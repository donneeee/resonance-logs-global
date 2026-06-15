<script lang="ts">
  import { goto } from "$app/navigation";
  import {
    getDeathRecords,
    getLiveData,
  } from "$lib/stores/live-meter-store.svelte";
  import DeathPlayerList, {
    type DeathPlayerEntry,
  } from "$lib/components/death-replay/death-player-list.svelte";
  import {
    deathRecordIdentityKey,
    deathRecordRouteIdentity,
    deathRecordVictimEntityKey,
    deathRecordVictimUid,
    deathRecordVictimUuid,
  } from "$lib/death-record-identity";
  import { liveEntityMatchesRoute, livePlayerRoute } from "$lib/live-entity-route";

  let liveData = $derived(getLiveData());
  let deathRecords = $derived(getDeathRecords());

  let entries = $derived.by<DeathPlayerEntry[]>(() => {
    const grouped = new Map<string, DeathPlayerEntry>();
    for (const record of deathRecords) {
      const uid = deathRecordVictimUid(record);
      const identityKey = deathRecordIdentityKey(record);
      let entry = grouped.get(identityKey);
      if (!entry) {
        const routeIdentity = deathRecordRouteIdentity(record);
        const liveEntity = liveData?.entities.find((e) =>
          liveEntityMatchesRoute(e, routeIdentity),
        );
        entry = {
          uid,
          uuid: deathRecordVictimUuid(record),
          entityKey: liveEntity?.entityKey ?? deathRecordVictimEntityKey(record),
          name: liveEntity?.name ?? `#${uid}`,
          className: liveEntity?.className ?? "",
          classSpecName: liveEntity?.classSpecName ?? "",
          deaths: [],
        };
        grouped.set(identityKey, entry);
      }
      entry.deaths.push(record);
    }
    return Array.from(grouped.values());
  });

  function handleSelect(uid: number, entry?: DeathPlayerEntry) {
    goto(livePlayerRoute("/live/death/deaths", entry ?? { uid }));
  }
</script>

<DeathPlayerList
  {entries}
  localPlayerUid={liveData?.localPlayerUid ?? null}
  localPlayerKey={liveData?.localPlayerKey ?? null}
  onSelect={handleSelect}
/>
