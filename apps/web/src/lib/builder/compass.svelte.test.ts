// The compass a consumer draws over a view, and the view from above it turns (ADR 25 "The view").
import { expect, test } from "vitest";
import type { Geometry } from "@sunreye/pv-wasm";
import { headingOf, presetView } from "@sunreye/builder";

const house: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [0, 0, 3],
        [10, 0, 3],
        [10, -8, 3],
        [0, -8, 3],
      ],
    },
  ],
  solids: [],
};

/** Degrees, to the nearest one. */
const degrees = (heading: number): number => Math.round(heading) % 360;

test("a view's heading is the compass bearing it looks toward", () => {
  expect(degrees(headingOf(presetView("south", house)))).toBe(0);
  expect(degrees(headingOf(presetView("west", house)))).toBe(90);
  expect(degrees(headingOf(presetView("north", house)))).toBe(180);
  expect(degrees(headingOf(presetView("east", house)))).toBe(270);
});

test("the view from above looks north up the screen, and turned to a heading looks that way", () => {
  expect(degrees(headingOf(presetView("top", house)))).toBe(0);

  const turned = presetView("top", house, 1, 90);

  expect(degrees(headingOf(turned))).toBe(90);
  // Still from above: as high over the scene as the unturned view.
  expect(turned.position[1]).toBeCloseTo(presetView("top", house).position[1]);
});

test("a preset turned a whole turn is the preset", () => {
  const view = presetView("isometric", house, 1, 360);
  const plain = presetView("isometric", house);

  for (const axis of [0, 1, 2] as const) {
    expect(view.position[axis]).toBeCloseTo(plain.position[axis]);
  }
});
