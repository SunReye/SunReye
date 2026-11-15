// The devices step's model: what the scan found, as the admin chooses, names or enters each device.
import type { Found } from "../api/core.ts";

/** An endpoint as the scan found it, or as the admin entered it. */
export type Endpoint = Readonly<
  Omit<Found, "devices"> & { devices: readonly Readonly<Found["devices"][number]>[] }
>;

/**
 * A device the scan proposed, as the admin confirms and names it; or, at an endpoint no profile
 * recognised, one the admin enters by hand.
 */
export interface Choice {
  /** Fixed while the admin types a manual entry's profile and unit. */
  readonly key: string;
  readonly found: Endpoint;
  readonly manual: boolean;
  profile: string;
  /** The variant the scan found, or the admin picked with the profile (ADR 5); none for a family's base. */
  variant?: string | undefined;
  /** What the scan calls the device: the variant's name, else the profile's. */
  readonly title: string;
  unit: number;
  chosen: boolean;
  name: string;
}

/** Where a manual entry starts: the usual Modbus unit. */
const UNIT = 1;

/** The Modbus framings an endpoint entered by hand may speak. */
export const TRANSPORTS: readonly Found["transport"][] = [
  "modbus-tcp",
  "rtu-over-tcp",
  "solarman-v5",
];

/** A device the admin enters by hand at `endpoint`. */
export function manual(endpoint: Endpoint, chosen: boolean): Choice {
  const key = `${endpoint.host}:${endpoint.port}/manual`;

  return {
    key,
    found: endpoint,
    manual: true,
    chosen,
    profile: "",
    title: "",
    unit: UNIT,
    name: "",
  };
}

/** A scan's choices: each recognised device chosen under the name the scan gives it, each other host to enter by hand. */
export function scanned(endpoints: readonly Endpoint[]): Choice[] {
  return endpoints.flatMap((endpoint: Endpoint): Choice[] => {
    const at = `${endpoint.host}:${endpoint.port}`;

    if (endpoint.devices.length === 0) return [manual(endpoint, false)];

    return endpoint.devices.map(({ profile, variant, name, unit }) => ({
      key: `${at}/${profile}/${unit}`,
      found: endpoint,
      manual: false,
      profile,
      ...(variant !== undefined && variant !== null && { variant }),
      title: name,
      unit,
      chosen: true,
      name,
    }));
  });
}
