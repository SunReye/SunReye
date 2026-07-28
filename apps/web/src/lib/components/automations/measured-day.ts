/**
 * The measured half of the plan section's "Today" view, read from the minute
 * rollups instead of the engine's in-memory decision ring: the ring clears on
 * every server restart and only holds ticks the automation decided, while the
 * hypertable has the whole day regardless.
 *
 * Sign conventions follow the power-flow graph (and the engine's readings):
 * `battery.power` > 0 discharges and `grid.power` > 0 imports, so the charging
 * and exporting halves are the negative sides. The decomposition itself lives
 * in {@link measuredDaySeries} — one implementation for the ring and rollup
 * paths.
 */

import { api } from "$lib/api";
import { inverter } from "$lib/inverter/store.svelte";
import { type PlanRow, measuredDaySeries } from "./plan-series";

export interface MeasuredDay {
  /** Where the PV actually went since local midnight, minute-averaged. */
  power: PlanRow[];
  /** Measured SOC track over the same window. */
  soc: { t: number; socPct: number }[];
}

/** The metric key the profile maps to `role`, or null when it maps none. */
function roleKey(role: Parameters<typeof inverter.byRole>[0]): string | null {
  return inverter.byRole(role)?.key ?? null;
}

/** Minute-averaged series of one metric over `[from, to)`, epoch ms → value. */
async function fetchSeries(metric: string, from: Date, to: Date): Promise<Map<number, number>> {
  const { data } = await api.api.history.rollup.get({
    query: {
      metric,
      bucket: "minute",
      from: from.toISOString(),
      to: to.toISOString(),
      limit: 1441,
    },
  });
  const points = (data as { time: string; avg: number }[] | null) ?? [];
  return new Map(points.map((p) => [Date.parse(p.time), p.avg]));
}

/** Like {@link fetchSeries}, for a role the profile may not map at all. */
async function fetchRoleSeries(
  role: Parameters<typeof inverter.byRole>[0],
  from: Date,
  to: Date,
): Promise<Map<number, number> | null> {
  const key = roleKey(role);
  return key ? fetchSeries(key, from, to) : null;
}

/**
 * Fetch the day-so-far from the rollups. Null when the profile maps no total
 * PV metric (nothing to decompose) — callers fall back to the decision ring.
 */
export async function fetchMeasuredDay(): Promise<MeasuredDay | null> {
  const pvKey = roleKey("pv.total.power");
  if (!pvKey) return null;
  const from = new Date(new Date().setHours(0, 0, 0, 0));
  const to = new Date();
  const [pv, batt, grid, soc] = await Promise.all([
    fetchSeries(pvKey, from, to),
    fetchRoleSeries("battery.power", from, to),
    fetchRoleSeries("grid.power", from, to),
    fetchRoleSeries("battery.soc", from, to),
  ]);
  return measuredDaySeries({ pv, batt, grid, soc });
}
