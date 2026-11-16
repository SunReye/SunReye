import { expect, test } from "bun:test";
import { axisOf, runs, sampleAt, tickDigits, valueDigits, vertices, type Curve } from "./curve.ts";

const at = (t0: number, t1: number, v: number) => ({ t0, t1, v });

const line = (samples: Curve["samples"], tier: Curve["tier"] = "bucket"): Curve => ({
  draw: "line",
  tier,
  samples,
});

test("a gap breaks a curve into runs", () => {
  const samples = [at(0, 60, 1), at(60, 120, 2), at(180, 240, 3)];

  expect(runs(samples).map((run) => run.map((s) => s.v))).toEqual([[1, 2], [3]]);
});

test("the sample under an instant is the one that holds it; a gap holds none", () => {
  const curve = line([at(0, 60, 1), at(60, 120, 2), at(180, 240, 3)]);

  expect(sampleAt(curve, 60)?.v).toBe(2);
  expect(sampleAt(curve, 239)?.v).toBe(3);
  expect(sampleAt(curve, 150)).toBeNull();
  expect(sampleAt(curve, 240)).toBeNull();
});

test("a line of means runs through each span's middle", () => {
  expect(vertices(line([at(0, 60, 1), at(60, 120, 2)]))).toEqual([
    [
      [30, 1],
      [90, 2],
    ],
  ]);
});

test("a line of raw intervals holds each value until the next change", () => {
  expect(vertices(line([at(0, 50, 1), at(50, 120, 2)], "raw"))).toEqual([
    [
      [0, 1],
      [50, 1],
      [50, 2],
      [120, 2],
    ],
  ]);
});

test("a mean alone between gaps spans its time", () => {
  expect(vertices(line([at(0, 60, 1)]))).toEqual([
    [
      [0, 1],
      [60, 1],
    ],
  ]);
});

test("an axis from near zero starts at zero and ticks at round figures", () => {
  const axis = axisOf([line([at(0, 1, 120), at(1, 2, 4300)])]);

  expect(axis?.min).toBe(0);
  expect(axis?.max).toBeGreaterThan(4300);
  expect(axis?.max).toBeLessThan(4600);
  expect(axis?.ticks).toEqual([0, 2000, 4000]);
});

test("an axis far from zero fits the values, a band's extremes included", () => {
  const axis = axisOf([line([{ t0: 0, t1: 1, v: 231, lo: 228, hi: 236 }])]);

  expect(axis?.min).toBeLessThan(228);
  expect(axis?.min).toBeGreaterThan(226);
  expect(axis?.ticks).toEqual([230, 235]);
});

test("bars stand on zero, below it too", () => {
  const axis = axisOf([{ draw: "bars", tier: "hour", samples: [at(0, 1, 40), at(1, 2, 55)] }]);

  expect(axis?.min).toBe(0);
  expect(axisOf([{ draw: "bars", tier: "hour", samples: [at(0, 1, -40)] }])?.max).toBe(0);
});

test("a flat series still has an axis around its value", () => {
  const axis = axisOf([line([at(0, 1, 50), at(1, 2, 50)])]);

  expect(axis!.max).toBeGreaterThan(axis!.min);
});

test("nothing to draw has no axis", () => {
  expect(axisOf([line([])])).toBeNull();
});

const stepped = (step: number) => ({ min: 0, max: 1, ticks: [], step });

test("a value is written a decimal finer than its axis needs, a tick as its step asks", () => {
  expect([5, 2, 1, 0.5, 0.1].map((step) => valueDigits(stepped(step)))).toEqual([0, 0, 1, 1, 2]);
  expect([2000, 1, 0.5, 0.02].map((step) => tickDigits(stepped(step)))).toEqual([0, 0, 1, 2]);
});
