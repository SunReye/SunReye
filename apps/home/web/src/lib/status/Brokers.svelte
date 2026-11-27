<script lang="ts">
  import Section from "../components/section.svelte";
  import { settleRead } from "../api/client.ts";
  import type { Connection, Core } from "../api/core";
  import { Presence } from "@sunreye/ui/card";
  import * as Item from "@sunreye/ui/item";
  import { m } from "../paraglide/messages.js";

  /** Every connection, once the core answers; a viewer's is refused. Only brokers report a state. */
  let { answer }: { answer: ReturnType<Core["connections"]> } = $props();

  // What the core last answered, kept while it is asked again: the card neither leaves nor comes
  // back on a refresh, and it appears on the screen already shown (ADR 21).
  let connections = $state.raw<readonly Connection[]>([]);

  $effect(() => {
    let latest = true;

    const take = async () => {
      // A core lost mid-read leaves what it last answered.
      const read = await settleRead(answer);

      if (latest && !read.failed) connections = "problem" in read.data ? [] : read.data;
    };

    void take();

    return () => {
      latest = false;
    };
  });

  let brokers = $derived(connections.filter((c) => c.status));

  function told(broker: Connection): string {
    const error = broker.status?.lastError;

    if (broker.status?.connected === true) return m.broker_connected();

    return error ? m.broker_failed({ error }) : m.broker_disconnected();
  }
</script>

{#if brokers.length > 0}
  <Presence>
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
              <Item.Description class={{ "text-destructive": !up }}>
                {told(broker)}
              </Item.Description>
            </Item.Content>
          </Item.Root>
        {/each}
      </Item.Group>
    </Section>
  </Presence>
{/if}
