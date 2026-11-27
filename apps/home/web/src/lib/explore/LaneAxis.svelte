<!-- Left of the lanes: each lane's unit at its top, and its axis' figures at their gridlines. -->
<script lang="ts">
  import type { LaneView } from "./series-chart.ts";

  let {
    lanes,
    height,
  }: {
    lanes: readonly LaneView[];
    /** In px; null takes the row's. */
    height: number | null;
  } = $props();

  /** A figure this close under its lane's top gives way to the unit. */
  const CLEAR = 16;

  const figures = $derived(
    lanes.flatMap((lane) =>
      lane.ticks.flatMap((tick) =>
        tick.y - lane.box.top > CLEAR ? [{ key: `${lane.lane.key} ${tick.text}`, ...tick }] : [],
      ),
    ),
  );
</script>

<div
  class="relative text-[11px] leading-none text-muted-foreground tabular-nums"
  style:height={height === null ? null : `${height}px`}
  aria-hidden="true"
>
  {#each lanes as lane (lane.lane.key)}
    <span
      class="absolute right-0 max-w-full truncate opacity-70"
      style:top="{lane.box.top + (lane.lane.states ? 7 : -3)}px"
    >
      {lane.caption}
    </span>
  {/each}
  {#each figures as figure (figure.key)}
    <span class="absolute right-0 -translate-y-1/2" style:top="{figure.y}px">{figure.text}</span>
  {/each}
</div>
