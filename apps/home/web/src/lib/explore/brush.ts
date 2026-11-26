// The range a mouse drag across a chart's time axis narrows to (ADR 21), on the plant's calendar.
import { plantNow } from "../plant-day.ts";
import {
  customRange,
  grainOf,
  rangeKey,
  spanRange,
  type Calendar,
  type Range,
} from "../range/range.ts";

/**
 * The range between two instants of `range`, in either order: the plant-local hours they touch,
 * or their whole days in a range of days. Null when that is the range itself.
 */
export function narrowed(
  zone: string,
  cal: Calendar,
  range: Range,
  a: number,
  b: number,
): Range | null {
  const hourOf = (t: number) => {
    const { day, hour } = plantNow(zone, new Date(t));

    return day * 24 + hour;
  };

  const [from, to] = [hourOf(Math.min(a, b)), hourOf(Math.max(a, b) - 1) + 1];

  const next =
    grainOf(range) === "hour"
      ? spanRange(cal, from, to)
      : customRange(cal, Math.floor(from / 24), Math.ceil(to / 24));

  return rangeKey(next) === rangeKey(range) ? null : next;
}
