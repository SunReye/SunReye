<!--
  A quiet line chart over plant-local days for the analyses that are trends, not bars: payback and
  battery capacity. One y axis. The legend reads the values of the day under the pointer, on the
  one pointer reading (`chart-reading/`); there is no floating tooltip (ADR 21).
-->
<script lang="ts">
  import ChartEntrance from "../chart-entrance/ChartEntrance.svelte";
  import { Axis, Chart, Layer, Rule } from "layerchart";
  import { ChartReader } from "../chart-reading/reader.svelte.ts";
  import ReadingRule from "../chart-reading/ReadingRule.svelte";
  import { getLocale } from "../paraglide/runtime.js";
  import { isValue, valueOf, type TrendRow, type TrendRule, type TrendSeries } from "./trend.ts";
  import TrendLegend from "./TrendLegend.svelte";
  import TrendMark from "./TrendMark.svelte";

  let {
    rows,
    series,
    rules = [],
    fmt,
    axisFmt = fmt,
    unit = "",
    height = 220,
    yMin = 0,
    label,
  }: {
    rows: readonly TrendRow[];
    series: readonly TrendSeries[];
    rules?: readonly TrendRule[];
    fmt: (v: number) => string;
    /** The axis' shorter form, with the unit named once beside it. */
    axisFmt?: (v: number) => string;
    unit?: string;
    height?: number;
    yMin?: number | null;
    label: string;
  } = $props();

  const values = $derived(
    rows
      .flatMap((r) => series.map((s) => r.values[s.key]).filter((v) => isValue(v)))
      .concat(rules.map((r) => r.y)),
  );

  const lo = $derived(yMin ?? Math.min(...values));
  const hi = $derived(Math.max(...values));
  const pad = $derived((hi - lo) * 0.08 || 1);
  const yDomain = $derived([yMin === null ? lo - pad : Math.min(lo, yMin), hi + pad]);

  const spanDays = $derived(
    rows.length > 1 ? (rows.at(-1)!.x.getTime() - rows[0]!.x.getTime()) / 86_400_000 : 0,
  );

  const xf = $derived(
    new Intl.DateTimeFormat(getLocale(), {
      timeZone: "UTC",
      ...(spanDays > 1500
        ? { year: "numeric" }
        : spanDays > 62
          ? { month: "short", year: "2-digit" }
          : { day: "numeric", month: "short" }),
    }),
  );

  const tf = $derived(
    new Intl.DateTimeFormat(getLocale(), {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  );

  const axis = { tickLabel: "fill-muted-foreground text-[11px] tabular-nums" };

  let width = $state(0);

  const PADDING = { top: 8, bottom: 20, left: 44, right: 8 };

  /** The time axis, from the first row to the last, in ms. */
  const span = $derived([rows[0]?.x.getTime() ?? 0, rows.at(-1)?.x.getTime() ?? 0] as const);

  const shareOf = (row: TrendRow) => (row.x.getTime() - span[0]) / (span[1] - span[0] || 1);

  /** A place is a row's index: the row nearest the pointer. */
  const reading = new ChartReader<number>(() => ({
    over: (x) => {
      let near = 0;

      for (const [i, row] of rows.entries())
        if (Math.abs(shareOf(row) - x) < Math.abs(shareOf(rows[near]!) - x)) near = i;

      return near;
    },
    band: (i) => i,
  }));

  /** The row under the pointer, read in the legend. */
  const read: TrendRow | null = $derived(
    reading.at === null ? null : (rows[reading.at] ?? null),
  );

  /** A chart too narrow or with one row has nothing to draw. */
  const drawn = $derived(width > 24 && rows.length > 1);

  const ticks = $derived(width < 480 ? 3 : 6);

  /** A zero at the floor goes unwritten. */
  const valueTick = (v: number) => (v === 0 && yDomain[0] === 0 ? "" : axisFmt(v));

  const y = $derived(valueOf(series[0]?.key ?? ""));
</script>

<div class="flex flex-col gap-2">
  <TrendLegend {series} {rules} {unit} {read} {fmt} day={(d) => tf.format(d)} />
  <div
    class="relative w-full"
    style:height="{height}px"
    bind:clientWidth={width}
    role="img"
    aria-label={label}
    data-scrub
  >
    <ChartEntrance build="draw" ready={drawn} class="size-full">
      {#if drawn}
        <Chart data={[...rows]} x="x" {y} {yDomain} padding={PADDING}>
          <Layer type="svg">
            <Axis
              placement="left"
              ticks={4}
              grid={{ class: "stroke-foreground/[0.07]" }}
              rule={false}
              tickLength={0}
              format={valueTick}
              classes={axis}
            />
            <Axis
              placement="bottom"
              {ticks}
              format={(d: Date) => xf.format(d)}
              rule={false}
              tickLength={0}
              classes={axis}
            />
            {#each rules as r (r.label)}
              <Rule y={r.y} class="stroke-foreground/50" />
            {/each}
            {#each series as s (s.key)}
              <TrendMark {s} {rows} />
            {/each}
          </Layer>
        </Chart>
        <!-- Over the plot alone, never its axes, so a share of it is a share of the days. -->
        <div
          class="absolute touch-pan-y select-none"
          style:inset="{PADDING.top}px {PADDING.right}px {PADDING.bottom}px {PADDING.left}px"
          role="presentation"
          data-plot
          {...reading.on}
        >
          {#if read}
            <ReadingRule share={shareOf(read)} />
          {/if}
        </div>
      {/if}
    </ChartEntrance>
  </div>
</div>
