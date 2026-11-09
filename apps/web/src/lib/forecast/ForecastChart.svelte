<script lang="ts">
  import { LineChart, Points, Spline } from "layerchart/canvas";
  import type { Core } from "../api/core.ts";
  import { colour } from "../chart-colours.ts";
  import { getLocale } from "../paraglide/runtime.js";
  import { forecastRows, type Line, type Row } from "./forecast.ts";

  let { core, device, lines }: { core: Core; device: number; lines: readonly Line[] } = $props();

  /** The SPA's locale, not the browser's; a new locale renders the screen anew. */
  const clock = new Intl.DateTimeFormat(getLocale(), {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const rows = $derived(forecastRows(core, device, lines));

  /** One line per series, in the screen's order, so the legend names each. */
  function series(data: readonly Row[]) {
    return lines.map((line, i) => ({
      key: line.label,
      color: colour(i),
      data: data.filter((r) => r.series === line.label),
    }));
  }
</script>

<!-- As the day chart: no `.lc-path` stylesheet in the canvas build, and room for the axis labels. -->
<figure>
  {#await rows then data}
    {@const lined = series(data)}
    <LineChart
      {data}
      x="time"
      y="power"
      series={lined}
      height={280}
      legend
      padding={{ top: 4, left: 48, bottom: 52, right: 24 }}
      props={{ xAxis: { format: (time: Date) => clock.format(time) } }}
    >
      {#snippet marks({ context })}
        {#each context.series.visibleSeries as s (s.key)}
          <Spline seriesKey={s.key} fill="none" />
          <!-- A series of one point, which a line cannot draw. -->
          {#if lined.find((l) => l.key === s.key)?.data.length === 1}
            <Points seriesKey={s.key} r={3} />
          {/if}
        {/each}
      {/snippet}
    </LineChart>
  {/await}
</figure>
