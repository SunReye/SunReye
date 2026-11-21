<!--
  Series mode's chart (ADR 22): up to six series on one time axis, a lane per unit, each drawn by
  its kind's rule. The legend reads the values under the pointer; a mouse drag narrows the range,
  a finger only reads.
-->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { m } from "../paraglide/messages.js";
  import LanePlot from "./LanePlot.svelte";
  import type { PaneProps } from "./mode.ts";
  import { timeReading } from "./pointer.ts";
  import { figuresOf } from "./series-chart.ts";
  import SeriesLegend from "./SeriesLegend.svelte";
  import { SeriesView } from "./series-view.svelte.ts";

  let { plotted = $bindable(), ...props }: PaneProps = $props();

  const view = new SeriesView(() => props);

  plotted = () => view.table;

  const chart = $derived(view.chart);


  /** In fullscreen the pane is as tall as the window leaves, and the lanes take its rest. */
  const least = $derived(props.full === true ? `${props.height}px` : null);

  const pointer = timeReading(() => ({
    from: chart?.from ?? 0,
    to: chart?.to ?? 0,
    onbrush: view.narrow,
  }));
</script>

{#if !chart}
  <Skeleton style="height: {props.height}px" role="status" aria-label={m.loading()} />
{:else}
  <div
    class="@container flex flex-col gap-2"
    style:min-height={least}
  >
    <SeriesLegend
      title={view.title(pointer.at)}
      label={m.explore_series_chart()}
      figures={figuresOf(chart.lanes, pointer.at)}
    />

    {#each chart.notes as note (note)}
      <p class="text-xs text-muted-foreground">{note}</p>
    {/each}

    <LanePlot
      {chart}
      label={m.explore_chart_keys({ chart: m.explore_series_chart() })}
      {pointer}
      fill={props.full}
      bind:room={view.room}
    />
  </div>
{/if}
