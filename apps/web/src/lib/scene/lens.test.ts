/// <reference types="bun" />
import { expect, test } from "bun:test";
import { Fade } from "./lens.ts";

const RAIN = { rain: 1, snow: 0, frost: 0 };

test("the glass fades in over three seconds of the loop, and stays", () => {
  const fade = new Fade();

  fade.aim(RAIN);
  // The first frame starts the fade: nothing is on the lens yet.
  expect(fade.at(10)).toBeNull();
  expect(fade.at(11.5)).toEqual({ rain: 0.5, snow: 0, frost: 0 });
  expect(fade.at(13)).toEqual(RAIN);
  expect(fade.at(60)).toEqual(RAIN);
  expect(fade.clear).toBe(false);
});

test("it fades out as the weather clears, and is clear only once nothing is left", () => {
  const fade = new Fade();

  fade.aim(RAIN);
  fade.at(0);
  fade.at(3);
  fade.aim(null);
  expect(fade.clear).toBe(false);
  expect(fade.at(4.5)).toEqual({ rain: 0.5, snow: 0, frost: 0 });
  expect(fade.clear).toBe(false);
  expect(fade.at(6)).toBeNull();
  expect(fade.clear).toBe(true);
});

test("rain turning to snow crosses over: each at its own pace", () => {
  const fade = new Fade();

  fade.aim(RAIN);
  fade.at(0);
  fade.at(3);
  fade.aim({ rain: 0, snow: 0.5, frost: 1 });
  expect(fade.at(4.5)).toEqual({ rain: 0.5, snow: 0.5, frost: 0.5 });
  expect(fade.at(6)).toEqual({ rain: 0, snow: 0.5, frost: 1 });
});

test("cut, nothing is on the lens at once", () => {
  const fade = new Fade();

  fade.aim(RAIN);
  fade.at(0);
  fade.at(2);
  fade.cut();
  expect(fade.clear).toBe(true);
  expect(fade.at(2.1)).toBeNull();
});

test("a fade taken up again after the loop stood still goes on from where it was", () => {
  const fade = new Fade();

  fade.aim(RAIN);
  fade.at(0);
  fade.at(1.5);
  fade.cut();
  fade.aim(RAIN);
  // The loop's clock ran on meanwhile, for something else: no leap.
  expect(fade.at(40)).toBeNull();
  expect(fade.at(41.5)).toEqual({ rain: 0.5, snow: 0, frost: 0 });
});
