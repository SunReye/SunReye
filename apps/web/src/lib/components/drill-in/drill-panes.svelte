<!-- The drill-in from 1024 px: the groups on the left, the chosen group's page on the right; nothing slides. -->
<script lang="ts">
  import * as Card from "#lib/components/ui/card/index.js";
  import type { Snippet } from "svelte";
  import * as Item from "../ui/item/index.js";
  import type { DrillGroup, DrillLevel } from "./drill-in.svelte";
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
    heading: Snippet<[DrillLevel]> | undefined;
    page: Snippet<[DrillGroup]>;
  } = $props();
</script>

<div class="flex w-full flex-col gap-4 py-6 pr-6">
  {@render heading?.("root")}
  <div class="grid grid-cols-[minmax(260px,340px)_minmax(0,1fr)] items-start gap-6">
    <Card.Root element="nav" aria-label={label} class="gap-0 py-0">
      <Item.Group class="gap-0 divide-y divide-border/60">
        {#each groups as g (g.id)}
          <DrillRow group={g} current={pane?.id === g.id} onclick={() => onpick(g.id)} />
        {/each}
      </Item.Group>
    </Card.Root>

    {#if pane}
      <Card.Root element="section" aria-label={pane.label} class="gap-0 py-0">
        <h2 class="border-b border-border/60 px-4 py-3 text-[15px] font-semibold">
          {pane.label}
        </h2>
        {@render page(pane)}
      </Card.Root>
    {/if}
  </div>
</div>
