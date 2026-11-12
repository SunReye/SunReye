<!--
  PROTOTYPE: hour of day (rows) against days or months (columns). One handler reads the cell under
  the pointer; the line above the grid is the readout. Mouse: click opens the column. Touch: tap
  reads, the button opens. Keys: arrows move, Enter opens.
-->
<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import { Button } from "#lib/components/ui/button/index.js";

  let {
    cols,
    cells,
    colour,
    describe,
    idle,
    label,
    drillLabel = "Öffnen",
    ondrill,
    blank = false,
  }: {
    /** Draw "no value" as nothing instead of a hatch: where it is expected, not missing. */
    blank?: boolean;
    cols: { label: string; tick: boolean; title: string }[];
    /** [col][hour]; null without readings. */
    cells: (number | null)[][];
    /** A cell's fill; null draws "no value". */
    colour: (v: number) => string;
    describe: (v: number | null) => string;
    /** The readout while no cell is active. */
    idle: string;
    label: string;
    drillLabel?: string;
    ondrill?: ((col: number) => void) | undefined;
  } = $props();

  let grid = $state<HTMLElement | null>(null);

  const HATCH = "color-mix(in oklab, var(--foreground) 14%, transparent)";
  /** Draws the cells; again when they, the size or the theme change. */
  const paint: Attachment<HTMLCanvasElement> = (canvas) => {
    const [data, fill, hatch] = [cells, colour, !blank];
    const ctx = canvas.getContext("2d")!;
    // A canvas cannot read `var()`: a probe resolves each fill once.
    const probe = document.createElement("i");
    probe.style.display = "none";
    canvas.after(probe);
    const seen = new Map<string, string>();
    const solve = (css: string) => {
      let out = seen.get(css);
      if (out === undefined) {
        probe.style.color = css;
        seen.set(css, (out = getComputedStyle(probe).color));
      }
      return out;
    };
    function draw(): void {
      const [w, h, dpr] = [canvas.clientWidth, canvas.clientHeight, Math.min(2, devicePixelRatio || 1)];
      if (!w || !h) return;
      seen.clear();
      [canvas.width, canvas.height] = [Math.round(w * dpr), Math.round(h * dpr)];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cw = (w - (data.length - 1)) / data.length;
      const ch = (h - 23) / 24;
      data.forEach((col, c) => {
        const x = c * (cw + 1);
        col.forEach((v, hr) => {
          const y = hr * (ch + 1);
          if (v !== null && !Number.isNaN(v)) {
            ctx.fillStyle = solve(fill(v));
            ctx.fillRect(x, y, cw, ch);
          } else if (v === null && hatch) {
            // No readings: hatched, so it never reads as zero.
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, cw, ch);
            ctx.clip();
            ctx.strokeStyle = solve(HATCH);
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let d = -ch; d < cw + ch; d += 4) {
              ctx.moveTo(x + d, y + ch);
              ctx.lineTo(x + d + ch, y);
            }
            ctx.stroke();
            ctx.restore();
          }
        });
      });
    }
    const sizes = new ResizeObserver(draw);
    sizes.observe(canvas);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    draw();
    return () => {
      sizes.disconnect();
      theme.disconnect();
      probe.remove();
    };
  };
  let active = $state<[number, number] | null>(null);
  let pinned = $state(false);
  const n = $derived(cols.length);
  const dense = $derived(n >= 12 && cols.every((c) => c.tick));

  function at(e: PointerEvent): [number, number] {
    const r = grid!.getBoundingClientRect();
    return [Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))), Math.min(23, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * 24)))];
  }
  function key(e: KeyboardEvent): void {
    const [c, hr] = active ?? [n - 1, 12];
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) {
      pinned = true;
      active = active ? [Math.min(n - 1, Math.max(0, c + d[0]!)), Math.min(23, Math.max(0, hr + d[1]!))] : [c, hr];
    } else if (e.key === "Enter" && active) ondrill?.(active[0]);
    else if (e.key === "Escape" && active) {
      active = null;
      pinned = false;
    } else return;
    e.preventDefault();
  }
</script>

<div class="flex flex-col gap-2">
  <div class="flex h-7 items-center justify-between gap-3 pointer-coarse:h-10" aria-live="polite">
    <p class="min-w-0 truncate text-sm">
      {#if active}
        <span class="font-medium">{cols[active[0]]!.title} · {active[1]}–{active[1] + 1} Uhr</span>
        <span class="text-muted-foreground tabular-nums"> · {describe(cells[active[0]]![active[1]]!)}</span>
      {:else}<span class="text-muted-foreground">{idle}</span>{/if}
    </p>
    {#if active && pinned && ondrill}
      <Button variant="outline" size="sm" class="h-7 shrink-0 gap-1 px-2 text-xs pointer-coarse:h-10 pointer-coarse:px-3" onclick={() => ondrill(active![0])}>{drillLabel}<ArrowRight class="size-3.5" /></Button>
    {/if}
  </div>
  <div class="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-1">
    <div class="relative h-[216px] text-[11px] text-muted-foreground tabular-nums" aria-hidden="true">
      {#each [0, 6, 12, 18] as hr (hr)}
        <span class="absolute right-0 leading-none" style:top="{(hr / 24) * 100}%">{hr} h</span>
      {/each}
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={grid}
      class={["relative h-[216px] touch-pan-y outline-none select-none focus-visible:ring-2 focus-visible:ring-ring", ondrill && "cursor-pointer"]}
      role="group"
      tabindex="0"
      data-scrub
      aria-label="{label}. Pfeiltasten wählen eine Zelle, Eingabe öffnet die Spalte."
      onpointerdown={(e) => {
        if (e.pointerType !== "mouse") {
          pinned = true;
          active = at(e);
        }
      }}
      onpointermove={(e) => {
        if (e.pointerType === "mouse" || e.pressure > 0) active = at(e);
      }}
      onpointerleave={(e) => {
        if (e.pointerType === "mouse") active = null;
      }}
      onclick={() => {
        if (active && !pinned) ondrill?.(active[0]);
      }}
      onkeydown={key}
    >
      <!-- One canvas, not a cell per element: a month of hours is 744 of them, too many to mount inside a switch (ADR 21). -->
      <canvas class="absolute inset-0 size-full" {@attach paint}></canvas>
      {#if active}
        <span class="pointer-events-none absolute ring-2 ring-foreground" style:left="{(active[0] / n) * 100}%" style:width="{100 / n}%" style:top="{(active[1] / 24) * 100}%" style:height="{100 / 24}%"></span>
      {/if}
    </div>
    <span></span>
    <div class="flex h-4 text-[11px] leading-4 text-muted-foreground tabular-nums" aria-hidden="true">
      {#each cols as c, i (i)}
        <!-- Twelve month names do not fit a phone: every other one drops out there. -->
        <span class="relative flex-1">{#if c.tick}<span class={["absolute left-1/2 -translate-x-1/2 whitespace-nowrap", dense && i % 2 === 1 && "@max-[520px]:hidden"]}>{c.label}</span>{/if}</span>
      {/each}
    </div>
  </div>
</div>
