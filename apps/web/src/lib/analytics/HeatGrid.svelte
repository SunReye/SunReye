<!--
  Hour of day (rows) against days or months (columns), on one canvas (ADR 11). One handler reads
  the cell under the pointer; the line above the grid is the readout. Mouse: click opens the
  column, a drag across columns narrows the range to them. Touch: tap reads, the button opens; no
  brushing. Keys: arrows move, Shift and arrows select columns, Enter opens or narrows (ADR 21).
-->
<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import { Button } from "#lib/components/ui/button/index.js";
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

  let grid = $state<HTMLElement | null>(null);

  /** Draws the cells; again when they, the size or the theme change. */
  const paint: Attachment<HTMLCanvasElement> = (canvas) =>
    paintHeat(canvas, { cells, colour, hatch: !blank });

  let active = $state<[number, number] | null>(null);
  let pinned = $state(false);
  const n = $derived(cols.length);
  const dense = $derived(n >= 12 && cols.every((c) => c.tick));
  const clamp = (v: number, hi: number) => Math.min(hi, Math.max(0, v));

  /** The columns being selected, from where the selection began. */
  let brush = $state<[number, number] | null>(null);
  const sel = $derived(brush ? ([Math.min(...brush), Math.max(...brush)] as const) : null);

  /** The column a mouse press began on; a drag off it selects. */
  let dragFrom: number | null = null;

  /** The click that ends a drag opens nothing. */
  let dragged = false;

  /** Narrows to the selection, if it spans columns. */
  function narrow(): boolean {
    const s = sel;

    brush = null;

    if (!s || s[1] <= s[0] || !onbrush) return false;

    // The narrower range has other columns: nothing is being read in it yet.
    active = null;
    pinned = false;
    onbrush(s[0], s[1]);

    return true;
  }

  function at(e: PointerEvent): [number, number] {
    const r = grid!.getBoundingClientRect();

    return [
      clamp(Math.floor(((e.clientX - r.left) / r.width) * n), n - 1),
      clamp(Math.floor(((e.clientY - r.top) / r.height) * 24), 23),
    ];
  }

  const MOVES = new Map<string, readonly [number, number]>([
    ["ArrowLeft", [-1, 0]],
    ["ArrowRight", [1, 0]],
    ["ArrowUp", [0, -1]],
    ["ArrowDown", [0, 1]],
  ]);

  /** Arrows move; with Shift they select columns from where they began. */
  function arrow(d: readonly [number, number], shift: boolean): void {
    const was = active;

    pinned = true;
    active = was ? [clamp(was[0] + d[0], n - 1), clamp(was[1] + d[1], 23)] : [n - 1, 12];
    brush = shift && onbrush && was ? [brush?.[0] ?? was[0], active[0]] : null;
  }

  function clear(): void {
    active = null;
    brush = null;
    pinned = false;
  }

  /** Whether key `k` did anything. */
  function act(k: string, shift: boolean): boolean {
    const d = MOVES.get(k);

    if (d) arrow(d, shift);
    else if (k === "Enter" && active) {
      if (!narrow()) ondrill?.(active[0]);
    } else if (k === "Escape" && (active || brush)) clear();
    else return false;

    return true;
  }

  function key(e: KeyboardEvent): void {
    if (act(e.key, e.shiftKey)) e.preventDefault();
  }
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
    {#if active && pinned && ondrill}
      <Button
        variant="outline"
        size="sm"
        class="h-7 shrink-0 gap-1 px-2 text-xs pointer-coarse:h-10 pointer-coarse:px-3"
        onclick={() => ondrill(active![0])}>{drillLabel}<ArrowRight class="size-3.5" /></Button
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
      bind:this={grid}
      class={[
        "relative h-[216px] touch-pan-y outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
        ondrill && "cursor-pointer",
      ]}
      role="group"
      tabindex="0"
      data-scrub
      aria-label={m.heat_keys({ label })}
      onpointerdown={(e) => {
        dragged = false;

        if (e.pointerType !== "mouse") {
          pinned = true;
          active = at(e);
        } else if (e.button === 0 && onbrush) {
          dragFrom = at(e)[0];
          grid?.setPointerCapture(e.pointerId);
        }
      }}
      onpointermove={(e) => {
        if (e.pointerType === "mouse" || e.pressure > 0) active = at(e);

        if (e.pointerType === "mouse" && dragFrom !== null && (dragged || active![0] !== dragFrom)) {
          dragged = true;
          brush = [dragFrom, active![0]];
        }
      }}
      onpointerup={(e) => {
        if (e.pointerType === "mouse" && dragFrom !== null) {
          dragFrom = null;
          if (dragged) narrow();
        }
      }}
      onpointerleave={(e) => {
        if (e.pointerType === "mouse" && dragFrom === null) active = null;
      }}
      onclick={() => {
        if (dragged) dragged = false;
        else if (active && !pinned) ondrill?.(active[0]);
      }}
      onkeydown={key}
    >
      <!-- One canvas, not a cell per element: a month of hours is 744 of them (ADR 11, 21). -->
      <canvas class="absolute inset-0 size-full" {@attach paint}></canvas>
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
