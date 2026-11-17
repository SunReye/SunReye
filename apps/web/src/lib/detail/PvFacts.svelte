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

  const data = new RangeData(
    () => input.route,
    (from, to, now) => {
      const [core, a, period] = [input.core, { ...analytics, inverter }, periodOf(input.route.range)];

      const [a0, b] = [from.getTime(), to.getTime()];

      return readPv(core, a, { from: a0, until: Math.min(b, now), to: b, period });
    },
  );

  const stats = $derived.by(() => {
    const got = data.current;

    if (got === undefined) return null;

    return pvFacts(got.data, {
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
