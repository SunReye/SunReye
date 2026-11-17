// What the PV forecast sheet says of today and the two days after (ADR 21 "Details by drilling
// down"): each day's energy, its peak, its best window and each line's share, then how the
// forecast held so far. Pure.
import type { Accuracy } from "../history/forecast.ts";
import type { Rolled } from "../history/history.ts";
import { change } from "../history/words.ts";
import { edges } from "../range/edges.ts";
import { calendar, customRange, hourInstant } from "../range/range.ts";
import { plannedEnergy, type Planned } from "./forecast.ts";
import { judge } from "./judge.ts";

const HOUR = 3_600_000;

/** How many consecutive hours the best window spans: a wash or a charge fits in it. */
export const WINDOW_HOURS = 3;

/** The whole days before today the accuracy judges (ADR 21). */
const PAST_DAYS = 30;

/** One string or MPPT input of the forecast. */
export interface AheadLine {
  readonly label: string;
  readonly colour: string;
  readonly planned: readonly Planned[];
}

/** The forecasts the sheet read: the plant's, and each string's or each MPPT input's. */
export interface AheadRead {
  readonly plant: readonly Planned[];
  readonly lines: readonly AheadLine[];
}

/** Consecutive hours and the energy expected in them. */
export interface Window {
  readonly from: number;
  readonly to: number;
  readonly kwh: number;
}

export interface AheadDay {
  /** ms since 1970, [start, end). */
  readonly start: number;
  readonly end: number;
  /** kWh expected over the day. */
  readonly total: number;
  /** kWh still to come; null on a later day. */
  readonly remaining: number | null;
  readonly peak: { readonly watts: number; readonly at: number } | null;
  /** Its total against today's, as a share; null for today or against nothing. */
  readonly change: number | null;
  /** The `WINDOW_HOURS` that make the most; null on a day that makes nothing. */
  readonly window: Window | null;
  readonly lines: readonly (Pick<AheadLine, "label" | "colour"> & { readonly kwh: number })[];
}

/** The power forecast for the instant `at`, in W; null where no forecast covers it. */
export function powerAt(plant: readonly Planned[], at: number): number | null {
  return plant.find(({ start, end }) => start <= at && at < end)?.power ?? null;
}

/** The highest forecast power in [from, to) and when it begins. */
function peakOf(plant: readonly Planned[], from: number, to: number): AheadDay["peak"] {
  let top: AheadDay["peak"] = null;

  for (const { start, power } of plant)
    if (start >= from && start < to && power > (top?.watts ?? 0)) top = { watts: power, at: start };

  return top;
}

/** The `WINDOW_HOURS` whole hours of [from, to) that make the most; the earliest of equals. */
function windowOf(plant: readonly Planned[], from: number, to: number): Window | null {
  let best: Window | null = null;

  for (let a = from; a + WINDOW_HOURS * HOUR <= to; a += HOUR) {
    const b = a + WINDOW_HOURS * HOUR;
    const kwh = plannedEnergy(plant, a, b);

    if (kwh > (best?.kwh ?? 0)) best = { from: a, to: b, kwh };
  }

  return best;
}

/** Each of `spans` as the sheet shows it, the first today as of `now`. */
export function aheadDays(
  read: Readonly<AheadRead>,
  spans: readonly (readonly [number, number])[],
  now: number,
): AheadDay[] {
  const totals = spans.map(([from, to]) => plannedEnergy(read.plant, from, to));

  return spans.map(([start, end], i) => ({
    start,
    end,
    total: totals[i] ?? 0,
    remaining: i === 0 ? plannedEnergy(read.plant, Math.max(start, now), end) : null,
    peak: peakOf(read.plant, start, end),
    change: i === 0 ? null : change(totals[i] ?? 0, totals[0]),
    window: windowOf(read.plant, start, end),
    lines: read.lines.map(({ label, colour, planned }) => ({
      label,
      colour,
      kwh: plannedEnergy(planned, start, end),
    })),
  }));
}

/** How the forecast held: today so far, and over the whole days before it. */
export interface Track {
  /** Measured over forecast for the time measured today, less 1; null without both. */
  readonly sofar: number | null;
  /** Over the `PAST_DAYS` before today; its bias is not today's. */
  readonly accuracy: Accuracy;
}

/** Where the judged days begin: the plant midnight `PAST_DAYS` before today's. */
export function trackFrom(zone: string, now: number): Date {
  return hourInstant(zone, (calendar(zone, new Date(now)).today - PAST_DAYS) * 24);
}

/**
 * The plant's day rollups of `pv.power` against its forecast, judged as the Forecast screen
 * judges a range (ADR 21 "Forecast tab"): the `PAST_DAYS` before today and today itself.
 */
export function track(
  zone: string,
  now: number,
  measured: readonly Rolled[],
  forecast: readonly Planned[],
): Track {
  const cal = calendar(zone, new Date(now));
  const list = edges(cal, customRange(cal, cal.today - PAST_DAYS, cal.today + 1), "day");

  const spans = list.map(
    (e) => [hourInstant(zone, e.t0).getTime(), hourInstant(zone, e.t1).getTime()] as const,
  );

  const judged = judge({ series: "pv.power", list, spans, now, measured, forecast });
  const today = judged.bands.at(-1);
  const mark = today?.mark ?? null;

  return {
    sofar: mark === null ? null : (today?.up[0] ?? 0) / mark - 1,
    accuracy: judged.accuracy,
  };
}
