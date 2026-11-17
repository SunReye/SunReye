<!--
  A flow sheet's range below its tabs (ADR 21 "Sheet content"): one row of facts, the peak with
  its time and, for feed-in and purchase, their euros.
-->
<script lang="ts">
  import type { AnalyticsInput } from "./Analytics.svelte";
  import DetailStats from "./DetailStats.svelte";
  import type { Flow } from "./flow.ts";
  import { FlowRange } from "./flow-range.svelte.ts";
  import type { HeadView } from "./head.svelte.ts";
  import RangeState from "./RangeState.svelte";

  let { input, flow }: { input: AnalyticsInput; flow: Flow } = $props();

  const range = new FlowRange(() => ({ core: input.core, route: input.route, flow }));

  /** The range's own read failed, though the head's did not. */
  const FAILED: HeadView = {
    state: "error",
    label: "",
    value: null,
    unit: "",
    digits: 0,
    versus: "",
    notes: [],
  };
</script>

<RangeState head={range.failed ? FAILED : null} onretry={range.retry}>
  <!-- The facts row spans the sheet, as every sheet's does. -->
  <div class="-mx-5 -mb-4 pt-2 sm:-mx-6">
    <DetailStats stats={range.facts} />
  </div>
</RangeState>
