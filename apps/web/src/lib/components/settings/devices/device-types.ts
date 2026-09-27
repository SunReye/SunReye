// Row shapes shared by the devices settings panel, its dialogs and the add
// wizard. The WIRE shapes are `@SunReye/contracts/devices`, which the server
// builds its answers from; this module re-exports them under the names the
// components already use, and adds the request bodies and form state that
// exist only on this side.

import type {
  ConnectionKind as WireConnectionKind,
  ConnectionView,
  DeviceRoster as WireRoster,
  DeviceView,
  IntegrationView,
} from "@SunReye/contracts/devices";
import type { InverterFields, InverterTexts } from "$lib/settings/inverter-fields";
import type { ConnectionCreate, ConnectionDraft } from "./connection-draft";

export type { ConnectionView, DeviceView, IntegrationView } from "@SunReye/contracts/devices";

/**
 * Every connection kind this build can open, as a VALUE the kind picker loops
 * over. The list's home is `CONNECTION_KINDS` in `@SunReye/db/connection-kinds`
 * — the web app cannot import from `@SunReye/db`, so it is restated, and
 * `satisfies` plus the exhaustiveness check in `./connection-draft.test.ts` hold
 * it to the contract's `ConnectionKind` in both directions.
 */
export const CONNECTION_KINDS = ["modbus", "mqtt"] as const satisfies readonly WireConnectionKind[];
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

/** A connection narrowed to the kind a Modbus device can be addressed on. */
export type ModbusConnectionView = Extract<ConnectionView, { kind: "modbus" }>;

/** A Modbus endpoint's addressing — the five columns `params` replaced (#217). */
export type ModbusParams = ModbusConnectionView["params"];

/** What `PATCH /api/integrations/:id` takes. Never `kind` or `connectionId`:
    those are the row's identity and the server answers 409 for either. */
export type IntegrationPatchBody = {
  enabled?: boolean;
  params?: Record<string, unknown>;
};

/**
 * `GET /api/devices`, with the integration rows folded in once they arrive.
 *
 * `integrations` is optional because it comes from a SECOND request. The page
 * renders the roster as soon as `/api/devices` answers, and `/api/integrations`
 * lands after it — an absent list is "not yet", never "none configured".
 */
export type DeviceRoster = WireRoster & {
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

/**
 * What the roster's device rows can ask the panel to do. ONE object handed down
 * the tree rather than a prop per verb: the group → list → entry → rows → row
 * chain threaded six callbacks through five components, and adding Delete meant
 * editing every one of them.
 */
export type DeviceHandlers = {
  edit: (device: DeviceView) => void;
  rename: (device: DeviceView) => void;
  retire: (device: DeviceView) => void;
  restore: (device: DeviceView) => void;
  delete: (device: DeviceView) => void;
};

/** The same, for an integration row. */
export type IntegrationHandlers = {
  edit: (integration: IntegrationView) => void;
  toggle: (integration: IntegrationView, enabled: boolean) => void;
  remove: (integration: IntegrationView) => void;
};
