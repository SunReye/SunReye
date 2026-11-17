<!-- One analytics tab's content; each reads the sheet's range. -->
<script lang="ts">
  import type { Analytics } from "../analytics/sources.ts";
  import PatternPanel from "../analytics/PatternPanel.svelte";
  import StringsPanel from "../analytics/StringsPanel.svelte";
  import HistoryChart from "../history/HistoryChart.svelte";
  import type { AnalyticsInput } from "./Analytics.svelte";
  import { parseFigure } from "./figures.ts";

  let {
    tab,
    id,
    title,
    colour,
    analytics,
    input,
  }: {
    tab: "overview" | "heat" | "compare";
    id: string;
    title: string;
    colour: string;
    analytics: Analytics;
    input: AnalyticsInput;
  } = $props();

  const sid = $derived.by(() => {
    const ref = parseFigure(id);

    return ref?.kind === "string" ? ref.id : null;
  });
</script>

{#if tab === "overview"}
  <HistoryChart
    core={input.core}
    device={analytics.device}
    series={analytics.series}
    route={input.route}
    forecast={analytics.forecast}
  />
{:else if tab === "heat" && analytics.heat}
  <PatternPanel
    core={input.core}
    route={input.route}
    source={{ device: analytics.device, series: analytics.heat }}
    name={analytics.way ?? title}
    {colour}
  />
{:else if tab === "compare"}
  <StringsPanel
    core={input.core}
    route={input.route}
    strings={input.strings}
    {sid}
  />
{/if}
