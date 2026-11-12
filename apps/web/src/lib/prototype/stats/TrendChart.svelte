<!-- PROTOTYPE: a quiet line chart over time (LayerChart) for the analyses that are trends, not bars: prices, payback, battery capacity. One y axis. -->
<script lang="ts" module>
  export interface TrendSeries {
    key: string;
    label: string;
    colour: string;
    kind: "line" | "step" | "dashed" | "area" | "points";
  }
  export type TrendRow = { x: Date } & Record<string, number | null | Date>;
</script>

<script lang="ts">
  import { Area, Axis, Chart, Layer, Points, Rule, Spline, Tooltip } from "layerchart";
  import { curveLinear, curveStepAfter } from "d3-shape";

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
    rows: TrendRow[];
    series: TrendSeries[];
    /** Horizontal reference lines, such as the investment or the nameplate capacity. */
    rules?: { y: number; label: string }[];
    fmt: (v: number) => string;
    /** The axis' shorter form, with the unit named once beside it. */
    axisFmt?: (v: number) => string;
    unit?: string;
    height?: number;
    yMin?: number | null;
    label: string;
  } = $props();

  const values = $derived(rows.flatMap((r) => series.map((s) => r[s.key]).filter((v): v is number => typeof v === "number")).concat(rules.map((r) => r.y)));
  const lo = $derived(yMin ?? Math.min(...values));
  const hi = $derived(Math.max(...values));
  const pad = $derived((hi - Math.min(lo, 0 + lo)) * 0.08 || 1);
  const yDomain = $derived([yMin === null ? lo - pad : Math.min(lo, yMin), hi + pad]);
  const spanDays = $derived(rows.length > 1 ? (rows.at(-1)!.x.getTime() - rows[0]!.x.getTime()) / 86_400_000 : 0);
  const xf = $derived(
    new Intl.DateTimeFormat("de-DE", spanDays > 1500 ? { year: "numeric" } : spanDays > 62 ? { month: "short", year: "2-digit" } : spanDays > 2 ? { day: "numeric", month: "short" } : { hour: "2-digit", minute: "2-digit" }),
  );
  const tf = $derived(new Intl.DateTimeFormat("de-DE", spanDays > 2 ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }));
  const axis = { tickLabel: "fill-muted-foreground text-[11px] tabular-nums" };
  let width = $state(0);
</script>

<div class="flex flex-col gap-2">
  <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
    {#each series as s (s.key)}
      <li class="flex items-center gap-1.5">
        {#if s.kind === "points"}<span class="size-2 rounded-full" style:background={s.colour}></span>
        {:else}<span class={["w-3 border-t-2", s.kind === "dashed" && "border-dashed"]} style:border-color={s.colour}></span>{/if}
        {s.label}
      </li>
    {/each}
    {#each rules as r (r.label)}
      <li class="flex items-center gap-1.5"><span class="w-3 border-t border-foreground/50"></span>{r.label}</li>
    {/each}
    {#if unit}<li class="ml-auto">{unit}</li>{/if}
  </ul>
  <div class="w-full" style:height="{height}px" bind:clientWidth={width} role="img" aria-label={label}>
    {#if width > 24 && rows.length > 1}
      <Chart data={rows} x="x" y={series[0]!.key} {yDomain} padding={{ top: 8, bottom: 20, left: 44, right: 8 }} tooltipContext={{ mode: "bisect-x" }}>
        <Layer type="svg">
          <Axis placement="left" ticks={4} grid={{ class: "stroke-foreground/[0.07]" }} rule={false} tickLength={0} format={(v: number) => (v === 0 && yDomain[0] === 0 ? "" : axisFmt(v))} classes={axis} />
          <Axis placement="bottom" ticks={width < 480 ? 3 : 6} format={(d: Date) => xf.format(d)} rule={false} tickLength={0} classes={axis} />
          {#each rules as r (r.label)}
            <Rule y={r.y} class="stroke-foreground/50" />
          {/each}
          {#each series as s (s.key)}
            {@const defined = (d: TrendRow) => typeof d[s.key] === "number"}
            {#if s.kind === "area"}
              <Area y1={s.key} {defined} fill={s.colour} fillOpacity={0.14} line={{ stroke: s.colour, "stroke-width": 2 } as never} />
            {:else if s.kind === "points"}
              <Points data={rows.filter(defined)} y={s.key} r={3} fill={s.colour} class="stroke-background" strokeWidth={1} />
            {:else}
              <Spline y={s.key} {defined} curve={s.kind === "step" ? curveStepAfter : curveLinear} stroke={s.colour} fill="none" stroke-width={2} stroke-dasharray={s.kind === "dashed" ? "4 4" : undefined} />
            {/if}
          {/each}
        </Layer>
        <Tooltip.Root>
          {#snippet children({ data: d }: { data: TrendRow })}
            <Tooltip.Header>{tf.format(d.x)}</Tooltip.Header>
            <Tooltip.List>
              {#each series as s (s.key)}
                {#if typeof d[s.key] === "number"}<Tooltip.Item label={s.label} value={fmt(d[s.key] as number)} color={s.colour} />{/if}
              {/each}
            </Tooltip.List>
          {/snippet}
        </Tooltip.Root>
      </Chart>
    {/if}
  </div>
</div>
