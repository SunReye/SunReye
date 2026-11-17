<!-- The range sits on the page's centre line, as in History: the title left of it, the mode right. -->
<script lang="ts">
  import PageTitle from "../components/page-title.svelte";
  import { m } from "../paraglide/messages.js";
  import RangeControl from "../range/RangeControl.svelte";
  import type { Table } from "./csv.ts";
  import type { Explore } from "./explore.svelte.ts";
  import ExploreActions from "./ExploreActions.svelte";
  import FullscreenButton from "./FullscreenButton.svelte";
  import ModeSwitch from "./ModeSwitch.svelte";
  import { OVERLAY_KINDS } from "./overlay.ts";

  let {
    x,
    admin,
    table,
    full,
    onfull,
  }: {
    x: Explore;
    /** The admin's menu stands where a viewer has the export: the row has room for one of them. */
    admin: boolean;
    /** The open mode's plotted points; null while nothing is drawn. */
    table: Table | null;
    /** Whether the chart is fullscreen: the title, the export and the menu are left out. */
    full: boolean;
    onfull: () => void;
  } = $props();
</script>

<header
  class="flex flex-wrap items-center gap-x-3 gap-y-3 sm:gap-x-6 lg:grid lg:grid-cols-[1fr_540px_1fr] lg:items-start"
>
  {#if !full}
    <PageTitle wide class="order-1" title={m.explore_title()} />
  {/if}
  <!-- Without the title the range has room beside the mode from 640 px: a phone lying down. -->
  <div
    class={[
      "order-3 w-full lg:order-2 lg:col-start-2",
      full && "sm:order-1 sm:w-auto sm:flex-1 lg:flex-none",
    ]}
  >
    <RangeControl model={x.route} kinds={x.view.mode === "overlay" ? OVERLAY_KINDS : undefined} />
  </div>
  <div
    class="order-2 ml-auto flex items-center gap-1.5 sm:gap-2 lg:order-3 lg:col-start-3 lg:justify-self-end"
  >
    {#if !full}
      <ExploreActions
        {admin}
        {table}
        saved={x.saved}
        labels={x.chosen.map((each) => each.label)}
      />
    {/if}
    <ModeSwitch mode={x.view.mode} onchange={x.setMode} />
    <FullscreenButton {full} onchange={onfull} />
  </div>
</header>
