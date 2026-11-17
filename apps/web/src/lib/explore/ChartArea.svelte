<!--
  The chart of the open mode (ADR 22), named after it; each mode fills its own pane behind one
  contract (`mode.ts`). With nothing chosen it says so; "Add series" stands right above.
-->
<script lang="ts">
  import ChartSpline from "@lucide/svelte/icons/chart-spline";
  import { MediaQuery } from "svelte/reactivity";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import { m } from "../paraglide/messages.js";
  import type { Explore, ExploreCore } from "./explore.svelte.ts";
  import FoldPane from "./FoldPane.svelte";
  import { modeLabel } from "./labels.ts";
  import type { Table } from "./csv.ts";
  import OverlayPane from "./OverlayPane.svelte";
  import SeriesPane from "./SeriesPane.svelte";

  let {
    core,
    x,
    fill,
    plotted = $bindable(),
  }: {
    core: ExploreCore;
    x: Explore;
    /** The height to fill in fullscreen, in px; the screen's own height without it. */
    fill?: number | undefined;
    /** Set as the area is built: what the open mode plotted, null while nothing is drawn. */
    plotted?: (() => Table | null) | undefined;
  } = $props();

  const PANES = { series: SeriesPane, overlay: OverlayPane, fold: FoldPane };

  const wide = new MediaQuery("(min-width: 1024px)");
  const height = $derived(fill ?? (wide.current ? 416 : 348));

  const Pane = $derived(PANES[x.view.mode]);

  /** The open pane's plot; the pane sets it as it is built, so a switch of mode hands it over. */
  let read = $state.raw<() => Table | null>();

  plotted = () => (x.chosen.length === 0 ? null : (read?.() ?? null));
</script>

<section aria-label={modeLabel(x.view.mode)} style:min-height="{height}px">
  {#if x.chosen.length === 0}
    <Empty.Root style="min-height: {height}px">
      <Empty.Header>
        <Empty.Media variant="icon"><ChartSpline /></Empty.Media>
        <Empty.Title>{m.explore_none_title()}</Empty.Title>
        <Empty.Description>{m.explore_none_text()}</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {:else}
    <Pane
      {core}
      route={x.route}
      series={x.chosen}
      catalog={x.catalog}
      periods={x.view.periods}
      {height}
      bind:plotted={read}
    />
  {/if}
</section>
