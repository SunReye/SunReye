/**
 * Statistics page DB-bound orchestration: reads the bounded counter-delta
 * matrix ({@link ./cost}) and hands the pure folds in
 * {@link ./statistics-calc} their inputs. Route wiring lives in
 * {@link ./routes/statistics}.
 */

import type { InverterProfile } from "@SunReye/inverter-core";
import { ENERGY_FIELDS, type EnergyField, fetchCounterDeltaMatrix } from "./cost";
import { type HeatmapCell, heatmapCells, hodDowOccurrences } from "./statistics-calc";

export type { HeatmapCell } from "./statistics-calc";

const DAY_MS = 86_400_000;

/** `hourly_rollups` retention horizon (days) — hourly-sourced windows clamp
 *  to it so a wider request degrades to the covered range instead of showing
 *  silently-empty cells. */
const HOURLY_RETENTION_DAYS = 730;

/** `from` clamped to the hourly-rollup retention horizon. */
function clampToHourlyRetention(from: Date, now: Date = new Date()): Date {
  const min = new Date(now.getTime() - HOURLY_RETENTION_DAYS * DAY_MS);
  return from < min ? min : from;
}

/** Every energy field the cost engine knows, as a runtime list — cells carry
 *  all of them (zero-filled) even when the profile maps only a subset, so the
 *  client can switch metric without refetching. */
const ALL_ENERGY_FIELDS = Object.keys(ENERGY_FIELDS) as EnergyField[];

/**
 * Hour×weekday energy heatmap over `[from, to)` (clamped to the hourly
 * retention horizon): ≤168 cells, each summing the window's kWh per energy
 * field for one local (hour-of-day, ISO weekday) slot, plus the calendar
 * occurrence count the client averages by. The matrix is read at month
 * periods purely to bound the row count — the fold ignores the period.
 */
export async function computeHeatmap(
  profile: InverterProfile,
  opts: { from: Date; to: Date; inverterId?: string },
): Promise<HeatmapCell[]> {
  const from = clampToHourlyRetention(opts.from);
  const { rows, fieldByKey } = await fetchCounterDeltaMatrix(profile, {
    from,
    to: opts.to,
    bucket: "month",
    inverterId: opts.inverterId,
    view: "hourly_rollups",
  });
  return heatmapCells(rows, fieldByKey, ALL_ENERGY_FIELDS, hodDowOccurrences(from, opts.to));
}
