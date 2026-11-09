/// <reference types="bun" />
import { expect, test } from "bun:test";
import { parseView, presetView, type View } from "./camera.ts";
import type { Geometry } from "./pv.ts";

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

test("a kept view reads back; anything else is no view", () => {
  const view = presetView("west", house);

  expect(parseView(JSON.stringify(view))).toEqual(view);
  expect(parseView(null)).toBeUndefined();
  expect(parseView("{")).toBeUndefined();
  expect(parseView('{"position":[1,2],"target":[0,0,0]}')).toBeUndefined();
});
