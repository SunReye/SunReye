/**
 * Which metric keys carry the battery signals this feature reads.
 *
 * Resolved from the active profile's ROLES, never from key names: a vendor is
 * free to call its SOC register anything, and the role is the contract. SOC and
 * power are both required — energy without SOC measures nothing, and SOC without
 * energy measures nothing — while temperature is optional context.
 */

import type { CanonicalRole, InverterProfile } from "@SunReye/inverter-core";
import type { BatteryKeys } from "./health";

const keyForRole = (profile: InverterProfile, role: CanonicalRole): string | undefined =>
  profile.metrics.find((m) => m.role === role)?.key;

/** The battery keys, or null when this profile cannot support the measurement. */
export function batteryKeys(profile: InverterProfile): BatteryKeys | null {
  const soc = keyForRole(profile, "battery.soc");
  const power = keyForRole(profile, "battery.power");
  if (!soc || !power) return null;
  return { soc, power, temperature: keyForRole(profile, "battery.temperature") };
}
