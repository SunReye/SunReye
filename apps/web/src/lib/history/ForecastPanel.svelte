<!-- How well the solar forecast held: measured production against what was forecast, and what is still expected. -->
<script lang="ts">
  import type { Core } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import BandChart from "../range/BandChart.svelte";
  import { kwh } from "../range/format.ts";
  import { rangeLabel } from "../range/range.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import { drillLabel } from "./drill.ts";
  import ForecastAccuracy from "./ForecastAccuracy.svelte";
  import { accuracyText, forecastView, measuredSeries, readForecast } from "./forecast.ts";
  import type { Loaded } from "./stats.svelte.ts";

  let {
    core,
    got,
    route,
    inverters,
    loading,
    height,
    onstrings,
  }: {
    core: Readonly<Pick<Core, "forecasts">>;
    got: Loaded;
    route: RangeRoute;
    inverters: readonly number[];
    loading: boolean;
    height: number;
    onstrings: () => void;
  } = $props();

  let targets = $state.raw<Awaited<ReturnType<typeof readForecast>>>([]);

  $effect(() => {
    const [from, to] = [got.spans[0]?.[0] ?? 0, got.spans.at(-1)?.[1] ?? 0];
    let live = true;

    void readForecast(core, inverters, from, to).then((next) => {
      if (live) targets = next;

      return next;
    });

    return () => {
      live = false;
    };
  });

  const view = $derived(forecastView(got, targets));
  const acc = $derived(accuracyText(view.accuracy, loading));
</script>

<div class="flex flex-col gap-4">
  <BandChart
    bands={view.bands}
    up={measuredSeries()}
    markLabel={m.range_forecast()}
    ghostLabel={m.range_forecast()}
    via={got.via}
    summary={{
      title: m.range_sum({ range: rangeLabel(got.cal, got.range) }),
      up: [view.measured],
      down: [],
      mark: view.forecast,
    }}
    fmt={kwh}
    unit="kWh"
    {height}
    {loading}
    drillLabel={drillLabel(got.range)}
    label={m.stats_forecast_chart()}
    ondrill={(i) => {
      const drill = got.list[i]?.drill;

      if (drill) route.open(drill);
    }}
  />
  <ForecastAccuracy {acc} {onstrings} />
</div>
