import { describe, expect, test } from "bun:test";
import type { InverterProfile } from "@SunReye/inverter-core";
import { batteryKeys } from "./keys";

/**
 * Roles, never key names. A vendor may call its SOC register anything —
 * `bms_soc`, `battery.capacity_pct`, `reg_588` — and the role is the only thing
 * that says what it means. Matching on names would work on the Deye map and
 * silently measure the wrong register on the next one.
 */
const profile = (metrics: Array<{ key: string; role?: string }>): InverterProfile =>
  ({ id: "inv-1", metrics }) as unknown as InverterProfile;

describe("batteryKeys", () => {
  test("resolves each signal by its role, whatever the key is called", () => {
    expect(
      batteryKeys(
        profile([
          { key: "reg_588", role: "battery.soc" },
          { key: "bms_watts", role: "battery.power" },
          { key: "pack_t", role: "battery.temperature" },
        ]),
      ),
    ).toEqual({ soc: "reg_588", power: "bms_watts", temperature: "pack_t" });
  });

  test("treats temperature as optional context", () => {
    const keys = batteryKeys(
      profile([
        { key: "soc", role: "battery.soc" },
        { key: "p", role: "battery.power" },
      ]),
    );
    expect(keys).not.toBeNull();
    expect(keys?.temperature).toBeUndefined();
  });

  test("refuses a profile with no SOC — energy alone measures nothing", () => {
    expect(batteryKeys(profile([{ key: "p", role: "battery.power" }]))).toBeNull();
  });

  test("refuses a profile with no battery power — SOC alone measures nothing", () => {
    expect(batteryKeys(profile([{ key: "soc", role: "battery.soc" }]))).toBeNull();
  });

  test("ignores a metric that merely looks like a battery signal", () => {
    // A key called `battery.soc` with no role is a coincidence, not a contract.
    expect(batteryKeys(profile([{ key: "battery.soc" }, { key: "battery.power" }]))).toBeNull();
  });
});
