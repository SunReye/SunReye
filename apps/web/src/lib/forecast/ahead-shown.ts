// The PV forecast sheet's read as its days draw it (ADR 21 "Details by drilling down"): each
// day's figures with its curve and its sky, the widest bar, and how the forecast holds. Pure.
import { dayRows, type DayRow } from "../dashboard/today.ts";
import type { Hour } from "../weather/hourly.ts";
import type { Ahead } from "./ahead-read.ts";
import { aheadDays, powerAt, track, type AheadDay, type Track } from "./ahead.ts";

/** A day with what it draws: its curve by the quarter hour and its sky by the hour. */
export interface ShownDay extends AheadDay {
  readonly rows: readonly DayRow[];
  /** The power forecast for each of `rows`, in W: a target's holds to the next. */
  readonly expected: readonly (number | null)[];
  readonly hours: readonly Hour[];
  /** Hours of sunshine; null without a value. */
  readonly sunshine: number | null;
}

export interface Shown {
  readonly days: readonly ShownDay[];
  /** The most any line makes on any of the days, in kWh: the full bar. */
  readonly top: number;
  readonly track: Track;
}

/**
 * `ahead` as of `now` in the plant's `zone`.
 * @param today today's curve as the dashboard read it, measured to its last read
 */
export function shown(
  ahead: Readonly<Ahead>,
  today: readonly DayRow[],
  zone: string,
  now: number,
): Shown {
  const { plant } = ahead.read;

  const days = aheadDays(ahead.read, ahead.spans, now).map((day, i): ShownDay => {
    const rows =
      i === 0
        ? today
        : dayRows([], ahead.targets, { start: new Date(day.start), end: new Date(day.end) });

    return Object.assign({}, day, {
      rows,
      expected: rows.map((row) => powerAt(plant, row.time.getTime())),
      hours: ahead.weather[i]?.hours ?? [],
      sunshine: ahead.weather[i]?.sunshine ?? null,
    });
  });

  return {
    days,
    top: Math.max(0, ...days.flatMap((day) => day.lines.map((line) => line.kwh))),
    // Measured as of the read, so judged as of it: the forecast so far must not run ahead.
    track: track(zone, ahead.asOf, ahead.measured, plant),
  };
}
