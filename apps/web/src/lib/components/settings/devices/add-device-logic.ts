// The add-device dialog's rules, out of the component so `bun test` can hold
// them: which option a connection becomes, when a unit id collides, when a
// name is unusable, and what the form turns into on the wire. The component is
// left with binding and rendering.

import { SLUG_MAX, slugify } from "$lib/slug";
import type { RegisteredProfile } from "../profile-types";
import {
  type AddDeviceBody,
  type AddDeviceForm,
  type AddableRole,
  type ConnectionView,
  type DevicePatchBody,
  type DeviceRoster,
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

export type RefusedField =
  | "name"
  | "unitId"
  | "connection"
  | "connectionId"
  | "role"
  | "profileId"
  | "host";
const REFUSED_FIELDS: ReadonlySet<string> = new Set<RefusedField>([
  "name",
  "unitId",
  "connection",
  "connectionId",
  "role",
  "profileId",
  "host",
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

/** The devices reached through one gateway — or, with `connection` null, through none. */
export type ConnectionGroup = {
  connection: ConnectionView | null;
  devices: DeviceView[];
};

/**
 * The roster as the page shows it: one group per connection in id order, each
 * holding its devices in roster order, then the endpoint-less devices (simulate,
 * an imported history whose hardware is gone) under no gateway at all.
 *
 * A connection with no devices is a group too. It is the only kind that can be
 * deleted, and a gateway the operator cannot see is one they cannot delete.
 */
export function groupByConnection(roster: DeviceRoster): ConnectionGroup[] {
  const groups = [...roster.connections]
    .sort((a, b) => a.id - b.id)
    .map((connection) => ({
      connection,
      devices: roster.devices.filter((d) => d.connectionId === connection.id),
    }));
  const orphans = roster.devices.filter((d) => d.connectionId === null);
  return orphans.length > 0 ? [...groups, { connection: null, devices: orphans }] : groups;
}

const TRANSPORT_LABELS: Record<string, string> = {
  tcp: "Modbus TCP",
  "rtu-over-tcp": "Modbus RTU over TCP",
};

/** The words under a gateway's name: framing, address, cadence. */
export function connectionCaption(connection: ConnectionView) {
  return {
    transport: TRANSPORT_LABELS[connection.transport] ?? connection.transport,
    host: connection.host,
    port: connection.port,
    seconds: connection.pollIntervalMs / 1000,
  };
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
  };
}

/**
 * What an edit changes, field by field, or null when the form is not sendable
 * or changes nothing. Only the changed fields go on the wire: the server's
 * patch is a merge, and an unchanged unit id re-sent alongside a gateway move
 * would be a collision check the operator never asked for.
 */
export function devicePatch(device: DeviceView, form: AddDeviceForm): DevicePatchBody | null {
  const body = buildAddDeviceBody(form);
  if (!body || !("id" in body.connection)) return null;
  const patch: DevicePatchBody = {};
  if (body.name !== device.name) patch.name = body.name;
  if (body.role !== device.role) patch.role = body.role;
  if (body.unitId !== device.unitId) patch.unitId = body.unitId;
  if (body.connection.id !== device.connectionId) patch.connectionId = body.connection.id;
  if (body.profileId !== device.profileId) patch.profileId = body.profileId;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** The two shapes a probe answers with — the server's, or the transport's failure. */
export type ProbeAnswer = {
  ok: boolean;
  error?: string;
  metricCount?: number;
  durationMs?: number;
};

export type ProbeOutcome = { ok: boolean; message: string };

/** One line for a probe: metrics and time on success, the reason otherwise. */
export function describeProbe(
  answer: ProbeAnswer,
  words: {
    ok: (count: number, ms: number) => string;
    failed: (error: string) => string;
  },
): ProbeOutcome {
  if (answer.ok)
    return {
      ok: true,
      message: words.ok(answer.metricCount ?? 0, answer.durationMs ?? 0),
    };
  return { ok: false, message: words.failed(answer.error ?? "") };
}
