<!-- One series of a trend chart: a filled area, points, or a solid or dashed line. -->
<script lang="ts">
  import { curveLinear } from "d3-shape";
  import { Area, Points, Spline } from "layerchart";
  import { defined, valueOf, type TrendRow, type TrendSeries } from "./trend.ts";

  let { s, rows }: { s: TrendSeries; rows: readonly TrendRow[] } = $props();
</script>

{#if s.kind === "area"}
  <Area
    y1={valueOf(s.key)}
    defined={defined(s.key)}
    fill={s.colour}
    fillOpacity={0.14}
    line={{ stroke: s.colour, "stroke-width": 2 } as never}
  />
{:else if s.kind === "points"}
  <Points
    data={rows.filter((r) => defined(s.key)(r))}
    y={valueOf(s.key)}
    r={3}
    fill={s.colour}
    class="stroke-background"
    strokeWidth={1}
  />
{:else}
  <Spline
    y={valueOf(s.key)}
    defined={defined(s.key)}
    curve={curveLinear}
    stroke={s.colour}
    fill="none"
    stroke-width={2}
    stroke-dasharray={s.kind === "dashed" ? "4 4" : undefined}
  />
{/if}
