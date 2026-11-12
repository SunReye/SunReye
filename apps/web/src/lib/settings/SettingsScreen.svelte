<script lang="ts">
  import type { Core } from "../api/core";
  import { problemText } from "../i18n/problems";
  import DeviceSettings from "./DeviceSettings.svelte";
  import ImportPanel from "./ImportPanel.svelte";
  import ProfileUpdates from "./ProfileUpdates.svelte";
  import WriteLog from "./WriteLog.svelte";

  let { core }: { core: Core } = $props();

  // Read again after an enable changes or an update applies.
  let capabilities = $derived(core.capabilities());

  // The core refuses it without the admin's session.
  const log = $derived(core.writes());

  function reread(): void {
    capabilities = core.capabilities();
  }
</script>

<main>
  <ProfileUpdates {core} onapplied={reread} />

  {#await capabilities then answer}
    {#if "problem" in answer}
      <p role="alert">{problemText(answer.problem)}</p>
    {:else}
      {#each Object.entries(answer.devices).filter(([, d]) => d.settings.length > 0) as [id, device] (id)}
        <DeviceSettings {core} {id} {device} onchanged={reread} />
      {/each}
    {/if}
  {/await}
  {#await log then answer}
    <WriteLog log={answer} />
  {/await}
  <ImportPanel {core} />
</main>
