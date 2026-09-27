/**
 * Which rows of a group fold away. (What a DELETE answer means is the roster's
 * now — `./device-roster.ts`.)
 */

import type { DeviceView } from "./device-types";

/**
 * In-service rows first, retired ones apart. A retired row stays reachable —
 * it is the only place it can be restored or deleted — but it no longer sits
 * between the devices that are working.
 */
export function splitRetired<T extends Pick<DeviceView, "retiredAt">>(
  devices: readonly T[],
): { active: T[]; retired: T[] } {
  const active: T[] = [];
  const retired: T[] = [];
  for (const device of devices) (device.retiredAt === null ? active : retired).push(device);
  return { active, retired };
}
