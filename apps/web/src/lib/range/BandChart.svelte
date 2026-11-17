<!--
  The range's bar chart (History, Forecast, Tariff and the detail sheets). Stacked bars above and
  below one baseline, as plain elements placed and sized only by `transform`, on CSS transitions,
  so every change is interruptible and never touches layout (ADR 21). Bars, labels and gridlines
  are keyed by what they stand for:
  - bars are keyed by place: a new range moves each bar to its new value, place and width; a bar the
    new range has no place for shrinks to the baseline and fades (150 ms); an extra one grows in,
    staggered over 120 ms;
  - a drill or a brush (`via.kind === "zoom"`) is a FLIP along the time axis: the old bars spread out
    of the plot from the chosen span, the new ones start inside it;
  - a gridline keeps its value: it travels to that value's place on the new scale.
  A line layer draws a dashed curve through the bands' `line` points, such as today's forecast.
  The caller keeps it under about 62 bands. The legend is the readout: it shows the range's sums and,
  while a band is active, that band's values, so nothing floats under a finger (`reading.svelte.ts`).
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { motion } from "../motion/tier.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import {
    lineOf,
    place,
    scaleOf,
    stateText,
    ticksOf,
    viewsOf,
    moves,
    type Band,
    type Readout,
    type SeriesMeta,
    type Tick,
    type View,
    type Via,
  } from "./bands.ts";
  import BandBar from "./BandBar.svelte";
  import BandLabel from "./BandLabel.svelte";
  import BandLegend, { type Legend } from "./BandLegend.svelte";
  import BandTicks from "./BandTicks.svelte";
  import { Presence, type Kept } from "./presence.svelte.ts";
  import { Reading } from "./reading.svelte.ts";

  let {
    bands,
    up,
    down = [],
    groups = ["", ""],
    markLabel = "",
    ghostLabel = "",
    lineLabel = "",
    gapLabel = m.range_no_data(),
    via,
    summary,
    fmt,
    axisFmt,
    unit,
    max,
    height = 240,
    loading = false,
    drillLabel = m.range_open(),
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
    /** What the dashed line over the bars is. */
    lineLabel?: string;
    /** What a hatched band is. */
    gapLabel?: string;
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

  const scale = $derived(scaleOf(bands, down.length > 0, max));
  const upMax = $derived(scale.upMax);
  const zero = $derived(scale.zero);

  let plot = $state<HTMLElement | null>(null);
  let plotHeight = $state(0);
  let plotW = $state(0);

  const slot = $derived(bands.length > 0 ? plotW / bands.length : 0);
  const colours = $derived([up.map((s) => s.colour), down.map((s) => s.colour)] as const);
  const views = $derived(viewsOf(bands, colours, scale, plotW, plotHeight));
  const tickList = $derived(ticksOf(scale, axisFmt));

  const bars = new Presence<View>();
  const ticks = new Presence<Tick>();
  let arrivals = $state(1);
  let seen = -1;
  let started = false;

  // A zoom replaces every bar; anything else keeps the bars in their places and moves them.
  let gen = 0;
  let was: { upMax: number; span: number } | null = null;

  function placeBars(vs: readonly View[], v: Via | undefined, w: number): void {
    const zoom = started && v !== undefined && v.id !== seen && v.kind === "zoom" ? v : null;

    seen = v?.id ?? -1;

    if (zoom) gen++;

    const move = moves(vs, zoom, w, gen);

    arrivals = Math.max(
      1,
      bars.set(move.items, (o) => o.key, { exit: move.exit, enter: true, leave: move.leave }),
    );
  }

  /** A gridline keeps its value: it arrives from its place on the old scale and leaves to its place on the new one. */
  function placeTicks(ts: readonly Tick[], top: number, whole: number): void {
    const old = was;

    ticks.set(
      old ? ts.map((t) => Object.assign({}, t, { y0: place(t.v, old.upMax, old.span) })) : [...ts],
      (t) => t.key,
      {
        exit: 300,
        enter: started,
        leave: (t) => Object.assign({}, t, { y: place(t.v, top, whole) }),
      },
    );
    was = { upMax: top, span: whole };
  }

  $effect.pre(() => {
    const [vs, ts, v, w, wait, top, whole] = [
      views,
      tickList,
      via,
      plotW,
      loading,
      scale.upMax,
      scale.span,
    ];

    untrack(() => {
      if (w === 0 || wait) {
        bars.set([], (o) => o.key, { exit: 0 });

        return;
      }

      placeBars(vs, v, w);
      placeTicks(ts, top, whole);
      started = true;
    });
  });

  $effect(() => () => {
    bars.destroy();
    ticks.destroy();
  });

  const level = (v: number) => ((upMax - v) / scale.span) * 100;
  const hasMarks = $derived(bands.some((b) => (b.mark ?? null) !== null));
  const hasGhosts = $derived(bands.some((b) => (b.ghost ?? null) !== null));

  const linePath = $derived(loading ? null : lineOf(bands, scale, plotW, plotHeight));

  const reading = new Reading(() => ({ bands, plot, ondrill, onbrush }));
  const active = $derived(reading.active);
  const sel = $derived(reading.sel);
  const shown = $derived(active !== null && active < bands.length ? bands[active]! : null);

  const readout = $derived<Readout>(
    shown
      ? {
          title: shown.title,
          up: shown.up,
          down: shown.down,
          mark: shown.mark ?? (markLabel === ghostLabel ? shown.ghost : null),
          ghost: shown.ghost,
          line: shown.line,
        }
      : summary,
  );

  // What the reference was last called, so it fades out in place. A plain memory, not state:
  // only the derived reads it.
  let markWas = "";

  const markName = $derived.by(() => {
    if (markLabel) markWas = markLabel;

    return markWas;
  });

  // Where the highlight last was, so it fades out in place.
  let hlWas = 0;

  const hlAt = $derived.by(() => {
    if (active !== null) hlWas = active;

    return hlWas;
  });

  const markOf = (): Legend["mark"] => {
    if (loading || !markName) return null;

    const on = markLabel !== "" && hasMarks;

    return { label: markName, on, value: on ? (readout.mark ?? null) : null };
  };

  const ghostOf = (): Legend["ghost"] => {
    if (!ghostLabel || !hasGhosts || (markLabel === ghostLabel && hasMarks)) return null;

    return { label: ghostLabel, colour: up[0]?.colour ?? "", value: readout.ghost ?? null };
  };

  const hl = $derived({
    opacity: active === null ? 0 : 1,
    transform: `translateX(${(hlAt * slot).toFixed(2)}px) scaleX(${(slot / 100).toFixed(4)})`,
  });

  const brushBox = $derived(
    sel
      ? {
          transform: `translateX(${(sel[0] * slot).toFixed(2)}px)`,
          width: `${((sel[1] - sel[0] + 1) * slot).toFixed(2)}px`,
        }
      : null,
  );

  const ghostColour = $derived(up[0]?.colour ?? "");

  /** The band being read and the running one carry their label in full. */
  const strong = (k: Kept<View>) => shown === k.item.b || k.item.b.state === "live";

  /** An arriving bar waits its turn in the stagger; a zoom moves every bar at once. */
  const delayOf = (k: Kept<View>) =>
    k.fresh > 0 && !k.item.zoom ? Math.round((k.fresh / arrivals) * 120) : 0;

  const legend = $derived<Legend>({
    title: readout.title,
    status: stateText(shown),
    open: shown?.drillable === true && ondrill !== undefined && (reading.pinned || sel !== null),
    rows: [
      { side: "up" as const, name: groups[0], series: up, values: readout.up, mark: true },
      { side: "down" as const, name: groups[1], series: down, values: readout.down, mark: false },
    ].filter((row) => row.series.length > 0),
    mark: markOf(),
    ghost: markOf() ? ghostOf() : null,
    line:
      lineLabel && linePath
        ? { label: lineLabel, colour: up[0]?.colour ?? "", value: readout.line ?? null }
        : null,
    gap: !loading && bands.some((b) => b.state === "gap") ? gapLabel : null,
    blank: loading || shown?.state === "gap" || shown?.state === "before",
    // A band still to come has its forecast, but nothing measured yet.
    unmeasured: shown?.state === "future",
    duration: shown ? 0 : 320,
  });
</script>

{#snippet skeleton()}
  <div class="absolute inset-0 flex animate-pulse motion-reduce:animate-none" aria-hidden="true">
    {#each { length: 14 } as _, i (i)}
      <span class="relative flex-1"
        ><span
          class="absolute bottom-[30%] left-1/2 w-[62%] max-w-6 -translate-x-1/2 bg-foreground/10"
          style:height="{18 + ((i * 37) % 45)}%"
        ></span></span
      >
    {/each}
  </div>
{/snippet}

<!-- The band being read, and a span being selected: one box each, moved over the bands. -->
{#snippet overlays()}
  <span class="hl" style:opacity={hl.opacity} style:transform={hl.transform}></span>
  {#if brushBox}
    <span
      class="brush bg-brand-soft ring-1 ring-brand/50 ring-inset"
      style:transform={brushBox.transform}
      style:width={brushBox.width}
    ></span>
  {/if}
{/snippet}

<div class="flex flex-col gap-2">
  <BandLegend {legend} {fmt} {drillLabel} onopen={reading.open} />

  <div class={["grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-1", motion.still && "still"]}>
    <!-- Above the top gridline's figure, which sits half above the plot. -->
    <span class="mb-2.5 text-right text-[11px] leading-none text-muted-foreground opacity-70"
      >{unit}</span
    >
    <span></span>
    <div
      class="axis relative text-[11px] text-muted-foreground tabular-nums"
      style:height="{height}px"
      aria-hidden="true"
    >
      <BandTicks list={ticks.list} axis />
    </div>

    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={plot}
      bind:clientHeight={plotHeight}
      bind:clientWidth={plotW}
      class={[
        "plot relative touch-pan-y overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
        legend.open && "cursor-pointer",
      ]}
      style:height="{height}px"
      style:--zero="{zero}%"
      role="group"
      tabindex="0"
      data-scrub
      data-vaul-no-drag={active === null ? undefined : ""}
      aria-label={m.range_chart_keys({ chart: label })}
      onpointerdown={reading.down}
      onpointermove={reading.move}
      onpointerup={reading.up}
      onpointerleave={reading.leave}
      onpointercancel={reading.cancel}
      onkeydown={reading.key}
      onblur={reading.blur}
    >
      <BandTicks list={ticks.list} />
      {#if loading}
        {@render skeleton()}
      {:else}
        {@render overlays()}
        {#each bars.list as k (k.key)}
          <BandBar {k} ghost={ghostColour} {level} delay={delayOf(k)} />
        {/each}
        {#if linePath}
          <svg class="line" viewBox="0 0 {plotW} {plotHeight}" aria-hidden="true">
            <path
              d={linePath}
              stroke={ghostColour}
              fill="none"
              opacity="0.55"
              stroke-width="1.5"
              stroke-dasharray="3 4"
            />
          </svg>
        {/if}
      {/if}
    </div>

    <span></span>
    <div
      class="labels relative mt-0.5 h-[1.375rem] text-[11px] leading-4 text-muted-foreground tabular-nums"
      aria-hidden="true"
    >
      {#each bars.list as k (k.key)}
        <BandLabel {k} strong={strong(k)} />
      {/each}
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

  /* The band under the pointer: eased, so reading across the bars does not flicker. */
  .hl {
    position: absolute;
    inset: 0 auto 0 0;
    width: 100px;
    transform-origin: 0 0;
    pointer-events: none;
    background: color-mix(in oklab, var(--foreground) 11%, transparent);
    transition:
      transform 100ms var(--motion-ease),
      opacity 100ms var(--motion-ease);
  }
  .line {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .brush {
    position: absolute;
    inset: 0 auto 0 0;
    pointer-events: none;
  }

  .still .hl {
    transition: none;
  }
</style>
