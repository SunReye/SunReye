<!-- One group of readings under its quiet title: its note, its rows, its table. -->
<script lang="ts">
  import ReadingRow from "./ReadingRow.svelte";
  import ReadingTable from "./ReadingTable.svelte";
  import type { Group } from "./rows.ts";

  let {
    group,
    loading,
    silent,
    onopen,
  }: { group: Group; loading: boolean; silent: boolean; onopen: (id: string) => void } = $props();
</script>

<div class="flex flex-col">
  <h4 class="pb-1 text-xs font-medium text-muted-foreground">{group.title}</h4>
  {#if group.note}
    <p class="pb-1.5 text-xs leading-snug text-muted-foreground">{group.note}</p>
  {/if}
  {#if group.rows.length > 0}
    <dl class="flex flex-col divide-y divide-border/50 border-t border-border/50 text-sm">
      {#each group.rows as row (row.key)}
        <ReadingRow {row} {loading} {silent} {onopen} />
      {/each}
    </dl>
  {/if}
  {#if group.table}
    <ReadingTable table={group.table} {loading} {silent} />
  {/if}
</div>
