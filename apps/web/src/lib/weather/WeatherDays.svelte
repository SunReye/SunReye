<!--
  The weather detail's days (ADR 23 "Dashboard"): a tab each, today first, then the day's sunshine,
  its snow depth while snow lies and its visibility on fog.
-->
<script lang="ts">
  import DayTabs from "../detail/DayTabs.svelte";
  import DetailStats from "../detail/DetailStats.svelte";
  import type { Fact } from "../detail/figures.ts";
  import { m } from "../paraglide/messages.js";
  import type { WeatherDay } from "./hourly.ts";
  import WeatherDayRows from "./WeatherDayRows.svelte";

  let {
    days,
    zone,
    now,
    class: className,
  }: {
    days: readonly WeatherDay[];
    zone: string;
    /** ms since 1970. */
    now: number;
    class: string;
  } = $props();

  function facts(of: WeatherDay): Fact[] {
    const all: (Fact & { value: number | null })[] = [
      { label: m.weather_sunshine(), value: of.sunshine, unit: "h", digits: 1 },
      {
        label: m.weather_snow_depth(),
        value: of.snowDepth === null ? null : of.snowDepth * 100,
        unit: "cm",
        digits: 0,
      },
      { label: m.weather_visibility(), value: of.visibility, unit: "m", digits: 0 },
    ];

    // A row that does not matter is absent, not empty.
    return all.filter((f) => f.value !== null);
  }
</script>

<DayTabs {days} {zone} label={m.weather_hourly()} class={className}>
  {#snippet day(shown)}
    <WeatherDayRows day={shown} {now} {zone} />
  {/snippet}
  {#snippet below(shown)}
    {@const stats = facts(shown)}
    {#if stats.length > 0}
      <DetailStats {stats} />
    {/if}
  {/snippet}
</DayTabs>
