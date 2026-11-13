<!-- Settings › Connections: where the core reaches its devices, and each broker's state. -->
<script lang="ts">
  import type { Core } from "../api/core";
  import * as Item from "#lib/components/ui/item/index.js";
  import LoadingRows from "../components/loading-rows.svelte";
  import ConnectionRow from "./ConnectionRow.svelte";
  import Listing from "./Listing.svelte";

  let { core }: { core: Core } = $props();

  const connections = $derived(core.connections());
</script>

{#await connections}
  <LoadingRows />
{:then answer}
  <Listing {answer}>
    {#snippet items(list)}
      <Item.Group class="gap-0 divide-y divide-border/60">
        {#each list as connection (connection.id)}
          <ConnectionRow {connection} />
        {/each}
      </Item.Group>
    {/snippet}
  </Listing>
{/await}
