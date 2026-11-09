<script lang="ts">
  import type { Core } from "../api/core";
  import { problemText } from "../i18n/problems";
  import DeviceSettings from "./DeviceSettings.svelte";
  import WriteLog from "./WriteLog.svelte";

  let { core }: { core: Core } = $props();

  const capabilities = $derived(core.capabilities());

  // Read again after each write; the core refuses it without the admin's session.
  let log = $derived(core.writes());

  function reload(): void {
    log = core.writes();
  }
</script>

<main>
  {#await capabilities then answer}
    {#if "problem" in answer}
      <p role="alert">{problemText(answer.problem)}</p>
    {:else}
      {#each Object.entries(answer.devices).filter(([, d]) => d.settings.length > 0) as [id, device] (id)}
        <DeviceSettings {core} {id} {device} onwritten={reload} />
      {/each}
    {/if}
  {/await}
  {#await log then answer}
    <WriteLog log={answer} />
  {/await}
</main>
