<!--
  Explore (ADR 22): any stored series of any device over a range. The shared range control and
  the mode switch on top, the chosen series as chips, the chart of the mode, and the picker: a
  pane left of the chart from 1024 px, a drawer below. The whole view lives in the hash route.
-->
<script lang="ts">
  import { MediaQuery } from "svelte/reactivity";
  import * as Card from "#lib/components/ui/card/index.js";
  import type { Go } from "../range/route.svelte.ts";
  import ChartArea from "./ChartArea.svelte";
  import { Explore, type ExploreCore } from "./explore.svelte.ts";
  import ExploreHeader from "./ExploreHeader.svelte";
  import PickerShell from "./PickerShell.svelte";
  import SeriesChips from "./SeriesChips.svelte";

  let { core, params, go }: { core: ExploreCore; params: URLSearchParams; go: Go } = $props();

  const x = new Explore(() => ({ core, params, go }));

  // The pane needs the width, whatever the input (ADR 22).
  const paned = new MediaQuery("(min-width: 1024px)");

  let search = $state<HTMLInputElement | null>(null);

  /** "Add series": beside the pane its search takes the focus; below 1024 px the picker opens. */
  function add(): void {
    if (paned.current) search?.focus();
    else x.pick();
  }
</script>

<main
  class="mx-auto flex w-full max-w-[1320px] flex-col gap-4 px-3 pt-4 pb-6 sm:px-4 lg:gap-5 lg:px-6 lg:pt-6"
>
  <ExploreHeader {x} />

  <div class="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-6">
    <PickerShell {x} paned={paned.current} bind:search />

    <Card.Root class="glass-ambient min-w-0 gap-4 self-start px-3 py-4 sm:px-5">
      <SeriesChips chosen={x.chosen} onremove={x.toggle} onadd={add} />
      <ChartArea {core} {x} />
    </Card.Root>
  </div>
</main>
