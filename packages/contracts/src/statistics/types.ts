/**
 * Statistics page wire shapes shared by the server and the web app.
 *
 * These are the definition site: the server's `statistics/` modules import
 * them back, and the web statistics views import them from
 * `@SunReye/contracts/statistics`. Type-only — no runtime tail (see AGENTS.md).
 */

import type { CostBreakdown, EnergyField, PeriodEnergy } from "../energy/types";

/** How the comparison endpoint picks its reference window. */
export type CompareMode = "previous" | "yearAgo";

/**
 * One hour×weekday heatmap cell: kWh per energy field summed over every
 * occurrence of this local (hour-of-day, ISO weekday) slot in the window.
 * The kWh keys are derived from {@link EnergyField} (`importKwh`,
 * `exportKwh`, …) so a new field in the cost engine's ENERGY_FIELDS flows
 * into the cell shape automatically.
 */
export type HeatmapCell = {
  /** Local hour-of-day 0–23. */
  hod: number;
  /** Local ISO weekday 1 (Mon) – 7 (Sun). */
  dow: number;
  /** How many times this (hod, dow) slot occurs in the window — the client
   *  divides the kWh sums by this to render averages. */
  occurrences: number;
} & { [F in EnergyField as `${F}Kwh`]: number };

/** One all-time record: the local day (`YYYY-MM-DD`) and its value. */
export interface DayRecord {
  date: string;
  value: number;
}

/** All-time per-day energy records. `since` = first day with rollup data. */
export interface EnergyRecords {
  since: string;
  maxProductionDay: DayRecord | null;
  maxExportDay: DayRecord | null;
  maxLoadDay: DayRecord | null;
  maxImportDay: DayRecord | null;
  bestSelfSufficiencyDay: DayRecord | null;
  worstSelfSufficiencyDay: DayRecord | null;
}

/** All-time per-day money records. `since` is clamped to the hourly-rollup
 *  horizon (band-accurate pricing needs hourly data), so it can start later
 *  than the energy records' `since`. */
export interface MoneyRecords {
  since: string;
  currency: string;
  cheapestDay: DayRecord | null;
  mostExpensiveDay: DayRecord | null;
  bestEarningsDay: DayRecord | null;
}

/** Response of `GET /api/statistics/comparison`. */
export interface ComparisonResponse {
  mode: CompareMode;
  current: CostBreakdown;
  previous: CostBreakdown;
  coverage: {
    /** Earliest daily-rollup bucket for this inverter (ISO), null with no data
     *  at all — lets the UI suppress fake deltas when the reference window
     *  predates the recorded history. */
    dataFrom: string | null;
  };
}

/** Response of `GET /api/statistics/records` — null when there is no complete
 *  day of history yet. */
export interface RecordsResponse {
  energy: EnergyRecords | null;
  money: MoneyRecords | null;
}

/** Today's cost + energy picture, pushed on every tick of the live stream. */
export interface StatisticsTodayMessage {
  type: "today";
  /** When the snapshot was taken (ISO) — the client's freshness indicator. */
  at: string;
  cost: CostBreakdown;
  energy: PeriodEnergy;
}

/**
 * What `/ws/statistics` publishes. Exported so the web app can type its socket
 * against the server's own union rather than restating it.
 */
export type StatisticsLiveMessage =
  | StatisticsTodayMessage
  /** A price sync stored fresh slots: everything price-derived is now stale. */
  | { type: "prices" };
