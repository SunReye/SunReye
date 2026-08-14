/**
 * Row/window shaping for the day-ahead price panel. Pure and unit-tested, so the
 * components stay free of logic — the same split as `plan-series.ts` /
 * `decision-series.ts`.
 *
 * Display unit is **ct/kWh**, not the EUR/MWh the market quotes: a household
 * reads its bill in cents, and 18.4 ct/kWh is legible where 183.75 EUR/MWh is
 * not. The conversion is a plain ÷10 and the sign is preserved.
 */

import type { SpotPriceView } from "server/src/prices/spot-price-job";

type SpotPricePoint = SpotPriceView["series"][number];

/** EUR/MWh → ct/kWh, sign preserved. */
export const ctPerKwh = (eurPerMwh: number): number => eurPerMwh / 10;

/** A ct/kWh figure with its unit — the one display form for market prices. */
export const ctLabel = (ct: number): string =>
  `${ct.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ct`;

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

/**
 * A contiguous run of negative slots — one actionable window. Built from the
 * analytics endpoint's windows by `$lib/statistics/price-history`; the two
 * price components below render this shape whatever produced it.
 */
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

/** Total energy-time spent in negative slots, hours. */
export function negativeHours(windows: NegativeWindow[]): number {
  return windows.reduce((sum, w) => sum + (w.endMs - w.startMs) / 3_600_000, 0);
}

/** A contiguous stretch of negative bands, as the x-axis labels bounding it. */
export type NegativeBandRun = { first: string; last: string };

/** The band scale of a chart, as much of it as the span maths needs. */
export type BandScale = ((label: string) => number | undefined) & { bandwidth?: () => number };

/** Pixel span of one run on a band scale — where the shading goes. */
export function bandSpan(scale: BandScale, run: NegativeBandRun): { x: number; width: number } {
  const bandwidth = scale.bandwidth?.() ?? 0;
  const left = scale(run.first) ?? 0;
  const right = (scale(run.last) ?? 0) + bandwidth;
  return { x: left, width: Math.max(1, right - left) };
}

/**
 * The negative stretches of a curve, in band terms. The chart shades these
 * behind the bars: a quarter-hour at −0.5 ct beside a day peaking at 20 ct is
 * a hairline on the axis, and "when is power free" is the whole question the
 * curve is read for.
 */
export function negativeBandRuns(rows: readonly PriceRow[]): NegativeBandRun[] {
  const runs: NegativeBandRun[] = [];
  rows.forEach((row, i) => {
    if (!row.negative) return;
    const open = rows[i - 1]?.negative === true ? runs.at(-1) : undefined;
    if (open) open.last = row.label;
    else runs.push({ first: row.label, last: row.label });
  });
  return runs;
}
