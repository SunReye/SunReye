/**
 * THE DEVICE CONTRACT — one shape every integration tier resolves to.
 *
 * A device is two things: a role -> binding map, and a capability set DERIVED
 * from it. Nothing here says how the mapping was authored — a register profile
 * downloaded from a git source, a coded integration compiled into the server, or
 * a mapping a user typed in the UI all produce the same {@link DeviceInstance},
 * and no consumer can tell which.
 *
 * WHY THERE IS NO `capabilities` FIELD, AND WHY THAT IS LOAD-BEARING
 *
 * A coded integration is always tempted to declare its capability set in
 * TypeScript, because that is easier than declaring roles. It must not. If a
 * tier can declare capabilities directly then two tiers can disagree about what
 * "has a battery" means, every consumer grows a branch per tier, and the
 * abstraction buys nothing. So capabilities are computed — by
 * `./capabilities.ts`'s `deriveCapabilities`, the one function that has always
 * answered the question — from the metrics this device declares, and there is
 * nowhere to put a second answer. Not even a cached one: a cache on the type is
 * a field, and a field is something a tier can set.
 *
 * WHY THE INSTANCE CARRIES ITS METRIC LIST BESIDE THE ROLE MAP
 *
 * The role map alone cannot reproduce what `deriveCapabilities` answers: PV
 * strings and phases are counted from distinct INDICES (one role, N metrics),
 * `time_of_use` is signalled by a metric GROUP rather than a role, and
 * `controls` is every writable key including the ones that map no role at all.
 * So the metrics are the input, and {@link DeviceInstance.roles} is the resolved
 * VIEW of them that role-consumers (the forecast's `pv.total.power`, the
 * automation engine's battery controls) read instead of re-scanning a list.
 */

import type { CanonicalRole } from "./roles";
import type { MetricBase, ProfileDeclarations, InverterProfile } from "./types";

/**
 * The role vocabulary a binding is keyed by — the catalog in `./roles.ts`,
 * named as the contract names it.
 */
export type RoleKey = CanonicalRole;

/**
 * What a device IS, for the read layer that must tell "this device reports the
 * plant total" from "this device is one of the inverters the total is summed
 * FROM".
 *
 * Mirrors the `devices_role_check` constraint and `packages/db`'s `DEVICE_ROLES`
 * — the database is the authority and this is the in-memory spelling of it.
 * `packages/db/src/plant-repo.test.ts` and `apps/server/db-tests` prove the
 * three agree; a sixth value is added in all of them or in none.
 */
export type DeviceClass = "inverter" | "controller" | "meter" | "charger" | "optimizer";

/**
 * What a device declares about one of its metrics — everything EXCEPT how to
 * read it off a wire.
 *
 * Deliberately narrower than `MetricDef`: a coded integration has no register
 * map, no `binding` and no legacy Modbus mirror, and requiring them would make
 * this contract unimplementable by the tier it exists for. Every field here is
 * one that a consumer of the contract actually reads — capability derivation
 * (`key`, `role`, `index`, `group`, `access`), storage classification (`kind`,
 * `storage`, `deadband`, `unit`) and metric-key registration (`unit`, `kind`).
 *
 * A `MetricDef` satisfies it structurally, so the profile tier needs no
 * translation step.
 */
export type DeviceMetric = Pick<MetricBase, "key" | "unit" | "group" | "access"> &
  Partial<Pick<MetricBase, "role" | "index" | "kind" | "storage" | "deadband">>;

/**
 * What one role is bound to on one device.
 *
 * A LIST, because an indexed role is 1:N — four PV strings are four metrics
 * under one role, and a binding that could only name one of them would make the
 * map unable to answer "how many strings does this device have".
 *
 * Named `RoleBinding` rather than `Binding`: `./types.ts` already owns that name
 * for the WIRE address union (`modbus` / `http` / `compute` / `control`), which
 * is a different question — where a value is read from, not what concept a
 * device binds to.
 */
export interface RoleBinding {
  role: RoleKey;
  /** Every metric mapping this role, in declaration order. */
  metrics: readonly DeviceMetric[];
}

/**
 * One registered device: the identity every reading is keyed under, what class
 * of thing it is, who produced it, and what it binds.
 */
export interface DeviceInstance {
  /**
   * `devices.slug` — the identity `metrics_raw` is keyed under, via
   * `apps/server/src/inverter/storage-identity.ts`. NEVER a profile id: a
   * profile is swapped, uninstalled and re-downloaded inside the five years a
   * reading is retained, and keying history by it is the 1.x defect this
   * release exists to fix.
   */
  id: string;
  deviceClass: DeviceClass;
  /**
   * Which integration produced this device (`profile`, `evcc`, `optimizer`, …).
   *
   * PROVENANCE ONLY — never branched on. It exists for support output and the
   * settings UI; a behavioural branch on it is the acceptance failure this whole
   * contract is written against.
   */
  integration: string;
  /** The resolved role -> binding view of {@link metrics}. */
  roles: ReadonlyMap<RoleKey, RoleBinding>;
  /** Everything this device declares it measures or controls. */
  metrics: readonly DeviceMetric[];
  /** Hardware facts no metric's presence can express (a backup output). */
  declares?: ProfileDeclarations;
}

/** Group a metric list by the role each entry maps; unmapped metrics bind nothing. */
export function roleBindings(metrics: readonly DeviceMetric[]): ReadonlyMap<RoleKey, RoleBinding> {
  const roles = new Map<RoleKey, RoleBinding>();
  for (const metric of metrics) {
    const role = metric.role;
    if (!role) continue;
    const existing = roles.get(role);
    if (existing) {
      roles.set(role, { role, metrics: [...existing.metrics, metric] });
      continue;
    }
    roles.set(role, { role, metrics: [metric] });
  }
  return roles;
}

/** Everything a {@link DeviceInstance} needs stated; the role map is resolved. */
export interface DeviceInstanceSpec {
  id: string;
  deviceClass: DeviceClass;
  integration: string;
  metrics: readonly DeviceMetric[];
  declares?: ProfileDeclarations;
}

/**
 * Build an instance from what a device declares. The ONE constructor, so a role
 * map can never be resolved by two different rules — which is how two tiers
 * start disagreeing about what a device binds.
 */
export function deviceInstance(spec: DeviceInstanceSpec): DeviceInstance {
  return {
    id: spec.id,
    deviceClass: spec.deviceClass,
    integration: spec.integration,
    metrics: spec.metrics,
    roles: roleBindings(spec.metrics),
    ...(spec.declares ? { declares: spec.declares } : {}),
  };
}

/** The profile tier's adapter: a registered device plus the profile describing it. */
export interface ProfileInstanceSpec {
  id: string;
  deviceClass: DeviceClass;
  integration: string;
  profile: InverterProfile;
}

/**
 * The profile tier's instance: the profile supplies the metric list and the
 * declarations, the DEVICE supplies the identity.
 *
 * `id` comes from the caller and not from `profile.id` on purpose — see
 * {@link DeviceInstance.id}. Two devices sharing one profile is an ordinary
 * state (a plant with two identical inverters), and it is exactly the state a
 * profile-keyed identity cannot represent.
 */
export function instanceFromProfile(spec: ProfileInstanceSpec): DeviceInstance {
  return deviceInstance({
    id: spec.id,
    deviceClass: spec.deviceClass,
    integration: spec.integration,
    metrics: spec.profile.metrics,
    ...(spec.profile.declares ? { declares: spec.profile.declares } : {}),
  });
}
