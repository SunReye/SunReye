<!--
  How well one inverter's forecast held over the route's range: measured production as bars, the
  forecast as a mark on each, and what is still expected as faint bars. One line at a time: the
  total, an MPPT input or a string (ADR 17).
-->
<script lang="ts">
  import type { Core } from "../api/core.ts";
  import { bandFigure, means } from "../history/history.ts";
  import { m } from "../paraglide/messages.js";
  import BandChart from "../range/BandChart.svelte";
  import { bandsOf } from "../range/fill.ts";
  import { kwh } from "../range/format.ts";
  import { RangeData } from "../range/range-data.svelte.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import { planned, plannedEnergy, type Line } from "./forecast.ts";
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

  let chosen = $state<string | undefined>();
  const line = $derived(lines.find((l) => l.series === chosen) ?? lines[0]!);

  const data = new RangeData(
    () => route,
    async (from, to, now) => {
      const series = line.series;
      const until = Math.min(to.getTime(), now);

      const [measured, forecast] = await Promise.all([
        from.getTime() < until ? means(core, device, series, from, new Date(until)) : [],
        planned(core, device, series, from, to),
      ]);

      return { series, measured, forecast };
    },
  );

  const view = $derived.by(() => {
    const got = data.current;

    if (!got) return null;

    const { series, measured, forecast } = got.data;

    const figures = got.spans.map(([a, b]) => ({
      ...bandFigure(series, measured, a, b),
      planned: plannedEnergy(forecast, a, b),
      elapsed: Math.max(0, Math.min(b, got.now) - a),
    }));

    const bands = bandsOf(got.list, (edge, i) => {
      const f = figures[i]!;
      const past = edge.state === "past";

      return {
        up: [Math.max(0, f.value)],
        down: [],
        // The forecast against what happened; what is still to come shows as a faint bar.
        mark: past && f.planned > 0 ? f.planned : null,
        ghost: !past && f.planned > 0 ? f.planned : null,
        covered: f.covered,
        elapsed: f.elapsed,
      };
    });

    const sum = (key: "value" | "planned") => figures.reduce((a, f) => a + Math.max(0, f[key]), 0);

    return { bands, made: sum("value"), expected: sum("planned") };
  });
</script>

<div class="flex flex-col gap-3">
  {#if lines.length > 1}
    <LinePicker {lines} value={line.series} onpick={(series) => (chosen = series)} />
  {/if}
  <BandChart
    bands={view?.bands ?? []}
    up={[{ label: m.forecast_measured(), colour: "var(--e-solar)" }]}
    markLabel={m.range_forecast()}
    ghostLabel={m.range_forecast()}
    via={data.current?.via}
    summary={{ title: data.title, up: [view?.made ?? 0], down: [], mark: view?.expected ?? null }}
    fmt={kwh}
    unit="kWh"
    loading={!view}
    label={m.forecast_chart()}
    ondrill={data.drill}
    onbrush={data.brush}
  />
</div>
