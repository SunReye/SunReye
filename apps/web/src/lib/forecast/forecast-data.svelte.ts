// One forecast line's figures over the route's range: its measurement and forecast read from the
// core, then judged into bands, sums and the headline (ADR 17, 21). The judging is a function of one
// load, so each pane of the card judges its own.
import type { Core } from "../api/core.ts";
import { periodOf, rollups } from "../history/history.ts";
import { RangeData, sumTitle, type Loaded } from "../range/range-data.svelte.ts";
import { rangeKey } from "../range/range.ts";
import type { RangeRoute } from "../range/route.svelte.ts";
import { planned, type Part } from "./forecast.ts";
import { headline, judge, pastDays, summaryOf } from "./judge.ts";

/** One load of a line's figures. */
export type ForecastRead = Loaded<Awaited<ReturnType<typeof read>>>;

/**
 * What a pane draws of a load: its bands, sums and headline, with a key that changes with range and
 * line; with none, it draws loading.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a load is never written.
export function forecastPane(got: Readonly<ForecastRead> | null) {
  if (!got)
    return {
      loading: true,
      key: "",
      said: null,
      bands: [],
      kept: null,
      summary: summaryOf("", null),
      accuracy: null,
      via: undefined,
    };

  const judged = judge({ ...got.data, list: got.list, spans: got.spans, now: got.now });

  return {
    loading: false,
    key: `${rangeKey(got.range)}|${got.data.series}`,
    said: headline(got.cal, got.range, judged),
    bands: judged.bands,
    kept: judged.kept,
    summary: summaryOf(sumTitle(got), judged),
    accuracy: judged.accuracy,
    via: got.via,
  };
}

/** What one line's figures are read from. */
export interface ForecastInput {
  core: Core;
  device: number;
  series: string;
  /** The parts stacked in the bars; empty for one bar. */
  parts: readonly Part[];
  route: RangeRoute;
}

export class ForecastData {
  readonly #data: RangeData<Awaited<ReturnType<typeof read>>>;

  constructor(input: () => ForecastInput) {
    this.#data = new RangeData(
      () => input().route,
      (from, to, now) => {
        const { core, device, series, parts, route } = input();

        return read(core, device, series, parts, route, from, to, now);
      },
    );
  }

  get travel() {
    return this.#data.travel;
  }

  /** The last read of the range failed. */
  get failed(): boolean {
    return this.#data.failed;
  }

  retry = (): void => {
    this.#data.retry();
  };

  drill = (i: number): void => {
    this.#data.drill(i);
  };

  brush = (a: number, b: number): void => {
    this.#data.brush(a, b);
  };
}

async function read(
  core: Readonly<Pick<Core, "statistics" | "forecasts">>,
  device: number,
  series: string,
  parts: readonly Part[],
  route: Readonly<Pick<RangeRoute, "range" | "place">>,
  from: Readonly<Date>,
  to: Readonly<Date>,
  now: number,
) {
  const until = Math.min(to.getTime(), now);
  const period = periodOf(route.range);

  const measuredOf = (s: string, p = period) =>
    from.getTime() < until ? rollups(core, device, s, p, from, new Date(until)) : [];

  const names = [...new Set(parts.flatMap((p) => [p.series, ...p.minus]))];

  const [measured, daily, forecast, ...rolled] = await Promise.all([
    measuredOf(series),
    // The accuracy judges whole days, whatever the bands are.
    period === "day" ? null : measuredOf(series, "day"),
    planned(core, device, series, from, to),
    ...names.map((s) => measuredOf(s)),
  ]);

  const spans = pastDays(route.place.zone, route.range, now);

  const of = (s: string) => rolled[names.indexOf(s)] ?? [];

  return {
    series,
    measured,
    forecast,
    days: { spans, measured: daily ?? measured },
    parts: parts.map((p) => ({
      measured: of(p.series),
      minus: p.minus.map(of),
      optional: p.optional,
    })),
  };
}
