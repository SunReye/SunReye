<!-- One connection under Settings › Connections: where it reaches and a broker's state; it opens its level. -->
<script lang="ts">
  import type { Connection } from "../api/core";
  import DrillRow from "../components/drill-in/drill-row.svelte";
  import { m } from "../paraglide/messages.js";

  let { connection, onclick }: { connection: Connection; onclick: () => void } = $props();

  /** A broker's state; other transports report none. */
  const state = $derived.by(() => {
    const { name, status } = connection;

    if (!status) return null;

    if (status.connected) return m.status_connected({ name });

    return status.lastError
      ? m.status_failed({ name, error: status.lastError })
      : m.status_disconnected({ name });
  });

  const reach = $derived(`${connection.transport} · ${connection.host}:${connection.port}`);
</script>

<DrillRow
  group={{
    id: String(connection.id),
    label: connection.name,
    summary: state === null ? reach : `${reach} · ${state}`,
  }}
  {onclick}
/>
