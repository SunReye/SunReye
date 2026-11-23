import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { spring } from "@sunreye/builder/animate.ts";

// `spring` on a hand-driven frame clock, so no real frame decides the outcome.
describe("on a frame clock", () => {
  let frames: FrameRequestCallback[] = [];
  let now = 0;

  beforeEach(() => {
    frames = [];
    now = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
