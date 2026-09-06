/**
 * WHERE a series is read from: one device, or the plant as a whole.
 *
 * Storage is keyed per device (`metrics_raw.device_id`), and until #202 every
 * read path took a single slug. A plant with two inverters had no spelling for
 * "the plant". This module is that spelling, resolved ONCE at the route boundary
 * so the SQL layer only ever sees a device-id set.
 *
 * THE MEMBERSHIP RULE — written on `devices.role` in
 * `packages/db/src/schema/plants.ts` and applied here:
 *
 *  - a `controller` present REPORTS the total, so it is the whole set;
 *  - otherwise the set is every `inverter`, summed;
 *  - `meter`, `charger` and the virtual `optimizer` are never plant members.
 *
 * History keeps a RETIRED device in the set: its rows still belong to the plant
 * for the span it was in service, and dropping it would make the plant's past
 * shrink the day a machine is replaced. The live set drops it, because a retired
 * device stops answering and a stale sample must not be summed.
 */

import { activeDevices } from "@SunReye/db/plant-repo";

export interface PlantMember {
  /** `devices.id` — the int2 every reading is keyed by. */
  id: number;
  /** `devices.slug` — the storage identity. */
  slug: string;
  /**
   * `devices.profile_id` — the name a live sample carries TODAY: the driver
   * stamps `InverterSample.inverterId` with its profile id
   * (`packages/inverter-core/src/driver.ts`), not the slug. The live fold
   * matches a sample to its member by either. Two devices on one profile are
   * indistinguishable on the wire until the sample carries the slug; the
   * storage identity already handles that arm (`ensureDevice` by slug).
   */
  profileId?: string;
  /**
   * The member's weight for a `weighted-mean` metric — its battery's usable kWh,
   * or 1 when it has no battery, so a plant of batteryless inverters still has a
   * mean rather than a division by zero.
   */
  weight: number;
}

/** The unresolved form a request carries: the plant, or a device by slug. */
export type SeriesSourceRequest = { kind: "plant" } | { kind: "device"; slug: string };

/**
 * The compact form the energy and statistics readers take: a device slug (the
 * spelling every caller already used) or the plant's member set. Widening the
 * old `inverterId: string` to this keeps every existing call site valid.
 */
export type SeriesTarget = string | { plant: readonly PlantMember[] };

export const isPlantTarget = (t: SeriesTarget): t is { plant: readonly PlantMember[] } =>
  typeof t !== "string";

/** A stable cache key for a target. */
export function targetKey(t: SeriesTarget): string {
  return isPlantTarget(t) ? `plant:${t.plant.map((m) => m.id).join(",")}` : t;
}

/**
 * Parse the two query spellings. `source` is the current vocabulary
 * (`plant` or a slug); `inverterId` is kept as an alias for one release.
 * Neither present → null, so the route supplies its own default.
 */
export function parseSeriesSource(q: {
  source?: string | undefined;
  inverterId?: string | undefined;
}): SeriesSourceRequest | null {
  const raw = q.source || q.inverterId;
  if (!raw) return null;
  return raw === "plant" ? { kind: "plant" } : { kind: "device", slug: raw };
}

/** What {@link plantMembers} needs of a device row, plus its battery. */
export interface MemberRow {
  id: number;
  slug: string;
  name: string;
  profileId: string;
  role: string;
  retiredAt: Date | null;
  /** `batteries.usable_kwh` for this device, or null when it has no battery. */
  batteryKwh: number | null;
}

/**
 * The plant's member set from its device rows — see the module note for the
 * rule. `live` drops retired devices.
 */
export function plantMembers(
  rows: readonly MemberRow[],
  opts: { live?: boolean } = {},
): PlantMember[] {
  const pool = opts.live ? activeDevices(rows) : rows;
  const controllers = pool.filter((r) => r.role === "controller");
  const chosen = controllers.length > 0 ? controllers : pool.filter((r) => r.role === "inverter");
  return chosen.map((r) => ({
    id: r.id,
    slug: r.slug,
    profileId: r.profileId,
    weight: r.batteryKwh ?? 1,
  }));
}
