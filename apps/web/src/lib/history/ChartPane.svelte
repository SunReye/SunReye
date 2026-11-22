<!-- The tabs that chart the range: over time, by year, by hour of day, against the forecast. -->
<script lang="ts">
  import PatternPanel from "../analytics/PatternPanel.svelte";
  import { begunOf } from "./facts.ts";
  import ForecastPanel from "./ForecastPanel.svelte";
  import { heatOf, type PaneProps } from "./pane.ts";
  import TimePanel from "./TimePanel.svelte";
  import YearsPanel from "./YearsPanel.svelte";

  let { core, got, view, route, facts, fresh, loading, height, onview }: PaneProps = $props();

  const heat = $derived(heatOf(view.metric));
  const inverters = $derived([...new Set((facts?.strings ?? []).map((s) => s.device))]);
</script>

{#if view.tab === "time"}
  <TimePanel {got} metric={view.metric} {route} begun={begunOf(facts)} {loading} {height} />
{:else if view.tab === "years"}
  <YearsPanel {core} {route} metric={view.metric} {fresh} height={height - 40} />
{:else if view.tab === "pattern"}
  <PatternPanel {core} {route} source={heat} name={heat.name} colour={heat.colour} />
{:else}
  <ForecastPanel
    {core}
    {got}
    {route}
    {inverters}
    {loading}
    height={height - 40}
    onstrings={() => {
      onview({ metric: "plant", tab: null });
    }}
  />
{/if}
