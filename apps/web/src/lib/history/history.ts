// One series' rollups over a range (ADR 3, 9): a band reads a power's energy or any other series'
// mean from the core's hourly or daily rollups, never by integrating a history.
import type { Core } from "../api/core.ts";
import { grainOf, t0Of, t1Of, type Range } from "../range/range.ts";

const H = 3_600_000;

/** The longest read of each period the core serves (ADR 9), less a margin. */
const PIECE = { hour: 1400 * H, day: 1400 * 24 * H } as const;

/** An hour's or day's rollup, in ms since the epoch. */
export interface Rolled {
  readonly start: number;
  readonly end: number;
  /** The unit times hours: Wh for a power. */
  readonly integral: number;
  readonly mean: number;
  /** The highest reading; null without one. */
  readonly max: number | null;
  /** How long it had a value, in ms. */
  readonly covered: number;
}

export type RollupPeriod = "hour" | "day";

/** The integral of the rollups that read anything; null where none did, never 0. */
export function coveredSum(rolled: readonly Rolled[]): number | null {
  let sum: number | null = null;

  for (const r of rolled) if (r.covered > 0) sum = (sum ?? 0) + r.integral;

  return sum;
}

/** A power series is charted as its energy; any other as its mean. */
export const isPower = (series: string): boolean => /\.power(\[\d+\])?$/u.test(series);

/** Whole days read day rollups; hour bands, or a range cut inside a day, hourly ones. */
export const periodOf = (r: Range): RollupPeriod =>
  grainOf(r) === "hour" || t0Of(r) % 24 !== 0 || t1Of(r) % 24 !== 0 ? "hour" : "day";

/** [from, to) cut into pieces of a period's longest read. */
function piecesOf(period: RollupPeriod, from: number, to: number): (readonly [number, number])[] {
  const pieces: (readonly [number, number])[] = [];

  for (let a = from; a < to; a += PIECE[period]) pieces.push([a, Math.min(to, a + PIECE[period])]);

  return pieces;
}

/** The series' rollups starting from `from` to before `to`, read in pieces the core serves. */
export async function rollups(
  core: Readonly<Pick<Core, "statistics">>,
  device: number,
  series: string,
  period: RollupPeriod,
  from: Readonly<Date>,
  to: Readonly<Date>,
): Promise<Rolled[]> {
  const reads = await Promise.all(
    piecesOf(period, from.getTime(), to.getTime()).map((p) =>
      core.statistics(device, series, period, new Date(p[0]), new Date(p[1])),
    ),
  );

  const out: Rolled[] = [];

  for (const read of reads)
    for (const p of "points" in read ? read.points : [])
      out.push({
        start: Date.parse(p.start),
        end: Date.parse(p.end),
        integral: p.integral ?? 0,
        mean: p.mean ?? 0,
        max: p.max ?? null,
        covered: (p.hours ?? 0) * H,
      });

  return out;
}

/**
 * A band's figure from the rollups starting in [from, to): a power's energy in kWh, any other
 * series' mean weighted by the time each was read.
 */
export function bandFigure(series: string, rolled: readonly Rolled[], from: number, to: number) {
  let [integral, weighted, covered] = [0, 0, 0];

  for (const r of rolled)
    if (r.start >= from && r.start < to)
      [integral, weighted, covered] = [
        integral + r.integral,
        weighted + r.mean * r.covered,
        covered + r.covered,
      ];

  if (isPower(series)) return { value: integral / 1000, covered };

  return { value: covered > 0 ? weighted / covered : 0, covered };
}
