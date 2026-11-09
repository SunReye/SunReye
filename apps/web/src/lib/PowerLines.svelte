<script lang="ts">
  import { LineChart, Points, Spline } from "layerchart/canvas";
  import { colour } from "./chart-colours";

  /** One point of a named series. */
  interface Row {
    readonly time: Date;
    readonly power: number;
    readonly series: string;
  }

  let {
    rows,
    height,
    time,
  }: {
    rows: readonly Row[];
    height: number;
    time: Intl.DateTimeFormat;
  } = $props();

  /** One line per series, so the legend names each. */
  const lines = $derived(
    [...new Set(rows.map((r) => r.series))].map((key, i) => ({
      key,
      color: colour(i),
      data: rows.filter((r) => r.series === key),
    })),
  );

  /** Series of one point, which a line cannot draw. */
  const dots = $derived(new Set(lines.filter((l) => l.data.length === 1).map((l) => l.key)));
</script>

<!--
  The canvas build ships no `.lc-path` stylesheet, so an unset line fill resolves to black.
  layerchart's default 20 px left and 4 px right padding clip "10.000" and an end-of-axis time.
-->
<LineChart
  data={rows}
  x="time"
  y="power"
  series={lines}
  {height}
  legend
  padding={{ top: 4, left: 48, bottom: 52, right: 24 }}
  props={{ xAxis: { format: (at: Date) => time.format(at) } }}
>
  {#snippet marks({ context })}
    {#each context.series.visibleSeries as s (s.key)}
      <Spline seriesKey={s.key} fill="none" />
      {#if dots.has(s.key)}
        <Points seriesKey={s.key} r={3} />
      {/if}
    {/each}
  {/snippet}
</LineChart>
