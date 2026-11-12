<!-- PROTOTYPE: day curve, actual (filled) against forecast (dashed), with a "now" rule. -->
<script lang="ts">
  import { Chart, Layer, Area, Spline, Axis, Rule } from "layerchart";
  import { curveMonotoneX } from "d3-shape";
  import type { DayPoint } from "./sim.svelte";
  import { NOW_INDEX } from "./sim.svelte";

  let {
    data,
    height = 160,
    metric = "pv",
    axes = true,
  }: { data: DayPoint[]; height?: number; metric?: "pv" | "house" | "soc"; axes?: boolean } = $props();

  const uid = $props.id();
  const colour = $derived(metric === "pv" ? "var(--e-solar)" : metric === "house" ? "var(--e-house)" : "var(--e-battery)");
  const rows = $derived(
    data.map((d, i) => ({
      time: d.time,
      actual: metric === "pv" ? d.actual : i <= NOW_INDEX ? (metric === "house" ? d.house : d.soc) : null,
      forecast: metric === "pv" ? d.forecast : metric === "house" ? d.house : d.soc,
    })),
  );
  const max = $derived(metric === "soc" ? 100 : Math.ceil(Math.max(...rows.map((r) => Math.max(r.forecast, r.actual ?? 0))) + 0.5));
  const now = $derived(data[NOW_INDEX]!.time);
</script>

<div style:height={height ? `${height}px` : "100%"} class="w-full">
  <Chart
    data={rows}
    x="time"
    y="forecast"
    yDomain={[0, max]}
    padding={axes ? { top: 8, bottom: 20, left: 26, right: 6 } : { top: 4, bottom: 2, left: 0, right: 0 }}
  >
    <Layer type="svg">
      <defs>
        <linearGradient id="fill-{uid}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color={colour} stop-opacity="0.42" />
          <stop offset="100%" stop-color={colour} stop-opacity="0.02" />
        </linearGradient>
      </defs>
      {#if axes}
        <Axis
          placement="left"
          ticks={3}
          grid={{ class: "stroke-foreground/[0.07]" }}
          rule={false}
          tickLength={0}
          format={(v: number) => (v === 0 ? "" : `${v}`)}
          classes={{ tickLabel: "fill-muted-foreground text-[11px] tabular-nums" }}
        />
        <Axis
          placement="bottom"
          ticks={(scale: { domain: () => Date[] }) => {
            const [a] = scale.domain();
            return [3, 6, 9, 12, 15, 18, 21].map((h) => new Date(a!.getTime() + h * 3_600_000));
          }}
          format={(d: Date) => `${d.getHours()}:00`}
          rule={false}
          tickLength={0}
          classes={{ tickLabel: "fill-muted-foreground text-[11px] tabular-nums" }}
        />
      {/if}
      <Spline
        y="forecast"
        curve={curveMonotoneX}
        stroke={colour}
        fill="none"
        opacity={0.55}
        stroke-width={1.5}
        stroke-dasharray="3 4"
      />
      <Area
        y1="actual"
        curve={curveMonotoneX}
        defined={(d: { actual: number | null }) => d.actual !== null}
        fill="url(#fill-{uid})"
        line={{ stroke: colour, "stroke-width": 2 } as never}
      />
      <Rule x={now} class="stroke-foreground/25" stroke-dasharray="2 3" />
    </Layer>
  </Chart>
</div>
