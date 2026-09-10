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

import { buildAddDeviceBody, deviceFieldsOf, emptyForm } from "../devices/add-device-logic";
import {
  type AddDeviceBody,
  type AddDeviceForm,
  type ConnectionKind,
  type ConnectionView,
  type DeviceView,
  NEW_CONNECTION,
} from "../devices/device-types";

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

/**
 * STEP 3'S ANSWERS, DISCRIMINATED BY THE TIER THAT ASKED THEM.
 *
 * A coded integration's settings are two or three scalars the server described,
 * so a bag keyed by field name is exactly the right shape and the generic
 * renderer draws it.
 *
 * A DEVICE is not that. It is a name, a role, a slave id, a register profile and
 * — for an inverter — a roof and a pack, which is the add dialog's own form and
 * nothing less. Asked as a catalog form it rendered "arrays: array" and
 * "battery: object", offered a text box where the profile picker belongs, and
 * never asked for the NAME that `POST /api/devices` requires, so the whole
 * Modbus arm could not succeed. Carrying the dialog's `AddDeviceForm` here is
 * what lets step 3 render the dialog's own fields and reuse its rules.
 */
export type WizardAnswers =
  | { via: "coded"; values: Record<string, unknown> }
  | { via: "profile"; form: AddDeviceForm };

/** No answers yet: what step 3 holds before an entry has seeded it. */
const NO_ANSWERS: WizardAnswers = { via: "coded", values: {} };

export type WizardState = {
  step: WizardStep;
  connection: WizardConnection | null;
  /** The catalog entry picked in step 2. */
  entryId: string | null;
  /** Step 3's answers, in the shape the picked entry's tier calls for. */
  answers: WizardAnswers;
};

export function emptyWizard(): WizardState {
  return { step: "connection", connection: null, entryId: null, answers: NO_ANSWERS };
}

/**
 * What seeding a DEVICE form needs — the roster the panel has already loaded.
 *
 * Handed in rather than fetched here for the reason the whole module exists:
 * these are rules, and the component owns the requests. The gateway list gives
 * the form its endpoint, the device list gives it the first unit id that is
 * free ON THAT endpoint.
 */
export type DeviceSeed = {
  connections: readonly ConnectionView[];
  devices: readonly DeviceView[];
};

const NO_SEED: DeviceSeed = { connections: [], devices: [] };

/** A connection as the picker knows it — the roster's row, narrowed. */
export type PickableConnection = { id: number; name: string; kind: ConnectionKind };

/**
 * What step 1's select value names: a row, the create arm, or no answer.
 *
 * The create arm is a sentinel option rather than a second control ­— it is one
 * more answer to the same question, and an operator with no endpoint yet must
 * not have to find a different affordance to make their first. The sentinel is
 * the device dialog's own {@link NEW_CONNECTION}: one spelling of "not an id"
 * for both selects.
 *
 * `kind` is the kind the new-connection form is currently showing. The create
 * arm has to state one, because the kind is the catalog's key and step 2 would
 * otherwise be unreachable until the row was saved.
 */
export function connectionChoice(value: string, kind: ConnectionKind): WizardConnection | null {
  if (value === NEW_CONNECTION) return { mode: "create", kind };
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? { mode: "existing", id } : null;
}

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
 * The step the wizard cannot leave, or null when it may advance.
 *
 * `connectionReady` is the new-connection form's own answer to "could this be
 * saved" — a boolean, so these rules never learn what a broker URL is. It says
 * nothing about a row that already exists, and defaults to true for every
 * caller that is not on the create arm.
 *
 * One answer per step, in a table rather than a chain of branches: the chain
 * was a `return null` at the bottom that quietly let step 3 through, and step 3
 * on the device arm is exactly where a hold is needed.
 */
export function blockedAt(
  state: WizardState,
  connections: readonly PickableConnection[],
  catalog: Catalog,
  connectionReady = true,
): WizardStep | null {
  const answered: Record<WizardStep, boolean> = {
    connection: connectionAnswered(state, connectionReady),
    attach: entryOf(state, catalog) !== null,
    settings: settingsAnswered(state.answers),
    confirm: true,
  };
  return answered[state.step] ? null : state.step;
}

/**
 * Step 3 holds ONLY on the device arm.
 *
 * A coded integration's params are the server's to validate — it refuses with
 * the field named, and the settings step shows the refusal. A device cannot be
 * refused that usefully from here: without a name the add is a 400 the operator
 * has no field to fix, so the form's own "could this be submitted" holds Next.
 */
function settingsAnswered(answers: WizardAnswers): boolean {
  return answers.via !== "profile" || deviceFieldsOf(answers.form) !== null;
}

/** Step 1 is answered by a chosen row, or by a draft that could be saved. */
function connectionAnswered(state: WizardState, connectionReady: boolean): boolean {
  const chosen = state.connection;
  if (chosen === null) return false;
  return chosen.mode === "existing" || connectionReady;
}

export function advance(
  state: WizardState,
  connections: readonly PickableConnection[],
  catalog: Catalog,
  connectionReady = true,
  seed: DeviceSeed = NO_SEED,
): WizardState {
  if (blockedAt(state, connections, catalog, connectionReady) !== null) return state;
  const next = WIZARD_STEPS[WIZARD_STEPS.indexOf(state.step) + 1];
  if (next === undefined) return state;
  const scoped = withScopedEntry(state, connections, catalog);
  return next === "settings"
    ? { ...scoped, step: next, answers: answersFor(scoped, catalog, seed) }
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
  return offered ? state : { ...state, entryId: null, answers: NO_ANSWERS };
}

/** Step 3's starting answers, in the shape the entry's tier calls for. */
function answersFor(state: WizardState, catalog: Catalog, seed: DeviceSeed): WizardAnswers {
  const entry = entryOf(state, catalog);
  if (entry === null) return NO_ANSWERS;
  return entry.via === "profile"
    ? { via: "profile", form: seedForm(state, seed) }
    : { via: "coded", values: seedValues(entry) };
}

/**
 * A device form opened ON THE ENDPOINT STEP 1 ALREADY CHOSE.
 *
 * The dialog's own starting state, with the connection forced rather than
 * defaulted: the wizard asked that question first, and the form's own gateway
 * select is not rendered here. A connection still being created is the
 * {@link NEW_CONNECTION} sentinel — nothing is addressed on a row that does not
 * exist, so every unit id is free, which is the answer `takenUnitIds` already
 * gives for it. The id itself is folded in at submission, once there is one.
 */
function seedForm(state: WizardState, seed: DeviceSeed): AddDeviceForm {
  const chosen = state.connection;
  const choice = chosen?.mode === "existing" ? String(chosen.id) : NEW_CONNECTION;
  return emptyForm(seed.connections, seed.devices, choice);
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
  | { target: "device"; body: AddDeviceBody & { via: "profile" } }
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
      body: { kind: entry.id, connectionId: chosen.id, params: codedValues(state.answers) },
    };
  }
  return deviceSubmission(state.answers, chosen.id);
}

/** A coded entry's answers; nothing at all if step 3 was never on that arm. */
function codedValues(answers: WizardAnswers): Record<string, unknown> {
  return answers.via === "coded" ? { ...answers.values } : {};
}

/**
 * The device body, built through the DIALOG'S OWN builder.
 *
 * Not assembled here: `buildAddDeviceBody` is where the unit-id bounds, the
 * name trim, the "no PV fields on a meter" rule and the connection arm are
 * decided, and a second spelling of them in the wizard is a form that offers
 * what the route then refuses. The chosen row's id is substituted for the
 * form's own gateway choice, which may still be the create sentinel.
 *
 * Null while the form is incomplete, exactly as an unsaved connection is null:
 * the caller sends nothing rather than a body it knows will 400.
 */
function deviceSubmission(answers: WizardAnswers, connectionId: number): Submission | null {
  if (answers.via !== "profile") return null;
  const body = buildAddDeviceBody({ ...answers.form, connectionChoice: String(connectionId) });
  return body === null ? null : { target: "device", body: { via: "profile", ...body } };
}

/**
 * WHAT THE FINISH BUTTON DOES, IN THE ORDER IT MUST HAPPEN.
 *
 * A connection being created is created HERE, at finish, and never when step 1
 * was left: a wizard abandoned at step 3 would otherwise leave an orphan
 * endpoint row behind that nothing polls and nobody remembers making. So the
 * create arm plans `create-connection` first; the caller saves the row, folds
 * the id back in with {@link withSavedConnection}, and asks again — which then
 * answers `send`, addressed at the row that now exists.
 *
 * The sequencing lives here rather than inside the component so it can be
 * asserted without a browser: which request goes first, and what turns the
 * first one's answer into the second one's address, is a rule and not a render.
 */
export type SubmitPlan =
  | { do: "create-connection"; kind: ConnectionKind }
  | { do: "send"; submission: Submission }
  | { do: "nothing" };

export function submitPlan(
  state: WizardState,
  connections: readonly PickableConnection[],
  catalog: Catalog,
): SubmitPlan {
  const chosen = state.connection;
  if (chosen?.mode === "create") return { do: "create-connection", kind: chosen.kind };
  const submission = submissionOf(state, connections, catalog);
  return submission === null ? { do: "nothing" } : { do: "send", submission };
}

/**
 * The wizard after its connection was saved: the same answers, now addressed at
 * the row that came back.
 *
 * Also the recovery from a HALF-SUCCESS — the connection created and the thing
 * on it refused. Pressing Add again then attaches to that row rather than
 * creating a second endpoint with the same name.
 */
export function withSavedConnection(state: WizardState, id: number): WizardState {
  return { ...state, connection: { mode: "existing", id } };
}
