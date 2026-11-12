// When in the day energy flows (ADR 21): hour of day against the range's days, or its months
// when the range is long. Days and hours are plant-local, counted since 1970-01-01.
import type { Core } from "../api/core.ts";
import { means, type Mean } from "../history/history.ts";
import { civil, fmt } from "../range/calendar.ts";
import type { Place } from "../range/range-data.svelte.ts";
import { hourInstant, rangeFor, step, type Calendar, type Range } from "../range/range.ts";

/** One column of the heat grid: its hours [t0, t1), its axis label and the range it opens. */
export interface HeatColumn {
  readonly label: string;
  readonly tick: boolean;
  readonly title: string;
  readonly t0: number;
  readonly t1: number;
  readonly drill: Range;
}

export interface HeatColumns {
  readonly by: "day" | "month";
  readonly cols: readonly HeatColumn[];
}

/** Past this many days a column is a month; the core reads hourly rollups up to about 62. */
const DAYS = 62;

/** Months a long range shows, the latest. */
const MONTHS = 36;

function days(from: number, to: number): HeatColumn[] {
  const short = to - from <= 7;
  const stride = short ? 1 : 5;

  return Array.from({ length: to - from }, (_, i) => {
    const d = from + i;

    return {
      label: short ? fmt("weekday", d).replace(".", "") : String(civil(d).getUTCDate()),
      tick: i % stride === 0,
      title: fmt("dayLong", d),
      t0: d * 24,
      t1: d * 24 + 24,
      drill: rangeFor("day", d),
    };
  });
}

function months(r: Range): HeatColumn[] {
  const all: Range[] = [];
  const free: Calendar = { today: r.from, hour: 0, last: Number.MAX_SAFE_INTEGER };

  for (let s = rangeFor("month", r.from); s.from < r.to; s = step(free, s, 1)) all.push(s);

  const shown = all.slice(-MONTHS);
  const short = shown.length <= 12;
  const stride = short ? 1 : Math.ceil(shown.length / 6);

  return shown.map((s, i) => ({
    label: short ? fmt("monthShort", s.from).replace(".", "") : fmt("monthShortYear", s.from),
    tick: i % stride === 0,
    title: fmt("monthYear", s.from),
    t0: Math.max(s.from, r.from) * 24,
    t1: Math.min(s.to, r.to) * 24,
    drill: s,
  }));
}

/** The grid's columns: a day shows its week, a long range its months. */
export function heatColumns(r: Range): HeatColumns {
  if (r.to - r.from > DAYS) return { by: "month", cols: months(r) };

  const window = r.kind === "day" ? rangeFor("week", r.from) : r;

  return { by: "day", cols: days(window.from, window.to) };
}

/** The grid's cells, `[col][hour]`, and the largest of them. */
export interface HeatCells {
  readonly cells: (number | null)[][];
  readonly max: number;
}

/**
 * Each column's hours of day, `[col][hour]`: the mean over its days of `read(t)`. A past hour
 * without a reading is null, a gap; an hour not yet come is NaN.
 * @param now the running hour, since 1970-01-01
 */
export function heatCells(
  cols: readonly HeatColumn[],
  read: (t: number) => number | null,
  now: number,
): HeatCells {
  let max = 0;

  const cells = cols.map((col) =>
    Array.from({ length: 24 }, (_, hour) => {
      let [sum, n, past] = [0, 0, false];

      for (let t = col.t0 - (col.t0 % 24) + hour; t < col.t1; t += 24) {
        if (t < col.t0 || t >= now) continue;

        past = true;

        const v = read(t);

        if (v !== null) [sum, n] = [sum + v, n + 1];
      }

      if (n === 0) return past ? null : Number.NaN;

      max = Math.max(max, sum / n);

      return sum / n;
    }),
  );

  return { cells, max };
}

/** The time-weighted mean of `pick` over [from, to) from `points` on, and the time it covers. */
function meanOver(
  points: readonly Mean[],
  first: number,
  [from, to]: readonly [number, number],
  pick: (watts: number) => number,
) {
  let [sum, covered] = [0, 0];

  for (let j = first; j < points.length && points[j]!.start < to; j++) {
    const p = points[j]!;
    const inside = Math.min(to, p.end) - Math.max(from, p.start);

    if (inside > 0) [sum, covered] = [sum + pick(p.mean) * inside, covered + inside];
  }

  return covered > 0 ? sum / covered : null;
}

/**
 * Each hour's energy in kWh from mean powers: `bounds` are the hours' starts and the last end,
 * in ms; `pick` maps a mean in W to the power counted, such as import only. Null without readings.
 */
export function hourly(
  points: readonly Mean[],
  bounds: readonly number[],
  pick: (watts: number) => number,
): (number | null)[] {
  const out: (number | null)[] = [];
  let first = 0;

  for (let i = 0; i + 1 < bounds.length; i++) {
    const [from, to] = [bounds[i]!, bounds[i + 1]!];

    while (first < points.length && points[first]!.end <= from) first++;

    const watts = meanOver(points, first, [from, to], pick);

    out.push(watts === null ? null : (watts * (to - from)) / 3_600_000_000);
  }

  return out;
}

/** What the heat grid shows: its columns, cells and largest cell. */
export interface Heat extends HeatColumns, HeatCells {}

/** The power read per hour: a device's series, counted by `pick`. */
export interface HeatSource {
  readonly device: number;
  readonly series: string;
  readonly pick: (watts: number) => number;
}

/** The hours [t0, t1) as instants in `zone`: each start and the last end, in ms. */
const instants = (zone: string, t0: number, t1: number): number[] =>
  Array.from({ length: t1 - t0 + 1 }, (_, i) => hourInstant(zone, t0 + i).getTime());

/**
 * The heat grid of range `r` from the core's hourly means: one read for a run of days, one per
 * month for a long range, so each stays inside the core's hourly tier.
 */
export async function readHeat(
  core: Readonly<Pick<Core, "history">>,
  source: HeatSource,
  place: Place,
  r: Range,
): Promise<Heat> {
  const { by, cols } = heatColumns(r);
  const { zone, cal } = place;
  const now = Date.now();

  const windows =
    by === "day"
      ? [[cols[0]!.t0, cols.at(-1)!.t1] as const]
      : cols.map((c) => [c.t0, c.t1] as const);

  const read = new Map<number, number>();

  await Promise.all(
    windows.map(async ([t0, t1]) => {
      const bounds = instants(zone, t0, t1);
      const until = Math.min(bounds.at(-1)!, now);

      if (bounds[0]! >= until) return;

      const points = await means(
        core,
        source.device,
        source.series,
        new Date(bounds[0]!),
        new Date(until),
      );

      hourly(points, bounds, source.pick).forEach((v, i) => {
        if (v !== null) read.set(t0 + i, v);
      });
    }),
  );

  return { by, cols, ...heatCells(cols, (t) => read.get(t) ?? null, cal.today * 24 + cal.hour) };
}
