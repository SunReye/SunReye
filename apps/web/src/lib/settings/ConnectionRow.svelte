<!-- One connection under Settings › Connections: where it reaches, and a broker's state. -->
<script lang="ts">
  import type { Connection } from "../api/core";
  import * as Item from "#lib/components/ui/item/index.js";
  import { m } from "../paraglide/messages.js";

  let { connection }: { connection: Connection } = $props();

  /** A broker's state; other transports report none. */
  const state = $derived.by(() => {
    const { name, status } = connection;

    if (!status) return null;

    if (status.connected) return m.status_connected({ name });

    return status.lastError
      ? m.status_failed({ name, error: status.lastError })
      : m.status_disconnected({ name });
  });
</script>

<Item.Root class="rounded-none border-0">
  <Item.Content>
    <Item.Title class="text-[15px] font-normal">{connection.name}</Item.Title>
    <Item.Description class="tabular-nums">
      {connection.transport} · {connection.host}:{connection.port}
    </Item.Description>
    {#if state}<Item.Description>{state}</Item.Description>{/if}
  </Item.Content>
</Item.Root>
