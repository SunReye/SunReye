/**
 * Resolving the MQTT namespace — the FROZEN plant and device slugs the bridge
 * publishes under — out of the dimension spine.
 *
 * Its own module because it is the seam between two things that must not know each
 * other: `./mqtt.ts` is a transport with no database, and the `ProfileContext`
 * `./runtime.ts` holds is built from the profile alone. The bridge needs
 * `plants.slug` and `devices.slug`, and there is exactly one honest place to get
 * them, which is the rows themselves.
 *
 * ## WHY THIS THROWS INSTEAD OF FALLING BACK
 *
 * The obvious shape is "use the slug if there is one, else the profile id". That
 * shape IS the defect. Until 2.0.0 every Home Assistant `unique_id`, every topic
 * and the HA device identifier were built from `profile.id`, so correcting a
 * profile id — or swapping a mis-detected profile for the right one — renamed
 * every entity; and because a discovery announcement is RETAINED on the broker,
 * the old entities did not move, they orphaned, taking every dashboard card,
 * automation and statistic that named them along. A fallback would reintroduce
 * precisely that on any install where the spine is not there yet, and it would do
 * it SILENTLY: the bridge would look healthy and publish under the old scheme.
 *
 * So a missing spine is an ERROR the caller logs, and the bridge does not start.
 * Not publishing is recoverable — `./provision.ts` runs before the bridge on every
 * boot and is idempotent, so the next boot creates the rows and every entity
 * appears. A retained announcement under the wrong identity is not recoverable.
 * This is an assertion that provisioning succeeded, not a hopeful lookup.
 *
 * ## READ-ONLY
 *
 * `readPlant` / `readDevices` only. Nothing here creates, renames or repairs a
 * row — provisioning owns that, and a second writer of a FROZEN column is how a
 * frozen column stops being frozen.
 */

import { db } from "@SunReye/db";
import { type PlantDb, readDevices, readPlant } from "@SunReye/db/plant-repo";
import type { MqttNamespace } from "./mqtt-discovery";

/** The only plant fields the namespace needs. */
export interface NamespacePlant {
  id: number;
  slug: string;
}

/** The only device fields the namespace needs; `id` orders the tie-break below. */
export interface NamespaceDevice {
  id: number;
  slug: string;
  profileId: string;
  role: string;
}

/**
 * The spine is not provisioned (yet). A named class so the caller can log it as an
 * install-state problem rather than as a broker failure — the two have completely
 * different fixes and the operator only ever sees the log line.
 */
export class MissingMqttNamespaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingMqttNamespaceError";
  }
}

/** The role whose device the bridge speaks for. Mirrors `./provision.ts`. */
const INVERTER_ROLE = "inverter";

/** A slug of only whitespace is not a topic segment; treat it as absent. */
const usable = (slug: string): boolean => slug.trim() !== "";

/**
 * Pick the device whose slug is the namespace, or throw.
 *
 * Two arms, and their ORDER is the load-bearing part:
 *
 *  1. the device carrying the ACTIVE profile id. The normal case, and the only
 *     arm that is right once a plant has more than one inverter.
 *  2. the plant's lowest-id `role = 'inverter'` device. This arm is what makes a
 *     PROFILE SWAP keep the namespace: right after a swap no device carries the
 *     new profile id yet (provisioning re-points the row on the next boot), so
 *     without it the bridge would go quiet until a restart. Lowest ID rather than
 *     "the first one found", so two inverters cannot make the namespace depend on
 *     row order — a namespace that moved between boots would be the original bug
 *     with extra steps.
 *
 * A CONTROLLER OR A METER IS NEVER ADOPTED — the same rule, and the same reason,
 * as `./provision.ts`'s `findDevice`: publishing inverter readings under a
 * controller's slug would make them claim to come from the controller, and slugs
 * are frozen, so the claim would be permanent.
 */
function pickDevice(devices: readonly NamespaceDevice[], profileId: string): NamespaceDevice {
  const byProfile = devices.find((d) => d.profileId === profileId && usable(d.slug));
  if (byProfile) return byProfile;
  const inverter = devices
    .filter((d) => d.role === INVERTER_ROLE && usable(d.slug))
    .sort((a, b) => a.id - b.id)[0];
  if (inverter) return inverter;
  throw new MissingMqttNamespaceError(
    `no device row can name the MQTT namespace: the plant has no usable ${INVERTER_ROLE} device (active profile "${profileId}")`,
  );
}

/**
 * The namespace these rows describe, or throw.
 *
 * Pure, so every way the choice can go — which device wins, and each way the spine
 * can be absent — is provable without a Postgres. {@link readMqttNamespace} is the
 * thin IO around it.
 */
export function resolveMqttNamespace(
  plant: NamespacePlant | null,
  devices: readonly NamespaceDevice[],
  profileId: string,
): MqttNamespace {
  if (!plant || !usable(plant.slug)) {
    throw new MissingMqttNamespaceError(
      "no plant row can name the MQTT namespace: this install has no plant with a slug yet",
    );
  }
  return { plantSlug: plant.slug, deviceSlug: pickDevice(devices, profileId).slug };
}

/**
 * The live namespace for the active profile.
 *
 * The client is a parameter with a production default, the same shape
 * `../migration/record.ts` uses: it makes the READ — which row shape reaches
 * {@link resolveMqttNamespace} — provable without a Postgres, and production never
 * passes one.
 *
 * `includeRetired: false` narrows the STATEMENT rather than the result. A retired
 * device's slug is written into years of exports and saved charts, so it must never
 * be adopted; arm 2 above would otherwise happily pick one.
 *
 * The plant read comes first and short-circuits — with no plant there is no
 * `plant_id` to ask for devices with, so the second query would be a guess. Called
 * once per bridge start, not per publish: the slugs are frozen, so there is nothing
 * to re-read.
 */
export async function readMqttNamespace(
  profileId: string,
  database: PlantDb = db,
): Promise<MqttNamespace> {
  const plant = await readPlant(database);
  if (!plant || !usable(plant.slug)) return resolveMqttNamespace(plant, [], profileId);
  const devices = await readDevices(database, plant.id, { includeRetired: false });
  return resolveMqttNamespace(plant, devices, profileId);
}
