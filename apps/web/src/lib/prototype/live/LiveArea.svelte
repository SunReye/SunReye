<!--
  v3's live gliding graph (dev 780b4e2, components/inverter/live-area.svelte), restyled for ADR 21.
  A fixed two-minute window anchored to the newest sample: data, scales and the tooltip index change
  only when a sample lands. Between samples one transform scrolls the marks on a cursor that eases
  linearly across the feed's own spacing. The plot keeps a few samples past its left edge and is
  downsampled to its pixel budget. `diverging` fills around zero.
-->
<script lang="ts">
  import { Axis, Chart, Layer, Rule, Tooltip } from "layerchart";
  import LiveMarks from "./LiveMarks.svelte";
  import { liveCursor } from "./live-cursor.svelte";
  import { bufferStart, pixelQuantum, sampleInterval } from "./live-window";
  import { downsample, pointBudget } from "./downsample";
  import { motion } from "../motion/tier.svelte";
  import type { LivePoint } from "../sim.svelte";

  let {
    points = [],
    accent = "var(--e-solar)",
    below = accent,
    diverging = false,
    windowMs = 2 * 60 * 1000,
    height = 160,
    label = "Leistung",
    stalled = false,
  }: {
    /** Samples in watts. */
    points?: LivePoint[];
    accent?: string;
    /** Colour below zero when diverging; defaults to the accent. */
    below?: string;
    diverging?: boolean;
    windowMs?: number;
    height?: number;
    /** Series name shown in the hover tooltip. */
    label?: string;
    /** The stream stopped: the marks park and the plot dims. */
    stalled?: boolean;
  } = $props();

  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  // Read once: a dpr change alters the step size, never the position.
  const quantum = pixelQuantum(dpr);
  const PADDING = { top: 8, bottom: 6, left: 34, right: 0 };

  const lastT = $derived(points.at(-1)?.t);
  const interval = $derived(sampleInterval(points.at(-1)?.t, points.at(-2)?.t));
  const cursor = liveCursor(
    () => lastT,
    () => interval,
  );

  const xDomain = $derived(lastT === undefined ? undefined : [lastT - windowMs, lastT]);
  const cutoff = $derived(lastT === undefined ? -Infinity : bufferStart(lastT, windowMs, interval));

  let plotWidth = $state(0);
  const data = $derived(
    downsample(
      points.filter((p) => p.t >= cutoff),
      pointBudget(plotWidth, dpr),
      { x: (p) => p.t, y: (p) => p.v / 1000 },
    ).map((p) => ({ t: p.t, v: p.v / 1000 })),
  );

  // A stable, round y range so a 1 % wobble does not rescale the plot on every sample.
  const yDomain = $derived.by<[number, number]>(() => {
    let lo = 0;
    let hi = 0;
    for (const p of data) {
      if (p.v < lo) lo = p.v;
      if (p.v > hi) hi = p.v;
    }
    const step = Math.max(hi, -lo) > 4 ? 2 : Math.max(hi, -lo) > 1.5 ? 1 : 0.5;
    const up = (v: number) => Math.ceil((v * 1.12) / step) * step;
    hi = hi > 0 ? up(hi) : 0;
    lo = lo < 0 ? -up(-lo) : 0;
    // A one-sided series still shows which side of zero it is on.
    if (diverging && hi === 0) hi = step / 2;
    if (diverging && lo === 0) lo = -step / 2;
    if (hi === lo) hi = lo + step;
    return [lo, hi];
  });

  // Feather the plot's edges so data glides in and out instead of ending on a hard cut. The mask
  // is pinned to the box, not the moving marks, and keeps the axis gutter opaque.
  const edgeFade = `linear-gradient(to right, #000 0, #000 ${PADDING.left - 2}px, transparent ${PADDING.left}px, #000 ${PADDING.left + 44}px, #000 calc(100% - 48px), transparent 100%)`;
  const nf = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tf = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
    <Chart {data} x="t" {xDomain} y="v" {yDomain} padding={PADDING} tooltipContext={{ mode: "bisect-x" }}>
      <Layer type="svg">
        <Axis
          placement="left"
          ticks={3}
          grid={{ class: "stroke-foreground/[0.07]" }}
          rule={false}
          tickLength={0}
          format={(v: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(v)}
          classes={{ tickLabel: "fill-muted-foreground text-[11px] tabular-nums" }}
        />
        {#if diverging}<Rule y={0} class="stroke-foreground/30" />{/if}
        <LiveMarks {lastT} cursor={cursor.current} {interval} {quantum} {accent} {below} {diverging} glide={!stalled && !motion.still} />
      </Layer>
      <Tooltip.Root>
        {#snippet children({ data: d }: { data: { t: number; v: number } })}
          <Tooltip.Header>{tf.format(new Date(d.t))}</Tooltip.Header>
          <Tooltip.List>
            <Tooltip.Item {label} value="{nf.format(d.v)} kW" color={diverging && d.v < 0 ? below : accent} />
          </Tooltip.List>
        {/snippet}
      </Tooltip.Root>
    </Chart>
  {/if}
</div>
