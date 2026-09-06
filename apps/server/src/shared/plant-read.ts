/**
 * Turning a request's `source` into what the readers take.
 *
 * Two answers come out of here. A {@link SeriesTarget} — the slug or the member
 * set — for the energy and statistics readers, whose metrics are all counters
 * and therefore all `sum`. And a {@link PlantFold} for the metric readers, which
 * need the ROLE's aggregate for the one metric they read and must REFUSE a
 * `per-device` metric at plant level rather than hand back an empty series a
 * chart would draw as zero.
 */

import { type ManifestMetric, plantAggregateOf } from "@SunReye/inverter-core";
import type { PlantFold } from "./history";
import type { AggregateOf } from "./plant-fold";
import type { PlantMember, SeriesSourceRequest, SeriesTarget } from "./plant-source";

/** The role-derived aggregate of a metric KEY, through the plant's manifest. */
export function aggregateOfMetric(metaByKey: ReadonlyMap<string, ManifestMetric>): AggregateOf {
  return (metric) => plantAggregateOf(metaByKey.get(metric)?.role);
}

const NO_PLANT_VALUE = {
  error: "This metric is one device's own state and has no plant-level value — read it per device",
} as const;

/** What the metric readers take for a source: the device slug, or the plant fold. */
export type MetricReadArgs = { inverterId: string; plant?: PlantFold };

/**
 * The read arguments for one metric under a source, or the refusal body when
 * the role has no plant value. A device request reads the slug as before; the
 * plant request carries the members and the role's aggregate.
 */
export function plantFoldFor(
  req: SeriesSourceRequest,
  members: readonly PlantMember[],
  metric: string,
  aggregateOf: AggregateOf,
): MetricReadArgs | typeof NO_PLANT_VALUE {
  if (req.kind === "device") return { inverterId: req.slug };
  const aggregate = aggregateOf(metric);
  if (aggregate === "per-device") return NO_PLANT_VALUE;
  return { inverterId: "plant", plant: { members, aggregate } };
}

export const isRefusal = (
  args: MetricReadArgs | typeof NO_PLANT_VALUE,
): args is typeof NO_PLANT_VALUE => "error" in args;

/** A request as a {@link SeriesTarget}: the slug, or the member set. */
export function targetOf(req: SeriesSourceRequest, members: readonly PlantMember[]): SeriesTarget {
  return req.kind === "device" ? req.slug : { plant: members };
}
