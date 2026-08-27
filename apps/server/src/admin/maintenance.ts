/**
 * Destructive maintenance. Wipes all recorded measurements so the instance can
 * start fresh — clears the raw hypertable, every continuous-aggregate rollup
 * built from it, and the forecast correction learned from that history. Accounts,
 * settings, tariff, profiles, and API keys are left untouched; only time-series
 * (and its derived state) is dropped. There is no undo.
 */

import { db } from "@SunReye/db";
import { sql } from "drizzle-orm";

/**
 * Phrase the caller must echo to authorize {@link resetTimeseries}. Guards the
 * `/api/admin/reset-data` route against accidental or replayed requests; the web
 * Danger Zone shows the same text so the user must type it to arm the button.
 */
export const RESET_DATA_CONFIRM = "DELETE ALL DATA";

/** Continuous aggregates fed from `metrics_raw`, cleared alongside the raw table. */
const ROLLUP_VIEWS = ["minute_rollups", "hourly_rollups", "daily_rollups"] as const;

/** Derived-from-history tables cleared with the measurements they were learned from. */
// fallow-ignore-next-line unused-export -- exported so maintenance.test.ts can assert the membership rule (anything derived from the time-series is cleared with it) without a live database; test files are not traced as consumers.
export const DERIVED_TABLES = [
  "forecast_correction_cells",
  "forecast_correction_state",
  // Capacity estimates are measurements OF the raw series: keeping them across a
  // reset would leave an SOH baseline referring to history that no longer exists.
  "battery_capacity_estimates",
] as const;

export interface ResetResult {
  /** Views + tables that were truncated, in the order they were cleared. */
  cleared: string[];
}

/**
 * Truncate `metrics_raw` and its rollups. Continuous aggregates don't cascade
 * from a raw TRUNCATE, so each is truncated explicitly (TimescaleDB clears the
 * materialized buckets); the real-time union then reads empty until fresh polls
 * arrive. Each statement runs on its own — the pooled connection has no open
 * transaction — so a failure surfaces with the view that caused it.
 */
export async function resetTimeseries(): Promise<ResetResult> {
  const cleared: string[] = [];
  // Raw first: TRUNCATE drops all hypertable chunks in one shot.
  await db.execute(sql`TRUNCATE TABLE metrics_raw`);
  cleared.push("metrics_raw");
  for (const view of ROLLUP_VIEWS) {
    // `view` is a fixed internal literal (not user input) → safe raw identifier.
    await db.execute(sql`TRUNCATE ${sql.raw(view)}`);
    cleared.push(view);
  }
  for (const table of DERIVED_TABLES) {
    await db.execute(sql`TRUNCATE ${sql.raw(table)}`);
    cleared.push(table);
  }
  return { cleared };
}
