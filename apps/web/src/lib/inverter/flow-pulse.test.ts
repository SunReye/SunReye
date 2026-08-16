/**
 * The signal behind the power-flow diagram's comet streams.
 *
 * The reference a rail is measured against is the whole point of this module.
 * Normalising against "the biggest rail right now" pins the busiest cable at
 * exactly 1.0 forever, so a 300 W import at midnight paints the same picture as
 * 9 kW at noon — the plant looks equally busy whatever it is doing, which is the
 * opposite of a status display. The reference here is a *remembered plant peak*
 * over inbound throughput, decayed by wall-clock time.
 */

import { describe, expect, test } from "bun:test";
import {
  CEILING_FLOOR_W,
  decayCeiling,
  parseCeiling,
  PULSE_PERIOD_S,
  PULSE_SPAN,
  PULSE_SPEED,
  pulseShare,
  throughputWatts,
  type Ceiling,
} from "./flow-pulse";

const HOUR_MS = 60 * 60 * 1000;

describe("the constants of the motion", () => {
  test("one keyframe cycle is the span divided by the speed", () => {
    // Every rail moves at PULSE_SPEED. Rate is carried by density, never by
    // speed, so this is the single duration the whole diagram animates on.
    expect(PULSE_PERIOD_S).toBe(PULSE_SPAN / PULSE_SPEED);
    expect(PULSE_PERIOD_S).toBe(2.5);
  });

  test("the smallest plant a rail is measured against is a kilowatt", () => {
    // Without a floor, a plant idling at 40 W would measure a 40 W rail as full
    // throttle and blaze at midnight.
    expect(CEILING_FLOOR_W).toBe(1000);
  });
});

describe("throughputWatts", () => {
  test("sums what is arriving, not what is leaving", () => {
    // The ceiling has to track ONE side of the balance, or every plant reads
    // double and a rail's share halves for no physical reason.
    expect(
      throughputWatts([
        { flow: "in", value: 5000 },
        { flow: "in", value: 1000 },
        { flow: "out", value: 3000 },
        { flow: "idle", value: 0 },
      ]),
    ).toBe(6000);
  });

  test("takes the magnitude — an inbound rail reported negative still arrived", () => {
    expect(throughputWatts([{ flow: "in", value: -2500 }])).toBe(2500);
  });

  test("a segment with no reading contributes nothing rather than NaN", () => {
    // `value` is undefined before the first frame and whenever the register is
    // absent. One of those must not blank the whole plant's reference.
    expect(
      throughputWatts([
        { flow: "in", value: undefined },
        { flow: "in", value: 800 },
      ]),
    ).toBe(800);
  });

  test("no segments is zero, not NaN", () => {
    expect(throughputWatts([])).toBe(0);
  });
});

describe("decayCeiling", () => {
  test("rises to a spike within the same call", () => {
    // Noon must be visible the instant it arrives; only forgetting is slow.
    expect(decayCeiling({ watts: CEILING_FLOOR_W, at: 0 }, 1000, 9000).watts).toBe(9000);
  });

  test("is idempotent — folding it twice at the same instant changes nothing", () => {
    // THE structural reason decay is wall-clock rather than per-sample: an
    // extra invocation (EVCC's own cadence, a resize storm, a $derived
    // recompute) must not be able to age the plant's memory.
    const start: Ceiling = { watts: 8000, at: 0 };
    const once = decayCeiling(start, HOUR_MS, 0);
    const twice = decayCeiling(once, HOUR_MS, 0);
    expect(twice).toEqual(once);
  });

  test("halves over six hours of elapsed time", () => {
    const after = decayCeiling({ watts: 8000, at: 0 }, 6 * HOUR_MS, 0);
    expect(after.watts).toBeCloseTo(4000, 6);
    expect(after.at).toBe(6 * HOUR_MS);
  });

  test("forgetting depends on elapsed time, not on how often it was called", () => {
    // The same six hours, sampled once vs sampled hourly, must land in the same
    // place — otherwise the picture depends on render invalidation.
    const start: Ceiling = { watts: 8000, at: 0 };
    let stepped = start;
    for (let h = 1; h <= 6; h++) stepped = decayCeiling(stepped, h * HOUR_MS, 0);
    const once = decayCeiling(start, 6 * HOUR_MS, 0);
    expect(stepped.watts).toBeCloseTo(once.watts, 6);
  });

  test("never falls below the floor however long the plant sleeps", () => {
    expect(decayCeiling({ watts: 1e9, at: 0 }, 1000 * HOUR_MS, 0).watts).toBe(CEILING_FLOOR_W);
  });

  test("a clock that jumps backwards does not inflate the ceiling", () => {
    // Host clock corrections and DST are real; a negative elapsed would
    // multiply the memory instead of decaying it.
    const back = decayCeiling({ watts: 4000, at: 10 * HOUR_MS }, 2 * HOUR_MS, 0);
    expect(back.watts).toBe(4000);
  });

  test("a corrupt remembered peak degrades to the floor rather than to NaN", () => {
    expect(decayCeiling({ watts: Number.NaN, at: 0 }, HOUR_MS, 0).watts).toBe(CEILING_FLOOR_W);
  });

  test("a corrupt timestamp degrades to the floor and recovers its clock", () => {
    // A NaN `at` used to poison every later fold through `now - NaN`, painting
    // every rail from a NaN ceiling forever.
    const fixed = decayCeiling({ watts: 8000, at: Number.NaN }, HOUR_MS, 0);
    expect(fixed.watts).toBe(CEILING_FLOOR_W);
    expect(fixed.at).toBe(HOUR_MS);
  });

  test("an unreadable current sample leaves the memory intact", () => {
    const held = decayCeiling({ watts: 8000, at: 0 }, 0, Number.NaN);
    expect(held.watts).toBe(8000);
  });

  test("takes the magnitude of the current sample", () => {
    expect(decayCeiling({ watts: CEILING_FLOOR_W, at: 0 }, 0, -7000).watts).toBe(7000);
  });
});

describe("pulseShare", () => {
  test("the same rail against its own plant reads the same at any scale", () => {
    // Why the feature exists: a 5 kW rail on a 5.5 kW plant and a 500 W rail on
    // a 550 W plant are the same picture, because both are the same fraction of
    // what their plant is moving.
    expect(pulseShare(5000, 5500)).toBe(pulseShare(500, 550));
    expect(pulseShare(500, 5500)).toBe(pulseShare(50, 550));
    expect(pulseShare(5000, 5500)).toBeGreaterThan(pulseShare(500, 5500));
  });

  test("night is quiet against a remembered day", () => {
    // 300 W at 22:00 measured against the 9 kW the plant made at noon.
    expect(pulseShare(300, 9000)).toBeLessThan(0.1);
    expect(pulseShare(6000, 9000)).toBeGreaterThan(0.5);
  });

  test("a 1 Hz wobble produces a byte-identical share", () => {
    // Quantized to 1/20 so most samples write no styles at all. Un-quantize it
    // and every second repaints four dash patterns and three custom properties.
    expect(pulseShare(1000, 9000)).toBe(pulseShare(1004, 9000));
    expect(pulseShare(1000, 9000)).toBe(pulseShare(996, 9000));
  });

  test("carries magnitude, not sign — direction is colour and travel", () => {
    expect(pulseShare(-3000, 9000)).toBe(pulseShare(3000, 9000));
  });

  test("never exceeds full, even above the remembered peak", () => {
    expect(pulseShare(20000, 9000)).toBe(1);
  });

  test("no reading is no flow", () => {
    expect(pulseShare(undefined, 9000)).toBe(0);
    expect(pulseShare(0, 9000)).toBe(0);
    expect(pulseShare(-0, 9000)).toBe(0);
  });

  test("an over-range reading reads full; an unreadable one reads idle", () => {
    // Infinity is a magnitude past the top of the scale, so it pins at full.
    // NaN is the absence of a measurement — painting a rail at full throttle
    // for it would announce power nobody measured.
    expect(pulseShare(Number.POSITIVE_INFINITY, 9000)).toBe(1);
    expect(pulseShare(Number.NEGATIVE_INFINITY, 9000)).toBe(1);
    expect(pulseShare(Number.NaN, 9000)).toBe(0);
  });

  test("an unusable ceiling falls back to the floor instead of dividing by it", () => {
    expect(pulseShare(1000, 0)).toBe(pulseShare(1000, CEILING_FLOOR_W));
    expect(pulseShare(1000, -5)).toBe(pulseShare(1000, CEILING_FLOOR_W));
    expect(pulseShare(1000, Number.NaN)).toBe(pulseShare(1000, CEILING_FLOOR_W));
    expect(pulseShare(500, Number.POSITIVE_INFINITY)).toBe(pulseShare(500, CEILING_FLOOR_W));
  });

  test("stays inside [0,1] across every boundary reading", () => {
    const readings = [undefined, 0, -0, -1, 1, 1e9, Number.NaN, Number.POSITIVE_INFINITY];
    const ceilings = [0, -1, 1, 9000, Number.NaN, Number.POSITIVE_INFINITY];
    for (const w of readings)
      for (const c of ceilings) {
        const share = pulseShare(w, c);
        expect(Number.isFinite(share)).toBe(true);
        expect(share).toBeGreaterThanOrEqual(0);
        expect(share).toBeLessThanOrEqual(1);
      }
  });

  test("rises monotonically with power", () => {
    let previous = -1;
    for (let w = 0; w <= 9000; w += 100) {
      const share = pulseShare(w, 9000);
      expect(share).toBeGreaterThanOrEqual(previous);
      previous = share;
    }
  });
});

describe("parseCeiling", () => {
  test("a stored peak survives a remount", () => {
    // The whole reason it is persisted: an orientation flip or a kiosk reload
    // must not restart the ramp from the floor and blaze for six hours.
    expect(parseCeiling('{"watts":7200,"at":1699999999999}')).toEqual({
      watts: 7200,
      at: 1699999999999,
    });
  });

  test("a first visit starts at the floor", () => {
    expect(parseCeiling(null)).toEqual({ watts: CEILING_FLOOR_W, at: 0 });
    expect(parseCeiling(undefined)).toEqual({ watts: CEILING_FLOOR_W, at: 0 });
  });

  test("junk in storage starts at the floor rather than throwing on the way up", () => {
    // This is read before the first paint. A corrupt entry — another app's key,
    // a half-written value — must not take the diagram down with it.
    for (const raw of ["", "not json", "null", "[]", "42", '{"watts":"7200","at":0}', "{}"])
      expect(parseCeiling(raw)).toEqual({ watts: CEILING_FLOOR_W, at: 0 });
  });

  test("a stored value below the floor is raised to it", () => {
    expect(parseCeiling('{"watts":40,"at":123}')).toEqual({ watts: CEILING_FLOOR_W, at: 123 });
  });

  test("a stored non-finite peak degrades to the floor", () => {
    // JSON has no Infinity, so it round-trips as null — but a hand-edited or
    // foreign entry can still carry one.
    expect(parseCeiling('{"watts":null,"at":null}')).toEqual({ watts: CEILING_FLOOR_W, at: 0 });
  });
});
