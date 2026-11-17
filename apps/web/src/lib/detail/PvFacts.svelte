<!-- The PV, inverter and string sheets' facts over their range (ADR 21 "Sheet content"). -->
<script lang="ts">
  import type { Analytics } from "../analytics/sources.ts";
  import { periodOf } from "../history/history.ts";
  import { RangeData } from "../range/range-data.svelte.ts";
  import { grainOf } from "../range/range.ts";
  import type { AnalyticsInput } from "./Analytics.svelte";
  import DetailStats from "./DetailStats.svelte";
  import { pvFacts, readPv } from "./pv-range.ts";

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

  // A sheet keeps this row while another figure opens: only its own read is shown.
  const key = $derived(`${analytics.device}/${analytics.series}`);

  const data = new RangeData(
    () => input.route,
    (from, to, now) => {
      const [core, a, period] = [input.core, { ...analytics, inverter }, periodOf(input.route.range)];
      const [a0, b, at] = [from.getTime(), to.getTime(), key];

      return readPv(core, a, { from: a0, until: Math.min(b, now), to: b, period }).then(
        (read) => ({ key: at, read }),
      );
    },
  );

  const stats = $derived.by(() => {
    const got = data.current;

    if (got === undefined || data.failed || got.data.key !== key) return null;

    return pvFacts(got.data.read, {
      hours: grainOf(got.range) === "hour",
      zone: input.route.place.zone,
    });
  });
</script>

{#if stats}
  <!-- The facts row spans the sheet, as every sheet's does. -->
  <div class="-mx-5 -mb-4 pt-2 sm:-mx-6">
    <DetailStats {stats} />
  </div>
{/if}
