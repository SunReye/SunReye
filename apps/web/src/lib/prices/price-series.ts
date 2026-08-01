/**
 * Row/window shaping for the day-ahead price panel. Pure and unit-tested, so the
 * components stay free of logic — the same split as `plan-series.ts` /
 * `decision-series.ts`.
 *
 * Display unit is **ct/kWh**, not the EUR/MWh the market quotes: a household
 * reads its bill in cents, and 18.4 ct/kWh is legible where 183.75 EUR/MWh is
 * not. The conversion is a plain ÷10 and the sign is preserved.
 */

import type { SpotPriceView } from "server/src/spot-price-job";

type SpotPricePoint = SpotPriceView["series"][number];

/** EUR/MWh → ct/kWh, sign preserved. */
const ctPerKwh = (eurPerMwh: number): number => eurPerMwh / 10;

/** One band of the price chart. */
export type PriceRow = {
  /** Band key: the market-local `YYYY-MM-DDTHH:mm` (unique across both days). */
  key: string;
  /** Axis label — `HH:mm`, with the date only where the day turns over. */
  label: string;
  startMs: number;
  ctPerKwh: number;
  /**
   * Diverging halves. layerchart's `stackDiverging` wants the positive and
   * negative parts as separate series, so exactly one of these is non-zero per
   * band and the axis crosses at zero on its own.
   */
  positiveCt: number;
  negativeCt: number;
  negative: boolean;
  /** True for the first slot of a market-local day — drives the axis date label. */
  dayStart: boolean;
};

const timeOf = (time: string): string => time.slice(11, 16);
const dateOf = (time: string): string => time.slice(0, 10);

/** Chart rows for every slot in the view, oldest first. */
export function priceRows(view: SpotPriceView): PriceRow[] {
  let previousDate = "";
  return view.series.map((p: SpotPricePoint) => {
    const ct = ctPerKwh(p.eurPerMwh);
    const date = dateOf(p.time);
    const dayStart = date !== previousDate;
    previousDate = date;
    return {
      key: p.time,
      // Only the day's first band carries its date, so a 192-band two-day
      // axis doesn't repeat "2026-08-02" 96 times.
      label: dayStart ? `${date.slice(5)} ${timeOf(p.time)}` : timeOf(p.time),
      startMs: p.startMs,
      ctPerKwh: ct,
      positiveCt: Math.max(0, ct),
      negativeCt: Math.min(0, ct),
      negative: p.negative,
      dayStart,
    };
  });
}

/** A contiguous run of negative slots — one actionable window. */
export type NegativeWindow = {
  startMs: number;
  /** Exclusive end: the start of the first non-negative slot after the run. */
  endMs: number;
  /** Market-local `HH:mm` bounds, for the label. */
  from: string;
  to: string;
  /** Market-local date the window starts on, `YYYY-MM-DD`. */
  date: string;
  slots: number;
  /** Deepest (most negative) price in the run, ct/kWh. */
  minCtPerKwh: number;
};

/** Minutes to add to a `HH:mm` label, wrapping to `24:00` at the end of a day. */
function addMinutes(hhmm: string, minutes: number): string {
  const total = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + minutes;
  const h = Math.floor(total / 60);
  return `${String(h).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Contiguous runs of negative slots.
 *
 * Adjacency is checked on the *instant*, not on array position, so a gap in the
 * stored series splits a window instead of silently joining two runs that have
 * unpriced time between them. Runs are also split at a market-local day boundary:
 * "tonight" and "tomorrow morning" are different things to act on even when the
 * prices are continuous across midnight.
 */
export function negativeWindows(view: SpotPriceView): NegativeWindow[] {
  const stepMs = view.series[0] ? 900_000 : 0;
  const out: NegativeWindow[] = [];
  let run: SpotPricePoint[] = [];

  const flush = () => {
    const first = run[0];
    const last = run.at(-1);
    if (!first || !last) return;
    const stepMinutes = stepMs / 60_000;
    out.push({
      startMs: first.startMs,
      endMs: last.startMs + stepMs,
      from: timeOf(first.time),
      to: addMinutes(timeOf(last.time), stepMinutes),
      date: dateOf(first.time),
      slots: run.length,
      minCtPerKwh: Math.min(...run.map((p) => ctPerKwh(p.eurPerMwh))),
    });
    run = [];
  };

  for (const point of view.series) {
    if (!point.negative) {
      flush();
      continue;
    }
    const previous = run.at(-1);
    const contiguous =
      previous !== undefined &&
      point.startMs === previous.startMs + stepMs &&
      dateOf(point.time) === dateOf(previous.time);
    if (previous !== undefined && !contiguous) flush();
    run.push(point);
  }
  flush();
  return out;
}

/** Total energy-time spent in negative slots, hours. */
export function negativeHours(windows: NegativeWindow[]): number {
  return windows.reduce((sum, w) => sum + (w.endMs - w.startMs) / 3_600_000, 0);
}
