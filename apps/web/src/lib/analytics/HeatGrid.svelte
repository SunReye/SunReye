<!--
  Hour of day (rows) against days or months (columns), on one canvas (ADR 11). The one pointer
  reading (`chart-reading/`) reads the cell under it; the line above the grid is the readout, and
  a cell a finger or a key left offers its column to open. Opening and narrowing take a column.
-->
<script lang="ts">
  import ChartEntrance from "../chart-entrance/ChartEntrance.svelte";
  import type { Attachment } from "svelte/attachments";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import { Button } from "#lib/components/ui/button/index.js";
  import { ChartReader, type Move } from "../chart-reading/reader.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import type { HeatColumn } from "./heat.ts";
  import { paintHeat } from "./paint.ts";

  let {
    cols,
    cells,
    colour,
    describe,
    idle,
    label,
    drillLabel = m.range_open(),
    ondrill,
    onbrush,
    blank = false,
  }: {
    /** Draw "no value" as nothing instead of a hatch: where it is expected, not missing. */
    blank?: boolean;
    cols: readonly Pick<HeatColumn, "label" | "tick" | "title">[];
    /** [col][hour]; null without readings, NaN not yet. */
    cells: readonly (readonly (number | null)[])[];
    /** A cell's fill. */
    colour: (v: number) => string;
    describe: (v: number | null) => string;
    /** The readout while no cell is active. */
    idle: string;
    label: string;
    drillLabel?: string;
    ondrill?: ((col: number) => void) | undefined;
    /** Narrows the range to columns `from` to `to`. */
    onbrush?: ((from: number, to: number) => void) | undefined;
  } = $props();

  /** Draws the cells; again when they, the size or the theme change. */
  const paint: Attachment<HTMLCanvasElement> = (canvas) =>
    paintHeat(canvas, { cells, colour, hatch: !blank });

  const n = $derived(cols.length);
  const dense = $derived(n >= 12 && cols.every((c) => c.tick));
  const clamp = (v: number, hi: number) => Math.min(hi, Math.max(0, v));

  const MOVES: Partial<Record<Move, readonly [number, number]>> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  /** A place is a cell, [column, hour]; arrows move from the newest column's noon. */
  const reading = new ChartReader<readonly [number, number]>(() => ({
    over: (x, y) => [clamp(Math.floor(x * n), n - 1), clamp(Math.floor(y * 24), 23)],
    band: ([c, h]) => c * 24 + h,
    step: (from, key) => {
      const d = MOVES[key];

      if (!d) return;

      return from ? [clamp(from[0] + d[0], n - 1), clamp(from[1] + d[1], 23)] : [n - 1, 12];
    },
    drill: ([c]) => {
      ondrill?.(c);

      return ondrill !== undefined;
    },
    brush:
      onbrush &&
      ((a, b) => {
        const [from, to] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];

        if (to <= from) return false;

        onbrush(from, to);

        return true;
      }),
  }));

  const active = $derived(reading.at);

  /** The columns being selected. */
  const sel = $derived(
    reading.brush
      ? ([
          Math.min(reading.brush[0][0], reading.brush[1][0]),
          Math.max(reading.brush[0][0], reading.brush[1][0]),
        ] as const)
      : null,
  );
</script>

<div class="flex flex-col gap-2">
  <div class="flex h-7 items-center justify-between gap-3 pointer-coarse:h-10" aria-live="polite">
    <p class="min-w-0 truncate text-sm">
      {#if active}
        <span class="font-medium"
          >{cols[active[0]]!.title} · {m.range_hours({ from: active[1], to: active[1] + 1 })}</span
        >
        <span class="text-muted-foreground tabular-nums">
          · {describe(cells[active[0]]![active[1]]!)}</span
        >
      {:else}<span class="text-muted-foreground">{idle}</span>{/if}
    </p>
    {#if active && reading.pinned && ondrill}
      <Button
        variant="outline"
        size="sm"
        class="h-7 shrink-0 gap-1 px-2 text-xs pointer-coarse:h-10 pointer-coarse:px-3"
        onclick={reading.open}>{drillLabel}<ArrowRight class="size-3.5" /></Button
      >
    {/if}
  </div>
  <div class="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-1">
    <div
      class="relative h-[216px] text-[11px] text-muted-foreground tabular-nums"
      aria-hidden="true"
    >
      {#each [0, 6, 12, 18] as hr (hr)}
        <span class="absolute right-0 leading-none" style:top="{(hr / 24) * 100}%">{hr} h</span>
      {/each}
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class={[
        "relative h-[216px] touch-pan-y outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
        ondrill && "cursor-pointer",
      ]}
      role="group"
      tabindex="0"
      data-scrub
      aria-label={m.heat_keys({ label })}
      {...reading.on}
    >
      <!-- One canvas, not a cell per element: a month of hours is 744 of them (ADR 11, 21). -->
      <ChartEntrance build="draw" ready={cells.length > 0} class="absolute inset-0">
        <canvas class="absolute inset-0 size-full" {@attach paint}></canvas>
      </ChartEntrance>
      {#if sel}
        <span
          class="pointer-events-none absolute inset-y-0 bg-brand-soft ring-1 ring-brand/50 ring-inset"
          style:left="{(sel[0] / n) * 100}%"
          style:width="{((sel[1] - sel[0] + 1) / n) * 100}%"
        ></span>
      {/if}
      {#if active}
        <span
          class="pointer-events-none absolute ring-2 ring-foreground"
          style:left="{(active[0] / n) * 100}%"
          style:width="{100 / n}%"
          style:top="{(active[1] / 24) * 100}%"
          style:height="{100 / 24}%"
        ></span>
      {/if}
    </div>
    <span></span>
    <div
      class="flex h-4 text-[11px] leading-4 text-muted-foreground tabular-nums"
      aria-hidden="true"
    >
      {#each cols as c, i (i)}
        <!-- Twelve month names do not fit a phone: every other one drops out there. -->
        <span class="relative flex-1"
          >{#if c.tick}<span
              class={[
                "absolute left-1/2 -translate-x-1/2 whitespace-nowrap",
                dense && i % 2 === 1 && "@max-[520px]:hidden",
              ]}>{c.label}</span
            >{/if}</span
        >
      {/each}
    </div>
  </div>
</div>
