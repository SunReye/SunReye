// The add-device dialog's rules, out of the component so `bun test` can hold
// them: which option a connection becomes, when a unit id collides, when a
// name is unusable, and what the form turns into on the wire. The component is
// left with binding and rendering.

import * as m from "$lib/paraglide/messages";
import {
  DEFAULT_INVERTER_TEXTS,
  type InverterFields,
  inverterTextsFrom,
  parseInverterFields,
} from "$lib/settings/inverter-fields";
import { SLUG_MAX, slugify } from "@SunReye/inverter-core/slug";
import type { RegisteredProfile } from "../profile-types";
import {
  blankDraft,
  brokerHost,
  connectionAddress,
  connectionCreateBody,
} from "./connection-draft";
import {
  type AddDeviceBody,
  type AddDeviceForm,
  type AddableRole,
  type ConnectionKind,
  type ConnectionView,
  type DevicePatchBody,
  type DeviceRoster,
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
function modbusConnections(connections: readonly ConnectionView[]): ModbusConnectionView[] {
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

/** The dialog's starting state: the first gateway if there is one, its first free unit id, an inverter. */
export function emptyForm(
  connections: readonly ConnectionView[],
  devices: readonly DeviceView[] = [],
): AddDeviceForm {
  const first = modbusConnections(connections)[0];
  const choice = first ? String(first.id) : NEW_CONNECTION;
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
  const inverter = inverterOf(form);
  if (inverter === null) return null;
  return {
    connection,
    role: form.role,
    unitId: form.unitId,
    name: form.name.trim(),
    profileId: form.profileId,
    ...inverter,
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

/**
 * One card of the roster: a gateway and its devices, an integration and its
 * devices, the internal ones, or the devices that genuinely have no endpoint.
 *
 * `kind` is what the card renders from — a gateway is edited from its header, an
 * integration is configured elsewhere, and neither of the last two has anything
 * to edit at all.
 */
export type DeviceGroup = {
  /** Stable `{#each}` key, and the `data-connection` handle a spec addresses. */
  key: string;
  kind: "gateway" | "integration" | "internal" | "orphan";
  title: string;
  /** The words under the title — a connection's kind and address, or null. */
  caption: string | null;
  /** The gateway, on a `gateway` group; null on the other three. */
  connection: ConnectionView | null;
  /** The integration's provenance name, on an `integration` group; null otherwise. */
  integration: string | null;
  devices: DeviceView[];
};

/**
 * The display name of an integration.
 *
 * A label table, not a branch: an integration this build has no name for shows
 * as its own provenance string rather than as an empty header. (`integration`
 * is provenance and the settings UI is the sanctioned reader of it — see
 * `apps/server/src/evcc/evcc-devices.ts`.)
 */
const INTEGRATION_LABELS: Record<string, string> = {
  evcc: "EVCC",
  optimizer: "SunReye Optimizer",
};

function integrationLabel(integration: string): string {
  return INTEGRATION_LABELS[integration] ?? integration;
}

/**
 * The roster as the page shows it: one group per connection in id order, then
 * one per integration by name, then the internal devices, then the devices that
 * have no endpoint for no reason anything here can name (simulate, an imported
 * history whose hardware is gone).
 *
 * All four used to be one group. A `connectionId === null` device was an orphan
 * whatever fed it, so the EVCC loadpoint and the optimizer sat under "No
 * connection" beside a simulated inverter — three unrelated reasons told as one
 * (#213).
 *
 * A connection with no devices is a group too. It is the only kind that can be
 * deleted, and a gateway the operator cannot see is one they cannot delete. An
 * integration with no devices is not: nothing is registered under it.
 */
export function groupByConnection(roster: DeviceRoster): DeviceGroup[] {
  const gateways: DeviceGroup[] = [...roster.connections]
    .sort((a, b) => a.id - b.id)
    .map((connection) => ({
      key: `gateway-${connection.id}`,
      kind: "gateway" as const,
      title: connection.name,
      caption: connectionCaption(connection),
      connection,
      integration: null,
      devices: roster.devices.filter((d) => d.connectionId === connection.id),
    }));
  const endpointless = roster.devices.filter((d) => d.connectionId === null);
  return [
    ...gateways,
    ...integrationGroups(endpointless.filter((d) => d.kind === "coded")),
    ...loose(
      "internal",
      m.devices_group_internal(),
      endpointless.filter((d) => d.kind === "virtual"),
    ),
    ...loose(
      "orphan",
      m.devices_group_no_connection(),
      endpointless.filter((d) => d.kind === "modbus"),
    ),
  ];
}

/** One group per integration, by label, each in roster order. */
function integrationGroups(coded: readonly DeviceView[]): DeviceGroup[] {
  const byIntegration = new Map<string, DeviceView[]>();
  for (const device of coded) {
    const key = device.integration ?? "";
    byIntegration.set(key, [...(byIntegration.get(key) ?? []), device]);
  }
  return [...byIntegration.entries()]
    .map(([integration, devices]) => ({
      key: `integration-${integration}`,
      kind: "integration" as const,
      title: integrationLabel(integration),
      caption: null,
      connection: null,
      integration,
      devices,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** A group that exists only while it holds something. */
function loose(
  kind: "internal" | "orphan",
  title: string,
  devices: readonly DeviceView[],
): DeviceGroup[] {
  if (devices.length === 0) return [];
  return [
    {
      key: kind,
      kind,
      title,
      caption: null,
      connection: null,
      integration: null,
      devices: [...devices],
    },
  ];
}

const TRANSPORT_LABELS: Record<string, string> = {
  tcp: "Modbus TCP",
  "rtu-over-tcp": "Modbus RTU over TCP",
};

/**
 * The words under a connection's name, PER KIND (#217).
 *
 * A gateway says how it is framed, where it is and how often it is read. A
 * broker says which broker it is — it has no framing, no slave ids and no
 * cadence of its own, and rendering the Modbus caption for one produced
 * "undefined:undefined · every NaN s" the moment the second kind existed.
 */
function connectionCaption(connection: ConnectionView): string {
  if (connection.kind === "mqtt") {
    return m.devices_group_caption_mqtt({ broker: brokerHost(connection.params.brokerUrl) });
  }
  const { transport, host, port, pollIntervalMs } = connection.params;
  return m.devices_group_caption({
    transport: TRANSPORT_LABELS[transport] ?? transport,
    host,
    port,
    seconds: pollIntervalMs / 1000,
  });
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

/** What a connection probe answers with: reachable and how long it took, or why not. */
export type ConnectionProbeAnswer =
  | { ok: true; ms: number }
  | { ok: false; ms: number; error: string };

type RawProbe = { ok?: unknown; ms?: unknown; error?: unknown };

/** The elapsed millisecond count an answer states, or 0 when it states none. */
function probeMs(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

/**
 * A `POST /api/connections/probe` response as the discriminated answer the
 * describer takes, with `fallback` standing in when the request itself failed
 * (a dead connection has no body to read a reason out of).
 */
export function connectionProbeAnswer(data: unknown, fallback: string): ConnectionProbeAnswer {
  const raw = (data ?? {}) as RawProbe;
  if (raw.ok === true) return { ok: true, ms: probeMs(raw.ms) };
  return {
    ok: false,
    ms: probeMs(raw.ms),
    error: typeof raw.error === "string" ? raw.error : fallback,
  };
}

/** The success line each kind gets. A table, so a third kind is one entry. */
const PROBE_OK: Record<ConnectionKind, (args: { ms: number }) => string> = {
  modbus: m.devices_ping_ok,
  mqtt: m.devices_broker_ok,
};

/**
 * One line for a CONNECTION probe, per kind.
 *
 * A gateway's success says its port is open; a broker's says it accepted an
 * MQTT CONNECT — a materially stronger claim, since a TCP connect to a broker's
 * port succeeds for every broker that is running, credentials wrong or not.
 * Reporting the Modbus wording for one would tell the operator their broker is
 * reachable when their password is what is broken.
 */
export function describeConnectionProbe(
  kind: ConnectionKind,
  answer: ConnectionProbeAnswer,
): ProbeOutcome {
  if (answer.ok) return { ok: true, message: PROBE_OK[kind]({ ms: answer.ms }) };
  return { ok: false, message: m.devices_ping_failed({ error: answer.error }) };
}

/** What a test-read needs: a Modbus address, a slave id, and the driver to read with. */
export type ProbeTarget = ModbusConnectionView["params"] & {
  unitId: number;
  profileId: string;
};

/**
 * The probe the device dialog can run for its form, or null while it cannot: a
 * gateway that does not exist yet has no address to dial, and without a profile
 * there is no register map to read. The address is the chosen gateway's row,
 * not a draft — the dialog edits the device, and the gateway is edited on its own.
 */
export function probeTargetOf(
  form: AddDeviceForm,
  connections: readonly ConnectionView[],
): ProbeTarget | null {
  if (form.profileId === "") return null;
  const connection = modbusConnections(connections).find(
    (c) => String(c.id) === form.connectionChoice,
  );
  if (!connection) return null;
  return { ...connection.params, unitId: form.unitId, profileId: form.profileId };
}
