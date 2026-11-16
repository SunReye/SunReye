<!-- The range over time, for the chosen question: energy flows, money, or where the house load came from. -->
<script lang="ts">
  import BandChart from "../range/BandChart.svelte";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import { brushRange } from "../range/edges.ts";
  import { m } from "../paraglide/messages.js";
  import { rangeLabel } from "../range/range.ts";
  import { chartOf } from "./chart.ts";
  import type { Loaded } from "./stats.svelte.ts";
  import type { Metric } from "./view.ts";
  import { drillLabel } from "./drill.ts";
  import { baselineLabel } from "./words.ts";

  let {
    got,
    metric,
    route,
    begun,
    loading,
    height,
  }: {
    got: Loaded;
    metric: Metric;
    route: RangeRoute;
    /** When the record began, in ms since the epoch. */
    begun: number;
    loading: boolean;
    height: number;
  } = $props();

  const chart = $derived(chartOf(metric, got, begun));
</script>

<BandChart
  bands={chart.bands}
  up={chart.up}
  down={chart.down}
  groups={chart.groups}
  markLabel={chart.bands.some((b) => b.mark != null) ? baselineLabel(got.range, got.cmp) : ""}
  via={got.via}
  summary={{ title: m.range_sum({ range: rangeLabel(got.cal, got.range) }), ...chart.summary }}
  fmt={chart.fmt}
  unit={chart.unit}
  max={chart.max}
  {height}
  {loading}
  drillLabel={drillLabel(got.range)}
  label={chart.label}
  ondrill={(i) => {
    const drill = chart.drills[i]?.drill;

    if (drill) route.open(drill);
  }}
  onbrush={(a, b) => {
    route.open(brushRange(got.cal, got.range, chart.drills, a, b));
  }}
/>
