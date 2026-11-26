import { expect, test } from "vitest";
import { presetView } from "@sunreye/builder";
import { detent, eaveHeading, headingOf, withHeading } from "@sunreye/builder/values";
import type { Geometry, RoofFace } from "../../../../../../packages/builder/src/builder/pv.ts";

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

/** A face sloping up toward `bearing` degrees clockwise from north, 30° steep. */
function sloping(bearing: number): RoofFace {
  const by = (bearing * Math.PI) / 180;
  const slope = Math.PI / 6;
  const [e, n] = [Math.sin(by), Math.cos(by)];

  return {
    block: 0,
    face: 0,
    tilt: 30,
    azimuth: bearing + 180,
    outline: [
      [0, 0],
      [10, 0],
      [10, 4],
      [0, 4],
    ],
    origin: [0, 0, 3],
    across: [n, -e, 0],
    up: [e * Math.cos(slope), n * Math.cos(slope), Math.sin(slope)],
  };
}

test("the plan turned to a heading looks that way up the screen, about the same target, as far", () => {
  const plan = presetView("top", house);
  const turned = withHeading(plan, 37);

  const length = (view: typeof plan): number =>
    Math.hypot(...view.position.map((p, i) => p - (view.target[i] ?? 0)));

  expect(headingOf(turned)).toBeCloseTo(37, 6);
  expect(turned.target).toEqual(plan.target);
  expect(length(turned)).toBeCloseTo(length(plan), 9);
  expect(headingOf(withHeading(turned, -10))).toBeCloseTo(350, 6);
  expect(headingOf(withHeading(turned, 0))).toBeCloseTo(0, 6);
});

test("a face's eave lies level with the face above it: the plan looks up its slope", () => {
  expect(eaveHeading(sloping(0))).toBeCloseTo(0, 6);
  expect(eaveHeading(sloping(112))).toBeCloseTo(112, 6);
  expect(eaveHeading(sloping(250))).toBeCloseTo(250, 6);
});

test("a flat face lies with its eave across the screen", () => {
  const flat: RoofFace = { ...sloping(0), across: [0, 1, 0], up: [-1, 0, 1e-9] };

  expect(eaveHeading({ ...flat, up: [0, 0, 1] })).toBeCloseTo(270, 6);
});

test("a heading near a stop takes it; further off, or with none near, it stays", () => {
  expect(detent(2.5, [0, 112])).toBe(0);
  expect(detent(358, [0])).toBe(0);
  expect(detent(110, [0, 112])).toBe(112);
  expect(detent(20, [0, 112])).toBe(20);
});
