<!--
  The battery sheet's range (ADR 21 "Sheet content"): its tabs, the overview drawing the state of
  charge as a line under the power, then one row of facts, the round-trip efficiency and the
  range's full cycles, whichever tab is open. All from the plant's battery (ADR 14).
-->
<script lang="ts">
  import type { Analytics } from "../analytics/sources.ts";
  import type { AnalyticsInput } from "./Analytics.svelte";
  import AnalyticsTabs from "./AnalyticsTabs.svelte";
  import { factsOf } from "./battery.ts";
  import { BatteryRange } from "./battery-range.svelte.ts";
  import BatteryOverview from "./BatteryOverview.svelte";
  import DetailStats from "./DetailStats.svelte";

  let {
    id,
    title,
    colour,
    analytics,
    input,
  }: {
    id: string;
    title: string;
    colour: string;
    analytics: Analytics;
    input: AnalyticsInput;
  } = $props();

  const range = new BatteryRange(() => input);
</script>

<AnalyticsTabs {id} {title} {colour} {analytics} {input}>
  {#snippet overview()}
    <BatteryOverview {range} {analytics} {input} />
  {/snippet}
</AnalyticsTabs>
<!-- The facts row spans the sheet, as every sheet's does. -->
<div class="-mx-5 -mb-4 pt-2 sm:-mx-6">
  <DetailStats stats={factsOf(range.view?.efficiency ?? null, range.view?.cycles ?? null)} />
</div>
