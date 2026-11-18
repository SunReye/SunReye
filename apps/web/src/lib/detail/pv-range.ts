// The PV, inverter and string sheets' facts over their range (ADR 21 "Sheet content"): the peak
// with its time, from the rollups' `max` (ADR 3), the range's forecast against what was measured, and
// the inverter's highest temperature where its profile maps one.
import type { Core } from "../api/core.ts";
import { planned, plannedEnergy, type Planned } from "../forecast/forecast.ts";
import { periodOf, rollups, type Rolled, type RollupPeriod } from "../history/history.ts";
import { highest, peakIn } from "../history/peaks.ts";
import { m } from "../paraglide/messages.js";
import { grainOf } from "../range/range.ts";
import { peakFact, type RangeAt } from "./facts.ts";
import type { Fact } from "./figures.ts";
import { strict, type MeasureCore } from "./measure.ts";
import type { RangeInput, RangeReader } from "./sheet-range.svelte.ts";

/** What the range read: its highest rollup, and its energy measured and forecast in kWh. */
export interface PvRead {
  readonly peak: Rolled | null;
  /** Null where nothing was read. */
  readonly measured: number | null;
  /** Null where nothing is forecast for the sheet's series. */
  readonly forecast: number | null;
  /** The hottest rollup of the inverters' temperature; absent where no profile maps one. */
  readonly hottest?: Rolled | null;
  /** The series is computed, not measured, as a string's sharing its input (ADR 17). */
  readonly estimated: boolean;
}

/** What a PV sheet reads: its series, the inverters forecasting it, and whether it is the
 * inverter's, which also reads its temperature. */
export interface PvSource {
  readonly device: number;
  readonly series: string;
  /** The inverters whose forecasts of `series` add up to what the sheet expects. */
  readonly forecast: readonly number[];
  readonly inverter: boolean;
}

/** The range in ms since the epoch, measured up to `until`, cut in `period`. */
interface PvSpan {
  readonly from: number;
  readonly until: number;
  readonly to: number;
  readonly period: RollupPeriod;
}

export type PvCore = MeasureCore & Readonly<Pick<Core, "forecasts" | "capabilities">>;

const TEMPERATURE = "inverter.temperature";

type Supported = Readonly<
  Record<string, Readonly<{ series: readonly string[]; estimated: readonly string[] }>>
>;

/** What each device's profile maps; none while capabilities fail. */
async function supportOf(core: PvCore): Promise<Supported> {
  const caps = await core.capabilities().catch(() => null);

  return caps !== null && "devices" in caps ? caps.devices : {};
}

/** The inverters' hottest rollup over the span; undefined where no profile maps a temperature. */
async function hottestOf(
  core: PvCore,
  support: Supported,
  span: Readonly<PvSpan>,
): Promise<Rolled | null | undefined> {
  const devices = Object.keys(support)
    .filter((d) => support[d]?.series.includes(TEMPERATURE) === true)
    .map(Number);

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
  a: Readonly<Pick<PvSource, "series" | "forecast">>,
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
async function readPv(core: PvCore, a: PvSource, span: Readonly<PvSpan>): Promise<PvRead> {
  const [from, until] = [new Date(span.from), new Date(span.until)];
  const ran = span.from < span.until;
  const supported = supportOf(core);

  const [rolled, forecast, support, hottest] = await Promise.all([
    ran ? rollups(strict(core), a.device, a.series, span.period, from, until) : [],
    forecastOf(core, a, span),
    supported,
    // A failed temperature read states none, and leaves the peak and forecast standing.
    a.inverter && ran
      ? supported.then((s) => hottestOf(core, s, span)).catch(() => null)
      : undefined,
  ]);

  const estimated = support[String(a.device)]?.estimated.includes(a.series) === true;

  const read = rolled.filter((r) => r.covered > 0);
  const measured = read.length === 0 ? null : read.reduce((s, r) => s + r.integral, 0) / 1000;
  // A string that never ran has no peak.
  const peak = peakIn(rolled);

  return { peak, measured, forecast, estimated, ...(hottest !== undefined && { hottest }) };
}

/** How much of the forecast was measured, in whole %; null without both. */
function met({ measured, forecast }: Readonly<PvRead>): number | null {
  return measured === null || forecast === null || forecast <= 0
    ? null
    : Math.round((measured / forecast) * 100);
}

/** The facts row: the peak with its hour, or past a day its day; the forecast and how much of it
 * was measured; the inverter's highest temperature where its profile maps one. */
function pvFacts(read: Readonly<PvRead>, at: Readonly<RangeAt>): Fact[] {
  const share = met(read);

  return [
    peakFact(read.estimated ? `${m.detail_peak()} ≈` : m.detail_peak(), read.peak, "W", at),
    {
      label: m.dash_forecast(),
      value: read.forecast,
      unit: "kWh",
      digits: 1,
      ...(share !== null && { note: m.detail_forecast_met({ share }) }),
    },
    ...(read.hottest === undefined
      ? []
      : [peakFact(m.detail_temperature_max(), read.hottest, "°C", at)]),
  ];
}

export interface PvInput extends RangeInput {
  readonly core: PvCore;
  readonly source: PvSource;
}

/** The facts row; null unread. */
export const PV_RANGE = {
  load: (input, from, to, now) => {
    const { core, route, source } = input();

    return readPv(core, source, {
      from: from.getTime(),
      until: Math.min(to.getTime(), now),
      to: to.getTime(),
      period: periodOf(route.range),
    });
  },
  view: (got, input) =>
    got &&
    pvFacts(got.data, { hours: grainOf(got.range) === "hour", zone: input().route.place.zone }),
} satisfies RangeReader<PvInput, PvRead, Fact[] | null>;
