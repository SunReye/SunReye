<!-- One connection under Settings › Connections: where it reaches and a broker's state, each on its own line; it opens its level. -->
<script lang="ts">
  import { Pressable } from "../components/ui/pressable/index.js";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import * as Item from "#lib/components/ui/item/index.js";
  import type { Connection } from "../api/core";
  import { m } from "../paraglide/messages.js";

  let { connection, onclick }: { connection: Connection; onclick: () => void } = $props();

  /** A broker's state; other transports report none. */
  const state = $derived.by(() => {
    const { name, status } = connection;

    if (!status) return null;

    if (status.connected) return { text: m.status_connected({ name }), tone: "bg-success" };

    return {
      text: status.lastError
        ? m.status_failed({ name, error: status.lastError })
        : m.status_disconnected({ name }),
      tone: status.lastError ? "bg-destructive" : "bg-muted-foreground",
    };
  });

  const reach = $derived(`${connection.transport} · ${connection.host}:${connection.port}`);
</script>

<Item.Root class="rounded-none border-0">
  {#snippet child({ props })}
    <Pressable
      feedback
      {...props}
      {onclick}
      class={[props.class, "group flex-nowrap text-left"]}
    >
      <Item.Content class="min-w-0">
        <Item.Title class="text-[15px]">{connection.name}</Item.Title>
        <Item.Description class="truncate tabular-nums">{reach}</Item.Description>
        {#if state}
          <Item.Description class="flex items-center gap-1.5">
            <span class={["size-1.5 shrink-0 rounded-full", state.tone]}></span>
            <span class="truncate">{state.text}</span>
          </Item.Description>
        {/if}
      </Item.Content>
      <Item.Actions>
        <ChevronRight
          class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </Item.Actions>
    </Pressable>
  {/snippet}
</Item.Root>
