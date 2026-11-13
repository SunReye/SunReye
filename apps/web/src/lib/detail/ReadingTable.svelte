<!-- Indexed readings compared side by side: a line per MPPT input or phase, the unit in the head
  but a power's, which each cell writes as W or kW. -->
<script lang="ts">
  import { isPower } from "../power.ts";
  import ReadingCell from "./ReadingCell.svelte";
  import type { Table } from "./rows.ts";

  let { table, loading, silent }: { table: Table; loading: boolean; silent: boolean } = $props();
</script>

<table class="w-full border-t border-border/50 text-sm tabular-nums">
  <thead>
    <tr class="text-xs text-muted-foreground">
      <td></td>
      {#each table.cols as col (col.label)}
        <th scope="col" class="py-1.5 pl-3 text-right font-normal"
          >{col.label}
          {#if !isPower(col.unit)}<span class="opacity-70">{col.unit}</span>{/if}</th
        >
      {/each}
    </tr>
  </thead>
  <tbody class="divide-y divide-border/50 border-t border-border/50">
    {#each table.rows as line (line.key)}
      <tr>
        <th scope="row" class="py-2 text-left font-normal whitespace-nowrap text-muted-foreground"
          >{line.label}</th
        >
        {#each line.cells as cell, i (i)}
          <ReadingCell {cell} {loading} {silent} />
        {/each}
      </tr>
    {/each}
  </tbody>
</table>
