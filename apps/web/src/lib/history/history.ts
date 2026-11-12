// One series' history over a range (ADR 9): the core picks the tier; a band reads a power's
// energy or any other series' mean.
import type { Core, History } from "../api/core.ts";
import { spread, type Span } from "../range/fill.ts";

/** One stored mean over [start, end), in ms since the epoch. */
export interface Mean extends Span {
  readonly mean: number;
}

/** A power series is charted as its energy; any other as its mean. */
export const isPower = (series: string): boolean => /\.power(\[\d+\])?$/u.test(series);

/** The series' means from `from` to before `to`, at the tier the core picks (ADR 9). */
export async function means(
  core: Readonly<Pick<Core, "history">>,
  device: number,
  series: string,
  from: Readonly<Date>,
  to: Readonly<Date>,
): Promise<Mean[]> {
  const history = await core.history(device, series, new Date(from), new Date(to));

  return "points" in history
    ? history.points.map((p: Readonly<History["points"][number]>) => ({
        start: Date.parse(p.start),
        end: Date.parse(p.end),
        mean: p.mean,
      }))
    : [];
}

/** A band's figure from [from, to): a power's energy in kWh, any other series' time-weighted mean. */
export function bandFigure(series: string, points: readonly Mean[], from: number, to: number) {
  const { sum, covered } = spread(points, from, to, (p) => p.mean * (p.end - p.start));

  if (isPower(series)) return { value: sum / 3_600_000_000, covered };

  return { value: covered > 0 ? sum / covered : 0, covered };
}
