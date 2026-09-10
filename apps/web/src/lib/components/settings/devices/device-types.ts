// Row shapes shared by the devices settings panel and its dialog. Mirrors the
// server's `DeviceView` (`apps/server/src/devices/device-admin.ts`); the Eden
// treaty carries the same shape, these names exist so components can type a
// prop without reaching into the treaty's inferred response.

import type { InverterFields, InverterTexts } from "$lib/settings/inverter-fields";
import type { ConnectionCreate, ConnectionDraft } from "./connection-draft";

// One spelling of the wire transport for both settings surfaces.
export type { Transport } from "../inverter-types";
import type { Transport } from "../inverter-types";

/**
 * Every connection kind this build can open. Mirrors `CONNECTION_KINDS` in
 * `@SunReye/db/connection-kinds` — the web app cannot import from `@SunReye/db`
 * (it is not a dependency of this package), so the list is restated and the
 * server's CHECK constraint is the one that decides.
 */
export const CONNECTION_KINDS = ["modbus", "mqtt"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

/** A Modbus endpoint's addressing — the five columns `params` replaced (#217). */
export type ModbusParams = {
  host: string;
  port: number;
  transport: Transport;
  timeoutMs: number;
  pollIntervalMs: number;
};

/**
 * An MQTT broker's endpoint AS THE API RETURNS IT.
 *
 * The password is write-only, exactly as `app_settings.mqtt`'s was: the server
 * strips it and answers `hasPassword` instead, and a write that omits it keeps
 * the stored one.
 */
export type MqttParamsMasked = {
  brokerUrl: string;
  username?: string;
  clientId?: string;
  hasPassword: boolean;
};

/**
 * A connection as `/api/connections` returns it: the label, plus the params of
 * its kind. Mirrors the server's `ConnectionView`
 * (`{ id, name } & ConnectionParamsMasked`).
 *
 * Discriminated on `kind` rather than one flat row with optional fields: the two
 * arms share NOT ONE field, and every reader switches on the kind — a group
 * caption, the option label, the probe, the dialog's field set.
 */
export type ConnectionView = { id: number; name: string } & (
  | { kind: "modbus"; params: ModbusParams }
  | { kind: "mqtt"; params: MqttParamsMasked }
);

/** A connection narrowed to the kind a Modbus device can be addressed on. */
export type ModbusConnectionView = Extract<ConnectionView, { kind: "modbus" }>;

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
  /** How the device is fed: a Modbus endpoint, a coded integration, or nothing. */
  kind: DeviceKind;
  /** Why it is, or is not, being read. */
  state: DeviceState;
  /** The integration a coded device belongs to (`evcc`), or null. */
  integration: string | null;
};

/** Mirrors the server's `DeviceKind`. */
export type DeviceKind = "modbus" | "coded" | "virtual";

/**
 * Mirrors the server's `DeviceState`. One word per reason a device is not being
 * read — a `polled` boolean reported an MQTT-fed loadpoint and a computation as
 * broken Modbus hardware (#213).
 */
export type DeviceState = "polling" | "idle" | "provided" | "virtual" | "retired";

/**
 * An integration as `/api/integrations` returns it. Mirrors the server's
 * `IntegrationView` (`apps/server/src/integrations/integration-admin.ts`).
 *
 * `label`, `addable` and `multiInstance` are DERIVED per response from the
 * catalog entry the row's kind resolves to — they are not stored, so a build
 * that renames "EVCC" is not contradicted by every row written before it. A row
 * this build has no entry for still comes back, labelled with its raw kind: it
 * is configured and running, and a page that hid it would leave the operator
 * nothing to turn off.
 */
export type IntegrationView = {
  id: number;
  kind: string;
  /** The endpoint it runs over, or null for a coded thing that needs none. */
  connectionId: number | null;
  enabled: boolean;
  params: Record<string, unknown>;
  label: string;
  addable: boolean;
  multiInstance: boolean;
};

/** What `PATCH /api/integrations/:id` takes. Never `kind` or `connectionId`:
    those are the row's identity and the server answers 409 for either. */
export type IntegrationPatchBody = {
  enabled?: boolean;
  params?: Record<string, unknown>;
};

export type DeviceRoster = {
  devices: DeviceView[];
  connections: ConnectionView[];
  /**
   * Optional because it arrives from a SECOND request. The page renders the
   * roster as soon as `/api/devices` answers, and `/api/integrations` lands
   * after it — an absent list is "not yet", never "none configured".
   */
  integrations?: readonly IntegrationView[];
};

/** The roles an operator may add; the optimizer is virtual and adds itself. */
export const ADDABLE_ROLES = ["inverter", "meter", "charger", "controller"] as const;
export type AddableRole = (typeof ADDABLE_ROLES)[number];

/** What `POST /api/devices` takes. */
export type AddDeviceBody = {
  connection: { id: number } | { create: ConnectionCreate };
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
  /** The endpoint the {@link NEW_CONNECTION} arm would create — always a Modbus one. */
  newConnection: ConnectionDraft;
  role: AddableRole;
  unitId: number;
  name: string;
  profileId: string;
  /** The inverter section's texts; only sent when the role is `inverter`. */
  inverter: InverterTexts;
};

/** The `<select>` value that means "create a connection". Never a real id. */
export const NEW_CONNECTION = "new";
