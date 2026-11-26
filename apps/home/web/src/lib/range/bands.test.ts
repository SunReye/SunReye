import { expect, test } from "bun:test";
import { ticksOf, type Scale } from "./bands.ts";

const scale = (upMax: number, downMax: number): Scale => ({
  upMax,
  downMax,
  span: upMax + downMax,
  zero: (upMax / (upMax + downMax)) * 100,
});

const figures = (s: Scale) => ticksOf(s).map((t) => [t.v, t.text]);

test("the lower side mirrors the upper side's step, unsigned", () => {
  expect(figures(scale(4, 3))).toEqual([
    [4, "4"],
    [2, "2"],
    [0, "0"],
    [-2, "2"],
  ]);
});

test("the deeper side sets the step, so a shallow upper side never multiplies the gridlines", () => {
  expect(figures(scale(1, 30))).toEqual([
    [0, "0"],
    [-15, "15"],
    [-30, "30"],
  ]);
  expect(figures(scale(4, 5))).toEqual([
    [2.5, "2,5"],
    [0, "0"],
    [-2.5, "2,5"],
    [-5, "5"],
  ]);
});

test("a lower side shallower than a step has the baseline alone", () => {
  expect(figures(scale(4, 0.6))).toEqual([
    [4, "4"],
    [2, "2"],
    [0, "0"],
  ]);
});

test("a one-sided chart ticks its top, its half and the baseline", () => {
  expect(figures(scale(100, 0))).toEqual([
    [100, "100"],
    [50, "50"],
    [0, "0"],
  ]);
});
