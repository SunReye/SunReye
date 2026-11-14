<script lang="ts">
  import Section from "../components/section.svelte";
  import type { Connection } from "../api/core";
  import * as Item from "#lib/components/ui/item/index.js";
  import { m } from "../paraglide/messages.js";

  /** Every connection; only brokers report a state. */
  let { connections }: { connections: readonly Connection[] } = $props();

  let brokers = $derived(connections.filter((c) => c.status));

  function state(broker: Connection): string {
    const error = broker.status?.lastError;

    if (broker.status?.connected === true) return m.broker_connected();

    return error ? m.broker_failed({ error }) : m.broker_disconnected();
  }
</script>

{#if brokers.length > 0}
  <Section card title={m.status_brokers()}>
    <Item.Group class="gap-0 divide-y divide-border/60">
      {#each brokers as broker (broker.id)}
        {@const up = broker.status?.connected === true}
        <Item.Root class="rounded-none border-0" role="listitem">
          <Item.Media>
            <span
              aria-hidden="true"
              class={["size-2 rounded-full", up ? "bg-muted-foreground/60" : "bg-destructive"]}
            ></span>
          </Item.Media>
          <Item.Content>
            <Item.Title class="text-[15px] font-normal">{broker.name}</Item.Title>
            <Item.Description class={{ "text-destructive": !up }}>{state(broker)}</Item.Description>
          </Item.Content>
        </Item.Root>
      {/each}
    </Item.Group>
  </Section>
{/if}
