<!--
  The battery sheet's range (ADR 21 "Sheet content"): its tabs, the overview drawing the state of
  charge as a line under the power, then one row of facts, the round-trip efficiency and the
  range's full cycles, whichever tab is open; a failed read says so in their place, and the line
  goes with them. All from the plant's battery (ADR 14).
-->
<script lang="ts">
  import type { AnalyticsInput } from "./Analytics.svelte";
  import AnalyticsTabs from "./AnalyticsTabs.svelte";
  import { batteryFacts } from "./battery.ts";
  import { BATTERY_RANGE } from "./battery-range.ts";
  import BatteryOverview from "./BatteryOverview.svelte";
  import StatStrip from "../components/stat-strip.svelte";
  import RangeState from "./RangeState.svelte";
  import { SheetRange } from "./sheet-range.svelte.ts";
  import type { Analytics } from "./sheets.ts";

  let {
    title,
    colour,
    analytics,
    input,
  }: {
    title: string;
    colour: string;
    analytics: Analytics;
    input: AnalyticsInput;
  } = $props();

  const range = new SheetRange(
    () => ({ core: input.core, route: input.route, key: "plant" }),
    BATTERY_RANGE,
  );
</script>

<AnalyticsTabs {title} {colour} {analytics} {input}>
  {#snippet overview()}
    <BatteryOverview {range} {analytics} {input} />
  {/snippet}
</AnalyticsTabs>
<RangeState failed={range.failed} refused={range.refused} onretry={range.retry}>
  <StatStrip closes="panel" stats={batteryFacts(range.view?.efficiency ?? null, range.view?.cycles ?? null)} />
</RangeState>
