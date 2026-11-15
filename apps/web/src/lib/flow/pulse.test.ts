// A rail's share of the remembered plant and what its charge looks like at that share. Ported from
// v3 (dev 780b4e2, lib/inverter/flow-pulse.test.ts).
import { expect, test } from "bun:test";
import { CEILING_FLOOR_W, decayCeiling } from "./ceiling.ts";
import { crossingSeconds, pulseShare, railPulse, throughputWatts } from "./flow-pulse.ts";

test("pulseShare: the same rail against its own plant reads the same at any scale", () => {
  // Why the feature exists: a 5 kW rail on a 5.5 kW plant and a 500 W rail on
  // a 550 W plant are the same picture, because both are the same fraction of
  // what their plant is moving.
  expect(pulseShare(5000, 5500)).toBe(pulseShare(500, 550));
  expect(pulseShare(500, 5500)).toBe(pulseShare(50, 550));
  expect(pulseShare(5000, 5500)).toBeGreaterThan(pulseShare(500, 5500));
});

test("pulseShare: night is quiet against a remembered day", () => {
  // 300 W at 22:00 measured against the 9 kW the plant made at noon.
  expect(pulseShare(300, 9000)).toBeLessThan(0.1);
  expect(pulseShare(6000, 9000)).toBeGreaterThan(0.5);
});

test("pulseShare: a 1 Hz wobble produces a byte-identical share", () => {
  // Quantized to 1/20 so most samples write no styles at all. Un-quantize it
  // and every second repaints four dash patterns and three custom properties.
  expect(pulseShare(1000, 9000)).toBe(pulseShare(1004, 9000));
  expect(pulseShare(1000, 9000)).toBe(pulseShare(996, 9000));
});

test("pulseShare: carries magnitude, not sign — direction is colour and travel", () => {
  expect(pulseShare(-3000, 9000)).toBe(pulseShare(3000, 9000));
});

test("pulseShare: never exceeds full, even above the remembered peak", () => {
  expect(pulseShare(20000, 9000)).toBe(1);
});

test("pulseShare: no reading is no flow", () => {
  expect(pulseShare(undefined, 9000)).toBe(0);
  expect(pulseShare(0, 9000)).toBe(0);
  expect(pulseShare(-0, 9000)).toBe(0);
});

test("pulseShare: an over-range reading reads full; an unreadable one reads idle", () => {
  // Infinity is a magnitude past the top of the scale, so it pins at full.
  // NaN is the absence of a measurement — painting a rail at full throttle
  // for it would announce power nobody measured.
  expect(pulseShare(Number.POSITIVE_INFINITY, 9000)).toBe(1);
  expect(pulseShare(Number.NEGATIVE_INFINITY, 9000)).toBe(1);
  expect(pulseShare(Number.NaN, 9000)).toBe(0);
});

test("pulseShare: an unusable ceiling falls back to the floor instead of dividing by it", () => {
  expect(pulseShare(1000, 0)).toBe(pulseShare(1000, CEILING_FLOOR_W));
  expect(pulseShare(1000, -5)).toBe(pulseShare(1000, CEILING_FLOOR_W));
  expect(pulseShare(1000, Number.NaN)).toBe(pulseShare(1000, CEILING_FLOOR_W));
  expect(pulseShare(500, Number.POSITIVE_INFINITY)).toBe(pulseShare(500, CEILING_FLOOR_W));
});

test("pulseShare: stays inside [0,1] across every boundary reading", () => {
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

test("pulseShare: rises monotonically with power", () => {
  let previous = -1;

  for (let w = 0; w <= 9000; w += 100) {
    const share = pulseShare(w, 9000);
    expect(share).toBeGreaterThanOrEqual(previous);
    previous = share;
  }
});

test("railPulse: the same fraction of its own plant is the same picture at any scale", () => {
  // Why the feature exists. A 5 kW rail on a 5.5 kW plant and a 500 W rail on
  // a 550 W plant carry identical charges — speed, size and bloom.
  expect(railPulse(5000, 5500)).toEqual(railPulse(500, 550));
  expect(railPulse(500, 5500)).toEqual(railPulse(50, 550));
});

test("railPulse: a 300 W night against a 9 kW day drifts; a 6 kW noon snaps across", () => {
  // The flaw that killed max-of-current normalisation: without a remembered
  // plant peak this rail would be the busiest one on screen and fly at full
  // speed, so midnight and noon looked identical.
  const night = railPulse(300, 9000);
  const noon = railPulse(6000, 9000);
  // Longer on the wire = slower.
  expect(night.dur).toBeGreaterThan(noon.dur);
  expect(night.scale).toBeLessThan(noon.scale);
  expect(night.glow).toBeLessThan(noon.glow);
});

test("railPulse: the busiest rail is a fraction of the plant, not pinned at full", () => {
  // The ceiling tracks the INBOUND sum, so PV sharing the spine with a
  // discharging battery reads as most of the plant rather than all of it.
  const segments = [
    { flow: "in", value: 5000 },
    { flow: "in", value: 1000 },
    { flow: "out", value: 3000 },
    { flow: "out", value: 3000 },
  ] as const;

  const ceiling = decayCeiling({ watts: CEILING_FLOOR_W, at: 0 }, 1000, throughputWatts(segments));

  expect(ceiling.watts).toBe(6000);
  expect(railPulse(5000, ceiling.watts).share).toBeLessThan(1);
  expect(railPulse(5000, ceiling.watts).share).toBeGreaterThan(0.5);
});

test("railPulse: the plant's only inbound rail is the plant, and reads full", () => {
  // The boundary of the rule above, worth stating: with PV alone on the
  // inbound side it IS the throughput. In practice the remembered peak is
  // older and larger than this instant, so this is the moment of a new
  // record rather than the steady state.
  const solo = [{ flow: "in", value: 5000 }] as const;
  expect(railPulse(5000, throughputWatts(solo)).share).toBe(1);
});

test("railPulse: a 1 Hz wobble produces a byte-identical pulse — nothing is written", () => {
  // The one that matters most now that speed carries the reading: an
  // unchanged `dur` means the running animation is never touched, so the
  // charge cannot be remapped to a new position mid-flight.
  expect(railPulse(1000, 9000)).toEqual(railPulse(1004, 9000));
  expect(railPulse(1000, 9000)).toEqual(railPulse(996, 9000));
});

test("railPulse: carries magnitude, not sign — direction is colour and travel", () => {
  expect(railPulse(-3000, 9000)).toEqual(railPulse(3000, 9000));
});

test("railPulse: speed climbs with power, monotonically, and never inverts", () => {
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

test("railPulse: survives every boundary reading without a NaN reaching a style", () => {
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

test("crossingSeconds: is quantized, so a wobbling reading never touches the running animation", () => {
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

test("crossingSeconds: more power is less time on the wire", () => {
  expect(crossingSeconds(1)).toBeLessThan(crossingSeconds(0));
  expect(crossingSeconds(0.5)).toBeLessThan(crossingSeconds(0.1));
});

test("crossingSeconds: clamps outside 0..1 rather than producing a zero or negative duration", () => {
  // A duration of 0 is an animation that never advances; a negative one is
  // undefined. Either way the rail freezes and looks broken, not idle.
  for (const share of [-5, 0, 1, 12, Number.NaN, Number.POSITIVE_INFINITY]) {
    const dur = crossingSeconds(share);
    expect(dur).toBeGreaterThan(0);
    expect(dur).toBeLessThanOrEqual(crossingSeconds(0));
  }
});
