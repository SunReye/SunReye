<!--
  v3's live gliding graph (dev 780b4e2, components/inverter/live-area.svelte), restyled for ADR 21.
  A fixed two-minute window anchored to the newest sample: data and scales change only when a
  sample lands, and no tooltip floats (ADR 21). Between samples one transform scrolls the marks on
  a cursor that eases linearly across the feed's own spacing. The plot keeps a few samples past its left edge and is
  downsampled to its pixel budget. `diverging` fills around zero.
-->
<script lang="ts">
  import { Axis, Chart, Layer, Rule } from "layerchart";
  import { VALUE_AXIS } from "../chart-axis.ts";
  import { formatPower } from "../power.ts";
  import { valueDomain } from "./domain.ts";
  import { downsample, pointBudget } from "./downsample.ts";
  import { liveCursor } from "./live-cursor.svelte.ts";
  import { bufferStart, pixelQuantum, sampleInterval } from "./live-window.ts";
  import LiveMarks from "./LiveMarks.svelte";
  import { WINDOW_MS, type LivePoint } from "./series.ts";

  let {
    points,
    accent,
    below = accent,
    diverging = false,
    height = 160,
    stalled = false,
    still,
  }: {
    /** Samples in watts, oldest first. */
    points: readonly LivePoint[];
    accent: string;
    /** Colour below zero when diverging; defaults to the accent. */
    below?: string;
    diverging?: boolean;
    height?: number;
    /** The stream stopped: the marks park and the plot dims. */
    stalled?: boolean;
    /** The still motion tier: a step per sample, no glide. */
    still: boolean;
  } = $props();

  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio;

  // Read once: a dpr change alters the step size, never the position.
  const quantum = pixelQuantum(dpr);
  const PADDING = { top: 8, bottom: 6, left: 48, right: 0 };

  const lastT = $derived(points.at(-1)?.t);
  const interval = $derived(sampleInterval(points.at(-1)?.t, points.at(-2)?.t));

  const cursor = liveCursor(
    () => lastT,
    () => interval,
    () => still,
  );

  const xDomain = $derived(lastT === undefined ? undefined : [lastT - WINDOW_MS, lastT]);

  const cutoff = $derived(
    lastT === undefined ? -Infinity : bufferStart(lastT, WINDOW_MS, interval),
  );

  let plotWidth = $state(0);

  const data = $derived(
    downsample(
      points.filter((p) => p.t >= cutoff),
      pointBudget(plotWidth, dpr),
      { x: (p) => p.t, y: (p) => p.v },
    ).map((p) => ({ t: p.t, v: p.v / 1000 })),
  );

  const yDomain = $derived(valueDomain(data, diverging));

  // Feather the plot's edges so data glides in and out instead of ending on a hard cut. The mask
  // is pinned to the box, not the moving marks, and keeps the axis gutter opaque.
  const edgeFade = `linear-gradient(to right, #000 0, #000 ${PADDING.left - 2}px, transparent ${PADDING.left}px, #000 ${PADDING.left + 44}px, #000 calc(100% - 48px), transparent 100%)`;
</script>

<div
  class={["w-full transition-opacity duration-300", stalled && "opacity-50"]}
  style:height="{height}px"
  style:mask-image={edgeFade}
  style:-webkit-mask-image={edgeFade}
  bind:clientWidth={plotWidth}
>
  <!-- Held until the box is measured: building every scale at width 0 is thrown away a frame later. -->
  {#if plotWidth >= 24 && data.length > 1}
    <Chart
      {data}
      x="t"
      {xDomain}
      y="v"
      {yDomain}
      padding={PADDING}
    >
      <Layer type="svg">
        <Axis {...VALUE_AXIS} format={(kw: number) => formatPower(kw * 1000)} />
        {#if diverging}<Rule y={0} class="stroke-foreground/30" />{/if}
        <LiveMarks
          {lastT}
          cursor={cursor.current}
          {interval}
          {quantum}
          {accent}
          {below}
          {diverging}
          glide={!stalled && !still}
        />
      </Layer>
    </Chart>
  {/if}
</div>
