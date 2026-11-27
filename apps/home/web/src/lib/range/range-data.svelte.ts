// The figures a chart shows for the route's range, and the range they belong to. A chart keeps its
// last figures while the next load runs, then tweens to the new ones instead of redrawing (ADR 21).
// A load that fails keeps them too, flagged until a retry or the next load succeeds.
import { settleRead, type Problem } from "../api/client.ts";
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
import { RangeTravel } from "./travel.svelte.ts";

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

/** A load's legend title while no band is read. */
export const sumTitle = (got: Readonly<Pick<Loaded<unknown>, "cal" | "range">>): string =>
  m.range_sum({ range: rangeLabel(got.cal, got.range) });

export class RangeData<T> {
  current = $state.raw<Loaded<T> | undefined>();
  failed = $state(false);
  /** Why the core refused the last read; none while it answers, or when it was lost. */
  refused = $state.raw<Problem | undefined>();
  #attempt = $state(0);

  readonly #route: () => RangeRoute;

  /** How the chart's card travels: a range not yet read is drawn loading, so it reads only the range it shows. */
  readonly travel: RangeTravel<Loaded<T>, null>;

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
    this.travel = new RangeTravel(() => ({
      route: route(),
      got: this.current,
      loading: false,
      pending: () => null,
    }));

    $effect(() => {
      const r: RangeRoute = route();
      const [range, via, { zone, cal }] = [r.range, r.via, r.place];

      // oxlint-disable-next-line typescript/no-meaningless-void-operator -- track retry state in effect.
      void this.#attempt;
      const list = edges(cal, range, finest);
      const now = Date.now();

      const spans = list.map(
        (e) => [hourInstant(zone, e.t0).getTime(), hourInstant(zone, e.t1).getTime()] as const,
      );

      const loading = load(hourInstant(zone, t0Of(range)), hourInstant(zone, t1Of(range)), now);
      let live = true;

      const read = async () => {
        const got = await settleRead(loading);

        if (!live) return;

        if (got.failed) [this.failed, this.refused] = [true, got.refused];
        else
          [this.current, this.failed, this.refused] = [
            { range, via, cal, list, spans, now, data: got.data },
            false,
            undefined,
          ];
      };

      void read();

      return () => {
        live = false;
      };
    });
  }

  /** Reads the range again after a failed load. */
  retry = (): void => {
    [this.failed, this.refused] = [false, undefined];
    this.#attempt += 1;
  };

  /** The legend's title while no band is read. */
  get title(): string {
    const got = this.current;

    return got ? sumTitle(got) : "";
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
