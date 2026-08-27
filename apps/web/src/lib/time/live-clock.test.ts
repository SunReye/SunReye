import { describe, expect, it } from "bun:test";
import { clockTick } from "./live-clock";

/**
 * The grain is pinned at INSTANTS, not against an exported constant.
 *
 * Two claims together say everything the clock has to promise: one answer across
 * a whole minute (so a ~1 Hz live feed cannot propagate as ~1 Hz re-renders) and
 * a fresh answer at the next minute, landing exactly on it (so a civil midnight
 * — always a whole minute in every IANA zone — is noticed, and within a minute
 * of happening). Restating `60_000` beside the module that defines it would be a
 * second copy to keep in step, and would still not say either of those things.
 */
const MIDNIGHT = Date.UTC(2026, 7, 21, 0, 0, 0);
const LAST_MINUTE = Date.UTC(2026, 7, 20, 23, 59, 0);

describe("clockTick — the shared clock's grain", () => {
  it("holds still for a whole minute, so a 1 Hz feed re-renders nothing", () => {
    // THE POINT of coarsening. The tick is read off the live feed's frames, which
    // land about once a second; handing each one on as a new `now` would
    // invalidate everything derived from it — the navigator's title, its live
    // pill, the forward arrow's disabled state — sixty times a minute, on the
    // page whose reactive budget produced the PR #60 outage.
    expect(clockTick(LAST_MINUTE)).toBe(clockTick(LAST_MINUTE + 1));
    expect(clockTick(LAST_MINUTE)).toBe(clockTick(LAST_MINUTE + 30_000));
    expect(clockTick(LAST_MINUTE)).toBe(clockTick(MIDNIGHT - 1));
  });

  it("advances at the next minute, exactly onto it", () => {
    // A clock that never advances is the bug this module exists for: "Today ●
    // Live" printed over yesterday, with the arrow that leads to today dead. A
    // day boundary is a whole minute everywhere, so it is landed on and not
    // approached.
    expect(clockTick(MIDNIGHT)).toBe(MIDNIGHT);
    expect(clockTick(MIDNIGHT)).toBeGreaterThan(clockTick(MIDNIGHT - 1));
  });

  it("never reads ahead of the real clock", () => {
    // Rounding instead of flooring would put the coarse clock up to half a grain
    // into the future, and `containsNow` would call tomorrow live tonight.
    for (const ms of [LAST_MINUTE, LAST_MINUTE + 1, MIDNIGHT - 1, MIDNIGHT, MIDNIGHT + 59_999]) {
      expect(clockTick(ms)).toBeLessThanOrEqual(ms);
    }
  });

  it("is never more than a minute behind it either", () => {
    // The lag is what decides how long the navigator may keep saying "Today"
    // after midnight.
    for (const ms of [LAST_MINUTE + 1, MIDNIGHT - 1, MIDNIGHT + 30_000]) {
      expect(ms - clockTick(ms)).toBeLessThan(60_000);
    }
  });
});
