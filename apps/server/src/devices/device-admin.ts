/**
 * The operator's device roster: list, add, rename, retire — the logic behind
 * `../routes/devices.ts`.
 *
 * Dependency-injected like `../inverter/endpoint.ts`, and for the same reason:
 * the route layer has no automated cover, so everything that can go wrong in
 * ORDER — a device inserted before its connection exists, a reload after a
 * write that never landed, a 409 that should have been a 400 — has to be
 * provable against doubles. `./device-admin.test.ts` is that proof.
 *
 * WHAT THIS IS NOT
 *
 * Not the single-inverter form (`/api/settings/inverter`), which MOVES the
 * plant's first gateway in place and re-seeds provisioning. Adding a device
 * never touches an existing connection: a new gateway is a new row
 * (`createConnection`), an existing one is referenced by id, and a slug or
 * (connection, unit id) collision is an error the operator sees rather than a
 * row silently adopted (`createDevice`, not `ensureDevice`).
 *
 * Not the multi-device poll loop either. This release polls one target
 * (`../inverter/endpoint.ts`, `loadPollEndpoint`), so a second Modbus device is
 * stored, registered and listed but not read; {@link DeviceView.state} says so.
 */

import type { DeviceBattery } from "@SunReye/db/batteries";
import {
  type ConnectionParams,
  type ConnectionParamsMasked,
  connectionSettingsSchema,
  maskConnectionParams,
  mergeConnectionParams,
  modbusParamsSchema,
  mqttParamsSchema,
} from "@SunReye/db/connection-kinds";
import {
  type ConnectionPatch,
  type ConnectionRecord,
  type ConnectionSettings,
  DEVICE_ROLES,
  type DeviceBatteryRecord,
  type DevicePatch,
  type DevicePv,
  type DeviceRecord,
  type DeviceSpec,
  type PlantRecord,
  type ReadDevicesOptions,
  isRetired,
  isVirtualDevice,
  uniqueViolation,
} from "@SunReye/db/plant-repo";
import { forecastBatterySchema, pvArraySchema } from "@SunReye/db/weather";
import { z } from "zod";

import { SLUG_MAX, slugify } from "@SunReye/inverter-core/slug";

/** The repository calls this module makes, bound to one client by the caller. */
export interface DeviceAdminStore {
  readPlant(): Promise<PlantRecord | null>;
  readConnections(plantId: number): Promise<ConnectionRecord[]>;
  readDevices(plantId: number, options?: ReadDevicesOptions): Promise<DeviceRecord[]>;
  createConnection(plantId: number, settings: ConnectionSettings): Promise<ConnectionRecord>;
  createDevice(spec: DeviceSpec): Promise<DeviceRecord>;
  updateDevice(id: number, patch: DevicePatch): Promise<DeviceRecord>;
  updateConnection(id: number, patch: ConnectionPatch): Promise<ConnectionRecord>;
  /** True when a row went; a bound connection is refused by the engine's FK. */
  deleteConnection(id: number): Promise<boolean>;
  readPlantBatteries(plantId: number): Promise<DeviceBatteryRecord[]>;
  upsertDeviceBattery(deviceId: number, battery: DeviceBattery): Promise<void>;
  deleteDeviceBattery(deviceId: number): Promise<void>;
}

/**
 * What the coded tier says about a `profile_id` — `./coded.ts`'s declaration,
 * narrowed to the two fields the roster shows.
 *
 * Injected rather than imported for the reason every other dependency here is:
 * the route layer has no automated cover, so "a loadpoint is not an unpolled
 * Modbus device" has to be provable against a double.
 */
export interface CodedInfo {
  /** Provenance, for grouping the row under its integration. Never branched on here. */
  integration: string;
  /** The name to show for a device whose profile is code, not an install. */
  name?: string;
}

/**
 * How a device is fed. NOT a capability and not a branch anything downstream
 * takes: it is what the roster has to say out loud, because the three are
 * indistinguishable on a row that only knows "polled: false".
 */
export type DeviceKind = "modbus" | "coded" | "virtual";

/**
 * What the roster reports about a device, one word per reason it is not being
 * read. Replaces a `polled` boolean, which reported an MQTT-fed loadpoint and a
 * computation as broken Modbus hardware.
 *
 * `polling` is the one device the loop reads today; #204 extends it to many and
 * does not change this enum.
 */
export type DeviceState = "polling" | "idle" | "integration" | "virtual" | "retired";

export interface DeviceAdminDeps {
  store: DeviceAdminStore;
  /** The display name of a registered profile, or null when the id names none. */
  profileName(profileId: string): Promise<string | null>;
  /** The coded declaration a `profile_id` names, or null when it names a profile. */
  coded(profileId: string): CodedInfo | null;
  /** The slug of the device the loop polls today, or null when it polls nothing. */
  primarySlug(): string | null;
  /** Ask the runtime to re-read the roster — after a write, never before. */
  reload(): Promise<void>;
}

/**
 * A device as the settings page shows it: the row, its endpoint, and the two
 * facts the row alone cannot answer.
 *
 * `retiredAt` is an ISO string rather than a `Date` because this shape crosses
 * the HTTP edge; the repository's `Date` would arrive as a string anyway, and
 * naming that here keeps the web type honest.
 */
export interface DeviceView extends Omit<DeviceRecord, "retiredAt"> {
  retiredAt: string | null;
  connection: ConnectionView | null;
  /** The pack this inverter carries, or null — every other role has none. */
  battery: DeviceBattery | null;
  profileName: string | null;
  /** Whether the name above resolved — an installed profile, or a coded declaration. */
  profileKnown: boolean;
  /** How this device is fed. */
  kind: DeviceKind;
  /** Why it is, or is not, being read. */
  state: DeviceState;
  /**
   * The integration a coded device belongs to (`evcc`), or null. Provenance for
   * the roster's grouping and nothing else.
   */
  integration: string | null;
}

/**
 * A connection AS THE API RETURNS IT — every write-only field stripped.
 *
 * The masking follows the secret. It used to live on `app_settings.mqtt`
 * (`maskMqttConfig`), and since #217 the broker credential lives on a
 * `kind = 'mqtt'` row — which both `/api/connections` and the device roster
 * return, and which the archive export reads. `maskConnectionParams` owns the
 * rule for every kind, so a third kind with a secret cannot forget it.
 */
export type ConnectionView = { id: number; name: string } & ConnectionParamsMasked;

/** One row as the API returns it: masked, and still carrying its identity. */
function toConnectionView(connection: ConnectionRecord): ConnectionView {
  return { id: connection.id, name: connection.name, ...maskConnectionParams(connection) };
}

export interface DeviceRoster {
  devices: DeviceView[];
  connections: ConnectionView[];
}

/** A refusal the route turns into its status, with the field it concerns. */
export class DeviceAdminError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    readonly field?:
      | "name"
      | "unitId"
      | "connection"
      | "connectionId"
      | "kind"
      | "params"
      | "role"
      | "profileId"
      | "host"
      | "arrays"
      | "battery",
  ) {
    super(message);
    this.name = "DeviceAdminError";
  }
}

/**
 * Modbus slave ids. 0 is the spec's broadcast address, but plenty of gateways
 * (and the Deye this project grew up on) answer a single device on 0, so it is
 * allowed; 248–255 are reserved and never a device.
 */
const UNIT_ID_MIN = 0;
const UNIT_ID_MAX = 247;

/** The roles an operator may add. `optimizer` is virtual and registers itself. */
const ADDABLE_ROLES = DEVICE_ROLES.filter((role) => !isVirtualDevice({ role }));

const nameSchema = z
  .string()
  .trim()
  .min(1, "name is required")
  .max(SLUG_MAX, `name must be at most ${SLUG_MAX} characters`)
  .refine((name) => slugify(name) !== "", "name must contain a letter or a digit");

const roleSchema = z.enum(ADDABLE_ROLES as [string, ...string[]]);
const unitIdSchema = z.number().int().min(UNIT_ID_MIN).max(UNIT_ID_MAX);

/**
 * The inverter's PV description and pack, as the dialog sends them. Each field
 * independently optional so an edit can name only what changed; the bounds
 * mirror `@SunReye/db/weather`'s so a value the forecast schema would refuse is
 * refused here first.
 */
const inverterFieldsSchema = {
  arrays: z.array(pvArraySchema).max(8).optional(),
  // The device's coefficients have the ARRAY override's bounds, by construction:
  // the compose step stamps them onto every array that states none of its own.
  tempCoefficient: pvArraySchema.shape.tempCoefficient,
  systemLoss: pvArraySchema.shape.systemLoss,
  /** `null` says "no pack"; absent says "leave it alone". */
  battery: forecastBatterySchema.nullable().optional(),
};

const addDeviceSchema = z.object({
  ...inverterFieldsSchema,
  connection: z.union([
    z.object({ id: z.number().int().positive() }),
    z.object({ create: connectionSettingsSchema }),
  ]),
  role: roleSchema,
  unitId: unitIdSchema,
  name: nameSchema,
  profileId: z.string().trim().min(1),
});

type AddDeviceInput = z.infer<typeof addDeviceSchema>;

const nonEmpty = (patch: Record<string, unknown>) =>
  Object.values(patch).some((value) => value !== undefined);

/**
 * What may change on a device from the settings page. The slug is absent: it is
 * frozen. `retired` is the lifecycle flag; everything else re-points the row —
 * the profile swap and the gateway move that 1.x could not do without
 * orphaning history.
 */
const patchDeviceSchema = z
  .object({
    ...inverterFieldsSchema,
    name: nameSchema.optional(),
    role: roleSchema.optional(),
    unitId: unitIdSchema.optional(),
    connectionId: z.number().int().positive().optional(),
    profileId: z.string().trim().min(1).optional(),
    retired: z.boolean().optional(),
  })
  .refine(nonEmpty, "nothing to change");

/**
 * What may change on an existing connection.
 *
 * `kind` is accepted only to be REFUSED with a reason: the dialog round-trips
 * the whole record, so a PATCH carrying the row's own kind is the normal case
 * and must not 400 — but a DIFFERENT kind is refused rather than applied. Every
 * device bound to a connection was provisioned for its tier (a Modbus slave id,
 * an EVCC loadpoint index), and re-kinding the row in place would leave them
 * addressed for a bus that no longer exists while their history stays keyed to
 * them. A different kind is a different connection.
 *
 * `params` is `unknown` here and parsed a second time against the ROW's kind
 * (see {@link patchConnection}): the arm cannot be chosen from the body, or a
 * write could smuggle broker credentials onto a Modbus gateway.
 */
const patchConnectionSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    kind: z.string().optional(),
    params: z.unknown().optional(),
  })
  .refine(nonEmpty, "nothing to change");

/** Which input field a Zod path points at, for the error's `field`. */
const FIELDS = new Set([
  "name",
  "unitId",
  "connection",
  "connectionId",
  "kind",
  "params",
  "role",
  "profileId",
  "host",
  "arrays",
  "battery",
] as const);
type Field = NonNullable<DeviceAdminError["field"]>;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const head = issue?.path[0];
  const field = typeof head === "string" && FIELDS.has(head as Field) ? (head as Field) : undefined;
  const where = field ? `${field === "unitId" ? "unit id" : field}: ` : "";
  throw new DeviceAdminError(400, `${where}${issue?.message ?? "invalid body"}`, field);
}

/**
 * How a device is fed, from its role and its profile id.
 *
 * Virtual outranks coded, and the optimizer is both: it has a coded declaration
 * AND no machine behind it, and what an operator needs to know first is the
 * second one.
 */
function kindOf(device: DeviceRecord, coded: CodedInfo | null): DeviceKind {
  if (isVirtualDevice(device)) return "virtual";
  return coded !== null ? "coded" : "modbus";
}

/** Why a device is, or is not, being read. Retirement outranks everything. */
function stateOf(device: DeviceRecord, kind: DeviceKind, primarySlug: string | null): DeviceState {
  if (isRetired(device)) return "retired";
  if (kind === "virtual") return "virtual";
  if (kind === "coded") return "integration";
  return device.slug === primarySlug ? "polling" : "idle";
}

/**
 * The name the roster shows for a device's profile id.
 *
 * A coded id has no profile row and never will (`./coded.ts`), so the
 * declaration is what answers. Without this the roster flagged every loadpoint
 * and the optimizer red: "Profile not installed".
 */
function profileNameOf(installed: string | null, coded: CodedInfo | null): string | null {
  if (installed !== null) return installed;
  if (coded === null) return null;
  return coded.name ?? coded.integration;
}

function toView(
  device: DeviceRecord,
  connections: readonly ConnectionRecord[],
  profileName: string | null,
  primarySlug: string | null,
  coded: CodedInfo | null,
  battery: DeviceBattery | null = null,
): DeviceView {
  const kind = kindOf(device, coded);
  const name = profileNameOf(profileName, coded);
  return {
    ...device,
    retiredAt: device.retiredAt ? device.retiredAt.toISOString() : null,
    connection: (() => {
      const found = connections.find((c) => c.id === device.connectionId);
      return found ? toConnectionView(found) : null;
    })(),
    battery,
    profileName: name,
    profileKnown: name !== null,
    kind,
    state: stateOf(device, kind, primarySlug),
    integration: coded?.integration ?? null,
  };
}

/** A device's pack out of the plant's pack rows, stripped of its key. */
function packOf(packs: readonly DeviceBatteryRecord[], deviceId: number): DeviceBattery | null {
  const pack = packs.find((p) => p.deviceId === deviceId);
  if (!pack) return null;
  const { deviceId: _key, ...battery } = pack;
  return battery;
}

/** One device as the page shows it, re-read after a write. */
async function view(
  deps: DeviceAdminDeps,
  plantId: number,
  device: DeviceRecord,
  connections: readonly ConnectionRecord[],
): Promise<DeviceView> {
  const [name, packs] = await Promise.all([
    deps.profileName(device.profileId),
    deps.store.readPlantBatteries(plantId),
  ]);
  return toView(
    device,
    connections,
    name,
    deps.primarySlug(),
    deps.coded(device.profileId),
    packOf(packs, device.id),
  );
}

/** Every device of the plant, retired ones included, with their endpoints. */
export async function listDevices(deps: DeviceAdminDeps): Promise<DeviceRoster> {
  const plant = await deps.store.readPlant();
  if (!plant) return { devices: [], connections: [] };
  const [devices, connections, packs] = await Promise.all([
    deps.store.readDevices(plant.id),
    deps.store.readConnections(plant.id),
    deps.store.readPlantBatteries(plant.id),
  ]);
  const primary = deps.primarySlug();
  const names = await Promise.all(devices.map((d) => deps.profileName(d.profileId)));
  return {
    devices: devices.map((d, i) =>
      toView(
        d,
        connections,
        names[i] ?? null,
        primary,
        deps.coded(d.profileId),
        packOf(packs, d.id),
      ),
    ),
    connections: connections.map(toConnectionView),
  };
}

/**
 * Every connection of the plant, MASKED — what `/api/connections` answers.
 *
 * A service call rather than a store read spelled in the route, so the masking
 * cannot be forgotten at the one edge that returns these rows on their own.
 */
export async function listConnections(
  deps: DeviceAdminDeps,
): Promise<{ connections: ConnectionView[] }> {
  const plant = await deps.store.readPlant();
  if (!plant) return { connections: [] };
  return { connections: (await deps.store.readConnections(plant.id)).map(toConnectionView) };
}

/**
 * Create a connection ON ITS OWN — a gateway with no device on it yet, or a
 * broker, which never has one at creation time.
 *
 * `POST /api/devices`'s `connection: { create }` arm can only make a connection
 * ALONGSIDE a device, which was enough while every connection was a Modbus
 * gateway with a slave behind it. A broker is not: the EVCC loadpoints appear
 * once the ingest is bound to it and its first message arrives, and the mapped
 * devices that will sit on one are #79–#84. So the endpoint is provisioned
 * first and bound to afterwards.
 */
export async function addConnection(deps: DeviceAdminDeps, body: unknown): Promise<ConnectionView> {
  const settings = parse(connectionSettingsSchema, body);
  const plant = await requirePlant(deps);
  const created = await deps.store.createConnection(plant.id, settings);
  await deps.reload();
  return toConnectionView(created);
}

async function requirePlant(deps: DeviceAdminDeps): Promise<PlantRecord> {
  const plant = await deps.store.readPlant();
  if (!plant) throw new DeviceAdminError(400, "this install has no plant yet");
  return plant;
}

/**
 * The endpoint the new device is bound to — one of the plant's, or created now.
 *
 * An id is checked against the plant's OWN rows: the FK would accept another
 * plant's connection, and a device polled at a stranger's gateway is the kind of
 * wrong that reads plausible numbers.
 */
async function resolveConnection(
  deps: DeviceAdminDeps,
  plantId: number,
  choice: AddDeviceInput["connection"],
  existing: readonly ConnectionRecord[],
): Promise<ConnectionRecord> {
  if ("create" in choice) return deps.store.createConnection(plantId, choice.create);
  const found = existing.find((c) => c.id === choice.id);
  if (!found) {
    throw new DeviceAdminError(400, "connection: not one of this plant's", "connection");
  }
  return found;
}

/** The inverter-only fields a body carries, split from the rest. */
type InverterFields = z.infer<z.ZodObject<typeof inverterFieldsSchema>>;

/**
 * Only an inverter has strings and a pack. A meter or a charger sent either is
 * refused rather than silently stored: the forecast would never read it, and
 * the operator would believe their roof was described.
 */
function requireInverterFor(role: string, fields: InverterFields): void {
  const named = (["arrays", "tempCoefficient", "systemLoss", "battery"] as const).find(
    (key) => fields[key] !== undefined,
  );
  if (named && role !== "inverter") {
    throw new DeviceAdminError(
      400,
      `${named}: only an inverter carries PV arrays and a pack`,
      named === "battery" ? "battery" : "arrays",
    );
  }
}

/** The three PV columns a body names, as the repository's patch shape. */
function pvOf(fields: InverterFields): Partial<DevicePv> | undefined {
  const pv: Partial<DevicePv> = {};
  if (fields.arrays !== undefined) pv.arrays = fields.arrays;
  if (fields.tempCoefficient !== undefined) pv.tempCoefficient = fields.tempCoefficient;
  if (fields.systemLoss !== undefined) pv.systemLoss = fields.systemLoss;
  return Object.keys(pv).length > 0 ? pv : undefined;
}

/**
 * The pack instruction, if the body gave one: an object upserts, `null` removes,
 * absent leaves the row alone. Three instructions, because "no pack" and "did
 * not mention storage" must not collapse or a pack could never be removed.
 */
async function writeBattery(
  deps: DeviceAdminDeps,
  deviceId: number,
  battery: DeviceBattery | null | undefined,
): Promise<void> {
  if (battery === undefined) return;
  if (battery === null) await deps.store.deleteDeviceBattery(deviceId);
  else await deps.store.upsertDeviceBattery(deviceId, battery);
}

/** Which of the two device uniqueness rules a violation broke, as a 409. */
function conflictOf(error: unknown): DeviceAdminError | null {
  const constraint = uniqueViolation(error);
  if (constraint === null) return null;
  if (constraint === "devices_connection_unit_key") {
    return new DeviceAdminError(
      409,
      "unit id: already used by a device on this connection",
      "unitId",
    );
  }
  if (constraint === "devices_plant_slug_key") {
    return new DeviceAdminError(409, "name: a device with this name already exists", "name");
  }
  return new DeviceAdminError(409, "a device with these values already exists");
}

/**
 * Add a device, in the order that cannot lose a write:
 *
 *  1. VALIDATE everything — the body, the profile, the connection — before a
 *     single statement runs, so a 400 never leaves a half-made connection.
 *  2. The CONNECTION, when a new one was asked for; the device needs its id.
 *  3. The DEVICE, with the slug derived from the name exactly as provisioning
 *     derives it (`slugify`), so the two paths cannot disagree about a name.
 *  4. RELOAD last, so the registry re-resolves against the final state.
 */
export async function addDevice(deps: DeviceAdminDeps, body: unknown): Promise<DeviceView> {
  const input = parse(addDeviceSchema, body);
  const plant = await requirePlant(deps);
  if ((await deps.profileName(input.profileId)) === null) {
    throw new DeviceAdminError(400, "profile: not installed on this server", "profileId");
  }
  requireInverterFor(input.role, input);
  const connections = await deps.store.readConnections(plant.id);
  const connection = await resolveConnection(deps, plant.id, input.connection, connections);
  let device: DeviceRecord;
  try {
    device = await deps.store.createDevice({
      plantId: plant.id,
      connectionId: connection.id,
      unitId: input.unitId,
      slug: slugify(input.name),
      name: input.name,
      profileId: input.profileId,
      role: input.role,
      pv: pvOf(input),
    });
  } catch (error) {
    throw conflictOf(error) ?? error;
  }
  await writeBattery(deps, device.id, input.battery);
  await deps.reload();
  return view(deps, plant.id, device, [...connections, connection]);
}

/**
 * Rename, retire or restore a device.
 *
 * Retiring the device the loop polls is refused: it would silence the plant
 * with no error anyone reads, and the place to change WHICH device is polled is
 * the inverter form, not a retire button.
 */
export async function patchDevice(
  deps: DeviceAdminDeps,
  id: number,
  body: unknown,
): Promise<DeviceView> {
  const patch = parse(patchDeviceSchema, body);
  const plant = await requirePlant(deps);
  const [devices, connections] = await Promise.all([
    deps.store.readDevices(plant.id),
    deps.store.readConnections(plant.id),
  ]);
  const current = devices.find((d) => d.id === id);
  if (!current) throw new DeviceAdminError(404, `device ${id} does not exist`);
  requireModbus(current, deps.coded(current.profileId));
  if (patch.retired === true && current.slug === deps.primarySlug()) {
    throw new DeviceAdminError(
      409,
      "this device is the one being polled; change the inverter connection first",
    );
  }
  await checkRepointing(deps, patch, connections);
  requireInverterFor(patch.role ?? current.role, patch);
  const { retired, arrays, tempCoefficient, systemLoss, battery, ...fields } = patch;
  let updated: DeviceRecord;
  try {
    updated = await deps.store.updateDevice(id, {
      ...fields,
      pv: pvOf({ arrays, tempCoefficient, systemLoss }),
      ...(retired !== undefined ? { retiredAt: retired ? new Date() : null } : {}),
    });
  } catch (error) {
    throw conflictOf(error) ?? error;
  }
  await writeBattery(deps, id, battery);
  await deps.reload();
  return view(deps, plant.id, updated, connections);
}

/**
 * Only a Modbus device has the fields this patch writes.
 *
 * An edit of a coded or virtual row seeded the plant's FIRST gateway for its
 * endpoint-less device and then sent it, so saving an untouched edit bound a
 * loadpoint or the optimizer to a Modbus endpoint — a change nothing on the
 * screen described (#213). The row hides Edit and Retire now; this is the
 * refusal behind it, because the route is reachable without the row.
 */
function requireModbus(device: DeviceRecord, coded: CodedInfo | null): void {
  const kind = kindOf(device, coded);
  if (kind === "modbus") return;
  const why = kind === "virtual" ? "internal" : "fed by an integration";
  throw new DeviceAdminError(409, `this device is ${why}; it has no Modbus settings to change`);
}

/** The two re-pointing checks a device patch shares with an add: the profile is registered, the gateway is the plant's. */
async function checkRepointing(
  deps: DeviceAdminDeps,
  patch: { profileId?: string; connectionId?: number },
  connections: readonly ConnectionRecord[],
): Promise<void> {
  if (patch.profileId !== undefined && (await deps.profileName(patch.profileId)) === null) {
    throw new DeviceAdminError(400, "profile: not installed on this server", "profileId");
  }
  if (patch.connectionId !== undefined && !connections.some((c) => c.id === patch.connectionId)) {
    throw new DeviceAdminError(400, "connection: not one of this plant's", "connectionId");
  }
}

async function requireConnection(
  deps: DeviceAdminDeps,
  id: number,
): Promise<{ plant: PlantRecord; connections: ConnectionRecord[]; connection: ConnectionRecord }> {
  const plant = await requirePlant(deps);
  const connections = await deps.store.readConnections(plant.id);
  const connection = connections.find((c) => c.id === id);
  if (!connection) throw new DeviceAdminError(404, `connection ${id} does not exist`);
  return { plant, connections, connection };
}

/**
 * Edit a gateway in place. Every device bound to it follows — that is what
 * "the gateway moved" means, and why this is its own action rather than a
 * field on one of its devices.
 */
export async function patchConnection(
  deps: DeviceAdminDeps,
  id: number,
  body: unknown,
): Promise<ConnectionView> {
  const patch = parse(patchConnectionSchema, body);
  const { connection } = await requireConnection(deps, id);
  if (patch.kind !== undefined && patch.kind !== connection.kind) {
    throw new DeviceAdminError(
      409,
      `kind: a connection's kind cannot change (this one is ${connection.kind}); add a new connection instead`,
      "kind",
    );
  }
  const updated = await deps.store.updateConnection(id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.params !== undefined ? { params: mergedParams(connection, patch.params) } : {}),
  });
  await deps.reload();
  return toConnectionView(updated);
}

/**
 * An incoming `params` document, validated against the ROW's kind and merged
 * over what is stored.
 *
 * Two things at once, and both are load-bearing. The kind comes from the ROW,
 * never from the body, so a write cannot choose the arm it is validated against.
 * And the merge preserves the write-only broker password: the dialog reads the
 * masked record, edits the URL and sends it back with no password, and a plain
 * replacement would silently disconnect the broker.
 */
function mergedParams(connection: ConnectionRecord, params: unknown): ConnectionParams["params"] {
  const incoming =
    connection.kind === "modbus"
      ? ({ kind: "modbus", params: parse(modbusParamsSchema, params) } as const)
      : ({ kind: "mqtt", params: parse(mqttParamsSchema, params) } as const);
  return mergeConnectionParams(connection, incoming).params;
}

/**
 * Remove a gateway nothing is bound to. Refused while any device — retired
 * included — still references it: a retired device's readings are keyed to its
 * row, and its row is keyed to this one. The FK would refuse anyway; saying why
 * first is the point.
 */
export async function removeConnection(deps: DeviceAdminDeps, id: number): Promise<void> {
  const { plant } = await requireConnection(deps, id);
  const devices = await deps.store.readDevices(plant.id);
  const bound = devices.filter((d) => d.connectionId === id);
  if (bound.length > 0) {
    throw new DeviceAdminError(
      409,
      `connection still has ${bound.length} device(s): ${bound.map((d) => d.slug).join(", ")}`,
    );
  }
  await deps.store.deleteConnection(id);
  await deps.reload();
}
