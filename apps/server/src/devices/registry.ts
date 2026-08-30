/**
 * THE DEVICE REGISTRY — the `devices` table, resolved into the in-memory
 * contract every consumer reads.
 *
 * One {@link DeviceInstance} per non-retired device row, with its roles resolved
 * from the profile its `profile_id` names. This is what replaces the
 * `activeProfile` module global: a single mutable `InverterProfile` in
 * `../inverter/inverter.ts` that could only ever describe one machine, that
 * every forecast, automation and route reached into directly, and that had no
 * relationship at all to the ids `metrics_raw` is keyed by.
 *
 * WHAT THE GLOBAL COULD NOT DO, AND THIS CAN
 *
 *  - A SECOND DEVICE. The global is one profile for the process, so a plant with
 *    two inverters, a meter and a controller had one description and one
 *    identity. The table has always modelled N.
 *  - THE RIGHT IDENTITY. Consumers that wanted "which device" got `profile.id`,
 *    which is a PROFILE — swapped, uninstalled and re-downloaded inside the five
 *    years a reading is retained. The instance is keyed by `devices.slug`, the
 *    identity the write path resolves to `devices.id`.
 *  - AN ENDPOINT-LESS DEVICE. EVCC (#88) and the optimizer (#172) are devices
 *    with no registers and no bus. They are rows in this table like any other,
 *    and the registry hands them the same contract.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not poll, and it does not decide the cadence — `../inverter/endpoint.ts`
 * owns the addressing. It resolves WHAT a device is, never HOW it is reached.
 */

import {
  type DeviceClass,
  type DeviceInstance,
  type DeviceMetric,
  type InverterProfile,
  type ProfileDeclarations,
  deviceInstance,
  instanceFromProfile,
} from "@SunReye/inverter-core";
import { DEVICE_ROLES, type DeviceRecord, activeDevices } from "@SunReye/db/plant-repo";
import type { DeviceProfileBinding } from "@SunReye/db/automation-state";

/** The one failure path this logs; kept minimal so any logger satisfies it. */
export interface RegistryLogger {
  warn(template: string, values?: Record<string, unknown>): void;
}

/**
 * What a CODED integration declares — the tier EVCC (#88) and the optimizer
 * (#172) are authored in.
 *
 * The same two things a profile supplies (a metric list and the hardware facts
 * no metric can express) and NOT a third: there is no capability field here
 * either. A coded integration is always tempted to declare its capability set in
 * TypeScript because that is easier than declaring roles; if it could, two tiers
 * would be able to disagree about what "has a battery" means and every consumer
 * would grow a branch per tier.
 */
export interface CodedDeclaration {
  /** Provenance for {@link DeviceInstance.integration} — never branched on. */
  integration: string;
  metrics: readonly DeviceMetric[];
  declares?: ProfileDeclarations;
}

export interface DeviceRegistryDeps {
  /**
   * The plant's device rows. Production narrows the statement to the in-service
   * ones; the registry filters again with {@link activeDevices}, because a
   * caller holding a wide list is a caller that can poll a retired device.
   */
  readDevices(): Promise<readonly DeviceRecord[]>;
  /**
   * The profile a device's `profile_id` names, or null when nothing resolves it.
   *
   * Null is a LEGAL, EXPECTED answer, not an error: `devices.profile_id` carries
   * no foreign key by design (#169), so a profile can be uninstalled while the
   * device that used it keeps five years of readings. Such a device stays
   * registered and simply binds nothing.
   */
  resolveProfile(profileId: string): Promise<InverterProfile | null>;
  /**
   * The CODED declaration a device's `profile_id` names, or null when the id is
   * an ordinary profile id.
   *
   * Asked FIRST, and synchronously: a coded integration is compiled in, so there
   * is nothing to fetch — and asking the profile store about an id no profile
   * will ever have would produce a permanent "not installed" for a device that
   * is working perfectly.
   *
   * Optional, because the registry's own rules do not depend on the tier: a test
   * (and any install with no coded device) needs no table at all.
   */
  resolveCoded?(profileId: string): CodedDeclaration | null;
  logger: RegistryLogger;
}

export interface DeviceRegistry {
  /** Re-read the table and rebuild the snapshot. */
  reload(): Promise<readonly DeviceInstance[]>;
  /** The current snapshot, in device-id order. */
  list(): readonly DeviceInstance[];
  /** One instance by its id (`devices.slug`). */
  get(id: string): DeviceInstance | undefined;
  /**
   * The lowest-id INVERTER, or null when the plant has none.
   *
   * The compatibility seam for the consumers the `activeProfile` global left
   * single-device — the forecast's SOC read, the settings page's re-test. Every
   * one of them is a Phase 2b question (which device speaks for the plant?) that
   * this deliverable deliberately does not answer; naming the seam is how those
   * call sites stay findable when it does.
   */
  primary(): DeviceInstance | null;
  /** The driver profile of {@link primary}. */
  primaryProfile(): InverterProfile | null;
  /**
   * The register map that describes how to TALK to a device, or null.
   *
   * The transport tier's business, not the contract's: a poll needs bindings and
   * a test read needs a source, and neither is expressible as a role. Consumers
   * that ask "what can this device do" must ask {@link DeviceInstance} and
   * `deriveCapabilities` instead — this is for the two call sites that build a
   * live Modbus/HTTP source.
   */
  driverProfile(id: string): InverterProfile | null;
  /** Every profile id in use by a registered device, each listed once. */
  profileIds(): readonly string[];
  /**
   * Which profile each registered device's row NAMES, in roster order.
   *
   * The one place profile identity is handed out per device, and it exists for
   * exactly one job: the one-time re-key of state blobs that 1.x namespaced by
   * profile id (`@SunReye/db/automation-state`'s `migrateAutomationState`). It
   * names the id even when nothing resolves it — an uninstalled profile is
   * still the namespace an old blob was written under, and a device that cannot
   * be told which profile it named could never adopt its own snapshot.
   *
   * NOT a behavioural input: nothing may branch on it, for the same reason
   * `DeviceInstance.integration` may not.
   */
  bindings(): readonly DeviceProfileBinding[];
  /** Whether any registered device is described by this profile (the uninstall guard). */
  usesProfile(profileId: string): boolean;
}

/** Whether a row's role is one the read layer knows how to treat. */
function deviceClassOf(role: string): DeviceClass | null {
  return (DEVICE_ROLES as readonly string[]).includes(role) ? (role as DeviceClass) : null;
}

/**
 * Build a registry. Every field is closure-local, so a second instance shares
 * nothing — the same rule the runtime and the storage policy follow.
 */
export function createDeviceRegistry(deps: DeviceRegistryDeps): DeviceRegistry {
  /** The current snapshot, in the order the rows came back (lowest id first). */
  let instances: readonly DeviceInstance[] = [];
  let byId = new Map<string, DeviceInstance>();
  /** The driver profile behind each registered device, when one resolved. */
  let profiles = new Map<string, InverterProfile>();
  /** The profile id each device's ROW names, resolved or not — see `bindings`. */
  let bindings: readonly DeviceProfileBinding[] = [];

  /**
   * One row, resolved through whichever tier authored it.
   *
   * The CODED tier is asked first: its declarations are compiled in, so a device
   * whose `profile_id` names one is fully resolved without the profile store
   * ever being asked — and it must not be, since no profile will ever carry that
   * id. The `profile` it returns is the DRIVER profile, which a coded device has
   * none of: it has no register map and nothing to talk to.
   */
  async function resolveRow(
    row: DeviceRecord,
    deviceClass: DeviceClass,
  ): Promise<{ instance: DeviceInstance; profile: InverterProfile | null }> {
    const coded = deps.resolveCoded?.(row.profileId) ?? null;
    if (coded) {
      return {
        instance: deviceInstance({
          id: row.slug,
          deviceClass,
          integration: coded.integration,
          metrics: coded.metrics,
          ...(coded.declares ? { declares: coded.declares } : {}),
        }),
        profile: null,
      };
    }
    const profile = await deps.resolveProfile(row.profileId);
    return {
      instance: instanceFromProfile({
        id: row.slug,
        deviceClass,
        integration: "profile",
        // A device whose profile is not installed binds NOTHING rather than
        // vanishing: its history is still readable, its row is still editable,
        // and the operator can reinstall the profile it names.
        profile: profile ?? { id: row.profileId, name: row.name, manufacturer: "", metrics: [] },
      }),
      profile,
    };
  }

  async function reload(): Promise<readonly DeviceInstance[]> {
    let rows: readonly DeviceRecord[];
    try {
      rows = await deps.readDevices();
    } catch (error) {
      // The LAST GOOD SNAPSHOT survives a failed read. Emptying the registry
      // because one query failed would stop the poll loop storing anything and
      // make every capability-gated surface claim the hardware is gone — from a
      // database hiccup that the next reload fixes.
      deps.logger.warn("could not re-read the plant's devices: {error} — keeping the last roster", {
        error: error instanceof Error ? error.message : String(error),
      });
      return instances;
    }

    const built: DeviceInstance[] = [];
    const nextProfiles = new Map<string, InverterProfile>();
    const nextBindings: DeviceProfileBinding[] = [];
    for (const row of activeDevices(rows)) {
      const deviceClass = deviceClassOf(row.role);
      if (!deviceClass) {
        // The CHECK constraint admits five roles and `DEVICE_ROLES` mirrors
        // them, so this is only reachable when the two have drifted. Say so:
        // a device nothing can classify is a device silently dropped from the
        // roster, which is exactly the failure the constraint exists to make
        // loud.
        deps.logger.warn(
          'device "{slug}" has role "{role}", which no consumer knows how to treat — it is not registered',
          { slug: row.slug, role: row.role },
        );
        continue;
      }
      const { instance, profile } = await resolveRow(row, deviceClass);
      if (profile) nextProfiles.set(row.slug, profile);
      // The device -> profile binding is what re-keys automation state from a
      // profile id to a device id (#171). A coded device carries no profile, so
      // its binding names the id its row holds and adopts nothing.
      nextBindings.push({ deviceId: row.slug, profileId: row.profileId });
      built.push(instance);
    }

    instances = built;
    byId = new Map(built.map((d) => [d.id, d]));
    profiles = nextProfiles;
    bindings = nextBindings;
    return instances;
  }

  function primary(): DeviceInstance | null {
    return instances.find((d) => d.deviceClass === "inverter") ?? null;
  }

  return {
    reload,
    list: () => instances,
    get: (id) => byId.get(id),
    primary,
    primaryProfile: () => {
      const first = primary();
      return first ? (profiles.get(first.id) ?? null) : null;
    },
    driverProfile: (id) => profiles.get(id) ?? null,
    profileIds: () => [...new Set([...profiles.values()].map((p) => p.id))],
    bindings: () => bindings,
    usesProfile: (profileId) => [...profiles.values()].some((p) => p.id === profileId),
  };
}
