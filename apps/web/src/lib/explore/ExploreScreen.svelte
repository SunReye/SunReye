<!--
  Explore (ADR 22): any stored series of any device over a range. The shared range control and
  the mode switch on top, the chosen series as chips, the chart of the mode, and the picker: a
  pane left of the chart from 1024 px, a drawer below. The whole view lives in the hash route.
-->
<script lang="ts">
  import { MediaQuery } from "svelte/reactivity";
  import * as Card from "@sunreye/ui/card";
  import type { Go } from "../range/route.svelte.ts";
  import ChartArea from "./ChartArea.svelte";
  import type { Table } from "./csv.ts";
  import ExploreChips from "./ExploreChips.svelte";
  import { Explore, type ExploreCore } from "./explore.svelte.ts";
  import ExploreHeader from "./ExploreHeader.svelte";
  import { Fullscreen } from "./fullscreen.svelte.ts";
  import PickerShell from "./PickerShell.svelte";

  let {
    core,
    admin,
    params,
    go,
    back,
  }: {
    core: ExploreCore;
    /** The admin saves, renames and deletes views; a viewer opens them. */
    admin: boolean;
    params: URLSearchParams;
    go: Go;
    back: () => void;
  } = $props();

  const x = new Explore(() => ({ core, params, go, back }));

  // The pane needs the width, whatever the input (ADR 22).
  const paned = new MediaQuery("(min-width: 1024px)");

  let search = $state<HTMLInputElement | null>(null);

  let plotted = $state.raw<() => Table | null>();

  const full = new Fullscreen();

  /** The room the chart has in fullscreen, in px. */
  let room = $state(0);

  /** At rest the page's column; in fullscreen over the bar and rail (z-40), under the body's overlays. */
  const REST = {
    main: "mx-auto max-w-[1320px] gap-4 px-3 pt-4 pb-6 sm:px-4 lg:gap-5 lg:px-6 lg:pt-6",
    panes: "lg:grid-cols-[320px_minmax(0,1fr)]",
    card: "self-start px-3 py-4 sm:px-5",
    chart: "",
  };

  const FULL = {
    main: "fixed inset-0 z-45 gap-2 bg-background px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4",
    panes: "min-h-0 flex-1 grid-rows-[minmax(0,1fr)]",
    // The window is the chart's frame: no card around it.
    card: "min-h-0 rounded-none bg-transparent p-0 ring-0 [box-shadow:none]!",
    // Sized by the card, not by the chart in it, so it shrinks again; lanes at their least scroll.
    chart: "min-h-0 flex-1 overflow-y-auto",
  };

  const look = $derived(full.on ? FULL : REST);

  const fill = $derived(full.on && room > 0 ? room : undefined);

  /** "Add series": beside the pane its search takes the focus; below 1024 px the picker opens. */
  function add(): void {
    if (paned.current) search?.focus();
    else x.pick();
  }
</script>

<main {@attach full.watch} class={["flex w-full flex-col", look.main]}>
  <ExploreHeader {x} {admin} table={plotted?.() ?? null} full={full.on} onfull={full.toggle} />

  <div class={["grid gap-4 lg:gap-6", look.panes]}>
    {#if !full.on}
      <PickerShell {x} paned={paned.current} bind:search />
    {/if}

    <Card.Root glass={!full.on} class={["min-w-0 gap-4", look.card]}>
      <!-- Opened with nothing chosen, the first saved view decides what is read (ADR 22). -->
      {#if !x.saved.opening}
        {#if !full.on}
          <ExploreChips {x} onadd={add} />
        {/if}
        <div class={look.chart} bind:clientHeight={room}>
          <ChartArea {core} {x} {fill} full={full.on} bind:plotted />
        </div>
      {/if}
    </Card.Root>
  </div>
</main>
