<!--
  The weather detail (ADR 23 "Dashboard"): today and the next two days by the hour, a tab each,
  then one row of facts: today the sky's word now, then the day's sunshine, its snow depth while
  snow lies and its visibility on fog. It reads the weather device alone.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import LoadFailed from "../components/load-failed.svelte";
  import type { Day } from "../dashboard/day.ts";
  import { m } from "../paraglide/messages.js";
  import { DAYS, daySpans, hourly } from "./hourly.ts";
  import { skyOf } from "./sky.ts";
  import { SKY_WORDS } from "./sky-words.ts";
  import { readWeatherSettled, type WeatherReader } from "./weather.ts";
  import WeatherDays from "./WeatherDays.svelte";

  let {
    core,
    day,
  }: {
    core: WeatherReader;
    /** Today as the dashboard read it; undefined until it has. */
    day: Pick<Day, "zone" | "start" | "now" | "weather"> | undefined;
  } = $props();

  const HOUR = 3_600_000;

  /** A sheet section, as the other details' (ADR 21). */
  const FRAME = "flex flex-col gap-3 border-t border-border/60 px-5 pt-4 pb-4 sm:px-6";

  /** A day's tabs, rows and facts at a phone's width, in px: the placeholder's, loading or empty. */
  const HOURS_HEIGHT = 572;

  const zone = $derived(day?.zone);
  const start = $derived(day?.start.getTime());

  // The hour in progress: its measurements land as it passes, so each new hour reads again.
  const hour = $derived(day === undefined ? undefined : Math.floor(day.now.getTime() / HOUR));

  let read = $state.raw<Awaited<ReturnType<typeof readWeatherSettled>>>();

  const sources = $derived(read?.failed === false ? read.data : undefined);

  /** Raised to read again after a failure. */
  let again = $state(0);

  /** The sky's word now, as the strip says it; null where nothing tells. */
  const sky = $derived.by(() => {
    const now = day === undefined ? null : skyOf(day.weather);

    return now === null ? null : { label: m.dash_weather(), text: SKY_WORDS[now]() };
  });

  $effect(() => {
    if (zone === undefined || start === undefined || hour === undefined) return;

    void again;

    const end = daySpans(zone, new Date(start), DAYS).at(-1)?.[1] ?? start;
    let current = true;
    // Read once an hour: the sheet hands the same core over anew as its own reads land.
    const reader = untrack(() => core);

    void (async () => {
      // History to the close of the hour in progress: today's alone, so it is read raw.
      const measuredTo = new Date((hour + 1) * HOUR);

      const got = await readWeatherSettled(reader, new Date(start), new Date(end), measuredTo);

      if (current) read = got;
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
    days?.some((d) =>
      d.hours.some((h) => Object.values({ ...h, at: null }).some((v) => v !== null)),
    ),
  );
</script>

{#if days === null || zone === undefined || !stored}
  <section class={FRAME} aria-label={m.weather_hourly()}>
    {#if read?.failed}
      <div class="flex flex-col justify-center" style:height="{HOURS_HEIGHT}px">
        <LoadFailed
          text={m.weather_error()}
          refused={read.refused}
          onretry={() => {
            read = undefined;
            again++;
          }}
        />
      </div>
    {:else if stored === false}
      <p
        class="flex items-center justify-center text-xs text-muted-foreground"
        style:height="{HOURS_HEIGHT}px"
      >
        {m.weather_none()}
      </p>
    {:else}
      <Skeleton style="height: {HOURS_HEIGHT}px" role="status" aria-label={m.loading()} />
    {/if}
  </section>
{:else}
  <WeatherDays {days} {zone} now={day?.now.getTime() ?? 0} {sky} class={FRAME} />
{/if}
