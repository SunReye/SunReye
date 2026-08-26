import { describe, expect, test } from "bun:test";
import { BATTERY_KEY, batteryConfigSchema, defaultBatteryConfig } from "./battery-config";

/**
 * `readSetting` safe-parses to the default WITHOUT logging, so anything this
 * schema rejects disappears in silence. Every case here is about a stored value
 * degrading to "not stated" rather than taking the record down with it.
 */
describe("batteryConfigSchema", () => {
  test("an instance that never stated a nameplate has none", () => {
    expect(defaultBatteryConfig).toEqual({ nameplateKwh: null });
    expect(batteryConfigSchema.parse({})).toEqual({ nameplateKwh: null });
  });

  test("keeps a stated capacity", () => {
    expect(batteryConfigSchema.parse({ nameplateKwh: 15.36 }).nameplateKwh).toBe(15.36);
  });

  test("degrades a nonsense capacity to 'not stated', never to a number", () => {
    // An SOH computed against 0 is Infinity; against a negative it is negative.
    // Both would render as a confident figure.
    for (const bad of [0, -5, "15", Number.NaN, Number.POSITIVE_INFINITY, 50_000]) {
      expect(batteryConfigSchema.parse({ nameplateKwh: bad }).nameplateKwh).toBeNull();
    }
  });

  test("a bad nameplate does not reset the rest of the record", () => {
    // The whole reason for a flat record with per-field `.catch`: a union, or a
    // catch on the object, would drop every neighbouring field with it.
    const parsed = batteryConfigSchema.parse({ nameplateKwh: -1 });
    expect(parsed).toEqual({ nameplateKwh: null });
  });

  test("the storage key is stable — changing it orphans every stored record", () => {
    expect(BATTERY_KEY).toBe("battery");
  });
});
