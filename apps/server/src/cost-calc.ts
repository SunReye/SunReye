/**
 * Pure cost arithmetic — no database, no inverter. Prices hourly energy figures
 * against a tariff so it can be unit-tested in isolation (see cost-calc.test.ts).
 * The DB-bound orchestration lives in cost.ts.
 */

import { type TariffConfig, importBandForHour } from "@SunReye/db/tariff";

/** Energy (kWh) that flowed in one hour, plus the hour's local wall time. */
export interface HourEnergy {
  time: Date;
  import: number;
  export: number;
  load: number;
  production: number;
  /** Battery discharge counter delta — carried for the energy split only; NOT
   *  priced by {@link allocateCost} (money math never reads it). */
  batteryDischarge: number;
  /** Battery charge counter delta — carried for the energy split only; NOT
   *  priced by {@link allocateCost} (money math never reads it). */
  batteryCharge: number;
}

/**
 * Share of an hour that fell in quarter-hours with a negative day-ahead price,
 * 0–1. Under §51 EEG a plant commissioned after 2025-02-25 is paid nothing for
 * energy exported then, so that share of the hour's export earns no feed-in
 * tariff.
 *
 * Kept beside {@link HourEnergy} rather than inside it: that type is the shape
 * of the plant's *energy counters*, each field mapped to a canonical metric
 * role, and a price fact has no role to map to.
 *
 * Approximate by construction — it assumes export was spread evenly across the
 * hour, because the export counter is only read hourly. Export within a sunny
 * hour is smooth, so the error is second-order against the figure it produces
 * ("you received 0 ct for 3.2 kWh").
 */
export type ZeroValueShare = (hour: Date) => number;

const AVG_DAYS_PER_MONTH = 30.4375;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** ISO weekday (1=Mon … 7=Sun) from a Date's local day. */
const isoWeekday = (d: Date): number => ((d.getDay() + 6) % 7) + 1;

const dateKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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
   * would have earned at the ordinary tariff. Computed here because this is
   * where the rate is known; the client must not have to read the tariff (which
   * is admin-only) just to render the figure.
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
  /** Energy served on-site instead of imported: max(0, load − import), kWh. The
   *  Solar Saving tile renders `selfConsumedKwh × (solarSavings/selfConsumedKwh)`. */
  selfConsumedKwh: number;
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

/**
 * Price a list of hourly energy figures against a tariff. `rangeDays` prorates
 * the monthly standing charge.
 */
/** Fold one hour into its calendar day's running totals. */
function addToDay(
  days: Map<string, CostTotals["byDay"][number]>,
  h: HourEnergy,
  money: { importCost: number; exportEarnings: number },
): void {
  const key = dateKey(h.time);
  const day = days.get(key) ?? {
    date: key,
    importKwh: 0,
    exportKwh: 0,
    importCost: 0,
    exportEarnings: 0,
    net: 0,
  };
  day.importKwh += h.import;
  day.exportKwh += h.export;
  day.importCost += money.importCost;
  day.exportEarnings += money.exportEarnings;
  day.net = day.importCost - day.exportEarnings;
  days.set(key, day);
}

/** Fold one hour's import into its time-of-use band. */
function addToBand(
  bands: Map<string, { name: string; importKwh: number; cost: number }>,
  name: string,
  importKwh: number,
  cost: number,
): void {
  const band = bands.get(name) ?? { name, importKwh: 0, cost: 0 };
  band.importKwh += importKwh;
  band.cost += cost;
  bands.set(name, band);
}

export function allocateCost(
  hours: HourEnergy[],
  tariff: TariffConfig,
  rangeDays: number,
  zeroValueShare?: ZeroValueShare,
): CostTotals {
  let importKwh = 0;
  let exportKwh = 0;
  let loadKwh = 0;
  let productionKwh = 0;
  let batteryDischargeKwh = 0;
  let batteryChargeKwh = 0;
  let importCost = 0;
  let exportEarnings = 0;
  let zeroValueExportKwh = 0;
  let zeroValueExportEur = 0;
  let gridOnlyCost = 0;
  const days = new Map<string, CostTotals["byDay"][number]>();
  const bands = new Map<string, { name: string; importKwh: number; cost: number }>();

  for (const h of hours) {
    const band = importBandForHour(tariff, h.time.getHours(), isoWeekday(h.time));
    const price = band?.pricePerKwh ?? tariff.import.defaultPricePerKwh;
    const bandName = band?.name ?? "Standard";
    const hourImportCost = h.import * price;
    // §51: the negative-price share of the hour earns nothing.
    const paidShare = 1 - clamp01(zeroValueShare?.(h.time) ?? 0);
    const hourEarnings = h.export * tariff.export.feedInPerKwh * paidShare;
    const lostKwh = h.export * (1 - paidShare);
    zeroValueExportKwh += lostKwh;
    zeroValueExportEur += lostKwh * tariff.export.feedInPerKwh;

    importKwh += h.import;
    exportKwh += h.export;
    loadKwh += h.load;
    productionKwh += h.production;
    batteryDischargeKwh += h.batteryDischarge;
    batteryChargeKwh += h.batteryCharge;
    importCost += hourImportCost;
    exportEarnings += hourEarnings;
    gridOnlyCost += h.load * price;

    addToDay(days, h, { importCost: hourImportCost, exportEarnings: hourEarnings });
    addToBand(bands, bandName, h.import, hourImportCost);
  }

  const standingCharge = (tariff.standingChargeMonthly * rangeDays) / AVG_DAYS_PER_MONTH;
  return {
    importKwh,
    exportKwh,
    loadKwh,
    productionKwh,
    batteryDischargeKwh,
    batteryChargeKwh,
    importCost,
    exportEarnings,
    zeroValueExportKwh,
    zeroValueExportEur,
    standingCharge,
    net: importCost - exportEarnings + standingCharge,
    gridOnlyCost,
    savings: gridOnlyCost - importCost + exportEarnings,
    solarSavings: gridOnlyCost - importCost,
    selfConsumedKwh: Math.max(0, loadKwh - importKwh),
    selfSufficiency: loadKwh > 0 ? clamp01((loadKwh - importKwh) / loadKwh) : null,
    selfConsumption:
      productionKwh > 0 ? clamp01((productionKwh - exportKwh) / productionKwh) : null,
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byBand: [...bands.values()].sort((a, b) => b.cost - a.cost),
  };
}

/**
 * Named reporting ranges, resolved to [from, now) in local time. Named with the
 * `Key` suffix to stay distinct from the web app's `CostRange` window object,
 * which the Costs page type-imports from this module's neighbours.
 */
export type CostRangeKey = "today" | "month" | "year";

export function resolveRange(range: CostRangeKey, now = new Date()): { from: Date; to: Date } {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  if (range === "month") from.setDate(1);
  if (range === "year") from.setMonth(0, 1);
  return { from, to: now };
}
