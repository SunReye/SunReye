// What the chart's canvas draws (ADR 22), as plain shapes in px: each lane's gridlines and its
// curves by their kind's rule, on one time axis. Pure, so the drawing is tested without pixels;
// `paint.ts` only executes it.
import { anchors, type Axis, type Curve, type Sample } from "./curve.ts";

/** The time axis: [from, to) in epoch ms across `width` px. */
export interface Frame {
  readonly from: number;
  readonly to: number;
  readonly width: number;
}

/** A lane's place in the chart, in px from its top. */
export interface LaneBox {
  readonly top: number;
  readonly height: number;
}

export interface LaneScene {
  readonly box: LaneBox;
  /** Null for states, and with nothing to scale. */
  readonly axis: Axis | null;
  /** Bands of states, a row per series. */
  readonly states: boolean;
  readonly curves: readonly { readonly colour: string; readonly curve: Curve }[];
}

export type Point = readonly [x: number, y: number];

export type Op =
  | { readonly op: "grid"; readonly y: number }
  | { readonly op: "line"; readonly colour: string; readonly points: readonly Point[] }
  /** A closed shape, drawn faint: a min–max band. */
  | { readonly op: "area"; readonly colour: string; readonly points: readonly Point[] }
  | {
      readonly op: "rect";
      readonly colour: string;
      readonly alpha: number;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    };

/** Between lanes: room for one's lowest figure and the next one's unit. */
const GAP = 16;

/** A row of states: its band and the space under it. */
const ROW = 18;
const BAND = 12;
const PAD = 4;

/** The lanes stacked in `height`: a lane of `rows` states is as tall as they are, the others share the rest. */
export function layout(lanes: readonly { readonly rows: number }[], height: number): LaneBox[] {
  const fixed = lanes.map((l) => (l.rows > 0 ? 2 * PAD + l.rows * ROW : 0));
  const scaled = fixed.filter((h) => h === 0).length;
  const rest = height - fixed.reduce((a, h) => a + h, 0) - GAP * (lanes.length - 1);
  const each = scaled > 0 ? Math.max(24, rest / scaled) : 0;
  let top = 0;

  return fixed.map((h) => {
    const box = { top, height: h || each };

    top += box.height + GAP;

    return box;
  });
}

/** Where a value stands in its lane. */
export function yOf(box: LaneBox, axis: Axis, v: number): number {
  return box.top + ((axis.max - v) / (axis.max - axis.min)) * box.height;
}

const xOf = (frame: Frame, t: number): number =>
  ((t - frame.from) * frame.width) / (frame.to - frame.from);

/** Each state by its strength: the lowest faint, the highest full. */
function strengths(samples: readonly Sample[]): Map<number, number> {
  const values = [...new Set(samples.map((s) => s.v))].toSorted((a, b) => a - b);

  return new Map(
    values.map((v, i) => [v, values.length === 1 ? 1 : 0.35 + (0.65 * i) / (values.length - 1)]),
  );
}

function stateOps(lane: LaneScene, frame: Frame): Op[] {
  return lane.curves.flatMap(({ colour, curve }, row) => {
    const alpha = strengths(curve.samples);
    const y = lane.box.top + PAD + row * ROW;

    return curve.samples.map((s): Op => {
      const x = xOf(frame, s.t0);

      return {
        op: "rect",
        colour,
        alpha: alpha.get(s.v) ?? 1,
        x,
        y,
        w: xOf(frame, s.t1) - x,
        h: BAND,
      };
    });
  });
}

function barOps(colour: string, curve: Curve, at: (v: number) => number, frame: Frame): Op[] {
  const zero = at(0);

  return curve.samples.map((s): Op => {
    const [x, y] = [xOf(frame, s.t0), at(s.v)];
    // A hair between neighbours, while a bar keeps a px.
    const w = Math.max(1, xOf(frame, s.t1) - x - 1);

    return {
      op: "rect",
      colour,
      alpha: 0.8,
      x: x + 0.5,
      y: Math.min(y, zero),
      w,
      h: Math.abs(zero - y),
    };
  });
}

function lineOps(colour: string, curve: Curve, at: (v: number) => number, frame: Frame): Op[] {
  const banded = curve.samples.some((s) => s.lo !== undefined);

  const bands = banded
    ? anchors(curve).map((run): Op => {
        const upper = run.map((a): Point => [xOf(frame, a.t), at(a.s.hi ?? a.s.v)]);
        const lower = run.map((a): Point => [xOf(frame, a.t), at(a.s.lo ?? a.s.v)]);

        return { op: "area", colour, points: [...upper, ...lower.toReversed()] };
      })
    : [];

  const lines = anchors(curve).map((run): Op => ({
    op: "line",
    colour,
    points: run.map((a): Point => [xOf(frame, a.t), at(a.s.v)]),
  }));

  return [...bands, ...lines];
}

function laneOps(lane: LaneScene, frame: Frame): Op[] {
  if (lane.states) return stateOps(lane, frame);

  const { axis, box } = lane;

  if (!axis) return [];

  const at = (v: number) => yOf(box, axis, v);
  const grid = axis.ticks.map((v): Op => ({ op: "grid", y: at(v) }));

  // Bars under the lines, so a line over them stays readable.
  const order = lane.curves.toSorted(
    (a, b) => Number(b.curve.draw === "bars") - Number(a.curve.draw === "bars"),
  );

  const drawn = order.flatMap(({ colour, curve }) =>
    curve.draw === "bars" ? barOps(colour, curve, at, frame) : lineOps(colour, curve, at, frame),
  );

  return [...grid, ...drawn];
}

/** Every shape of the chart, in drawing order. */
export function sceneOf(lanes: readonly LaneScene[], frame: Frame): Op[] {
  if (frame.width <= 0 || frame.to <= frame.from) return [];

  return lanes.flatMap((lane) => laneOps(lane, frame));
}
