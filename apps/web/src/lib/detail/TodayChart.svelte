<!-- What a figure without a series in history shows: the PV day, the spot prices, the weather by
  the hour or the PV forecast by the day. -->
<script lang="ts">
  import type { Day } from "../dashboard/day.ts";
  import DayChart from "../dashboard/DayChart.svelte";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import type { Figure } from "./figures.ts";
  import PriceChart from "./PriceChart.svelte";
  import ForecastDetail, { type AheadReader } from "../forecast/ForecastDetail.svelte";
  import type { WeatherReader } from "../weather/weather.ts";
  import WeatherDetail from "../weather/WeatherDetail.svelte";

  let {
    chart,
    day,
    core,
  }: {
    chart: Figure["chart"];
    day: Day | undefined;
    /** What the weather detail (ADR 23) and the PV forecast's days (ADR 21) read. */
    core: WeatherReader & AheadReader;
  } = $props();

  const clock = $derived(
    new Intl.DateTimeFormat(getLocale(), {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: day?.zone,
    }),
  );
</script>

{#if chart === "weather"}
  <WeatherDetail {core} {day} />
{:else if chart === "forecast"}
  <ForecastDetail {core} {day} />
{:else if chart}
  <section class="flex flex-col gap-3 border-t border-border/60 px-5 pt-4 pb-4 sm:px-6">
    {#if chart === "price"}
      <PriceChart {day} />
    {:else if day !== undefined}
      <div class="h-[190px]"><DayChart rows={day.rows} now={day.now} hours={clock} /></div>
    {:else}
      <Skeleton class="h-[190px]" role="status" aria-label={m.loading()} />
    {/if}
  </section>
{/if}
