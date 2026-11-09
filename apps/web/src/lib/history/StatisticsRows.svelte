<script lang="ts">
  import type { Period } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { energy, type Figures } from "./history.ts";

  let { points, series, period }: { points: readonly Figures[]; series: string; period: Period } =
    $props();

  const number = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 });

  /** A plant-local date as written, never shifted into the viewer's zone (ADR 3). */
  const dates: Readonly<Record<Period, Intl.DateTimeFormat>> = {
    day: new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeZone: "UTC" }),
    week: new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeZone: "UTC" }),
    month: new Intl.DateTimeFormat(getLocale(), {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  };

  function label(date: string): string {
    const shown = dates[period].format(new Date(`${date}T00:00:00Z`));

    return period === "week" ? m.history_week_of({ date: shown }) : shown;
  }

  /** An SI symbol, the same in every locale. */
  function kwh(point: Readonly<Figures>): string {
    const value = energy(series, point);

    return value === null ? "–" : `${number.format(value)} kWh`;
  }

  function figure(value: number | null | undefined): string {
    const known = value ?? null;

    return known === null ? "–" : number.format(known);
  }
</script>

{#if points.length === 0}
  <p>{m.history_empty()}</p>
{:else}
  <table>
    <thead>
      <tr>
        <th>{m.history_date()}</th>
        <th>{m.history_energy()}</th>
        <th>{m.history_mean()}</th>
        <th>{m.history_min()}</th>
        <th>{m.history_max()}</th>
      </tr>
    </thead>
    <tbody>
      {#each points as point (point.date)}
        <tr>
          <td>{label(point.date)}</td>
          <td>{kwh(point)}</td>
          <td>{figure(point.mean)}</td>
          <td>{figure(point.min)}</td>
          <td>{figure(point.max)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
