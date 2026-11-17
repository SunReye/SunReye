<!--
  A flow sheet's range below its tabs (ADR 21 "Sheet content"): the purchase's price by band while
  a tariff is in force, then one row of facts, the peak with its time and, for the house the share
  PV covered, for feed-in and purchase their euros.
-->
<script lang="ts">
  import { TARIFF } from "../api/computed-devices.ts";
  import HistoryChart from "../history/HistoryChart.svelte";
  import type { AnalyticsInput } from "./Analytics.svelte";
  import DetailStats from "./DetailStats.svelte";
  import type { Flow } from "./flow.ts";
  import { FlowRange } from "./flow-range.svelte.ts";
  import { FAILED } from "./head.svelte.ts";
  import RangeState from "./RangeState.svelte";

  let {
    input,
    flow,
    priced,
  }: {
    input: AnalyticsInput;
    flow: Flow;
    /** A tariff is in force (ADR 12). */
    priced: boolean;
  } = $props();

  const range = new FlowRange(() => ({ core: input.core, route: input.route, flow, priced }));
</script>

{#if flow.price && priced}
  <HistoryChart core={input.core} device={TARIFF} series="price.import" route={input.route} />
{/if}
<RangeState head={range.failed ? FAILED : null} onretry={range.retry}>
  <!-- The facts row spans the sheet, as every sheet's does. -->
  <div class="-mx-5 -mb-4 pt-2 sm:-mx-6">
    <DetailStats stats={range.facts} />
  </div>
</RangeState>
