import { afterAll, describe, expect, mock, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// maintenance.ts imports the DB singleton, which eagerly validates server env.
// Stubbed so the reset can actually RUN here — the assertions below are about
// what it executes and in what order, and neither is visible from the constants.
//
// The spread is load-bearing: `mock.module` is process-global and permanent, so
// a mock returning only what this suite needs deletes the rest for every file
// that runs after it. And the spread alone is not enough — `afterAll` hands the
// real exports back, or the suite that unit-tests this module would assert
// against the double.
const realDb = await import("@SunReye/db");
const realDbExports = { ...realDb };

const executed: string[] = [];
const dialect = new PgDialect();

mock.module("@SunReye/db", () => ({
  ...realDb,
  db: {
    execute: (statement: SQL) => {
      executed.push(dialect.sqlToQuery(statement).sql);
      return Promise.resolve({ rows: [] });
    },
  },
}));

afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
});

const { DERIVED_TABLES, RESET_DATA_CONFIRM, resetTimeseries } = await import("./maintenance");

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

/**
 * What the reset actually executes.
 *
 * The scope assertions above read the CONSTANTS, which is a different question
 * from whether the function truncates anything — they pass just as well against
 * a reset that runs no statements at all. This runs it.
 */
describe("resetTimeseries", () => {
  test("truncates the raw table first, then every rollup and derived table", async () => {
    executed.length = 0;

    const { cleared } = await resetTimeseries();

    // Raw FIRST and explicitly: a continuous aggregate does not cascade from a
    // raw TRUNCATE, so each rollup is cleared on its own. Dropping the raw
    // chunks while leaving a materialized bucket behind is how a "reset"
    // instance comes back still showing yesterday.
    expect(executed[0]).toContain("metrics_raw");
    expect(executed).toHaveLength(1 + 3 + DERIVED_TABLES.length);
    for (const statement of executed) expect(statement).toContain("TRUNCATE");

    for (const table of DERIVED_TABLES) {
      expect(executed.some((statement) => statement.includes(table))).toBe(true);
    }

    // The report is what the route hands back, so it has to describe what ran
    // rather than what was intended.
    expect(cleared[0]).toBe("metrics_raw");
    expect(cleared).toHaveLength(executed.length);
  });
});
