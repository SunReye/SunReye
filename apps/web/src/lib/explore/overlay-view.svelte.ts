// Overlay mode's state (ADR 22): the first chosen series read once per period, each drawn from the
// range's start in a tint of the series' colour, and what picking a period does to the route.
import { flowColour, roleFlow } from "../energy-colours.ts";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import { iso } from "../range/calendar.ts";
import { RangeData } from "../range/range-data.svelte.ts";
import type { ModeProps } from "./mode.ts";
import {
  laneOf,
  overlayNotes,
  periodsTable,
  periodFigures,
  shownOf,
  type PeriodRow,
  type Shown,
} from "./overlay-chart.ts";
import {
  added,
  aligned,
  periodsOf,
  picksOf,
  removed,
  spanOf,
  type OverlayPeriod,
  type QuickPick,
} from "./overlay.ts";
import { readSeries, type Reading } from "./read.ts";
import { timesOf, type Chart, type Figure } from "./series-chart.ts";

/** What the picks, the legend and the time labels take of the pane's height. */
const AROUND = 176;

/** The least a plot is drawn in. */
const PLOT_MIN = 160;

/** The periods read, each with its reading drawn from the range's start. */
interface Loaded {
  readonly periods: readonly OverlayPeriod[];
  readonly readings: readonly Reading[];
}

/** A quick pick as its button names it. */
export type Offered = QuickPick & { readonly text: string };

const PICKS: Readonly<Record<QuickPick["id"], (week: boolean) => string>> = {
  day: m.explore_overlay_day_before,
  week: m.explore_overlay_week_before,
  year: (week) => (week ? m.explore_overlay_year_week() : m.explore_overlay_year_day()),
};

export class OverlayView {
  readonly #input: () => ModeProps;

  /** A mode of one series takes the first. */
  readonly chosen = $derived.by(() => this.#input().series[0]!);

  /** Whether the catalog lists the series: only then is there anything to read. */
  readonly state: "pending" | "unstored" | "read" = $derived.by(() => {
    if (this.#input().catalog !== "ready") return "pending";

    return this.chosen.first === null ? "unstored" : "read";
  });

  // The route rebuilds the series and the periods on any change of it; only what a read depends
  // on reads again.
  readonly #wanted = $derived.by(() => {
    const { ref, kind, first } = this.chosen;

    return `${ref.device}:${ref.series}:${kind}:${first}:${this.#input().periods.join(",")}`;
  });

  readonly #colour = $derived(flowColour(roleFlow(this.chosen.ref.series)));

  /** The range and the picked periods, as the route has them now. */
  readonly periods: readonly Shown[] = $derived.by(() => {
    const { route, periods } = this.#input();
    const { zone, cal } = route.place;

    return shownOf(periodsOf(zone, route.range, periods), cal, this.#colour);
  });

  /** The quick picks not drawn yet. */
  readonly picks: readonly Offered[] = $derived.by(() => {
    const { route, periods } = this.#input();
    const week = route.range.kind === "week";

    return picksOf(route.range)
      .filter((pick: QuickPick) => added(route.range, periods, pick.day) !== null)
      .map((pick: QuickPick) => Object.assign({}, pick, { text: PICKS[pick.id](week) }));
  });

  /** Five periods are drawn: no more can be picked. */
  readonly full = $derived(this.periods.length >= 5);

  /** The last day that can be picked, `2026-11-16`. */
  readonly lastDay = $derived.by(() => iso(this.#input().route.place.cal.today));

  readonly #data: RangeData<Loaded | null>;

  /** What was read, as the route names it now; null while the catalog or the range is read. */
  readonly #rows = $derived.by((): readonly PeriodRow[] | null => {
    const read = this.#data.current?.data;

    if (!read) return null;

    const shown = new Map(this.periods.map((p: Shown) => [p.key, p]));

    // A period taken out is gone at once; one added, or another range, waits for its read.
    const rows = read.periods.flatMap((p: OverlayPeriod, i): PeriodRow[] => {
      const period = shown.get(p.key);

      return period ? [{ period, reading: read.readings[i]! }] : [];
    });

    return read.periods[0]?.key === this.periods[0]?.key ? rows : null;
  });

  readonly chart: Chart | null = $derived.by(() => {
    const [got, rows] = [this.#data.current, this.#rows];

    if (!got || !rows) return null;

    const from = rows[0]!.period.from;
    const to = from + spanOf(rows.map((r: PeriodRow) => r.period));
    const height = Math.max(this.#input().height - AROUND, PLOT_MIN);
    const several = this.#input().series.length > 1;

    return {
      from,
      to,
      height,
      lanes: [laneOf(this.chosen, rows, height)],
      notes: [
        ...(several ? [m.explore_overlay_first({ name: this.chosen.label })] : []),
        ...overlayNotes(rows),
      ],
      idle: `${this.chosen.label} · ${m.explore_latest()}`,
      times: timesOf(got.list, got.spans, to),
    };
  });

  /** Each shown period's points, on the range's clock. */
  readonly table = $derived.by(() => {
    const [got, rows] = [this.#data.current, this.#rows];

    return got && rows ? periodsTable(got.range, this.chosen, rows) : null;
  });

  /** Writes an instant of the range as the plant's clock reads it; a week names its day. */
  readonly #clock = $derived.by(() => {
    const { route } = this.#input();

    const options: Intl.DateTimeFormatOptions = {
      timeZone: route.place.zone,
      hour: "2-digit",
      minute: "2-digit",
    };

    if (route.range.kind === "week") options.weekday = "short";

    return new Intl.DateTimeFormat(getLocale(), options);
  });

  constructor(input: () => ModeProps) {
    this.#input = input;
    this.#data = new RangeData(
      () => input().route,
      () => this.#load(),
    );

    // The export reads the plot while this pane stands.
    $effect(() => input().plots(() => this.table));
  }

  async #load(): Promise<Loaded | null> {
    const { core, route, periods: picked } = this.#input();

    void this.#wanted;

    if (this.state !== "read") return null;

    const { chosen } = this;
    const periods = periodsOf(route.place.zone, route.range, picked);
    const onto = periods[0]!.from;

    // One read per period, in parallel (ADR 22).
    const readings = await Promise.all(
      periods.map(async (p: OverlayPeriod) => {
        const reading = await readSeries(core, chosen, new Date(p.from), new Date(p.to));

        return Object.assign({}, reading, { curve: aligned(reading.curve, p, onto) });
      }),
    );

    return { periods, readings };
  }

  /** The legend's title: the series, and the range's clock under the pointer. */
  title(at: number | null): string {
    return at === null
      ? (this.chart?.idle ?? "")
      : `${this.chosen.label} · ${this.#clock.format(at)}`;
  }

  /** The legend's rows: each period's value under the pointer. */
  figures(at: number | null): Figure[] {
    const [rows, lane] = [this.#rows, this.chart?.lanes[0]];

    return rows && lane ? periodFigures(lane, rows, at) : [];
  }

  #pick(days: readonly string[] | null): void {
    if (days) this.#input().route.patch({ vs: days.join(",") || null }, true);
  }

  /** Adds the period that holds `day`, as a step back can undo. */
  add = (day: string): void => {
    const { route, periods } = this.#input();

    this.#pick(added(route.range, periods, day));
  };

  remove = (period: OverlayPeriod): void => {
    const { route, periods } = this.#input();

    this.#pick(removed(route.range, periods, period));
  };
}
