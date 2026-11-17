<!--
  One day of the weather detail (ADR 23 "Dashboard"): the code's icons over the hours, then a row
  per quantity on the same hours. No axes: each row says its day's range, and the rule marks now.
  Under the pointer, or a finger held on it, one rule crosses every row at its hour and each row
  says its value there (ADR 21 "Chart reading").
-->
<script lang="ts">
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import DayRows from "./DayRows.svelte";
  import HourBars, { SNOW } from "./HourBars.svelte";
  import HourLines, { PLAIN, WARM, type Quantity } from "./HourLines.svelte";
  import { hourFigures } from "./hour-figures.ts";
  import HourMarks from "./HourMarks.svelte";
  import type { WeatherDay } from "./hourly.ts";
  import WeatherRow from "./WeatherRow.svelte";

  let {
    day,
    now,
    zone,
  }: {
    day: WeatherDay;
    /** ms since 1970. */
    now: number;
    zone: string;
  } = $props();

  const span = $derived([day.start, day.end] as const);

  const whole = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });

  const tenths = new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const known = (of: Quantity) => day.hours.flatMap((h) => h[of] ?? []);

  /** The day's lowest to highest of a quantity. */
  function range(of: Quantity, unit: string): string | null {
    const values = known(of);

    if (values.length === 0) return null;

    const [low, high] = [Math.min(...values), Math.max(...values)].map((v) => whole.format(v));

    return low === high ? `${low} ${unit}` : `${low} – ${high} ${unit}`;
  }

  const fallen = $derived.by(() => {
    const values = known("precipitation");

    return values.length === 0 ? null : `${tenths.format(values.reduce((a, b) => a + b, 0))} mm`;
  });

  const snows = $derived(known("snowfall").some((cm) => cm > 0));

  /** The index on the cloud cover's scale: a clear sky's 1 at the top. */
  const sky = $derived(
    day.hours.map((h) =>
      Object.assign({}, h, {
        clearSkyIndex: h.clearSkyIndex === null ? null : Math.min(1, h.clearSkyIndex) * 100,
      }),
    ),
  );

  const indexed = $derived(known("clearSkyIndex").length > 0);

  const windTop = $derived(Math.max(5, ...known("wind"), ...known("gusts")) + 1);

  /** The index of the hour being read; null with none. */
  let at = $state<number | null>(null);

  const readHour = $derived(at === null ? null : (day.hours[at] ?? null));

  /** Each row's values at that hour. */
  const read = $derived(readHour === null ? null : hourFigures(readHour, { snows, indexed }));
</script>

{#snippet arrow(from: number)}
  <!-- The arrow flies with the wind: away from where it blows from. -->
  <span class="flex" data-wind-from={from} style:rotate="{(from + 180) % 360}deg">
    <ArrowUp class="size-3.5" aria-hidden="true" />
  </span>
{/snippet}

<DayRows hours={day.hours} {span} {zone} {now} bind:read={at}>
  <WeatherRow
    label={m.rd_temperature()}
    also={{ label: m.weather_apparent_temperature(), colour: WARM, dashed: true }}
    figure={range("celsius", "°C")}
    read={read?.temperature}
  >
    <HourLines
      hours={day.hours}
      {span}
      label={m.rd_temperature()}
      lines={[
        { of: "celsius", colour: WARM },
        { of: "apparent", colour: WARM, dashed: true },
      ]}
    />
  </WeatherRow>

  <WeatherRow
    label={m.weather_precipitation()}
    also={snows ? { label: m.weather_snowfall(), colour: SNOW } : null}
    figure={fallen}
    read={read?.precipitation}
  >
    <HourBars hours={day.hours} label={m.weather_precipitation()} />
  </WeatherRow>

  <WeatherRow
    label={m.weather_cloud_cover()}
    also={indexed ? { label: m.weather_clear_sky_index(), colour: WARM } : null}
    figure={range("cloudCover", "%")}
    read={read?.cloud}
  >
    <HourLines
      hours={sky}
      {span}
      label={m.weather_cloud_cover()}
      domain={[0, 100]}
      lines={[
        { of: "cloudCover", colour: PLAIN, filled: true },
        { of: "clearSkyIndex", colour: WARM },
      ]}
    />
  </WeatherRow>

  <WeatherRow
    label={m.explore_wind()}
    also={{ label: m.weather_gusts(), colour: PLAIN, dashed: true }}
    figure={range("wind", "m/s")}
    read={read?.wind}
  >
    {#snippet tail()}
      {#if readHour !== null && readHour.windDirection !== null}
        {@render arrow(readHour.windDirection)}
      {/if}
    {/snippet}
    <HourLines
      hours={day.hours}
      {span}
      label={m.explore_wind()}
      domain={[0, windTop]}
      lines={[
        { of: "wind", colour: PLAIN },
        { of: "gusts", colour: PLAIN, dashed: true },
      ]}
    />
    <HourMarks hours={day.hours} {span} read={at} class="h-4">
      {#snippet mark(hour, marks)}
        {#if hour.windDirection !== null}
          <span class={marks ? "text-foreground" : "text-muted-foreground"}>
            {@render arrow(hour.windDirection)}
          </span>
        {/if}
      {/snippet}
    </HourMarks>
  </WeatherRow>

  <WeatherRow
    label={m.weather_humidity()}
    figure={range("humidity", "%")}
    read={read?.humidity}
  >
    <HourLines
      hours={day.hours}
      {span}
      label={m.weather_humidity()}
      domain={[0, 100]}
      lines={[{ of: "humidity", colour: PLAIN }]}
    />
  </WeatherRow>
</DayRows>
