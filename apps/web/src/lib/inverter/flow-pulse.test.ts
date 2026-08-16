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
  dotPositions,
  layerStyle,
  nodeGlow,
  parseCeiling,
  PULSE_LAYERS,
  PULSE_PERIOD_S,
  PULSE_SPAN,
  PULSE_SPEED,
  pulseShare,
  railPulse,
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

describe("the pulse ladder", () => {
  test("every layer's dash period divides the travelled span exactly", () => {
    // The cycle travels exactly PULSE_SPAN. If a period did not divide it, that
    // layer's comets would jump at the loop point — a visible stutter once per
    // 2.5 s on a rail nobody is touching.
    for (const layer of PULSE_LAYERS) {
      const period = layer.period * PULSE_SPAN;
      expect(period).toBeGreaterThan(0);
      expect(PULSE_SPAN % period).toBe(0);
    }
  });

  test("the base layer is always lit — any flow shows at least one comet", () => {
    // A rail that is moving power must never be indistinguishable from an idle
    // one, however small its share.
    expect(PULSE_LAYERS[0]?.from).toBe(0);
    expect(PULSE_LAYERS[0]?.to).toBe(0);
  });

  test("each layer lights above the one below it", () => {
    // The windows have to climb, or two layers fade in together and the density
    // ladder collapses into two steps instead of four.
    for (let i = 2; i < PULSE_LAYERS.length; i++) {
      expect(PULSE_LAYERS[i]!.from).toBeGreaterThanOrEqual(PULSE_LAYERS[i - 1]!.to - 0.001);
      expect(PULSE_LAYERS[i]!.to).toBeGreaterThan(PULSE_LAYERS[i]!.from);
    }
  });
});

describe("dotPositions", () => {
  /** Spacing of the lit comets inside one span, including the wrap to the next cycle. */
  function spacings(lit: number): number[] {
    const dots = dotPositions(lit);
    return [...dots, PULSE_SPAN].slice(1).map((x, i) => x - dots[i]!);
  }

  test("each lit layer doubles the comet count at even spacing", () => {
    // THE invariant of the design: density is a power-of-two interleave, so the
    // gap between comets halves per layer and the rail never respaces.
    for (let lit = 1; lit <= PULSE_LAYERS.length; lit++) {
      const expected = PULSE_SPAN / 2 ** (lit - 1);
      expect(dotPositions(lit)).toHaveLength(2 ** (lit - 1));
      for (const gap of spacings(lit)) expect(gap).toBeCloseTo(expected, 9);
    }
  });

  test("lighting a layer adds comets between the existing ones without moving any", () => {
    // Why density is an opacity fade rather than a changing dash period: the
    // comets already on the rail keep their exact positions, so nothing on
    // screen teleports when the plant's load changes.
    for (let lit = 2; lit <= PULSE_LAYERS.length; lit++) {
      const before = dotPositions(lit - 1);
      const after = dotPositions(lit);
      for (const dot of before) expect(after).toContain(dot);
      expect(after.length).toBe(before.length * 2);
    }
  });

  test("no flow is no comets, and asking past the ladder cannot invent one", () => {
    expect(dotPositions(0)).toEqual([]);
    expect(dotPositions(-3)).toEqual([]);
    expect(dotPositions(99)).toEqual(dotPositions(PULSE_LAYERS.length));
  });
});

describe("railPulse", () => {
  test("the same fraction of its own plant is the same picture at any scale", () => {
    // Why the feature exists. A 5 kW rail on a 5.5 kW plant and a 500 W rail on
    // a 550 W plant carry identical comets — density, length, width and bloom.
    expect(railPulse(5000, 5500)).toEqual(railPulse(500, 550));
    expect(railPulse(500, 5500)).toEqual(railPulse(50, 550));
  });

  test("a 300 W night against a 9 kW day is a single dim spark", () => {
    // The flaw that killed max-of-current normalisation: without a remembered
    // plant peak this rail would be the busiest one on screen and blaze at
    // full density, so midnight and noon looked identical.
    const night = railPulse(300, 9000);
    expect(night.layers[0]).toBe(1);
    expect(night.layers[1]).toBeLessThan(0.2); // a ghost, not a second comet
    expect(night.layers[2]).toBe(0);
    expect(night.layers[3]).toBe(0);
    expect(night.glow).toBeLessThanOrEqual(0.14);
  });

  test("a 6 kW rail on the same plant runs every layer", () => {
    const noon = railPulse(6000, 9000);
    for (const opacity of noon.layers) expect(opacity).toBeGreaterThan(0);
    expect(noon.layers[1]).toBe(1);
    expect(noon.layers[2]).toBe(1);
    expect(noon.dot).toBeGreaterThan(railPulse(300, 9000).dot);
    expect(noon.width).toBeGreaterThan(railPulse(300, 9000).width);
    expect(noon.glow).toBeGreaterThan(railPulse(300, 9000).glow);
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
    // Un-quantize the share and each second rewrites four dash patterns and
    // three custom properties on every rail in the diagram.
    expect(railPulse(1000, 9000)).toEqual(railPulse(1004, 9000));
    expect(railPulse(1000, 9000)).toEqual(railPulse(996, 9000));
  });

  test("carries magnitude, not sign — direction is colour and travel", () => {
    expect(railPulse(-3000, 9000)).toEqual(railPulse(3000, 9000));
  });

  test("every layer opacity climbs with power and none overtakes full", () => {
    const previous = PULSE_LAYERS.map(() => -1);
    for (let w = 0; w <= 9000; w += 50) {
      const { layers } = railPulse(w, 9000);
      expect(layers).toHaveLength(PULSE_LAYERS.length);
      layers.forEach((opacity, i) => {
        expect(opacity).toBeGreaterThanOrEqual(previous[i]!);
        expect(opacity).toBeLessThanOrEqual(1);
        previous[i] = opacity;
      });
    }
    expect(previous.every((o) => o > 0)).toBe(true);
  });

  test("survives every boundary reading without a NaN reaching a style", () => {
    // A NaN in `dot`, `width` or `glow` reaches `stroke-dasharray` and the rail
    // disappears — a silent blank cable on a wall panel nobody is watching.
    const readings = [undefined, 0, -0, -250, 1e9, Number.NaN, Number.POSITIVE_INFINITY];
    const ceilings = [0, -1, 9000, Number.NaN, Number.POSITIVE_INFINITY];
    for (const w of readings)
      for (const c of ceilings) {
        const pulse = railPulse(w, c);
        expect(pulse.layers[0]).toBe(1);
        for (const value of [pulse.share, pulse.dot, pulse.width, pulse.glow, ...pulse.layers]) {
          expect(Number.isFinite(value)).toBe(true);
        }
        expect(pulse.share).toBeGreaterThanOrEqual(0);
        expect(pulse.share).toBeLessThanOrEqual(1);
        expect(pulse.glow).toBeGreaterThan(0);
        expect(pulse.glow).toBeLessThanOrEqual(1);
        expect(pulse.dot).toBeGreaterThan(0);
        expect(pulse.width).toBeGreaterThan(0);
      }
  });

  test("a comet is never longer than the gap it travels in", () => {
    // `stroke-dasharray: dot, period - dot` goes negative if the head outgrows
    // the tightest layer's period, which turns the dashes into a solid line.
    const tightest = Math.min(...PULSE_LAYERS.map((l) => l.period)) * PULSE_SPAN;
    expect(railPulse(1e9, 9000).dot).toBeLessThan(tightest);
  });
});

describe("layerStyle", () => {
  test("takes the layer index and nothing else — no reading can reach a timing", () => {
    // The original scar: an `animation-duration` derived from watts remaps
    // elapsed time, so every sample jumps every comet. Arity 1 is the
    // structural guarantee that a watt value cannot get in here.
    expect(layerStyle.length).toBe(1);
    expect(layerStyle(2)).toBe(layerStyle(2));
  });

  test("emits exactly the layer's own constants", () => {
    // Derived from PULSE_LAYERS rather than restated, so a changed ladder is
    // red here instead of silently mismatching the keyframes.
    PULSE_LAYERS.forEach((layer, i) => {
      expect(layerStyle(i)).toBe(
        `--lvl-period:${layer.period * PULSE_SPAN}px;--lvl-phase:${layer.delay * PULSE_SPAN}px;animation-delay:-${layer.delay * PULSE_PERIOD_S}s`,
      );
    });
  });

  test("sets a delay but never a duration", () => {
    for (let i = 0; i < PULSE_LAYERS.length; i++) {
      expect(layerStyle(i)).toContain("animation-delay:");
      expect(layerStyle(i)).not.toContain("animation-duration");
    }
  });

  test("a phase parks each layer where its comets already sit", () => {
    // Under reduced motion the animation is off and each layer is parked at
    // --lvl-phase. The beads must land on the same interleave as the moving
    // comets, or stopping the motion respaces the rail.
    PULSE_LAYERS.forEach((layer, i) => {
      const before = dotPositions(i);
      const introduced = dotPositions(i + 1).filter((dot) => !before.includes(dot));
      expect(layer.delay * PULSE_SPAN).toBe(introduced[0]!);
      expect(layerStyle(i)).toContain(`--lvl-phase:${introduced[0]}px`);
    });
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
