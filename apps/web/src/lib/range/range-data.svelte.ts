// The figures a chart shows for the route's range, and the range they belong to. A chart keeps its
// last figures while the next load runs, then tweens to the new ones instead of redrawing (ADR 21).
// A load that fails keeps them too, flagged until a retry or the next load succeeds.
import { m } from "../paraglide/messages.js";
import { brushRange, edges, type Edge } from "./edges.ts";
import {
  hourInstant,
  rangeLabel,
  t0Of,
  t1Of,
  type Calendar,
  type Grain,
  type Range,
  type Via,
} from "./range.ts";
import type { RangeRoute } from "./route.svelte.ts";

/** One load: its range and how the chart got there, its bands and their instants, and the figures. */
export interface Loaded<T> {
  readonly range: Range;
  readonly via: Via;
  readonly cal: Calendar;
  readonly list: readonly Edge[];
  /** Each band as [start, end) in ms since the epoch. */
  readonly spans: readonly (readonly [number, number])[];
  readonly now: number;
  readonly data: T;
}

/** Where the plant is: its timezone and its calendar now. */
export interface Place {
  readonly zone: string;
  readonly cal: Calendar;
}

export class RangeData<T> {
  current = $state.raw<Loaded<T> | undefined>();
  failed = $state(false);
  #attempt = $state(0);

  readonly #route: () => RangeRoute;

  /**
   * @param load reads the figures from `from` to before `to`; what it reads before its first
   *   `await` is tracked, so a new device or series loads again
   * @param finest the finest grain the figures come in, such as days of costs
   */
  constructor(
    route: () => RangeRoute,
    load: (from: Readonly<Date>, to: Readonly<Date>, now: number) => Promise<T>,
    finest: Grain = "hour",
  ) {
    this.#route = route;

    $effect(() => {
      const r: RangeRoute = route();
      const [range, via, { zone, cal }] = [r.range, r.via, r.place];

      void this.#attempt;
      const list = edges(cal, range, finest);
      const now = Date.now();

      const spans = list.map(
        (e) => [hourInstant(zone, e.t0).getTime(), hourInstant(zone, e.t1).getTime()] as const,
      );

      const loading = load(hourInstant(zone, t0Of(range)), hourInstant(zone, t1Of(range)), now);
      let live = true;

      void loading.then(
        (data) => {
          if (live)
            [this.current, this.failed] = [{ range, via, cal, list, spans, now, data }, false];

          return data;
        },
        () => {
          if (live) this.failed = true;
        },
      );

      return () => {
        live = false;
      };
    });
  }

  /** Reads the range again after a failed load. */
  retry = (): void => {
    this.failed = false;
    this.#attempt += 1;
  };

  /** The legend's title while no band is read. */
  get title(): string {
    const got = this.current;

    return got ? m.range_sum({ range: rangeLabel(got.cal, got.range) }) : "";
  }

  /** Opens the range band `i` stands for, if any. */
  drill = (i: number): void => {
    const drill = this.current?.list[i]?.drill;

    const route: RangeRoute = this.#route();

    if (drill) route.open(drill);
  };

  /** Narrows to bands `a` to `b`. */
  brush = (a: number, b: number): void => {
    const got = this.current;

    if (got) this.#route().open(brushRange(got.cal, got.range, got.list, a, b));
  };
}
