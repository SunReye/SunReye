/**
 * Reading the optimizer's decisions off the generic read path.
 *
 * The impure half of `./decision-series.ts`: it resolves the plant's roles to
 * metric keys through the inverter store, which reaches the socket, which
 * reaches `$app/environment` — none of which exists under `bun test`. Keeping it
 * apart is what leaves the row builder unit-testable (`apps/web/TESTING.md`).
 */

import { fetchSeriesSet } from "$lib/history/device-series";
import type { SeriesRef } from "$lib/history/series";
import { inverter } from "$lib/inverter/store.svelte";
import type { DecisionSeries } from "./decision-series";

/** `devices.slug` of the plant's optimizer — one per plant, never indexed. */
const OPTIMIZER_DEVICE_ID = "optimizer";

/** The metric key the profile maps to `role`, as a ref, or null when it maps none. */
function roleRef(role: Parameters<typeof inverter.byRole>[0]): SeriesRef | null {
  const key = inverter.byRole(role)?.key;
  return key ? { metric: key } : null;
}

/** One optimizer output, always addressed BY SLUG — never the default source. */
const decisionRef = (metric: string): SeriesRef => ({ metric, inverterId: OPTIMIZER_DEVICE_ID });

/**
 * Read every series a decision chart plots, over one window.
 *
 * The optimizer's five outputs are addressed by slug; the plant's five are
 * addressed by ROLE, so a profile that maps no house load contributes an empty
 * series rather than a column of zeros.
 */
export async function fetchDecisionSeries(from: Date, to: Date): Promise<DecisionSeries> {
  return fetchSeriesSet<keyof DecisionSeries>(
    {
      targetA: decisionRef("optimizer.target.current"),
      appliedA: decisionRef("optimizer.applied.current"),
      thresholdW: decisionRef("optimizer.threshold.power"),
      localSinkW: decisionRef("optimizer.local.sink.power"),
      // ONE metric, read as both extremes of each bucket: the mean of an enum
      // ordinal is not an enum (see `./decision-series.ts`'s `isShadow`). Both
      // aliases name the same metric on the same device, so `fetchSeriesSet`
      // answers them out of a single request.
      stateMin: { ...decisionRef("optimizer.state"), agg: "min" },
      stateMax: { ...decisionRef("optimizer.state"), agg: "max" },
      pvW: roleRef("pv.total.power"),
      loadW: roleRef("load.power"),
      batteryV: roleRef("battery.voltage"),
      batteryW: roleRef("battery.power"),
      gridW: roleRef("grid.power"),
    },
    { from, to, bucket: "minute" },
  );
}
