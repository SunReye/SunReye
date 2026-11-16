<!-- A column's head in the fold's table: a press sorts by it, and it says which way it is sorted. -->
<script lang="ts">
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import * as Table from "#lib/components/ui/table/index.js";
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
  <button
    type="button"
    class={[
      "inline-flex h-9 items-center gap-1 rounded-sm px-2 text-xs font-medium text-muted-foreground hover:text-foreground",
      dir !== null && "text-foreground",
    ]}
    aria-label={m.explore_fold_sort({ column: name })}
    onclick={onpress}
  >
    <span>{name}</span>
    {#if unit}<span class="font-normal">({unit})</span>{/if}
    <Arrow class={["size-3.5", dir === null && "invisible"]} />
  </button>
</Table.Head>
