<!-- The card's open tab on its pager; before the first range, a skeleton of the chart's size (ADR 21). -->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import Pager from "../range/Pager.svelte";
  import type { Statistics, StatisticsCore } from "./screen.svelte.ts";
  import StatsPane from "./StatsPane.svelte";

  let {
    core,
    s,
    height,
    card,
  }: {
    core: StatisticsCore;
    s: Statistics;
    height: number;
    /** The card, which a finger steps the range on. */
    card: HTMLElement | null;
  } = $props();
</script>

<div class="min-h-[348px] lg:min-h-[416px]">
  {#if s.pane}
    <Pager
      surface={card}
      id={s.paneId}
      data={s.pane}
      travel={s.travel}
      peek={s.peek}
      defer
      onstep={(dir) => {
        haptics.selection();
        s.drag(dir);
      }}
    >
      {#snippet children(d)}
        <StatsPane
          {core}
          got={d.got}
          view={d.view}
          route={s.route}
          facts={s.facts}
          fresh={s.fresh}
          loading={d.loading}
          {height}
          onview={s.open}
        />
      {/snippet}
    </Pager>
  {:else}
    <Skeleton style="height: {height}px" role="status" aria-label={m.loading()} />
  {/if}
</div>
