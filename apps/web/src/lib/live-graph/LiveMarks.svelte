<!--
  The gliding marks of the live graph. Ported from v3 (dev 780b4e2: the `clippedMarks` snippet of
  live-area.svelte with power-area.svelte and diverging-area.svelte). One `transform` on the group
  scrolls the marks between samples; the data and scales change only when a sample lands.
-->
<script lang="ts">
  import { Area, ChartClipPath, getChartContext } from "layerchart";
  import { curveMonotoneX } from "d3-shape";
  import { glideTransform } from "./live-window.ts";

  let {
    lastT,
    cursor,
    interval,
    quantum,
    accent,
    below,
    diverging,
    glide: gliding,
  }: {
    lastT: number | undefined;
    /** The scroll cursor, eased toward the newest sample. */
    cursor: number;
    interval: number;
    quantum: number;
    /** The series colour; above zero when diverging. */
    accent: string;
    /** The colour below zero when diverging. */
    below: string;
    diverging: boolean;
    /** False parks the marks on the newest sample (a stalled stream, the still tier). */
    glide: boolean;
  } = $props();

  const ctx = getChartContext<{ t: number; v: number }>();
  const uid = $props.id();

  // SAFETY: the chart's x is a number (epoch ms), so its scale returns one.
  const at = (t: number) => ctx.xScale(t) as number;

  // SAFETY: the chart's y is a number (kW), so its scale returns one.
  const zeroY = () => ctx.yScale(0) as number;

  // Snapped to a quarter-pixel grid: the string is identical on four frames in five, so Svelte
  // drops the write and with it the style invalidation, paint and raster.
  const transform = $derived(
    gliding ? glideTransform(at, lastT, cursor, interval, quantum) : "translate(0,0)",
  );

  const zero = $derived(Math.min(1, Math.max(0, zeroY() / Math.max(1, ctx.height))));
</script>

<defs>
  {#if diverging}
    <!-- Split at the zero line: import above, export below (ADR 21). -->
    <linearGradient
      id="{uid}-stroke"
      gradientUnits="userSpaceOnUse"
      x1="0"
      x2="0"
      y1="0"
      y2={ctx.height}
    >
      <stop offset={zero} stop-color={accent} />
      <stop offset={zero} stop-color={below} />
    </linearGradient>
    <linearGradient
      id="{uid}-fill"
      gradientUnits="userSpaceOnUse"
      x1="0"
      x2="0"
      y1="0"
      y2={ctx.height}
    >
      <stop offset="0" stop-color={accent} stop-opacity="0.5" />
      <stop offset={zero} stop-color={accent} stop-opacity="0.06" />
      <stop offset={zero} stop-color={below} stop-opacity="0.06" />
      <stop offset="1" stop-color={below} stop-opacity="0.5" />
    </linearGradient>
  {:else}
    <!-- One instantaneous measure: the accent fading downward, so the area claims no total. -->
    <linearGradient id="{uid}-fill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color={accent} stop-opacity="0.45" />
      <stop offset="1" stop-color={accent} stop-opacity="0" />
    </linearGradient>
  {/if}
</defs>

<ChartClipPath>
  <g {transform}>
    {#if diverging}
      <Area
        y0={() => 0}
        curve={curveMonotoneX}
        fill="url(#{uid}-fill)"
        line={{ stroke: `url(#${uid}-stroke)`, "stroke-width": 1.75 } as never}
      />
    {:else}
      <Area
        curve={curveMonotoneX}
        fill="url(#{uid}-fill)"
        line={{ stroke: accent, "stroke-width": 1.75 } as never}
      />
    {/if}
  </g>
</ChartClipPath>
