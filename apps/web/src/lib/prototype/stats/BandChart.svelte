<!--
  PROTOTYPE: the Statistics screen's bar chart. Stacked bars above and below one baseline, as plain
  elements placed and sized only by `transform`, on CSS transitions, so every change is interruptible
  and never touches layout (ADR 21). Bars, labels and gridlines are keyed by what they stand for:
  - bars are keyed by place: a new range moves each bar to its new value, place and width; a bar the
    new range has no place for shrinks to the baseline and fades (150 ms); an extra one grows in,
    staggered over 120 ms;
  - a drill or a brush (`via.kind === "zoom"`) is a FLIP along the time axis: the old bars spread out
    of the plot from the chosen span, the new ones start inside it;
  - a gridline keeps its value: it travels to that value's place on the new scale.
  The caller keeps it under about 62 bands. The legend is the readout: it shows the range's sums and,
  while a band is active, that band's values, so nothing floats under a finger.
  Mouse: hover reads, click opens the band, drag selects a span. Touch: tap or drag reads (the page
  still scrolls vertically), the readout's button opens. Keys: arrows move, Shift+arrows select,
  Enter opens, Escape clears.
-->
<script lang="ts" module>
  export interface Band {
    key: string;
    label: string;
    tick: boolean;
    title: string;
    state: "data" | "gap" | "live" | "future" | "before";
    partial: boolean;
    up: number[];
    down: number[];
    /** A reference value on the upper side: a forecast or last year's figure. */
    mark?: number | null | undefined;
    /** The upper side's expected height where the band has not happened yet. */
    ghost?: number | null | undefined;
    drillable: boolean;
  }
  export interface SeriesMeta {
    label: string;
    colour: string;
  }
  /** How the bands got here, from the screen: `id` changes with every change of range. */
  export interface Via {
    id: number;
    kind: "morph" | "zoom" | "none";
    /** Zoom: the inner range's span as shares of the outer range's plot. */
    a: number;
    b: number;
    /** Zoom: the new range lies inside the old one. */
    inward: boolean;
  }
  export interface Readout {
    title: string;
    up: number[];
    down: number[];
    mark?: number | null | undefined;
  }

  /** The smallest round number at or above `v`, whose half is round too. */
  export function niceCeil(v: number, fine = false): number {
    if (v <= 0) return 0;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of fine ? [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] : [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) if (m * p >= v * 1.04) return m * p;
    return 10 * p;
  }
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import { Button } from "#lib/components/ui/button/index.js";
  import AnimatedNumber from "../AnimatedNumber.svelte";
  import { getPane } from "./pane";
  import { Presence } from "./presence.svelte";
  import { motion } from "../motion/tier.svelte";
  import { haptics } from "../haptics";

  let {
    bands,
    up,
    down = [],
    groups = ["", ""],
    markLabel = "",
    ghostLabel = "",
    via,
    summary,
    fmt,
    axisFmt = (v: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(v),
    unit,
    max,
    height = 240,
    loading = false,
    drillLabel = "Öffnen",
    label,
    ondrill,
    onbrush,
  }: {
    bands: Band[];
    up: SeriesMeta[];
    down?: SeriesMeta[];
    /** What the upper and the lower side are, when both exist. */
    groups?: [string, string];
    markLabel?: string;
    /** What the faint bars of bands still to come are. */
    ghostLabel?: string;
    via?: Via | undefined;
    /** The whole range, shown while no band is active. */
    summary: Readout;
    fmt: (v: number) => string;
    axisFmt?: (v: number) => string;
    unit: string;
    /** A fixed top of the upper side, such as 100 %. */
    max?: number | undefined;
    height?: number;
    loading?: boolean;
    drillLabel?: string;
    label: string;
    ondrill?: ((index: number) => void) | undefined;
    onbrush?: ((from: number, to: number) => void) | undefined;
  } = $props();

  const add = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const upMax = $derived(max ?? (niceCeil(Math.max(0, ...bands.map((b) => Math.max(add(b.up), b.mark ?? 0, b.ghost ?? 0)))) || 1));
  const downMax = $derived(down.length ? niceCeil(Math.max(0, ...bands.map((b) => add(b.down))), true) : 0);
  const span = $derived(upMax + downMax);
  const zero = $derived((upMax / span) * 100);

  let plot = $state<HTMLElement | null>(null);
  let plotHeight = $state(0);
  let plotW = $state(0);
  // The 2 px of surface between stacked segments, as a share of the plot.
  const gap = $derived(plotHeight > 0 ? 2 / plotHeight : 0);

  // A pane that slides in is already moving: its bars are drawn in place.
  let instant = false;
  try {
    instant = getPane().instant;
  } catch {
    // Outside a pager: bars grow in.
  }

  /** The bar's box before its transform, and a mark's. */
  const BAR = 24;
  const MARK = 32;
  const slot = $derived(bands.length ? plotW / bands.length : 0);
  const bw = $derived(Math.min(BAR, Math.max(3, slot * 0.62)));

  const move = (top: number, size: number) => `translateY(${top.toFixed(3)}%) scaleY(${Math.max(0, size).toFixed(5)})`;
  function segs(b: Band): { colour: string; transform: string }[] {
    const out: { colour: string; transform: string }[] = [];
    let c = 0;
    b.up.forEach((v, i) => {
      out.push({ colour: up[i]!.colour, transform: move(((upMax - c - v) / span) * 100, v / span - (v > 0 ? gap : 0)) });
      c += v;
    });
    c = 0;
    b.down.forEach((v, i) => {
      out.push({ colour: down[i]!.colour, transform: `translateY(calc(${(((upMax + c) / span) * 100).toFixed(3)}% + 2px)) scaleY(${Math.max(0, v / span - (v > 0 ? gap : 0)).toFixed(5)})` });
      c += v;
    });
    return out;
  }

  interface View {
    key: string;
    b: Band;
    /** The bar's left edge and its width as a share of `BAR`; the band's centre; its slot's width. */
    x: number;
    sx: number;
    cx: number;
    slot: number;
    sy: number;
    segs: { colour: string; transform: string }[];
    ghost: string | null;
    /** Where an arriving bar starts. */
    x0: number;
    sx0: number;
    cx0: number;
    sy0: number;
    zoom: boolean;
  }
  const views = $derived(
    bands.map((b, i): View => {
      const cx = (i + 0.5) * slot;
      const x = cx - bw / 2;
      return {
        key: b.key,
        b,
        x,
        sx: bw / BAR,
        cx,
        slot,
        sy: 1,
        segs: b.state === "gap" ? [] : segs(b),
        ghost: b.ghost != null && b.ghost > 0 ? move(((upMax - b.ghost) / span) * 100, b.ghost / span) : null,
        x0: x,
        sx0: bw / BAR,
        cx0: cx,
        sy0: 0,
        zoom: false,
      };
    }),
  );

  interface Tick {
    key: string;
    v: number;
    y: number;
    y0: number;
    text: string;
  }
  const place = (v: number, top: number, whole: number) => ((top - v) / whole) * 100;
  const tickList = $derived(
    [upMax, upMax / 2, 0, ...(downMax > 0 ? [-downMax] : [])].map((v): Tick => ({ key: String(v), v, y: place(v, upMax, span), y0: place(v, upMax, span), text: v === 0 ? "0" : axisFmt(Math.abs(v)) })),
  );

  const bars = new Presence<View>();
  const ticks = new Presence<Tick>();
  let arrivals = $state(1);
  let seen = -1;
  let started = false;
  // A zoom replaces every bar; anything else keeps the bars in their places and moves them.
  let gen = 0;
  let scale: { upMax: number; span: number } | null = null;

  $effect.pre(() => {
    const [vs, ts, v, w, wait, top, whole] = [views, tickList, via, plotW, loading, upMax, span];
    untrack(() => {
      if (!w || wait) {
        bars.set([], (o) => o.key, { exit: 0 });
        return;
      }
      const changed = v !== undefined && v.id !== seen;
      seen = v?.id ?? -1;
      const zoom = started && changed && v!.kind === "zoom" ? v! : null;
      if (zoom) gen++;
      const keyed = vs.map((o) => ({ ...o, key: `${gen}:${o.key}` }));
      // The chosen span as a rect in the outer range's plot: `into` maps the plot into it, `outOf` back.
      const f = zoom ? Math.max(1 / 40, zoom.b - zoom.a) : 1;
      const a = zoom ? zoom.a * w : 0;
      const into = (x: number) => a + x * f;
      const outOf = (x: number) => (x - a) / f;
      const [enter, leave] = zoom?.inward ? [into, outOf] : [outOf, into];
      const [es, ls] = zoom?.inward ? [f, 1 / f] : [1 / f, f];
      arrivals = Math.max(
        1,
        bars.set(zoom ? keyed.map((o) => ({ ...o, x0: enter(o.x), sx0: o.sx * es, cx0: enter(o.cx), sy0: 1, zoom: true })) : keyed, (o) => o.key, {
          exit: zoom ? 300 : 150,
          enter: started || !instant,
          leave: (o) => (zoom ? { ...o, x: leave(o.x), sx: o.sx * ls, cx: leave(o.cx), zoom: true } : { ...o, sy: 0, zoom: false }),
        }),
      );
      // A gridline keeps its value: it arrives from that value's place on the old scale and leaves to its place on the new one.
      const old = scale;
      ticks.set(old ? ts.map((t) => ({ ...t, y0: place(t.v, old.upMax, old.span) })) : ts, (t) => t.key, { exit: 300, enter: started, leave: (t) => ({ ...t, y: place(t.v, top, whole) }) });
      scale = { upMax: top, span: whole };
      started = true;
    });
  });
  $effect(() => () => {
    bars.destroy();
    ticks.destroy();
  });

  const level = (v: number) => ((upMax - v) / span) * 100;
  const hasMarks = $derived(bands.some((b) => b.mark != null));
  const hasGhosts = $derived(bands.some((b) => b.ghost != null));

  // ── Reading, opening and selecting ──
  let active = $state<number | null>(null);
  let pinned = $state(false);
  let brush = $state<[number, number] | null>(null);
  let dragFrom: number | null = null;
  let dragged = false;

  const shown = $derived(active !== null && active < bands.length ? bands[active]! : null);
  const readout = $derived<Readout>(shown ? { title: shown.title, up: shown.up, down: shown.down, mark: shown.mark ?? (markLabel === ghostLabel ? shown.ghost : null) } : summary);
  const stateText = $derived(
    !shown ? "" : shown.state === "gap" ? "keine Daten" : shown.state === "future" ? (shown.ghost != null ? "Prognose" : "liegt in der Zukunft") : shown.state === "before" ? "vor der Aufzeichnung" : shown.state === "live" ? "läuft" : shown.partial ? "lückenhaft" : "",
  );
  const sel = $derived(brush ? ([Math.min(...brush), Math.max(...brush)] as const) : null);
  // Where the highlight last was and what the reference was called, so both fade out in place.
  let hlWas = $state(0);
  let markWas = $state("");
  $effect.pre(() => {
    if (active !== null) hlWas = active;
    if (markLabel) markWas = markLabel;
  });

  function at(e: PointerEvent): number {
    const r = plot!.getBoundingClientRect();
    return Math.min(bands.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * bands.length)));
  }
  function setActive(i: number | null): void {
    if (i !== active && i !== null && pinned) haptics.selection();
    active = i;
  }
  function down_(e: PointerEvent): void {
    const i = at(e);
    dragged = false;
    if (e.pointerType === "mouse") {
      if (e.button !== 0) return;
      dragFrom = i;
      plot!.setPointerCapture(e.pointerId);
    } else {
      pinned = true;
      setActive(i);
    }
  }
  function move_(e: PointerEvent): void {
    const i = at(e);
    if (e.pointerType !== "mouse") {
      if (e.buttons || e.pressure > 0) setActive(i);
      return;
    }
    setActive(i);
    if (dragFrom !== null && onbrush && (dragged || i !== dragFrom)) {
      dragged = true;
      brush = [dragFrom, i];
    }
  }
  function up_(e: PointerEvent): void {
    if (e.pointerType !== "mouse" || dragFrom === null) return;
    const from = dragFrom;
    dragFrom = null;
    if (dragged && sel && sel[1] > sel[0]) {
      onbrush?.(sel[0], sel[1]);
      brush = null;
    } else {
      brush = null;
      if (bands[from]?.drillable) ondrill?.(from);
    }
  }
  function key(e: KeyboardEvent): void {
    const last = bands.length - 1;
    const cur = active ?? Math.max(0, bands.findLastIndex((b) => b.state === "data" || b.state === "live"));
    const dir = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (dir) {
      const next = active === null ? cur : Math.min(last, Math.max(0, cur + dir));
      brush = e.shiftKey && onbrush ? [brush?.[0] ?? cur, next] : null;
      pinned = true;
      active = next;
    } else if (e.key === "Home" || e.key === "End") {
      pinned = true;
      active = e.key === "Home" ? 0 : last;
    } else if (e.key === "Enter" || e.key === " ") {
      if (sel && sel[1] > sel[0]) {
        onbrush?.(sel[0], sel[1]);
        brush = null;
      } else if (active !== null && bands[active]?.drillable) ondrill?.(active);
      else return;
    } else if (e.key === "Escape" && (active !== null || brush)) {
      active = null;
      brush = null;
      pinned = false;
    } else return;
    e.preventDefault();
  }
  function open(): void {
    if (active !== null) ondrill?.(active);
  }
</script>

{#snippet figure(v: number | null | undefined)}
  <!-- Reading a band is instant; a new range rolls. -->
  <AnimatedNumber value={loading || shown?.state === "gap" || shown?.state === "before" ? null : (v ?? 0)} format={fmt} placeholder="–" duration={shown ? 0 : 320} appear={false} />
{/snippet}

<div class="flex flex-col gap-2">
  <!-- Legend and readout in one: sized for its fullest state, so reading a band shifts nothing. -->
  <div class="flex min-h-[4.5rem] flex-col gap-1 pointer-coarse:min-h-[5.25rem]" aria-live="polite">
    <div class="flex h-7 items-center justify-between gap-3 pointer-coarse:h-10">
      <p class="min-w-0 truncate text-sm font-medium">
        {readout.title}{#if stateText}<span class="font-normal text-muted-foreground"> · {stateText}</span>{/if}
      </p>
      {#if shown?.drillable && ondrill && (pinned || sel)}
        <Button variant="outline" size="sm" class="h-7 shrink-0 gap-1 px-2 text-xs pointer-coarse:h-10 pointer-coarse:px-3" onclick={open}>{drillLabel}<ArrowRight class="size-3.5" /></Button>
      {/if}
    </div>
    {#each [{ name: groups[0], series: up, values: readout.up, mark: true }, { name: groups[1], series: down, values: readout.down, mark: false }] as g (g.name + g.series.length)}
      {#if g.series.length}
        <!-- Narrow: two columns, the upper side's row above the lower side's, as in the plot. -->
        <dl class="grid grid-cols-2 items-baseline gap-x-3 gap-y-0.5 text-xs @[520px]:flex @[520px]:flex-wrap @[520px]:gap-x-4">
          {#if g.name}<dt class="hidden w-[4.75rem] shrink-0 text-muted-foreground @[520px]:block">{g.name}</dt>{/if}
          {#each g.series as s, i (s.label)}
            <div class="flex min-w-0 items-baseline gap-1.5">
              <span class="size-2 shrink-0 translate-y-[-1px] rounded-[1px]" style:background={s.colour}></span>
              <dt class="truncate text-muted-foreground">{s.label}</dt>
              <dd class="font-semibold whitespace-nowrap tabular-nums">{@render figure(g.values[i])}</dd>
            </div>
          {/each}
          {#if g.mark && !loading && (markLabel || markWas)}
            <!-- Always in the row, so a comparison that comes or goes fades instead of reflowing it. -->
            <div class={["key flex items-baseline gap-1.5", !(markLabel && hasMarks) && "off"]} aria-hidden={!(markLabel && hasMarks)}>
              <span class="h-0.5 w-2.5 shrink-0 translate-y-[-3px] bg-foreground"></span>
              <dt class="text-muted-foreground">{markLabel || markWas}</dt>
              {#if readout.mark != null && hasMarks}<dd class="font-semibold whitespace-nowrap tabular-nums">{@render figure(readout.mark)}</dd>{/if}
            </div>
            {#if ghostLabel && hasGhosts && !(markLabel === ghostLabel && hasMarks)}
              <div class="flex items-baseline gap-1.5">
                <span class="size-2 shrink-0 translate-y-[-1px] rounded-[1px] opacity-30" style:background={up[0]!.colour}></span>
                <dt class="text-muted-foreground">{ghostLabel}</dt>
                {#if shown?.ghost != null}<dd class="font-semibold whitespace-nowrap tabular-nums">{fmt(shown.ghost)}</dd>{/if}
              </div>
            {/if}
          {/if}
        </dl>
      {/if}
    {/each}
  </div>

  <div class={["grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-1", motion.still && "still"]}>
    <div class="axis relative text-[11px] text-muted-foreground tabular-nums" style:height="{height}px" aria-hidden="true">
      {#each ticks.list as t (t.key)}
        <span class={["tick", t.out && "out", t.fresh >= 0 && "fresh"]} style:transform="translateY({t.item.y.toFixed(3)}%)" style:--y0="{t.item.y0.toFixed(3)}%">
          <span class="absolute top-0 right-0 -translate-y-1/2 leading-none">{t.item.text}</span>
        </span>
      {/each}
      <span class="absolute top-3 right-0 leading-none opacity-70">{unit}</span>
    </div>

    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={plot}
      bind:clientHeight={plotHeight}
      bind:clientWidth={plotW}
      class={["plot relative touch-pan-y overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-ring", shown?.drillable && ondrill && "cursor-pointer"]}
      style:height="{height}px"
      style:--zero="{zero}%"
      role="group"
      tabindex="0"
      data-scrub
      aria-label="{label}. Pfeiltasten wählen einen Abschnitt, Umschalt und Pfeiltasten einen Bereich, Eingabe öffnet."
      onpointerdown={down_}
      onpointermove={move_}
      onpointerup={up_}
      onpointerleave={(e) => {
        if (e.pointerType === "mouse" && dragFrom === null) setActive(null);
      }}
      onkeydown={key}
      onblur={() => {
        if (!pinned) active = null;
      }}
    >
      {#each ticks.list as t (t.key)}
        <span class={["tick", t.out && "out", t.fresh >= 0 && "fresh"]} style:transform="translateY({t.item.y.toFixed(3)}%)" style:--y0="{t.item.y0.toFixed(3)}%">
          <span class={["absolute inset-x-0 top-0 h-px", t.item.v === 0 ? "bg-foreground/30" : "bg-foreground/[0.07]"]}></span>
        </span>
      {/each}

      {#if loading}
        <div class="absolute inset-0 flex animate-pulse motion-reduce:animate-none" aria-hidden="true">
          {#each { length: 14 } as _, i (i)}
            <span class="relative flex-1"><span class="absolute bottom-[30%] left-1/2 w-[62%] max-w-6 -translate-x-1/2 bg-foreground/10" style:height="{18 + ((i * 37) % 45)}%"></span></span>
          {/each}
        </div>
      {:else}
        <!-- The band being read, and a span being selected: one box each, moved over the bands. -->
        <span class="hl" style:opacity={active === null ? 0 : 1} style:transform="translateX({((active ?? hlWas) * slot).toFixed(2)}px) scaleX({(slot / 100).toFixed(4)})"></span>
        {#if sel}
          <span class="brush bg-brand-soft ring-1 ring-brand/50 ring-inset" style:transform="translateX({(sel[0] * slot).toFixed(2)}px)" style:width="{((sel[1] - sel[0] + 1) * slot).toFixed(2)}px"></span>
        {/if}
        {#each bars.list as k (k.key)}
          {@const o = k.item}
          {#if o.b.state === "gap"}
            <span class={["gap hatch", k.out && "out", k.fresh >= 0 && "fresh"]} style:width="{(o.slot * 0.76).toFixed(2)}px" style:transform="translateX({(o.cx - o.slot * 0.38).toFixed(2)}px)" style:--x0="{(o.cx0 - o.slot * 0.38).toFixed(2)}px"></span>
          {:else}
            <span
              class={["bar", k.out && "out", k.fresh >= 0 && "fresh", o.zoom && "zoom"]}
              style:transform="translateX({o.x.toFixed(2)}px) scaleX({o.sx.toFixed(4)}) scaleY({o.sy})"
              style:--x0="{o.x0.toFixed(2)}px"
              style:--sx0={o.sx0.toFixed(4)}
              style:--sy0={o.sy0}
              style:--delay="{k.fresh > 0 && !o.zoom ? Math.round((k.fresh / arrivals) * 120) : 0}ms"
            >
              {#if o.ghost}<span class="seg opacity-30" style:background={up[0]!.colour} style:transform={o.ghost}></span>{/if}
              {#each o.segs as g, j (j)}
                <span class="seg" style:background={g.colour} style:transform={g.transform}></span>
              {/each}
            </span>
            <!-- A reference on the upper side: it draws across the bar as it appears and fades as it goes. -->
            {@const on = o.b.mark != null && o.b.state !== "future" && o.b.state !== "before" && !k.out}
            {@const mw = Math.min(MARK, o.slot * 0.84)}
            <span class={["mark", on && "on"]} style:opacity={on ? 1 : 0} style:transform="translate({(o.cx - mw / 2).toFixed(2)}px, {level(o.b.mark ?? 0).toFixed(3)}%) scaleX({on ? (mw / MARK).toFixed(4) : 0})">
              <span class="absolute top-0 left-0 h-0.5 w-full -translate-y-1/2 bg-foreground/70"></span>
            </span>
            {#if o.b.partial}<span class={["gap hatch bottom-0 h-1.5", k.out && "out"]} style:top="auto" style:width="{(o.slot * 0.76).toFixed(2)}px" style:transform="translateX({(o.cx - o.slot * 0.38).toFixed(2)}px)"></span>{/if}
          {/if}
        {/each}
      {/if}
    </div>

    <span></span>
    <div class="labels relative h-4 text-[11px] leading-4 text-muted-foreground tabular-nums" aria-hidden="true">
      {#if !loading}
        {#each bars.list as k (k.key)}
          {@const o = k.item}
          {#if o.b.state === "live" && !o.b.tick}
            <!-- The running band: it grows with the live stream. -->
            <span class={["label", k.out && "out", k.fresh >= 0 && "fresh"]} style:transform="translateX({o.cx.toFixed(2)}px)" style:--x0="{o.cx0.toFixed(2)}px">
              <span class="absolute top-1 left-0 size-1.5 -translate-x-1/2 rounded-full bg-success text-success animate-pulse-dot motion-reduce:animate-none"></span>
            </span>
          {:else if o.b.tick}
            <span class={["label", k.out && "out", k.fresh >= 0 && "fresh"]} style:transform="translateX({o.cx.toFixed(2)}px)" style:--x0="{o.cx0.toFixed(2)}px">
              <span class={["absolute left-0 -translate-x-1/2 whitespace-nowrap", (shown === o.b || o.b.state === "live") && "font-medium text-foreground"]}>{o.b.label}</span>
            </span>
          {/if}
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .plot,
  .axis,
  .labels {
    --move: var(--motion-move) var(--motion-ease-in-out);
  }
  /* Labels sit half outside their edge; what travels beyond is cut, statically. */
  .axis {
    clip-path: inset(-0.5rem 0);
  }
  .labels {
    clip-path: inset(0 -1rem);
  }

  /* A bar: a 24 px box at the plot's origin, placed and sized by its transform. */
  .bar {
    position: absolute;
    inset: 0 auto 0 0;
    width: 24px;
    transform-origin: 0 var(--zero);
    transition:
      transform var(--move),
      opacity var(--move);
  }
  /* Arriving: grown from the baseline beside the bars that move, each a little after the one before. */
  .bar.fresh {
    transition:
      transform var(--move) var(--delay),
      opacity var(--move) var(--delay);
  }
  /* Leaving: shorter than the entrance, on ease-in. */
  .bar.out {
    opacity: 0;
    transition:
      transform 150ms ease-in,
      opacity 150ms ease-in;
  }
  /* A zoom is a movement between two places: both sides travel on ease-in-out. */
  .bar.zoom {
    transition:
      transform var(--move),
      opacity var(--move);
  }
  @starting-style {
    .bar.fresh {
      transform: translateX(var(--x0)) scaleX(var(--sx0)) scaleY(var(--sy0));
      opacity: 0;
    }
  }
  .seg {
    position: absolute;
    inset: 0;
    transform-origin: top;
    transition: transform var(--move);
  }

  .mark {
    position: absolute;
    inset: 0 auto 0 0;
    width: 32px;
    transform-origin: 0 0;
    pointer-events: none;
    transition:
      transform var(--move),
      opacity 200ms var(--motion-ease);
  }
  /* A reference draws in once its bar is nearly there. */
  .mark.on {
    transition:
      transform var(--move),
      opacity 200ms var(--motion-ease) 140ms;
  }
  @starting-style {
    .mark {
      opacity: 0;
    }
  }
  .key {
    transition: opacity 200ms var(--motion-ease);
  }
  .key.off {
    opacity: 0;
  }

  .tick {
    position: absolute;
    inset: 0;
    pointer-events: none;
    transition:
      transform var(--move),
      opacity 200ms var(--motion-ease);
  }
  .tick.out {
    opacity: 0;
  }
  @starting-style {
    .tick.fresh {
      transform: translateY(var(--y0));
      opacity: 0;
    }
  }

  .label {
    position: absolute;
    inset: 0 auto 0 0;
    transition:
      transform var(--move),
      opacity 200ms var(--motion-ease);
  }
  .label.out,
  .gap.out {
    opacity: 0;
    transition:
      transform var(--move),
      opacity 150ms ease-in;
  }
  @starting-style {
    .label.fresh,
    .gap.fresh {
      transform: translateX(var(--x0));
      opacity: 0;
    }
  }

  /* No readings: hatched, so it never reads as zero. Its stripes must not stretch: it is placed, not scaled. */
  .gap {
    position: absolute;
    inset: 0 auto 0 0;
    transition:
      transform var(--move),
      opacity 200ms var(--motion-ease);
  }
  .hatch {
    background: repeating-linear-gradient(135deg, color-mix(in oklab, var(--foreground) 22%, transparent) 0 1px, transparent 1px 5px);
  }

  /* The band under the pointer: eased, so reading across the bars does not flicker. */
  .hl {
    position: absolute;
    inset: 0 auto 0 0;
    width: 100px;
    transform-origin: 0 0;
    pointer-events: none;
    background: color-mix(in oklab, var(--foreground) 7%, transparent);
    transition:
      transform 100ms var(--motion-ease),
      opacity 100ms var(--motion-ease);
  }
  .brush {
    position: absolute;
    inset: 0 auto 0 0;
    pointer-events: none;
  }

  .still :is(.bar, .seg, .mark, .tick, .label, .gap, .hl) {
    transition: none;
  }
</style>
