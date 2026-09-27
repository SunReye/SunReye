// The device form's rules, out of the component so `bun test` can hold them:
// which option a connection becomes, when a unit id collides, when a name is
// unusable (and when a rename is), and what the form turns into on the wire.
// The components are left with binding and rendering.

import {
  DEFAULT_INVERTER_TEXTS,
  type InverterFields,
  inverterTextsFrom,
  parseInverterFields,
} from "$lib/settings/inverter-fields";
import { SLUG_MAX, slugify } from "@SunReye/inverter-core/slug";
import type { RegisteredProfile } from "../profile-types";
import { blankDraft, connectionAddress, connectionCreateBody } from "./connection-draft";
import {
  type AddDeviceBody,
  type AddDeviceForm,
  type AddableRole,
  type ConnectionView,
  type DevicePatchBody,
  type DeviceView,
  type ModbusConnectionView,
  NEW_CONNECTION,
} from "./device-types";

export type SelectOption = { value: string; label: string };

/** Modbus slave ids, the server's bounds: 0 is allowed (gateways answer on it), 248+ reserved. */
const UNIT_ID_MIN = 0;
const UNIT_ID_MAX = 247;

/** Every unit id a device may take, for the picker. */
export const UNIT_IDS: readonly number[] = Array.from(
  { length: UNIT_ID_MAX - UNIT_ID_MIN + 1 },
  (_, i) => UNIT_ID_MIN + i,
);

/**
 * The connections a device in this dialog can be addressed on.
 *
 * Modbus only, and that is the whole rule: a device here has a slave id and a
 * register profile, and a broker carries neither. The devices that WILL sit on
 * a broker are the mapped ones (#79–#84) and the coded loadpoints, which the
 * EVCC registrar creates — never this dialog. Offering a broker would offer an
 * address that no `POST /api/devices` body can describe.
 */
export function modbusConnections(connections: readonly ConnectionView[]): ModbusConnectionView[] {
  return connections.filter((c): c is ModbusConnectionView => c.kind === "modbus");
}

/** One `<option>` per addressable connection: its name and, when it has one, its address. */
export function connectionOptions(connections: readonly ConnectionView[]): SelectOption[] {
  return modbusConnections(connections).map((c) => {
    const address = connectionAddress(c);
    return { value: String(c.id), label: address === "" ? c.name : `${c.name} · ${address}` };
  });
}

/** "Gateway N" past the connections that exist — a default the operator can overwrite. */
function defaultConnectionName(connections: readonly ConnectionView[]): string {
  return `Gateway ${connections.length + 1}`;
}

/**
 * The unit ids already taken on the chosen connection, by in-service devices.
 *
 * Only THAT connection: `devices_connection_unit_key` is per gateway, so the
 * same unit id on another gateway is a different machine and stays free. A
 * retired device does not hold its id — the index skips it too. A new
 * connection has no devices yet.
 */
export function takenUnitIds(
  devices: readonly DeviceView[],
  connectionChoice: string,
): ReadonlySet<number> {
  if (connectionChoice === NEW_CONNECTION) return new Set();
  const connectionId = Number(connectionChoice);
  return new Set(
    devices
      .filter((d) => d.retiredAt === null && d.connectionId === connectionId)
      .map((d) => d.unitId),
  );
}

/** The lowest free unit id on the connection — the picker's default. */
function firstFreeUnitId(taken: ReadonlySet<number>): number {
  return UNIT_IDS.find((id) => !taken.has(id)) ?? UNIT_ID_MIN;
}

/**
 * Why a name cannot be used, or null when it can.
 *
 * The same two rules the server applies (`nameSchema` in
 * `apps/server/src/devices/device-admin.ts`): it must slug to something, and it
 * must not be longer than the slug ceiling — `slugify` SLICES, so a longer name
 * would be cut into a frozen slug the operator never chose.
 */
export function nameProblem(name: string): "empty" | "too-long" | null {
  const trimmed = name.trim();
  if (trimmed.length > SLUG_MAX) return "too-long";
  if (slugify(trimmed) === "") return "empty";
  return null;
}

export type ProfileGroup = { manufacturer: string; options: SelectOption[] };

/** Registered profiles as `<optgroup>`s by manufacturer, both levels sorted. */
export function profileGroups(
  profiles: readonly RegisteredProfile[],
  builtinLabel: string,
): ProfileGroup[] {
  const byManufacturer = new Map<string, SelectOption[]>();
  for (const p of profiles) {
    const detail = p.builtin ? builtinLabel : p.version ? `v${p.version}` : "";
    const option = {
      value: p.id,
      label: detail ? `${p.name} · ${detail}` : p.name,
    };
    const key = p.manufacturer || "Other";
    byManufacturer.set(key, [...(byManufacturer.get(key) ?? []), option]);
  }
  return [...byManufacturer.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([manufacturer, options]) => ({
      manufacturer,
      options: options.sort((a, b) => a.label.localeCompare(b.label)),
    }));
}

/** The gateway a fresh form starts on: the first one there is, else "create one". */
function defaultChoice(connections: readonly ConnectionView[]): string {
  const first = modbusConnections(connections)[0];
  return first ? String(first.id) : NEW_CONNECTION;
}

/**
 * The dialog's starting state: the first gateway if there is one, its first free
 * unit id, an inverter.
 *
 * `choice` overrides which gateway that is, for the ADD WIZARD: there, step 1
 * has already asked which endpoint, so the form must open on that one — and the
 * free unit id must be computed against that one's devices rather than the
 * first gateway's. The dialog passes nothing and keeps its own default.
 */
export function emptyForm(
  connections: readonly ConnectionView[],
  devices: readonly DeviceView[] = [],
  choice: string = defaultChoice(connections),
): AddDeviceForm {
  return {
    connectionChoice: choice,
    newConnection: blankDraft(defaultConnectionName(connections)),
    role: "inverter",
    unitId: firstFreeUnitId(takenUnitIds(devices, choice)),
    name: "",
    profileId: "",
    inverter: { ...DEFAULT_INVERTER_TEXTS, arrays: [] },
  };
}

/**
 * The inverter section as the request wants it: the parsed fields for an
 * inverter, nothing at all for any other role (the server refuses them there),
 * and `null` when a filled field cannot be read — which blocks the submit.
 */
function inverterOf(form: AddDeviceForm): Partial<InverterFields> | null {
  if (form.role !== "inverter") return {};
  return parseInverterFields(form.inverter);
}

function validUnitId(unitId: number): boolean {
  return Number.isInteger(unitId) && unitId >= UNIT_ID_MIN && unitId <= UNIT_ID_MAX;
}

function connectionOf(form: AddDeviceForm): AddDeviceBody["connection"] | null {
  if (form.connectionChoice === NEW_CONNECTION) {
    const create = connectionCreateBody(form.newConnection);
    return create === null ? null : { create };
  }
  const id = Number(form.connectionChoice);
  return Number.isInteger(id) && id > 0 ? { id } : null;
}

/**
 * The DEVICE half of the request — everything but which endpoint it hangs on —
 * or null while one of its fields is not yet sendable.
 *
 * Split out for the add wizard's step 3, which asks these fields and only these:
 * the endpoint was step 1's question, and on the create arm it has no id yet, so
 * a gate that ran {@link connectionOf} would hold the step for a question the
 * operator has already answered.
 */
export function deviceFieldsOf(form: AddDeviceForm): Omit<AddDeviceBody, "connection"> | null {
  if (!validUnitId(form.unitId)) return null;
  if (nameProblem(form.name) !== null) return null;
  if (form.profileId === "") return null;
  const inverter = inverterOf(form);
  if (inverter === null) return null;
  return {
    role: form.role,
    unitId: form.unitId,
    name: form.name.trim(),
    profileId: form.profileId,
    ...inverter,
  };
}

/**
 * The request the form describes, or null while it is not yet sendable.
 *
 * Null rather than a list of problems on purpose: the fields show their own
 * hints as the operator types, and this one answer is what the submit button
 * binds its `disabled` to.
 */
export function buildAddDeviceBody(form: AddDeviceForm): AddDeviceBody | null {
  const connection = connectionOf(form);
  const fields = deviceFieldsOf(form);
  if (connection === null || fields === null) return null;
  return { connection, ...fields };
}

/**
 * The edit form for an existing device: its own values, on its own gateway. An
 * endpoint-less device starts on the first gateway so the edit can bind it.
 */
export function formFromDevice(
  device: DeviceView,
  connections: readonly ConnectionView[],
): AddDeviceForm {
  const base = emptyForm(connections);
  return {
    ...base,
    connectionChoice:
      device.connectionId === null ? base.connectionChoice : String(device.connectionId),
    role: (device.role as AddableRole) ?? "inverter",
    unitId: device.unitId,
    name: device.name,
    profileId: device.profileId,
    inverter: inverterTextsFrom(device),
  };
}

/** Structural equality for the two JSON-shaped inverter fields. */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The fields an edit may change, each with what the device currently says.
 * `connectionId` is read off the body's connection arm; the rest are named
 * alike on both sides. Arrays and the pack compare by value.
 */
const PATCHABLE = [
  "name",
  "role",
  "unitId",
  "profileId",
  "arrays",
  "tempCoefficient",
  "systemLoss",
  "battery",
] as const;

/**
 * What an edit changes, field by field, or null when the form is not sendable
 * or changes nothing. Only the changed fields go on the wire: the server's
 * patch is a merge, and an unchanged unit id re-sent alongside a gateway move
 * would be a collision check the operator never asked for. A meter's body
 * carries no inverter field, so none can be sent for it.
 */
export function devicePatch(device: DeviceView, form: AddDeviceForm): DevicePatchBody | null {
  const body = buildAddDeviceBody(form);
  if (!body || !("id" in body.connection)) return null;
  const patch: Record<string, unknown> = {};
  for (const key of PATCHABLE) {
    const next = body[key];
    if (next !== undefined && !same(next, device[key])) patch[key] = next;
  }
  if (body.connection.id !== device.connectionId) patch.connectionId = body.connection.id;
  return Object.keys(patch).length > 0 ? (patch as DevicePatchBody) : null;
}

/**
 * The name-only edit, as rules rather than as a form.
 *
 * A coded or a virtual row has no addressing the operator may change (#219
 * narrowed the server's refusal to exactly that), so what is left is the label
 * — and the three ways a label is not submittable are worth a test each: it is
 * empty, it breaks the slug rules, or it is what the row is already called.
 */
export type RenameState = {
  /** What the operator typed, untrimmed — the field's own value. */
  typed: string;
  /** The row's current name, or null when no row is open. */
  current: string | null;
  submitting: boolean;
};

/** Why Save is refused, or null when it is not. */
export type RenameBlock = "no-row" | "submitting" | "empty" | "invalid" | "unchanged";

export function renameBlock(state: RenameState): RenameBlock | null {
  if (state.current === null) return "no-row";
  if (state.submitting) return "submitting";
  const trimmed = state.typed.trim();
  if (trimmed === "") return "empty";
  if (nameProblem(state.typed) !== null) return "invalid";
  // An unchanged name is not an error, it is a no-op: the PATCH would be a
  // round trip for nothing, and `nothing to change` would come back a 400.
  return trimmed === state.current ? "unchanged" : null;
}
