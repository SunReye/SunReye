<!--
  One day of the weather detail (ADR 23 "Dashboard"): the code's icons over the hours, then a row
  per quantity on the same hours. No axes: each row says its day's range, and the rule marks now.
-->
<script lang="ts">
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import { flowColour } from "../energy-colours.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import HourBars, { SNOW } from "./HourBars.svelte";
  import HourLines, { type Quantity } from "./HourLines.svelte";
  import HourMarks from "./HourMarks.svelte";
  import type { WeatherDay } from "./hourly.ts";
  import SkyIcon from "./SkyIcon.svelte";
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

  const WARM = flowColour("solar");
  const PLAIN = "var(--muted-foreground)";

  const span = $derived([day.start, day.end] as const);

  const clock = $derived(
    new Intl.DateTimeFormat(getLocale(), { hour: "2-digit", minute: "2-digit", timeZone: zone }),
  );

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
    day.hours.map((h) => ({ ...h, clearSkyIndex: h.clearSkyIndex === null ? null : Math.min(1, h.clearSkyIndex) * 100 })),
  );

  const indexed = $derived(known("clearSkyIndex").length > 0);

  const windTop = $derived(Math.max(5, ...known("wind"), ...known("gusts")) + 1);

  /** Where now is across the day; null on another day. */
  const nowAt = $derived(
    now >= day.start && now < day.end ? ((now - day.start) / (day.end - day.start)) * 100 : null,
  );
</script>

<div class="relative flex flex-col gap-4">
  <HourMarks hours={day.hours} {span} class="h-10">
    {#snippet mark(hour)}
      {#if hour.sky}
        <SkyIcon sky={hour.sky} class="size-5" />
      {:else}
        <span class="size-5"></span>
      {/if}
      <span class="text-[11px] text-muted-foreground tabular-nums">{clock.format(hour.at)}</span>
    {/snippet}
  </HourMarks>

  <WeatherRow
    label={m.rd_temperature()}
    also={{ label: m.weather_apparent_temperature(), colour: WARM, dashed: true }}
    figure={range("celsius", "°C")}
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
  >
    <HourBars hours={day.hours} label={m.weather_precipitation()} />
  </WeatherRow>

  <WeatherRow
    label={m.weather_cloud_cover()}
    also={indexed ? { label: m.weather_clear_sky_index(), colour: WARM } : null}
    figure={range("cloudCover", "%")}
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
  >
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
    <HourMarks hours={day.hours} {span} class="h-4">
      {#snippet mark(hour)}
        {#if hour.windDirection !== null}
          <!-- The arrow flies with the wind: away from where it blows from. -->
          <span
            class="flex text-muted-foreground"
            data-wind-from={hour.windDirection}
            style:rotate="{(hour.windDirection + 180) % 360}deg"
          >
            <ArrowUp class="size-3.5" aria-hidden="true" />
          </span>
        {/if}
      {/snippet}
    </HourMarks>
  </WeatherRow>

  <WeatherRow label={m.weather_humidity()} figure={range("humidity", "%")}>
    <HourLines
      hours={day.hours}
      {span}
      label={m.weather_humidity()}
      domain={[0, 100]}
      lines={[{ of: "humidity", colour: PLAIN }]}
    />
  </WeatherRow>

  {#if nowAt !== null}
    <span
      class="pointer-events-none absolute inset-y-0 w-px bg-foreground/25"
      style:left="{nowAt}%"
      data-now
    ></span>
  {/if}
</div>
