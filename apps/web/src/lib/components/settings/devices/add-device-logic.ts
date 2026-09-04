// The add-device dialog's rules, out of the component so `bun test` can hold
// them: which option a connection becomes, when a unit id collides, when a
// name is unusable, and what the form turns into on the wire. The component is
// left with binding and rendering.

import { SLUG_MAX, slugify } from "$lib/slug";
import type { RegisteredProfile } from "../profile-types";
import {
  type AddDeviceBody,
  type AddDeviceForm,
  type ConnectionView,
  type DeviceView,
  NEW_CONNECTION,
  type NewConnection,
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

/** One `<option>` per connection: its name and, when it has one, its address. */
export function connectionOptions(connections: readonly ConnectionView[]): SelectOption[] {
  return connections.map((c) => ({
    value: String(c.id),
    label: c.host ? `${c.name} · ${c.host}:${c.port}` : c.name,
  }));
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

/** The dialog's starting state: the first gateway if there is one, its first free unit id, an inverter. */
export function emptyForm(
  connections: readonly ConnectionView[],
  devices: readonly DeviceView[] = [],
): AddDeviceForm {
  const first = connections[0];
  const choice = first ? String(first.id) : NEW_CONNECTION;
  return {
    connectionChoice: choice,
    newConnection: {
      name: defaultConnectionName(connections),
      host: "",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    },
    role: "inverter",
    unitId: firstFreeUnitId(takenUnitIds(devices, choice)),
    name: "",
    profileId: "",
  };
}

function validUnitId(unitId: number): boolean {
  return Number.isInteger(unitId) && unitId >= UNIT_ID_MIN && unitId <= UNIT_ID_MAX;
}

function connectionOf(form: AddDeviceForm): AddDeviceBody["connection"] | null {
  if (form.connectionChoice === NEW_CONNECTION) {
    const host = form.newConnection.host.trim();
    if (host === "") return null;
    const create: NewConnection = {
      ...form.newConnection,
      host,
      name: form.newConnection.name.trim(),
    };
    return { create };
  }
  const id = Number(form.connectionChoice);
  return Number.isInteger(id) && id > 0 ? { id } : null;
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
  if (!connection) return null;
  if (!validUnitId(form.unitId)) return null;
  if (nameProblem(form.name) !== null) return null;
  if (form.profileId === "") return null;
  return {
    connection,
    role: form.role,
    unitId: form.unitId,
    name: form.name.trim(),
    profileId: form.profileId,
  };
}

export type RefusedField = "name" | "unitId" | "connection" | "role" | "profileId";
const REFUSED_FIELDS: ReadonlySet<string> = new Set<RefusedField>([
  "name",
  "unitId",
  "connection",
  "role",
  "profileId",
]);

/** Which field a `{ error, field }` refusal points at, so the message lands under it. */
function refusedField(value: unknown): RefusedField | null {
  const field = (value as { field?: unknown } | null | undefined)?.field;
  return typeof field === "string" && REFUSED_FIELDS.has(field) ? (field as RefusedField) : null;
}

export type Refusal = { field: RefusedField | null; message: string };

/**
 * A failed `POST /api/devices` as the dialog shows it: the server's reason,
 * and the field it belongs under — null when it belongs in a toast instead.
 */
export function describeRefusal(value: unknown, fallback: string): Refusal {
  const error = (value as { error?: unknown } | null | undefined)?.error;
  return {
    field: refusedField(value),
    message: typeof error === "string" ? error : fallback,
  };
}
