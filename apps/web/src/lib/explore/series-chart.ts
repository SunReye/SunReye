// Series mode's chart as its pane shows it (ADR 22): the lanes with their axes, what the canvas
// draws, what the legend reads under the pointer, and what the chart has to say about its reads.
import { m } from "../paraglide/messages.js";
import type { Edge } from "../range/edges.ts";
import { num } from "../range/format.ts";
import { axisOf, sampleAt, tickDigits, valueDigits, type Axis, type Sample } from "./curve.ts";
import type { Lane, Lanes, LaneSeries } from "./lanes.ts";
import type { Chosen } from "./picker.ts";
import { expired, type Reading } from "./read.ts";
import { layout, yOf, type LaneBox, type LaneScene } from "./scene.ts";

/** The lanes to draw and each drawn series' reading. */
export interface Loaded {
  readonly plan: Lanes;
  /** One per drawn series, lane by lane. */
  readonly readings: readonly Reading[];
}

export interface Row extends LaneSeries {
  readonly reading: Reading;
}

export interface LaneView {
  readonly lane: Lane;
  /** "W", "no unit" or "States". */
  readonly caption: string;
  /** What the lane holds, for a reader that cannot see it. */
  readonly label: string;
  readonly box: LaneBox;
  readonly axis: Axis | null;
  readonly rows: readonly Row[];
  /** The axis' figures and where they stand, in px from the chart's top. */
  readonly ticks: readonly { readonly y: number; readonly text: string }[];
}

const EMPTY: Reading = {
  curve: { draw: "line", tier: "raw", samples: [] },
  hourly: false,
  trouble: null,
};

function captionOf(lane: Lane): string {
  if (lane.states) return m.explore_states();

  return lane.unit ?? m.explore_no_unit();
}

/** How many series the lanes before lane `i` draw. */
const before = (lanes: readonly Lane[], i: number): number =>
  lanes.slice(0, i).reduce((n, l) => n + l.series.length, 0);

/** The lanes stacked in `height` px, each with its axis. */
export function lanesView(loaded: Loaded, height: number): LaneView[] {
  const { lanes } = loaded.plan;

  const boxes = layout(
    lanes.map((l) => ({ rows: l.states ? l.series.length : 0 })),
    height,
  );

  return lanes.map((lane, i) => {
    const rows: readonly Row[] = lane.series.map((s) =>
      Object.assign({}, s, {
        reading: loaded.readings[before(lanes, i) + lane.series.indexOf(s)] ?? EMPTY,
      }),
    );

    const axis = lane.states ? null : axisOf(rows.map((r) => r.reading.curve));
    const box = boxes[i]!;
    const caption = captionOf(lane);

    return {
      lane,
      caption,
      label: m.explore_lane({
        unit: caption,
        series: lane.series.map((s) => s.chosen.label).join(", "),
      }),
      box,
      axis,
      rows,
      ticks: axis
        ? axis.ticks.map((v) => ({ y: yOf(box, axis, v), text: num(v, tickDigits(axis)) }))
        : [],
    };
  });
}

/** What the canvas draws of each lane. */
export function scenesOf(lanes: readonly LaneView[]): LaneScene[] {
  return lanes.map((l) => ({
    box: l.box,
    axis: l.axis,
    states: l.lane.states,
    curves: l.rows.map((r) => ({ colour: r.colour, curve: r.reading.curve })),
  }));
}

/** The chart as a pane shows it. */
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

/** A label per band the range's charts label, at its start on an axis that ends at `to`. */
export function timesOf(
  list: readonly Edge[],
  spans: readonly (readonly [number, number])[],
  to: number,
): Chart["times"] {
  const from = spans[0]?.[0] ?? 0;

  return list.flatMap((edge, i) =>
    edge.tick
      ? [{ key: edge.key, text: edge.label, x: ((spans[i]![0] - from) / (to - from)) * 100 }]
      : [],
  );
}

/** A legend row: a series or a period and its value under the pointer, or its latest. */
export interface Figure {
  readonly key: string;
  readonly colour: string;
  readonly label: string;
  /** Null where the rows are one series' periods. */
  readonly device: string | null;
  /** "–" in a gap. */
  readonly value: string;
  /** A statistic's extremes, "150 – 250". */
  readonly extremes: string | null;
}

/** A sample as the legend writes it, by its lane's axis and unit. */
export function written(lane: LaneView, s: Sample | null) {
  if (!s) return { value: "–", extremes: null };

  const digits = lane.axis ? valueDigits(lane.axis) : 0;
  const unit = lane.lane.unit === null ? "" : ` ${lane.lane.unit}`;

  return {
    value: `${num(s.v, digits)}${unit}`,
    extremes:
      s.lo === undefined || s.hi === undefined
        ? null
        : `${num(s.lo, digits)} – ${num(s.hi, digits)}`,
  };
}

/** The legend's rows at instant `at`; null reads each series' latest value. */
export function figuresOf(lanes: readonly LaneView[], at: number | null): Figure[] {
  return lanes.flatMap((lane) =>
    lane.rows.map((row) => {
      const { curve } = row.reading;
      const { ref, label, device, estimated } = row.chosen;

      return {
        key: `${ref.device}:${ref.series}`,
        colour: row.colour,
        label: `${estimated ? "≈ " : ""}${label}`,
        device,
        ...written(lane, at === null ? (curve.samples.at(-1) ?? null) : sampleAt(curve, at)),
      };
    }),
  );
}

/** A drawn series' reading, with what it is a reading of. */
interface Drawn extends Reading {
  readonly kind: Chosen["kind"];
  readonly chosen: Chosen;
}

const names = (series: readonly Chosen[]): string => series.map((s) => s.label).join(", ");

/** What the chart says of its reads, each once. */
export function notesOf({ plan, readings }: Loaded): string[] {
  const drawn: readonly Drawn[] = plan.lanes
    .flatMap((l) => l.series)
    .map((s, i) =>
      Object.assign({}, readings[i] ?? EMPTY, { kind: s.chosen.kind, chosen: s.chosen }),
    );

  const troubled = (trouble: Reading["trouble"]) =>
    drawn.flatMap((d) => (d.trouble === trouble ? [d.chosen] : []));

  const said: (readonly [boolean, () => string])[] = [
    [plan.left.length > 0, () => m.explore_left({ names: names(plan.left) })],
    [plan.absent.length > 0, () => m.explore_absent({ names: names(plan.absent) })],
    [drawn.some((d) => d.hourly), m.explore_hourly],
    [expired(drawn), m.explore_expired],
    [troubled("failed").length > 0, () => m.explore_failed({ names: names(troubled("failed")) })],
    [troubled("many").length > 0, () => m.explore_many({ names: names(troubled("many")) })],
  ];

  return said.flatMap(([on, text]) => (on ? [text()] : []));
}
