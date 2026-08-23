import { ModbusInverter } from "./driver";
import { SimulatedInverter } from "./simulator";
import type { InverterConnection, InverterProfile, InverterSource } from "./types";

/**
 * Runtime registry of installed inverter profiles.
 *
 * Profile packages call {@link registerProfile} on import to make themselves
 * discoverable; the server resolves the active one by id (env-driven). This is
 * the seam that lets new inverters be "downloaded" as packages without
 * changing the core engine.
 */
const profiles = new Map<string, InverterProfile>();

export function registerProfile(profile: InverterProfile): InverterProfile {
  profiles.set(profile.id, profile);
  return profile;
}

/** Drop a profile from the registry. Returns whether it was present. */
export function unregisterProfile(id: string): boolean {
  return profiles.delete(id);
}

export function getProfile(id: string): InverterProfile {
  const profile = profiles.get(id);
  if (!profile) {
    const known = [...profiles.keys()].join(", ") || "(none installed)";
    throw new Error(`unknown inverter profile "${id}". Installed: ${known}`);
  }
  return profile;
}

/** Non-throwing lookup — `undefined` when the id isn't registered. */
export function tryGetProfile(id: string): InverterProfile | undefined {
  return profiles.get(id);
}

export function listProfiles(): InverterProfile[] {
  return [...profiles.values()];
}

/**
 * Build a live source for a profile: simulator or real Modbus TCP.
 *
 * `deviceId` is what the samples are stamped with. It defaults to the profile's
 * id — every install with one device — and is passed explicitly when a device
 * has an identity of its own, which is the case as soon as two of them share a
 * profile.
 */
export function createInverter(
  profile: InverterProfile,
  opts: { simulate: boolean; connection: InverterConnection; deviceId?: string },
): InverterSource {
  const { deviceId } = opts;
  return opts.simulate
    ? new SimulatedInverter(profile, { deviceId })
    : new ModbusInverter(profile, opts.connection, undefined, { deviceId });
}
