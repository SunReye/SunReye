// Special constructions (ADR 20), all by the same tracing: an L-shaped house, roofs joined at
// different heights, an attached garage, a terrace cut into a roof.

import { expect, test } from "bun:test";
import { bent, markLine, pullEaves, pullRidges } from "./index.js";
import { EMPTY, made, trace } from "./roof.harness.ts";
import { built, height, line, placed, typed, zoomed } from "./roof-ready.harness.ts";

test("an L-shaped house: two gables, a valley at the inner corner and a hip at the outer", () => {
  const outline = trace(EMPTY, [0, 0], [0, 12], [12, 12], [12, 6], [6, 6], [6, 0], [0, 0]);
  const ridges = trace(trace(outline, [3, 0], [3, 9], [12, 9]), [6, 6], [3, 9]);
  const traced = trace(ridges, [0, 12], [3, 9]);
  const clicked = made(pullRidges(made(pullEaves(traced, 0, 3)), 0, 6));

  expect(height(clicked, 6, 6)).toBe(3);
  expect(height(clicked, 3, 9)).toBe(6);
  expect(bent(clicked, 0)).toEqual([]);
  expect(built(clicked)).toHaveLength(4);
});

test("two roofs joined at different heights: a lower wing's ridge runs into the house's face", () => {
  const traced = trace(
    trace(
      trace(EMPTY, [0, 0], [10, 0], [10, 8], [7, 8], [7, 12], [3, 12], [3, 8], [0, 8], [0, 0]),
      [0, 4],
      [10, 4],
    ),
    [3, 8],
    [5, 6],
    [5, 12],
  );

  const valleys = trace(traced, [7, 8], [5, 6]);
  const pulled = made(pullRidges(made(pullEaves(valleys, 0, 3)), 0, 7));
  const clicked = typed(pulled, 5, [5, 6], [5, 12]);

  expect(height(clicked, 10, 4)).toBe(7);
  expect(height(clicked, 5, 12)).toBe(5);
  expect(bent(clicked, 0)).toEqual([]);
  expect(built(clicked)).toHaveLength(4);
});

test("an attached garage: traced onto a ready house's eave, its roof falling away from it", () => {
  const house = placed("satteldach");
  const traced = trace(house, [2, 8], [2, 11], [8, 11], [8, 8]);
  const clicked = typed(made(pullEaves(traced, 0, 3)), 2.8, [2, 11], [8, 11]);

  expect(height(clicked, 2, 8)).toBe(3);
  expect(height(clicked, 8, 11)).toBe(2.8);
  expect(height(clicked, 10, 4)).toBe(7);
  expect(bent(clicked, 0)).toEqual([]);
  expect(built(clicked)).toHaveLength(3);
});

test("a terrace cut into a roof: a level floor at the eaves, walled by strips 10 cm wide", () => {
  const cut = trace(placed("satteldach"), [3, 8], [3, 6], [7, 6], [7, 8]);
  const walls = zoomed(zoomed(cut, [3, 6], [3.1, 6.1], [6.9, 6.1], [7, 6]), [3, 8], [3.1, 6.1]);
  const traced = zoomed(walls, [6.9, 6.1], [7, 8]);
  const back = made(markLine(traced, 0, line(traced, [3.1, 6.1], [6.9, 6.1]), "eave"));
  const floor = made(markLine(back, 0, line(back, [3, 8], [3.1, 6.1]), "eave"));
  const level = made(markLine(floor, 0, line(floor, [6.9, 6.1], [7, 8]), "eave"));
  const clicked = typed(made(pullEaves(level, 0, 3)), 5, [3, 6], [7, 6]);

  expect(height(clicked, 3.1, 6.1)).toBe(3);
  expect(height(clicked, 7, 8)).toBe(3);
  expect(height(clicked, 7, 6)).toBe(5);
  expect(bent(clicked, 0)).toEqual([]);
  // Two roof faces, the floor, its back wall and a cheek either side.
  expect(built(clicked)).toHaveLength(6);
});
