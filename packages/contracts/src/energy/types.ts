/**
 * Energy & cost wire shapes shared by the server and the web app.
 *
 * These are the definition site: the server's `energy/` modules import them
 * back, and the web statistics/costs views import them from
 * `@SunReye/contracts/energy`. Type-only — no runtime tail (see AGENTS.md).
 */

/** Energy (kWh) that flowed in one hour, plus the hour's local wall time. */
export interface HourEnergy {
  time: Date;
  import: number;
  export: number;
  load: number;
  production: number;
  /** Battery discharge counter delta — carried for the energy split only; NOT
   *  priced by `allocateCost` (money math never reads it). */
  batteryDischarge: number;
  /** Battery charge counter delta — carried for the energy split only; NOT
   *  priced by `allocateCost` (money math never reads it). */
  batteryCharge: number;
}

/** The priced/split energy fields of {@link HourEnergy} (every field but `time`). */
export type EnergyField = keyof Omit<HourEnergy, "time">;

/** Energy flows summed over one period, before the display splits are derived. */
export interface EnergyTotals {
  importKwh: number;
  exportKwh: number;
  loadKwh: number;
  productionKwh: number;
  /** Battery discharge counter delta — raw energy the battery sent out (to load,
   *  charge losses, or export). Subdivides the on-site consumption figure into a
   *  battery slice; 0 when the profile maps no battery-discharge role. */
  batteryDischargeKwh: number;
  /** Battery charge counter delta — raw energy the battery took in (from solar
   *  or grid). Pass-through figure for battery reporting; no display split reads
   *  it; 0 when the profile maps no battery-charge role. */
  batteryChargeKwh: number;
}

/** One period of energy flows, split for stacked-bar display. */
export interface PeriodEnergy extends EnergyTotals {
  /** Local period key: `YYYY-MM-DDTHH` (hour) | `YYYY-MM-DD` (day) | `YYYY-MM` (month). */
  bucket: string;
  /** Consumption served by the grid: min(import, load) → "from grid". */
  gridToLoadKwh: number;
  /** Consumption served on-site: max(0, load − import) → "from solar+battery"
   *  (combined). Subdivided by {@link batteryToLoadKwh} + {@link solarDirectToLoadKwh},
   *  which sum back to this figure. */
  solarToLoadKwh: number;
  /** On-site consumption served from the battery: min(batteryDischarge,
   *  solarToLoad) → "from battery". Clamped so it never exceeds the on-site
   *  figure; 0 when no battery-discharge data. */
  batteryToLoadKwh: number;
  /** On-site consumption served directly from solar: max(0, solarToLoad −
   *  batteryToLoad) → "from solar". Equals the full on-site figure when there is
   *  no battery-discharge data. */
  solarDirectToLoadKwh: number;
  /** Production used on-site: max(0, production − export) → "used on-site". */
  selfConsumedKwh: number;
  /** Production sent to the grid: export → "exported". */
  exportedKwh: number;
  /** solarToLoad / load, 0..1, or null when no load data. */
  selfSufficiency: number | null;
  /** selfConsumed / production, 0..1, or null when no production. */
  selfConsumption: number | null;
}

export interface CostTotals {
  importKwh: number;
  exportKwh: number;
  loadKwh: number;
  productionKwh: number;
  /** Battery discharge summed over the window — energy figure only, never
   *  priced (money math ignores it); 0 when no battery-discharge role. */
  batteryDischargeKwh: number;
  /** Battery charge summed over the window — energy figure only, never
   *  priced (money math ignores it); 0 when no battery-charge role. */
  batteryChargeKwh: number;
  importCost: number;
  exportEarnings: number;
  /**
   * Exported energy that earned nothing because its quarter-hour cleared at a
   * negative day-ahead price (§51 EEG). Zero unless the tariff is in spot mode
   * with the `eegFeedIn` marketing model.
   */
  zeroValueExportKwh: number;
  /**
   * Feed-in revenue forgone on {@link zeroValueExportKwh} — what that energy
   * would have earned at the ordinary tariff. Computed on the server because
   * that is where the rate is known; the client must not have to read the tariff
   * (which is admin-only) just to render the figure.
   */
  zeroValueExportEur: number;
  standingCharge: number;
  /** importCost − exportEarnings + standingCharge. */
  net: number;
  /** What all consumed energy would have cost bought from the grid. */
  gridOnlyCost: number;
  /** gridOnlyCost − importCost + exportEarnings. */
  savings: number;
  /** Value of self-consumed solar/battery: (load − import) priced at the grid
   *  rate = gridOnlyCost − importCost. Every kWh served on-site instead of bought
   *  is worth the grid price; excludes export feed-in (that is separate income). */
  solarSavings: number;
  /**
   * Energy served on-site instead of imported: max(0, load − import), kWh — the
   * purchase solar and the battery avoided, which is what `solarSavings` values.
   * NOT self-consumption: that is production − export (see `selfConsumption`),
   * and on a battery system the two are different numbers.
   */
  solarToLoadKwh: number;
  /** (load − import) / load, 0..1, or null when no load data. */
  selfSufficiency: number | null;
  /** (production − export) / production, 0..1, or null when no production. */
  selfConsumption: number | null;
  byDay: Array<{
    date: string;
    importKwh: number;
    exportKwh: number;
    importCost: number;
    exportEarnings: number;
    net: number;
  }>;
  byBand: Array<{ name: string; importKwh: number; cost: number }>;
}

export interface CostBreakdown extends CostTotals {
  currency: string;
  from: string;
  to: string;
}

/** One measured capacity estimate — a point on the degradation series. */
export interface BatteryCapacityPoint {
  /** ISO instant the discharge segment ended. */
  measuredAt: string;
  /** That segment's estimate of full-range usable energy, kWh. */
  capacityKwh: number;
  /** Duration-weighted mean pack temperature, °C; null when unreported. */
  tempC: number | null;
}

/** A capacity figure and how much the segments behind it disagreed. */
export interface BatteryCapacity {
  kwh: number;
  /** 10th and 90th percentile of the per-segment estimates. */
  low: number;
  high: number;
  /** How many discharge segments the median was taken over. */
  segments: number;
}

/**
 * Measured battery capacity and state of health.
 *
 * Every field is nullable because measuring is conditional: a plant needs
 * several deep discharges before any of it exists, and SOH additionally needs a
 * reference. Null means "not measured yet", never "healthy".
 */
export interface BatteryHealth {
  /** Capacity over the recent window; null before enough segments. */
  capacity: BatteryCapacity | null;
  /** Capacity over this install's earliest segments — the SOH fallback. */
  baseline: BatteryCapacity | null;
  health: {
    /** capacity / reference. Uncapped: a pack above nameplate is a real answer. */
    ratio: number;
    /** What the ratio was measured against. */
    reference: "nameplate" | "baseline";
    referenceKwh: number;
  } | null;
  /** Every stored estimate, oldest first. */
  trend: BatteryCapacityPoint[];
}
