/**
 * The energy a window holds, summed from the core's energy series.
 *
 * The statistics tiles read a `CostBreakdown`; the core has no tariff yet (`pricesAndCosts` is not
 * served), so everything money is zero and the sections that read it stay hidden.
 */

import type { CostBreakdown, PeriodEnergy } from "@SunReye/contracts/energy";

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const sum = (periods: PeriodEnergy[], field: keyof PeriodEnergy): number =>
  periods.reduce((total, p) => total + (p[field] as number), 0);

/** `part` over `whole`, null without a whole to divide by. */
const ratio = (part: number, whole: number): number | null =>
  whole > 0 ? clamp01(part / whole) : null;

export function energyBreakdown(
  periods: PeriodEnergy[],
  window: { from: Date; to: Date },
): CostBreakdown {
  const loadKwh = sum(periods, "loadKwh");
  const productionKwh = sum(periods, "productionKwh");
  const solarToLoadKwh = sum(periods, "solarToLoadKwh");
  return {
    importKwh: sum(periods, "importKwh"),
    exportKwh: sum(periods, "exportKwh"),
    loadKwh,
    productionKwh,
    batteryDischargeKwh: sum(periods, "batteryDischargeKwh"),
    batteryChargeKwh: sum(periods, "batteryChargeKwh"),
    solarToLoadKwh,
    selfSufficiency: ratio(solarToLoadKwh, loadKwh),
    selfConsumption: ratio(sum(periods, "selfConsumedKwh"), productionKwh),
    importCost: 0,
    exportEarnings: 0,
    zeroValueExportKwh: 0,
    zeroValueExportEur: 0,
    standingCharge: 0,
    net: 0,
    gridOnlyCost: 0,
    savings: 0,
    solarSavings: 0,
    byDay: [],
    byBand: [],
    currency: "EUR",
    from: window.from.toISOString(),
    to: window.to.toISOString(),
  };
}
