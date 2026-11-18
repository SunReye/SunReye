<!-- One analytics tab's content; each reads the sheet's range. -->
<script lang="ts">
  import PatternPanel from "../analytics/PatternPanel.svelte";
  import StringsPanel from "../analytics/StringsPanel.svelte";
  import HistoryChart from "../history/HistoryChart.svelte";
  import type { AnalyticsInput } from "./Analytics.svelte";
  import type { Analytics } from "./sheets.ts";

  let {
    tab,
    title,
    colour,
    analytics,
    input,
  }: {
    tab: "overview" | "heat" | "compare";
    title: string;
    colour: string;
    analytics: Analytics;
    input: AnalyticsInput;
  } = $props();

  const estimated = $derived(
    (input.estimated[String(analytics.device)] ?? []).includes(analytics.series),
  );
</script>

{#if tab === "overview"}
  <HistoryChart
    core={input.core}
    device={analytics.device}
    series={analytics.series}
    route={input.route}
    forecast={analytics.forecast}
    {estimated}
  />
{:else if tab === "heat" && analytics.heat}
  <PatternPanel
    core={input.core}
    route={input.route}
    source={{ device: analytics.device, series: analytics.heat }}
    name={analytics.way ?? title}
    {colour}
    {estimated}
  />
{:else if tab === "compare"}
  <StringsPanel
    core={input.core}
    route={input.route}
    strings={input.strings}
    sid={analytics.string}
  />
{/if}
