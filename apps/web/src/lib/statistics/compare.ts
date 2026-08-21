// Period-over-period math for the statistics page: the signed change a delta
// chip renders, and the reference window the server compared against (mirrors
// `previousWindow` in apps/server/src/statistics/statistics-calc.ts) so the page can tell
// when that window predates recorded history and the delta would be fiction.

import type { CostBreakdown } from "@SunReye/contracts/energy";
import type { CompareMode, ComparisonResponse } from "@SunReye/contracts/statistics";
import * as m from "$lib/paraglide/messages";

/**
 * Signed relative change from `previous` to `current`, as a fraction
 * (0.12 = +12%). `null` — rendered as an em-dash — whenever the change is not
 * meaningful: either figure missing, or a zero/non-finite reference that would
 * make every change infinite.
 */
export function deltaFor(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** Past this, a percentage stops informing: "+11 780 %" only says the reference
 *  window was near zero. The chip caps, the aria-label keeps the real figure. */
const DELTA_CAP_PCT = 999;

/**
 * A delta as the chip renders it: an arrow for the sign and a whole percent,
 * capped so a near-zero baseline cannot blow the tile's layout apart. Null —
 * no usable reference — is an em-dash, which keeps the row aligned.
 */
export function formatDelta(delta: number | null): string {
  if (delta === null) return "—";
  const arrow = delta > 0 ? "▲" : "▼";
  const pct = Math.abs(Math.round(delta * 100));
  return pct > DELTA_CAP_PCT ? `${arrow} >${DELTA_CAP_PCT}%` : `${arrow} ${pct}%`;
}

/**
 * The part of a picked range that has actually happened — what a comparison is
 * priced over.
 *
 * A calendar period's `to` is its exclusive end, and for the CURRENT period that
 * is in the future on purpose: `$lib/cost/ranges#costRangeFor` keeps the whole
 * period so the live lease holds and the detail chart has a settled axis. The
 * comparison must not spend it. The server has this month's data up to now and
 * all thirty-one days of last month, so an unclamped window prices twenty days
 * against thirty-one and every delta chip reads as a collapse that never
 * happened.
 *
 * `windowDays` and {@link referenceWindow} both take their span from the clamped
 * window, so the caption ("vs the previous 2 days") and the reference the server
 * priced cannot disagree.
 *
 * A window that has not STARTED is returned untouched: clamping it would put
 * `to` before `from` and hand the server a negative-length reference.
 */
export function pricedWindow(
  range: { from: Date; to: Date },
  now: Date = new Date(),
): { from: Date; to: Date } {
  const clamp = now.getTime() > range.from.getTime() && now.getTime() < range.to.getTime();
  return clamp ? { from: range.from, to: now } : range;
}

/**
 * The window the comparison endpoint priced as the reference for `[from, to)`:
 * the adjacent same-length window, or the same calendar window a year back.
 */
export function referenceWindow(from: Date, to: Date, mode: CompareMode): { from: Date; to: Date } {
  if (mode === "yearAgo") {
    const shift = (d: Date) => {
      const shifted = new Date(d);
      shifted.setFullYear(shifted.getFullYear() - 1);
      return shifted;
    };
    return { from: shift(from), to: shift(to) };
  }
  const length = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - length), to: new Date(from) };
}

/**
 * Whether the reference window is fully covered by recorded history. Without
 * this check a household's first month shows a fake −100% against a window
 * that simply has no data; `dataFrom` is the earliest daily rollup the server
 * reports.
 */
function referenceCovered(reference: { from: Date }, dataFrom: string | null): boolean {
  if (!dataFrom) return false;
  return reference.from.getTime() >= new Date(dataFrom).getTime();
}

/**
 * Split a comparison payload into the breakdown to show and the reference one
 * worth comparing against — the latter drops to null when its window predates
 * recorded history, which suppresses the delta chips instead of inventing one.
 */
export function usableComparison(
  payload: ComparisonResponse | null,
  reference: { from: Date },
): { current: CostBreakdown | null; previous: CostBreakdown | null } {
  if (!payload) return { current: null, previous: null };
  const covered = referenceCovered(reference, payload.coverage.dataFrom);
  return { current: payload.current, previous: covered ? payload.previous : null };
}

/**
 * What a delta is measured against, in words ("yesterday", "the previous 7
 * days", "the same period a year ago"). An arrow with no baseline is
 * unreadable, so every chip carries this.
 */
export function baselineLabel(mode: CompareMode, days: number): string {
  if (mode === "yearAgo") return m.statistics_baseline_year_ago();
  return days === 1
    ? m.statistics_baseline_previous_day()
    : m.statistics_baseline_previous_days({ days });
}

/** Midnight starting the civil day `d` falls in, in the viewer's own zone — the
 *  zone `rangeSpan`'s dates are already formatted in. */
const startOfCivilDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Civil days the window `[from, to)` TOUCHES, at least 1 — the "vs previous {n}
 * days" caption.
 *
 * Counted from date parts rather than as `round(span / 86_400_000)`, because the
 * window this is asked about is usually a partial day long: {@link pricedWindow}
 * clamps the period the reader is standing in at `now`, so the month tab on the
 * 21st is 20 days and however many hours it is. Rounding that reads "the
 * previous 20 days" before midday and "21 days" after it — the same window, the
 * same figures, the same comparison the server made, and a caption that re-bases
 * itself over lunch. Days touched is 21 from midnight to midnight.
 *
 * Rounding UP the ms span would fix the flip and break a different case: a
 * calendar month across an autumn fall-back is 31 days and an hour, and `ceil`
 * calls that 32 days. Both boundaries of such a window are midnights, so
 * counting the days between them lands on 31. The `round` here only absorbs the
 * DST hour between two midnights; it can no longer see a partial day.
 *
 * `to` is exclusive, so the last covered instant is the day that gets counted —
 * a window ending at midnight stops on the previous day, not on the empty one
 * that starts there.
 */
export function windowDays(from: Date, to: Date): number {
  const lastCovered = startOfCivilDay(new Date(to.getTime() - 1));
  const days = (lastCovered.getTime() - startOfCivilDay(from).getTime()) / 86_400_000;
  return Math.max(1, Math.round(days) + 1);
}
