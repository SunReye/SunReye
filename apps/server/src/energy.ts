/**
 * Energy-split reporting: reads the counter-delta matrix over a window and
 * summarizes each period into the grid-vs-solar and self-consumed-vs-exported
 * splits used by the Costs page energy chart. Pure math lives in
 * {@link ./energy-calc}; the bounded delta read is shared with the cost engine
 * ({@link ./cost}).
 */

import type { InverterProfile } from "@SunReye/inverter-core";
import {
  type CostBucket,
  type CounterDeltaRow,
  type EnergyField,
  TOTALS_KEY_BY_FIELD,
  currentPeriodKey,
  fetchCounterDeltaMatrix,
  liveTodayTotals,
} from "./cost";
import {
  type EnergyTotals,
  type PeriodEnergy,
  applyTodayOverride,
  derivePeriodEnergy,
} from "./energy-calc";

export type { PeriodEnergy } from "./energy-calc";

const emptyTotals = (): EnergyTotals => ({
  importKwh: 0,
  exportKwh: 0,
  loadKwh: 0,
  productionKwh: 0,
  batteryDischargeKwh: 0,
});

/** Sum the delta-matrix rows into per-period {@link EnergyTotals}, zero-filled
 *  across `periods` so every bucket on the chart x-axis has an entry. */
function accumulateTotals(
  rows: CounterDeltaRow[],
  fieldByKey: Map<string, EnergyField>,
  periods: string[],
): Map<string, EnergyTotals> {
  const totals = new Map<string, EnergyTotals>(periods.map((p) => [p, emptyTotals()]));
  for (const r of rows) {
    // A row for a metric this profile doesn't map to an energy field, or one
    // outside the requested periods, contributes nothing.
    const field = fieldByKey.get(r.metric);
    if (field === undefined) continue;
    const t = totals.get(r.period);
    if (t) t[TOTALS_KEY_BY_FIELD[field]] += Number(r.kwh);
  }
  return totals;
}

/**
 * Replace the current in-progress day's totals with the live `*.today`
 * registers, which lead the coarse cross-bucket `*.total` delta, so the chart's
 * today bar matches the dashboard headline. Older, complete periods keep the
 * `*.total` delta as their source of truth. The override lands on the exact key
 * the matrix produced for today (currentPeriodKey reuses periodKey), and no-ops
 * when the live reader supplies nothing ({@link applyTodayOverride} with `{}` is
 * the identity). Caller restricts this to the day bucket — see {@link energySeries}.
 */
function overrideTodayPeriod(
  totals: Map<string, EnergyTotals>,
  profile: InverterProfile,
  inverterId: string,
): void {
  const now = new Date();
  const liveToday = liveTodayTotals(profile, inverterId, now);
  const key = currentPeriodKey("day", now);
  const base = totals.get(key);
  if (base) totals.set(key, applyTodayOverride(base, liveToday));
}

/**
 * Per-period energy splits over `[from, to)`, one entry per `bucket`
 * (hour / day / month), oldest first and zero-filled so the chart x-axis is
 * stable. Sub-daily windows read the hourly rollups; day/month windows read the
 * cheaper daily rollups — the split only needs per-period totals.
 */
export async function energySeries(
  profile: InverterProfile,
  opts: { from: Date; to: Date; bucket: CostBucket; inverterId?: string },
): Promise<PeriodEnergy[]> {
  const view = opts.bucket === "hour" ? "hourly_rollups" : "daily_rollups";
  const { rows, fieldByKey, periods } = await fetchCounterDeltaMatrix(profile, { ...opts, view });
  const totals = accumulateTotals(rows, fieldByKey, periods);

  // Current-day override applies to the DAY bucket only. Hour and month buckets
  // are deliberately excluded: a whole-day register can't be attributed to a
  // single hour, and for a whole-month bucket today's portion is negligible and
  // can't be cleanly separated from the month's *.total delta — so those paths
  // stay on the delta method unchanged.
  if (opts.bucket === "day") {
    overrideTodayPeriod(totals, profile, opts.inverterId ?? profile.id);
  }

  return periods.map((p) => derivePeriodEnergy(p, totals.get(p) ?? emptyTotals()));
}
