<!--
  One series over the route's range, a band per hour, day or month: a power series as its energy,
  any other as its mean. Today, a series with a forecast draws it as a dashed curve over the hours,
  as the prototype's day chart does. A new range tweens the bars from the figures they showed (ADR 21).
-->
<script lang="ts">
  import type { Core } from "../api/core.ts";
  import { planned, plannedEnergy, type Planned } from "../forecast/forecast.ts";
  import { m } from "../paraglide/messages.js";
  import BandChart from "../range/BandChart.svelte";
  import { isSigned, keyOf, sidesOf } from "../roles.ts";
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
    onread,
  }: {
    core: Readonly<Pick<Core, "statistics" | "forecasts">>;
    device: number;
    series: string;
    route: RangeRoute;
    /** The devices whose `series` forecasts add up to what this series expects. */
    forecast?: readonly number[];
    /** Told the band being read, for a chart that reads along. */
    onread?: (index: number | null) => void;
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
    up: null,
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
      bands: bandsOf(got.list, (_, i) => {
        const f = figures[i]!;

        return { ...f, ...split(f.value), line: plans ? f.planned : null };
      }),
      expected: plans && figures.reduce((a, f) => a + f.planned, 0),
      // A signed role's sides are named for its sign, as charged and discharged, even on a day
      // that ran one way only.
      up: signed || isSigned(s) ? [sidesOf(s)[0]] : null,
      down: signed ? [sidesOf(s)[1]] : [],
      sum: isPower(s)
        ? { up: [total(figures, 1)], down: signed ? [total(figures, -1)] : [] }
        : split(bandFigure(s, points, ...whole(got.spans)).value),
    };
  });

  /** What the devices' forecasts expect in [a, b), in kWh. */
  function expected(plans: readonly (readonly Planned[])[], a: number, b: number): number {
    return plans.reduce((sum, p) => sum + plannedEnergy(p, a, b), 0);
  }

  const meta = $derived([keyOf(series)]);

  // A power reads as energy; anything else as its mean, in its own unit.
  const reads = $derived(
    isPower(series) ? { fmt: kwh, unit: "kWh" } : { fmt: (v: number) => num(v, 1), unit: "" },
  );
</script>

<BandChart
  bands={view.bands}
  up={view.up ?? meta}
  down={view.down}
  via={view.via}
  lineLabel={view.expected === null ? "" : m.range_forecast()}
  summary={{ title: data.title, ...view.sum, line: view.expected }}
  fmt={reads.fmt}
  unit={reads.unit}
  loading={view.loading}
  label={m.history_chart({ series: meta[0]!.label })}
  ondrill={data.drill}
  onbrush={data.brush}
  {onread}
/>
