<!--
  Overlay mode's chart (ADR 22): the first chosen series over the range and up to four earlier
  days or weeks, each drawn from its own start in a receding tint of the series' colour. The
  legend names each period with its value under the pointer. The chart only reads: a drag would
  narrow to a range overlay does not take.
-->
<script lang="ts">
  import ChartSpline from "@lucide/svelte/icons/chart-spline";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { m } from "../paraglide/messages.js";
  import LanePlot from "./LanePlot.svelte";
  import type { PaneProps } from "./mode.ts";
  import { OverlayView } from "./overlay-view.svelte.ts";
  import OverlayPeriods from "./OverlayPeriods.svelte";
  import { Pointer } from "./pointer.svelte.ts";
  import SeriesLegend from "./SeriesLegend.svelte";

  let { plotted = $bindable(), ...props }: PaneProps = $props();

  const view = new OverlayView(() => props);

  plotted = () => view.table;

  const chart = $derived(view.chart);

  const name = $derived(m.explore_overlay_chart({ name: view.chosen.label }));

  // Fullscreen hides the periods' row, so the skeleton takes its 44 px too.
  const waiting = $derived(props.full ? props.height : props.height - 44);

  /** In fullscreen the pane is as tall as the window leaves, and the lanes take its rest. */
  const least = $derived(props.full === true ? `${props.height}px` : null);

  let plot = $state<HTMLElement | null>(null);

  const pointer = new Pointer(() => ({
    plot,
    from: chart?.from ?? 0,
    to: chart?.to ?? 0,
    onbrush: null,
  }));
</script>

{#if props.catalog === "failed"}
  <p
    class="grid place-items-center rounded-md border border-dashed border-border/60 px-4 text-center text-sm text-muted-foreground"
    style:height="{props.height}px"
  >
    {m.explore_chart_unread()}
  </p>
{:else if view.state === "unstored"}
  <Empty.Root style="min-height: {props.height}px">
    <Empty.Header>
      <Empty.Media variant="icon"><ChartSpline /></Empty.Media>
      <Empty.Title>{view.chosen.label}</Empty.Title>
      <Empty.Description>{m.explore_fold_unstored({ name: view.chosen.label })}</Empty.Description>
    </Empty.Header>
  </Empty.Root>
{:else}
  <div
    class="@container flex flex-col gap-3"
    style:min-height={least}
  >
    <!-- Fullscreen leaves the periods to the legend (ADR 22), and the lanes take the window's rest. -->
    <OverlayPeriods
      hidden={props.full === true}
      picked={view.periods.slice(1)}
      picks={view.picks}
      full={view.full}
      max={view.lastDay}
      onadd={view.add}
      onremove={view.remove}
    />

    {#if !chart}
      <Skeleton
        style="height: {waiting}px"
        role="status"
        aria-label={m.loading()}
      />
    {:else}
      <div class="flex flex-1 flex-col gap-2">
        <SeriesLegend
          title={view.title(pointer.at)}
          label={name}
          figures={view.figures(pointer.at)}
        />

        {#each chart.notes as note (note)}
          <p class="text-xs text-muted-foreground">{note}</p>
        {/each}

        <LanePlot
          {chart}
          label={m.explore_chart_read({ chart: name })}
          {pointer}
          fill={props.full}
          bind:room={view.room}
          bind:plot
        />
      </div>
    {/if}
  </div>
{/if}
