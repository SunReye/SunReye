/**
 * The motion tier's decisions.
 *
 * What these pin down is a policy that is invisible until it misfires: a
 * downgrade the viewer did not ask for is as much a bug as the stutter it was
 * meant to remove. So the boundaries here are the ones that decide a wall
 * tablet's picture — who outranks whom, what counts as a slow frame, and what
 * a hidden tab is NOT allowed to look like.
 */

import { describe, expect, test } from "bun:test";
import {
  clampStrain,
  FrameStrain,
  GAP_CEILING_MS,
  JANK_FRAME_MS,
  MAX_STRAIN,
  parseStrain,
  resolveTier,
  STRAIN_RATIO,
  STRAIN_WINDOW,
} from "./tier";

describe("resolveTier", () => {
  test("the OS's reduced-motion request outranks every setting, including an explicit full", () => {
    // The setting is a performance preference; the OS flag is an accessibility
    // instruction. Someone who told the system to stop animating has not asked
    // this page for an exception.
    for (const setting of ["auto", "full", "lite", "still"] as const) {
      expect(resolveTier(setting, true, 0)).toBe("still");
    }
  });

  test("an explicit setting is rendered as picked, whatever the device manages", () => {
    // A viewer who chose `full` on a slow tablet gets `full` — the measurement
    // only ever drives `auto`.
    expect(resolveTier("full", false, MAX_STRAIN)).toBe("full");
    expect(resolveTier("lite", false, 0)).toBe("lite");
    expect(resolveTier("still", false, 0)).toBe("still");
  });

  test("auto steps down one tier per strike", () => {
    expect(resolveTier("auto", false, 0)).toBe("full");
    expect(resolveTier("auto", false, 1)).toBe("lite");
    expect(resolveTier("auto", false, 2)).toBe("still");
  });

  test("auto cannot fall past the bottom tier, whatever the count says", () => {
    for (const strain of [3, 99, Number.POSITIVE_INFINITY]) {
      expect(resolveTier("auto", false, strain)).toBe("still");
    }
  });

  test("a negative or unreadable strain count is no strain, not a crash", () => {
    for (const strain of [-1, -1000, Number.NaN]) {
      expect(resolveTier("auto", false, strain)).toBe("full");
    }
  });
});

describe("parseStrain", () => {
  test("reads back what the shell wrote", () => {
    expect(parseStrain("0")).toBe(0);
    expect(parseStrain("1")).toBe(1);
    expect(parseStrain("2")).toBe(2);
  });

  test("an absent, empty or corrupt entry starts the device optimistic", () => {
    // Never the other way round: a junk entry that pinned a healthy machine at
    // the bottom tier would be unfixable without clearing storage, while a
    // wrongly optimistic one re-earns its downgrade in one window of frames.
    for (const raw of [null, undefined, "", "   ", "lots", "{}", "NaN"]) {
      expect(parseStrain(raw)).toBe(0);
    }
  });

  test("an out-of-range or fractional entry is clamped rather than trusted", () => {
    expect(parseStrain("9")).toBe(MAX_STRAIN);
    expect(parseStrain("-3")).toBe(0);
    expect(parseStrain("1.9")).toBe(1);
  });
});

describe("clampStrain", () => {
  test("holds the count inside the tier ladder", () => {
    expect(clampStrain(-1)).toBe(0);
    expect(clampStrain(0)).toBe(0);
    expect(clampStrain(2)).toBe(2);
    expect(clampStrain(5)).toBe(MAX_STRAIN);
    expect(clampStrain(Number.NaN)).toBe(0);
  });
});

/**
 * Feed `gaps` frame INTERVALS of `gapMs`; answer how many windows strained.
 *
 * The priming sample is not one of them: a gap needs two timestamps, so a run
 * of n intervals costs n+1 callbacks. Counting the prime would make every
 * window here one frame short of closing.
 */
function feed(strain: FrameStrain, gaps: number, gapMs: number, from = 1000): number {
  let verdicts = 0;
  let t = from;
  strain.sample(t);
  for (let i = 0; i < gaps; i++) {
    t += gapMs;
    if (strain.sample(t)) verdicts += 1;
  }
  return verdicts;
}

describe("FrameStrain", () => {
  test("a device holding 60 Hz never strains", () => {
    expect(feed(new FrameStrain(), STRAIN_WINDOW * 4, 16)).toBe(0);
  });

  test("a device dropping every frame strains once per closed window", () => {
    // Once per window, not once per frame: a caller counts strikes, and a
    // verdict that kept firing while the device recovered would bottom out the
    // tier on a single bad second.
    expect(feed(new FrameStrain(), STRAIN_WINDOW * 3, JANK_FRAME_MS + 8)).toBe(3);
  });

  test("the first frame alone is no evidence — a gap needs two timestamps", () => {
    const strain = new FrameStrain();
    expect(strain.sample(1000)).toBe(false);
  });

  test("a hidden tab, a sleeping device or a paused debugger is not jank", () => {
    // This is the one that matters on a kiosk: waking the screen produces a
    // single enormous gap, and counting it would downgrade the wall display
    // every morning.
    const strain = new FrameStrain();
    expect(feed(strain, STRAIN_WINDOW, GAP_CEILING_MS + 1)).toBe(0);
    // …and the long gaps did not fill the window either, so healthy frames
    // after it still take a full window to be judged. (`from` is after the
    // sleep: the loop resumes forward in time, as a real one does.)
    expect(feed(strain, STRAIN_WINDOW - 1, 16, 500_000)).toBe(0);
  });

  test("jank just under the ratio is tolerated; just over it is not", () => {
    const janky = Math.ceil(STRAIN_WINDOW * STRAIN_RATIO);
    const mixed = (jankCount: number): boolean => {
      const strain = new FrameStrain();
      let t = 1000;
      let verdict = false;
      strain.sample(t);
      for (let i = 0; i < STRAIN_WINDOW; i++) {
        t += i < jankCount ? JANK_FRAME_MS + 4 : 16;
        if (strain.sample(t)) verdict = true;
      }
      return verdict;
    };
    expect(mixed(janky)).toBe(true);
    expect(mixed(janky - 1)).toBe(false);
  });

  test("a frame exactly at the jank threshold counts as janky", () => {
    // The threshold is "two 60 Hz frames or worse", so the boundary is inside
    // the bad set — a page pinned at exactly 31.25 fps is not healthy.
    const strain = new FrameStrain();
    expect(feed(strain, STRAIN_WINDOW, JANK_FRAME_MS)).toBe(1);
  });

  test("a frame one millisecond under the threshold does not", () => {
    expect(feed(new FrameStrain(), STRAIN_WINDOW * 2, JANK_FRAME_MS - 1)).toBe(0);
  });

  test("counts the windows it has closed, so a caller can stop watching", () => {
    // The watch is not free: a pending `requestAnimationFrame` makes the
    // browser produce frames it would otherwise skip, so a loop that never
    // ended would hold a quiet kiosk at 60 Hz for the sake of measuring it.
    // The caller stops after a few windows, and needs to know when one closed.
    const strain = new FrameStrain();
    expect(strain.windows).toBe(0);
    feed(strain, STRAIN_WINDOW, 16);
    expect(strain.windows).toBe(1);
    feed(strain, STRAIN_WINDOW * 2, 16, 500_000);
    expect(strain.windows).toBe(3);
  });

  test("a window counts whether it strained or not", () => {
    // Both outcomes end a window: a caller that only counted the bad ones would
    // watch a healthy device forever.
    const strain = new FrameStrain();
    expect(feed(strain, STRAIN_WINDOW, JANK_FRAME_MS + 8)).toBe(1);
    expect(strain.windows).toBe(1);
  });

  test("an incomplete window is not counted", () => {
    const strain = new FrameStrain();
    feed(strain, STRAIN_WINDOW - 1, 16);
    expect(strain.windows).toBe(0);
  });

  test("backwards, zero and non-finite timestamps are ignored rather than counted", () => {
    // `performance.now()` is monotonic, but the loop is also fed after a
    // restore, and a zero gap (two callbacks in one frame) is not a fast frame.
    const strain = new FrameStrain();
    strain.sample(1000);
    for (const ts of [900, 1000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(strain.sample(ts)).toBe(false);
    }
    // None of those advanced the window: a full window of jank is still needed.
    expect(feed(strain, STRAIN_WINDOW - 1, JANK_FRAME_MS + 4, 10_000)).toBe(0);
    expect(feed(strain, 1, JANK_FRAME_MS + 4, 100_000)).toBe(1);
  });
});
