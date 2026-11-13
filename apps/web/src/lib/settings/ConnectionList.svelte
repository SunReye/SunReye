<!-- Settings › Connections' list as the core answered it, and the add action. -->
<script lang="ts">
  import type { Connection, Problem } from "../api/core";
  import * as Item from "#lib/components/ui/item/index.js";
  import { m } from "../paraglide/messages.js";
  import AddRow from "./AddRow.svelte";
  import ConnectionRow from "./ConnectionRow.svelte";
  import Listing from "./Listing.svelte";

  let {
    answer,
    onopen,
    onadd,
  }: {
    answer: readonly Connection[] | Problem;
    onopen: (id: number) => void;
    onadd: () => void;
  } = $props();
</script>

<Listing {answer}>
  {#snippet items(list)}
    <Item.Group class="gap-0 divide-y divide-border/60">
      {#each list as connection (connection.id)}
        <ConnectionRow
          {connection}
          onclick={() => {
            onopen(connection.id);
          }}
        />
      {/each}
    </Item.Group>
  {/snippet}
</Listing>
{#if !("problem" in answer)}
  <div class="border-t border-border/60">
    <AddRow label={m.settings_connection_add()} onclick={onadd} />
  </div>
{/if}
