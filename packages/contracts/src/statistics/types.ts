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
 * What the `statistics` topic publishes. Exported so the web app can type its socket
 * against the server's own union rather than restating it.
 */
export type StatisticsLiveMessage =
  | StatisticsTodayMessage
  /** A price sync stored fresh slots: everything price-derived is now stale. */
  | { type: "prices" };

/** A prerequisite of seasonal weighting that is not configured. */
export type SeasonalGap = "weather" | "location" | "arrays";

/**
 * Response of `GET /api/statistics/amortisation`: what the plant has saved over
 * its whole life against what it cost, and when it pays for itself.
 *
 * Savings are priced from the device's LIFETIME `*.total` counters at the
 * current flat rates — the plant usually predates its recording, so the
 * hour-banded history cannot reach back to commissioning; the counters can.
 */
export interface AmortisationResponse {
  currency: string;
  /** False until a total cost is configured; the tiles then show a call to set it. */
  configured: boolean;
  investment: {
    totalCost: number;
    /** Commissioning day (`YYYY-MM-DD`), null when unknown. */
    commissionedOn: string | null;
  };
  /**
   * The day the savings run from (ISO): the commissioning day when set, else
   * the first day of recorded history, else null when neither is known.
   */
  since: string | null;
  /** Whole days from `since` to now, 0 when `since` is null. */
  elapsedDays: number;
  /** Lifetime counters as the device reports them; 0 for a role the profile lacks. */
  lifetime: {
    importKwh: number;
    exportKwh: number;
    productionKwh: number;
    loadKwh: number;
    /** Solar the house used instead of buying: load − import (or production − export unmetered). */
    selfConsumedKwh: number;
  };
  /** Per-kWh rates the lifetime figures were priced at. */
  rates: { importPrice: number; exportPrice: number };
  /** selfConsumedKwh × importPrice. */
  importSavings: number;
  /** exportKwh × exportPrice. */
  exportEarnings: number;
  /** importSavings + exportEarnings. */
  savings: number;
  /** savings / totalCost, clamped 0..1; null when not configured. */
  progress: number | null;
  /** totalCost − savings, floored at 0; null when not configured. */
  remaining: number | null;
  /**
   * Elapsed time since `since`, in years. `solar` weighting measures it in
   * solar years — each day worth the share of a clear-sky year this roof would
   * collect on it — so a plant that has only seen a summer is not annualised
   * as if the summer were the whole year. `calendar` is days / 365.25, used
   * when the plant has no location or arrays to weight by. 0 when `since` is null.
   */
  elapsedYears: number;
  weighting: "solar" | "calendar";
  /**
   * What keeps the weighting on the calendar, so the page can say what to
   * configure: the weather integration switched off, no plant location, no
   * PV arrays on any active inverter. Empty under `solar`.
   */
  seasonalGaps: SeasonalGap[];
  /** savings / elapsedYears; null before a full day has passed. */
  annualRate: number | null;
  /** True once savings have reached the total cost. */
  paidOff: boolean;
  /** Projected day the plant pays for itself (ISO); null when unknowable. */
  paybackDate: string | null;
  /** Years from `since` to `paybackDate`; null when unknowable. */
  paybackYears: number | null;
}
