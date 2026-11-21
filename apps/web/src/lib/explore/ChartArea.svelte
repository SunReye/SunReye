<!--
  The chart of the open mode (ADR 22), named after it; each mode fills its own pane behind one
  contract (`mode.ts`). With nothing chosen it says so; "Add series" stands right above.
-->
<script lang="ts">
  import ChartSpline from "@lucide/svelte/icons/chart-spline";
  import { MediaQuery } from "svelte/reactivity";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import LoadFailed from "../components/load-failed.svelte";
  import { m } from "../paraglide/messages.js";
  import type { Explore, ExploreCore } from "./explore.svelte.ts";
  import { modeLabel } from "./labels.ts";
  import type { Table } from "./csv.ts";
  import { PANES } from "./panes.ts";

  let {
    core,
    x,
    fill,
    full = false,
    plotted = $bindable(),
  }: {
    core: ExploreCore;
    x: Explore;
    /** The height to fill in fullscreen, in px; the screen's own height without it. */
    fill?: number | undefined;
    /** Whether the chart is fullscreen. */
    full?: boolean;
    /** Set as the area is built: what the open mode plotted, null while nothing is drawn. */
    plotted?: (() => Table | null) | undefined;
  } = $props();

  const wide = new MediaQuery("(min-width: 1024px)");
  const height = $derived(fill ?? (wide.current ? 416 : 348));

  const Pane = $derived(PANES[x.view.mode]);

  /** The open pane's plot; the pane sets it as it is built, so a switch of mode hands it over. */
  let read = $state.raw<() => Table | null>();

  // Series and overlay draw on the catalog's kinds and instants; a fold reads without them.
  const unread = $derived(x.catalog === "failed" && x.view.mode !== "fold");

  plotted = () => (x.chosen.length === 0 || unread ? null : (read?.() ?? null));
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
  {:else if unread}
    <div class="flex flex-col justify-center" style:height="{height}px">
      <LoadFailed
        text={m.explore_chart_unread()}
        refused={x.refused}
        onretry={() => void x.load()} />
    </div>
  {:else}
    <Pane
      {core}
      route={x.route}
      series={x.chosen}
      catalog={x.catalog}
      periods={x.view.periods}
      {height}
      {full}
      bind:plotted={read}
    />
  {/if}
</section>
