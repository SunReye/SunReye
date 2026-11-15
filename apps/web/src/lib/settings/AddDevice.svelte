<!--
  Settings › Devices › Add: setup's scan and endpoint entry first; a device on a connection, such
  as an EVCC loadpoint on its broker, one step away.
-->
<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import type { Connection, Core, Device } from "../api/core";
  import { Button } from "#lib/components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";
  import DevicesStep from "../setup/DevicesStep.svelte";
  import DeviceForm from "./DeviceForm.svelte";

  let {
    core,
    known,
    onadded,
  }: {
    core: Core;
    known: { readonly connections: readonly Connection[]; readonly devices: readonly Device[] };
    onadded: () => void;
  } = $props();

  let onConnection = $state(false);
</script>

<DevicesStep {core} {known} ondone={onadded} />
<div class="flex flex-col gap-2 border-t border-border/60 p-4">
  {#if onConnection}
    <h4 class="text-sm font-medium">{m.settings_device_on_connection()}</h4>
    <p class="text-sm text-muted-foreground">{m.settings_device_on_connection_hint()}</p>
  {:else}
    <Button
      variant="outline"
      class="self-start"
      onclick={() => {
        onConnection = true;
      }}
    >
      <Plus data-icon="inline-start" />
      {m.settings_device_on_connection()}
    </Button>
  {/if}
</div>
{#if onConnection}
  <DeviceForm {core} connections={known.connections} onsaved={onadded} />
{/if}
