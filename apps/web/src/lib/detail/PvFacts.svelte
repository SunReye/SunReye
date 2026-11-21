<!-- The PV, inverter and string sheets' facts over their range (ADR 21 "Sheet content"): a
  skeleton holds their place while they read, and a failed read says so with a retry. -->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { m } from "../paraglide/messages.js";
  import type { AnalyticsInput } from "./Analytics.svelte";
  import DetailStats from "./DetailStats.svelte";
  import { PV_RANGE } from "./pv-range.ts";
  import RangeState from "./RangeState.svelte";
  import { SheetRange } from "./sheet-range.svelte.ts";
  import type { Analytics } from "./sheets.ts";

  let {
    analytics,
    inverter,
    input,
  }: {
    analytics: Analytics;
    /** The inverter's sheet, which also states its temperature. */
    inverter: boolean;
    input: AnalyticsInput;
  } = $props();

  const range = new SheetRange(
    () => ({
      core: input.core,
      route: input.route,
      key: `${analytics.device}/${analytics.series}`,
      source: { ...analytics, inverter },
    }),
    PV_RANGE,
  );
</script>

<RangeState failed={range.failed} refused={range.refused} onretry={range.retry}>
  {#if range.view}
    <DetailStats panel stats={range.view} />
  {:else}
    <!-- A facts row's height: its label, value and note. -->
    <Skeleton class="mt-2 h-[4.5rem]" role="status" aria-label={m.loading()} />
  {/if}
</RangeState>
