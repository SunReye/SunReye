import { describe, expect, test } from "bun:test";
import { CadenceTracker } from "./cadence";

/** The live feed's nominal spacing — what a fresh tracker assumes. */
const SEED_MS = 1000;

describe("CadenceTracker", () => {
  test("a lone sample keeps the seed — one timestamp is not a spacing", () => {
    const cadence = new CadenceTracker();
    expect(cadence.sample(10_000)).toBe(SEED_MS);
    expect(cadence.cadenceMs).toBe(SEED_MS);
  });

  test("the first sample after a reconnect is measured against nothing", () => {
    // The gap across an outage is not a poll interval: measuring the first
    // post-reconnect sample against the pre-drop timestamp would whip the
    // estimate to minutes and freeze every animated number on the dashboard.
    const cadence = new CadenceTracker();
    cadence.sample(0);
    cadence.sample(2000); // a real 2 s spacing moves the estimate off the seed
    const before = cadence.cadenceMs;
    expect(before).toBeGreaterThan(SEED_MS);

    cadence.reset();
    // Ten minutes of downtime, then the stream resumes.
    expect(cadence.sample(602_000)).toBe(before);
    // The estimate itself survives the reconnect — only the anchor is dropped.
    expect(cadence.cadenceMs).toBe(before);
  });

  test("two samples with the same timestamp leave the estimate alone", () => {
    // A duplicate frame (server republish) carries no new spacing information.
    const cadence = new CadenceTracker();
    cadence.sample(5000);
    expect(cadence.sample(5000)).toBe(SEED_MS);
  });

  test("a sample from before the last one is ignored, not counted as a gap", () => {
    // Out-of-order delivery or a host clock stepping backwards. A negative
    // delta must never reach the clamp, which would silently read as 1 s.
    const cadence = new CadenceTracker();
    cadence.sample(10_000);
    cadence.sample(4000);
    expect(cadence.cadenceMs).toBe(SEED_MS);
  });

  test("a backwards sample still re-anchors, so the next real gap is honest", () => {
    // After a clock step the following spacing is measured from the sample we
    // actually saw last; anchoring on the pre-step timestamp would invent a
    // six-second gap that never happened.
    const cadence = new CadenceTracker();
    cadence.sample(10_000);
    cadence.sample(4000); // clock stepped back
    cadence.sample(6000); // a 2 s spacing from there
    expect(cadence.cadenceMs).toBeCloseTo(1000 * 0.7 + 2000 * 0.3, 6);
  });

  test("a sub-second gap is floored at a second — the poll can't run faster", () => {
    const cadence = new CadenceTracker();
    cadence.sample(0);
    // 40 ms apart (a burst after a stall): clamped to the 1 s floor, so the
    // estimate stays at the seed instead of collapsing the glide to a jump.
    expect(cadence.sample(40)).toBe(SEED_MS);
  });

  test("a gap longer than an hour is capped at an hour — the poll can't run slower", () => {
    const cadence = new CadenceTracker();
    cadence.sample(0);
    // Two hours: clamped to the 1 h ceiling the poll config allows.
    expect(cadence.sample(7_200_000)).toBeCloseTo(1000 * 0.7 + 3_600_000 * 0.3, 6);
  });

  test("a steady feed converges on its real spacing", () => {
    // The point of the whole thing: a user polling every 5 s should end up with
    // a 5 s glide rather than the 1 Hz seed.
    const cadence = new CadenceTracker();
    for (let i = 0; i <= 40; i += 1) cadence.sample(i * 5000);
    expect(cadence.cadenceMs).toBeCloseTo(5000, 0);
  });

  test("one late sample nudges the estimate instead of whipping it", () => {
    // EMA with α=0.3: a single 10 s hiccup in a 1 Hz feed must not stretch the
    // glide to ten seconds and leave the numbers crawling.
    const cadence = new CadenceTracker();
    for (let i = 0; i <= 20; i += 1) cadence.sample(i * 1000);
    cadence.sample(30_000); // one 10 s stall
    expect(cadence.cadenceMs).toBeLessThan(4000);
  });

  test("bounds are configurable — EVCC pushes on change, not on a poll", () => {
    const cadence = new CadenceTracker({ minMs: 500, maxMs: 10_000 });
    cadence.sample(0);
    expect(cadence.sample(60_000)).toBeCloseTo(1000 * 0.7 + 10_000 * 0.3, 6);
  });
});
