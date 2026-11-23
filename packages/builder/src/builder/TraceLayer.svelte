<!--
  A traced roof's lines and points over the canvas (ADR 20), its bent faces in the warning colour,
  the line being drawn from the last click to the pointer's snap, and beside the pointer a chip
  naming the snap and the line's length.
  It never takes the pointer: the canvas beneath traces.
-->
<script lang="ts">
  import { bent, type Refusal, type Snap } from "@sunreye/scene";
  import { getLocale } from "../paraglide/runtime.js";
  import { m } from "../paraglide/messages.js";
  import type { Projector } from "./drawing.svelte.ts";
  import { pvPoint } from "./trace-aim.ts";
  import type { Shown, Tracing } from "./tracing.svelte.ts";

  let {
    tracing,
    shown,
    project,
  }: {
    tracing: Tracing;
    shown: Shown;
    /** Where a point of the scene lands on the canvas, as last drawn. */
    project: Projector;
  } = $props();

  const north = $derived(tracing.scene.north);

  /** A scene spot on the canvas; null behind the camera. */
  const at = (spot: readonly number[]) => project(pvPoint(north, spot));

  /** A stroke on the canvas: a traced line, the picked one stronger, or a dashed one being drawn
   * or dragged. */
  interface Stroke {
    readonly key: string;
    readonly from: readonly [number, number];
    readonly to: readonly [number, number];
    readonly colour: string;
    readonly width: number;
    readonly dash: string;
  }

  const traced = $derived(
    tracing.scene.blocks.flatMap((block, index): Stroke[] => {
      const lines = block.freeForm?.traced;

      if (!lines) return [];

      const points = lines.points.map((point) => at(point));

      return lines.lines.flatMap(([a = 0, b = 0], line) => {
        const [from, to] = [points[a], points[b]];
        const picked = tracing.line?.block === index && tracing.line.line === line;

        const look = picked
          ? { colour: "var(--destructive)", width: 4 }
          : { colour: "var(--brand)", width: 2.5 };

        return from && to ? [{ key: `${index}/${line}`, from, to, dash: "", ...look }] : [];
      });
    }),
  );

  /** Each bent face's corners on the canvas, as an SVG polygon's points. */
  const bentFaces = $derived(
    tracing.scene.blocks.flatMap((block, index) =>
      bent(tracing.scene, index).flatMap((face) => {
        const on = (block.freeForm?.faces[face] ?? []).map((corner) => at(corner));

        return on.every((p) => p !== null)
          ? [{ key: `${index}/${face}`, points: on.map(([x, y]) => `${x},${y}`).join(" ") }]
          : [];
      }),
    ),
  );

  const corners = $derived(
    tracing.scene.blocks.flatMap((block) =>
      (block.freeForm?.traced?.points ?? []).flatMap((point) => {
        const on = at(point);

        return on ? [on] : [];
      }),
    ),
  );

  const NAMES: Readonly<Record<Snap["kind"], () => string>> = {
    point: m.builder_snap_point,
    line: m.builder_snap_line,
    free: () => "",
  };

  const REFUSALS: Readonly<Record<Refusal, () => string>> = {
    short: m.builder_trace_short,
    joins: m.builder_trace_joins,
    crosses: m.builder_trace_crosses,
    missing: m.builder_trace_missing,
  };

  const metres = $derived(
    new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  );

  const drawing = $derived.by(() => {
    const { from, snap } = shown;
    const a = from && at(from);
    const b = snap && at(snap.at);
    const length = from && snap && Math.hypot(...snap.at.map((v, i) => v - (from[i] ?? 0)));

    return a && b && length !== undefined ? { a, b, length } : undefined;
  });

  const ring = $derived(shown.snap && shown.snap.kind !== "free" ? at(shown.snap.at) : null);

  /** The line being drawn and the line being dragged, dashed. */
  const dashed = $derived.by((): Stroke[] => {
    const moved = shown.dragged && [at(shown.dragged.from), at(shown.dragged.to)];
    const [from, to] = moved ?? [];
    const look = { colour: "var(--brand)", dash: "6 4" };
    const drag = from && to ? [{ key: "dragged", from, to, width: 3, ...look }] : [];

    const line = drawing
      ? [{ key: "drawing", from: drawing.a, to: drawing.b, width: 2, ...look }]
      : [];

    return [...line, ...drag];
  });

  const chip = $derived.by(() => {
    const words = [
      drawing && `${metres.format(drawing.length)} m`,
      shown.snap && NAMES[shown.snap.kind](),
      shown.refused && REFUSALS[shown.refused](),
    ].filter((word) => word !== undefined && word !== "");

    return shown.pointer && words.length > 0
      ? { text: words.join(" · "), at: shown.pointer }
      : null;
  });
</script>

<svg class="pointer-events-none absolute inset-0 size-full" aria-label={m.builder_trace_lines()}>
  {#each bentFaces as { key, points } (key)}
    <polygon
      {points}
      fill="var(--warning)"
      fill-opacity="0.35"
      stroke="var(--warning)"
      stroke-width="2"
    />
  {/each}
  {#each [...traced, ...dashed] as { key, from, to, colour, width, dash } (key)}
    <line
      x1={from[0]}
      y1={from[1]}
      x2={to[0]}
      y2={to[1]}
      stroke={colour}
      stroke-width={width}
      stroke-dasharray={dash}
      stroke-linecap="round"
    />
  {/each}
  {#each corners as [x, y], i (i)}
    <circle cx={x} cy={y} r="3.5" fill="var(--background)" stroke="var(--brand)" stroke-width="2" />
  {/each}
  {#each ring ? [ring] : [] as [x, y] (`${x},${y}`)}
    <circle cx={x} cy={y} r="8" fill="none" stroke="var(--brand)" stroke-width="2" />
  {/each}
</svg>
{#if chip}
  <!-- The same canvas chip as a handle's live value; it never takes the pointer. -->
  <output
    class="canvas-chip pointer-events-none absolute flex h-7 translate-x-3.5 -translate-y-full items-center rounded-md px-2 text-xs whitespace-nowrap tabular-nums ring-1 ring-border/60 elevation-1"
    style:left="{chip.at[0]}px"
    style:top="{chip.at[1] - 8}px">{chip.text}</output
  >
{/if}
