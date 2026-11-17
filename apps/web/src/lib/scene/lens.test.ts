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

const FROST = { rain: 0, snow: 0, frost: 0.3 };

test("frost that has faded in stands: nothing on the lens moves, and it is not clear", () => {
  const fade = new Fade();

  fade.aim(FROST);
  expect(fade.still).toBe(false);
  fade.at(0);
  fade.at(0.5);
  expect(fade.still).toBe(false);
  // From part of the way, in steps that do not add up evenly.
  fade.at(0.7);
  expect(fade.at(1.1)).toEqual(FROST);
  expect(fade.still).toBe(true);
  expect(fade.clear).toBe(false);
});

test("rain and snow on the lens never stand, and frost stands only once they are gone", () => {
  const fade = new Fade();

  fade.aim({ rain: 0.5, snow: 0, frost: 1 });
  fade.at(0);
  fade.at(3);
  expect(fade.still).toBe(false);

  fade.aim({ rain: 0, snow: 0, frost: 1 });
  fade.at(4);
  expect(fade.still).toBe(false);
  expect(fade.at(5)).toEqual({ rain: 0, snow: 0, frost: 1 });
  expect(fade.still).toBe(true);

  fade.aim({ rain: 0, snow: 0.4, frost: 1 });
  expect(fade.still).toBe(false);
});

test("frost that stood fades out from the frame it is taken up in: no leap", () => {
  const fade = new Fade();

  fade.aim({ rain: 0, snow: 0, frost: 1 });
  fade.at(0);
  fade.at(3);
  expect(fade.still).toBe(true);

  fade.aim(null);
  expect(fade.still).toBe(false);
  // The loop's clock ran on meanwhile, for something else.
  expect(fade.at(40)).toEqual({ rain: 0, snow: 0, frost: 1 });
  expect(fade.at(41.5)).toEqual({ rain: 0, snow: 0, frost: 0.5 });
  expect(fade.at(43)).toBeNull();
  expect(fade.clear).toBe(true);
  // Clear, nothing moves either, but there is nothing to keep drawn.
  expect(fade.still).toBe(false);
});
