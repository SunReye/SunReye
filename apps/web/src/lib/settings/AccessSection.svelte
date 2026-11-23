<!--
  One kind of access under Settings › Users & access: its rows as the core lists them, then a row that
  opens the form adding one, in a drawer on the phone and a dialog with the rail.
-->
<script lang="ts" generics="T extends { id: number }">
  import DrillCard from "../components/drill-in/drill-card.svelte";
  import Eyebrow from "../components/eyebrow.svelte";
  import type { Snippet } from "svelte";
  import type { Problem } from "../api/core";
  import * as Item from "@sunreye/ui/item";
  import LoadingRows from "../components/loading-rows.svelte";
  import ResponsiveSheet from "../components/responsive-sheet.svelte";
  import AddRow from "./AddRow.svelte";
  import Listing from "./Listing.svelte";

  let {
    id,
    title,
    hint,
    answer,
    row,
    action,
    form,
    more,
  }: {
    id: string;
    title: string;
    hint: string;
    /** Undefined until the core answers. */
    answer: readonly T[] | Problem | undefined;
    row: Snippet<[T]>;
    /** The add row's label. */
    action: string;
    /** The add form; it calls `close` once done or cancelled. */
    form: Snippet<[close: () => void]>;
    /** After the hint: where to read on. */
    more?: Snippet;
  } = $props();

  let adding = $state(false);

  const close = () => {
    adding = false;
  };
</script>

<section aria-labelledby={id} class="flex flex-col">
  <header class="flex flex-col gap-1 px-4 pt-5 pb-2">
    <Eyebrow {id}>{title}</Eyebrow>
    <p class="text-sm text-muted-foreground">{hint}</p>
    {@render more?.()}
  </header>
  <DrillCard class="divide-y divide-border/60 border-y border-border/60">
    {#if answer === undefined}
      <LoadingRows rows={1} />
    {:else}
      <Listing {answer}>
        {#snippet items(list)}
          <Item.Group class="gap-0 divide-y divide-border/60">
            {#each list as item (item.id)}{@render row(item)}{/each}
          </Item.Group>
        {/snippet}
      </Listing>
    {/if}
    {#if answer !== undefined && !("problem" in answer)}
      <AddRow
        label={action}
        onclick={() => {
          adding = true;
        }}
      />
    {/if}
  </DrillCard>
  <ResponsiveSheet bind:open={adding} label={action}>{@render form(close)}</ResponsiveSheet>
</section>
