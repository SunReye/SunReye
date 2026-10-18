/**
 * The plant ceiling's storage policy: what the shell persists, and when.
 *
 * That `plantCeiling.observe()` can run inside the diagram's `$effect` without
 * invalidating it (`effect_update_depth_exceeded`) is a claim about runes, so it
 * is proven where runes run: `plant-ceiling.svelte.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { CEILING_FLOOR_W, decayCeiling, shouldPersist } from "./flow-pulse";

describe("the ceiling still survives a reload", () => {
  test("a fold that changes nothing publishes nothing", () => {
    // The value-level half of the loop guard, and it is testable: two folds at
    // the same instant agree, so the published number is unchanged and Svelte's
    // `===` check makes the second write a no-op.
    const prev = { watts: 9000, at: 1_000_000 };
    const once = decayCeiling(prev, 1_000_500, 300);
    expect(decayCeiling(once, 1_000_500, 300).watts).toBe(once.watts);
    expect(decayCeiling(prev, 1_000_500, 300)).toEqual(once);
    expect(once.watts).toBeGreaterThanOrEqual(CEILING_FLOOR_W);
  });
});

describe("a rising plant does not write storage at the feed's cadence", () => {
  test("a peak worth remembering is written", () => {
    const last = { watts: 1000, at: 0 };
    expect(shouldPersist(last, { watts: 4000, at: 1000 })).toBe(true);
  });

  test("but a clear-sky ramp that creeps up by a watt a second is not", () => {
    // The descent was already skipped to avoid a 1 Hz synchronous write; a
    // morning ramp sets a new record on most consecutive samples, so the ASCENT
    // is the same hours-long stall on a fanless kiosk. A slightly stale stored
    // peak is self-correcting — decay reads the stored value and its timestamp —
    // which is exactly why skipping the descent was safe.
    const last = { watts: 4000, at: 1_000_000 };
    expect(shouldPersist(last, { watts: 4001, at: 1_001_000 })).toBe(false);
    expect(shouldPersist(last, { watts: 4180, at: 1_001_000 })).toBe(false);
  });

  test("a slow creep is still written once a minute, so a reload keeps it", () => {
    const last = { watts: 4000, at: 1_000_000 };
    expect(shouldPersist(last, { watts: 4001, at: 1_059_999 })).toBe(false);
    expect(shouldPersist(last, { watts: 4001, at: 1_060_000 })).toBe(true);
  });

  test("a descent, a standstill and an unreadable clock write nothing", () => {
    const last = { watts: 4000, at: 1_000_000 };
    expect(shouldPersist(last, { watts: 4000, at: 9_000_000 })).toBe(false);
    expect(shouldPersist(last, { watts: 100, at: 9_000_000 })).toBe(false);
    expect(shouldPersist(last, { watts: Number.NaN, at: 9_000_000 })).toBe(false);
    expect(shouldPersist(last, { watts: 4001, at: Number.NaN })).toBe(false);
  });
});
