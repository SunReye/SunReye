<!-- The range sits on the page's centre line, as in History: the title left of it, the mode right. -->
<script lang="ts">
  import PageTitle from "../components/page-title.svelte";
  import { m } from "../paraglide/messages.js";
  import RangeControl from "../range/RangeControl.svelte";
  import type { Explore } from "./explore.svelte.ts";
  import ModeSwitch from "./ModeSwitch.svelte";

  let { x }: { x: Explore } = $props();
</script>

<header
  class="flex flex-wrap items-center gap-x-6 gap-y-3 lg:grid lg:grid-cols-[1fr_540px_1fr] lg:items-start"
>
  <PageTitle wide class="order-1" title={m.explore_title()} />
  <div class="order-3 w-full lg:order-2">
    <RangeControl model={x.route} />
  </div>
  <div class="order-2 ml-auto lg:order-3 lg:justify-self-end">
    <ModeSwitch mode={x.view.mode} onchange={x.setMode} />
  </div>
</header>
