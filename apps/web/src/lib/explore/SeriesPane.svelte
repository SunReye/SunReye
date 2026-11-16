<!--
  Series mode's chart (ADR 22): up to six series on one time axis, a lane per unit, each drawn by
  its kind's rule. The legend reads the values under the pointer; a mouse drag narrows the range,
  a finger only reads.
-->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { m } from "../paraglide/messages.js";
  import LanePlot from "./LanePlot.svelte";
  import type { ModeProps } from "./mode.ts";
  import { Pointer } from "./pointer.svelte.ts";
  import { figuresOf } from "./series-chart.ts";
  import SeriesLegend from "./SeriesLegend.svelte";
  import { SeriesView } from "./series-view.svelte.ts";

  let props: ModeProps = $props();

  const view = new SeriesView(() => props);
  const chart = $derived(view.chart);

  let plot = $state<HTMLElement | null>(null);

  const pointer = new Pointer(() => ({
    plot,
    from: chart?.from ?? 0,
    to: chart?.to ?? 0,
    onbrush: view.narrow,
  }));
</script>

{#if props.catalog === "failed"}
  <p
    class="grid place-items-center rounded-md border border-dashed border-border/60 px-4 text-center text-sm text-muted-foreground"
    style:height="{props.height}px"
  >
    {m.explore_chart_unread()}
  </p>
{:else if !chart}
  <Skeleton style="height: {props.height}px" role="status" aria-label={m.loading()} />
{:else}
  <div class="@container flex flex-col gap-2">
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
      bind:plot
    />
  </div>
{/if}
