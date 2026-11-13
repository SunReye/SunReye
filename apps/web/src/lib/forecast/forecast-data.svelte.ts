// One forecast line's figures over the route's range: its measurement and forecast read from the
// core, then judged into bands, sums and the headline (ADR 17, 21).
import type { Core } from "../api/core.ts";
import { periodOf, rollups } from "../history/history.ts";
import { RangeData } from "../range/range-data.svelte.ts";
import { rangeKey } from "../range/range.ts";
import type { RangeRoute } from "../range/route.svelte.ts";
import { planned } from "./forecast.ts";
import { headline, judge, summaryOf } from "./judge.ts";

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

  constructor(
    input: () => {
      core: Core;
      device: number;
      series: string;
      /** MPPT input series stacked in the bars; empty for one bar. */
      parts: readonly string[];
      route: RangeRoute;
    },
  ) {
    this.#data = new RangeData(
      () => input().route,
      (from, to, now) => {
        const { core, device, series, parts, route } = input();

        return read(core, device, series, parts, periodOf(route.range), from, to, now);
      },
    );
  }

  /** The chart's bands; none while loading. */
  get bands() {
    return this.view?.bands ?? [];
  }

  /** The chart's sums while no band is read. */
  get summary() {
    return summaryOf(this.#data.title, this.view);
  }

  get via() {
    return this.#data.current?.via;
  }

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
  parts: readonly string[],
  period: ReturnType<typeof periodOf>,
  from: Readonly<Date>,
  to: Readonly<Date>,
  now: number,
) {
  const until = Math.min(to.getTime(), now);

  const measuredOf = (s: string) =>
    from.getTime() < until ? rollups(core, device, s, period, from, new Date(until)) : [];

  const [measured, forecast, ...split] = await Promise.all([
    measuredOf(series),
    planned(core, device, series, from, to),
    ...parts.map((s) => measuredOf(s)),
  ]);

  return { series, measured, forecast, parts: split };
}
