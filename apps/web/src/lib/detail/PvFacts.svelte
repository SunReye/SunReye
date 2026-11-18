<!-- The PV, inverter and string sheets' facts over their range (ADR 21 "Sheet content"). -->
<script lang="ts">
  import type { AnalyticsInput } from "./Analytics.svelte";
  import DetailStats from "./DetailStats.svelte";
  import { PV_RANGE } from "./pv-range.ts";
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

  const stats = $derived(range.failed ? null : range.view);
</script>

{#if stats}
  <DetailStats panel {stats} />
{/if}
