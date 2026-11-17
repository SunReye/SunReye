// The PV, inverter and string sheets' facts over their range (ADR 21 "Sheet content"): the peak
// with its time, from the rollups' `max` (ADR 3), the range's forecast against what was measured, and
// the inverter's highest temperature where its profile maps one.
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
  /** The hottest rollup of the inverters' temperature; absent where no profile maps one. */
  readonly hottest?: Rolled | null;
}

/** What a PV sheet reads: its series, the inverters forecasting it, and whether it is the
 * inverter's, which also reads its temperature. */
export type PvSource = Readonly<Pick<Analytics, "device" | "series" | "forecast">> & {
  readonly inverter: boolean;
};

/** The range in ms since the epoch, measured up to `until`, cut in `period`. */
export interface PvSpan {
  readonly from: number;
  readonly until: number;
  readonly to: number;
  readonly period: RollupPeriod;
}

export type PvCore = MeasureCore & Readonly<Pick<Core, "forecasts" | "capabilities">>;

const TEMPERATURE = "inverter.temperature";

/** The rollup with the highest reading; null where none has one. */
function highest(rolled: readonly Rolled[]): Rolled | null {
  let best: Rolled | null = null;

  for (const r of rolled) if (r.max !== null && (best?.max ?? -Infinity) < r.max) best = r;

  return best;
}

/** The devices whose profile maps an inverter temperature; none while capabilities fail. */
async function thermometers(core: PvCore): Promise<number[]> {
  const caps = await core.capabilities().catch(() => null);

  if (caps === null || !("devices" in caps)) return [];

  return Object.keys(caps.devices)
    .filter((d) => caps.devices[d]?.series.includes(TEMPERATURE) === true)
    .map(Number);
}

/** The inverters' hottest rollup over the span; undefined where no profile maps a temperature. */
async function hottestOf(core: PvCore, span: Readonly<PvSpan>): Promise<Rolled | null | undefined> {
  const devices = await thermometers(core);

  if (devices.length === 0) return undefined;

  const [from, until] = [new Date(span.from), new Date(span.until)];

  const rolled = await Promise.all(
    devices.map((d) => rollups(strict(core), d, TEMPERATURE, span.period, from, until)),
  );

  return highest(rolled.flat());
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
export async function readPv(core: PvCore, a: PvSource, span: Readonly<PvSpan>): Promise<PvRead> {
  const [from, until] = [new Date(span.from), new Date(span.until)];
  const ran = span.from < span.until;

  const [rolled, forecast, hottest] = await Promise.all([
    ran ? rollups(strict(core), a.device, a.series, span.period, from, until) : [],
    forecastOf(core, a, span),
    a.inverter && ran ? hottestOf(core, span) : undefined,
  ]);

  const read = rolled.filter((r) => r.covered > 0);
  const measured = read.length === 0 ? null : read.reduce((s, r) => s + r.integral, 0) / 1000;
  const top = highest(rolled);

  // A string that never ran has no peak.
  const peak = (top?.max ?? 0) > 0 ? top : null;

  return { peak, measured, forecast, ...(hottest !== undefined && { hottest }) };
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

/** A rollup's highest reading in `unit`, noted with its hour or day. */
function topFact(label: string, top: Rolled | null, unit: string, at: Readonly<PvAt>): Fact {
  return {
    label,
    value: top?.max ?? null,
    unit,
    digits: 0,
    ...(top && { note: whenOf(top.start, at.hours, at.zone) }),
  };
}

/** The facts row: the peak with its hour, or past a day its day; the forecast and how much of it
 * was measured; the inverter's highest temperature where its profile maps one. */
export function pvFacts(read: Readonly<PvRead>, at: Readonly<PvAt>): Fact[] {
  const share = met(read);

  return [
    topFact(m.detail_peak(), read.peak, "W", at),
    {
      label: m.dash_forecast(),
      value: read.forecast,
      unit: "kWh",
      digits: 1,
      ...(share !== null && { note: m.detail_forecast_met({ share }) }),
    },
    ...(read.hottest === undefined
      ? []
      : [topFact(m.detail_temperature_max(), read.hottest, "°C", at)]),
  ];
}
