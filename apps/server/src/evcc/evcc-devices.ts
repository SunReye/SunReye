/**
 * EVCC's loadpoints, as DEVICES — the coded tier of the integration registry.
 *
 * THE FALSIFICATION TEST
 *
 * EVCC is the most opinionated integration in the tree: a feed-forward charge-
 * power estimator, a three-layer charge-limit resolution, and a battery-boost
 * contract that only holds in the PV modes. Each took a live instance to get
 * right. If the device contract can host it WITHOUT hollowing those out, it can
 * host anything; if it could not, the contract would be the thing to fix.
 *
 * It can, and this file is the shape of the answer:
 *
 *   generic values become ROLES, and everything else stays on EVCC's own
 *   surface. An integration may expose MORE than the contract. It may never
 *   expose less.
 *
 * So the five `ev.*` roles are here and the following are deliberately absent,
 * still served by `./evcc.ts` and `@SunReye/contracts/evcc` exactly as before:
 *
 *  - `limitSoc` / `effectiveLimitSoc` / `vehicleLimitSoc`. `0` on the loadpoint
 *    means "no session override", NOT "no limit", and EVCC clears it on unplug;
 *    the durable value lives on the VEHICLE and EVCC resolves the two itself.
 *    A `ev.limit.soc` role would have to pick one of the three layers, and every
 *    other wallbox integration would then have to fake the other two.
 *  - `batteryBoost` / `batteryBoostLimit`. The boost is EVCC deliberately
 *    draining the HOUSE battery into a car; it is accepted only in `pv`/`minpv`,
 *    is cleared on every mode change, and its limit is a house-battery SOC that
 *    EVCC persists. That is a contract between two of our own subsystems, not a
 *    reading.
 *  - the estimator in `./ev-power-estimator.ts`. It is not a value at all — it
 *    is how one value is produced between EVCC's publishes.
 *
 * WHAT THE ESTIMATOR DID CONTRIBUTE
 *
 * `chargePowerSource` was already a per-value freshness hint, and it generalised
 * into `ValueProvenance` on the sample model (`@SunReye/contracts/samples`). So
 * the live figure travels into the write seam WITH its provenance, and the seam
 * — for every device, not just this one — keeps the measured half as history and
 * drops the guesses. Nothing had to be reinvented, and the estimator kept every
 * one of its semantics.
 */

import type { EvccLoadpoint } from "@SunReye/contracts/evcc";
import type { DeviceMetric } from "@SunReye/inverter-core";

import type { DeviceSample } from "../inverter/device-writer";

/**
 * The `integration` string every loadpoint device carries. PROVENANCE ONLY: it
 * is for support output and the settings UI, and a consumer that branches on it
 * is the acceptance failure this deliverable is written against.
 */
export const EVCC_INTEGRATION = "evcc";

/**
 * The `profile_id` a loadpoint's `devices` row names.
 *
 * `devices.profile_id` carries no foreign key (#169) and a coded integration has
 * no register map to install, so this is a NAME the registry resolves through
 * its coded-declaration table rather than through the profile store.
 */
export const EVCC_LOADPOINT_PROFILE = "evcc-loadpoint";

/**
 * The identity a loadpoint's readings are keyed under — `devices.slug`, frozen
 * once written.
 *
 * Derived from EVCC's own 1-based loadpoint index, which is the only stable
 * handle EVCC gives: the title is editable and the vehicle moves between
 * loadpoints. Renumbering loadpoints in the EVCC config therefore re-points the
 * history, and that is a limitation of EVCC's addressing rather than of this
 * mapping — the alternative, keying by title, breaks on a rename instead.
 */
export function loadpointDeviceId(index: number): string {
  return `evcc-loadpoint-${index}`;
}

/** A read-only measurement declaration; the coded tier states no addressing. */
function reading(key: string, role: DeviceMetric["role"], unit: string | null): DeviceMetric {
  return { key, unit, group: "ev", access: "r", role };
}

/**
 * What every loadpoint declares. Identical for all of them, because a loadpoint
 * is one thing: EVCC publishes the same topic set per index.
 *
 * The keys are the role names. A coded integration has no vendor register names
 * to preserve, and `metric_keys` is plant-wide — two loadpoints reporting
 * `ev.charge.power` are two devices' rows against one key, which is exactly the
 * shape two identical inverters already have.
 */
export const LOADPOINT_METRICS: readonly DeviceMetric[] = [
  reading("ev.charge.power", "ev.charge.power", "W"),
  reading("ev.vehicle.soc", "ev.vehicle.soc", "%"),
  reading("ev.session.energy", "ev.session.energy", "kWh"),
  reading("ev.connected", "ev.connected", null),
  reading("ev.charging", "ev.charging", null),
];

/**
 * The `devices` row one loadpoint needs, so its readings have an identity to be
 * keyed under.
 *
 * `connectionId: null` and `unitId: 0`: a loadpoint has no endpoint, no
 * registers and no unit on a bus. It is a row in the same table as every other
 * device because what it produces are readings, and every reading is keyed to a
 * device — not because there is anything to poll.
 *
 * Pure, and separate from the insert, so the shape is provable without a
 * database while the composition root keeps the plumbing.
 */
export function loadpointDeviceSpec(
  plantId: number,
  index: number,
  title: string | null,
): {
  plantId: number;
  connectionId: null;
  unitId: number;
  slug: string;
  name: string;
  profileId: string;
  role: string;
} {
  return {
    plantId,
    connectionId: null,
    unitId: 0,
    slug: loadpointDeviceId(index),
    // A CREATION default the operator may then edit — `ensureDevice` never
    // overwrites an existing name, so a later EVCC rename does not undo theirs.
    name: title ?? `EVCC loadpoint ${index}`,
    profileId: EVCC_LOADPOINT_PROFILE,
    role: "charger",
  };
}

/** Wh, as EVCC publishes energy, in the kWh the plant records it in. */
function kwh(wh: number): number {
  return wh / 1000;
}

/**
 * One loadpoint's readings at one instant.
 *
 * ABSENT IS ABSENT. A null SoC is a car EVCC cannot identify (a guest vehicle,
 * or one configured without a capacity), and writing `0` for it would be a
 * reading that says the battery is empty. A `false` boolean, by contrast, is a
 * measurement: "nothing is plugged in" is a fact about now, and a gap in that
 * series would be indistinguishable from a dead ingest.
 *
 * The power carried is the LIVE one, with EVCC's own provenance beside it — the
 * write seam keeps the measured half and drops the predictions, so the live
 * figure can go on painting at sub-poll latency without inventing history.
 */
export function loadpointSample(loadpoint: EvccLoadpoint, at: Date): DeviceSample {
  const metrics: Record<string, number> = {
    "ev.charge.power": loadpoint.chargePowerLive,
    "ev.connected": loadpoint.connected ? 1 : 0,
    "ev.charging": loadpoint.charging ? 1 : 0,
  };
  if (loadpoint.vehicleSoc !== null) metrics["ev.vehicle.soc"] = loadpoint.vehicleSoc;
  if (loadpoint.sessionEnergy !== null) {
    metrics["ev.session.energy"] = kwh(loadpoint.sessionEnergy);
  }
  return {
    time: at,
    metrics,
    provenance: { "ev.charge.power": loadpoint.chargePowerSource },
  };
}

/**
 * The device ids that were registered and are not any more — what to hand
 * `forgetDevice`.
 *
 * A loadpoint disappears when EVCC's config is edited and its instance reloads.
 * Its readings up to that moment are history and must be written out; nothing
 * after it may be keyed to it. The devices that remain are untouched, so an
 * unrelated loadpoint's open intervals survive.
 */
export function retiredLoadpoints(previous: readonly string[], next: readonly string[]): string[] {
  const live = new Set(next);
  return previous.filter((id) => !live.has(id));
}
