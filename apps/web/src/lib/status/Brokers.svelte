<script lang="ts">
  import type { Connection } from "../api/core";
  import { m } from "../paraglide/messages.js";

  /** Every connection; only brokers report a state. */
  let { connections }: { connections: readonly Connection[] } = $props();

  let brokers = $derived(connections.filter((c) => c.status));

  function state(broker: Connection): string {
    const name = broker.name;
    const error = broker.status?.lastError;

    if (broker.status?.connected === true) return m.status_connected({ name });

    return error ? m.status_failed({ name, error }) : m.status_disconnected({ name });
  }
</script>

{#if brokers.length > 0}
  <section aria-label={m.status_brokers()}>
    <h2>{m.status_brokers()}</h2>
    <ul>
      {#each brokers as broker (broker.id)}
        <li>{state(broker)}</li>
      {/each}
    </ul>
  </section>
{/if}
