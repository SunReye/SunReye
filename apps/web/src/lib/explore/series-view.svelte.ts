// Series mode's state (ADR 22): the chosen series' reads for the route's range, and the chart
// they make. The pane renders, this decides.
import { untrack } from "svelte";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import { RangeData } from "../range/range-data.svelte.ts";
import { rangeLabel } from "../range/range.ts";
import { narrowed } from "./brush.ts";
import { lanesOf } from "./lanes.ts";
import type { ModeProps } from "./mode.ts";
import { readSeries } from "./read.ts";
import { lanesView, notesOf, type LaneView, type Loaded } from "./series-chart.ts";

/** Four lanes on a phone grow the chart instead of flattening each other. */
const LANE_MIN = 84;

/** What the legend and the time labels take of the pane's height. */
const AROUND = 132;

/** The chart as the pane shows it. */
export interface Chart {
  /** The time axis, [from, to) in epoch ms. */
  readonly from: number;
  readonly to: number;
  /** The plot's height in px. */
  readonly height: number;
  readonly lanes: readonly LaneView[];
  /** What the chart says of its reads. */
  readonly notes: readonly string[];
  /** The legend's title while nothing is read. */
  readonly idle: string;
  /** The time axis' labels, each at a share of its width in percent. */
  readonly times: readonly { readonly key: string; readonly text: string; readonly x: number }[];
}

export class SeriesView {
  readonly #input: () => ModeProps;

  // The route rebuilds the chosen series on any change of it; only what a read depends on reads again.
  readonly #wanted = $derived.by(() =>
    this.#input()
      .series.map((s) => `${s.ref.device}:${s.ref.series}:${s.kind}:${s.first}`)
      .join(","),
  );

  readonly #data: RangeData<Loaded | null>;

  /** Null while the catalog or the series are being read. */
  readonly chart: Chart | null = $derived.by(() => {
    const got = this.#data.current;

    if (!got?.data) return null;

    const [from, to] = [got.spans[0]?.[0] ?? 0, got.spans.at(-1)?.[1] ?? 0];

    const height = Math.max(this.#input().height - AROUND, got.data.plan.lanes.length * LANE_MIN);

    return {
      from,
      to,
      height,
      lanes: lanesView(got.data, height),
      notes: notesOf(got.data),
      idle: `${rangeLabel(got.cal, got.range)} · ${m.explore_latest()}`,
      // A label per band the range's charts label, at its start.
      times: got.list.flatMap((edge, i) =>
        edge.tick
          ? [
              {
                key: edge.key,
                text: edge.label,
                x: ((got.spans[i]![0] - from) / (to - from)) * 100,
              },
            ]
          : [],
      ),
    };
  });

  /** Writes an instant as the plant's clock reads it. */
  readonly #clock = $derived.by(
    () =>
      new Intl.DateTimeFormat(getLocale(), {
        timeZone: this.#input().route.place.zone,
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
  );

  constructor(input: () => ModeProps) {
    this.#input = input;
    this.#data = new RangeData(
      () => input().route,
      (from, to) => this.#load(from, to),
    );
  }

  async #load(from: Readonly<Date>, to: Readonly<Date>): Promise<Loaded | null> {
    const { core, catalog } = this.#input();

    void this.#wanted;

    // A series' kind decides its read, and the catalog knows it.
    if (catalog !== "ready") return null;

    const plan = untrack(() => lanesOf(this.#input().series));
    const drawn = plan.lanes.flatMap((l) => l.series.map((s) => s.chosen));
    const readings = await Promise.all(drawn.map((s) => readSeries(core, s, from, to)));

    return { plan, readings };
  }

  /** The legend's title: the instant being read, or the range. */
  title(at: number | null): string {
    return at === null ? (this.chart?.idle ?? "") : this.#clock.format(at);
  }

  /** A drag between two instants narrows the range to them; back returns. */
  narrow = (a: number, b: number): void => {
    const got = this.#data.current;
    const { route } = this.#input();
    const next = got && narrowed(route.place.zone, got.cal, got.range, a, b);

    if (next) route.open(next);
  };
}
