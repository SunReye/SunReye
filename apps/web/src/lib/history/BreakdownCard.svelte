<!-- What the range's flows were, for the chosen question. -->
<script lang="ts">
  import * as Card from "#lib/components/ui/card/index.js";
  import LoadingRows from "../components/loading-rows.svelte";
  import { m } from "../paraglide/messages.js";
  import type { Row } from "./breakdown.ts";
  import BreakdownRow from "./BreakdownRow.svelte";

  let {
    label,
    rows,
    against,
    loading,
  }: {
    /** The range's label. */
    label: string;
    rows: readonly Row[];
    /** What the rows' changes are against: "zum Vormonat". */
    against: string;
    loading: boolean;
  } = $props();
</script>

<Card.Root element="section" aria-label={m.stats_breakdown()} class="glass-ambient gap-0 py-0">
  <h2 class="px-4 pt-3 pb-2 text-sm font-semibold">
    {m.stats_breakdown()} <span class="font-normal text-muted-foreground">· {label}</span>
  </h2>
  {#if rows.length === 0 && loading}
    <div class="border-t border-border/60"><LoadingRows rows={4} /></div>
  {:else}
    <dl class="divide-y divide-border/60 border-t border-border/60">
      {#each rows as r (r.label)}
        <BreakdownRow {r} {loading} />
      {/each}
    </dl>
    {#if against && !loading && rows.some((r) => r.change)}
      <p class="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
        {m.stats_change_against({ against })}
      </p>
    {/if}
  {/if}
</Card.Root>
