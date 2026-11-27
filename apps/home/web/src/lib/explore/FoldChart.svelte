<!--
  The fold's chart (ADR 22): a bar per period on the range's time axis, the mean with its min–max
  whisker or a counter's delta, so a period without statistics stays empty. The legend is the
  readout (ADR 21): the range's figures, or those of the period under the pointer.
-->
<script lang="ts">
  import ChartEntrance from "../chart-entrance/ChartEntrance.svelte";
  import { ChartReader } from "../chart-reading/reader.svelte.ts";
  import type { Period } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { ticksOf } from "../range/bands.ts";
  import { paintFold, type Bar } from "./fold-paint.ts";
  import { barOf, figure, labelOf, foldScale, tickOf, totalOf, type FoldRow } from "./fold.ts";

  let {
    rows,
    period,
    counter,
    unit,
    from,
    to,
    zone,
    whole,
    label,
    height,
  }: {
    /** In time order. */
    rows: readonly FoldRow[];
    period: Period;
    counter: boolean;
    unit: string | null;
    /** The range, in ms since the epoch. */
    from: number;
    to: number;
    zone: string;
    /** The range's name, the legend's title while no period is read. */
    whole: string;
    label: string;
    height: number;
  } = $props();

  const scale = $derived(foldScale(rows, counter));
  const ticks = $derived(ticksOf(scale));
  const share = (t: number) => Math.min(1, Math.max(0, (t - from) / (to - from)));

  const bars = $derived(
    rows.flatMap((row): Bar[] => {
      const value = barOf(row, counter);

      if (value === null) return [];

      return [{ x0: share(row.start), x1: share(row.end), value, min: row.min, max: row.max }];
    }),
  );

  const painting = $derived({ bars, scale, lines: ticks.map((t) => t.v) });

  let width = $state(0);

  /** As many names under the plot as stand apart: about one per 72 px. */
  const names = $derived.by(() => {
    const stride = Math.ceil(rows.length / Math.max(2, Math.floor(width / 72)));

    return rows
      .filter((_, i) => i % stride === 0)
      .map((row) => ({
        key: row.key,
        at: share((row.start + row.end) / 2) * 100,
        text: tickOf(row, period, zone),
      }));
  });

  // The period under the pointer; -1 between periods, which reads the range.
  const reading = new ChartReader<number>(() => ({
    over: (x) => {
      const t = from + x * (to - from);

      return rows.findIndex((row) => t >= row.start && t < row.end);
    },
    band: (i) => i,
  }));

  // A new fold has other periods: the one read is gone.
  const read = $derived(reading.at === null ? null : (rows[reading.at] ?? null));
  const shown = $derived(read ?? totalOf(rows));
  const title = $derived(read ? labelOf(read, period, zone) : whole);

  const readout = $derived(
    counter
      ? [{ name: m.explore_fold_delta(), value: shown.delta }]
      : [
          { name: m.explore_fold_mean(), value: shown.mean },
          { name: m.explore_fold_min(), value: shown.min },
          { name: m.explore_fold_max(), value: shown.max },
        ],
  );
</script>

<figure class="flex flex-col gap-2" style:height="{height}px">
  <figcaption class="flex min-h-10 flex-wrap items-baseline gap-x-4 gap-y-0.5 text-sm">
    <span class="font-medium">{title}</span>
    {#each readout as item (item.name)}
      <span class="text-muted-foreground">
        {#if item.name === m.explore_fold_mean() || counter}
          <i class="mr-1 inline-block size-2 rounded-[2px] bg-chart-1"></i>
        {/if}{item.name}
        <span class="font-semibold text-foreground tabular-nums">{figure(item.value)}</span>
        {unit ?? ""}
      </span>
    {/each}
  </figcaption>

  <div class="flex min-h-0 flex-1 gap-2">
    <div class="relative w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
      {#each ticks as tick (tick.key)}
        <span class="absolute right-0 -translate-y-1/2" style:top="{tick.y}%">
          {tick.v < 0 ? "−" : ""}{tick.text}
        </span>
      {/each}
    </div>

    <!-- The table below holds every figure for a keyboard and a screen reader. -->
    <div class="relative min-w-0 flex-1 touch-pan-y" role="img" aria-label={label} {...reading.on}>
      {#if read}
        <div
          class="pointer-events-none absolute inset-y-0 bg-foreground/[0.08]"
          style:left="{share(read.start) * 100}%"
          style:width="{(share(read.end) - share(read.start)) * 100}%"
        ></div>
      {/if}
      <ChartEntrance build="draw" ready={bars.length > 0} class="absolute inset-0">
        <canvas class="absolute inset-0 size-full" {@attach (canvas) => paintFold(canvas, painting)}
        ></canvas>
      </ChartEntrance>
    </div>
  </div>

  <div
    class="relative ml-11 h-4 text-[11px] text-muted-foreground tabular-nums"
    bind:clientWidth={width}
  >
    {#each names as name (name.key)}
      <span class="absolute -translate-x-1/2 whitespace-nowrap" style:left="{name.at}%">
        {name.text}
      </span>
    {/each}
  </div>
</figure>
