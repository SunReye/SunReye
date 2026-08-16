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
  BEAD_COUNT,
  beadBegin,
  beadShape,
  crossingSeconds,
  decayCeiling,
  moverKeyPoints,
  nodeGlow,
  parseCeiling,
  pulseShare,
  railPulse,
  throughputWatts,
  type Ceiling,
} from "./flow-pulse";

const HOUR_MS = 60 * 60 * 1000;

describe("the constants of the motion", () => {
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

describe("railPulse", () => {
  test("the same fraction of its own plant is the same picture at any scale", () => {
    // Why the feature exists. A 5 kW rail on a 5.5 kW plant and a 500 W rail on
    // a 550 W plant carry identical charges — speed, size and bloom.
    expect(railPulse(5000, 5500)).toEqual(railPulse(500, 550));
    expect(railPulse(500, 5500)).toEqual(railPulse(50, 550));
  });

  test("a 300 W night against a 9 kW day drifts; a 6 kW noon snaps across", () => {
    // The flaw that killed max-of-current normalisation: without a remembered
    // plant peak this rail would be the busiest one on screen and fly at full
    // speed, so midnight and noon looked identical.
    const night = railPulse(300, 9000);
    const noon = railPulse(6000, 9000);
    expect(night.dur).toBeGreaterThan(noon.dur); // longer on the wire = slower
    expect(night.scale).toBeLessThan(noon.scale);
    expect(night.glow).toBeLessThan(noon.glow);
  });

  test("the busiest rail is a fraction of the plant, not pinned at full", () => {
    // The ceiling tracks the INBOUND sum, so PV sharing the spine with a
    // discharging battery reads as most of the plant rather than all of it.
    const segments = [
      { flow: "in", value: 5000 },
      { flow: "in", value: 1000 },
      { flow: "out", value: 3000 },
      { flow: "out", value: 3000 },
    ] as const;
    const ceiling = decayCeiling(
      { watts: CEILING_FLOOR_W, at: 0 },
      1000,
      throughputWatts(segments),
    );
    expect(ceiling.watts).toBe(6000);
    expect(railPulse(5000, ceiling.watts).share).toBeLessThan(1);
    expect(railPulse(5000, ceiling.watts).share).toBeGreaterThan(0.5);
  });

  test("the plant's only inbound rail is the plant, and reads full", () => {
    // The boundary of the rule above, worth stating: with PV alone on the
    // inbound side it IS the throughput. In practice the remembered peak is
    // older and larger than this instant, so this is the moment of a new
    // record rather than the steady state.
    const solo = [{ flow: "in", value: 5000 }] as const;
    expect(railPulse(5000, throughputWatts(solo)).share).toBe(1);
  });

  test("a 1 Hz wobble produces a byte-identical pulse — nothing is written", () => {
    // The one that matters most now that speed carries the reading: an
    // unchanged `dur` means the running animation is never touched, so the
    // charge cannot be remapped to a new position mid-flight.
    expect(railPulse(1000, 9000)).toEqual(railPulse(1004, 9000));
    expect(railPulse(1000, 9000)).toEqual(railPulse(996, 9000));
  });

  test("carries magnitude, not sign — direction is colour and travel", () => {
    expect(railPulse(-3000, 9000)).toEqual(railPulse(3000, 9000));
  });

  test("speed climbs with power, monotonically, and never inverts", () => {
    // One charge per rail means the speed IS the reading. A non-monotone map
    // would have some busier rail crawling, which reads as a fault.
    let previous = Number.POSITIVE_INFINITY;
    for (let w = 0; w <= 9000; w += 50) {
      const { dur } = railPulse(w, 9000);
      expect(dur).toBeLessThanOrEqual(previous);
      previous = dur;
    }
    expect(railPulse(9000, 9000).dur).toBeLessThan(railPulse(0, 9000).dur);
  });

  test("survives every boundary reading without a NaN reaching a style", () => {
    // A NaN in `width` or `glow` reaches `stroke-width`/`stroke-opacity` and the
    // rail disappears — a silent blank cable on a wall panel nobody is watching.
    const readings = [undefined, 0, -0, -250, 1e9, Number.NaN, Number.POSITIVE_INFINITY];
    const ceilings = [0, -1, 9000, Number.NaN, Number.POSITIVE_INFINITY];
    for (const w of readings)
      for (const c of ceilings) {
        const pulse = railPulse(w, c);
        for (const value of [
          pulse.share,
          pulse.dur,
          pulse.scale,
          pulse.blur,
          pulse.glow,
          pulse.width,
        ]) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
        expect(pulse.share).toBeLessThanOrEqual(1);
        // A zero or negative duration is an animation that never advances —
        // a charge frozen on the wire, which reads as a dead rail.
        expect(pulse.dur).toBeGreaterThan(0);
        expect(pulse.scale).toBeGreaterThan(0);
        expect(pulse.width).toBeGreaterThan(0);
      }
  });
});

describe("crossingSeconds", () => {
  test("is quantized, so a wobbling reading never touches the running animation", () => {
    // THE guard of the one-charge design. Speed is a timing property: changing
    // a running animation's duration remaps its elapsed time and the charge
    // teleports. Coarse steps confine that to samples where the power really
    // moved, instead of every second.
    // A neighbouring share lands on the same step and emits the same number,
    // so the attribute is not rewritten and the animation is not restarted.
    expect(crossingSeconds(0.5)).toBe(crossingSeconds(0.52));
    // Every value the map can produce is on the quarter-second grid.
    for (let share = 0; share <= 1.0001; share += 0.01) {
      expect(Math.round(crossingSeconds(share) * 100) % 25).toBe(0);
    }
    // …and the grid is coarse enough that the whole range is a handful of
    // distinct durations, not a continuum.
    const distinct = new Set(Array.from({ length: 101 }, (_, i) => crossingSeconds(i / 100)));
    expect(distinct.size).toBeLessThanOrEqual(15);
    expect(distinct.size).toBeGreaterThan(1);
  });

  test("more power is less time on the wire", () => {
    expect(crossingSeconds(1)).toBeLessThan(crossingSeconds(0));
    expect(crossingSeconds(0.5)).toBeLessThan(crossingSeconds(0.1));
  });

  test("clamps outside 0..1 rather than producing a zero or negative duration", () => {
    // A duration of 0 is an animation that never advances; a negative one is
    // undefined. Either way the rail freezes and looks broken, not idle.
    for (const share of [-5, 0, 1, 12, Number.NaN, Number.POSITIVE_INFINITY]) {
      const dur = crossingSeconds(share);
      expect(dur).toBeGreaterThan(0);
      expect(dur).toBeLessThanOrEqual(crossingSeconds(0));
    }
  });
});

describe("moverKeyPoints", () => {
  test("an inbound charge runs the cable toward the hub and an outbound one away", () => {
    // `power-graph.ts` puts the hub last in every segment's `pts`, so the
    // authored direction IS node → hub. Reversing the key points rather than
    // the path string is what lets both directions share one <mpath> — the
    // rail's own cable — so a resize moves the charge with the wire.
    expect(moverKeyPoints("in")).toBe("0;1");
    expect(moverKeyPoints("out")).toBe("1;0");
  });
});

describe("the bead chain", () => {
  test("bends with the rail because every bead is separately on the path", () => {
    // The reason a charge is a chain and not a sprite. A sprite can only be
    // placed and rotated, so on a Bézier it cuts the corner; each bead riding
    // the cable at its own lag follows the curve exactly. Structurally: every
    // bead has a distinct lag, or they would stack into one point.
    const lags = Array.from({ length: BEAD_COUNT }, (_, k) => beadBegin(k, 2));
    expect(new Set(lags).size).toBe(BEAD_COUNT);
  });

  test("the head leads and each bead behind it lags further", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let k = 0; k < BEAD_COUNT; k++) {
      const lead = Math.abs(Number(/-([\d.]+)s/.exec(beadBegin(k, 2))![1]));
      expect(lead).toBeLessThan(previous);
      previous = lead;
    }
    // The last bead is the tail: it rides the path with no lead at all.
    expect(beadBegin(BEAD_COUNT - 1, 2)).toBe("-0s");
  });

  test("the comet keeps its length at every speed", () => {
    // A lag fixed in seconds would smear the comet across half the rail as soon
    // as the power dropped and the crossing slowed down. Scaled by the crossing
    // time, the chain occupies the same FRACTION of the wire at any speed.
    const at = (dur: number): number =>
      Math.abs(Number(/-([\d.]+)s/.exec(beadBegin(0, dur))![1])) / dur;
    expect(at(1)).toBeCloseTo(at(4.5), 6);
  });

  test("tapers to a point: the head is fattest and brightest, the tail neither", () => {
    let r = Number.POSITIVE_INFINITY;
    let o = Number.POSITIVE_INFINITY;
    for (let k = 0; k < BEAD_COUNT; k++) {
      const bead = beadShape(k);
      expect(bead.radius).toBeLessThanOrEqual(r);
      expect(bead.opacity).toBeLessThanOrEqual(o);
      expect(bead.radius).toBeGreaterThanOrEqual(0);
      expect(bead.opacity).toBeGreaterThanOrEqual(0);
      r = bead.radius;
      o = bead.opacity;
    }
    expect(beadShape(0)).toEqual({ radius: 1, opacity: 1 });
    expect(beadShape(BEAD_COUNT - 1).radius).toBe(0);
  });

  test("radius outlives opacity, so the comet has a body before it ends", () => {
    // Falling off together gives a stub that vanishes; a slower radius falloff
    // is what makes the tail read as tapering rather than being cut short.
    const mid = beadShape(Math.floor(BEAD_COUNT / 2));
    expect(mid.radius).toBeGreaterThan(mid.opacity);
  });

  test("a nonsense duration cannot produce a nonsense lag", () => {
    for (const dur of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (let k = 0; k < BEAD_COUNT; k++) expect(beadBegin(k, dur)).not.toContain("NaN");
    }
  });

  test("asking outside the chain clamps rather than inverting the taper", () => {
    expect(beadShape(-4)).toEqual(beadShape(0));
    expect(beadShape(999)).toEqual(beadShape(BEAD_COUNT - 1));
  });
});

describe("nodeGlow", () => {
  test("mixes the node's accent token rather than baking a colour", () => {
    // A hex here is a colour the palette cannot reach — the whole reason the
    // direction and judgement colours became tokens.
    const glow = nodeGlow("var(--energy-solar)", 0.85);
    expect(glow).toStartWith("color-mix(in oklab,");
    expect(glow).toContain("var(--energy-solar)");
    expect(glow).not.toMatch(/#[0-9a-f]{3}/i);
    expect(glow).not.toMatch(/rgb|emerald|amber/i);
  });

  test("brightens with the plant's share and stays inside the mix range", () => {
    const percent = (share: number) => Number(/ (\d+)%/.exec(nodeGlow("var(--x)", share))?.[1]);
    expect(percent(1)).toBeGreaterThan(percent(0.5));
    expect(percent(0.5)).toBeGreaterThan(percent(0));
    expect(percent(0)).toBeGreaterThan(0);
    expect(percent(1)).toBeLessThanOrEqual(100);
  });

  test("an out-of-range or unreadable share cannot emit an invalid percentage", () => {
    // The share arrives from a reading; a NaN percentage silently voids the
    // whole box-shadow declaration and the node loses its glow entirely.
    for (const share of [-1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const glow = nodeGlow("var(--x)", share);
      const percent = Number(/ (\d+)%/.exec(glow)?.[1]);
      expect(Number.isFinite(percent)).toBe(true);
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
    }
  });
});
