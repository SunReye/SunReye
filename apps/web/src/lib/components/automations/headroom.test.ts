import { describe, expect, it } from "bun:test";
import { headroomReading } from "./headroom";

const soc = (value: number | undefined, stale = false) => ({ value, stale });

describe("battery headroom from the live SOC", () => {
  it("is the usable pack minus what is already in it", () => {
    expect(headroomReading(10, soc(40))).toEqual({ value: 6, stale: false });
  });

  it("an empty pack is all headroom — 0 % is a reading", () => {
    // The falsy-check trap in its natural habitat: a 0 % SOC is the case where
    // headroom matters most, and it must not read as "no SOC".
    expect(headroomReading(10, soc(0))).toEqual({ value: 10, stale: false });
  });

  it("a full pack has no headroom", () => {
    expect(headroomReading(10, soc(100))).toEqual({ value: 0, stale: false });
  });

  it("clamps a BMS that reports outside 0–100", () => {
    // Some packs briefly report 101 % after an absorption charge; headroom is
    // never negative, and never more than the pack.
    expect(headroomReading(10, soc(105)).value).toBe(0);
    expect(headroomReading(10, soc(-5)).value).toBe(10);
  });

  it("without a live SOC there is no headroom to show — not the engine's copy", () => {
    // The rule this phase enforces: SOC is owned by the metrics topic, so when
    // metrics is silent the tile says so rather than borrowing `status.headroomKwh`,
    // which moves at the control interval.
    expect(headroomReading(10, soc(undefined))).toEqual({ value: undefined, stale: false });
  });

  it("without a pack size there is nothing to compute", () => {
    expect(headroomReading(null, soc(40)).value).toBeUndefined();
  });

  it("inherits the SOC's staleness — a derived number is no fresher than its input", () => {
    expect(headroomReading(10, soc(40, true))).toEqual({ value: 6, stale: true });
  });
});
