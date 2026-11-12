<!-- Settings › Connections: where the core reaches its devices, and each broker's state. -->
<script lang="ts">
  import type { Connection, Core } from "../api/core";
  import * as Item from "#lib/components/ui/item/index.js";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";

  let { core }: { core: Core } = $props();

  const connections = $derived(core.connections());

  /** A broker's state; other transports report none. */
  function state(connection: Connection): string | undefined {
    const { name, status } = connection;

    if (!status) return undefined;

    if (status.connected) return m.status_connected({ name });

    return status.lastError
      ? m.status_failed({ name, error: status.lastError })
      : m.status_disconnected({ name });
  }
</script>

{#await connections then answer}
  {#if "problem" in answer}
    <p role="alert" class="p-4">{problemText(answer.problem)}</p>
  {:else if answer.length === 0}
    <p class="p-4 text-sm text-muted-foreground">{m.settings_none()}</p>
  {:else}
    <Item.Group class="gap-0 divide-y divide-border/60">
      {#each answer as connection (connection.id)}
        <Item.Root class="rounded-none border-0">
          <Item.Content>
            <Item.Title class="text-[15px] font-normal">{connection.name}</Item.Title>
            <Item.Description class="tabular-nums">
              {connection.transport} · {connection.host}:{connection.port}
            </Item.Description>
            {#if state(connection)}<Item.Description>{state(connection)}</Item.Description>{/if}
          </Item.Content>
        </Item.Root>
      {/each}
    </Item.Group>
  {/if}
{/await}
