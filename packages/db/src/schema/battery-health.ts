import { doublePrecision, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Measured battery capacity, one row per discharge segment.
 *
 * Neither supported inverter family reports a capacity, an SOH or a cycle
 * count, so both are inferred from SOC and power (see
 * `apps/server/src/battery/capacity-estimate.ts`). A segment is a stretch where
 * the pack only discharged, deep enough for SOC's 1 % quantisation not to
 * dominate; `capacityKwh` is that segment's own estimate of the pack's
 * full-range energy.
 *
 * Rows, not a running average, for two reasons. The estimator takes a MEDIAN of
 * segments and a median cannot be maintained incrementally. And degradation is
 * the point: keeping every segment means the trend can be re-derived, or the
 * rejection rules changed and the whole history re-scored, without waiting
 * months to re-accumulate it.
 *
 * Not a hypertable. One row per deep discharge is a handful a week — the
 * time-series machinery would cost more than it saves. It IS derived from the
 * time-series, so like the forecast-correction tables it is cleared alongside a
 * data reset.
 */
export const batteryCapacityEstimates = pgTable(
  "battery_capacity_estimates",
  {
    inverterId: text("inverter_id").notNull(),
    /** End of the discharge segment — the key, so a re-run is idempotent. */
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    /** Start of the segment. */
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** SOC at each end, percent. */
    socStart: doublePrecision("soc_start").notNull(),
    socEnd: doublePrecision("soc_end").notNull(),
    /** Energy out over the segment, kWh — the integral of power by held time. */
    energyKwh: doublePrecision("energy_kwh").notNull(),
    /** This segment's estimate of full-range usable energy, kWh. */
    capacityKwh: doublePrecision("capacity_kwh").notNull(),
    /** Duration-weighted mean pack temperature, °C; null when unreported. */
    tempC: doublePrecision("temp_c"),
  },
  (t) => [
    primaryKey({ columns: [t.inverterId, t.measuredAt] }),
    index("battery_capacity_estimates_measured_at_idx").on(t.measuredAt),
  ],
);

export type BatteryCapacityEstimateRow = typeof batteryCapacityEstimates.$inferSelect;
export type BatteryCapacityEstimateInsert = typeof batteryCapacityEstimates.$inferInsert;
