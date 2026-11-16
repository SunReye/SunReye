// The statistics screen tests' recorded plant: yesterday and the day before as power curves, and
// the hourly and daily rollups the core makes of them (ADR 3).
import { iso } from "../range/calendar.ts";

const H = 3_600_000;
const DAY = 24 * H;

/** Today, as a day number in UTC. */
export const TODAY = Math.floor(Date.now() / DAY);

export const at = (day: number, h: number) => new Date((day * 24 + h) * H).toISOString();

const span = (day: number, h0: number, h1: number, mean: number) => ({
  start: at(day, h0),
  end: at(day, h1),
  mean,
});

/**
 * Yesterday 10–12 h: 3 kW sun, a 1 kW house, 2 kW out; 12–13 h unread; then 1 kW bought.
 * The day before: 2 kW sun 10–12 h only.
 */
export function series() {
  const y = TODAY - 1;

  return {
    "pv.power": [span(y - 1, 10, 12, 2000), span(y, 10, 12, 3000)],
    "load.power": [span(y - 1, 0, 24, 500), span(y, 10, 12, 1000), span(y, 13, 24, 1000)],
    "grid.import.power": [span(y - 1, 0, 24, 500), span(y, 13, 24, 1000)],
    "grid.export.power": [span(y - 1, 10, 12, 2000), span(y, 10, 12, 2000)],
    "self.consumption.power": [span(y, 10, 12, 1000)],
    "self.supply.power": [span(y, 10, 12, 1000)],
  };
}

/** A series' curves, each whole hour apart: its start in ms and its mean. */
function hours(name: string) {
  const curves = new Map(Object.entries(series())).get(name) ?? [];

  return curves.flatMap((p: Readonly<{ start: string; end: string; mean: number }>) => {
    const start = Date.parse(p.start);

    return Array.from({ length: (Date.parse(p.end) - start) / H }, (_, i) => ({
      t: start + i * H,
      mean: p.mean,
    }));
  });
}

/** Each recorded hour's or day's rollup of a series starting in [from, to). */
export function rollups(name: string, period: string, from: number, to: number) {
  const length = period === "hour" ? H : DAY;
  const sums = new Map<number, readonly [number, number, number]>();

  for (const { t, mean } of hours(name)) {
    const start = Math.floor(t / length) * length;
    const [wh, read, max] = sums.get(start) ?? [0, 0, 0];

    if (start >= from && start < to) sums.set(start, [wh + mean, read + 1, Math.max(max, mean)]);
  }

  return [...sums.keys()].map((start) => {
    const [wh, read, max] = sums.get(start)!;

    return {
      date: iso(Math.floor(start / DAY)),
      start: new Date(start).toISOString(),
      end: new Date(start + length).toISOString(),
      integral: wh,
      mean: wh / read,
      max,
      hours: read,
    };
  });
}
