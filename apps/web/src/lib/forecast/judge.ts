// A forecast line judged over a range (ADR 17): measured against forecast per band, the sums the
// headline and the legend share, and the headline sentence. Pure.
import type { Accuracy } from "../history/forecast.ts";
import { bandFigure, type Rolled } from "../history/history.ts";
import { phrase } from "../history/words.ts";
import { m } from "../paraglide/messages.js";
import type { Band } from "../range/bands.ts";
import type { Edge } from "../range/edges.ts";
import { bandsOf } from "../range/fill.ts";
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
  /** kWh still expected from now to the range's end. */
  readonly ahead: number;
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

  return {
    covered: f.covered,
    value: measured ? Math.max(0, f.value) : 0,
    sofar: measured ? plannedEnergy(j.forecast, a, Math.min(b, j.now)) : 0,
    whole: plannedEnergy(j.forecast, a, b),
    rest: b > j.now ? plannedEnergy(j.forecast, Math.max(a, j.now), b) : 0,
  };
}

/** A whole past day measured against a forecast: its deviation, as a share of the forecast. */
const deviation = (edge: Readonly<Edge>, value: number, sofar: number): number | null =>
  sofar > 0 && edge.state === "past" && edge.t1 - edge.t0 === 24
    ? Math.abs(value / sofar - 1)
    : null;

export function judge(j: Readonly<Judging>): Judged {
  const sums = { made: 0, compared: 0, sofar: 0, ahead: 0, error: 0, days: 0 };

  const bands = bandsOf(j.list, (edge, i) => {
    const [a, b] = j.spans[i]!;
    const w = weigh(j, a, b);
    const dev = deviation(edge, w.value, w.sofar);
    const compared = w.sofar > 0;

    sums.made += w.value;
    sums.ahead += w.rest;
    sums.compared += compared ? w.value : 0;
    sums.sofar += w.sofar;

    if (dev !== null) [sums.error, sums.days] = [sums.error + dev, sums.days + 1];

    return {
      up: [w.value],
      down: [],
      mark: compared ? w.sofar : null,
      ghost: edge.state !== "past" && w.whole > 0 ? w.whole : null,
      covered: w.covered,
      elapsed: Math.max(0, Math.min(b, j.now) - a),
    };
  });

  return {
    bands,
    made: sums.made,
    planned: sums.sofar,
    ahead: sums.ahead,
    accuracy: {
      error: sums.days > 0 ? sums.error / sums.days : null,
      bias: sums.sofar > 0 ? sums.compared / sums.sofar - 1 : null,
      days: sums.days,
    },
  };
}

/** The chart's sums while no band is read: measured, its forecast, and what is still expected. */
export function summaryOf(
  title: string,
  j: Readonly<Pick<Judged, "made" | "planned" | "ahead">> | null,
) {
  return {
    title,
    up: [j?.made ?? 0],
    down: [],
    mark: j && j.planned > 0 ? j.planned : null,
    ghost: j && j.ahead > 0 ? j.ahead : null,
  };
}

/** The headline: produced against the forecast over the range, and what is still to come. */
export function headline(
  cal: Readonly<Calendar>,
  range: Readonly<Range>,
  j: Readonly<Pick<Judged, "made" | "ahead" | "accuracy">>,
): string {
  const when = phrase(cal, range);
  // A figure never breaks from its unit.
  const [made, ahead] = [kwh(j.made), kwh(j.ahead)].map((v) => v.replace(" ", "\u00A0"));
  const still = j.ahead > 0 ? ` ${m.forecast_still({ ahead })}` : "";

  if (j.made <= 0)
    return j.ahead > 0 ? m.forecast_verdict_ahead({ when, ahead }) : m.forecast_verdict_none();

  if (j.accuracy.bias === null) return m.forecast_verdict_made({ when, made }) + still;

  const share = Math.round(j.accuracy.bias * 100);

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
