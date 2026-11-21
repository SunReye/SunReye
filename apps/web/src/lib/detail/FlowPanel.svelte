<!--
  A flow sheet's range below its tabs (ADR 21 "Sheet content"): the purchase's price by band while
  a tariff is in force, then one row of facts, the peak with its time and, for the house the share
  PV covered, for feed-in and purchase their euros.
-->
<script lang="ts">
  import { TARIFF } from "../api/computed-devices.ts";
  import HistoryChart from "../history/HistoryChart.svelte";
  import type { AnalyticsInput } from "./Analytics.svelte";
  import StatStrip from "../components/stat-strip.svelte";
  import type { SheetFlow } from "./flow.ts";
  import { FLOW_RANGE } from "./flow-range.ts";
  import RangeState from "./RangeState.svelte";
  import { SheetRange } from "./sheet-range.svelte.ts";

  let {
    input,
    flow,
    priced,
  }: {
    input: AnalyticsInput;
    flow: SheetFlow;
    /** A tariff is in force (ADR 12). */
    priced: boolean;
  } = $props();

  const range = new SheetRange(
    () => ({ core: input.core, route: input.route, key: flow.series, flow, priced }),
    FLOW_RANGE,
  );
</script>

<RangeState failed={range.failed} refused={range.refused} onretry={range.retry}>
  {#if flow.price && priced}
    <HistoryChart core={input.core} device={TARIFF} series="price.import" route={input.route} />
  {/if}
  <StatStrip closes="panel" stats={range.view} />
</RangeState>
