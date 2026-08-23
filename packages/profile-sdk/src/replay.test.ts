import { afterEach, describe, expect, test } from "bun:test";

import {
  defineProfile,
  hydrateProfile,
  metric,
  parseProfileData,
  registerProfile,
  unregisterProfile,
  type InverterProfile,
  type ProfileData,
} from "@SunReye/inverter-core";

import sampleProfile from "./__fixtures__/sample-profile.json";
import { replayCapture, type Capture } from "./replay";

const deyeData = sampleProfile as unknown as ProfileData;

function hydrate(data: ProfileData): InverterProfile {
  return hydrateProfile(parseProfileData(data));
}

const deye = hydrate(deyeData);

function tiny(): InverterProfile {
  return hydrate(
    defineProfile({
      id: "tiny",
      name: "Tiny",
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [
        metric("battery/soc", {
          label: "SOC",
          unit: "%",
          group: "battery",
          addr: 10,
          role: "battery.soc",
        }),
        metric("battery/temperature", {
          label: "Temp",
          unit: "°C",
          group: "battery",
          addr: 11,
          scale: 0.1,
          offset: -100,
        }),
      ],
    }),
  );
}

function capture(partial: Partial<Capture>): Capture {
  return { profile: "tiny", registers: {}, expect: {}, ...partial };
}

describe("replayCapture", () => {
  test("matching expectations pass", () => {
    const result = replayCapture(
      capture({ registers: { "10": 51, "11": 1235 }, expect: { "battery.soc": 51 } }),
      tiny(),
    );
    expect(result.ok).toBe(true);
    expect(result.mismatched).toEqual([]);
    expect(result.matched).toEqual([{ key: "battery.soc", expected: 51, actual: 51 }]);
  });

  test("a mismatch reports metric, expected and actual", () => {
    const result = replayCapture(
      capture({ registers: { "10": 51, "11": 1235 }, expect: { "battery.soc": 42 } }),
      tiny(),
    );
    expect(result.ok).toBe(false);
    expect(result.mismatched).toEqual([{ key: "battery.soc", expected: 42, actual: 51 }]);
    expect(result.matched).toEqual([]);
  });

  test("an unknown metric key is an error, not a silent skip", () => {
    const result = replayCapture(
      capture({ registers: { "10": 51, "11": 1235 }, expect: { "battery.nope": 1 } }),
      tiny(),
    );
    expect(result.ok).toBe(false);
    expect(result.unknownMetrics).toEqual(["battery.nope"]);
    expect(result.matched).toEqual([]);
    expect(result.mismatched).toEqual([]);
  });

  test("a scaled+offset metric compares within tolerance rather than by ===", () => {
    // 1001 * 0.1 - 100 is 0.10000000000000853 in IEEE-754, not 0.1.
    const result = replayCapture(
      capture({ registers: { "10": 51, "11": 1001 }, expect: { "battery.temperature": 0.1 } }),
      tiny(),
    );
    expect(result.matched[0]?.actual).not.toBe(0.1);
    expect(result.ok).toBe(true);
  });

  test("tolerance is tight enough to fail one raw LSB of error", () => {
    // One register step at scale 0.1 is 0.1 — far above the tolerance.
    const result = replayCapture(
      capture({ registers: { "10": 51, "11": 1001 }, expect: { "battery.temperature": 0.2 } }),
      tiny(),
    );
    expect(result.ok).toBe(false);
  });

  test("a missing declared address is reported and decodes to undefined, not 0", () => {
    const result = replayCapture(
      capture({ registers: { "10": 51 }, expect: { "battery.temperature": 0 } }),
      tiny(),
    );
    expect(result.ok).toBe(false);
    expect(result.missingRegisters).toEqual([{ key: "battery.temperature", missing: [11] }]);
    expect(result.mismatched).toEqual([
      { key: "battery.temperature", expected: 0, actual: undefined },
    ]);
  });

  test("a signed metric decoding negative", () => {
    const result = replayCapture(
      { profile: "deye-sg05lp3", registers: { "590": 65526 }, expect: { "battery.power": -10 } },
      deye,
    );
    expect(result.mismatched).toEqual([]);
    expect(result.matched).toEqual([{ key: "battery.power", expected: -10, actual: -10 }]);
  });

  test("a U_DWORD spanning two registers", () => {
    const result = replayCapture(
      {
        profile: "deye-sg05lp3",
        registers: { "534": 40000, "535": 1 },
        expect: { total_energy: 10553.6 },
      },
      deye,
    );
    expect(result.mismatched).toEqual([]);
    expect(result.matched[0]?.actual).toBeCloseTo(10553.6, 6);
  });

  test("a U_DWORD missing its high word decodes to undefined", () => {
    const result = replayCapture(
      { profile: "deye-sg05lp3", registers: { "534": 40000 }, expect: { total_energy: 4000 } },
      deye,
    );
    expect(result.mismatched).toEqual([{ key: "total_energy", expected: 4000, actual: undefined }]);
    expect(result.missingRegisters.find((m) => m.key === "total_energy")?.missing).toEqual([535]);
  });

  test("an empty expect asserts nothing and is not a pass", () => {
    const result = replayCapture(capture({ registers: { "10": 51, "11": 1235 } }), tiny());
    expect(result.matched).toEqual([]);
    expect(result.expectationCount).toBe(0);
    expect(result.ok).toBe(false);
  });

  test("empty registers: every declared metric is missing and nothing decodes", () => {
    const result = replayCapture(capture({}), tiny());
    expect(result.missingRegisters.map((m) => m.key).sort()).toEqual([
      "battery.soc",
      "battery.temperature",
    ]);
    expect(result.ok).toBe(false);
  });

  test("a capture naming a profile that is not installed is an error", () => {
    const result = replayCapture({ profile: "ghost-9000", registers: {}, expect: {} });
    expect(result.ok).toBe(false);
    expect(result.unknownProfile).toBe("ghost-9000");
    expect(result.profileId).toBeUndefined();
  });

  test("resolves an installed profile from the registry when none is passed", () => {
    registerProfile(tiny());
    const result = replayCapture(
      capture({ registers: { "10": 51, "11": 1235 }, expect: { "battery.soc": 51 } }),
    );
    expect(result.unknownProfile).toBeUndefined();
    expect(result.profileId).toBe("tiny");
    expect(result.ok).toBe(true);
  });

  test("a profile whose id disagrees with the capture is an error", () => {
    const result = replayCapture(
      { profile: "deye-sg05lp3", registers: { "10": 51 }, expect: {} },
      tiny(),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("deye-sg05lp3");
  });

  // The computed layer is the highest-value thing a golden capture can prove:
  // `sumOf`/`combine` metrics have no addresses of their own, so a register edit
  // that quietly breaks a referenced key produces a wrong *derived* number with
  // every raw metric still decoding fine. Without a capture that expects a
  // computed key, deleting replay's `applyComputed` call changes nothing and the
  // suite stays green — verified, which is why these exist.
  test("a computed sum metric is replayed from its inputs' registers", () => {
    // dc.total_power has addresses: [] and computeExpr { sum: [dc.pv1.power, dc.pv2.power] }
    const result = replayCapture(
      {
        profile: "deye-sg05lp3",
        registers: { "672": 1200, "673": 800 },
        expect: { "dc.pv1.power": 1200, "dc.pv2.power": 800, "dc.total_power": 2000 },
      },
      deye,
    );
    expect(result.mismatched).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("a wrong computed total is reported even when every input decodes correctly", () => {
    const result = replayCapture(
      {
        profile: "deye-sg05lp3",
        registers: { "672": 1200, "673": 800 },
        expect: { "dc.total_power": 1999 },
      },
      deye,
    );
    expect(result.ok).toBe(false);
    expect(result.mismatched).toHaveLength(1);
    expect(result.mismatched[0]).toMatchObject({
      key: "dc.total_power",
      expected: 1999,
      actual: 2000,
    });
  });

  test("a computed metric whose input register is absent does not silently become the partial sum", () => {
    // Only pv1 answered. #63 made an absent register decode to undefined rather
    // than 0, so the sum must not quietly report 1200 as if pv2 were off.
    const result = replayCapture(
      {
        profile: "deye-sg05lp3",
        registers: { "672": 1200 },
        expect: { "dc.total_power": 2000 },
      },
      deye,
    );
    expect(result.ok).toBe(false);
    expect(result.mismatched.map((m) => m.key)).toContain("dc.total_power");
  });

  test("a malformed capture is rejected with a readable error", () => {
    expect(() => replayCapture({ registers: {} } as unknown as Capture, tiny())).toThrow();
    expect(() =>
      replayCapture(
        { profile: "tiny", registers: { "10": "51" }, expect: {} } as unknown as Capture,
        tiny(),
      ),
    ).toThrow();
  });
});

afterEach(() => {
  unregisterProfile("tiny");
});
