// Row shapes shared by the devices settings panel and its dialog. Mirrors the
// server's `DeviceView` (`apps/server/src/devices/device-admin.ts`); the Eden
// treaty carries the same shape, these names exist so components can type a
// prop without reaching into the treaty's inferred response.

import type { InverterFields, InverterTexts } from "$lib/settings/inverter-fields";

// One spelling of the wire transport for both settings surfaces.
export type { Transport } from "../inverter-types";
import type { Transport } from "../inverter-types";

export type ConnectionView = {
  id: number;
  name: string;
  host: string;
  port: number;
  transport: string;
  timeoutMs: number;
  pollIntervalMs: number;
};

export type DeviceView = {
  id: number;
  slug: string;
  name: string;
  profileId: string;
  role: string;
  unitId: number;
  connectionId: number | null;
  /** ISO timestamp while retired, null in service. */
  retiredAt: string | null;
  connection: ConnectionView | null;
  /** The inverter's roof and pack; empty/defaults/null on every other role. */
  arrays: InverterFields["arrays"];
  tempCoefficient: number;
  systemLoss: number;
  battery: InverterFields["battery"];
  profileName: string | null;
  profileKnown: boolean;
  /** The one device the poll loop reads in this release. */
  polled: boolean;
};

export type DeviceRoster = {
  devices: DeviceView[];
  connections: ConnectionView[];
};

/** The roles an operator may add; the optimizer is virtual and adds itself. */
export const ADDABLE_ROLES = ["inverter", "meter", "charger", "controller"] as const;
export type AddableRole = (typeof ADDABLE_ROLES)[number];

export type NewConnection = {
  name: string;
  host: string;
  port: number;
  transport: Transport;
  timeoutMs: number;
  pollIntervalMs: number;
};

/** What `POST /api/devices` takes. */
export type AddDeviceBody = {
  connection: { id: number } | { create: NewConnection };
  role: AddableRole;
  unitId: number;
  name: string;
  profileId: string;
} & Partial<InverterFields>;

/** What `PATCH /api/devices/:id` takes from the edit dialog; `retired` rides the row's own buttons. */
export type DevicePatchBody = {
  name?: string;
  role?: AddableRole;
  unitId?: number;
  connectionId?: number;
  profileId?: string;
} & Partial<InverterFields>;

/** The dialog's form state, before it is a request. */
export type AddDeviceForm = {
  /** A connection id as a string (native select values are strings), or {@link NEW_CONNECTION}. */
  connectionChoice: string;
  newConnection: NewConnection;
  role: AddableRole;
  unitId: number;
  name: string;
  profileId: string;
  /** The inverter section's texts; only sent when the role is `inverter`. */
  inverter: InverterTexts;
};

/** The `<select>` value that means "create a connection". Never a real id. */
export const NEW_CONNECTION = "new";
