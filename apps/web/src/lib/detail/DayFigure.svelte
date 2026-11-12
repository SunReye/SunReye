<!-- A figure's chart of today in its detail sheet: the spot prices, or the PV day (ADR 21). -->
<script lang="ts">
  import type { Day } from "../dashboard/day.ts";
  import DayChart from "../dashboard/DayChart.svelte";
  import { getLocale } from "../paraglide/runtime.js";
  import PriceChart from "./PriceChart.svelte";

  let { chart, day }: { chart: "pv" | "price"; day: Day | undefined } = $props();

  const clock = $derived(
    new Intl.DateTimeFormat(getLocale(), {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: day?.zone,
    }),
  );
</script>

<section class="flex flex-col gap-3 border-t border-border/60 px-5 pt-4 pb-4 sm:px-6">
  {#if chart === "price"}
    <PriceChart {day} />
  {:else if day !== undefined}
    <div class="h-[190px]"><DayChart rows={day.rows} now={day.now} hours={clock} /></div>
  {:else}
    <div class="h-[190px]"></div>
  {/if}
</section>
