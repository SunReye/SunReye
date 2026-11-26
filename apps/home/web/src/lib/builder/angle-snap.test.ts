/// <reference types="bun" />
import { expect, test } from "bun:test";
import { angleSnap } from "../../../../../../packages/builder/src/builder/angle-snap.ts";

const near = (actual: readonly number[], expected: readonly number[]): void => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, i) => {
    expect(value).toBeCloseTo(expected[i] ?? Number.NaN, 6);
  });
};

test("a line a few degrees off square to the last turns square, its length kept along it", () => {
  // The last line ran east; the pointer is 2° off north of the corner.
  const tilt = (2 * Math.PI) / 180;
  const pointer = [10 + 5 * Math.sin(tilt), -5 * Math.cos(tilt)] as const;
  const snapped = angleSnap([10, 0], pointer, { previous: [1, 0], edges: [] });

  expect(snapped?.angle).toBeCloseTo(90, 6);
  near(snapped?.at ?? [], [10, -5 * Math.cos(tilt)]);
});

test("45° to the last line snaps, and a straight run on shows 180°", () => {
  const diagonal = angleSnap([0, 0], [5, 5.2], { previous: [1, 0], edges: [] });
  const straight = angleSnap([0, 0], [5, 0.1], { previous: [1, 0], edges: [] });

  expect(diagonal?.angle).toBeCloseTo(135, 6);
  expect(straight?.angle).toBeCloseTo(180, 6);
});

test("the chain's first line's direction snaps too: a rectangle closes square", () => {
  // The first line ran along a slanted 30°; the last went 7° off it, so only the first squares.
  const first = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)] as const;
  const previous = [Math.cos(Math.PI / 6 + 0.12), Math.sin(Math.PI / 6 + 0.12)] as const;
  const back = Math.PI / 6 + Math.PI / 2 + 0.03;

  const snapped = angleSnap([0, 0], [8 * Math.cos(back), 8 * Math.sin(back)], {
    previous,
    first,
    edges: [],
  });

  const [x = 0, z = 0] = snapped?.at ?? [];

  expect(Math.atan2(z, x)).toBeCloseTo(Math.PI / 6 + Math.PI / 2, 6);
});

test("a nearby edge's direction snaps: parallel and square to it", () => {
  const edge = [Math.cos(0.4), Math.sin(0.4)] as const;
  const parallel = angleSnap([0, 0], [6 * Math.cos(0.42), 6 * Math.sin(0.42)], { edges: [edge] });
  const square = angleSnap([0, 0], [6 * Math.cos(0.4 + Math.PI / 2 - 0.03), 6], { edges: [edge] });
  const [px = 0, pz = 0] = parallel?.at ?? [];
  const [sx = 0, sz = 0] = square?.at ?? [];

  expect(Math.atan2(pz, px)).toBeCloseTo(0.4, 6);
  expect(parallel?.angle).toBeCloseTo(0, 6);
  expect((sx * edge[0] + sz * edge[1]) / Math.hypot(sx, sz)).toBeCloseTo(0, 6);
  expect(square?.angle).toBeCloseTo(90, 6);
});

test("far off every direction, nothing snaps; with nothing to go by, the axes and 45° do", () => {
  expect(angleSnap([0, 0], [5, 2], { previous: [1, 0], edges: [] })).toBeUndefined();
  near(angleSnap([0, 0], [4, 4.1], { edges: [] })?.at ?? [], [4.05, 4.05]);
});

test("the guide runs through the corner along the snapped direction", () => {
  const snapped = angleSnap([2, 3], [2.05, 8], { previous: [1, 0], edges: [] });
  const [from, to] = snapped?.guide ?? [];
  const [fx = 0, fz = 0] = from ?? [];
  const [tx = 0, tz = 0] = to ?? [];

  expect(Math.abs(fx - 2)).toBeLessThan(1e-9);
  expect(Math.abs(tx - 2)).toBeLessThan(1e-9);
  expect(fz).toBeLessThan(3);
  expect(tz).toBeGreaterThan(8);
});
