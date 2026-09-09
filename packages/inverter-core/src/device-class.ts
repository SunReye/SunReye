/**
 * What a device IS, for the read layer that must tell "this device reports the
 * plant total" from "this device is one of the inverters the total is summed
 * FROM".
 *
 * THE single source: `packages/db`'s `devices_role_check` constraint is
 * rendered from this array, its `DEVICE_ROLES` re-exports it, and
 * {@link DeviceClass} is derived from it. A sixth class is added HERE and
 * nowhere else — the CHECK, the read layer and the in-memory type follow.
 * (`apps/server/db-tests/check-constraints.test.ts` still proves the engine
 * enforces what this list says.)
 *
 * Lives in its own module with its own package export so `packages/db` can
 * import it without pulling the Modbus transport in behind it.
 */
export const DEVICE_CLASSES = [
  "inverter",
  "controller",
  "meter",
  "charger",
  "optimizer",
] as const satisfies readonly string[];

export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/** Whether a string — a `devices.role` column, a request body — is a modelled class. */
export function isDeviceClass(role: string): role is DeviceClass {
  return (DEVICE_CLASSES as readonly string[]).includes(role);
}
