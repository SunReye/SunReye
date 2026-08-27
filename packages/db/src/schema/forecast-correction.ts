import { doublePrecision, integer, pgTable, primaryKey, smallint, text } from "drizzle-orm/pg-core";

import { devices } from "./plants";

import { updatedAtTz } from "./columns";

/**
 * Learned PV-forecast correction ("site adaptation" / Model Output Statistics).
 *
 * The physics forecast in the server's `solar-forecast` can't see site-specific
 * systematic bias (horizon shading, soiling, snow, degradation, a wrong
 * `systemLoss`). This bias is *repeatable*, so it is learned as a multiplicative
 * grid: for each `(month, hour-of-day)` cell, an exponentially-weighted mean of
 * `actual / model-expected-given-true-weather`. Feeding *reanalysis* irradiance
 * through the same PV model strips out provider weather error (cloud misses,
 * irreducible), leaving only the correctable site residual.
 *
 * Both tables are plain relational tables (not hypertables / continuous
 * aggregates) — the grid is tiny (~12 × daylight-hours per device) and derived
 * from the time-series, so it is cleared alongside the raw data on a data reset.
 *
 * Keyed by `device_id` since 2.0.0, where `inverter_id` was part of the PRIMARY
 * KEY. A learned correction grid is about one physical array behind one device —
 * its shading, its soiling, its degradation — so keying it by the profile id
 * blended two arrays into one grid and reset it on a profile swap.
 */

/**
 * One correction cell per `(device, month, hour)`. `ratio` is the EWMA of
 * `actual / expected`; `weight` is the effective sample count that drives
 * shrinkage toward 1.0 for sparsely-observed cells.
 */
export const forecastCorrectionCells = pgTable(
  "forecast_correction_cells",
  {
    deviceId: smallint("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    /** Calendar month in the plant's local time, 1–12. */
    month: integer("month").notNull(),
    /** Hour of day in the plant's local time, 0–23. */
    hour: integer("hour").notNull(),
    /** EWMA of observed `actual / expected` for this cell. */
    ratio: doublePrecision("ratio").notNull(),
    /** Effective sample count (decays with the EWMA) — drives shrinkage. */
    weight: doublePrecision("weight").notNull(),
    updatedAt: updatedAtTz(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.month, t.hour] })],
);

export type ForecastCorrectionCellRow = typeof forecastCorrectionCells.$inferSelect;
export type ForecastCorrectionCellInsert = typeof forecastCorrectionCells.$inferInsert;

/**
 * Per-device learn cursor + rolling skill stats. `learnedThrough` is the last
 * local calendar day folded into the grid (the job resumes from the next day);
 * the MAE stats are decayed means of the per-hour absolute error with and
 * without the correction applied, so the UI can show the measured improvement.
 */
export const forecastCorrectionState = pgTable("forecast_correction_state", {
  deviceId: smallint("device_id")
    .primaryKey()
    .references(() => devices.id, { onDelete: "restrict" }),
  /** Last local day folded into the grid (`YYYY-MM-DD`); null before first run. */
  learnedThrough: text("learned_through"),
  /** Decayed mean |expected − actual|, W (no correction). */
  maeRaw: doublePrecision("mae_raw").notNull().default(0),
  /** Decayed mean |expected·factor − actual|, W (with correction). */
  maeCorrected: doublePrecision("mae_corrected").notNull().default(0),
  /** Effective sample count behind the skill stats. */
  samples: doublePrecision("samples").notNull().default(0),
  updatedAt: updatedAtTz(),
});

export type ForecastCorrectionStateRow = typeof forecastCorrectionState.$inferSelect;
export type ForecastCorrectionStateInsert = typeof forecastCorrectionState.$inferInsert;
