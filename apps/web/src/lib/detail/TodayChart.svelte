<!-- Today's chart of a figure without a series in history: the PV day or the spot prices. -->
<script lang="ts">
  import type { Day } from "../dashboard/day.ts";
  import DayChart from "../dashboard/DayChart.svelte";
  import { getLocale } from "../paraglide/runtime.js";
  import type { Figure } from "./figures.ts";
  import PriceChart from "./PriceChart.svelte";

  let { chart, day }: { chart: Figure["chart"]; day: Day | undefined } = $props();

  const clock = $derived(
    new Intl.DateTimeFormat(getLocale(), {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: day?.zone,
    }),
  );
</script>

{#if chart}
  <section class="flex flex-col gap-3 border-t border-border/60 px-5 pt-4 pb-4 sm:px-6">
    {#if chart === "price"}
      <PriceChart {day} />
    {:else if day !== undefined}
      <div class="h-[190px]"><DayChart rows={day.rows} now={day.now} hours={clock} /></div>
    {:else}
      <div class="h-[190px]"></div>
    {/if}
  </section>
{/if}
