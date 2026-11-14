<!-- Indexed readings compared side by side: a line per MPPT input or phase, the unit in the head
  but a power's, which each cell writes as W or kW. -->
<script lang="ts">
  import * as Kit from "../components/ui/table/index.js";
  import { isPower } from "../power.ts";
  import ReadingCell from "./ReadingCell.svelte";
  import type { Table } from "./rows.ts";

  let { table, loading, silent }: { table: Table; loading: boolean; silent: boolean } = $props();
</script>

<Kit.Root class="border-t border-border/50">
  <Kit.Header class="[&_tr]:border-border/50">
    <Kit.Row class="text-xs text-muted-foreground hover:bg-transparent">
      <Kit.Cell class="p-0"></Kit.Cell>
      {#each table.cols as col (col.label)}
        <Kit.Head
          scope="col"
          class="h-auto py-1.5 pr-0 pl-3 text-right font-normal text-muted-foreground"
          >{col.label}
          {#if !isPower(col.unit)}<span class="opacity-70">{col.unit}</span>{/if}</Kit.Head
        >
      {/each}
    </Kit.Row>
  </Kit.Header>
  <Kit.Body>
    {#each table.rows as line (line.key)}
      <Kit.Row class="border-border/50 hover:bg-transparent">
        <Kit.Head scope="row" class="h-auto px-0 py-2 font-normal text-muted-foreground"
          >{line.label}</Kit.Head
        >
        {#each line.cells as cell, i (i)}
          <ReadingCell {cell} {loading} {silent} />
        {/each}
      </Kit.Row>
    {/each}
  </Kit.Body>
</Kit.Root>
