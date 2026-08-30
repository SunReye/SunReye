/**
 * Reading the plant's measured day off the generic read path.
 *
 * The impure half of `./day-rows.ts`: it resolves the plant's roles to metric
 * keys through the inverter store, which reaches the socket, which reaches
 * `$app/environment` — none of which exists under `bun test`. Keeping it apart
 * is what leaves the decomposition unit-testable (`apps/web/TESTING.md`).
 */

import { inverter } from "$lib/inverter/store.svelte";
import { fetchSeriesSet } from "./device-series";
import type { SeriesRef } from "./series";
import { type MeasuredDay, measuredDaySeries } from "./day-rows";

export type { MeasuredDay } from "./day-rows";

/** The metric key the profile maps to `role`, as a ref, or null when it maps none. */
function roleRef(role: Parameters<typeof inverter.byRole>[0]): SeriesRef | null {
  const key = inverter.byRole(role)?.key;
  return key ? { metric: key } : null;
}

/**
 * Fetch the day so far. Null when the profile maps no total PV metric — there is
 * nothing to decompose, and an empty stack would be a claim rather than a gap.
 */
export async function fetchMeasuredDay(): Promise<MeasuredDay | null> {
  const pv = roleRef("pv.total.power");
  if (!pv) return null;
  const from = new Date(new Date().setHours(0, 0, 0, 0));
  const series = await fetchSeriesSet(
    {
      pv,
      batt: roleRef("battery.power"),
      grid: roleRef("grid.power"),
      soc: roleRef("battery.soc"),
    },
    { from, to: new Date(), bucket: "minute" },
  );
  return measuredDaySeries(series);
}
