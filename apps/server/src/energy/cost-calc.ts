/**
 * Pure cost arithmetic — no database, no inverter. Prices hourly energy figures
 * against a tariff so it can be unit-tested in isolation (see cost-calc.test.ts).
 * The DB-bound orchestration lives in cost.ts.
 */

import type { CostTotals, EnergyField, HourEnergy } from "@SunReye/contracts/energy";
import { type TariffConfig, importBandForHour, importPriceForHour } from "@SunReye/db/tariff";
// Type-only, so the cost.ts ⇄ cost-calc.ts pairing stays a one-way runtime
// dependency: cost.ts owns the shapes the SQL layer produces, this module owns
// the arithmetic over them.
import type { CostSeriesPoint, CounterDeltaRow } from "./cost";
import { zonedDateKey, zonedFields, zonedIsoWeekday } from "./zoned-time";

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

/** The host process zone — back-compatible default when no plant zone is given. */
const hostTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Price a list of hourly energy figures against a tariff. `rangeDays` prorates
 * the monthly standing charge.
 */
/** Fold one hour into its calendar day's running totals, keyed by `key`. */
function addToDay(
  days: Map<string, CostTotals["byDay"][number]>,
  h: HourEnergy,
  key: string,
  money: { importCost: number; exportEarnings: number },
): void {
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
  tz: string = hostTimeZone(),
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
    // Plant-local wall-clock decides the tariff band and calendar day, so a
    // mis-zoned host no longer bands a Berlin evening as afternoon (issue #46).
    const band = importBandForHour(
      tariff,
      zonedFields(h.time, tz).hour,
      zonedIsoWeekday(h.time, tz),
    );
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

    addToDay(days, h, zonedDateKey(h.time, tz), {
      importCost: hourImportCost,
      exportEarnings: hourEarnings,
    });
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
    solarToLoadKwh: Math.max(0, loadKwh - importKwh),
    selfSufficiency: loadKwh > 0 ? clamp01((loadKwh - importKwh) / loadKwh) : null,
    selfConsumption:
      productionKwh > 0 ? clamp01((productionKwh - exportKwh) / productionKwh) : null,
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byBand: [...bands.values()].sort((a, b) => b.cost - a.cost),
  };
}

/**
 * The local wall-clock hour a delta-matrix row describes: the calendar date of
 * its period key plus the row's hour-of-day. Sound for the hour and day buckets
 * — there `(period, hod)` pins exactly one real hour — but NOT for month, where
 * one hod covers every day of the month. Callers needing a real hour run month
 * windows at day granularity instead (see {@link ./cost}.computeCostSeries).
 */
function hourFromPeriodKey(period: string, hod: number): Date {
  return new Date(
    Number(period.slice(0, 4)),
    Number(period.slice(5, 7)) - 1,
    Number(period.slice(8, 10)),
    hod,
  );
}

const emptySeriesPoint = (bucket: string, standingCharge: number): CostSeriesPoint => ({
  bucket,
  importCost: 0,
  exportEarnings: 0,
  zeroValueExportKwh: 0,
  zeroValueExportEur: 0,
  standingCharge,
  net: standingCharge,
});

/** Fold one export row into its period, splitting off the §51 share that earned
 *  nothing because its quarter-hours cleared below zero. */
function addExportRow(
  point: CostSeriesPoint,
  row: CounterDeltaRow,
  tariff: TariffConfig,
  zeroValueShare?: ZeroValueShare,
): void {
  const kwh = Number(row.kwh);
  const share = clamp01(zeroValueShare?.(hourFromPeriodKey(row.period, Number(row.hod))) ?? 0);
  const lostKwh = kwh * share;
  point.exportEarnings += (kwh - lostKwh) * tariff.export.feedInPerKwh;
  point.zeroValueExportKwh += lostKwh;
  point.zeroValueExportEur += lostKwh * tariff.export.feedInPerKwh;
}

/** Fold one delta row's money into its period point. Only import and export
 *  carry money; load/production rows are the energy series' business. */
function addSeriesRow(
  point: CostSeriesPoint,
  row: CounterDeltaRow,
  field: EnergyField | undefined,
  tariff: TariffConfig,
  zeroValueShare?: ZeroValueShare,
): void {
  if (field === "import") {
    point.importCost +=
      Number(row.kwh) * importPriceForHour(tariff, Number(row.hod), Number(row.dow));
  } else if (field === "export") {
    addExportRow(point, row, tariff, zeroValueShare);
  }
}

/**
 * Price a bounded counter-delta matrix into one point per period: import at its
 * (hour-of-day, weekday) band, export at the feed-in rate less the §51
 * zero-value share, plus the period's prorated standing charge. The pure
 * counterpart of {@link allocateCost} for rows SQL has already grouped; rows
 * for a period outside the zero-filled window (edge rounding) are ignored.
 */
export function priceSeriesRows(
  rows: readonly CounterDeltaRow[],
  fieldByKey: ReadonlyMap<string, EnergyField>,
  periods: readonly string[],
  tariff: TariffConfig,
  standing: ReadonlyMap<string, number>,
  zeroValueShare?: ZeroValueShare,
): CostSeriesPoint[] {
  const byKey = new Map<string, CostSeriesPoint>(
    periods.map((b) => [b, emptySeriesPoint(b, standing.get(b) ?? 0)]),
  );
  for (const r of rows) {
    const point = byKey.get(r.period);
    if (point) addSeriesRow(point, r, fieldByKey.get(r.metric), tariff, zeroValueShare);
  }
  const points = [...byKey.values()];
  for (const p of points) p.net = p.importCost - p.exportEarnings + p.standingCharge;
  return points;
}

/**
 * Sum day points into month points (`YYYY-MM` keys, order preserved). Needed
 * only when §51 forces a month request down to day granularity: the pricing has
 * to happen where a real wall-clock hour exists, so the roll-up happens after.
 */
export function rollUpToMonths(days: readonly CostSeriesPoint[]): CostSeriesPoint[] {
  const byMonth = new Map<string, CostSeriesPoint>();
  for (const d of days) {
    const key = d.bucket.slice(0, 7);
    const point = byMonth.get(key) ?? emptySeriesPoint(key, 0);
    point.importCost += d.importCost;
    point.exportEarnings += d.exportEarnings;
    point.zeroValueExportKwh += d.zeroValueExportKwh;
    point.zeroValueExportEur += d.zeroValueExportEur;
    point.standingCharge += d.standingCharge;
    point.net = point.importCost - point.exportEarnings + point.standingCharge;
    byMonth.set(key, point);
  }
  return [...byMonth.values()];
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
