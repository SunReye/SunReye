// Series mode's state (ADR 22): the chosen series' reads for the route's range, and the chart
// they make. The pane renders, this decides.
import { untrack } from "svelte";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import { rangeLabel } from "../range/range.ts";
import { narrowed } from "./brush.ts";
import { lanesOf } from "./lanes.ts";
import { ModeView } from "./mode-view.svelte.ts";
import { readSeries } from "./read.ts";
import { lanesView, notesOf, plotted, timesOf, type Chart, type Loaded } from "./series-chart.ts";

/** Four lanes on a phone grow the chart instead of flattening each other. */
const LANE_MIN = 84;

/** What the legend and the time labels take of the pane's height, at rest. */
const AROUND = 132;

export class SeriesView extends ModeView<Loaded | null> {
  /** The height the plot is laid out in, in px: in fullscreen what the window leaves it. */
  room = $state(0);

  // The route rebuilds the chosen series on any change of it; only what a read depends on reads again.
  readonly #wanted = $derived.by(() =>
    this.input()
      .series.map((s) => `${s.ref.device}:${s.ref.series}:${s.kind}:${s.first}`)
      .join(","),
  );

  /** Null while the catalog or the series are being read. */
  readonly chart: Chart | null = $derived.by(() => {
    const got = this.data.current;

    if (!got?.data) return null;

    const [from, to] = [got.spans[0]?.[0] ?? 0, got.spans.at(-1)?.[1] ?? 0];

    const least = got.data.plan.lanes.length * LANE_MIN;
    const { full, height: pane } = this.input();
    const height = Math.max(full === true && this.room > 0 ? this.room : pane - AROUND, least);

    return {
      from,
      to,
      height,
      least,
      lanes: lanesView(got.data, height),
      notes: notesOf(got.data),
      idle: `${rangeLabel(got.cal, got.range)} · ${m.explore_latest()}`,
      times: timesOf(got.list, got.spans, to),
    };
  });

  /** The drawn series' points, under the range they were read for. */
  readonly table = $derived.by(() => {
    const got = this.data.current;

    return got?.data ? plotted(got.range, got.data) : null;
  });

  /** Writes an instant as the plant's clock reads it. */
  readonly #clock = $derived.by(
    () =>
      new Intl.DateTimeFormat(getLocale(), {
        timeZone: this.input().route.place.zone,
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
  );

  protected async load(from: Readonly<Date>, to: Readonly<Date>): Promise<Loaded | null> {
    const { core, catalog } = this.input();

    // oxlint-disable-next-line typescript/no-meaningless-void-operator -- track reactive state in loader.
    void this.#wanted;

    // A series' kind decides its read, and the catalog knows it.
    if (catalog !== "ready") return null;

    const plan = untrack(() => lanesOf(this.input().series));
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
    const got = this.data.current;
    const { route } = this.input();
    const next = got && narrowed(route.place.zone, got.cal, got.range, a, b);

    if (next) route.open(next);
  };
}
