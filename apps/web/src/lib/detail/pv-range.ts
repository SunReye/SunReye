// The PV, inverter and string sheets' facts over their range (ADR 21 "Sheet content"): the peak
// with its time, from the rollups' `max` (ADR 3), and the range's forecast against what was measured.
import type { Analytics } from "../analytics/sources.ts";
import type { Core } from "../api/core.ts";
import { planned, plannedEnergy, type Planned } from "../forecast/forecast.ts";
import { rollups, type Rolled, type RollupPeriod } from "../history/history.ts";
import { whenOf } from "../history/peaks.ts";
import { m } from "../paraglide/messages.js";
import { parseFigure, type Fact } from "./figures.ts";
import { strict, type MeasureCore } from "./measure.ts";

/** The PV sheets: PV, the inverter and each string. */
export const isPv = (id: string): boolean =>
  id === "pv" || id === "inverter" || parseFigure(id)?.kind === "string";

/** What the range read: its highest rollup, and its energy measured and forecast in kWh. */
export interface PvRead {
  readonly peak: Rolled | null;
  /** Null where nothing was read. */
  readonly measured: number | null;
  /** Null where nothing is forecast for the sheet's series. */
  readonly forecast: number | null;
}

/** The range in ms since the epoch, measured up to `until`, cut in `period`. */
export interface PvSpan {
  readonly from: number;
  readonly until: number;
  readonly to: number;
  readonly period: RollupPeriod;
}

export type PvCore = MeasureCore & Readonly<Pick<Core, "forecasts">>;

/** The rollup with the highest reading; null where none read above zero. */
function highest(rolled: readonly Rolled[]): Rolled | null {
  let best: Rolled | null = null;

  for (const r of rolled) if ((r.max ?? 0) > (best?.max ?? 0)) best = r;

  return best;
}

/** What the inverters forecast for the sheet's series over the whole range, in kWh. */
async function forecastOf(
  core: PvCore,
  a: Readonly<Pick<Analytics, "series" | "forecast">>,
  span: Readonly<PvSpan>,
): Promise<number | null> {
  const [from, to] = [new Date(span.from), new Date(span.to)];

  const plans: readonly (readonly Planned[])[] = await Promise.all(
    a.forecast.map((d) => planned(core, d, a.series, from, to)),
  );

  if (plans.every((p) => p.length === 0)) return null;

  return plans.reduce((sum, p) => sum + plannedEnergy(p, span.from, span.to), 0);
}

/** The sheet's series over the span; rejects when the core fails or refuses a rollup. */
export async function readPv(
  core: PvCore,
  a: Readonly<Pick<Analytics, "device" | "series" | "forecast">>,
  span: Readonly<PvSpan>,
): Promise<PvRead> {
  const [from, until] = [new Date(span.from), new Date(span.until)];

  const [rolled, forecast] = await Promise.all([
    span.from < span.until
      ? rollups(strict(core), a.device, a.series, span.period, from, until)
      : [],
    forecastOf(core, a, span),
  ]);

  const read = rolled.filter((r) => r.covered > 0);
  const measured = read.length === 0 ? null : read.reduce((s, r) => s + r.integral, 0) / 1000;

  return { peak: highest(rolled), measured, forecast };
}

/** Where the range stands: its bands are hours, and the plant's timezone. */
export interface PvAt {
  readonly hours: boolean;
  readonly zone: string;
}

/** How much of the forecast was measured, in whole %; null without both. */
function met({ measured, forecast }: Readonly<PvRead>): number | null {
  return measured === null || forecast === null || forecast <= 0
    ? null
    : Math.round((measured / forecast) * 100);
}

/** The facts row: the peak with its hour, or past a day its day; the forecast and how much of it
 * was measured. */
export function pvFacts(read: Readonly<PvRead>, at: Readonly<PvAt>): Fact[] {
  const { peak } = read;
  const share = met(read);

  return [
    {
      label: m.detail_peak(),
      value: peak?.max ?? null,
      unit: "W",
      digits: 0,
      ...(peak && { note: whenOf(peak.start, at.hours, at.zone) }),
    },
    {
      label: m.dash_forecast(),
      value: read.forecast,
      unit: "kWh",
      digits: 1,
      ...(share !== null && { note: m.detail_forecast_met({ share }) }),
    },
  ];
}
