<!-- Settings › Logs: every write with its outcome (ADR 7). -->
<script lang="ts">
  import type { Core } from "../api/core";
  import LoadingRows from "../components/loading-rows.svelte";
  import WriteLog from "./WriteLog.svelte";

  let { core }: { core: Core } = $props();

  /** The log, and the devices that name its entries; a device list refused leaves them by id. */
  async function load() {
    const [log, devices] = await Promise.all([core.writes(), core.devices()]);

    const names = new Map("problem" in devices ? [] : devices.map((d) => [d.id, d.name] as const));

    return { log, names };
  }

  const answer = $derived(load());
</script>

{#await answer}
  <LoadingRows rows={3} />
{:then { log, names }}
  <WriteLog {log} devices={names} />
{/await}
