<!-- The card's open tab on its pager; before the first range, a skeleton of the chart's size (ADR 21). -->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { m } from "../paraglide/messages.js";
  import RangePane from "../range/RangePane.svelte";
  import type { Statistics, StatisticsCore } from "./screen.svelte.ts";
  import StatsPane from "./StatsPane.svelte";

  let {
    core,
    s,
    height,
  }: {
    core: StatisticsCore;
    s: Statistics;
    height: number;
  } = $props();
</script>

<div class="min-h-[348px] lg:min-h-[416px]">
  <RangePane model={s} defer>
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
    {#snippet waiting()}
      <Skeleton style="height: {height}px" role="status" aria-label={m.loading()} />
    {/snippet}
  </RangePane>
</div>
