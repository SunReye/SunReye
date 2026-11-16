// Overlay mode's chart as its pane shows it (ADR 22): one lane with a curve per period, the
// legend's row per period, and what the chart says of its reads. Pure.
import { m } from "../paraglide/messages.js";
import { rangeLabel, type Calendar, type Range } from "../range/range.ts";
import { overlayTable, type Table } from "./csv.ts";
import { sampleAt, type Curve } from "./curve.ts";
import { tintOf, type OverlayPeriod } from "./overlay.ts";
import type { Chosen } from "./picker.ts";
import type { Reading } from "./read.ts";
import { lanesView, written, type Figure, type LaneView } from "./series-chart.ts";

/** A period as the pane names and colours it. */
export interface Shown extends OverlayPeriod {
  readonly name: string;
  readonly colour: string;
}

/** A period and its reading, drawn from the range's start. */
export interface PeriodRow {
  readonly period: Shown;
  readonly reading: Reading;
}

/** The periods named as the range control names them, the range in `colour` and the rest fainter. */
export function shownOf(periods: readonly OverlayPeriod[], cal: Calendar, colour: string): Shown[] {
  return periods.map((p: OverlayPeriod, i) =>
    Object.assign({}, p, { name: rangeLabel(cal, p.range), colour: tintOf(colour, i) }),
  );
}

/** A curve without its extremes. */
const bare = (curve: Curve): Curve =>
  Object.assign({}, curve, { samples: curve.samples.map(({ t0, t1, v }) => ({ t0, t1, v })) });

/** The one lane, `height` px tall; `rows` has the range first. */
export function laneOf(chosen: Chosen, rows: readonly PeriodRow[], height: number): LaneView {
  const states = chosen.kind === "status";
  // Lines draw the range last, over the earlier periods; rows of states list it first.
  const order = states ? rows : rows.toReversed();

  const [lane] = lanesView(
    {
      plan: {
        lanes: [
          {
            key: "overlay",
            unit: states ? null : chosen.unit,
            states,
            series: order.map((r: PeriodRow) => ({ chosen, colour: r.period.colour })),
          },
        ],
        left: [],
        absent: [],
      },
      // Five min–max bands hide each other: only the range keeps its own.
      readings: order.map((r: PeriodRow) =>
        r === rows[0] ? r.reading : Object.assign({}, r.reading, { curve: bare(r.reading.curve) }),
      ),
    },
    height,
  );

  return Object.assign({}, lane, {
    label: m.explore_lane({
      unit: lane!.caption,
      series: rows.map((r: PeriodRow) => r.period.name).join(", "),
    }),
  });
}

/**
 * The legend's rows: each period's value at `at`. At rest they read where the range was last
 * read, so today's latest stands beside the same time of the days before.
 */
export function periodFigures(
  lane: LaneView,
  rows: readonly PeriodRow[],
  at: number | null,
): Figure[] {
  const last = rows[0]?.reading.curve.samples.at(-1);
  const t = at ?? (last ? last.t1 - 1 : 0);

  return rows.map((r: PeriodRow) =>
    Object.assign(
      { key: r.period.key, colour: r.period.colour, label: r.period.name, device: null },
      written(lane, sampleAt(r.reading.curve, t)),
    ),
  );
}

/** What the chart says of its reads, each once, naming the periods. */
export function overlayNotes(rows: readonly PeriodRow[]): string[] {
  const named = (is: (r: Reading) => boolean) =>
    rows.flatMap((r: PeriodRow) => (is(r.reading) ? [r.period.name] : [])).join(", ");

  const said: (readonly [string, (names: string) => string])[] = [
    [named((r) => r.hourly), (names) => m.explore_overlay_hourly({ names })],
    [named((r) => r.trouble === "failed"), (names) => m.explore_failed({ names })],
    [named((r) => r.trouble === "many"), (names) => m.explore_many({ names })],
  ];

  return said.flatMap(([names, text]) => (names === "" ? [] : [text(names)]));
}

/** Each period's points, the range first, for the export. */
export function periodsTable(
  range: Range,
  chosen: Chosen,
  rows: readonly PeriodRow[],
): Table | null {
  return overlayTable(
    range,
    chosen,
    rows.map((r: PeriodRow) => ({ key: r.period.key, curve: r.reading.curve })),
  );
}
