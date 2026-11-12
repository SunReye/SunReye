<!-- One kind of access under Settings › Users & access: its rows as the core lists them, then the form that adds one. -->
<script lang="ts" generics="T extends { id: number }">
  import type { Snippet } from "svelte";
  import type { Problem } from "../api/core";
  import * as Item from "#lib/components/ui/item/index.js";
  import Listing from "./Listing.svelte";

  let {
    id,
    title,
    hint,
    answer,
    row,
    children,
  }: {
    id: string;
    title: string;
    hint: string;
    /** Undefined until the core answers. */
    answer: readonly T[] | Problem | undefined;
    row: Snippet<[T]>;
    children: Snippet;
  } = $props();
</script>

<section aria-labelledby={id} class="flex flex-col">
  <header class="flex flex-col gap-1 px-4 pt-4">
    <h2 {id} class="text-[15px] font-medium">{title}</h2>
    <p class="text-sm text-muted-foreground">{hint}</p>
  </header>
  {#if answer !== undefined}
    <Listing {answer}>
      {#snippet items(list)}
        <Item.Group class="gap-0 divide-y divide-border/60">
          {#each list as item (item.id)}{@render row(item)}{/each}
        </Item.Group>
      {/snippet}
    </Listing>
  {/if}
  {@render children()}
</section>
