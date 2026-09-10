/**
 * THE ADD WIZARD'S RULES, with no component around them.
 *
 * "Add device" only ever added a MODBUS device, and that was contractual rather
 * than an oversight: the add body required a `unitId` and a `profileId`. On a
 * bus you type an address and the profile's register map supplies every metric;
 * on a broker there is no address and no register map, so what attaches there is
 * an INTEGRATION — a coded thing — and the tiers had to exist before one dialog
 * could offer both.
 *
 * Four questions, one per step: which endpoint, what to attach to it, how that
 * thing is configured, and is this right. The second question's answer is the
 * server's CATALOG, keyed by the connection's kind — the wizard renders whatever
 * comes back. A `switch (kind)` here would rot the day an `http` connection
 * lands (#80's Home Assistant entity import is HTTP, not MQTT), which is the
 * seam the kind column deliberately left open.
 *
 * State, not effects: every function here takes the state and returns the next
 * one. The component owns the requests.
 */

import type { ConnectionKind } from "../devices/device-types";

/** One field of an entry's settings step, as the server describes it. */
export type CatalogField = {
  name: string;
  type: "string" | "number" | "boolean" | "enum" | "array" | "object";
  required: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  options?: readonly string[];
};

/** One thing that can be attached, as `GET /api/integrations/catalog` returns it. */
export type CatalogEntryView = {
  id: string;
  label: string;
  /** The TIER, deliberately not the transport. See `devices/coded.ts`. */
  via: "profile" | "coded" | "mapping";
  /** False for an auto-provisioned entry: listed elsewhere, never added here. */
  addable: boolean;
  multiInstance: boolean;
  fields: readonly CatalogField[];
};

export type Catalog = {
  modbus: readonly CatalogEntryView[];
  mqtt: readonly CatalogEntryView[];
  /** The connection-less arm: the optimizer, and later the weather device. */
  internal: readonly CatalogEntryView[];
};

export const WIZARD_STEPS = ["connection", "attach", "settings", "confirm"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/**
 * The endpoint the wizard is working on: one that exists, or one being created
 * alongside. A creation states its KIND up front, because the kind is the
 * catalog's key — step 2 would otherwise be unreachable until the row was saved.
 */
export type WizardConnection =
  | { mode: "existing"; id: number }
  | { mode: "create"; kind: ConnectionKind };

export type WizardState = {
  step: WizardStep;
  connection: WizardConnection | null;
  /** The catalog entry picked in step 2. */
  entryId: string | null;
  /** Step 3's answers, keyed by field name. */
  values: Record<string, unknown>;
};

export function emptyWizard(): WizardState {
  return { step: "connection", connection: null, entryId: null, values: {} };
}

/** A connection as the picker knows it — the roster's row, narrowed. */
export type PickableConnection = { id: number; name: string; kind: ConnectionKind };

/** The catalog key the current connection implies, or null while there is none. */
export function wizardKind(
  state: WizardState,
  connections: readonly PickableConnection[],
): ConnectionKind | null {
  const chosen = state.connection;
  if (chosen === null) return null;
  if (chosen.mode === "create") return chosen.kind;
  return connections.find((c) => c.id === chosen.id)?.kind ?? null;
}

/** An integration row as the wizard needs it: which kind sits on which endpoint. */
export type ExistingIntegration = { kind: string; connectionId: number | null };

/** One row of step 2: the entry, and whether this connection already has it. */
export type AttachOption = { entry: CatalogEntryView; taken: boolean };

const ARM: Record<string, keyof Catalog> = { modbus: "modbus", mqtt: "mqtt" };

/**
 * What may be attached to a connection of this kind.
 *
 * Only `addable` entries: the optimizer provisions itself and the devices list
 * is where it is seen. A SINGLE-instance entry that already exists on THIS
 * connection is returned `taken` rather than dropped — a Home Assistant export
 * that silently vanished from the list would look like a missing feature.
 */
export function entriesFor(
  kind: ConnectionKind | null,
  catalog: Catalog,
  existing: readonly ExistingIntegration[],
  connectionId?: number,
): AttachOption[] {
  const arm = kind === null ? undefined : ARM[kind];
  const entries = arm === undefined ? [] : (catalog[arm] ?? []);
  return entries
    .filter((entry) => entry.addable)
    .map((entry) => ({ entry, taken: isTaken(entry, existing, connectionId) }));
}

function isTaken(
  entry: CatalogEntryView,
  existing: readonly ExistingIntegration[],
  connectionId?: number,
): boolean {
  if (entry.multiInstance) return false;
  return existing.some((row) => row.kind === entry.id && row.connectionId === connectionId);
}

/** Step 3's starting answers: each field at the default the server declared. */
function seedValues(entry: CatalogEntryView): Record<string, unknown> {
  const seeded: Record<string, unknown> = {};
  for (const field of entry.fields) {
    if (field.default !== undefined) seeded[field.name] = field.default;
  }
  return seeded;
}

function entryOf(state: WizardState, catalog: Catalog): CatalogEntryView | null {
  const all = [...catalog.modbus, ...catalog.mqtt, ...catalog.internal];
  return all.find((e) => e.id === state.entryId) ?? null;
}

/**
 * The step the wizard cannot leave, or null when it may advance. A step's
 * answer is the only thing that unblocks it — validation of step 3's fields is
 * the server's, which refuses with the field named.
 */
export function blockedAt(
  state: WizardState,
  connections: readonly PickableConnection[],
  catalog: Catalog,
): WizardStep | null {
  if (state.step === "connection") return state.connection === null ? "connection" : null;
  if (state.step === "attach") return entryOf(state, catalog) === null ? "attach" : null;
  return null;
}

export function advance(
  state: WizardState,
  connections: readonly PickableConnection[],
  catalog: Catalog,
): WizardState {
  if (blockedAt(state, connections, catalog) !== null) return state;
  const next = WIZARD_STEPS[WIZARD_STEPS.indexOf(state.step) + 1];
  if (next === undefined) return state;
  const scoped = withScopedEntry(state, connections, catalog);
  return next === "settings"
    ? { ...scoped, step: next, values: valuesFor(scoped, catalog) }
    : { ...scoped, step: next };
}

/**
 * An entry belongs to the kind it was picked under. Changing the connection
 * after picking one must drop it: an EVCC ingest chosen on a broker means
 * nothing on a Modbus gateway, and carrying it across would post a body the
 * server can only refuse.
 */
function withScopedEntry(
  state: WizardState,
  connections: readonly PickableConnection[],
  catalog: Catalog,
): WizardState {
  const kind = wizardKind(state, connections);
  const offered = entriesFor(kind, catalog, []).some((o) => o.entry.id === state.entryId);
  return offered ? state : { ...state, entryId: null, values: {} };
}

function valuesFor(state: WizardState, catalog: Catalog): Record<string, unknown> {
  const entry = entryOf(state, catalog);
  return entry === null ? {} : seedValues(entry);
}

export function goBack(state: WizardState): WizardState {
  const previous = WIZARD_STEPS[WIZARD_STEPS.indexOf(state.step) - 1];
  return previous === undefined ? state : { ...state, step: previous };
}

/**
 * Which endpoint the answer is posted to. The profile tier is a DEVICE — a
 * register map on an address; the coded tier attached to a connection is an
 * INTEGRATION, which may yield devices of its own later (EVCC's loadpoints) or
 * none at all (the Home Assistant export publishes and reads nothing back).
 */
function targetOf(entry: CatalogEntryView): "device" | "integration" {
  return entry.via === "profile" ? "device" : "integration";
}

export type Submission =
  | { target: "device"; body: Record<string, unknown> }
  | {
      target: "integration";
      body: { kind: string; connectionId: number; params: Record<string, unknown> };
    };

/** The request the wizard would send, or null while it could not send one. */
export function submissionOf(
  state: WizardState,
  connections: readonly PickableConnection[],
  catalog: Catalog,
): Submission | null {
  const entry = entryOf(state, catalog);
  const chosen = state.connection;
  // A connection still being created has no id yet: the caller saves it first
  // and asks again with the row it got back.
  if (entry === null || chosen === null || chosen.mode !== "existing") return null;
  if (targetOf(entry) === "integration") {
    return {
      target: "integration",
      body: { kind: entry.id, connectionId: chosen.id, params: { ...state.values } },
    };
  }
  return {
    target: "device",
    body: { via: "profile", connection: { id: chosen.id }, ...state.values },
  };
}
