/**
 * The device roster: what the plant has (devices, connections, integrations,
 * and the catalog and profiles an add needs) and every write to it — with the
 * refusal decoded and the lists re-read once, here, instead of in seven dialogs.
 * The transport is a parameter: `./roster-transport.ts` is the Eden adapter,
 * the test's in-memory one is the other. Views hold the state in `$state` via
 * `./device-roster.svelte.ts` and say the words; this module decides.
 */

import type { DeviceRoster as WireRoster, IntegrationList } from "@SunReye/contracts/devices";
import { apiErrorText } from "$lib/api-error";
import * as m from "$lib/paraglide/messages";
import type { RegisteredProfile } from "../profile-types";
import type { Catalog } from "../wizard/add-wizard";
import { type DeviceGroup, groupByConnection } from "./roster-groups";
import type { ConnectionCreate, MqttParamsBody } from "./connection-draft";
import type {
  AddDeviceBody,
  ConnectionView,
  DevicePatchBody,
  DeviceView,
  IntegrationPatchBody,
  IntegrationView,
  ModbusParams,
} from "./device-types";

/** The form fields a server refusal can name, so its message lands under one. */
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

/** A request's answer: the body, or the failure body (undefined when there was none). */
export type Answer<T> = { ok: true; data: T } | { ok: false; error: unknown };

/** What `PATCH /api/connections/:id` takes: the label and params, never the kind. */
export type ConnectionPatch = { name: string; params: ModbusParams | MqttParamsBody };

/** What `POST /api/integrations` takes. */
export type IntegrationCreate = {
  kind: string;
  connectionId: number;
  params: Record<string, unknown>;
};

/** What either add flow submits. The wizard's `Submission` is one of these. */
export type RosterSubmission =
  | { target: "device"; body: AddDeviceBody }
  | { target: "integration"; body: IntegrationCreate };

/** The seam. Every call the roster makes, and nothing that decides. */
export interface RosterTransport {
  devices(): Promise<Answer<WireRoster>>;
  integrations(): Promise<Answer<IntegrationList>>;
  catalog(): Promise<Answer<Catalog>>;
  profiles(): Promise<Answer<RegisteredProfile[]>>;
  addDevice(body: AddDeviceBody): Promise<Answer<DeviceView>>;
  patchDevice(
    id: number,
    body: DevicePatchBody & { retired?: boolean },
  ): Promise<Answer<DeviceView>>;
  deleteDevice(id: number): Promise<Answer<unknown>>;
  addConnection(body: ConnectionCreate): Promise<Answer<ConnectionView>>;
  patchConnection(id: number, body: ConnectionPatch): Promise<Answer<ConnectionView>>;
  deleteConnection(id: number): Promise<Answer<unknown>>;
  addIntegration(body: IntegrationCreate): Promise<Answer<unknown>>;
  patchIntegration(id: number, body: IntegrationPatchBody): Promise<Answer<unknown>>;
  deleteIntegration(id: number): Promise<Answer<unknown>>;
}

/** How a write that failed failed. */
export type WriteFailure =
  /** The server named a field this UI has a place for. */
  | { kind: "refused"; field: RefusedField; reason: string }
  /** `DELETE /api/devices/:id` on a device with readings: offer retiring instead. */
  | { kind: "has-history" }
  /**
   * Anything else. `text` is the readable reason wherever the body carries one
   * (`apiErrorText`); `stated` is only the server's own `error` sentence, or
   * null — the device dialogs have always said that or "unknown", nothing else.
   */
  | { kind: "error"; text: string; stated: string | null };

export type WriteOutcome<T> = { kind: "ok"; value: T } | WriteFailure;

/** The one sentence a failure is, for a view that has no field to put it under. */
export function failureText(failure: WriteFailure): string {
  if (failure.kind === "refused") return failure.reason;
  if (failure.kind === "error") return failure.text;
  return m.error_unknown();
}

/** The server's own sentence for a failure, else "unknown" — never a serialised body. */
export function statedReason(failure: WriteFailure): string {
  if (failure.kind === "refused") return failure.reason;
  if (failure.kind === "error") return failure.stated ?? m.error_unknown();
  return m.error_unknown();
}

const fieldOf = (value: unknown, key: string): unknown =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

/** A failure body, decoded once: the history refusal, a field refusal, or words. */
function failureOf(error: unknown): WriteFailure {
  if (fieldOf(error, "field") === "history") return { kind: "has-history" };
  const said = fieldOf(error, "error");
  const field = refusedField(error);
  if (field !== null)
    return { kind: "refused", field, reason: typeof said === "string" ? said : m.error_unknown() };
  const stated = typeof said === "string" && said !== "" ? said : null;
  return { kind: "error", text: apiErrorText(error, m.error_unknown()), stated };
}

/** The reactive half — a `$state` proxy in the app, a plain object in a test. */
export type RosterState = {
  roster: WireRoster | null;
  integrations: IntegrationView[];
  catalog: Catalog;
  profiles: RegisteredProfile[];
  loadFailed: boolean;
};

export function emptyRosterState(): RosterState {
  return {
    roster: null,
    integrations: [],
    catalog: { modbus: [], mqtt: [], internal: [] },
    profiles: [],
    loadFailed: false,
  };
}

/**
 * What a successful write is followed by. `reload` re-reads the lists it
 * touched — the settings panel. `leave` re-reads nothing, because the flow
 * navigates away once it is done (the add wizard); it keeps a created
 * connection, which the flow's next request is sent against.
 */
export type RosterPolicy = { afterWrite: "reload" | "leave" };

/** Which lists a write touched. */
type Touched = "devices" | "devices+integrations";

/** The roster's interface: what a view reads, and every write it may ask for. */
export interface DeviceRoster {
  readonly devices: DeviceView[];
  readonly connections: ConnectionView[];
  readonly integrations: IntegrationView[];
  readonly catalog: Catalog;
  readonly profiles: RegisteredProfile[];
  /** Whether the roster has answered once. */
  readonly loaded: boolean;
  readonly loadFailed: boolean;
  /** The roster as the page shows it, integrations folded in; none before it answers. */
  readonly groups: DeviceGroup[];
  /** The roster, the integration rows and the catalog. Profiles are {@link loadProfiles}. */
  load(): Promise<void>;
  loadProfiles(): Promise<void>;
  add(
    submission: Extract<RosterSubmission, { target: "device" }>,
  ): Promise<WriteOutcome<DeviceView>>;
  add(submission: RosterSubmission): Promise<WriteOutcome<unknown>>;
  patch(id: number, body: DevicePatchBody): Promise<WriteOutcome<DeviceView>>;
  retire(id: number): Promise<WriteOutcome<DeviceView>>;
  restore(id: number): Promise<WriteOutcome<DeviceView>>;
  delete(id: number): Promise<WriteOutcome<unknown>>;
  addConnection(body: ConnectionCreate): Promise<WriteOutcome<ConnectionView>>;
  patchConnection(id: number, body: ConnectionPatch): Promise<WriteOutcome<ConnectionView>>;
  deleteConnection(id: number): Promise<WriteOutcome<unknown>>;
  /** The roster too: settings can change which devices an integration yields. */
  patchIntegration(id: number, body: IntegrationPatchBody): Promise<WriteOutcome<unknown>>;
  /**
   * The roster too: removing an EVCC ingest retires its loadpoints. `afterWrite`
   * overrides the policy for a page that is ABOUT the row, and leaves once it is gone.
   */
  removeIntegration(
    id: number,
    afterWrite?: RosterPolicy["afterWrite"],
  ): Promise<WriteOutcome<unknown>>;
}

export function createDeviceRoster(
  transport: RosterTransport,
  state: RosterState,
  policy: RosterPolicy,
): DeviceRoster {
  async function readDevices(): Promise<void> {
    const answer = await transport.devices();
    state.loadFailed = !answer.ok;
    if (answer.ok) state.roster = answer.data;
  }

  async function readIntegrations(): Promise<void> {
    const answer = await transport.integrations();
    if (answer.ok) state.integrations = answer.data.integrations;
  }

  async function readCatalog(): Promise<void> {
    const answer = await transport.catalog();
    if (answer.ok) state.catalog = answer.data;
  }

  async function reload(touched: Touched): Promise<void> {
    if (touched === "devices") return readDevices();
    await Promise.all([readDevices(), readIntegrations()]);
  }

  async function write<T>(
    request: Promise<Answer<T>>,
    touched: Touched,
    afterWrite = policy.afterWrite,
  ): Promise<WriteOutcome<T>> {
    const answer = await request;
    if (!answer.ok) return failureOf(answer.error);
    if (afterWrite === "reload") await reload(touched);
    return { kind: "ok", value: answer.data };
  }

  /** A created connection, kept without a re-read — see {@link RosterPolicy}. */
  function keep(connection: ConnectionView): void {
    const roster = state.roster ?? { devices: [], connections: [] };
    state.roster = { ...roster, connections: [...roster.connections, connection] };
  }

  function add(submission: RosterSubmission): Promise<WriteOutcome<unknown>> {
    if (submission.target === "integration")
      return write(transport.addIntegration(submission.body), "devices+integrations");
    return write(transport.addDevice(submission.body), "devices");
  }

  return {
    get devices() {
      return state.roster?.devices ?? [];
    },
    get connections() {
      return state.roster?.connections ?? [];
    },
    get integrations() {
      return state.integrations;
    },
    get catalog() {
      return state.catalog;
    },
    get profiles() {
      return state.profiles;
    },
    get loaded() {
      return state.roster !== null;
    },
    get loadFailed() {
      return state.loadFailed;
    },
    get groups() {
      const roster = state.roster;
      return roster ? groupByConnection({ ...roster, integrations: state.integrations }) : [];
    },
    load: async () => {
      await Promise.all([readDevices(), readIntegrations(), readCatalog()]);
    },
    loadProfiles: async () => {
      const answer = await transport.profiles();
      if (answer.ok) state.profiles = answer.data;
    },
    // The overloads narrow what a DEVICE add answers; the one body serves both.
    add: add as DeviceRoster["add"],
    patch: (id, body) => write(transport.patchDevice(id, body), "devices"),
    retire: (id) => write(transport.patchDevice(id, { retired: true }), "devices"),
    restore: (id) => write(transport.patchDevice(id, { retired: false }), "devices"),
    delete: (id) => write(transport.deleteDevice(id), "devices"),
    addConnection: async (body) => {
      const outcome = await write(transport.addConnection(body), "devices");
      if (outcome.kind === "ok" && policy.afterWrite === "leave") keep(outcome.value);
      return outcome;
    },
    patchConnection: (id, body) => write(transport.patchConnection(id, body), "devices"),
    deleteConnection: (id) => write(transport.deleteConnection(id), "devices"),
    patchIntegration: (id, body) =>
      write(transport.patchIntegration(id, body), "devices+integrations"),
    removeIntegration: (id, afterWrite = policy.afterWrite) =>
      write(transport.deleteIntegration(id), "devices+integrations", afterWrite),
  };
}
