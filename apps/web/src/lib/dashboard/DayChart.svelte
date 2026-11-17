<!-- The day curve: PV actual (filled) against forecast (dashed), with a "now" rule. Bare, it is a
  row of a detail's day: no axes, no rule and no padding, so a quarter hour stands where the
  rows around it have it. -->
<script lang="ts">
  import { flowColour } from "../energy-colours.ts";
  import { curveMonotoneX } from "d3-shape";
  import { Area, Axis, Chart, Layer, Rule, Spline } from "layerchart";
  import { VALUE_AXIS } from "../chart-axis.ts";
  import type { DayRow } from "./today.ts";

  let {
    rows,
    now,
    hours,
    bare = false,
  }: {
    rows: readonly DayRow[];
    now: Date;
    /** Writes an instant's plant-local hour. */
    hours: Intl.DateTimeFormat;
    bare?: boolean;
  } = $props();

  const uid = $props.id();
  const colour = flowColour("solar");
  const HOUR = 3_600_000;

  const max = $derived(
    Math.ceil(Math.max(0, ...rows.map((r) => Math.max(r.forecast ?? 0, r.actual ?? 0))) + 0.5),
  );

  /** The rows' span, to the end of the last: a bare curve fills its row from edge to edge. */
  const span = $derived.by(() => {
    const [first, last] = [rows[0], rows.at(-1)];

    return first && last && bare
      ? [first.time, new Date(last.time.getTime() + HOUR / 4)]
      : undefined;
  });
</script>

<div class="h-full w-full">
  <Chart
    data={[...rows]}
    x="time"
    y="forecast"
    xDomain={span}
    yDomain={[0, max]}
    padding={bare ? { top: 3, bottom: 1, left: 0, right: 0 } : { top: 8, bottom: 20, left: 26, right: 6 }}
  >
    <Layer type="svg">
      <defs>
        <linearGradient id="fill-{uid}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color={colour} stop-opacity="0.42" />
          <stop offset="100%" stop-color={colour} stop-opacity="0.02" />
        </linearGradient>
      </defs>
      {#if !bare}
        <Axis {...VALUE_AXIS} format={(v: number) => (v === 0 ? "" : `${v}`)} />
        <Axis
          placement="bottom"
          ticks={(scale: { domain: () => Date[] }) => {
            const [a] = scale.domain();
            return a === undefined
              ? []
              : [3, 6, 9, 12, 15, 18, 21].map((h) => new Date(a.getTime() + h * HOUR));
          }}
          format={(d: Date) => hours.format(d)}
          rule={false}
          tickLength={0}
          classes={{ tickLabel: "fill-muted-foreground text-[11px] tabular-nums" }}
        />
      {/if}
      {#if bare}
        <!-- With no axis to read it against, the forecast's energy shows as a faint area. -->
        <Area
          y1="forecast"
          curve={curveMonotoneX}
          defined={(d: DayRow) => d.forecast !== null}
          fill={colour}
          fillOpacity={0.1}
        />
      {/if}
      <Spline
        y="forecast"
        curve={curveMonotoneX}
        defined={(d: DayRow) => d.forecast !== null}
        stroke={colour}
        fill="none"
        opacity={0.55}
        stroke-width={1.5}
        stroke-dasharray="3 4"
      />
      <Area
        y1="actual"
        curve={curveMonotoneX}
        defined={(d: DayRow) => d.actual !== null}
        fill="url(#fill-{uid})"
        line={{ stroke: colour, "stroke-width": 2 } as never}
      />
      {#if !bare}
        <Rule x={now} class="stroke-foreground/25" stroke-dasharray="2 3" />
      {/if}
    </Layer>
  </Chart>
</div>
