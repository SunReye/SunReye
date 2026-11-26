// A range as the hash route holds it: `range`, and `at` a day in it, or a custom range's `from`
// and `to` as a date and an optional hour (`2026-06-12T08`).
import { dayOf, iso } from "./calendar.ts";
import {
  isCurrent,
  isKind,
  rangeFor,
  spanRange,
  type Calendar,
  type Kind,
  type Range,
} from "./range.ts";

function dayParam(s: string | null): number | null {
  const match = s?.match(/^(\d{4})-(\d{2})-(\d{2})/u);

  return match ? dayOf(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

/** The hour a custom bound names: `T08` on a start is 08:00, on an end up to 08:00. */
function hourParam(s: string | null, end: boolean): number | null {
  const day = dayParam(s);

  if (day === null) return null;

  const match = s?.match(/T(\d{2})$/u);

  return day * 24 + (match ? Math.min(24, Number(match[1])) : end ? 24 : 0);
}

/** The route's parameters a range owns; leaving the screen clears them. */
export const RANGE_PARAMS = ["range", "at", "from", "to"] as const;

/** The range a route names; the current month when it names none. */
export function parseRange(cal: Calendar, p: Readonly<URLSearchParams>): Range {
  const named = p.get("range");
  const kind = isKind(named) ? named : "month";

  if (kind === "custom") {
    return spanRange(
      cal,
      hourParam(p.get("from"), false) ?? cal.today * 24,
      hourParam(p.get("to"), true) ?? (cal.today + 1) * 24,
    );
  }

  return rangeFor(kind, Math.min(cal.last, dayParam(p.get("at")) ?? cal.today));
}

const hourSuffix = (hour: number | undefined): string =>
  hour === undefined ? "" : `T${String(hour).padStart(2, "0")}`;

/** A range as the route's parameters; null removes one. */
export type RangeParams = Readonly<{
  range: Kind;
  at: string | null;
  from: string | null;
  to: string | null;
}>;

/** The parameters that put a range into the route. */
export function rangeParams(cal: Calendar, r: Range): RangeParams {
  if (r.kind === "custom") {
    return {
      range: "custom",
      at: null,
      from: iso(r.from) + hourSuffix(r.h0),
      to: iso(r.to - 1) + hourSuffix(r.h1),
    };
  }

  return { range: r.kind, at: isCurrent(cal, r) ? null : iso(r.from), from: null, to: null };
}
