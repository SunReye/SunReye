<!-- The range sits on the page's centre line: the title left of it, the baseline right. -->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import { shortDay } from "../range/calendar.ts";
  import RangeControl from "../range/RangeControl.svelte";
  import CompareToggle from "./CompareToggle.svelte";
  import type { Statistics } from "./screen.svelte.ts";

  let { s }: { s: Statistics } = $props();
</script>

<header
  class="flex flex-wrap items-center gap-x-6 gap-y-3 lg:grid lg:grid-cols-[1fr_540px_1fr] lg:items-start"
>
  <h1 class="order-1 text-xl font-semibold tracking-tight lg:leading-8">{m.stats_title()}</h1>
  <div class="order-3 w-full lg:order-2">
    <RangeControl model={s.route} />
  </div>
  <div
    class="order-2 ml-auto flex items-center gap-2 text-xs text-muted-foreground lg:order-3 lg:justify-self-end"
  >
    {#if s.fresh}
      <span>{m.stats_since({ date: shortDay(s.since, true) })}</span>
    {:else}
      <CompareToggle range={s.route.range} cmp={s.view.cmp} onchange={s.compare} />
    {/if}
  </div>
</header>
