/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { spring } from "../../animate.ts";
import { settle, slideMs } from "./drill.ts";

test("a full slide takes ADR 21's 280–350 ms", () => {
  expect(slideMs(0, 1)).toBeGreaterThanOrEqual(280);
  expect(slideMs(1, 0)).toBeLessThanOrEqual(350);
});

test("a reversed slide takes only the time for the way left", () => {
  expect(slideMs(0.3, 0)).toBeLessThan(slideMs(1, 0));
});

test("a release settles where the finger was heading", () => {
  // Flicked back fast from nearly open.
  expect(settle(0.9, -2)).toBe(0);
  // Let go past halfway without a push.
  expect(settle(0.4, 0)).toBe(0);
  // Let go before halfway.
  expect(settle(0.7, 0)).toBe(1);
  // Past halfway, but pushed open again.
  expect(settle(0.4, 1)).toBe(1);
});

// `spring` on a hand-driven frame clock; Bun has no frames of its own.
describe("on a frame clock", () => {
  let frames: FrameRequestCallback[] = [];
  let now = 0;

  beforeEach(() => {
    frames = [];
    now = 0;
    globalThis.requestAnimationFrame = (callback) => frames.push(callback);
    spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    mock.restore();
  });

  function frame(): void {
    now += 16;

    const due = frames;

    frames = [];

    for (const callback of due) callback(now);
  }

  test("a spring starts at the release velocity", () => {
    let still = 1;
    let flung = 1;

    spring(1, 0, (value) => {
      still = value;
    });
    spring(
      1,
      0,
      (value) => {
        flung = value;
      },
      { velocity: -8 },
    );
    frame();

    // At rest, the first frame barely moves; flung at 8 widths/s it covers about 16 ms of that.
    expect(1 - still).toBeLessThan(0.05);
    expect(1 - flung).toBeGreaterThan(0.1);
  });
});
