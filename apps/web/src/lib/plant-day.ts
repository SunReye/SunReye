// The plant-local day (ADR 3): "today" starts at the plant's midnight, whatever the viewer's zone.

/** One formatter per zone: building one costs far more than formatting with it. */
const WALLS = new Map<string, Intl.DateTimeFormat>();

function wallOf(zone: string): Intl.DateTimeFormat {
  let wall = WALLS.get(zone);

  if (!wall) {
    wall = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    WALLS.set(zone, wall);
  }

  return wall;
}

/** Offsets already worked out, per zone and whole second: History asks for the same hours often. */
const OFFSETS = new Map<string, Map<number, number>>();

/** Bounds each zone's cache; a year of hours, twice over, fits. */
const KEPT = 20_000;

/** How far `zone`'s wall clock is ahead of UTC at `at`, in ms. */
function offset(zone: string, at: number): number {
  const second = at - (at % 1000);
  let known = OFFSETS.get(zone);

  if (!known) {
    known = new Map();
    OFFSETS.set(zone, known);
  }

  let ahead = known.get(second);

  if (ahead === undefined) {
    if (known.size >= KEPT) known.clear();

    ahead = wallAt(zone, second) - second;
    known.set(second, ahead);
  }

  return ahead;
}

/** `zone`'s wall clock at `at`, read as if it were UTC, in ms. */
function wallAt(zone: string, at: number): number {
  const field: Record<string, number> = {};

  for (const { type, value } of wallOf(zone).formatToParts(at)) field[type] = Number(value);

  return Date.UTC(
    field["year"] ?? 0,
    (field["month"] ?? 1) - 1,
    field["day"] ?? 1,
    field["hour"] ?? 0,
    field["minute"] ?? 0,
    field["second"] ?? 0,
  );
}

/** The instant the plant-local day holding `now` began in `zone`, an IANA name. */
export function plantMidnight(zone: string, now: Readonly<Date>): Date {
  const wall = new Date(now.getTime() + offset(zone, now.getTime()));
  const date = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  // The offset at midnight can differ from now's on a day the clocks change.
  const guess = date - offset(zone, date);

  return new Date(date - offset(zone, guess));
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The instant `hour` (0–24) of plant-local calendar `day`, counted in days since 1970-01-01, began. */
export function plantInstant(zone: string, day: number, hour: number): Date {
  const wall = day * DAY_MS + hour * HOUR_MS;
  const guess = wall - offset(zone, wall);

  return new Date(wall - offset(zone, guess));
}

/** The plant-local calendar day, since 1970-01-01, and the hour that `now` falls in. */
export function plantNow(zone: string, now: Readonly<Date>) {
  const wall = now.getTime() + offset(zone, now.getTime());

  return { day: Math.floor(wall / DAY_MS), hour: Math.floor((wall % DAY_MS) / HOUR_MS) };
}
