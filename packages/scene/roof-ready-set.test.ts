// Ready roofs whose heights the outline and inner lines do not give (ADR 20): a Mansard roof's
// break, a Krüppelwalm's hips, a barrel's strips. The person sets them, and so does the ready roof.

import { expect, test } from "bun:test";
import { bent, markLine, pullEaves, pullRidges } from "./index.js";
import { EMPTY, made, trace } from "./roof.harness.ts";
import { OUTLINE, built, height, line, placed, typed, zoomed } from "./roof-ready.harness.ts";

test("a Krüppelwalmdach's hips start halfway up its verges, where the person sets their height", () => {
  const ridge = trace(trace(EMPTY, ...OUTLINE), [0, 2], [2, 4], [8, 4], [10, 2]);
  const traced = trace(trace(ridge, [0, 6], [2, 4]), [8, 4], [10, 6]);
  const pulled = made(pullRidges(made(pullEaves(traced, 0, 3)), 0, 7));
  const clicked = typed(pulled, 5, [0, 2], [0, 6], [10, 2], [10, 6]);

  expect(height(clicked, 0, 2)).toBe(5);
  expect(height(clicked, 2, 4)).toBe(7);
  expect(bent(clicked, 0)).toEqual([]);
  expect(built(placed("krueppelwalmdach"))).toEqual(built(clicked));
  expect(built(clicked)).toHaveLength(4);
});

test("a Mansarddach breaks a sixth of its depth in, two thirds of the way up", () => {
  const traced = trace(
    trace(trace(trace(EMPTY, ...OUTLINE), [0, 4], [10, 4]), [0, 8 / 6], [10, 8 / 6]),
    [0, 40 / 6],
    [10, 40 / 6],
  );

  const pulled = made(pullRidges(made(pullEaves(traced, 0, 3)), 0, 7));
  const clicked = typed(pulled, 3 + 8 / 3, [0, 8 / 6], [10, 8 / 6], [0, 40 / 6], [10, 40 / 6]);

  expect(height(clicked, 10, 8 / 6)).toBeCloseTo(5.667, 3);
  expect(height(clicked, 10, 4)).toBe(7);
  expect(bent(clicked, 0)).toEqual([]);
  expect(built(placed("mansarddach"))).toEqual(built(clicked));
  expect(built(clicked)).toHaveLength(4);
});

test("a Mansardwalmdach breaks all round, a hip roof on its break", () => {
  const b = 8 / 6;

  const inner = [
    [b, b],
    [10 - b, b],
    [10 - b, 8 - b],
    [b, 8 - b],
  ] as const;

  const mitred = OUTLINE.slice(0, 4).reduce(
    (at, corner, k) => trace(at, corner, inner[k] ?? corner),
    trace(EMPTY, ...OUTLINE),
  );

  const broken = trace(mitred, ...inner, inner[0]);
  const hips = trace(trace(broken, [b, b], [4, 4], [6, 4], [10 - b, b]), [b, 8 - b], [4, 4]);

  const pulled = made(
    pullRidges(made(pullEaves(trace(hips, [6, 4], [10 - b, 8 - b]), 0, 3)), 0, 7),
  );

  const clicked = typed(pulled, 3 + 8 / 3, ...inner);

  expect(height(clicked, b, b)).toBeCloseTo(5.667, 3);
  expect(height(clicked, 4, 4)).toBe(7);
  expect(bent(clicked, 0)).toEqual([]);
  expect(built(placed("mansardwalmdach"))).toEqual(built(clicked));
  expect(built(clicked)).toHaveLength(8);
});

test("a Schleppdach drags its front face past the gable's eave at half the pitch", () => {
  const traced = trace(
    trace(trace(EMPTY, ...OUTLINE), [0, 8 / 3], [10, 8 / 3]),
    [0, 16 / 3],
    [10, 16 / 3],
  );

  const pulled = made(pullRidges(made(pullEaves(traced, 0, 3)), 0, 7));
  const clicked = typed(pulled, 3 + 4 / 3, [0, 0], [10, 0], [0, 16 / 3], [10, 16 / 3]);

  expect(height(clicked, 0, 0)).toBeCloseTo(4.333, 3);
  expect(height(clicked, 0, 8)).toBe(3);
  expect(bent(clicked, 0)).toEqual([]);
  expect(built(placed("schleppdach"))).toEqual(built(clicked));
  expect(built(clicked)).toHaveLength(3);
});

test("a Sheddach is three teeth, each rising to a strip 10 cm wide that drops to the next", () => {
  const t = 8 / 3;

  const lines = [t - 0.1, t, 2 * t - 0.1, 2 * t].reduce(
    (at, z) => zoomed(at, [0, z], [10, z]),
    trace(EMPTY, ...OUTLINE),
  );

  const low = made(markLine(lines, 0, line(lines, [0, t], [10, t]), "eave"));
  const lower = made(markLine(low, 0, line(low, [0, 2 * t], [10, 2 * t]), "eave"));
  const marked = made(markLine(lower, 0, line(lower, [0, 8], [10, 8]), "ridge"));
  const clicked = made(pullRidges(made(pullEaves(marked, 0, 3)), 0, 7));

  expect([0, t - 0.1, t, 2 * t - 0.1, 2 * t, 8].map((z) => height(clicked, 10, z))).toEqual([
    3, 7, 3, 7, 3, 7,
  ]);
  expect(bent(clicked, 0)).toEqual([]);
  expect(built(placed("sheddach"))).toEqual(built(clicked));
  expect(built(clicked)).toHaveLength(5);
});

test("a Tonnendach is six flat strips on the arc through its eaves and its top", () => {
  const zs = [1, 2, 3, 4, 5].map((k) => (k * 8) / 6);
  const traced = zs.reduce((at, z) => trace(at, [0, z], [10, z]), trace(EMPTY, ...OUTLINE));
  const pulled = made(pullRidges(made(pullEaves(traced, 0, 3)), 0, 7));
  // A half circle of 4 m round (4, 3): 3 + √(16 − (z − 4)²).

  const clicked = [8 / 6, 16 / 6, 32 / 6, 40 / 6].reduce(
    (at, z) => typed(at, 3 + Math.sqrt(16 - (z - 4) ** 2), [0, z], [10, z]),
    pulled,
  );

  expect(height(clicked, 0, 8 / 6)).toBeCloseTo(5.981, 3);
  expect(height(clicked, 0, 16 / 6)).toBeCloseTo(6.771, 3);
  expect(height(clicked, 0, 4)).toBe(7);
  expect(bent(clicked, 0)).toEqual([]);
  expect(built(placed("tonnendach"))).toEqual(built(clicked));
  expect(built(clicked)).toHaveLength(6);
});
