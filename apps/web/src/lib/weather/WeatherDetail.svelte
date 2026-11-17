<!--
  The weather detail (ADR 23 "Dashboard"): today and the next two days by the hour, a tab each,
  then the day's sunshine, its snow depth while snow lies and its visibility on fog. It reads the
  weather device alone.
-->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import type { Day } from "../dashboard/day.ts";
  import { m } from "../paraglide/messages.js";
  import { DAYS, daySpans, hourly } from "./hourly.ts";
  import { readWeatherSources, type WeatherReader, type WeatherSources } from "./weather.ts";
  import WeatherDays from "./WeatherDays.svelte";

  let {
    core,
    day,
  }: {
    core: WeatherReader;
    /** Today as the dashboard read it; undefined until it has. */
    day: Pick<Day, "zone" | "start" | "now"> | undefined;
  } = $props();

  const HOUR = 3_600_000;

  /** A sheet section, as the other details' (ADR 21). */
  const FRAME = "flex flex-col gap-3 border-t border-border/60 px-5 pt-4 pb-4 sm:px-6";

  const zone = $derived(day?.zone);
  const start = $derived(day?.start.getTime());

  // The hour in progress: its measurements land as it passes, so each new hour reads again.
  const hour = $derived(day === undefined ? undefined : Math.floor(day.now.getTime() / HOUR));

  let sources = $state.raw<WeatherSources>();

  $effect(() => {
    if (zone === undefined || start === undefined || hour === undefined) return;

    const end = daySpans(zone, new Date(start), DAYS).at(-1)?.[1] ?? start;
    let current = true;

    void (async () => {
      // History to the close of the hour in progress: today's alone, so it is read raw.
      const measuredTo = new Date((hour + 1) * HOUR);
      const read = await readWeatherSources(core, new Date(start), new Date(end), measuredTo);

      if (current) sources = read;
    })();

    return () => {
      current = false;
    };
  });

  const days = $derived(
    sources === undefined || zone === undefined || start === undefined
      ? null
      : hourly(sources, zone, new Date(start)),
  );

  /** Whether any hour of any day has a value; undefined until read. */
  const stored = $derived(
    days?.some((d) => d.hours.some((h) => Object.values({ ...h, at: null }).some((v) => v !== null))),
  );

</script>

{#if days === null || zone === undefined || !stored}
  <section class={FRAME} aria-label={m.weather_hourly()}>
    {#if stored === false}
      <p class="flex h-[190px] items-center justify-center text-xs text-muted-foreground">
        {m.weather_none()}
      </p>
    {:else}
      <Skeleton class="h-[440px]" role="status" aria-label={m.loading()} />
    {/if}
  </section>
{:else}
  <WeatherDays {days} {zone} now={day?.now.getTime() ?? 0} class={FRAME} />
{/if}
