// One forecast line's figures over the route's range: its measurement and forecast read from the
// core, then judged into bands, sums and the headline (ADR 17, 21).
import type { Core } from "../api/core.ts";
import { periodOf, rollups } from "../history/history.ts";
import { RangeData } from "../range/range-data.svelte.ts";
import { rangeKey } from "../range/range.ts";
import type { RangeRoute } from "../range/route.svelte.ts";
import { planned, type Part } from "./forecast.ts";
import { headline, judge, pastDays, summaryOf } from "./judge.ts";

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

  /** The judged line with its headline and a key that changes with range and line; null while loading. */
  readonly view = $derived.by(() => {
    const got = this.#data.current;

    if (!got) return null;

    const judged = judge({ ...got.data, list: got.list, spans: got.spans, now: got.now });

    return {
      ...judged,
      key: `${rangeKey(got.range)}|${got.data.series}`,
      said: headline(got.cal, got.range, judged),
    };
  });

  constructor(input: () => ForecastInput) {
    this.#data = new RangeData(
      () => input().route,
      (from, to, now) => {
        const { core, device, series, parts, route } = input();

        return read(core, device, series, parts, route, from, to, now);
      },
    );
  }

  /** The chart's bands; none while loading. */
  get bands() {
    return this.view?.bands ?? [];
  }

  /** Which stacked parts show: an optional one only while it holds energy. */
  get kept(): readonly number[] | null {
    return this.view?.kept ?? null;
  }

  /** The chart's sums while no band is read. */
  get summary() {
    return summaryOf(this.#data.title, this.view);
  }

  get via() {
    return this.#data.current?.via;
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
