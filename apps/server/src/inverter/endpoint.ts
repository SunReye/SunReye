/**
 * WHERE THE POLL LOOP GETS ITS ADDRESS. The `connections` + `devices` rows are
 * the authority, and this module is the only thing that reads them for it.
 *
 * THE DEFECT THIS ENDS
 *
 * 2.0.0 shipped the relational spine (`packages/db/src/schema/plants.ts`) and
 * then did not poll from it. `./runtime.ts` resolved its endpoint from
 * `getInverterConfig()` — one `app_settings` JSONB document holding host, port,
 * transport, unitId, timeoutMs and pollIntervalMs — while
 * `./provision-boot.ts` COPIED that same document into `connections` and
 * `devices.unit_id` on every boot AND on every settings save. Two writable homes
 * for one fact, synced one way, with the JSONB one winning. Editing the
 * `connections` row — the thing the schema calls the endpoint — changed nothing
 * and was silently overwritten on the next boot.
 *
 * It is the same shape as the `app_settings.weather` read-modify-write clobber
 * that `apps/web/src/lib/components/settings/plant-fields-placement.test.ts`
 * exists for, and which moving the plant facts into COLUMNS was supposed to have
 * ended.
 *
 * WHY IT MATTERED BEYOND TIDINESS
 *
 * A single JSONB document can only ever describe ONE endpoint and ONE unit id.
 * `connections` exists because an endpoint is not a device: a Victron GX
 * multiplexes many logical devices behind one endpoint by unit id, Sigenergy
 * puts a plant controller and its inverters on separate unit ids behind one
 * connection, Deye is the degenerate one-device case. Polling from the blob made
 * that entire rationale unreachable — the table was shaped for N and driven
 * by 1. {@link selectPollTargets} resolves ALL of them, per device, so the shape
 * is real; see the note there for what the loop above it does with more than one
 * today.
 *
 * WHO WRITES WHAT NOW
 *
 *  - the operator, through `../routes/settings.ts`'s inverter PUT →
 *    {@link saveConnectionSettings}. The ONLY writer of the endpoint.
 *  - provisioning (`./provision.ts`), which SEEDS the rows a fresh install or a
 *    1.2.0 upgrade has none of and never overwrites one that exists.
 *
 * `../settings/config.ts`'s `getInverterConfig` survives as a one-way LEGACY
 * READER for both of those seeds. It is not consulted once the spine has rows.
 */

import { db } from "@SunReye/db";
import type { InverterConfig } from "@SunReye/db/inverter-config";
import {
  type ConnectionRecord,
  type ConnectionSettings,
  type DevicePatch,
  type DeviceRecord,
  type PlantRecord,
  type ReadDevicesOptions,
  activeDevices,
  ensureConnection,
  isRetired,
  readConnections,
  readDevices,
  readPlant,
  updateDevice,
} from "@SunReye/db/plant-repo";

import { getInverterConfig } from "../settings/config";
import { env } from "@SunReye/env/server";
import { log } from "../shared/logging";
import { type ProvisionLogger, dbProvisionStore, provisionPlantRow } from "./provision";

/** The framings the Modbus client actually implements. */
export type Transport = "tcp" | "rtu-over-tcp";

/**
 * One machine's full address, as the source builder and the loop need it.
 *
 * Deliberately NOT `InverterConfig`: that type is the shape of the legacy
 * `app_settings` document, its `host` is optional because the document may never
 * have been saved, and keeping the two names apart is what stops the blob from
 * quietly becoming the poll path's type again. Here a host is always a string —
 * `""` meaning "nothing to connect to", which is a real state (simulate, an
 * imported history whose hardware is gone, onboarding before the connection
 * step).
 */
export interface PollEndpoint {
  host: string;
  port: number;
  transport: Transport;
  /** The Modbus slave id — a DEVICE fact, not an endpoint one. */
  unitId: number;
  timeoutMs: number;
  pollIntervalMs: number;
}

/** A device the loop can read, resolved to the address it is reached at. */
export interface PollTarget {
  deviceId: number;
  /** The frozen slug — the name every reading, topic and export uses. */
  deviceSlug: string;
  endpoint: PollEndpoint;
}

/**
 * The cadence bounds the loop is actually built around, mirroring
 * `inverter-config.ts`'s `z.number().min(1000).max(3_600_000)`.
 *
 * Mirrored rather than imported from the schema because the bound has to hold
 * for values that never passed that schema: `connections.poll_interval_ms` has
 * no CHECK, and the archive import, the bucket replay and the in-place 1.2.0
 * upgrade all write the column without going through an HTTP edge.
 */
const POLL_MIN_MS = 1000;
const POLL_MAX_MS = 3_600_000;

/** The port a Modbus/TCP endpoint answers on when a row states none. */
const DEFAULT_PORT = 502;
/** Per-request timeout when a row states none, matching the column default. */
const DEFAULT_TIMEOUT_MS = 2000;

/**
 * A stored cadence, clamped into what the loop can hold.
 *
 * `setInterval(fn, 0)` (or `NaN`) fires as fast as the event loop allows, and a
 * full read is several sequential Modbus block requests: the in-flight guard
 * would drop every tick while the process spun. So a nonsense column value
 * degrades to the 1 s design cadence instead of to a busy loop.
 */
// fallow-ignore-next-line unused-export -- the clamp, unit-tested at its boundaries in endpoint.test.ts (0, negative, NaN, over the ceiling); test files are not traced as consumers.
export function pollCadence(ms: number): number {
  if (!Number.isFinite(ms)) return Number.isNaN(ms) ? POLL_MIN_MS : POLL_MAX_MS;
  return Math.min(POLL_MAX_MS, Math.max(POLL_MIN_MS, Math.trunc(ms)));
}

/**
 * A stored transport, narrowed to a framing the client has a branch for.
 *
 * An unknown value must not leave the source unbuildable: the endpoint would
 * simply never poll and the plant would go quiet with no error anyone reads —
 * which is the failure `connections_transport_check` is there to prevent, for
 * the writes that pass a CHECK at all.
 */
// fallow-ignore-next-line unused-export -- the framing narrowing, unit-tested in endpoint.test.ts against the values the archive import and the 1.2.0 upgrade can leave in the column.
export function transportOf(value: string): Transport {
  return value === "rtu-over-tcp" ? "rtu-over-tcp" : "tcp";
}

/**
 * The endpoint of an install with nothing to poll.
 *
 * The cadence comes from `POLL_INTERVAL_MS` in env, not from a row: with no
 * `connections` row there is no endpoint whose cadence this could be, and the
 * only thing left to read is the SIMULATOR — whose cadence is a deploy-level
 * choice exactly like `INVERTER_SIMULATE` itself. Without this a simulate dev
 * server would silently ignore the interval its env sets.
 */
// fallow-ignore-next-line unused-export -- the "nothing to poll" answer, asserted directly in endpoint.test.ts because three different callers degrade to it.
export function offlineEndpoint(): PollEndpoint {
  return {
    host: "",
    port: DEFAULT_PORT,
    transport: "tcp",
    unitId: 0,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollIntervalMs: pollCadence(env.POLL_INTERVAL_MS),
  };
}

/**
 * One device plus its endpoint, as an address.
 *
 * The split is the point: the ADDRESS is the connection's and the SLAVE ID is
 * the device's. A null connection is not an error — `devices.connection_id` is
 * nullable for the endpoint-less cases — it just leaves nothing to dial.
 */
// fallow-ignore-next-line unused-export -- the address/slave-id split, unit-tested in endpoint.test.ts; that split is the whole reason connections and devices are separate tables.
export function endpointOf(
  device: Pick<DeviceRecord, "unitId">,
  connection: ConnectionRecord | null,
): PollEndpoint {
  if (!connection) return { ...offlineEndpoint(), unitId: device.unitId };
  return {
    host: connection.host,
    port: connection.port,
    transport: transportOf(connection.transport),
    unitId: device.unitId,
    timeoutMs: connection.timeoutMs,
    pollIntervalMs: pollCadence(connection.pollIntervalMs),
  };
}

/** The role a profile-driven poll describes how to talk to. */
const INVERTER_ROLE = "inverter";

/**
 * Every device of this plant the loop may read, lowest device id first.
 *
 * Three filters, each for a different failure:
 *
 *  1. RETIRED devices are dropped. A replaced inverter would otherwise time out
 *     on every cycle forever. Applied here as well as in SQL
 *     (`readDevices({ includeRetired: false })`) because the runtime holds
 *     rosters it did not fetch itself, and two spellings of "in service" is
 *     exactly how a retired device gets polled again.
 *  2. Only `role = 'inverter'`. A Victron GX or a Sigenergy plant controller has
 *     its OWN registers and its own profile; reading it through the active
 *     inverter profile would stamp its readings as an inverter's.
 *  3. A device whose `connection_id` names no existing row resolves to the
 *     offline endpoint rather than to another device's address. Silently reading
 *     the wrong machine is worse than reading none: the values are plausible.
 *
 * N TARGETS, AND WHAT THE LOOP DOES WITH THEM
 *
 * This function is N-shaped because the tables are, and because the per-device
 * address resolution is where the one-device assumption used to hide. The God
 * loop above it still drives ONE source — a second source needs per-device
 * samples, per-device writes and per-device topics, which is its own change —
 * and it says so in a log line when a plant has more than one target.
 */
// fallow-ignore-next-line unused-export -- the N-device resolution, unit-tested in endpoint.test.ts (per-device endpoints, retired rows, controllers, a dangling connection_id).
export function selectPollTargets(
  devices: readonly DeviceRecord[],
  connections: readonly ConnectionRecord[],
): PollTarget[] {
  const byId = new Map(connections.map((c) => [c.id, c]));
  return activeDevices(devices)
    .filter((d) => d.role === INVERTER_ROLE)
    .map((d) => ({
      deviceId: d.id,
      deviceSlug: d.slug,
      endpoint: endpointOf(d, (d.connectionId === null ? null : byId.get(d.connectionId)) ?? null),
    }));
}

/**
 * The spine, as this module needs it.
 *
 * An interface rather than the repository's functions directly, for the same
 * reason `./provision.ts` takes one: every rule here is about WHICH ROW an
 * answer came from, and that is only testable against something that holds rows.
 * `endpoint.test.ts` drives it with an in-memory double; the statements are
 * proved against a real Postgres in `apps/server/db-tests/plant-spine.test.ts`.
 */
export interface EndpointStore {
  readPlant(): Promise<PlantRecord | null>;
  /** Idempotent — see {@link saveConnectionSettings} for why a save needs it. */
  ensurePlant(): Promise<PlantRecord>;
  readDevices(plantId: number, options?: ReadDevicesOptions): Promise<DeviceRecord[]>;
  readConnections(plantId: number): Promise<ConnectionRecord[]>;
  ensureConnection(plantId: number, settings: ConnectionSettings): Promise<ConnectionRecord>;
  updateDevice(id: number, patch: DevicePatch): Promise<DeviceRecord>;
}

/** The one client shape the repository needs. */
export interface EndpointDb {
  execute: Parameters<typeof readPlant>[0]["execute"];
}

/**
 * Bind the repository to one client.
 *
 * `db` is read per call by the caller that builds this, never captured at module
 * evaluation — see `../settings/plant-facts-instance.ts` for what capturing it
 * costs.
 */
// fallow-ignore-next-line unused-export -- the production wiring, exercised by endpoint.test.ts against a fake client; a method bound to the wrong repository function would only show up against a real database.
export function dbEndpointStore(db: EndpointDb): EndpointStore {
  return {
    readPlant: () => readPlant(db),
    // The plant alone: idempotent, and the entry point that does not need a
    // profile. `./provision.ts` owns the naming and the 1.x seeding rules.
    ensurePlant: () =>
      provisionPlantRow({
        store: dbProvisionStore(db),
        logger: log("provision"),
      }),
    readDevices: (plantId, options) => readDevices(db, plantId, options),
    readConnections: (plantId) => readConnections(db, plantId),
    ensureConnection: (plantId, settings) => ensureConnection(db, plantId, settings),
    updateDevice: (id, patch) => updateDevice(db, id, patch),
  };
}

/** Collaborators for the reads and the save; each defaults to production wiring. */
export interface EndpointDeps {
  store: EndpointStore;
  logger: ProvisionLogger;
  /**
   * The one-way legacy reader (`app_settings.inverter`, env-seeded), consulted
   * ONLY where the spine has nothing to say yet. Never for the poll path.
   */
  legacy?: () => Promise<InverterConfig>;
}

/** Production wiring, built PER CALL — see {@link dbEndpointStore}. */
// fallow-ignore-next-line unused-export -- the default wiring every boot and settings save takes, exercised by endpoint.test.ts.
export function defaultEndpointDeps(): EndpointDeps {
  // `db` read PER CALL, not captured at module load: `mock.module` patches a
  // module's exports in place, so it reaches consumers that read `db` when they
  // run and misses consumers that read it at import time — the same reason
  // `./provision-boot.ts`'s `defaultDeps` is a function.
  return { store: dbEndpointStore(db), logger: log("endpoint") };
}

/**
 * The plant's poll targets, or none at all.
 *
 * No plant row is not an error: provisioning runs before the runtime starts but
 * swallows its own failures (a boot crash loop on a Home Assistant addon is
 * forever), so the loop has to tolerate an empty spine and idle.
 */
// fallow-ignore-next-line unused-export -- the spine read, asserted directly in endpoint.test.ts (including that it narrows the statement to active devices).
export async function readPollTargets(store: EndpointStore): Promise<PollTarget[]> {
  const plant = await store.readPlant();
  if (!plant) return [];
  const [devices, connections] = await Promise.all([
    // Narrowed in the STATEMENT as well as filtered in `selectPollTargets`: a
    // caller holding the wide list is a caller that can poll a retired device.
    store.readDevices(plant.id, { includeRetired: false }),
    store.readConnections(plant.id),
  ]);
  return selectPollTargets(devices, connections);
}

/**
 * The endpoint the God loop polls, resolved from the spine.
 *
 * Never throws and never leaves the caller without an answer: an unreachable
 * database, an unprovisioned plant and a plant with no device all degrade to
 * {@link offlineEndpoint}, which the runtime reports as "no inverter host
 * configured" and idles on. A throw here would take down a boot that is still
 * worth serving the dashboard, the history and the settings pages from.
 */
export async function loadPollEndpoint(
  deps: EndpointDeps = defaultEndpointDeps(),
): Promise<PollEndpoint> {
  try {
    const targets = await readPollTargets(deps.store);
    const primary = targets[0];
    if (!primary) return offlineEndpoint();
    if (targets.length > 1) {
      // Says it once per rebuild rather than pretending the extra machines are
      // being read: the loop drives one source (see `selectPollTargets`).
      deps.logger.warn(
        "{count} pollable devices are provisioned; this release polls {slug} only — the others are stored but not read",
        { count: targets.length, slug: primary.deviceSlug },
      );
    }
    return primary.endpoint;
  } catch (error) {
    deps.logger.warn("could not resolve the poll endpoint: {error} — polling idle", {
      error: error instanceof Error ? error.message : String(error),
    });
    return offlineEndpoint();
  }
}

/** The plant's first endpoint and the device that carries the slave id. */
async function primaryPair(
  store: EndpointStore,
  plantId: number,
): Promise<{ connection: ConnectionRecord | null; device: DeviceRecord | null }> {
  const [devices, connections] = await Promise.all([
    store.readDevices(plantId, { includeRetired: false }),
    store.readConnections(plantId),
  ]);
  const active = activeDevices(devices).filter((d) => d.role === INVERTER_ROLE);
  return { connection: connections[0] ?? null, device: active[0] ?? null };
}

/**
 * What the settings form shows — the SPINE's answer, in the legacy document's
 * shape.
 *
 * The shape is kept because the HTTP contract is: `apps/web`'s inverter form and
 * the connection test both speak `InverterConfig`, and changing that would move
 * a UI change into a database change. What moved is where the numbers come FROM.
 *
 * The legacy reader fills in only what the spine cannot answer: no endpoint row
 * at all (a fresh install still showing its env-seeded defaults), and no device
 * yet (onboarding saves the connection before a profile is active, so the row
 * that carries `unit_id` does not exist).
 */
export async function readConnectionSettings(
  deps: EndpointDeps = defaultEndpointDeps(),
): Promise<InverterConfig> {
  const legacy = deps.legacy ?? getInverterConfig;
  const plant = await deps.store.readPlant();
  if (!plant) return legacy();
  const { connection, device } = await primaryPair(deps.store, plant.id);
  if (!connection) return legacy();
  return {
    host: connection.host,
    port: connection.port,
    transport: transportOf(connection.transport),
    unitId: device ? device.unitId : (await legacy()).unitId,
    timeoutMs: connection.timeoutMs,
    pollIntervalMs: pollCadence(connection.pollIntervalMs),
  };
}

/** The endpoint's label. Fixed until a UI names it — see `ensureConnection`. */
const CONNECTION_NAME = "Inverter";

/** The two things saving a connection has to reach outside the spine. */
export interface ConnectionSaveEffects {
  /**
   * Ensure the DEVICE exists, seeded with what the operator typed. The one thing
   * {@link saveConnectionSettings} cannot do alone: an install that saved a
   * connection before a profile was active has no `devices` row to carry the unit
   * id. Adopts an existing device untouched.
   */
  provision: (seed: InverterConfig) => Promise<unknown>;
  /** Ask the poll loop to RE-READ the spine (never to accept these values). */
  reload: () => Promise<void>;
}

/**
 * The whole inverter PUT, in the order it has to happen — extracted from
 * `../routes/settings.ts` because the route layer has no automated cover and the
 * ORDER here is the part that can silently go wrong.
 *
 *  1. WRITE the spine. First, so that
 *  2. PROVISIONING adopts the endpoint that was just written instead of seeding a
 *     second one from the same values, and so the device it may create is bound
 *     to it.
 *  3. RELOAD last, so the loop re-resolves against the final state of both rows.
 *
 * A failed write does not reload and does not provision: the exception reaches
 * the route, which answers 400 with the reason. Telling the loop to re-read after
 * a failed save would leave the operator looking at a form that claims a gateway
 * move which never landed — the same lie the old write-back told, from the other
 * direction.
 */
export async function applyConnectionSave(
  config: InverterConfig,
  effects: ConnectionSaveEffects,
  deps: EndpointDeps = defaultEndpointDeps(),
): Promise<InverterConfig> {
  const stored = await saveConnectionSettings(config, deps);
  await effects.provision(stored);
  await effects.reload();
  return stored;
}

/**
 * Persist the connection the operator just typed, DIRECTLY into the spine.
 *
 * This is the one write path for the endpoint, and it replaces the settings
 * route's old "save the JSONB document, then re-run provisioning to copy it into
 * the tables" — the write-back that made the blob the authority.
 *
 * What it does, and what each part is for:
 *
 *  - the PLANT row is ensured first. It always exists by boot (provisioning
 *    ensures it profile or no profile) but that call swallows its failures, so
 *    the first save must not 500 on a plant a boot-time hiccup skipped.
 *  - the ENDPOINT is created, or EDITED IN PLACE. In place because the device's
 *    `connection_id` binds the two: a second row would leave the device pointing
 *    at the old address while the loop used the new one. Moving a gateway must
 *    move one row.
 *  - the SLAVE ID goes on the DEVICE, because that is where it lives. One
 *    gateway, many unit ids is the whole reason the two tables are separate.
 *  - a device with no endpoint yet is BOUND to the one just created (the
 *    onboarding order: an unbound device exists before an address does). A
 *    device that already has one is never re-pointed here — with one endpoint
 *    per plant an edit-in-place keeps the binding correct, and re-pointing would
 *    need to answer which of N endpoints it meant.
 *  - a RETIRED device is not written to at all. It is out of service, and giving
 *    it the new unit id could also collide with its replacement on
 *    `devices_connection_unit_key`.
 *
 * A blank host is not rejected: it is how an install says "there is nothing to
 * poll" (switching to simulate, hardware gone). With no row yet none is created
 * — an addressless endpoint is not something to bind a device to. With a row it
 * is an EDIT: the row and its binding survive, holding an empty address the
 * operator can fill back in. That is unlike a BOOT, which must never clear a
 * binding it merely failed to see a host for (`./provision.ts`).
 *
 * Throws on a database failure, deliberately: this is an HTTP write, and the
 * route turns a rejection into a 400 carrying the reason. Silently swallowing it
 * would tell the operator their gateway move was saved when it was not.
 */
// fallow-ignore-next-line unused-export -- the endpoint write, asserted directly in endpoint.test.ts; `applyConnectionSave` below is its only production caller.
export async function saveConnectionSettings(
  config: InverterConfig,
  deps: EndpointDeps = defaultEndpointDeps(),
): Promise<InverterConfig> {
  const plant = await deps.store.ensurePlant();
  const { connection, device } = await primaryPair(deps.store, plant.id);
  const host = config.host?.trim() ?? "";
  const endpointId = await writeEndpoint(deps, plant.id, connection, { ...config, host });
  if (device) await writeUnitId(deps, device, endpointId, config.unitId);
  return {
    host,
    port: config.port,
    transport: config.transport,
    unitId: config.unitId,
    timeoutMs: config.timeoutMs,
    pollIntervalMs: pollCadence(config.pollIntervalMs),
  };
}

/**
 * Create or EDIT the plant's endpoint, and answer with its id.
 *
 * Nothing is written when the plant has no endpoint and the operator named no
 * host: an addressless `connections` row is not something to bind a device to.
 * An endpoint that already exists is always edited, blank host included — that is
 * an explicit "this machine is gone", and the row (and every device binding to
 * it) has to survive it so the address can be put back.
 */
async function writeEndpoint(
  deps: EndpointDeps,
  plantId: number,
  connection: ConnectionRecord | null,
  config: InverterConfig & { host: string },
): Promise<number | null> {
  if (!connection && config.host === "") return null;
  const saved = await deps.store.ensureConnection(plantId, {
    name: connection?.name ?? CONNECTION_NAME,
    host: config.host,
    port: config.port,
    transport: config.transport,
    timeoutMs: config.timeoutMs,
    pollIntervalMs: config.pollIntervalMs,
  });
  return saved.id;
}

/**
 * Put the operator's slave id on the device, and bind it if it is not bound yet.
 *
 * A RETIRED device is left alone: it is out of service, and the new unit id could
 * also collide with its replacement on `devices_connection_unit_key`.
 *
 * `connectionId` is named ONLY when the device has none — `undefined` leaves the
 * column untouched, which is what keeps an already-bound device where it is. With
 * one endpoint per plant an edit-in-place keeps that binding correct; re-pointing
 * from here would have to answer which of N endpoints it meant.
 */
async function writeUnitId(
  deps: EndpointDeps,
  device: DeviceRecord,
  endpointId: number | null,
  unitId: number,
): Promise<void> {
  if (isRetired(device)) return;
  const bind = device.connectionId === null && endpointId !== null;
  await deps.store.updateDevice(device.id, {
    unitId,
    ...(bind ? { connectionId: endpointId } : {}),
  });
}
