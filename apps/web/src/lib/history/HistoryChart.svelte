<!--
  One series over the route's range, a band per hour, day or month: a power series as its energy,
  any other as its mean. A new range tweens the bars from the figures they showed (ADR 21).
-->
<script lang="ts">
  import type { Core } from "../api/core.ts";
  import { flowColour, roleFlow } from "../energy-colours.ts";
  import { m } from "../paraglide/messages.js";
  import BandChart from "../range/BandChart.svelte";
  import { bandsOf } from "../range/fill.ts";
  import { kwh, num } from "../range/format.ts";
  import { RangeData } from "../range/range-data.svelte.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import { bandFigure, isPower, means } from "./history.ts";

  let {
    core,
    device,
    series,
    route,
  }: {
    core: Readonly<Pick<Core, "history">>;
    device: number;
    series: string;
    route: RangeRoute;
  } = $props();

  const data = new RangeData(
    () => route,
    async (from, to, now) => {
      const s = series;
      const until = Math.min(to.getTime(), now);

      const points =
        from.getTime() < until ? await means(core, device, s, from, new Date(until)) : [];

      return { series: s, points };
    },
  );

  const view = $derived.by(() => {
    const got = data.current;

    if (!got)
      return { loading: true, via: undefined, bands: [], down: [], sum: { up: [0], down: [] } };

    const { series: s, points } = got.data;

    const figures = got.spans.map(([a, b]) => ({
      ...bandFigure(s, points, a, b),
      elapsed: Math.max(0, Math.min(b, got.now) - a),
    }));

    // The lower side carries what flows the other way, such as export on `grid.power`.
    const signed = figures.some((f) => f.value < 0);
    const split = (v: number) => ({ up: [Math.max(0, v)], down: signed ? [Math.max(0, -v)] : [] });
    const total = (sign: 1 | -1) => figures.reduce((a, f) => a + Math.max(0, sign * f.value), 0);
    const [first, last] = [got.spans[0]?.[0] ?? 0, got.spans.at(-1)?.[1] ?? 0];

    return {
      loading: false,
      via: got.via,
      bands: bandsOf(got.list, (_, i) => ({ ...figures[i]!, ...split(figures[i]!.value) })),
      down: signed ? meta : [],
      sum: isPower(s)
        ? { up: [total(1)], down: signed ? [total(-1)] : [] }
        : split(bandFigure(s, points, first, last).value),
    };
  });

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
  summary={{ title: data.title, ...view.sum }}
  fmt={reads.fmt}
  unit={reads.unit}
  loading={view.loading}
  label={m.history_chart({ series })}
  ondrill={data.drill}
  onbrush={data.brush}
/>
