<!-- The drill-in from 1024 px: the groups on the left, the chosen group's page on the right; nothing slides. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Item from "../ui/item/index.js";
  import type { DrillGroup } from "./drill-in.svelte";
  import DrillRow from "./drill-row.svelte";

  let {
    groups,
    pane,
    onpick,
    label,
    heading,
    page,
  }: {
    groups: readonly DrillGroup[];
    pane: DrillGroup | undefined;
    onpick: (id: string) => void;
    label: string;
    heading: Snippet | undefined;
    page: Snippet<[DrillGroup]>;
  } = $props();
</script>

<div class="flex w-full flex-col gap-4 py-6 pr-6">
  {@render heading?.()}
  <div class="grid grid-cols-[minmax(260px,340px)_minmax(0,1fr)] items-start gap-6">
    <nav
      aria-label={label}
      class="glass-ambient overflow-hidden rounded-lg border border-border/60 elevation-1"
    >
      <Item.Group class="gap-0 divide-y divide-border/60">
        {#each groups as g (g.id)}
          <DrillRow group={g} current={pane?.id === g.id} onclick={() => onpick(g.id)} />
        {/each}
      </Item.Group>
    </nav>

    {#if pane}
      <section
        aria-label={pane.label}
        class="glass-ambient overflow-hidden rounded-lg border border-border/60 elevation-1"
      >
        <h2 class="border-b border-border/60 px-4 py-3 text-[15px] font-semibold">
          {pane.label}
        </h2>
        {@render page(pane)}
      </section>
    {/if}
  </div>
</div>
