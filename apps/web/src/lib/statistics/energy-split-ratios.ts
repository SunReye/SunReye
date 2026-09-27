/**
 * The two ratios the energy split shows beside its bars, over the whole window.
 * They tie back to the headline tiles, which carry the server's window figures
 * (`cost-calc.ts`: sums first, then one division) — a mean of per-period ratios
 * weighs a 1 kWh night like a 20 kWh day and lands on a different number.
 */

import type { PeriodEnergy } from "@SunReye/contracts/energy";

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** `(Σload − Σimport) / Σload` and `(Σproduction − Σexport) / Σproduction`, null with no denominator. */
export function windowRatios(
  periods: readonly Pick<PeriodEnergy, "loadKwh" | "importKwh" | "productionKwh" | "exportKwh">[],
): {
  selfSufficiency: number | null;
  selfConsumption: number | null;
} {
  let load = 0;
  let imported = 0;
  let production = 0;
  let exported = 0;
  for (const p of periods) {
    load += p.loadKwh;
    imported += p.importKwh;
    production += p.productionKwh;
    exported += p.exportKwh;
  }
  return {
    selfSufficiency: load > 0 ? clamp01((load - imported) / load) : null,
    selfConsumption: production > 0 ? clamp01((production - exported) / production) : null,
  };
}
