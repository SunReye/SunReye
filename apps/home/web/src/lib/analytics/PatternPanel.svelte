<!--
  When in the day it happens (ADR 21): hour of day against the range's days, or its months when
  the range is long. It keeps the last grid while the next range loads.
-->
<script lang="ts">
  import type { Core } from "../api/core.ts";
  import { num } from "../range/format.ts";
  import { customRange } from "../range/range.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import HeatGrid from "./HeatGrid.svelte";
  import { readHeat, type Heat, type HeatSource } from "./heat.ts";

  let {
    core,
    route,
    source,
    name,
    colour,
    estimated = false,
  }: {
    core: Readonly<Pick<Core, "statistics">>;
    route: RangeRoute;
    source: HeatSource;
    name: string;
    /** The energy token the cells are tinted with. */
    colour: string;
    /** The series is computed, not measured, so each cell's energy carries ≈ (ADR 17). */
    estimated?: boolean;
  } = $props();

  let heat = $state.raw<Heat | undefined>();

  $effect(() => {
    const r: RangeRoute = route;
    const [range, place, from] = [r.range, r.place, source];
    let live = true;

    // A failed read keeps the last grid: the sheet says once that its range could not be read.
    void readHeat(core, from, place, range).then(
      (next) => {
        if (live) heat = next;

        return next;
      },
      () => null,
    );

    return () => {
      live = false;
    };
  });

  const max = $derived(heat?.max ?? 0);
  const monthly = $derived(heat?.by === "month");

  // One hue, light to dark; steps of a tenth so equal cells look equal.
  const fill = (v: number) =>
    `color-mix(in oklab, ${colour} ${Math.round(Math.min(1, v / (max || 1)) * 10) * 10}%, transparent)`;

  const describe = (v: number | null) => {
    if (v === null) return m.range_no_data();

    if (Number.isNaN(v)) return m.heat_not_yet();

    const kwh = (monthly ? m.heat_kwh_mean : m.heat_kwh)({ value: num(v, 2) });

    return estimated ? `≈ ${kwh}` : kwh;
  };

  const idle = $derived(
    (monthly ? m.heat_idle_month : route.range.kind === "day" ? m.heat_idle_week : m.heat_idle)({
      name,
    }),
  );
</script>

<div class="flex flex-col gap-3">
  <HeatGrid
    cols={heat?.cols ?? []}
    cells={heat?.cells ?? []}
    colour={fill}
    {describe}
    {idle}
    label={m.heat_by_time({ name })}
    drillLabel={monthly ? m.heat_open_month() : m.heat_open_day()}
    ondrill={(c) => {
      const col = heat?.cols[c];

      if (col) route.open(col.drill);
    }}
    onbrush={(a, b) => {
      const [first, last] = [heat?.cols[a], heat?.cols[b]];

      if (first && last) route.open(customRange(route.place.cal, first.t0 / 24, last.t1 / 24));
    }}
  />
  <div class="flex items-center gap-2 pl-10 text-xs text-muted-foreground tabular-nums">
    <span>0</span>
    <span class="flex h-2 w-32 gap-px" data-heat-scale>
      {#each { length: 10 } as _, i (i)}<span
          class="flex-1"
          style:background={fill(((i + 1) / 10) * max)}
        ></span>{/each}
    </span>
    <span>{m.heat_scale({ value: num(max, 1) })}</span>
    <span class="ml-3 flex items-center gap-1.5">
      <span class="hatch size-2.5"></span>{m.range_no_data()}
    </span>
  </div>
</div>

<style>
  .hatch {
    background: repeating-linear-gradient(
      135deg,
      color-mix(in oklab, var(--foreground) 30%, transparent) 0 1px,
      transparent 1px 4px
    );
  }
</style>
