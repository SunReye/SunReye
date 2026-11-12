<!-- What the range's flows were, for the chosen question. -->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import type { Row } from "./breakdown.ts";
  import BreakdownRow from "./BreakdownRow.svelte";

  let {
    label,
    rows,
    loading,
  }: {
    /** The range's label. */
    label: string;
    rows: readonly Row[];
    loading: boolean;
  } = $props();
</script>

<section
  class="glass-ambient overflow-hidden rounded-lg ring-1 ring-foreground/10"
  aria-label={m.stats_breakdown()}
>
  <h2 class="px-4 pt-3 pb-2 text-sm font-semibold">
    {m.stats_breakdown()} <span class="font-normal text-muted-foreground">· {label}</span>
  </h2>
  <dl class="divide-y divide-border/60 border-t border-border/60">
    {#each rows as r (r.label)}
      <BreakdownRow {r} {loading} />
    {/each}
  </dl>
</section>
