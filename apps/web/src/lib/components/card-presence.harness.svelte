<!-- Test harness: a card that data shows or takes away, in a column with a gap, between two that stay. -->
<script lang="ts">
  import * as Card from "@sunreye/ui/card";

  let {
    shown,
    screen = true,
    grid = false,
  }: {
    /** Whether the data says the card is there. */
    shown: boolean;
    /** Whether the screen that holds the column is shown: a route's change takes it away whole. */
    screen?: boolean;
    /** The cards stand in a grid, not a column. */
    grid?: boolean;
  } = $props();
</script>

{#if screen}
  <div class={["w-80 gap-4", grid ? "grid" : "flex flex-col"]}>
    <Card.Root data-testid="above"><div class="h-10"></div></Card.Root>
    {#if shown}
      <Card.Presence>
        <Card.Root data-testid="card"><div class="h-30"></div></Card.Root>
      </Card.Presence>
    {/if}
    <Card.Root data-testid="below"><div class="h-10"></div></Card.Root>
  </div>
{/if}
