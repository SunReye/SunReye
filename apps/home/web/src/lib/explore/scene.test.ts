import { expect, test } from "bun:test";
import type { Curve, Sample } from "./curve.ts";
import { layout, sceneOf, type LaneScene } from "./scene.ts";

// Two px per ms across, ten px per unit up: figures that can be read off.
const FRAME = { from: 0, to: 100, width: 200 };
const AXIS = { min: 0, max: 10, ticks: [0, 5, 10], step: 5 };
const BOX = { top: 20, height: 100 };

const lane = (curve: Curve, more: Partial<LaneScene> = {}): LaneScene => ({
  box: BOX,
  axis: AXIS,
  states: false,
  curves: [{ colour: "red", curve }],
  ...more,
});

const curve = (
  draw: Curve["draw"],
  samples: readonly Sample[],
  tier: Curve["tier"] = "bucket",
) => ({
  draw,
  tier,
  samples,
});

const marks = (lanes: readonly LaneScene[]) => sceneOf(lanes, FRAME).filter((o) => o.op !== "grid");

test("a lane's gridlines stand at its axis' ticks", () => {
  expect(sceneOf([lane(curve("line", []))], FRAME)).toEqual([
    { op: "grid", y: 120 },
    { op: "grid", y: 70 },
    { op: "grid", y: 20 },
  ]);
});

test("a measurement is a line through its means, broken at a gap", () => {
  const samples = [
    { t0: 0, t1: 10, v: 5 },
    { t0: 10, t1: 20, v: 10 },
    { t0: 40, t1: 50, v: 0 },
    { t0: 50, t1: 60, v: 5 },
  ];

  expect(marks([lane(curve("line", samples))])).toEqual([
    {
      op: "line",
      colour: "red",
      points: [
        [10, 70],
        [30, 20],
      ],
    },
    {
      op: "line",
      colour: "red",
      points: [
        [90, 120],
        [110, 70],
      ],
    },
  ]);
});

test("statistics draw the mean inside its min–max band", () => {
  const samples = [
    { t0: 0, t1: 10, v: 5, lo: 2, hi: 8 },
    { t0: 10, t1: 20, v: 6, lo: 5, hi: 10 },
  ];

  expect(marks([lane(curve("line", samples, "hour"))])).toEqual([
    {
      op: "area",
      colour: "red",
      points: [
        [10, 40],
        [30, 20],
        [30, 70],
        [10, 100],
      ],
    },
    {
      op: "line",
      colour: "red",
      points: [
        [10, 70],
        [30, 60],
      ],
    },
  ]);
});

test("history has no extremes, so no band", () => {
  const ops = marks([lane(curve("line", [{ t0: 0, t1: 10, v: 5 }], "hour"))]);

  expect(ops.map((o) => o.op)).toEqual(["line"]);
});

test("a counter's readings and a held value are a step line", () => {
  const samples = [
    { t0: 0, t1: 10, v: 5 },
    { t0: 10, t1: 30, v: 10 },
  ];

  expect(marks([lane(curve("step", samples, "raw"))])).toEqual([
    {
      op: "line",
      colour: "red",
      points: [
        [0, 70],
        [20, 70],
        [20, 20],
        [60, 20],
      ],
    },
  ]);
});

test("a counter's deltas are bars on zero, a hair apart", () => {
  const ops = marks([lane(curve("bars", [{ t0: 0, t1: 10, v: 5 }], "hour"))]);

  expect(ops).toEqual([{ op: "rect", colour: "red", alpha: 0.8, x: 0.5, y: 70, w: 19, h: 50 }]);
});

test("statuses are bands of states, a row each, a state told by its strength", () => {
  const states = curve("states", [
    { t0: 0, t1: 50, v: 1 },
    { t0: 50, t1: 100, v: 4 },
  ]);

  const ops = marks([
    lane(states, {
      axis: null,
      states: true,
      curves: [
        { colour: "red", curve: states },
        { colour: "blue", curve: curve("states", [{ t0: 0, t1: 100, v: 7 }]) },
      ],
    }),
  ]);

  expect(ops).toEqual([
    { op: "rect", colour: "red", alpha: 0.35, x: 0, y: 24, w: 100, h: 12 },
    { op: "rect", colour: "red", alpha: 1, x: 100, y: 24, w: 100, h: 12 },
    { op: "rect", colour: "blue", alpha: 1, x: 0, y: 42, w: 200, h: 12 },
  ]);
});

test("mixed tiers share one time axis", () => {
  const ops = marks([
    lane(curve("line", [{ t0: 0, t1: 100, v: 5 }], "raw")),
    lane(curve("bars", [{ t0: 50, t1: 100, v: 10 }], "day"), { box: { top: 130, height: 100 } }),
  ]);

  expect(ops).toEqual([
    {
      op: "line",
      colour: "red",
      points: [
        [0, 70],
        [200, 70],
      ],
    },
    { op: "rect", colour: "red", alpha: 0.8, x: 100.5, y: 130, w: 99, h: 100 },
  ]);
});

test("lanes stack in the chart's height; a lane of states is as tall as its rows", () => {
  expect(layout([{ rows: 0 }, { rows: 2 }, { rows: 0 }], 300)).toEqual([
    { top: 0, height: 112 },
    { top: 128, height: 44 },
    { top: 188, height: 112 },
  ]);
});
