<script lang="ts">
  import { LineChart } from "layerchart/canvas";
  import type { Core } from "./api/core";
  import { m } from "./paraglide/messages.js";

  let { core, device, series }: { core: Core; device: number; series: readonly string[] } =
    $props();

  interface Row {
    readonly time: Date;
    readonly power: number;
    readonly series: string;
  }

  // A string, so a live update that names the same series does not reload the day.
  const names = $derived(series.join("\n"));

  let rows = $state.raw<readonly Row[]>([]);

  /** Tableau 10: a legend names a series only once it has a colour. */
  const COLOURS = [
    "#4e79a7",
    "#f28e2b",
    "#e15759",
    "#76b7b2",
    "#59a14f",
    "#edc948",
    "#b07aa1",
    "#ff9da7",
    "#9c755f",
    "#bab0ac",
  ];

  /** One line per series, so the legend names each. */
  const lines = $derived(
    [...new Set(rows.map((r) => r.series))].map((key, i) => ({
      key,
      color: COLOURS[i % COLOURS.length] ?? "currentColor",
      data: rows.filter((r) => r.series === key),
    })),
  );

  /** Today so far of each named series. */
  async function measured(from: Core, id: number, wanted: string, start: Date): Promise<Row[]> {
    const loaded = await Promise.all(
      wanted.split("\n").map(async (name) => {
        const history = await from.history(id, name, start, new Date());

        return "points" in history
          ? history.points.map((p) => ({ time: new Date(p.start), power: p.mean, series: name }))
          : [];
      }),
    );

    return loaded.flat();
  }

  /** The whole day's forecast of each string wired to this inverter (ADR 17). */
  async function forecast(from: Core, id: number, start: Date): Promise<Row[]> {
    const layout = await from.layout();

    if (!("strings" in layout)) return [];

    const end = new Date(start);

    end.setDate(end.getDate() + 1);

    const loaded = await Promise.all(
      layout.strings
        .filter((s) => s.device === id)
        .map(async (s) => {
          const forecasts = await from.forecasts(id, `pv.string.power[${s.id}]`, start, end);
          const label = m.chart_forecast({ name: s.name });

          return "points" in forecasts
            ? forecasts.points.map((p) => ({
                time: new Date(p.target),
                power: p.value,
                series: label,
              }))
            : [];
        }),
    );

    return loaded.flat();
  }

  async function load(from: Core, id: number, wanted: string, signal: AbortSignal): Promise<void> {
    const start = new Date();

    start.setHours(0, 0, 0, 0);

    const loaded = await Promise.all([
      measured(from, id, wanted, start),
      forecast(from, id, start),
    ]);

    if (!signal.aborted) rows = loaded.flat();
  }

  $effect(() => {
    const abort = new AbortController();

    void load(core, device, names, abort.signal);

    return () => {
      abort.abort();
    };
  });
</script>

<!--
  The canvas build ships no `.lc-path` stylesheet, so an unset line fill resolves to black.
  layerchart's default 20 px left and 4 px right padding clip "10.000" and an end-of-axis time.
-->
<figure>
  <LineChart
    data={rows}
    x="time"
    y="power"
    series={lines}
    height={240}
    legend
    padding={{ top: 4, left: 40, bottom: 52, right: 16 }}
    props={{ spline: { fill: "none" } }}
  />
</figure>
