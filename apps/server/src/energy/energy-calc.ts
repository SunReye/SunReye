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

import type { EnergyTotals, HourEnergy, PeriodEnergy } from "@SunReye/contracts/energy";

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
 * House consumption implied by the flows around it: everything that entered the
 * house minus everything that left it.
 *
 * For the plants that have no consumption counter at all — a grid-tied inverter
 * reporting production and a meter reporting grid flow, which is most of the
 * non-hybrid market. Without it their `loadKwh` is 0, and every figure derived
 * from it (the consumption split, self-sufficiency, `gridOnlyCost` and so the
 * whole savings tile) reads empty on a plant that consumes plenty.
 *
 * Clamped at zero: a counter restart or a bridged recording gap can leave a
 * bucket exporting more than it produced, and a negative house load is an
 * artefact, not a reading. An all-zero period (every future day on the chart is
 * zero-filled) implies zero, so nothing is invented for a period with no data.
 */
export function impliedLoadKwh(totals: EnergyTotals): number {
  return impliedLoad({
    production: totals.productionKwh,
    import: totals.importKwh,
    batteryDischarge: totals.batteryDischargeKwh,
    export: totals.exportKwh,
    batteryCharge: totals.batteryChargeKwh,
  });
}

/** The one formula, over the flows both shapes carry under different names. */
function impliedLoad(f: Omit<HourEnergy, "time" | "load">): number {
  return Math.max(0, f.production + f.import + f.batteryDischarge - f.export - f.batteryCharge);
}

/**
 * The same totals with `loadKwh` replaced by {@link impliedLoadKwh}. Pure.
 *
 * Unconditional by design: whether a plant's load is implied or measured is a
 * property of its *profile* (does it map a load-energy role at all), never of
 * the value — a metered plant that read 0 kWh must keep its 0 rather than have
 * one computed for it. {@link derivePeriodEnergy}'s caller holds that knowledge
 * and only asks when there is nothing to overwrite.
 */
function withImpliedLoad(totals: EnergyTotals): EnergyTotals {
  return { ...totals, loadKwh: impliedLoadKwh(totals) };
}

/**
 * The same hours with each `load` implied from that hour's own flows — the
 * per-hour twin of {@link withImpliedLoad}, for the cost path.
 *
 * Per hour rather than over the window because `gridOnlyCost` prices
 * consumption at each hour's own tariff band: a single window-wide figure has no
 * band to be priced in. Same clamp, same reason.
 */
export function withImpliedHourLoad(hours: HourEnergy[]): HourEnergy[] {
  return hours.map((h) => ({ ...h, load: impliedLoad(h) }));
}

/**
 * Derive the display splits and ratios for one period's summed energy.
 *
 * `impliedLoad` is for a profile that maps no load-energy counter: the house
 * figure is computed from the surrounding flows before the splits are taken, so
 * every ratio downstream is coherent with it.
 */
export function derivePeriodEnergy(
  bucket: string,
  periodTotals: EnergyTotals,
  opts: { impliedLoad?: boolean } = {},
): PeriodEnergy {
  const totals = opts.impliedLoad ? withImpliedLoad(periodTotals) : periodTotals;
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
