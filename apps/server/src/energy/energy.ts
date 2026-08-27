/**
 * Energy-split reporting: reads the counter-delta matrix over a window and
 * summarizes each period into the grid-vs-solar and self-consumed-vs-exported
 * splits used by the Costs page energy chart. Pure math lives in
 * {@link ./energy-calc}; the bounded delta read is shared with the cost engine
 * ({@link ./cost}).
 */

import type { EnergyField, EnergyTotals, PeriodEnergy } from "@SunReye/contracts/energy";
import type { InverterProfile } from "@SunReye/inverter-core";
import {
  type CostBucket,
  type CounterDeltaRow,
  TOTALS_KEY_BY_FIELD,
  currentPeriodKey,
  fetchCounterDeltaMatrix,
  liveTodayTotals,
  metersLoadEnergy,
} from "./cost";
import { applyTodayOverride, derivePeriodEnergy, emptyTotals } from "./energy-calc";
import { getPlantTimeZone } from "../settings/display-settings";

export { emptyTotals } from "./energy-calc";

/** Sum the delta-matrix rows into per-period {@link EnergyTotals}, zero-filled
 *  across `periods` so every bucket on the chart x-axis has an entry. */
export function accumulateTotals(
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
  tz: string,
): void {
  const now = new Date();
  const liveToday = liveTodayTotals(profile, inverterId, now);
  // The key is cut in the SAME plant zone the matrix bucketed in, so the live
  // registers land on the in-progress day's bar — not, across a server/browser
  // midnight mismatch, on a future one (issues #46, #52).
  const key = currentPeriodKey("day", now, tz);
  const base = totals.get(key);
  if (base) totals.set(key, applyTodayOverride(base, liveToday));
}

/**
 * Derive every period's splits, zero-filling the periods with no data.
 *
 * The one place the implied-consumption decision is made, so the energy chart
 * and the statistics records can never disagree about whether a plant's house
 * figure is measured or derived. Applied per period and *after* any live
 * override, so an implied figure is coherent with the flows shown beside it.
 */
export function derivePeriods(
  profile: InverterProfile,
  periods: string[],
  totals: Map<string, EnergyTotals>,
): PeriodEnergy[] {
  const impliedLoad = !metersLoadEnergy(profile);
  return periods.map((p) => derivePeriodEnergy(p, totals.get(p) ?? emptyTotals(), { impliedLoad }));
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
  const tz = await getPlantTimeZone();
  const { rows, fieldByKey, periods } = await fetchCounterDeltaMatrix(profile, {
    ...opts,
    view,
    tz,
  });
  const totals = accumulateTotals(rows, fieldByKey, periods);

  // Current-day override applies to the DAY bucket only. Hour and month buckets
  // are deliberately excluded: a whole-day register can't be attributed to a
  // single hour, and for a whole-month bucket today's portion is negligible and
  // can't be cleanly separated from the month's *.total delta — so those paths
  // stay on the delta method unchanged.
  if (opts.bucket === "day") {
    overrideTodayPeriod(totals, profile, opts.inverterId ?? profile.id, tz);
  }

  // Zero-fill every period in the window, oldest first — including days still to
  // come, so the energy chart shares the exact x-axis extent of the cost series
  // over the same window (both run to the month's end). Future days carry no
  // rollup data, so they derive to all-zero bars. The #52 override-leak stays
  // fixed by overrideTodayPeriod landing the live *.today registers on the
  // plant-tz today key — never a future bar — so no full day lands on tomorrow.
  return derivePeriods(profile, periods, totals);
}
