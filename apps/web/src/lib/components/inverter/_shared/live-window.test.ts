/**
 * The geometry behind the two gliding live charts.
 *
 * The module shipped untested. It is now also the home of the sub-pixel
 * quantisation that stops the glide writing a fresh transform 60x/second per
 * chart: the window is ~2 minutes across ~250-500 CSS px, i.e. ~0.05 px per
 * frame, so most frames move a fraction of a pixel and pay a full layout +
 * paint + raster for it. Snapping the offset onto a quarter-CSS-pixel grid makes
 * four frames in five produce an IDENTICAL transform string, which Svelte's
 * `!==` derived equality then drops before it reaches the DOM.
 *
 * The trade is explicit: a sub-perceptual amount of positional precision (at
 * most an eighth of a CSS pixel of error) for a large reduction in paint work.
 * It is NOT true that a sub-pixel move rasterises to the pixels already on
 * screen — antialiased vector edges change coverage continuously — which is why
 * the quantum has to stay well under a whole pixel. A whole-pixel quantum was
 * measured in the browser as a visible 1px stutter roughly every 450ms.
 *
 * The frame-skip case below is the one that makes a revert loud.
 */

import { describe, expect, test } from "bun:test";
import { bufferStart, glideTransform, pixelQuantum, sampleInterval } from "./live-window";

/**
 * The snapped offset the module would write, read back out of the only thing it
 * exposes.
 *
 * The offset and the snap are deliberately module-private — an unsnapped float
 * escaping to a component is the regression this module exists to stop — so the
 * cases below drive them through `glideTransform`. With an identity xScale,
 * `cursor` and `interval` both 0, the offset is exactly `newest`:
 * `xScale(newest) - xScale(0 - 0)`.
 */
function snapped(offset: number, quantum: number): number {
  const transform = glideTransform((t) => t, offset, 0, 0, quantum);
  const value = /^translate\((-?[\d.e+-]+),0\)$/.exec(transform)?.[1];
  if (value === undefined) throw new Error(`unparseable transform: ${transform}`);
  return Number(value);
}

describe("pixelQuantum — the smallest offset step worth writing", () => {
  test("is SUB-pixel on a 1x screen — a whole-pixel step is a visible stutter", () => {
    // THE regression this pins. A quantum of one CSS px was measured in a real
    // browser as 241 frames producing 11 distinct positions: the glide jumped a
    // whole pixel every ~450ms instead of scrolling. A device pixel is not a
    // perceptual floor for antialiased vector edges — coverage changes below it.
    expect(pixelQuantum(1)).toBeLessThan(1);
    expect(pixelQuantum(1)).toBe(0.25);
  });

  test("a quarter CSS px on every ordinary display — the step is dpr-independent", () => {
    // The motion is specified in CSS px (~0.05 px per 60Hz frame), so the
    // perceptual floor is too; a denser device grid does not justify a finer
    // step, it just restores the writes this module exists to drop.
    for (const dpr of [1, 1.5, 2, 3, 4]) {
      expect(pixelQuantum(dpr)).toBe(0.25);
    }
  });

  test("a missing or nonsensical devicePixelRatio falls back to the 1x step", () => {
    // A bogus dpr must not silently produce a sub-nanometre quantum, which would
    // restore the 60-writes-per-second behaviour this whole module exists to stop.
    for (const dpr of [undefined, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pixelQuantum(dpr)).toBe(0.25);
    }
  });

  test("never finer than a quarter CSS px, and never coarser than one device pixel", () => {
    for (const dpr of [0.5, 1, 2, 3, 4, 8, 100]) {
      const quantum = pixelQuantum(dpr);
      expect(quantum).toBeLessThanOrEqual(0.25);
      // Below ~0.1 CSS px the frame skip collapses back toward 60 writes/second.
      expect(quantum).toBeGreaterThanOrEqual(0.1);
    }
  });
});

describe("the snap onto the step grid", () => {
  test("rounds onto the grid", () => {
    expect(snapped(0.07, 0.5)).toBe(0);
    expect(snapped(0.26, 0.5)).toBe(0.5);
    expect(snapped(12.4, 1)).toBe(12);
  });

  test("an exact half-quantum rounds up and is stable under a second pass", () => {
    const once = snapped(0.25, 0.5);
    expect(once).toBe(0.5);
    expect(snapped(once, 0.5)).toBe(once);
  });

  test("negatives snap too — a shrunken plot can invert xScale", () => {
    expect(snapped(-0.07, 0.5)).toBeCloseTo(0, 10);
    // -0 must not reach the DOM as the string "-0".
    expect(glideTransform((t) => t, -0.07, 0, 0, 0.5)).toBe("translate(0,0)");
    expect(snapped(-12.6, 1)).toBe(-13);
  });

  test("a degenerate quantum passes the offset through instead of blowing up", () => {
    expect(snapped(3.7, 0)).toBe(3.7);
    expect(snapped(3.7, -1)).toBe(3.7);
  });

  test("a non-finite offset collapses to 0 rather than poisoning the transform", () => {
    // A NaN in the attribute is not an error anywhere: the group silently stops
    // moving, or the whole marks layer disappears.
    expect(snapped(Number.NaN, 1)).toBe(0);
    expect(snapped(Number.POSITIVE_INFINITY, 1)).toBe(0);
    expect(glideTransform((t) => t, Number.NaN, 0, 0, 1)).toBe("translate(0,0)");
  });
});

/** One 10s glide at 60fps: 600 frames creeping 0.056 CSS px each. */
const RAMP = Array.from({ length: 600 }, (_, i) => i * 0.056);

describe("the snap does not drift away from the data", () => {
  test("monotonic, within half a quantum, and the last frame equals a fresh snap of its input", () => {
    const quantum = 0.5;
    const walked = RAMP.map((x) => snapped(x, quantum));

    for (let i = 1; i < walked.length; i++) {
      expect(walked[i]).toBeGreaterThanOrEqual(walked[i - 1]);
    }
    for (const [i, value] of walked.entries()) {
      expect(Math.abs(value - RAMP[i])).toBeLessThanOrEqual(quantum / 2 + 1e-9);
    }
    // The property that matters: error does not ACCUMULATE. A step-accumulating
    // implementation drifts a whole pixel per few hundred frames and the chart
    // slowly detaches from its own data over a long session.
    expect(walked.at(-1)).toBeCloseTo(snapped(RAMP.at(-1) as number, quantum), 10);
  });
});

/** Frames on which the emitted transform string actually changes. */
function changedFrames(offsets: number[], quantum: number): number {
  const scale = (t: number) => t * 0.056;
  let changes = 0;
  let previous = "";
  for (const i of offsets.keys()) {
    // xScale(newest) - xScale(cursor - interval) with newest = 0, interval = 0,
    // cursor = -i resolves to exactly `i * 0.056` px of offset.
    const next = glideTransform(scale, 0, -i, 0, quantum);
    if (next !== previous) changes++;
    previous = next;
  }
  return changes;
}

describe("the frame skip is the win — assert it as a number", () => {
  test("a 600-frame glide emits a new transform on well under a sixth of its frames", () => {
    expect(changedFrames(RAMP, 0.5)).toBeLessThan(RAMP.length * 0.15);
    expect(changedFrames(RAMP, 1)).toBeLessThan(RAMP.length * 0.08);
  });

  test("the SHIPPING quantum still drops three frames in four", () => {
    // The sub-pixel step costs some of the skip back; it must not cost all of it.
    const changed = changedFrames(RAMP, pixelQuantum(1));
    expect(changed).toBeLessThan(RAMP.length * 0.25);
    // …and it must genuinely move: a step so coarse that the glide only advances
    // a handful of times over ten seconds is the 1px stutter we just fixed.
    expect(changed).toBeGreaterThan(RAMP.length * 0.1);
  });

  test("an unquantised glide changes on every single frame — this is the regression", () => {
    // Guards the case where someone "simplifies" the quantum back out: with a
    // degenerate quantum the raw float differs every frame and we are back to 60
    // DOM writes per second per chart.
    expect(changedFrames(RAMP, 0)).toBe(RAMP.length);
  });
});

describe("glideTransform", () => {
  test("no samples yet means no offset — the first paint must not jump", () => {
    expect(glideTransform(() => 0, undefined, 0, 1000, 1)).toBe("translate(0,0)");
  });

  test("a cursor sitting on the newest sample trails by exactly one interval", () => {
    // xScale of t => t / 1000 gives 1px per second; one 1000ms interval is 1px.
    expect(glideTransform((t) => t / 1000, 10_000, 10_000, 1000, 1)).toBe("translate(1,0)");
  });

  test("emits the SVG transform-attribute form: user units, no px suffix", () => {
    // The marks group takes this as its `transform` ATTRIBUTE, which is parsed as
    // SVG user units and rejects a CSS length — a stray `px` would silently kill
    // the glide. It stays a string so Svelte's `!==` still drops unchanged frames.
    expect(glideTransform((t) => t / 100, 10_000, 9_000, 1000, 0.5)).toMatch(
      /^translate\(-?\d+(\.\d+)?,0\)$/,
    );
    expect(glideTransform((t) => t / 100, 10_000, 9_000, 1000, 0.5)).not.toContain("px");
  });

  test("is the snapped offset and nothing else", () => {
    // The offset restated independently of the module: xScale of the newest
    // sample, minus xScale of the cursor trailing one interval behind.
    const scale = (t: number) => t / 37;
    const exact = scale(12_345) - scale(11_111 - 900);
    expect(glideTransform(scale, 12_345, 11_111, 900, 0.5)).toBe(
      `translate(${Math.round(exact / 0.5) * 0.5},0)`,
    );
  });

  test("a frame that snaps to the same step returns an === identical string", () => {
    // The whole mechanism: identical string, `!==` derived does not propagate,
    // no attribute write, no style invalidation, no paint, no raster.
    const scale = (t: number) => t / 1000;
    const a = glideTransform(scale, 10_000, 9_000, 1000, 0.25);
    const b = glideTransform(scale, 10_000, 9_000.05, 1000, 0.25);
    expect(b).toBe(a);
  });

  test('-0 never reaches the attribute as "-0"', () => {
    // offset here is -0.00005 px, which rounds to -0 on the grid.
    expect(glideTransform((t) => t / 1000, 0, 0.05, 0, 0.25)).toBe("translate(0,0)");
  });
});

// The glide DURATION used to live here as well, in a second copy of the floor
// and the overshoot that the readouts also carried. It moved to `glide.ts`, the
// one home both call sites now import; `glide.test.ts` covers it.

// Regression guards for the exports this change did not touch — the module had
// no test file at all until now.
describe("sampleInterval", () => {
  test("falls back to 1s until two samples exist", () => {
    expect(sampleInterval(undefined, undefined)).toBe(1000);
    expect(sampleInterval(1_700_000_000_000, undefined)).toBe(1000);
  });

  test("clamps a burst to 250ms and a stall to 5s", () => {
    expect(sampleInterval(1000, 990)).toBe(250);
    expect(sampleInterval(60_000, 0)).toBe(5000);
  });

  test("a counter restart (newest older than previous) clamps up, never negative", () => {
    expect(sampleInterval(1000, 9000)).toBe(250);
  });
});

describe("bufferStart", () => {
  test("subtracts exactly six intervals past the window's left edge", () => {
    expect(bufferStart(100_000, 120_000, 1000)).toBe(100_000 - 120_000 - 6000);
  });
});
