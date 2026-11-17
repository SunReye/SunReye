<!--
  The weather detail's days (ADR 23 "Dashboard"): a tab each, today first, then the day's sunshine,
  its snow depth while snow lies and its visibility on fog. A switch slides the days by their order.
-->
<script lang="ts">
  import * as Tabs from "#lib/components/ui/tabs/index.js";
  import DetailStats from "../detail/DetailStats.svelte";
  import type { Fact } from "../detail/figures.ts";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { daySlide } from "./day-slide.ts";
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

  const HOUR = 3_600_000;

  const weekday = $derived(new Intl.DateTimeFormat(getLocale(), { weekday: "long", timeZone: zone }));

  /** Each day's tab: today, then the weekdays after it. */
  const tabs = $derived(
    days.map((d, i) => ({
      id: String(d.start),
      start: d.start,
      // A day's middle is on its date in any zone.
      name: i === 0 ? m.dash_today() : weekday.format(d.start + 12 * HOUR),
      day: d,
    })),
  );

  let chosen = $state<string>();
  const tab = $derived(tabs.find((t) => t.id === chosen) ?? tabs[0]);

  // The day at mount is where the first slide starts from; the transitions follow every later one.
  // svelte-ignore state_referenced_locally
  const { enter, leave } = daySlide(tab?.start ?? 0);

  function choose(id: string): void {
    if (id === tab?.id) return;

    haptics.selection();
    chosen = id;
  }

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

  const stats = $derived(tab === undefined ? [] : facts(tab.day));
</script>

{#if tab}
  <section class={className} aria-label={m.weather_hourly()}>
    <Tabs.Root bind:value={() => tab.id, choose}>
      <Tabs.List variant="line" class="-ml-1.5" aria-label={m.weather_hourly()}>
        {#each tabs as t (t.id)}
          <Tabs.Trigger value={t.id}>{t.name}</Tabs.Trigger>
        {/each}
      </Tabs.List>
      <!-- One panel and one grid cell, so nothing reflows: the leaving and the arriving day slide
        through it. -->
      <Tabs.Content value={tab.id} class="grid overflow-x-clip pt-3">
        {#key tab.id}
          <div
            class="col-start-1 row-start-1 min-w-0"
            data-day
            in:enter={tab.start}
            out:leave={tab.start}
          >
            <WeatherDayRows day={tab.day} {now} {zone} />
          </div>
        {/key}
      </Tabs.Content>
    </Tabs.Root>
  </section>

  {#if stats.length > 0}
    <DetailStats {stats} />
  {/if}
{/if}
