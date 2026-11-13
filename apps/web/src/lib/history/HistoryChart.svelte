<!--
  One series over the route's range, a band per hour, day or month: a power series as its energy,
  any other as its mean. Today, a series with a forecast marks it on each hour and shows the hours
  still to come faintly. A new range tweens the bars from the figures they showed (ADR 21).
-->
<script lang="ts">
  import type { Core } from "../api/core.ts";
  import { flowColour, roleFlow } from "../energy-colours.ts";
  import { planned, plannedEnergy, type Planned } from "../forecast/forecast.ts";
  import { m } from "../paraglide/messages.js";
  import BandChart from "../range/BandChart.svelte";
  import { bandsOf } from "../range/fill.ts";
  import { kwh, num } from "../range/format.ts";
  import { RangeData } from "../range/range-data.svelte.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import { bandFigure, isPower, periodOf, rollups } from "./history.ts";

  let {
    core,
    device,
    series,
    route,
    forecast = [],
  }: {
    core: Readonly<Pick<Core, "statistics" | "forecasts">>;
    device: number;
    series: string;
    route: RangeRoute;
    /** The devices whose `series` forecasts add up to what this series expects. */
    forecast?: readonly number[];
  } = $props();

  const data = new RangeData(
    () => route,
    async (from, to, now) => {
      const s = series;
      const period = periodOf(route.range);
      const until = Math.min(to.getTime(), now);
      const today = route.range.kind === "day" && from.getTime() <= now && now < to.getTime();
      const expects = today ? forecast : [];

      const [points, plans] = await Promise.all([
        from.getTime() < until ? rollups(core, device, s, period, from, new Date(until)) : [],
        Promise.all(expects.map((d) => planned(core, d, s, from, to))),
      ]);

      return { series: s, points, plans: plans.length > 0 ? plans : null };
    },
  );

  const LOADING = {
    loading: true,
    via: undefined,
    bands: [],
    down: [],
    sum: { up: [0], down: [] },
    expected: null,
  };

  /** A figure as the upper side, and the lower side when the series runs both ways. */
  const splitter = (signed: boolean) => (v: number) => ({
    up: [Math.max(0, v)],
    down: signed ? [Math.max(0, -v)] : [],
  });

  /** From the first band's start to the last one's end. */
  const whole = (spans: readonly (readonly [number, number])[]) =>
    [spans[0]?.[0] ?? 0, spans.at(-1)?.[1] ?? 0] as const;

  /** What flowed one way over all bands. */
  const total = (figures: readonly { value: number }[], sign: 1 | -1) =>
    figures.reduce((a, f) => a + Math.max(0, sign * f.value), 0);

  /** A past hour marks its forecast against what happened; one still to come shows it faintly. */
  function forecastOf(past: boolean, energy: number) {
    const p = energy > 0 ? energy : null;

    return { mark: past ? p : null, ghost: past ? null : p };
  }

  const view = $derived.by(() => {
    const got = data.current;

    if (!got) return LOADING;

    const { series: s, points, plans } = got.data;

    const figures = got.spans.map(([a, b]) => ({
      ...bandFigure(s, points, a, b),
      planned: expected(plans ?? [], a, b),
      elapsed: Math.max(0, Math.min(b, got.now) - a),
    }));

    // The lower side carries what flows the other way, such as export on `grid.power`.
    const signed = figures.some((f) => f.value < 0);
    const split = splitter(signed);

    return {
      loading: false,
      via: got.via,
      bands: bandsOf(got.list, (edge, i) => {
        const f = figures[i]!;

        return { ...f, ...split(f.value), ...forecastOf(edge.state === "past", f.planned) };
      }),
      expected: plans && figures.reduce((a, f) => a + f.planned, 0),
      down: signed ? meta : [],
      sum: isPower(s)
        ? { up: [total(figures, 1)], down: signed ? [total(figures, -1)] : [] }
        : split(bandFigure(s, points, ...whole(got.spans)).value),
    };
  });

  /** What the devices' forecasts expect in [a, b), in kWh. */
  function expected(plans: readonly (readonly Planned[])[], a: number, b: number): number {
    return plans.reduce((sum, p) => sum + plannedEnergy(p, a, b), 0);
  }

  const meta = $derived([{ label: series, colour: flowColour(roleFlow(series)) }]);

  // A power reads as energy; anything else as its mean, in its own unit.
  const reads = $derived(
    isPower(series) ? { fmt: kwh, unit: "kWh" } : { fmt: (v: number) => num(v, 1), unit: "" },
  );
</script>

<BandChart
  bands={view.bands}
  up={meta}
  down={view.down}
  via={view.via}
  markLabel={view.expected === null ? "" : m.range_forecast()}
  ghostLabel={view.expected === null ? "" : m.range_forecast()}
  summary={{ title: data.title, ...view.sum, mark: view.expected }}
  fmt={reads.fmt}
  unit={reads.unit}
  loading={view.loading}
  label={m.history_chart({ series })}
  ondrill={data.drill}
  onbrush={data.brush}
/>
