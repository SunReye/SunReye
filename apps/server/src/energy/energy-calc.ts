/**
 * Pure energy arithmetic — no database, no inverter. Derives, for one period's
 * summed energy flows, the grid-vs-solar consumption split and the
 * self-consumed-vs-exported production split (plus the self-sufficiency and
 * self-consumption ratios those splits represent). DB-free so it can be
 * unit-tested in isolation (see energy-calc.test.ts); the DB-bound, per-period
 * grouping lives in energy.ts.
 *
 * The self-sufficiency / self-consumption formulas mirror {@link ./cost-calc}
 * exactly so the Costs page tiles and the energy-split chart agree.
 */

import type { EnergyTotals, PeriodEnergy } from "@SunReye/contracts/energy";

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Overlay live current-day energy on a period's `*.total`-delta totals: every
 * field present in `today` replaces the delta-derived value, while fields absent
 * from `today` keep it. Pure — returns a fresh object and never mutates either
 * input. Lets the in-progress day be sourced from the live `*.today` registers
 * (which lead the coarse cross-bucket counter delta) while older, complete
 * periods keep the `*.total` delta as their source of truth. A field carrying an
 * explicit `0` in `today` still overrides — only `undefined` (absent) is skipped.
 */
export function applyTodayOverride(
  totals: EnergyTotals,
  today: Partial<EnergyTotals>,
): EnergyTotals {
  return {
    importKwh: today.importKwh ?? totals.importKwh,
    exportKwh: today.exportKwh ?? totals.exportKwh,
    loadKwh: today.loadKwh ?? totals.loadKwh,
    productionKwh: today.productionKwh ?? totals.productionKwh,
    batteryDischargeKwh: today.batteryDischargeKwh ?? totals.batteryDischargeKwh,
    batteryChargeKwh: today.batteryChargeKwh ?? totals.batteryChargeKwh,
  };
}

/** The kWh fields of {@link EnergyTotals}, for whole-record arithmetic. */
const TOTALS_FIELDS = [
  "importKwh",
  "exportKwh",
  "loadKwh",
  "productionKwh",
  "batteryDischargeKwh",
  "batteryChargeKwh",
] as const satisfies ReadonlyArray<keyof EnergyTotals>;

/** An all-zero {@link EnergyTotals}, the identity for summing. */
export function emptyTotals(): EnergyTotals {
  return {
    importKwh: 0,
    exportKwh: 0,
    loadKwh: 0,
    productionKwh: 0,
    batteryDischargeKwh: 0,
    batteryChargeKwh: 0,
  };
}

/**
 * Swap the in-progress day's contribution to a WIDER window for the live
 * `*.today` registers: `window − deltaToday + today`, per field, clamped ≥0.
 *
 * {@link applyTodayOverride} is the whole-period case — it replaces a bucket
 * that IS today. A month-to-date window instead *contains* today, so its total
 * has to keep the earlier days and exchange only today's slice; overriding the
 * lot would throw the month away, and leaving it alone makes the month report
 * less than the day inside it. Fields absent from `today` are left untouched,
 * and an explicit `0` still counts as a reading.
 */
export function replaceTodaySlice(
  window: EnergyTotals,
  deltaToday: EnergyTotals,
  today: Partial<EnergyTotals>,
): EnergyTotals {
  const out = { ...window };
  for (const field of TOTALS_FIELDS) {
    const live = today[field];
    if (live !== undefined) out[field] = Math.max(0, window[field] - deltaToday[field] + live);
  }
  return out;
}

/**
 * The day-period keys to actually plot: everything up to and including today.
 * The month window zero-fills to the first of next month, and those future days
 * were the landing spot the live today-override leaked onto across a
 * server/browser/inverter midnight mismatch (issue #52). A future day has no
 * energy and no place on the chart, so it is dropped.
 *
 * `periods` and `todayKey` are `YYYY-MM-DD` keys cut in the same plant zone, so
 * a lexical `<=` is chronological.
 */
export function visibleDayPeriods(periods: string[], todayKey: string): string[] {
  return periods.filter((p) => p <= todayKey);
}

/** Derive the display splits and ratios for one period's summed energy. */
export function derivePeriodEnergy(bucket: string, totals: EnergyTotals): PeriodEnergy {
  const { importKwh, exportKwh, loadKwh, productionKwh, batteryDischargeKwh, batteryChargeKwh } =
    totals;
  const gridToLoadKwh = Math.min(importKwh, loadKwh);
  const solarToLoadKwh = Math.max(0, loadKwh - importKwh);
  // Subdivide the on-site figure: the battery can only serve up to what was
  // consumed on-site (its raw discharge may also cover charge losses or export),
  // so clamp to solarToLoad; the remainder is direct solar. Guard negatives.
  const batteryToLoadKwh = Math.min(Math.max(0, batteryDischargeKwh), solarToLoadKwh);
  const solarDirectToLoadKwh = Math.max(0, solarToLoadKwh - batteryToLoadKwh);
  const selfConsumedKwh = Math.max(0, productionKwh - exportKwh);
  return {
    bucket,
    importKwh,
    exportKwh,
    loadKwh,
    productionKwh,
    batteryDischargeKwh,
    batteryChargeKwh,
    gridToLoadKwh,
    solarToLoadKwh,
    batteryToLoadKwh,
    solarDirectToLoadKwh,
    selfConsumedKwh,
    exportedKwh: exportKwh,
    selfSufficiency: loadKwh > 0 ? clamp01(solarToLoadKwh / loadKwh) : null,
    selfConsumption: productionKwh > 0 ? clamp01(selfConsumedKwh / productionKwh) : null,
  };
}
