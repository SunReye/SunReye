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
 * (`../inverter/endpoint.ts`, `loadPollEndpoint`), so a second device is stored,
 * registered and listed but not read; `DeviceView.polled` says which one is.
 */

import {
  type ConnectionRecord,
  type ConnectionSettings,
  DEVICE_ROLES,
  type DevicePatch,
  type DeviceRecord,
  type DeviceSpec,
  type PlantRecord,
  type ReadDevicesOptions,
  isRetired,
  isVirtualDevice,
  uniqueViolation,
} from "@SunReye/db/plant-repo";
import { z } from "zod";

import { SLUG_MAX, slugify } from "../inverter/provision";

/** The repository calls this module makes, bound to one client by the caller. */
export interface DeviceAdminStore {
  readPlant(): Promise<PlantRecord | null>;
  readConnections(plantId: number): Promise<ConnectionRecord[]>;
  readDevices(plantId: number, options?: ReadDevicesOptions): Promise<DeviceRecord[]>;
  createConnection(plantId: number, settings: ConnectionSettings): Promise<ConnectionRecord>;
  createDevice(spec: DeviceSpec): Promise<DeviceRecord>;
  updateDevice(id: number, patch: DevicePatch): Promise<DeviceRecord>;
}

export interface DeviceAdminDeps {
  store: DeviceAdminStore;
  /** The display name of a registered profile, or null when the id names none. */
  profileName(profileId: string): Promise<string | null>;
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
  connection: ConnectionRecord | null;
  profileName: string | null;
  /** Whether the profile the row names is registered on this server. */
  profileKnown: boolean;
  /** Whether this is the ONE device the poll loop reads in this release. */
  polled: boolean;
}

export interface DeviceRoster {
  devices: DeviceView[];
  connections: ConnectionRecord[];
}

/** A refusal the route turns into its status, with the field it concerns. */
export class DeviceAdminError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    readonly field?: "name" | "unitId" | "connection" | "role" | "profileId",
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

const connectionSettingsSchema = z.object({
  name: z.string().trim().min(1).max(64),
  host: z.string().trim().min(1, "host is required"),
  port: z.number().int().min(1).max(65535),
  transport: z.enum(["tcp", "rtu-over-tcp"]),
  timeoutMs: z.number().int().min(100).max(60_000),
  pollIntervalMs: z.number().int().min(1000).max(3_600_000),
}) satisfies z.ZodType<ConnectionSettings>;

const nameSchema = z
  .string()
  .trim()
  .min(1, "name is required")
  .max(SLUG_MAX, `name must be at most ${SLUG_MAX} characters`)
  .refine((name) => slugify(name) !== "", "name must contain a letter or a digit");

const addDeviceSchema = z.object({
  connection: z.union([
    z.object({ id: z.number().int().positive() }),
    z.object({ create: connectionSettingsSchema }),
  ]),
  role: z.enum(ADDABLE_ROLES as [string, ...string[]]),
  unitId: z.number().int().min(UNIT_ID_MIN).max(UNIT_ID_MAX),
  name: nameSchema,
  profileId: z.string().trim().min(1),
});

type AddDeviceInput = z.infer<typeof addDeviceSchema>;

const patchDeviceSchema = z
  .object({
    name: nameSchema.optional(),
    retired: z.boolean().optional(),
  })
  .refine((patch) => patch.name !== undefined || patch.retired !== undefined, "nothing to change");

/** Which input field a Zod path points at, for the error's `field`. */
const FIELDS = new Set(["name", "unitId", "connection", "role", "profileId"] as const);
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

function toView(
  device: DeviceRecord,
  connections: readonly ConnectionRecord[],
  profileName: string | null,
  primarySlug: string | null,
): DeviceView {
  return {
    ...device,
    retiredAt: device.retiredAt ? device.retiredAt.toISOString() : null,
    connection: connections.find((c) => c.id === device.connectionId) ?? null,
    profileName,
    profileKnown: profileName !== null,
    polled: !isRetired(device) && device.slug === primarySlug,
  };
}

async function view(
  deps: DeviceAdminDeps,
  device: DeviceRecord,
  connections: readonly ConnectionRecord[],
) {
  return toView(device, connections, await deps.profileName(device.profileId), deps.primarySlug());
}

/** Every device of the plant, retired ones included, with their endpoints. */
export async function listDevices(deps: DeviceAdminDeps): Promise<DeviceRoster> {
  const plant = await deps.store.readPlant();
  if (!plant) return { devices: [], connections: [] };
  const [devices, connections] = await Promise.all([
    deps.store.readDevices(plant.id),
    deps.store.readConnections(plant.id),
  ]);
  const primary = deps.primarySlug();
  const names = await Promise.all(devices.map((d) => deps.profileName(d.profileId)));
  return {
    devices: devices.map((d, i) => toView(d, connections, names[i] ?? null, primary)),
    connections,
  };
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
    });
  } catch (error) {
    throw conflictOf(error) ?? error;
  }
  await deps.reload();
  return toView(
    device,
    [...connections, connection],
    await deps.profileName(device.profileId),
    deps.primarySlug(),
  );
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
  if (patch.retired === true && current.slug === deps.primarySlug()) {
    throw new DeviceAdminError(
      409,
      "this device is the one being polled; change the inverter connection first",
    );
  }
  const updated = await deps.store.updateDevice(id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.retired !== undefined ? { retiredAt: patch.retired ? new Date() : null } : {}),
  });
  await deps.reload();
  return view(deps, updated, connections);
}
