/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  faceView,
  FOV,
  parseView,
  presetView,
  type View,
} from "../../../../../packages/builder/src/builder/camera.ts";
import type { Geometry, RoofFace } from "../../../../../packages/builder/src/builder/pv.ts";

// A 10 m × 8 m footprint, 4 m high, its corner at the origin: centred at (5, 2, 4) in three.js.
const house: Geometry = {
  faces: [
    {
      surface: "wall",
      corners: [
        [0, 0, 0],
        [10, 0, 0],
        [10, -8, 4],
      ],
    },
  ],
  solids: [],
};

function offset({ position, target }: View): number[] {
  return position.map((value, i) => value - (target[i] ?? 0));
}

test("every preset looks at the scene's centre from the same distance, clear of the scene", () => {
  const distances = (["north", "east", "south", "west", "top", "isometric"] as const).map(
    (preset) => {
      const view = presetView(preset, house);

      expect(view.target).toEqual([5, 2, 4]);

      return Math.hypot(...offset(view));
    },
  );

  expect(new Set(distances.map((d) => d.toFixed(6))).size).toBe(1);
  // Half the box's diagonal is √(25 + 4 + 16) ≈ 6.7 m.
  expect(distances[0]).toBeGreaterThan(6.7 * 2);
});

test("the north view stands north of the scene, the east view east of it", () => {
  const [, , north] = offset(presetView("north", house));
  const [east] = offset(presetView("east", house));

  // three.js: north is −z.
  expect(north).toBeLessThan(0);
  expect(east).toBeGreaterThan(0);
});

test("the top view looks straight down, the isometric view from the south-east at 35°", () => {
  const [x = 0, y = 0, z = 0] = offset(presetView("top", house));
  const [ix = 0, iy = 0, iz = 0] = offset(presetView("isometric", house));

  expect(Math.hypot(x, z) / y).toBeLessThan(0.01);
  expect(ix).toBeCloseTo(iz, 6);
  expect(iy).toBeCloseTo(ix, 6);
  expect(ix).toBeGreaterThan(0);
});

test("an empty scene is seen around the origin, 25 m off, so a template's house lands in view", () => {
  const { position, target } = presetView("isometric", { faces: [], solids: [] });

  expect(target).toEqual([0, 0, 0]);
  expect(Math.hypot(...position)).toBeCloseTo(25, 6);
});

test("a kept view reads back; anything else is no view", () => {
  const view = presetView("west", house);

  expect(parseView(JSON.stringify(view))).toEqual(view);
  expect(parseView(null)).toBeUndefined();
  expect(parseView("{")).toBeUndefined();
  expect(parseView('{"position":[1,2],"target":[0,0,0]}')).toBeUndefined();
});

test("a canvas narrower than tall stands the camera back until the scene fits across it", () => {
  const square = Math.hypot(...offset(presetView("isometric", house)));
  const phone = Math.hypot(...offset(presetView("isometric", house, 0.5)));
  const wide = Math.hypot(...offset(presetView("isometric", house, 2)));

  // Twice as narrow, twice as far: the same width of the scene across the canvas.
  expect(phone / square).toBeCloseTo(2, 6);
  expect(wide).toBeCloseTo(square, 6);
});

// A south roof 10 m along the eave and 4 m up a 30° slope, its eave 3 m up.
const SLOPE = Math.PI / 6;

const roof: RoofFace = {
  block: 0,
  face: 1,
  tilt: 30,
  azimuth: 0,
  outline: [
    [0, 0],
    [10, 0],
    [10, 4],
    [0, 4],
  ],
  origin: [0, 0, 3],
  across: [1, 0, 0],
  up: [0, Math.cos(SLOPE), Math.sin(SLOPE)],
};

/** Metres across a canvas `aspect` wide that the camera sees at the view's target. */
function seenAcross(view: View, aspect: number): number {
  return 2 * Math.hypot(...offset(view)) * Math.tan((FOV / 2) * (Math.PI / 180)) * aspect;
}

test("a face's view looks straight at its middle, from outside the roof", () => {
  const view = faceView(roof, 1);
  const [x = 0, y = 0, z = 0] = offset(view);
  const far = Math.hypot(x, y, z);

  // Halfway along the eave and halfway up the slope; three.js has y up and z south.
  expect(view.target[0]).toBeCloseTo(5, 6);
  expect(view.target[1]).toBeCloseTo(3 + 2 * Math.sin(SLOPE), 6);
  expect(view.target[2]).toBeCloseTo(-2 * Math.cos(SLOPE), 6);
  // Along the face's normal, which leans south and up, within a fraction of a degree.
  expect(x / far).toBeCloseTo(0, 2);
  expect(y / far).toBeCloseTo(Math.cos(SLOPE), 2);
  expect(z / far).toBeCloseTo(Math.sin(SLOPE), 2);
});

test("on a phone's canvas a face fills the width: a metre of roof is a finger wide", () => {
  const phone = 390 / 760;
  const across = seenAcross(faceView(roof, phone), phone);

  // All 10 m of eave are in view, and a metre takes at least 30 of the 390 px.
  expect(across).toBeGreaterThanOrEqual(10);
  expect(390 / across).toBeGreaterThanOrEqual(30);
});

test("a low wide canvas fits the face's height instead", () => {
  const wide = 3;
  const high = seenAcross(faceView(roof, wide), wide) / wide;

  expect(high).toBeGreaterThanOrEqual(4);
  expect(high).toBeLessThan(6);
});

test("a flat roof is seen from a hair off vertical, as the orbit camera needs", () => {
  const flat: RoofFace = { ...roof, tilt: 0, up: [0, 1, 0] };
  const [x = 0, y = 0, z = 0] = offset(faceView(flat, 1));

  expect(y).toBeGreaterThan(0);
  expect(Math.hypot(x, z)).toBeGreaterThan(0);
  expect(Math.hypot(x, z) / y).toBeLessThan(0.01);
});
