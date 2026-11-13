<!-- Settings › Logs: every write with its outcome (ADR 7). -->
<script lang="ts">
  import type { Core } from "../api/core";
  import LoadingRows from "../components/loading-rows.svelte";
  import WriteLog from "./WriteLog.svelte";

  let { core }: { core: Core } = $props();

  /** The log, and the devices that name its entries; a device list refused leaves them by id. */
  function load() {
    return Promise.all([core.writes(), core.devices()]).then(([log, devices]) => ({
      log,
      names: new Map("problem" in devices ? [] : devices.map((d) => [d.id, d.name] as const)),
    }));
  }

  const answer = $derived(load());
</script>

{#await answer}
  <LoadingRows rows={3} />
{:then { log, names }}
  <WriteLog {log} devices={names} />
{/await}
