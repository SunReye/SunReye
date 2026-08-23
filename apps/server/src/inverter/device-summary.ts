/**
 * What a device looks like from outside the server.
 *
 * The registry's `Device` carries a live `ProfileContext` and its source's
 * connection blob — a decoded manifest and, in general, credentials. Neither
 * crosses the wire, so the summary is built explicitly rather than by spreading
 * the device and deleting fields: a field added to `Device` later must not
 * silently become public.
 */

import type { Device } from "./device-registry";

/** One device, as a client sees it. */
export interface DeviceSummary {
  /** The id every reading of this device is stored under. */
  id: string;
  label: string;
  deviceClass: string;
  /** Which profile decodes it — provenance, not something to branch on. */
  profileId: string;
  sourceId: string;
  /** How its source is spoken to: `modbus`, `http`, … */
  sourceKind: string;
  /** A disabled device is not polled; it keeps its history and its row. */
  enabled: boolean;
  /**
   * Whether this is the device a request that names none is answered with.
   * Exactly one, or none at all while the plant is still being onboarded.
   */
  isDefault: boolean;
}

export function deviceSummaries(
  devices: readonly Device[],
  defaultDeviceId: string | null,
): DeviceSummary[] {
  return devices.map((device) => ({
    id: device.id,
    label: device.label,
    deviceClass: device.deviceClass,
    profileId: device.ctx.profile.id,
    sourceId: device.source.id,
    sourceKind: device.source.kind,
    enabled: device.enabled,
    isDefault: device.id === defaultDeviceId,
  }));
}
