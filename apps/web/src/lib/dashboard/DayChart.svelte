<!-- The day curve: PV actual (filled) against forecast (dashed), with a "now" rule. -->
<script lang="ts">
  import { flowColour } from "../energy-colours.ts";
  import { curveMonotoneX } from "d3-shape";
  import { Area, Axis, Chart, Layer, Rule, Spline } from "layerchart";
  import { VALUE_AXIS } from "../chart-axis.ts";
  import Staged from "../motion/Staged.svelte";
  import type { DayRow } from "./today.ts";

  let {
    rows,
    now,
    hours,
  }: {
    rows: readonly DayRow[];
    now: Date;
    /** Writes an instant's plant-local hour. */
    hours: Intl.DateTimeFormat;
  } = $props();

  const uid = $props.id();
  const colour = flowColour("solar");
  const HOUR = 3_600_000;

  const max = $derived(
    Math.ceil(Math.max(0, ...rows.map((r) => Math.max(r.forecast ?? 0, r.actual ?? 0))) + 0.5),
  );
</script>

<div class="h-full w-full">
  <Chart
    data={[...rows]}
    x="time"
    y="forecast"
    yDomain={[0, max]}
    padding={{ top: 8, bottom: 20, left: 26, right: 6 }}
  >
    <Layer type="svg">
      <defs>
        <linearGradient id="fill-{uid}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color={colour} stop-opacity="0.42" />
          <stop offset="100%" stop-color={colour} stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <!-- Each mark in a frame of its own, each axis tick too: one of layerchart's ticks costs a
           frame's share at 4x throttle, the whole chart at once overruns a frame (ADR 21). The
           single-tick axes draw the same ticks the whole axes would. -->
      {#each [0, 1, 2, 3, 4] as i (i)}
        <Staged>
          <Axis
            {...VALUE_AXIS}
            ticks={(scale: { ticks?: (n: number) => number[] }) =>
              (scale.ticks?.(VALUE_AXIS.ticks) ?? []).slice(i, i + 1)}
            format={(v: number) => (v === 0 ? "" : `${v}`)}
          />
        </Staged>
      {/each}
      {#each [3, 6, 9, 12, 15, 18, 21] as h (h)}
        <Staged>
          <Axis
            placement="bottom"
            ticks={(scale: { domain: () => Date[] }) => {
              const [a] = scale.domain();
              return a === undefined ? [] : [new Date(a.getTime() + h * HOUR)];
            }}
            format={(d: Date) => hours.format(d)}
            rule={false}
            tickLength={0}
            classes={{ tickLabel: "fill-muted-foreground text-[11px] tabular-nums" }}
          />
        </Staged>
      {/each}
      <Staged>
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
      </Staged>
      <Staged>
        <Area
          y1="actual"
          curve={curveMonotoneX}
          defined={(d: DayRow) => d.actual !== null}
          fill="url(#fill-{uid})"
          line={{ stroke: colour, "stroke-width": 2 } as never}
        />
      </Staged>
      <Staged><Rule x={now} class="stroke-foreground/25" stroke-dasharray="2 3" /></Staged>
    </Layer>
  </Chart>
</div>
