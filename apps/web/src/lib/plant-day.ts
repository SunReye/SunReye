// The plant-local day (ADR 3): "today" starts at the plant's midnight, whatever the viewer's zone.

/** How far `zone`'s wall clock is ahead of UTC at `at`, in ms. */
function offset(zone: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);

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
