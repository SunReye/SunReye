// How well the solar forecast held (ADR 15, 17): measured production per band against the latest
// forecast issued for it, and what is still expected. Pure but for `readForecast`.
import type { Core } from "../api/core.ts";
import { combined, type Target } from "../dashboard/today.ts";
import type { Band } from "../range/bands.ts";
import { bandsOf, intervals, spread } from "../range/fill.ts";
import { num } from "../range/format.ts";
import { bandSum } from "./flows.ts";
import { delta } from "./words.ts";
import type { Loaded } from "./stats.svelte.ts";

/** The plant's forecast over [from, to): each inverter's `pv.power` summed (ADR 17). */
export async function readForecast(
  core: Readonly<Pick<Core, "forecasts">>,
  inverters: readonly number[],
  from: number,
  to: number,
): Promise<Target[]> {
  const reads = await Promise.all(
    inverters.map((id) => core.forecasts(id, "pv.power", new Date(from), new Date(to))),
  );

  const each: Target[][] = [];

  for (const read of reads) each.push("points" in read ? read.points : []);

  return combined(each);
}

/** kWh of forecast in [a, b). */
function expected(targets: readonly Target[], a: number, b: number): number {
  const slots = intervals(targets, (t) => Date.parse(t.target));

  return spread(slots, a, b, (s) => (s.item.value * (s.end - s.start)) / 3_600_000_000).sum;
}

export interface Accuracy {
  /** Mean absolute deviation per whole day, as a share of its forecast. */
  readonly error: number | null;
  /** Measured over forecast, less 1. */
  readonly bias: number | null;
  readonly days: number;
}

export interface ForecastView {
  readonly bands: Band[];
  readonly measured: number;
  readonly forecast: number;
  readonly accuracy: Accuracy;
}

export function forecastView(got: Loaded, targets: readonly Target[]): ForecastView {
  let [measured, forecast, error, days] = [0, 0, 0, 0];

  const bands = bandsOf(got.list, (edge, i) => {
    const [a, b] = got.spans[i]!;
    const s = bandSum(got.plant, edge.t1 - edge.t0, a, b);
    const fc = expected(targets, a, b);
    const past = edge.state === "past" && s.covered > 0 && fc > 0;

    if (past) {
      [measured, forecast] = [measured + s.production, forecast + fc];

      if (edge.t1 - edge.t0 === 24)
        [error, days] = [error + Math.abs(s.production / fc - 1), days + 1];
    }

    return {
      up: [s.production],
      down: [],
      mark: past ? fc : null,
      ghost: edge.state === "past" || fc <= 0 ? null : fc,
      covered: s.covered,
      elapsed: Math.max(0, Math.min(b, got.now) - a),
    };
  });

  return {
    bands,
    measured,
    forecast,
    accuracy: {
      error: days > 0 ? error / days : null,
      bias: forecast > 0 ? measured / forecast - 1 : null,
      days,
    },
  };
}

/** The accuracy's three figures as written; dashes while loading or without a forecast. */
export function accuracyText(acc: Accuracy, loading: boolean): [string, string, string] {
  const dash = <T>(v: T | null, f: (v: T) => string) => (loading || v === null ? "–" : f(v));

  return [
    dash(acc.error, (v) => `${num(v * 100)} %`),
    dash(acc.bias, (v) => delta(v)),
    dash(acc.days, String),
  ];
}
