<!--
  The battery's overview tab (ADR 21 "Sheet content"): its power over the range, charged above
  and discharged below, and its state of charge as a line under it, both read at one band.
-->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import HistoryChart from "../history/HistoryChart.svelte";
  import { m } from "../paraglide/messages.js";
  import type { AnalyticsInput } from "./Analytics.svelte";
  import type { Band } from "../range/bands.ts";
  import type { Analytics } from "./sheets.ts";
  import SocLine from "./SocLine.svelte";

  let {
    range,
    analytics,
    input,
  }: {
    /** The battery's range: its state of charge by band, null unread. */
    range: Readonly<{
      failed: boolean;
      view: Readonly<{ bands: readonly Band[]; mean: number | null }> | null;
    }>;
    analytics: Analytics;
    input: AnalyticsInput;
  } = $props();

  /** The band read on either chart; null with none. */
  let read = $state<number | null>(null);
</script>

<div class="flex flex-col gap-3">
  <HistoryChart
    core={input.core}
    device={analytics.device}
    series={analytics.series}
    route={input.route}
    onread={(i) => (read = i)}
  />
  <!-- A failed read says so once, in place of the facts: nothing of the last range stands. -->
  {#if !range.failed}
    {#if range.view}
      <SocLine
        bands={range.view.bands}
        mean={range.view.mean}
        label={input.route.label}
        bind:read
      />
    {:else}
      <Skeleton class="h-20" role="status" aria-label={m.loading()} />
    {/if}
  {/if}
</div>
