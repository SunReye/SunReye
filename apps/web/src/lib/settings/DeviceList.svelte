<!--
  Settings › Devices' list: each device with its profile and connection, the measuring points'
  review after a change, the add action, and the profile updates waiting for the admin.
-->
<script lang="ts">
  import type { Connection, Core, Device } from "../api/core";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Item from "#lib/components/ui/item/index.js";
  import DrillRow from "../components/drill-in/drill-row.svelte";
  import { m } from "../paraglide/messages.js";
  import AddRow from "./AddRow.svelte";
  import ProfileUpdates from "./ProfileUpdates.svelte";

  let {
    core,
    devices,
    connections,
    changed,
    onopen,
    onadd,
    onreview,
  }: {
    core: Core;
    devices: readonly Device[];
    connections: readonly Connection[];
    /** Whether a device changed since the measuring points were last reviewed here. */
    changed: boolean;
    onopen: (id: number) => void;
    onadd: () => void;
    onreview: () => void;
  } = $props();

  const named = $derived(new Map(connections.map((c) => [c.id, c.name])));

  /** Its profile, and its connection's name when listed. */
  function summary(device: Device): string {
    const connection = named.get(device.connection);

    return connection === undefined
      ? device.profile
      : m.settings_device_summary({ profile: device.profile, connection });
  }
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  {#each devices as device (device.id)}
    <DrillRow
      group={{
        id: String(device.id),
        label: device.name,
        summary: summary(device),
      }}
      onclick={() => {
        onopen(device.id);
      }}
    />
  {/each}
</Item.Group>
{#if changed}
  <div class="flex flex-col gap-2 border-t border-border/60 p-4">
    <p role="status" class="text-sm text-muted-foreground">{m.settings_topology_hint()}</p>
    <Button variant="outline" class="self-start" onclick={onreview}>
      {m.settings_topology_review()}
    </Button>
  </div>
{/if}
<div class="border-t border-border/60">
  <AddRow label={m.settings_device_add()} onclick={onadd} />
</div>
<ProfileUpdates {core} onapplied={() => undefined} />
