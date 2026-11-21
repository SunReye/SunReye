<!--
  One series over the route's range, a band per hour, day or month: a power series as its energy,
  any other as its mean. Today, a series with a forecast draws it as History's forecast chart does:
  a tick at each hour's forecast so far, and a faint bar of the whole forecast of each hour not yet
  over. A new range tweens the bars from the figures they showed (ADR 21); a failed read stands in
  their place with its retry.
-->
<script lang="ts">
  import type { Core } from "../api/core.ts";
  import LoadFailed from "../components/load-failed.svelte";
  import { forecastIn, planned } from "../forecast/forecast.ts";
  import { m } from "../paraglide/messages.js";
  import BandChart from "../range/BandChart.svelte";
  import { describe, isSignedFlow, keyOf, sidesOf } from "../roles.ts";
  import { bandsOf } from "../range/fill.ts";
  import { RangeData } from "../range/range-data.svelte.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import { bandFigure, isPower, periodOf, readsOf, rollups } from "./history.ts";

  let {
    core,
    device,
    series,
    route,
    forecast = [],
    estimated = false,
    onread,
  }: {
    core: Readonly<Pick<Core, "statistics" | "forecasts">>;
    device: number;
    series: string;
    route: RangeRoute;
    /** The devices whose `series` forecasts add up to what this series expects. */
    forecast?: readonly number[];
    /** The series is computed, not measured, so its values carry ≈ (ADR 17). */
    estimated?: boolean;
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

      return { series: s, points, plans: plans.length > 0 ? plans.flat() : null };
    },
  );

  const LOADING = {
    loading: true,
    via: undefined,
    bands: [],
    up: null,
    down: [],
    sum: { up: [0], down: [], bare: false },
    forecast: null,
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

  type Weighed = ReturnType<typeof forecastIn> | null;

  /** A band's forecast as History's forecast chart draws it: a tick at what it expected so far, and
   * a faint bar of all it expects while it is not over. */
  const drawn = (p: Weighed, past: boolean) => ({
    mark: p && p.sofar > 0 ? p.sofar : null,
    ghost: p && !past && p.whole > 0 ? p.whole : null,
  });

  /** The range's forecast as History's forecast chart sums it: so far, and still expected. */
  function summed(ps: readonly Weighed[]) {
    const [sofar, rest] = ps.reduce(([a, b], p) => [a + (p?.sofar ?? 0), b + (p?.rest ?? 0)], [0, 0]);

    return { mark: sofar > 0 ? sofar : null, ghost: rest > 0 ? rest : null };
  }

  const view = $derived.by(() => {
    const got = data.current;

    if (!got) return LOADING;

    const { series: s, points, plans } = got.data;
    const { per } = readsOf(s);

    /** The band's figure in the unit it is written in. */
    const figure = (a: number, b: number) => {
      const f = bandFigure(s, points, a, b);

      return { ...f, value: f.value * per };
    };

    const figures = got.spans.map(([a, b]) => ({
      ...figure(a, b),
      planned: plans && forecastIn(plans, a, b, got.now),
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

        return { ...f, ...split(f.value), ...drawn(f.planned, edge.state === "past") };
      }),
      forecast: plans && summed(figures.map((f) => f.planned)),
      // A signed flow's sides are named for its sign, as charged and discharged, even on a day
      // that ran one way only.
      up: signed || isSignedFlow(s) ? [sidesOf(s)[0]] : null,
      down: signed ? [sidesOf(s)[1]] : [],
      sum: isPower(s)
        ? {
            up: [total(figures, 1)],
            down: signed ? [total(figures, -1)] : [],
            // One series' sum is the sheet's head; several split it.
            bare: !signed && !isSignedFlow(s),
          }
        : { ...split(figure(...whole(got.spans)).value), bare: false },
    };
  });

  const meta = $derived([keyOf(series)]);

  // A sum the head states stands under no title of its own: the range's name alone.
  const sumTitle = $derived(view.sum.bare ? route.label : data.title);

  // A power's bands sum to the range's; any other series' bands to its mean, which names it.
  const title = $derived(
    isPower(series)
      ? sumTitle
      : m.range_mean({ series: describe(series).label, range: route.label }),
  );

  const reads = $derived(readsOf(series));
</script>

{#if data.failed}
  <LoadFailed text={m.detail_error()} refused={data.refused} onretry={data.retry} />
{:else}
<BandChart
  bands={view.bands}
  up={view.up ?? meta}
  down={view.down}
  via={view.via}
  markLabel={view.forecast ? m.range_forecast() : ""}
  ghostLabel={view.forecast ? m.forecast_expected() : ""}
  summary={{
    title,
    ...view.sum,
    mark: view.forecast?.mark ?? null,
    ghost: view.forecast?.ghost ?? null,
  }}
  fmt={reads.fmt}
  unit={reads.unit}
  loading={view.loading}
  {estimated}
  label={m.history_chart({ series: meta[0]!.label })}
  ondrill={data.drill}
  onbrush={data.brush}
  {onread}
/>
{/if}
