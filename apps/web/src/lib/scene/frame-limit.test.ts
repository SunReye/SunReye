/// <reference types="bun" />
import { expect, test } from "bun:test";
import { frameInterval, Pace, parseFrameLimit, type FrameLimit } from "./frame-limit.ts";

// The frame limit (ADR 21 "Frame limit"): the most frames a second the 3D scene draws.

test("a kept limit is read back; anything unreadable is unlimited", () => {
  expect(parseFrameLimit("60")).toBe("60");
  expect(parseFrameLimit("30")).toBe("30");
  expect(parseFrameLimit("unlimited")).toBe("unlimited");
  expect(parseFrameLimit("24")).toBe("unlimited");
  expect(parseFrameLimit(null)).toBe("unlimited");
});

test("a limit is the milliseconds between two frames; unlimited is none", () => {
  expect(frameInterval("unlimited")).toBe(0);
  expect(frameInterval("60")).toBeCloseTo(16.667, 2);
  expect(frameInterval("30")).toBeCloseTo(33.333, 2);
});

/** How many of a display's frames, `ms` apart for a second, the pace takes at `limit`. */
function taken(limit: FrameLimit, ms: number): number {
  const pace = new Pace(() => frameInterval(limit));
  let frames = 0;

  for (let now = 1000; now < 2000 - 1e-6; now += ms) if (pace.take(now)) frames += 1;

  return frames;
}

test("unlimited takes every frame the display gives", () => {
  expect(taken("unlimited", 1000 / 60)).toBe(60);
  expect(taken("unlimited", 1000 / 120)).toBe(120);
});

test("a limit takes at most its frames a second, on any display", () => {
  expect(taken("60", 1000 / 60)).toBe(60);
  expect(taken("60", 1000 / 120)).toBe(60);
  expect(taken("30", 1000 / 60)).toBe(30);
  expect(taken("30", 1000 / 120)).toBe(30);
  // A display whose frames do not divide into the limit's: early and late ones even out.
  expect(taken("60", 1000 / 144)).toBe(60);
  expect(taken("30", 1000 / 144)).toBe(30);
  expect(taken("60", 1000 / 90)).toBeLessThanOrEqual(60);
  // A display slower than the limit gives all it has.
  expect(taken("60", 1000 / 50)).toBe(50);
});

test("a frame that comes a little early is taken: 60 Hz with jitter still gives 30", () => {
  const pace = new Pace(() => frameInterval("30"));
  let now = 1000;
  let frames = 0;

  for (let i = 0; i < 30; i++) {
    if (pace.take((now += 1000 / 60 - 2))) frames += 1;

    if (pace.take((now += 1000 / 60 + 2))) frames += 1;
  }

  expect(frames).toBe(30);
});

test("a display a hair faster than the limit keeps every frame: the pace follows its beat", () => {
  // 60.05 Hz, as displays called 60 Hz run, for twenty seconds.
  const ms = 1000 / 60.05;
  const sixty = new Pace(() => frameInterval("60"));
  const thirty = new Pace(() => frameInterval("30"));
  const gaps = new Set<number>();
  let [frames, last] = [0, 0];

  for (let i = 0; i < 1201; i++) {
    if (sixty.take(1000 + i * ms)) frames += 1;

    if (thirty.take(1000 + i * ms)) {
      gaps.add(i - last);
      last = i;
    }
  }

  expect(frames).toBe(1201);
  // Under 30 every other frame, never a third skipped.
  expect([...gaps].toSorted((a, b) => a - b)).toEqual([0, 2]);
});

test("a display well faster than the limit is not followed: 63 Hz under 60 gives 60", () => {
  expect(taken("60", 1000 / 63)).toBeLessThanOrEqual(60);
});

test("the first frame after a rest is taken at once, and a change of limit holds from the next", () => {
  let limit: FrameLimit = "30";
  const pace = new Pace(() => frameInterval(limit));

  expect(pace.take(5000)).toBe(true);
  expect(pace.take(5016)).toBe(false);
  expect(pace.take(60_000)).toBe(true);

  limit = "unlimited";
  expect(pace.take(60_008)).toBe(true);
});
