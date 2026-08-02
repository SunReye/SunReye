/**
 * Adapters between the spot-price *analytics* payload (`/api/statistics/prices`,
 * ISO instants over a long window) and the day-ahead *panel* shapes the price
 * components already render (`$lib/prices/price-series`, market-local labels
 * over today+tomorrow).
 *
 * Pure and unit-tested, so the section component stays a layout: the two curves
 * at the top and the negative-window history below them are the same components
 * fed from two different sources, and only the shaping differs.
 */

import type { NegativeWindow as SpotNegativeWindow } from "server/src/spot-stats";
import { ctPerKwh, type NegativeWindow, type PriceRow } from "$lib/prices/price-series";

const DAY_MS = 86_400_000;
/** Fallback slot width when a curve holds a single row and cannot be measured. */
const DEFAULT_SLOT_MS = 900_000;

/** Local `HH:mm` of an instant. */
const hhmm = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Local `YYYY-MM-DD` of an instant. */
const isoDate = (ms: number): string => {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Start of the history list: the trailing `days` of the picked window, never
 * earlier than the window itself. The preference bounds how far back the list
 * reaches so a year-long range doesn't unroll into hundreds of rows, while the
 * picked range still decides what is in scope at all.
 */
export function historySince(from: Date, to: Date, days: number): number {
  return Math.max(from.getTime(), to.getTime() - days * DAY_MS);
}

/**
 * Server negative windows (UTC instants, EUR/MWh) as the panel's local-time,
 * ct/kWh windows — dropping everything before `sinceMs`.
 *
 * A window that straddles `sinceMs` is dropped rather than clipped: its stated
 * start, slot count and minimum would all describe a run the list isn't
 * showing in full.
 */
export function historyWindows(
  windows: readonly SpotNegativeWindow[],
  sinceMs: number,
): NegativeWindow[] {
  return windows
    .map((w) => ({ ...w, startMs: Date.parse(w.start), endMs: Date.parse(w.end) }))
    .filter((w) => w.startMs >= sinceMs)
    .map((w) => ({
      startMs: w.startMs,
      endMs: w.endMs,
      from: hhmm(w.startMs),
      to: hhmm(w.endMs),
      date: isoDate(w.startMs),
      slots: w.slots,
      minCtPerKwh: ctPerKwh(w.minEurPerMwh),
    }));
}

/** One market-local day of the day-ahead curve. */
export type DayCurve = {
  /** Market-local `YYYY-MM-DD`. */
  date: string;
  rows: PriceRow[];
};

/**
 * Split the day-ahead rows into their market-local days, in order — today
 * first, tomorrow second once it is published. Each curve is charted on its own
 * so a 24-hour axis stays readable instead of two days sharing 192 bands.
 */
export function dayCurves(rows: readonly PriceRow[]): DayCurve[] {
  const curves: DayCurve[] = [];
  for (const row of rows) {
    const date = row.key.slice(0, 10);
    const last = curves.at(-1);
    if (last?.date === date) last.rows.push(row);
    else curves.push({ date, rows: [row] });
  }
  return curves;
}

/**
 * Band key of the slot `nowMs` falls in, for the chart's now-marker; null when
 * the curve doesn't cover this instant (tomorrow, or a stale series). The slot
 * width is measured off the curve rather than assumed, so an hourly source
 * marks the right band too.
 */
export function nowBand(rows: readonly PriceRow[], nowMs: number): string | null {
  const first = rows[0];
  if (!first) return null;
  const step = (rows[1]?.startMs ?? first.startMs + DEFAULT_SLOT_MS) - first.startMs;
  const row = rows.find((r) => r.startMs <= nowMs && nowMs < r.startMs + step);
  return row?.label ?? null;
}
