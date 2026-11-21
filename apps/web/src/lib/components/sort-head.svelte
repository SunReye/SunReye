<!--
  A sortable column's head (ADR 21 "One behaviour, one component"): a press sorts by it, or turns
  its sort around, with `selection`; it says which way the table is sorted by it.
-->
<script lang="ts">
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Table from "#lib/components/ui/table/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";

  let {
    name,
    unit,
    figure,
    dir,
    onpress,
  }: {
    name: string;
    unit: string | null;
    /** A figure stands right, over its numbers. */
    figure: boolean;
    /** Which way the table is sorted by this column; null while it is not. */
    dir: "asc" | "desc" | null;
    onpress: () => void;
  } = $props();

  const SORT = { asc: "ascending", desc: "descending" } as const;
  const Arrow = $derived(dir === "desc" ? ArrowDown : ArrowUp);
</script>

<Table.Head
  scope="col"
  class={["h-9 px-0", figure && "text-right"]}
  aria-sort={dir === null ? "none" : SORT[dir]}
>
  <Button
    variant="ghost"
    class={[
      "h-9 gap-1 rounded-sm px-2 text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground",
      dir !== null && "text-foreground",
    ]}
    aria-label={m.explore_fold_sort({ column: name })}
    onclick={() => {
      haptics.selection();
      onpress();
    }}
  >
    <span>{name}</span>
    {#if unit}<span class="font-normal">({unit})</span>{/if}
    <Arrow class={["size-3.5", dir === null && "invisible"]} />
  </Button>
</Table.Head>
