<!--
  One pane of an inverter's card (ADR 17, 21): the headline, the chart and how close the forecast
  came, judged from one load; with none, it draws loading.
-->
<script lang="ts">
  import Verdict from "../history/Verdict.svelte";
  import { m } from "../paraglide/messages.js";
  import BandChart from "../range/BandChart.svelte";
  import { kwh } from "../range/format.ts";
  import type { stackOf } from "./forecast.ts";
  import { forecastPane, type ForecastRead } from "./forecast-data.svelte.ts";
  import ForecastFigures from "./ForecastFigures.svelte";

  let {
    got,
    up,
    ondrill,
    onbrush,
  }: {
    got: ForecastRead | null;
    /** What the bars stack. */
    up: ReturnType<typeof stackOf>["up"];
    ondrill: (i: number) => void;
    onbrush: (a: number, b: number) => void;
  } = $props();

  const view = $derived(forecastPane(got));

  // An optional part shows only while it holds energy.
  const shown = $derived(
    up.filter((part, i) => (view.kept ? view.kept.includes(i) : !part.optional)),
  );
</script>

<div class="flex flex-col gap-3">
  <Verdict id={view.key} sentence={view.said} gapHours={0} />

  <BandChart
    bands={view.bands}
    up={shown}
    markLabel={m.range_forecast()}
    ghostLabel={m.forecast_expected()}
    via={view.via}
    summary={view.summary}
    fmt={kwh}
    unit="kWh"
    loading={view.loading}
    label={m.forecast_chart()}
    {ondrill}
    {onbrush}
  />

  <ForecastFigures accuracy={view.accuracy} />
</div>
