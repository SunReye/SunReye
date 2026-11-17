// A forecast line judged over a range (ADR 17): measured against forecast per band, the sums the
// headline and the legend share, and the headline sentence. Pure.
import type { Accuracy } from "../history/forecast.ts";
import { bandFigure, type Rolled } from "../history/history.ts";
import { phrase } from "../history/words.ts";
import { m } from "../paraglide/messages.js";
import type { Band } from "../range/bands.ts";
import type { Edge } from "../range/edges.ts";
import { bandsOf, spread } from "../range/fill.ts";
import { kwh } from "../range/format.ts";
import type { Calendar, Range } from "../range/range.ts";
import { plannedEnergy, type Planned } from "./forecast.ts";

/** What one line's range holds: its bands, and the sums the headline and the legend share. */
export interface Judged {
  readonly bands: Band[];
  /** kWh measured over the range. */
  readonly made: number;
  /** kWh forecast for the time measured, where a forecast exists. */
  readonly planned: number;
  /** Measured over `planned`, less 1, the band in progress included; null without a forecast. */
  readonly versus: number | null;
  /** kWh still expected from now to the range's end. */
  readonly ahead: number;
  /** kWh measured per stacked part (an MPPT input), or the one total when not stacked. */
  readonly shares: readonly number[];
  /** Which stacked parts show, by their index; an optional part only while it holds energy. */
  readonly kept: readonly number[];
  readonly accuracy: Accuracy;
}

/** The loaded range a line is judged over. */
export interface Judging {
  readonly series: string;
  readonly list: readonly Edge[];
  /** Each band as [start, end) in ms. */
  readonly spans: readonly (readonly [number, number])[];
  readonly now: number;
  readonly measured: readonly Rolled[];
  readonly forecast: readonly Planned[];
  /** The stacked parts' measurements, each less the parts beside it from the same input. */
  readonly parts?: readonly Readonly<{
    measured: readonly Rolled[];
    minus: readonly (readonly Rolled[])[];
    optional: boolean;
  }>[];
}

/**
 * Measured against forecast per band: a band with readings carries the forecast for its measured
 * time as its mark, a band not over yet its whole forecast as a faint bar. Whole days measured
 * against a forecast count towards the accuracy.
 */
/** One band's kWh: measured, forecast for its measured time, for all of it, and from now on. */
function weigh(j: Readonly<Judging>, a: number, b: number) {
  const f = bandFigure(j.series, j.measured, a, b);
  const measured = f.covered > 0;
  const until = Math.min(b, j.now);
  // Compared only where the forecast covers the band's time so far: a layout laid out mid-day has
  // a forecast for the rest of that day alone, against the whole day's production. A rollup says
  // how long it was read, not when, so readings over fewer hours prove nothing.
  const forecast = spread(j.forecast, a, until, () => 0).covered;
  const comparable = measured && forecast >= (until - a) * 0.95;

  return {
    covered: f.covered,
    value: measured ? Math.max(0, f.value) : 0,
    sofar: comparable ? plannedEnergy(j.forecast, a, until) : 0,
    whole: plannedEnergy(j.forecast, a, b),
    rest: b > j.now ? plannedEnergy(j.forecast, Math.max(a, j.now), b) : 0,
  };
}

/** A whole past day measured against a forecast: its deviation, as a share of the forecast. */
const deviation = (edge: Readonly<Edge>, value: number, sofar: number): number | null =>
  sofar > 0 && edge.state === "past" && edge.t1 - edge.t0 === 24
    ? Math.abs(value / sofar - 1)
    : null;

/** One band's measured kWh per stacked part; the total alone without two or more parts. */
function stack(j: Readonly<Judging>, total: number, a: number, b: number): number[] {
  const parts = j.parts ?? [];

  if (parts.length < 2) return [total];

  return parts.map((p) => {
    const f = bandFigure(j.series, p.measured, a, b);

    if (f.covered <= 0) return 0;

    const less = p.minus.reduce(
      (sum, other) => sum + Math.max(0, bandFigure(j.series, other, a, b).value),
      0,
    );

    // A few Wh either way is the strings' estimate against the input's own reading.
    return Math.max(0, f.value - less);
  });
}

/** The stacked parts that show: an optional one only while it holds energy over the range. */
function keptOf(j: Readonly<Judging>, shares: readonly number[]): number[] {
  const parts = j.parts ?? [];

  return shares.flatMap((share, k) => (parts[k]?.optional === true && share < 0.05 ? [] : [k]));
}

/** The whole past days judged so far: their deviations and their kWh measured and forecast. */
interface Days {
  readonly error: number;
  readonly count: number;
  readonly made: number;
  readonly planned: number;
}

/** `days` with a band that is a whole past day measured against a forecast; any other is left out. */
function countDay(
  days: Readonly<Days>,
  edge: Readonly<Edge>,
  w: Readonly<ReturnType<typeof weigh>>,
): Days {
  const dev = deviation(edge, w.value, w.sofar);

  return dev === null
    ? days
    : {
        error: days.error + dev,
        count: days.count + 1,
        made: days.made + w.value,
        planned: days.planned + w.sofar,
      };
}

/** The accuracy over whole past days alone (ADR 21 "Forecast tab"), the bias included. */
const accuracyOf = (days: Readonly<Days>): Accuracy => ({
  error: days.count > 0 ? days.error / days.count : null,
  bias: days.planned > 0 ? days.made / days.planned - 1 : null,
  days: days.count,
});

export function judge(j: Readonly<Judging>): Judged {
  const sums = { made: 0, compared: 0, sofar: 0, ahead: 0 };
  let days: Days = { error: 0, count: 0, made: 0, planned: 0 };
  const shares: number[] = [];

  const bands = bandsOf(j.list, (edge, i) => {
    const [a, b] = j.spans[i]!;
    const w = weigh(j, a, b);
    const compared = w.sofar > 0;

    sums.made += w.value;
    sums.ahead += w.rest;
    sums.compared += compared ? w.value : 0;
    sums.sofar += w.sofar;
    days = countDay(days, edge, w);

    const up = stack(j, w.value, a, b);

    for (const [k, v] of up.entries()) shares[k] = (shares[k] ?? 0) + v;

    return {
      up,
      down: [],
      mark: compared ? w.sofar : null,
      ghost: edge.state !== "past" && w.whole > 0 ? w.whole : null,
      covered: w.covered,
      elapsed: Math.max(0, Math.min(b, j.now) - a),
    };
  });

  const kept = keptOf(j, shares);

  return {
    bands:
      kept.length === shares.length
        ? bands
        : bands.map((band) => Object.assign(band, { up: kept.map((k) => band.up[k] ?? 0) })),
    made: sums.made,
    planned: sums.sofar,
    versus: sums.sofar > 0 ? sums.compared / sums.sofar - 1 : null,
    ahead: sums.ahead,
    shares: kept.map((k) => shares[k] ?? 0),
    kept,
    accuracy: accuracyOf(days),
  };
}

/** The chart's sums while no band is read: measured, its forecast, and what is still expected. */
export function summaryOf(
  title: string,
  j: Readonly<Pick<Judged, "made" | "planned" | "ahead" | "shares">> | null,
) {
  return {
    title,
    up: j && j.shares.length > 0 ? [...j.shares] : [j?.made ?? 0],
    down: [],
    mark: j && j.planned > 0 ? j.planned : null,
    ghost: j && j.ahead > 0 ? j.ahead : null,
  };
}

/** The headline: produced against the forecast over the range, and what is still to come. */
export function headline(
  cal: Readonly<Calendar>,
  range: Readonly<Range>,
  j: Readonly<Pick<Judged, "made" | "ahead" | "versus">>,
): string {
  const when = phrase(cal, range);
  // A figure never breaks from its unit.
  const made = kwh(j.made).replace(" ", "\u00A0");
  const ahead = kwh(j.ahead).replace(" ", "\u00A0");
  const still = j.ahead > 0 ? ` ${m.forecast_still({ ahead })}` : "";

  if (j.made <= 0)
    return j.ahead > 0 ? m.forecast_verdict_ahead({ when, ahead }) : m.forecast_verdict_none();

  if (j.versus === null) return m.forecast_verdict_made({ when, made }) + still;

  const share = Math.round(j.versus * 100);

  const said =
    share === 0
      ? m.forecast_verdict_even({ when, made })
      : m.forecast_verdict_compared({
          when,
          made,
          share: Math.abs(share),
          more: share > 0 ? m.stats_more() : m.stats_less(),
        });

  return said + still;
}
