/**
 * Wall-clock calendar math in an explicit IANA time zone, independent of the
 * server process zone.
 *
 * The energy/cost/statistics rollups bucket by *plant-local* calendar day, hour
 * and month. The naive `Date#getFullYear()/getHours()` read the *host* process
 * zone, so a container left on UTC files a Berlin plant's evening onto the wrong
 * day (issues #46, #52). These helpers take the zone as a parameter so the plant
 * zone — not the host — decides the fields, and the JS zero-fill keys match the
 * SQL `at time zone $tz` bucketing exactly.
 */

export interface ZonedFields {
  /** Full year, e.g. 2026. */
  year: number;
  /** Calendar month 1–12. */
  month: number;
  /** Day of month 1–31. */
  day: number;
  /** Hour of day 0–23. */
  hour: number;
}

/** Formatter cache — one `Intl.DateTimeFormat` per zone (constructing is costly). */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(tz, f);
  }
  return f;
}

interface FullFields extends ZonedFields {
  minute: number;
  second: number;
}

function fullFields(instant: Date, tz: string): FullFields {
  const parts = formatterFor(tz).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  // `h23` renders midnight as 00, but some engines historically emitted 24 — normalise.
  const hour = get("hour") % 24;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** The wall-clock calendar fields of `instant` in zone `tz` (host-independent). */
export function zonedFields(instant: Date, tz: string): ZonedFields {
  const { year, month, day, hour } = fullFields(instant, tz);
  return { year, month, day, hour };
}

/** The signed offset (ms) of zone `tz` from UTC at `instant` — positive east. */
function zoneOffsetMs(instant: Date, tz: string): number {
  const f = fullFields(instant, tz);
  const asUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return asUtc - instant.getTime();
}

/**
 * The UTC instant of a wall-clock moment `y-mo-d h:00:00` in zone `tz`.
 *
 * A wall-clock is resolved by treating it as UTC, reading the zone's offset at
 * that provisional instant, and correcting — then correcting once more, since a
 * DST transition can make the offset at the corrected instant differ from the
 * first read (the ±1h ambiguous/skipped hours around a transition).
 */
export function zonedInstant(y: number, mo: number, d: number, h: number, tz: string): Date {
  const asUtc = Date.UTC(y, mo - 1, d, h);
  let inst = new Date(asUtc - zoneOffsetMs(new Date(asUtc), tz));
  inst = new Date(asUtc - zoneOffsetMs(inst, tz));
  return inst;
}

/** Start (local midnight, as a UTC instant) of the calendar day `instant` falls in, in `tz`. */
export function startOfZonedDay(instant: Date, tz: string): Date {
  const { year, month, day } = zonedFields(instant, tz);
  return zonedInstant(year, month, day, 0, tz);
}

/** ISO weekday (1=Mon … 7=Sun) of `instant`'s calendar day in zone `tz`. */
export function zonedIsoWeekday(instant: Date, tz: string): number {
  const { year, month, day } = zonedFields(instant, tz);
  // The wall-clock date read as a UTC calendar date has the same weekday; UTC
  // avoids the host-zone shift that a plain `getDay()` would apply.
  const utcDow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun … 6=Sat
  return ((utcDow + 6) % 7) + 1;
}

/** `YYYY-MM-DD` calendar-day key of `instant` in zone `tz`. */
export function zonedDateKey(instant: Date, tz: string): string {
  const { year, month, day } = zonedFields(instant, tz);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
