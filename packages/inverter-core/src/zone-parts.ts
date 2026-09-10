/**
 * The wall clock of an instant in an IANA zone, as numbers.
 *
 * Every zone-aware calculation in the repo starts here: a delivery day's
 * midnight in the market's zone (`apps/server/src/prices/spot-price.ts`), a
 * calendar period's boundaries in the plant's or the viewer's
 * (`apps/web/src/lib/time/period.ts`). Both used to carry their own copy of the
 * same `formatToParts` + "read a part as a number" pair; this is that pair, once.
 *
 * It lives in this package because this is the only package the server AND the
 * web app may both import (see `.fallowrc.json` boundaries) — not because a wall
 * clock is an inverter concern.
 *
 * It answers what the zone SAYS at an instant and nothing more. It does not
 * choose a zone: which zone a caller means — the plant's, the market's, the
 * viewer's — is a decision those callers must keep making for themselves
 * (issue #46).
 */

/** The wall-clock fields of one instant. Month is 1-12; hour is 0-23. */
export interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * One `Intl.DateTimeFormat` per zone: constructing one is expensive, and these
 * are called per slot and per period boundary.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/**
 * The wall clock `timeZone` shows at `atMs`.
 *
 * `hour` is normalised to 0-23: `h23` renders midnight as 00, but some engines
 * have emitted 24, and a 24 fed to `Date.UTC` silently becomes the next day.
 */
export function zoneParts(timeZone: string, atMs: number): ZoneParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(atMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * The same wall clock expressed as the UTC instant of those digits. The
 * difference from `atMs` is the zone's offset there, and equality with a target
 * says a wall clock resolves back to itself.
 */
export function wallClockAsUtc(timeZone: string, atMs: number): number {
  const p = zoneParts(timeZone, atMs);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}
