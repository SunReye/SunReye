<!--
  One day of the PV forecast sheet (ADR 21 "Details by drilling down"): its energy, then the sky by
  three hours over the day's curve, measured against forecast today and the forecast alone later,
  then each string's or MPPT input's expected energy as a small bar. Under the pointer, or a
  finger held on it, the curve says its quarter hour (ADR 21 "Chart reading").
-->
<script lang="ts">
  import DayChart from "../dashboard/DayChart.svelte";
  import { flowColour } from "../energy-colours.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { formatPower } from "../power.ts";
  import DayRows from "../weather/DayRows.svelte";
  import WeatherRow from "../weather/WeatherRow.svelte";
  import type { ShownDay } from "./ahead-shown.ts";
  import DayEnergy from "./DayEnergy.svelte";
  import LineBars from "./LineBars.svelte";

  let {
    day,
    now,
    zone,
    linesTitle,
    top,
  }: {
    day: ShownDay;
    /** ms since 1970. */
    now: number;
    zone: string;
    /** What the lines are: strings or MPPT inputs. */
    linesTitle: string;
    /** The most any line makes on any of the days, in kWh: the full bar. */
    top: number;
  } = $props();

  const SOLAR = flowColour("solar");

  const span = $derived([day.start, day.end] as const);

  /** Today is the day with something still to come. */
  const today = $derived(day.remaining !== null);

  const clock = $derived(
    new Intl.DateTimeFormat(getLocale(), { hour: "2-digit", minute: "2-digit", timeZone: zone }),
  );

  /** The curve's highest power, measured or forecast, as its row's figure: today's alone, as a
   * later day's head states its peak. */
  const highest = $derived.by(() => {
    if (!today) return null;

    const kw = Math.max(0, ...day.rows.map((r) => Math.max(r.forecast ?? 0, r.actual ?? 0)));

    return kw > 0 ? `0 – ${formatPower(kw * 1000)}` : null;
  });

  /** The index of the quarter hour being read; null with none. */
  let at = $state<number | null>(null);

  const row = $derived(at === null ? null : (day.rows[at] ?? null));

  const power = (watts: number | null) => (watts === null ? "–" : formatPower(watts));

  /** Its measured power, then its forecast; a later day's forecast alone. */
  const read = $derived.by(() => {
    if (at === null || row === null) return null;

    const expected = power(day.expected[at] ?? null);

    return today ? [power(row.actual === null ? null : row.actual * 1000), expected] : [expected];
  });
</script>

<div class="flex flex-col gap-4">
  <DayEnergy {day} {zone} />

  <DayRows hours={day.hours} {span} {zone} {now} slots={day.rows.length} bind:read={at}>
    <WeatherRow
      label={today ? m.rd_power() : m.dash_forecast()}
      also={today ? { label: m.dash_forecast(), colour: SOLAR, dashed: true } : null}
      figure={highest}
      {read}
    >
      {#snippet tail()}
        {#if row !== null}
          <span class="text-muted-foreground">{clock.format(row.time)}</span>
        {/if}
      {/snippet}
      <div class="h-28 w-full" role="img" aria-label={today ? m.rd_power() : m.dash_forecast()}>
        <DayChart rows={day.rows} now={new Date(now)} hours={clock} bare />
      </div>
    </WeatherRow>
  </DayRows>

  {#if day.lines.length > 0}
    <LineBars title={linesTitle} lines={day.lines} {top} />
  {/if}
</div>
