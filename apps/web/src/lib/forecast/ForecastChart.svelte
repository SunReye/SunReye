<!--
  How well one inverter's forecast held over the route's range (ADR 17, 21): a headline answer
  first, then measured production as bars with the forecast as a mark on each, what is still
  expected as faint bars, and how close the forecast came. One line at a time: the total, an MPPT
  input or a string.
-->
<script lang="ts">
  import type { Core } from "../api/core.ts";
  import Verdict from "../history/Verdict.svelte";
  import { m } from "../paraglide/messages.js";
  import BandChart from "../range/BandChart.svelte";
  import { kwh } from "../range/format.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import { measuredBar, type Line } from "./forecast.ts";
  import { ForecastData } from "./forecast-data.svelte.ts";
  import ForecastFigures from "./ForecastFigures.svelte";
  import LinePicker from "./LinePicker.svelte";

  let {
    core,
    device,
    lines,
    route,
  }: {
    core: Core;
    device: number;
    lines: readonly Line[];
    route: RangeRoute;
  } = $props();

  const id = $props.id();

  let chosen = $state<string | undefined>();
  const line = $derived(lines.find((l) => l.series === chosen) ?? lines[0]!);

  const data = new ForecastData(() => ({ core, device, series: line.series, route }));
  const view = $derived(data.view);

  const note = $derived(
    [line.estimated && m.forecast_estimated_note(), m.forecast_horizon(), m.stats_forecast_note()]
      .filter(Boolean)
      .join(" "),
  );
</script>

<section aria-labelledby="{id}-title" class="flex flex-col gap-3">
  <header class="flex min-h-9 items-center justify-between gap-3">
    <h2 id="{id}-title" class="min-w-0 truncate text-base font-semibold">
      {m.forecast_inverter({ device })}
    </h2>
    {#if lines.length > 1}
      <LinePicker {lines} value={line.series} onpick={(series) => (chosen = series)} />
    {/if}
  </header>

  <Verdict id={view?.key ?? ""} sentence={view?.said ?? null} gapHours={0} />

  <BandChart
    bands={data.bands}
    up={[measuredBar()]}
    markLabel={m.range_forecast()}
    ghostLabel={m.forecast_expected()}
    via={data.via}
    summary={data.summary}
    fmt={kwh}
    unit="kWh"
    loading={!view}
    label={m.forecast_chart()}
    ondrill={data.drill}
    onbrush={data.brush}
  />

  <ForecastFigures accuracy={view?.accuracy ?? null} />

  <p class="max-w-[68ch] text-xs text-pretty text-muted-foreground">{note}</p>
</section>
