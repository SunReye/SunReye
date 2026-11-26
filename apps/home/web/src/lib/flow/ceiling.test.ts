// The remembered plant peak every rail is measured against: one side of the balance, held with a
// six-hour half-life, decayed by wall-clock time, never below the floor. Ported from v3 (dev 780b4e2,
// lib/inverter/flow-pulse.test.ts).
import { expect, test } from "bun:test";
import { CEILING_FLOOR_W, decayCeiling, parseCeiling, type Ceiling } from "./ceiling.ts";
import { throughputWatts } from "./flow-pulse.ts";

const HOUR_MS = 60 * 60 * 1000;

test("throughputWatts: sums what is arriving, not what is leaving", () => {
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

test("throughputWatts: takes the magnitude — an inbound rail reported negative still arrived", () => {
  expect(throughputWatts([{ flow: "in", value: -2500 }])).toBe(2500);
});

test("throughputWatts: a segment with no reading contributes nothing rather than NaN", () => {
  // `value` is undefined before the first frame and whenever the register is
  // absent. One of those must not blank the whole plant's reference.
  expect(
    throughputWatts([
      { flow: "in", value: undefined },
      { flow: "in", value: 800 },
    ]),
  ).toBe(800);
});

test("throughputWatts: no segments is zero, not NaN", () => {
  expect(throughputWatts([])).toBe(0);
});

test("decayCeiling: rises to a spike within the same call", () => {
  // Noon must be visible the instant it arrives; only forgetting is slow.
  expect(decayCeiling({ watts: CEILING_FLOOR_W, at: 0 }, 1000, 9000).watts).toBe(9000);
});

test("decayCeiling: is idempotent — folding it twice at the same instant changes nothing", () => {
  // THE structural reason decay is wall-clock rather than per-sample: an
  // extra invocation (EVCC's own cadence, a resize storm, a $derived
  // recompute) must not be able to age the plant's memory.
  const start: Ceiling = { watts: 8000, at: 0 };
  const once = decayCeiling(start, HOUR_MS, 0);
  const twice = decayCeiling(once, HOUR_MS, 0);
  expect(twice).toEqual(once);
});

test("decayCeiling: halves over six hours of elapsed time", () => {
  const after = decayCeiling({ watts: 8000, at: 0 }, 6 * HOUR_MS, 0);
  expect(after.watts).toBeCloseTo(4000, 6);
  expect(after.at).toBe(6 * HOUR_MS);
});

test("decayCeiling: forgetting depends on elapsed time, not on how often it was called", () => {
  // The same six hours, sampled once vs sampled hourly, must land in the same
  // place — otherwise the picture depends on render invalidation.
  const start: Ceiling = { watts: 8000, at: 0 };
  let stepped = start;

  for (let h = 1; h <= 6; h++) stepped = decayCeiling(stepped, h * HOUR_MS, 0);
  const once = decayCeiling(start, 6 * HOUR_MS, 0);
  expect(stepped.watts).toBeCloseTo(once.watts, 6);
});

test("decayCeiling: never falls below the floor however long the plant sleeps", () => {
  expect(decayCeiling({ watts: 1e9, at: 0 }, 1000 * HOUR_MS, 0).watts).toBe(CEILING_FLOOR_W);
});

test("decayCeiling: a clock that jumps backwards does not inflate the ceiling", () => {
  // Host clock corrections and DST are real; a negative elapsed would
  // multiply the memory instead of decaying it.
  const back = decayCeiling({ watts: 4000, at: 10 * HOUR_MS }, 2 * HOUR_MS, 0);
  expect(back.watts).toBe(4000);
});

test("decayCeiling: a corrupt remembered peak degrades to the floor rather than to NaN", () => {
  expect(decayCeiling({ watts: Number.NaN, at: 0 }, HOUR_MS, 0).watts).toBe(CEILING_FLOOR_W);
});

test("decayCeiling: a corrupt timestamp degrades to the floor and recovers its clock", () => {
  // A NaN `at` used to poison every later fold through `now - NaN`, painting
  // every rail from a NaN ceiling forever.
  const fixed = decayCeiling({ watts: 8000, at: Number.NaN }, HOUR_MS, 0);
  expect(fixed.watts).toBe(CEILING_FLOOR_W);
  expect(fixed.at).toBe(HOUR_MS);
});

test("decayCeiling: an unreadable current sample leaves the memory intact", () => {
  const held = decayCeiling({ watts: 8000, at: 0 }, 0, Number.NaN);
  expect(held.watts).toBe(8000);
});

test("decayCeiling: takes the magnitude of the current sample", () => {
  expect(decayCeiling({ watts: CEILING_FLOOR_W, at: 0 }, 0, -7000).watts).toBe(7000);
});

test("parseCeiling: a stored peak survives a remount", () => {
  // The whole reason it is persisted: an orientation flip or a kiosk reload
  // must not restart the ramp from the floor and blaze for six hours.
  expect(parseCeiling('{"watts":7200,"at":1699999999999}')).toEqual({
    watts: 7200,
    at: 1699999999999,
  });
});

test("parseCeiling: a first visit starts at the floor", () => {
  expect(parseCeiling(null)).toEqual({ watts: CEILING_FLOOR_W, at: 0 });
  expect(parseCeiling()).toEqual({ watts: CEILING_FLOOR_W, at: 0 });
});

test("parseCeiling: junk in storage starts at the floor rather than throwing on the way up", () => {
  // This is read before the first paint. A corrupt entry — another app's key,
  // a half-written value — must not take the diagram down with it.
  for (const raw of ["", "not json", "null", "[]", "42", '{"watts":"7200","at":0}', "{}"])
    expect(parseCeiling(raw)).toEqual({ watts: CEILING_FLOOR_W, at: 0 });
});

test("parseCeiling: a stored value below the floor is raised to it", () => {
  expect(parseCeiling('{"watts":40,"at":123}')).toEqual({ watts: CEILING_FLOOR_W, at: 123 });
});

test("parseCeiling: a stored non-finite peak degrades to the floor", () => {
  // JSON has no Infinity, so it round-trips as null — but a hand-edited or
  // foreign entry can still carry one.
  expect(parseCeiling('{"watts":null,"at":null}')).toEqual({ watts: CEILING_FLOOR_W, at: 0 });
});
