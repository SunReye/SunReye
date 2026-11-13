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

/** How far `zone`'s wall clock is ahead of UTC at `at`, in ms. */
function offset(zone: string, at: number): number {
  const parts = wallOf(zone).formatToParts(at);

  const field = new Map<string, number>();

  for (const { type, value } of parts) field.set(type, Number(value));

  const wall = Date.UTC(
    field.get("year") ?? 0,
    (field.get("month") ?? 1) - 1,
    field.get("day") ?? 1,
    field.get("hour") ?? 0,
    field.get("minute") ?? 0,
    field.get("second") ?? 0,
  );

  return wall - (at - (at % 1000));
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
