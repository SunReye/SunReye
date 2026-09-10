/**
 * The operator's integration list: what is configured, add one, toggle or
 * re-configure one, un-configure one — the logic behind `../routes/integrations.ts`.
 *
 * Dependency-injected like `../devices/device-admin.ts`, and for the same
 * reason: the route layer has no automated cover beyond a smoke sweep, so
 * everything that can go wrong in ORDER — a row written before its connection
 * was checked, a reload after a write that never landed, a 409 that should have
 * been a 400, a delete that took five years of readings with it — has to be
 * provable against doubles. `./integration-admin.test.ts` is that proof.
 *
 * WHAT AN INTEGRATION IS HERE
 *
 * A row of `integrations` (`@SunReye/db/integrations`): the EVCC ingest, which
 * subscribes on an MQTT connection and YIELDS loadpoint devices, and the Home
 * Assistant export, which publishes on one and yields nothing. Its PRESENCE is
 * what "configured" means; `enabled` is the off switch for a configured one.
 *
 * WHAT THIS MODULE NEVER DOES: INVENT A SECOND CATALOG
 *
 * Which integration may sit on which connection kind, what it is called, whether
 * a second may join it, and what its settings step accepts are all ONE lookup —
 * `../devices/integration-catalog.ts`, which the wizard renders from. A rule
 * spelled here as well would be a form that offers what the route then refuses,
 * which is the same defect as no validation at all: the operator sees a page
 * that lies. So the catalog is a DEPENDENCY, every refusal below is derived from
 * an entry, and adding a kind is an entry rather than an edit here.
 */

import type { ConnectionKind } from "@SunReye/db/connection-kinds";
import {
  INTEGRATION_KINDS,
  type IntegrationKind,
  type IntegrationParams,
} from "@SunReye/db/integrations";
import type {
  IntegrationPatch,
  IntegrationRecord,
  IntegrationSpec,
} from "@SunReye/db/integrations-store";
import type {
  ConnectionRecord,
  DevicePatch,
  DeviceRecord,
  PlantRecord,
} from "@SunReye/db/plant-repo";
import { isRetired } from "@SunReye/db/plant-repo";
import { z } from "zod";

import type { CatalogEntry } from "../devices/integration-catalog";
import { EVCC_LOADPOINT_PROFILE } from "../evcc/evcc-devices";
import { parseBody } from "../shared/zod-field";

/** The repository calls this module makes, bound to one client by the caller. */
export interface IntegrationAdminStore {
  readPlant(): Promise<PlantRecord | null>;
  readConnections(plantId: number): Promise<ConnectionRecord[]>;
  readIntegrations(plantId: number): Promise<IntegrationRecord[]>;
  createIntegration(plantId: number, spec: IntegrationSpec): Promise<IntegrationRecord>;
  updateIntegration(id: number, patch: IntegrationPatch): Promise<IntegrationRecord>;
  deleteIntegration(id: number): Promise<boolean>;
  /** Retired rows INCLUDED — a retired loadpoint must not be re-stamped. */
  readDevices(plantId: number): Promise<DeviceRecord[]>;
  updateDevice(id: number, patch: DevicePatch): Promise<DeviceRecord>;
}

export interface IntegrationAdminDeps {
  store: IntegrationAdminStore;
  /**
   * What may sit on a connection of this kind — `catalogFor`. Injected rather
   * than imported so this module's refusals can be proved against a table
   * whose contents the test states, and so nothing here can grow a second
   * opinion about which integration belongs where.
   */
  catalog(kind: ConnectionKind | null): readonly CatalogEntry[];
  /** Ask the runtime to re-read what is configured — after a write, never before. */
  reload(): Promise<void>;
}

/**
 * An integration as the settings page shows it: the row, plus the three facts
 * the row alone cannot answer, all read from the catalog entry for its kind.
 *
 * `label`, `addable` and `multiInstance` are DERIVED per response rather than
 * stored: a build that renames "EVCC" or makes the export multi-instance would
 * otherwise be contradicted by every row written before it.
 */
export interface IntegrationView {
  id: number;
  kind: string;
  connectionId: number | null;
  enabled: boolean;
  params: Record<string, unknown>;
  /** From the catalog entry; falls back to the raw kind when this build has none. */
  label: string;
  addable: boolean;
  multiInstance: boolean;
}

/** A refusal the route turns into its status, with the field it concerns. */
export class IntegrationAdminError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    readonly field?: "kind" | "connectionId" | "params" | "enabled",
  ) {
    super(message);
    this.name = "IntegrationAdminError";
  }
}

/** Which input field a Zod path points at, for the error's `field`. */
const FIELDS = new Set(["kind", "connectionId", "params", "enabled"] as const);

const parse = <T>(schema: z.ZodType<T>, body: unknown): T =>
  parseBody(
    schema,
    body,
    FIELDS,
    (message, field) =>
      new IntegrationAdminError(400, field ? `${field}: ${message}` : message, field),
  );

/**
 * The add body, deliberately shallow. `kind` is a plain string here and checked
 * against {@link INTEGRATION_KINDS} below, so an unknown value is a 400 naming
 * the kind rather than a Zod enum message listing every arm; `params` is
 * `unknown` and parsed a second time against the CATALOG ENTRY the kind and the
 * connection resolve to, because the arm must never be chosen from the body.
 */
const addSchema = z.object({
  kind: z.string(),
  /** Absent or null both mean "no connection" — a kind that needs no endpoint. */
  connectionId: z.number().int().positive().nullish(),
  params: z.unknown().optional(),
});

const nonEmpty = (patch: Record<string, unknown>) =>
  Object.values(patch).some((value) => value !== undefined);

/**
 * What may change on a configured integration: whether it runs, and how.
 *
 * `kind` and `connectionId` are accepted only to be REFUSED — see
 * {@link requireTopologyUnchanged}. `params` is `unknown` and validated against
 * the ROW's kind (see {@link patchIntegration}).
 */
const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    params: z.unknown().optional(),
    kind: z.unknown().optional(),
    connectionId: z.unknown().optional(),
  })
  .refine(nonEmpty, "nothing to change");

/** The catalog entry a kind resolves to on a connection of this kind, or null. */
function entryFor(
  deps: IntegrationAdminDeps,
  connectionKind: ConnectionKind | null,
  kind: string,
): CatalogEntry | null {
  return deps.catalog(connectionKind).find((e) => e.id === kind) ?? null;
}

/** The connection a row names, out of the plant's own — null when it names none. */
function connectionOf(
  connections: readonly ConnectionRecord[],
  connectionId: number | null,
): ConnectionRecord | null {
  return connections.find((c) => c.id === connectionId) ?? null;
}

/** One row as the API returns it, with its catalog facts folded in. */
function toView(
  deps: IntegrationAdminDeps,
  row: IntegrationRecord,
  connections: readonly ConnectionRecord[],
): IntegrationView {
  const connection = connectionOf(connections, row.connectionId);
  const entry = entryFor(deps, connection?.kind ?? null, row.kind);
  return {
    id: row.id,
    kind: row.kind,
    connectionId: row.connectionId,
    enabled: row.enabled,
    params: row.params as Record<string, unknown>,
    label: entry?.label ?? row.kind,
    addable: entry?.addable ?? false,
    multiInstance: entry?.multiInstance ?? false,
  };
}

async function requirePlant(deps: IntegrationAdminDeps): Promise<PlantRecord> {
  const plant = await deps.store.readPlant();
  if (!plant) throw new IntegrationAdminError(400, "this install has no plant yet");
  return plant;
}

/** Everything configured on the plant, in row order. */
export async function listIntegrations(
  deps: IntegrationAdminDeps,
): Promise<{ integrations: IntegrationView[] }> {
  const plant = await deps.store.readPlant();
  if (!plant) return { integrations: [] };
  const [rows, connections] = await Promise.all([
    deps.store.readIntegrations(plant.id),
    deps.store.readConnections(plant.id),
  ]);
  return { integrations: rows.map((row) => toView(deps, row, connections)) };
}

/**
 * The endpoint the new integration runs over — one of the plant's, or none.
 *
 * Checked against the plant's OWN rows rather than trusted to the foreign key:
 * the FK would happily accept another plant's connection, and an export
 * publishing a stranger's broker is the kind of wrong that looks like it works.
 */
function resolveConnection(
  connectionId: number | null,
  connections: readonly ConnectionRecord[],
): ConnectionRecord | null {
  if (connectionId === null) return null;
  const found = connectionOf(connections, connectionId);
  if (!found) {
    throw new IntegrationAdminError(
      404,
      `connection ${connectionId} does not exist`,
      "connectionId",
    );
  }
  return found;
}

/**
 * The entry this kind may be added as, on this connection.
 *
 * ONE lookup answers both halves of "may it go there": an `ha-export` is absent
 * from the `modbus` arm, so attaching one to a gateway is refused here rather
 * than by a rule spelled out again; and a connection-LESS add resolves against
 * the catalog's null arm, which holds only what the server provisions itself.
 * Neither refusal names a kind — add one to the catalog and this reads it.
 */
function requireAddableEntry(
  deps: IntegrationAdminDeps,
  connection: ConnectionRecord | null,
  kind: string,
): CatalogEntry {
  const entry = entryFor(deps, connection?.kind ?? null, kind);
  if (entry) return entry;
  const where = connection ? `a ${connection.kind} connection` : "no connection";
  throw new IntegrationAdminError(409, `kind: "${kind}" cannot run over ${where}`, "kind");
}

/**
 * A single-instance entry may not join one of its own on the same connection.
 *
 * The engine says so too — `integrations_ha_export_connection_idx` is a partial
 * unique index — and saying it first is the point: the operator gets the reason
 * rather than a constraint name.
 */
function requireInstanceRoom(
  entry: CatalogEntry,
  rows: readonly IntegrationRecord[],
  kind: string,
  connectionId: number | null,
): void {
  if (entry.multiInstance) return;
  const taken = rows.some((row) => row.kind === kind && row.connectionId === connectionId);
  if (!taken) return;
  throw new IntegrationAdminError(
    409,
    `kind: this connection already has a ${entry.label}, and only one may sit on it`,
    "kind",
  );
}

/**
 * A settings document, validated against the CATALOG ENTRY it belongs to.
 *
 * The entry is chosen from the ROW's kind (or, on an add, from the kind that has
 * already been checked against the connection) and never from the body — the
 * same rule, and the same reason, as `patchConnection`'s: a write must not be
 * able to pick the arm it is judged by. Every failure is reported on `params`
 * whatever the inner path, because that is the field the operator edited.
 */
function parseParams(entry: CatalogEntry, params: unknown): Record<string, unknown> {
  const result = entry.fields.safeParse(params ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue?.path.join(".") ?? "";
  const where = path === "" ? "params" : `params.${path}`;
  throw new IntegrationAdminError(
    400,
    `${where}: ${issue?.message ?? "invalid settings"}`,
    "params",
  );
}

/**
 * A parsed settings document, as the STORE's per-kind shape.
 *
 * A cast, and the only one in this module. The catalog types every entry's
 * schema as a plain `z.ZodObject<ZodRawShape>` — it has to, since its entries
 * hold four unrelated shapes — so {@link parseParams} hands back a record, while
 * the store's spec and patch carry the discriminated union's arm. The entry was
 * chosen FROM the kind the document is being stored under, so the two ARE the
 * same shape by construction; the compiler cannot follow that chain through the
 * catalog's erasure. The engine holds the line either way: `parseIntegrationParams`
 * re-validates the arm on the way back out.
 */
const asStoredParams = (params: Record<string, unknown>): IntegrationParams["params"] =>
  params as IntegrationParams["params"];

/** A kind this build has a runtime for, or the 400 it deserves. */
function requireKnownKind(kind: string): IntegrationKind {
  if ((INTEGRATION_KINDS as readonly string[]).includes(kind)) return kind as IntegrationKind;
  throw new IntegrationAdminError(
    400,
    `kind: "${kind}" is not an integration this build runs`,
    "kind",
  );
}

/**
 * Configure an integration, in the order that cannot leave a half-written state:
 *
 *  1. VALIDATE everything — the body, the kind, the connection, the catalog
 *     entry, the instance rule and the settings — before a single statement
 *     runs, so a refusal never leaves a row behind.
 *  2. INSERT.
 *  3. RELOAD last, so the runtimes re-read against the final state.
 */
export async function addIntegration(
  deps: IntegrationAdminDeps,
  body: unknown,
): Promise<IntegrationView> {
  const input = parse(addSchema, body);
  const kind = requireKnownKind(input.kind);
  const plant = await requirePlant(deps);
  const connections = await deps.store.readConnections(plant.id);
  const connectionId = input.connectionId ?? null;
  const connection = resolveConnection(connectionId, connections);
  const entry = requireAddableEntry(deps, connection, kind);
  requireInstanceRoom(entry, await deps.store.readIntegrations(plant.id), kind, connectionId);
  const params = parseParams(entry, input.params);
  const created = await deps.store.createIntegration(plant.id, {
    connectionId,
    kind,
    params: asStoredParams(params),
  } as IntegrationSpec);
  await deps.reload();
  return toView(deps, created, connections);
}

/**
 * `kind` and `connectionId` are an integration's IDENTITY, not its settings.
 *
 * The same shape and the same reasoning as `device-admin.ts`'s
 * `requireTopologyUnchanged`: a per-field gate that refuses the addressing
 * while leaving everything else editable. Re-kinding a row in place would leave
 * the devices it yielded — an EVCC loadpoint carries the topic root it was
 * provisioned with — fed by code that no longer runs, and re-pointing it would
 * move a subscription off the very broker those loadpoints are bound to, while
 * their history stays keyed to them. A different pairing is a different
 * integration: remove this one and add the one you want.
 *
 * Refused whenever NAMED, not only when different. A device's topology gate can
 * afford the round-trip tolerance `patchConnection` has because a device dialog
 * edits a row it read; the wizard sends only what the operator changed, so a
 * `kind` in the body is always an attempt to change it.
 */
const TOPOLOGY_FIELDS = ["kind", "connectionId"] as const;

function requireTopologyUnchanged(patch: Record<string, unknown>): void {
  const field = TOPOLOGY_FIELDS.find((name) => patch[name] !== undefined);
  if (field === undefined) return;
  throw new IntegrationAdminError(
    409,
    `${field}: an integration's kind and connection are its identity and cannot change; ` +
      `remove this one and add the one you want`,
    field,
  );
}

/** One of the plant's integrations by id, with the plant and its endpoints. */
async function requireIntegration(
  deps: IntegrationAdminDeps,
  id: number,
): Promise<{ plant: PlantRecord; connections: ConnectionRecord[]; row: IntegrationRecord }> {
  const plant = await requirePlant(deps);
  const [rows, connections] = await Promise.all([
    deps.store.readIntegrations(plant.id),
    deps.store.readConnections(plant.id),
  ]);
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new IntegrationAdminError(404, `integration ${id} does not exist`);
  return { plant, connections, row };
}

/**
 * The catalog entry a STORED row belongs to.
 *
 * A row this build has no entry for is a real state — a database migrated ahead
 * of the binary, or a connection kind this build does not know — and it is a
 * 409 rather than a crash: its settings cannot be validated by anything here,
 * so a write would be storing an unjudged document. Toggling it off does not go
 * through this, deliberately: stopping an integration you cannot configure is
 * exactly what an operator in that state needs to do.
 */
function requireEntryForRow(
  deps: IntegrationAdminDeps,
  row: IntegrationRecord,
  connections: readonly ConnectionRecord[],
): CatalogEntry {
  const connection = connectionOf(connections, row.connectionId);
  const entry = entryFor(deps, connection?.kind ?? null, row.kind);
  if (entry) return entry;
  throw new IntegrationAdminError(
    409,
    `kind: this build has no catalog entry for "${row.kind}" on that connection, ` +
      `so its settings cannot be validated`,
    "kind",
  );
}

/** Toggle an integration, or replace its settings. */
export async function patchIntegration(
  deps: IntegrationAdminDeps,
  id: number,
  body: unknown,
): Promise<IntegrationView> {
  const patch = parse(patchSchema, body);
  requireTopologyUnchanged(patch);
  const { connections, row } = await requireIntegration(deps, id);
  const changes: IntegrationPatch = {
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.params !== undefined
      ? {
          params: asStoredParams(
            parseParams(requireEntryForRow(deps, row, connections), patch.params),
          ),
        }
      : {}),
  };
  const updated = await deps.store.updateIntegration(id, changes);
  await deps.reload();
  return toView(deps, updated, connections);
}

/**
 * The `devices.profile_id` values an integration kind PROVISIONS.
 *
 * A lookup rather than a branch, and only the kinds that yield anything appear:
 * the Home Assistant export publishes and yields nothing, so it is absent and
 * deleting one never reads the device roster at all.
 */
const YIELDED_PROFILES: Partial<Record<IntegrationKind, readonly string[]>> = {
  "evcc-ingest": [EVCC_LOADPOINT_PROFILE],
};

/** The live devices this integration provisioned: its profiles, on its endpoint. */
function yieldedDevices(
  devices: readonly DeviceRecord[],
  profiles: readonly string[],
  connectionId: number | null,
): DeviceRecord[] {
  return devices.filter(
    (device) =>
      profiles.includes(device.profileId) &&
      device.connectionId === connectionId &&
      !isRetired(device),
  );
}

/**
 * RETIRE what the integration yielded — never delete it.
 *
 * `metrics_raw.device_id` is a NOT NULL foreign key, and a loadpoint that has
 * been charging for a year is a year of rows keyed to that id. Deleting the
 * device row would take the history with it (or be refused by the engine and
 * fail the whole delete), and reissuing the id later would silently rebind those
 * readings to a different machine — the precise failure 2.0.0's schema break was
 * spent fixing. Retirement is the same answer `../evcc/evcc-registrar.ts` gives
 * a loadpoint that vanishes from EVCC's config (its rule 3): what it reported up
 * to this moment is history and must stay readable; nothing after it may be
 * keyed to it. An operator who re-adds the integration gets the SAME rows back,
 * restored, with their charts intact.
 *
 * Already-retired rows are skipped rather than re-stamped: `retired_at` is when
 * the device left service, and overwriting it would move a boundary the history
 * reads are drawn against.
 */
async function retireYielded(
  deps: IntegrationAdminDeps,
  plantId: number,
  row: IntegrationRecord,
): Promise<void> {
  const profiles = YIELDED_PROFILES[row.kind];
  if (!profiles) return;
  const devices = await deps.store.readDevices(plantId);
  const at = new Date();
  for (const device of yieldedDevices(devices, profiles, row.connectionId)) {
    await deps.store.updateDevice(device.id, { retiredAt: at });
  }
}

/**
 * Un-configure an integration: retire what it yielded, then remove the row.
 *
 * In that order, and it matters. A failure between the two leaves the
 * integration configured with its devices retired — visible, explicable and
 * fixable from the same page. The reverse would leave live loadpoints behind an
 * integration nobody can find, being fed by nothing.
 */
export async function deleteIntegration(deps: IntegrationAdminDeps, id: number): Promise<void> {
  const { plant, row } = await requireIntegration(deps, id);
  await retireYielded(deps, plant.id, row);
  await deps.store.deleteIntegration(id);
  await deps.reload();
}
