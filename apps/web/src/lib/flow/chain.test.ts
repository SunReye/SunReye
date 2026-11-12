// The comet as a chain of beads, its direction, its glow, and how a change of speed keeps it in place.
// Ported from v3 (dev 780b4e2, lib/inverter/flow-pulse.test.ts).
import { expect, test } from "bun:test";
import {
  BEAD_COUNT,
  animationPhase,
  carryHead,
  rephasedBegin,
  beadBegin,
  bead,
  moverKeyPoints,
  nodeGlow,
} from "./flow-pulse.ts";

/** How far a bead's `begin` puts it ahead of the tail, seconds. */
function lead(begin: string): number {
  return Math.abs(Number(/-(?<s>[\d.]+)s/u.exec(begin)?.groups?.["s"]));
}

/** How much of the node's accent its glow mixes in. */
function glowPercent(share: number): number {
  return Number(/ (?<p>\d+)%/u.exec(nodeGlow("var(--x)", share))?.groups?.["p"]);
}

/** A `begin` attribute in seconds. */
function seconds(begin: string): number {
  return Number(begin.slice(0, -1));
}

test("moverKeyPoints: an inbound charge runs the cable toward the hub and an outbound one away", () => {
  // `power-graph.ts` puts the hub last in every segment's `pts`, so the
  // authored direction IS node → hub. Reversing the key points rather than
  // the path string is what lets both directions share one <mpath> — the
  // rail's own cable — so a resize moves the charge with the wire.
  expect(moverKeyPoints("in")).toBe("0;1");
  expect(moverKeyPoints("out")).toBe("1;0");
});

test("the bead chain: bends with the rail because every bead is separately on the path", () => {
  // The reason a charge is a chain and not a sprite. A sprite can only be
  // placed and rotated, so on a Bézier it cuts the corner; each bead riding
  // the cable at its own lag follows the curve exactly. Structurally: every
  // bead has a distinct lag, or they would stack into one point.
  const lags = Array.from({ length: BEAD_COUNT }, (_, k) => beadBegin(k, 2));
  expect(new Set(lags).size).toBe(BEAD_COUNT);
});

test("the bead chain: the head leads and each bead behind it lags further", () => {
  let previous = Number.POSITIVE_INFINITY;

  for (let k = 0; k < BEAD_COUNT; k++) {
    const ahead = lead(beadBegin(k, 2));
    expect(ahead).toBeLessThan(previous);
    previous = ahead;
  }

  // The last bead is the tail: it rides the path with no lead at all.
  expect(beadBegin(BEAD_COUNT - 1, 2)).toBe("-0s");
});

test("the bead chain: the comet keeps its length at every speed", () => {
  // A lag fixed in seconds would smear the comet across half the rail as soon
  // as the power dropped and the crossing slowed down. Scaled by the crossing
  // time, the chain occupies the same FRACTION of the wire at any speed.
  expect(lead(beadBegin(0, 1)) / 1).toBeCloseTo(lead(beadBegin(0, 4.5)) / 4.5, 6);
});

test("the bead chain: tapers to a point: the head is fattest and brightest, the tail neither", () => {
  let r = Number.POSITIVE_INFINITY;
  let o = Number.POSITIVE_INFINITY;

  for (let k = 0; k < BEAD_COUNT; k++) {
    const b = bead(k);
    expect(b.radius).toBeLessThanOrEqual(r);
    expect(b.opacity).toBeLessThanOrEqual(o);
    expect(b.radius).toBeGreaterThanOrEqual(0);
    expect(b.opacity).toBeGreaterThanOrEqual(0);
    r = b.radius;
    o = b.opacity;
  }

  expect(bead(0)).toEqual({ radius: 1, opacity: 1 });
  expect(bead(BEAD_COUNT - 1).radius).toBe(0);
});

test("the bead chain: radius outlives opacity, so the comet has a body before it ends", () => {
  // Falling off together gives a stub that vanishes; a slower radius falloff
  // is what makes the tail read as tapering rather than being cut short.
  const mid = bead(Math.floor(BEAD_COUNT / 2));
  expect(mid.radius).toBeGreaterThan(mid.opacity);
});

test("the bead chain: a nonsense duration cannot produce a nonsense lag", () => {
  for (const dur of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
    for (let k = 0; k < BEAD_COUNT; k++) expect(beadBegin(k, dur)).not.toContain("NaN");
  }
});

test("the bead chain: asking outside the chain clamps rather than inverting the taper", () => {
  expect(bead(-4)).toEqual(bead(0));
  expect(bead(999)).toEqual(bead(BEAD_COUNT - 1));
});

test("nodeGlow: mixes the node's accent token rather than baking a colour", () => {
  // A hex here is a colour the palette cannot reach — the whole reason the
  // direction and judgement colours became tokens.
  const glow = nodeGlow("var(--energy-solar)", 0.85);
  expect(glow).toStartWith("color-mix(in oklab,");
  expect(glow).toContain("var(--energy-solar)");
  expect(glow).not.toMatch(/#[0-9a-f]{3}/iu);
  expect(glow).not.toMatch(/rgb|emerald|amber/iu);
});

test("nodeGlow: brightens with the plant's share and stays inside the mix range", () => {
  expect(glowPercent(1)).toBeGreaterThan(glowPercent(0.5));
  expect(glowPercent(0.5)).toBeGreaterThan(glowPercent(0));
  expect(glowPercent(0)).toBeGreaterThan(0);
  expect(glowPercent(1)).toBeLessThanOrEqual(100);
});

test("nodeGlow: an out-of-range or unreadable share cannot emit an invalid percentage", () => {
  // The share arrives from a reading; a NaN percentage silently voids the
  // whole box-shadow declaration and the node loses its glow entirely.
  for (const share of [-1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
    const percent = glowPercent(share);
    expect(Number.isFinite(percent)).toBe(true);
    expect(percent).toBeGreaterThanOrEqual(0);
    expect(percent).toBeLessThanOrEqual(100);
  }
});

// SMIL resolves `begin` against the SVG document timeline, so a rebuilt chain
// can be handed a begin that puts its head at the point the old chain had
// reached. Without that the head restarts from the top of the rail on every
// quantized step, and with a 1 Hz feed hovering on a step boundary that is a
// teleport every second — the jitter this pins down.
test("a change of speed keeps the comet where it is: animationPhase reads the fraction of the period elapsed at `now`", () => {
  expect(animationPhase(10, 0, 4)).toBeCloseTo(0.5, 9);
  expect(animationPhase(10, -0.5, 4)).toBeCloseTo(0.625, 9);
  // A begin in the future has not started: phase 0, not a negative fraction.
  expect(animationPhase(1, 3, 4)).toBe(0);
});

test("a change of speed keeps the comet where it is: animationPhase always lands in [0, 1)", () => {
  for (const [now, begin, dur] of [
    [0, 0, 1],
    [4, 0, 4],
    [123.456, -0.3, 1.25],
    [1e6, -1e5, 2.75],
  ] as const) {
    const p = animationPhase(now, begin, dur);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(1);
  }
});

test("a change of speed keeps the comet where it is: a nonsense clock or period is phase 0, never NaN", () => {
  for (const dur of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(animationPhase(10, 0, dur)).toBe(0);
  }

  expect(animationPhase(Number.NaN, 0, 2)).toBe(0);
  expect(animationPhase(10, Number.NaN, 2)).toBe(0);
});

test("a change of speed keeps the comet where it is: rephasedBegin puts the head at the same phase under the new period", () => {
  const now = 37.2;

  for (const [oldDur, newDur] of [
    [4.5, 1.25],
    [1.25, 4.5],
    [2, 2.25],
  ] as const) {
    const phase = animationPhase(now, -0.4, oldDur);
    const begin = rephasedBegin(now, phase, newDur);
    expect(animationPhase(now, begin, newDur)).toBeCloseTo(phase, 6);
  }
});

test("a change of speed keeps the comet where it is: rephasedBegin is a begin already in the past, and at most one period back", () => {
  // Normalised into (-dur, 0] so the attribute reads like every other lag the
  // chain already uses, and so a begin can never be "not yet".
  for (const phase of [0, 0.25, 0.5, 0.999]) {
    const begin = rephasedBegin(100, phase, 3);
    expect(begin).toBeLessThanOrEqual(0);
    expect(begin).toBeGreaterThan(-3);
  }

  // Phase 0 is the top of the path: the unrephased chain.
  expect(rephasedBegin(100, 0, 3)).toBe(-0);
});

test("a change of speed keeps the comet where it is: rephasedBegin with a nonsense input starts from the top of the path", () => {
  expect(rephasedBegin(Number.NaN, 0.5, 3)).toBe(0);
  expect(rephasedBegin(10, Number.NaN, 3)).toBe(0);
  expect(rephasedBegin(10, 0.5, 0)).toBe(0);
});

test("a change of speed keeps the comet where it is: beadBegin lays the chain behind a rephased head", () => {
  const head = -1.2;

  for (let k = 0; k < BEAD_COUNT; k++) {
    expect(beadBegin(k, 2, head)).toBe(
      `${Math.round((head - lead(beadBegin(k, 2))) * 10000) / 10000}s`,
    );
  }

  // No head given is the top of the path, as before.
  expect(beadBegin(0, 2, 0)).toBe(beadBegin(0, 2));
});

test("a change of speed keeps the comet where it is: the whole chain keeps its phase across a change of speed", () => {
  const now = 512.75;
  const oldDur = 4.5;
  const newDur = 1.25;
  const phase = animationPhase(now, 0, oldDur);
  const head = rephasedBegin(now, phase, newDur);

  // Every bead sits the same FRACTION of the crossing behind the head it did
  // before — so the comet is the same length and at the same place.
  for (let k = 0; k < BEAD_COUNT; k++) {
    const before = animationPhase(now, seconds(beadBegin(k, oldDur)), oldDur);
    const after = animationPhase(now, seconds(beadBegin(k, newDur, head)), newDur);
    expect(after).toBeCloseTo(before, 3);
  }
});

// The memory the charge component keeps across rebuilds, as a pure step so
// the component's derived is one line.
test("carryHead: a first chain starts from the top of the path", () => {
  expect(carryHead(undefined, 2.5, () => 40)).toEqual({ dur: 2.5, head: 0 });
});

test("carryHead: the same dur hands back the same head without consulting the clock", () => {
  const last = { dur: 2.5, head: -1.1 };
  let asked = 0;
  const next = carryHead(last, 2.5, () => (asked++, 40));
  expect(next).toEqual(last);
  expect(asked).toBe(0);
});

test("carryHead: a new dur re-phases the head against the clock", () => {
  const last = { dur: 4.5, head: -0.4 };
  const now = 40;
  const next = carryHead(last, 1.25, () => now);
  expect(next.dur).toBe(1.25);
  expect(animationPhase(now, next.head, 1.25)).toBeCloseTo(animationPhase(now, -0.4, 4.5), 6);
});

test("carryHead: no clock yet starts the new speed from the top of the path", () => {
  expect(carryHead({ dur: 4.5, head: -0.4 }, 1.25, () => {})).toEqual({
    dur: 1.25,
    head: 0,
  });
});
