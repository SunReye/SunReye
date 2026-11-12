/// <reference types="bun" />
// Ported from v3 (dev 780b4e2, components/inverter/_shared/glide.test.ts): the one glide policy
// the number readouts and the live graph (#719) share.
import { describe, expect, test } from "bun:test";
import { glideDurationMs } from "./glide.ts";

describe("glideDurationMs", () => {
  test("stretches the glide 1.15x past the gap so the motion is still running when the next sample lands", () => {
    expect(glideDurationMs(1000, false)).toBe(1150);
    expect(glideDurationMs(2000, false)).toBe(2300);
    expect(glideDurationMs(5000, false)).toBe(5750);
  });

  test("floors a fast gap at 300 ms: a burst must still animate, not flicker", () => {
    expect(glideDurationMs(300, false)).toBe(345);
    expect(glideDurationMs(260, false)).toBe(300);
    expect(glideDurationMs(100, false)).toBe(300);
  });

  test("zero, negative and non-finite gaps take the floor rather than a 0 ms snap", () => {
    for (const gap of [0, -5, -10_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(glideDurationMs(gap, false)).toBe(300);
    }
  });

  test("still motion is 0 for every gap: the value still updates, it just steps", () => {
    for (const gap of [0, -5, 100, 250, 1000, 5000, Number.NaN]) {
      expect(glideDurationMs(gap, true)).toBe(0);
    }
  });

  test("is monotonic above the floor, so a slower feed never glides faster", () => {
    let previous = 0;

    for (const gap of [250, 500, 1000, 2500, 5000]) {
      const duration = glideDurationMs(gap, false);

      expect(duration).toBeGreaterThanOrEqual(previous);
      previous = duration;
    }
  });
});
