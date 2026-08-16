import { describe, expect, it } from "bun:test";
import { LIVE_VALUE_IDS, OWNERSHIP, buildOwnerIndex, ownerOf } from "./ownership";

describe("live value ownership", () => {
  it("every logical value has exactly one owning topic", () => {
    // The mechanical guard the whole phase exists for: the instant a value
    // appears under two topics, some consumer is free to `??` between them and
    // paint a decision-cadence number at the metrics cadence.
    const seen = new Map<string, string[]>();
    for (const [topic, ids] of Object.entries(OWNERSHIP))
      for (const id of ids) seen.set(id, [...(seen.get(id) ?? []), topic]);
    const shared = [...seen].filter(([, topics]) => topics.length !== 1);
    expect(shared).toEqual([]);
    expect(seen.size).toBe(LIVE_VALUE_IDS.length);
  });

  it("refuses a table that lists one value under two topics", () => {
    // buildOwnerIndex is what makes the rule enforceable rather than a comment:
    // a duplicate is a build-time throw, not a silently-last-wins map.
    expect(() => buildOwnerIndex({ metrics: ["load.power"], automations: ["load.power"] })).toThrow(
      /load\.power/,
    );
  });

  it("the register a meter reads is owned by metrics, the engine's decision by automations", () => {
    // The live failure: house load resolved from the metrics topic, then fell
    // back to the automations status when a profile had no `load.power` role.
    expect(ownerOf("load.power")).toBe("metrics");
    expect(ownerOf("automation.threshold.power")).toBe("automations");
    expect(ownerOf("evcc.charge.power")).toBe("evcc");
    // Today's cost is a rollup integration, deliberately not the inverter's
    // own day counter — two different numbers, two different owners.
    expect(ownerOf("statistics.energy.today")).toBe("statistics");
    expect(ownerOf("load.energy.today")).toBe("metrics");
  });

  it("names an unknown value rather than guessing an owner", () => {
    // @ts-expect-error -- an id outside the vocabulary is a programming error
    expect(() => ownerOf("load.power.probably")).toThrow(/load\.power\.probably/);
  });
});
