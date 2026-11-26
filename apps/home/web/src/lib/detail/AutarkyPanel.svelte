<!--
  The autarky sheet's range (ADR 21 "Sheet content"): when the house ran on its own power. Both
  shares by band, then what covered the house and where the PV went, then one row of facts: the
  best and the worst band and the last 30 whole days. All from the plant's flows (ADR 14).
-->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { m } from "../paraglide/messages.js";
  import type { AnalyticsInput } from "./Analytics.svelte";
  import { autarkyFacts } from "./autarky.ts";
  import { AUTARKY_RANGE, monthAutarky } from "./autarky-range.ts";
  import StatStrip from "../components/stat-strip.svelte";
  import RangeState from "./RangeState.svelte";
  import { SheetRange } from "./sheet-range.svelte.ts";
  import ShareBar from "./ShareBar.svelte";
  import ShareChart from "./ShareChart.svelte";

  let { input }: { input: AnalyticsInput } = $props();

  const range = new SheetRange(
    () => ({ core: input.core, route: input.route, key: "plant" }),
    AUTARKY_RANGE,
  );

  // Read once per plant day, not per range, nor as the sheet's layout or readings land.
  const core = $derived(input.core);
  const zone = $derived(input.route.place.zone);
  const today = $derived(input.route.place.cal.today);
  const month = $derived(monthAutarky(core, zone, today));
</script>

<RangeState failed={range.failed} refused={range.refused} onretry={range.retry}>
  {#if range.view}
    {@const v = range.view}
    <ShareChart bands={v.bands} grain={v.grain} selfUse={v.all.selfUse} />
    <div class="flex flex-col gap-4 pt-2">
      <ShareBar title={m.detail_covered()} total={v.all.consumption} parts={v.covered} />
      <ShareBar title={m.detail_went()} total={v.all.production} parts={v.went} />
    </div>
    {#await month}
      <StatStrip closes="panel" stats={autarkyFacts(v.best, v.worst, null)} />
    {:then mean}
      <StatStrip closes="panel" stats={autarkyFacts(v.best, v.worst, mean)} />
    {/await}
  {:else}
    <Skeleton class="h-52" role="status" aria-label={m.loading()} />
  {/if}
</RangeState>
