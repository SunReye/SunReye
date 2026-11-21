<!--
  The lanes of a chart on one canvas (ADR 22), with each lane's unit and figures left of it and
  the time labels under it. The pointer and a span being selected are elements over the canvas,
  so reading the chart never redraws it. Filling, the plot takes the room its parent leaves and
  says how much that is; the chart is then drawn in it.
-->
<script lang="ts">
  import ChartEntrance from "../chart-entrance/ChartEntrance.svelte";
  import type { Attachment } from "svelte/attachments";
  import LaneAxis from "./LaneAxis.svelte";
  import { paintScene } from "./paint.ts";
  import ReadingRule from "../chart-reading/ReadingRule.svelte";
  import type { Pointer } from "./pointer.ts";
  import { sceneOf } from "./scene.ts";
  import { scenesOf, type Chart } from "./series-chart.ts";


  let {
    chart,
    label,
    pointer,
    fill = false,
    room = $bindable(0),
  }: {
    chart: Chart;
    /** The plot's name, with the keys that read it. */
    label: string;
    pointer: Pointer;
    /** Whether the plot takes its parent's room, a flex column, instead of the chart's height. */
    fill?: boolean | undefined;
    /** The plot's height as laid out, in px. */
    room?: number;
  } = $props();

  let width = $state(0);

  const scene = $derived(
    sceneOf(scenesOf(chart.lanes), { from: chart.from, to: chart.to, width }),
  );

  /** Draws the lanes; again when they, the size or the theme change. */
  const paint: Attachment<HTMLCanvasElement> = (canvas) => paintScene(canvas, scene);

  const share = (t: number) => ((t - chart.from) / (chart.to - chart.from)) * 100;

  const brush = $derived.by(() => {
    if (!pointer.brush) return null;

    const [a, b] = [share(Math.min(...pointer.brush)), share(Math.max(...pointer.brush))];

    return { left: `${a}%`, width: `${b - a}%` };
  });
</script>

<!-- The row's least is the chart's, never its height: a row as tall as its chart could not shrink. -->
<div
  class={["grid grid-cols-[3rem_minmax(0,1fr)] gap-x-1.5", fill && "flex-1"]}
  style:grid-template-rows={fill ? `minmax(${chart.least}px, 1fr) auto` : null}
>
  <LaneAxis lanes={chart.lanes} height={fill ? null : chart.height} />

  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    bind:clientWidth={width}
    bind:clientHeight={room}
    class="relative cursor-crosshair touch-pan-y overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
    style:height={fill ? null : `${chart.height}px`}
    role="group"
    tabindex="0"
    data-scrub
    aria-label={label}
    {...pointer.on}
  >
    <ChartEntrance build="draw" ready={width > 0} class="absolute inset-0">
      <canvas class="absolute inset-0 size-full" aria-hidden="true" {@attach paint}></canvas>
    </ChartEntrance>
    {#each chart.lanes as lane (lane.lane.key)}
      <div
        class="pointer-events-none absolute inset-x-0"
        style:top="{lane.box.top}px"
        style:height="{lane.box.height}px"
        role="img"
        aria-label={lane.label}
      ></div>
    {/each}
    {#if brush}
      <span
        class="pointer-events-none absolute inset-y-0 bg-brand-soft ring-1 ring-brand/50 ring-inset"
        style:left={brush.left}
        style:width={brush.width}
      ></span>
    {/if}
    {#if pointer.at !== null}
      <ReadingRule share={share(pointer.at) / 100} />
    {/if}
  </div>

  <span></span>
  <div
    class="relative mt-0.5 h-[1.375rem] text-[11px] leading-4 text-muted-foreground tabular-nums"
    aria-hidden="true"
  >
    {#each chart.times as time (time.key)}
      <span class="absolute whitespace-nowrap" style:left="{time.x}%">{time.text}</span>
    {/each}
  </div>
</div>
