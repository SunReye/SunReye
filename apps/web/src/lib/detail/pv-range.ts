// The PV, inverter and string sheets' facts over their range (ADR 21 "Sheet content"): the peak
// with its time, from the rollups' `max` (ADR 3).
import type { Analytics } from "../analytics/sources.ts";
import { rollups, type Rolled, type RollupPeriod } from "../history/history.ts";
import { whenOf } from "../history/peaks.ts";
import { m } from "../paraglide/messages.js";
import { parseFigure, type Fact } from "./figures.ts";
import { strict, type MeasureCore } from "./measure.ts";

/** The PV sheets: PV, the inverter and each string. */
export const isPv = (id: string): boolean =>
  id === "pv" || id === "inverter" || parseFigure(id)?.kind === "string";

/** What the range read: its highest rollup. */
export interface PvRead {
  readonly peak: Rolled | null;
}

/** A span read, in ms since the epoch, cut in `period`. */
export interface PvSpan {
  readonly from: number;
  readonly to: number;
  readonly period: RollupPeriod;
}

/** The rollup with the highest reading; null where none read above zero. */
function highest(rolled: readonly Rolled[]): Rolled | null {
  let best: Rolled | null = null;

  for (const r of rolled) if ((r.max ?? 0) > (best?.max ?? 0)) best = r;

  return best;
}

/** The sheet's series over the span; rejects when the core fails or refuses. */
export async function readPv(
  core: MeasureCore,
  a: Readonly<Pick<Analytics, "device" | "series">>,
  span: Readonly<PvSpan>,
): Promise<PvRead> {
  const rolled = await rollups(
    strict(core),
    a.device,
    a.series,
    span.period,
    new Date(span.from),
    new Date(span.to),
  );

  return { peak: highest(rolled) };
}

/** Where the range stands: its bands are hours, and the plant's timezone. */
export interface PvAt {
  readonly hours: boolean;
  readonly zone: string;
}

/** The facts row: the peak with its hour, or past a day its day. */
export function pvFacts(read: Readonly<PvRead>, at: Readonly<PvAt>): Fact[] {
  const { peak } = read;

  return [
    {
      label: m.detail_peak(),
      value: peak?.max ?? null,
      unit: "W",
      digits: 0,
      ...(peak && { note: whenOf(peak.start, at.hours, at.zone) }),
    },
  ];
}
