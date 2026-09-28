/**
 * Plant-local period keys — `YYYY-MM-DDTHH` | `YYYY-MM-DD` | `YYYY-MM` — and the
 * periods of a window. The JS half of the rollup SQL's `to_char(... at time
 * zone $tz)` bucketing: zero-fill, the live-register override and the standing
 * charge all land on these keys, so they must match the SQL's exactly.
 */

import { zoneParts } from "@SunReye/inverter-core/zone-parts";
import { periodWindow } from "@SunReye/inverter-core/zoned-calendar";

/** Granularity of a cost / energy series bar. */
export type CostBucket = "hour" | "day" | "month";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Plant-local period key for a Date in zone `tz`, matching the `to_char`
 * masks of the rollup reader's matrix SQL, so the JS zero-fill/override keys line up
 * with the SQL `at time zone $tz` bucketing (issues #46, #52).
 */
function periodKey(d: Date, bucket: CostBucket, tz: string): string {
  const { year, month, day, hour } = zoneParts(tz, d.getTime());
  const ymd = `${year}-${pad2(month)}-${pad2(day)}`;
  if (bucket === "month") return `${year}-${pad2(month)}`;
  if (bucket === "day") return ymd;
  return `${ymd}T${pad2(hour)}`;
}

/**
 * The local period key `now` occupies at `bucket` granularity — i.e. the key of
 * the current, in-progress period in the counter-delta matrix's output.
 * Reuses {@link periodKey} so a live-register override lands on the exact same
 * key the matrix produced for today. `tz` must be the same plant zone the matrix
 * was bucketed in, or the override lands on the wrong bar.
 */
export function currentPeriodKey(bucket: CostBucket, now: Date, tz: string): string {
  return periodKey(now, bucket, tz);
}

/**
 * Each period in `[from, to)` at `bucket` granularity, oldest first: its local
 * key plus `[start, end)` bounds. Stepping uses local calendar fields so month
 * lengths and DST are handled by the Date arithmetic itself. Shared by the
 * zero-fill key list and per-period standing-charge proration.
 *
 * A period the window merely clips is left out. Callers pick calendar-aligned
 * windows, so a period only ends up part-covered when the caller's clock and
 * this server's disagree — a browser on Europe/Berlin asking for "this month"
 * sends 22:00 on the 31st, and the server would open the chart with a bar for
 * the previous month holding two hours of it. The cut-off is half a period, or
 * the whole window where that is shorter (today-by-day at 02:00 is two hours of
 * a day and still the only bar there is).
 */
export function eachPeriod(
  from: Date,
  to: Date,
  bucket: CostBucket,
  tz: string,
): Array<{ key: string; start: Date; end: Date }> {
  const out: Array<{ key: string; start: Date; end: Date }> = [];
  const windowMs = to.getTime() - from.getTime();
  // Boundaries are plant-local period starts resolved to real UTC instants in
  // `tz`, so month lengths and DST (23h/25h days) come from the zone rules, not
  // the host clock.
  let cur = periodWindow(from, tz, bucket).start;
  while (cur < to) {
    const next = periodWindow(cur, tz, bucket).end;
    const covered =
      Math.min(next.getTime(), to.getTime()) - Math.max(cur.getTime(), from.getTime());
    if (covered >= Math.min((next.getTime() - cur.getTime()) / 2, windowMs)) {
      out.push({ key: periodKey(cur, bucket, tz), start: new Date(cur), end: new Date(next) });
    }
    cur = next;
  }
  return out;
}

/**
 * Every local period key in `[from, to)` at `bucket` granularity, oldest first.
 * Drives zero-fill so the chart x-axis is stable and gap-free regardless of
 * which periods actually have data.
 */
export function periodKeysInRange(from: Date, to: Date, bucket: CostBucket, tz: string): string[] {
  return eachPeriod(from, to, bucket, tz).map((p) => p.key);
}
