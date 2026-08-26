import { describe, expect, test } from "bun:test";
import { DERIVED_TABLES, RESET_DATA_CONFIRM } from "./maintenance";

/**
 * The reset clears the measurements and everything LEARNED from them. A table
 * that survives the reset keeps referring to history that no longer exists —
 * a forecast correction trained on deleted days, an SOH baseline measured
 * against a pack-year the database can no longer show.
 */
describe("resetTimeseries scope", () => {
  test("clears every table derived from the time-series", () => {
    expect([...DERIVED_TABLES]).toEqual([
      "forecast_correction_cells",
      "forecast_correction_state",
      "battery_capacity_estimates",
    ]);
  });

  test("names nothing that is configuration rather than measurement", () => {
    // Accounts, settings, tariff, profiles and API keys survive a data reset —
    // the user asked to drop what was recorded, not to reinstall the app.
    for (const table of DERIVED_TABLES) {
      expect(table).not.toMatch(/settings|account|user|apikey|session|profile|tariff/);
    }
  });

  test("the confirmation phrase is exact, so it cannot be typed by accident", () => {
    expect(RESET_DATA_CONFIRM).toBe("DELETE ALL DATA");
  });
});
