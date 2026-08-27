/**
 * The dimension spine's data access: plants, connections, devices, packs.
 *
 * WHY THIS MODULE EXISTS AT ALL
 *
 * Until this wave NOTHING created a `plants`, `connections` or `devices` row. The
 * writer resolved a device id before every insert and, finding none, dropped the
 * batch with one warning per source — so a fresh 2.0.0 install persisted no
 * history whatsoever. This is the other half of that seam: the code that puts the
 * rows there.
 *
 * THE ONE RULE EVERY FUNCTION HERE OBEYS: IDS ARE NEVER REISSUED
 *
 * `plants.id`, `connections.id`, `devices.id` and `batteries.id` are all
 * `smallint GENERATED ALWAYS AS IDENTITY`, and `device_id` is written into every
 * row of `metrics_raw` — five years of them. A provisioning path that
 * re-INSERTed on the second boot would not merely duplicate a row: the new
 * device would take a new id, the old readings would keep the old one, and the
 * charts would go empty with nothing deleted and nothing logged. That is
 * precisely the bug 2.0.0 spent its schema break fixing, and it would be
 * reintroduced from the other end.
 *
 * So every `ensure*` here is an UPSERT ON A NATURAL KEY, never a delete-and-
 * recreate:
 *
 *  - a plant on `slug` (unique);
 *  - a device on `(plant_id, slug)` (`devices_plant_slug_key`);
 *  - a connection on "the plant's existing endpoint", because there is no
 *    natural key for one — `(host, port)` is deliberately NOT a device key, and
 *    editing a gateway's port must move ONE row rather than add a second;
 *  - a pack on `device_id` (unique).
 *
 * AND THE SECOND RULE: A SLUG IS FROZEN, A NAME IS NOT
 *
 * `plants.slug` and `devices.slug` become the MQTT namespace
 * (`<prefix>/<plant-slug>/<device-slug>/<topic>`) and Home Assistant keys its
 * entities on `unique_id`. Changing one orphans every discovered entity and
 * every retained topic. So nothing in this module ever updates a slug —
 * {@link updateDevice} and {@link updatePlant} cannot even express it — while
 * `name` is freely editable and is what a later onboarding step will ask the
 * operator for. `ensurePlant` and `ensureDevice` also leave an EXISTING row's
 * name alone: the default they carry is for creation only, so a later boot
 * cannot rewrite a name the operator chose.
 *
 * The client is structural (`execute` only), like `./metric-keys.ts`'s
 * `MetricKeyWriter`: callers pass the shared `db` or a `createDbAt` client, and
 * this module drags no environment into everything that imports it.
 *
 * Proved by `apps/server/db-tests/plant-spine.test.ts` — against a real
 * Postgres, because every claim above is a claim about what the engine does.
 */

import { type SQL, sql } from "drizzle-orm";

import type { DeviceBattery } from "./batteries";
import { jsonDocument } from "./json-value";
import { type PlantFactColumns, columnsFromPlantRow } from "./plant-facts";

/** The subset of a drizzle client this module needs — see `./metric-keys.ts`. */
export interface PlantDb {
  execute: (query: SQL) => Promise<{ rows: unknown[] }>;
}

/** A plant, with its facts already in the shape the readers want. */
export interface PlantRecord extends PlantFactColumns {
  id: number;
  name: string;
  slug: string;
  timeZone: string;
  biddingZone: string | null;
  tariffKey: string | null;
}

/** A Modbus endpoint. */
export interface ConnectionRecord {
  id: number;
  name: string;
  host: string;
  port: number;
  transport: string;
  timeoutMs: number;
  pollIntervalMs: number;
}

/** A device — the thing every reading is FROM. */
export interface DeviceRecord {
  id: number;
  slug: string;
  name: string;
  profileId: string;
  role: string;
  unitId: number;
  connectionId: number | null;
}

/**
 * `smallint` and `double precision` come back as numbers through this driver,
 * but a `count(*)` or a bigint would arrive as a STRING — and a Map or a
 * comparison keyed by "3" instead of 3 fails silently at the call site rather
 * than here. Every id and measure this module returns goes through one of these.
 */
const int = (value: unknown): number => Number(value);
const maybeNum = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/** The plant columns, selected under the names {@link PlantRecord} uses. */
const PLANT_COLUMNS = sql`
  id, name, slug, time_zone as "timeZone", latitude, longitude, label, arrays,
  temp_coefficient as "tempCoefficient", system_loss as "systemLoss",
  max_output_w as "maxOutputW", house_load_w as "houseLoadW",
  smart_meter_since as "smartMeterSince", bidding_zone as "biddingZone",
  tariff_key as "tariffKey"`;

/** One raw plant row as a {@link PlantRecord}. */
function toPlant(row: Record<string, unknown>): PlantRecord {
  return {
    id: int(row.id),
    name: String(row.name),
    slug: String(row.slug),
    timeZone: String(row.timeZone),
    biddingZone: row.biddingZone === null ? null : String(row.biddingZone),
    tariffKey: row.tariffKey === null ? null : String(row.tariffKey),
    ...columnsFromPlantRow({
      latitude: maybeNum(row.latitude),
      longitude: maybeNum(row.longitude),
      label: String(row.label ?? ""),
      arrays: row.arrays,
      tempCoefficient: Number(row.tempCoefficient),
      systemLoss: Number(row.systemLoss),
      maxOutputW: maybeNum(row.maxOutputW),
      houseLoadW: maybeNum(row.houseLoadW),
      smartMeterSince: row.smartMeterSince === null ? null : String(row.smartMeterSince),
    }),
  };
}

/**
 * The plant, by id or — with none given — the lowest-numbered one.
 *
 * `min(id)` rather than "the only one": there is one plant today and no plan for
 * a second, but a read that assumed exactly one would start throwing the day an
 * import creates another, on a query that used to work. Lowest id is
 * deterministic and is the plant this install has always been.
 */
// fallow-ignore-next-line unused-export -- the repository's read half: used by `ensurePlant` in this file and asserted directly by `apps/server/db-tests/plant-spine.test.ts`, and test files are not traced as consumers. A repository that could only be written through would make every provisioning bug invisible until a poll dropped rows.
export async function readPlant(db: PlantDb, id?: number): Promise<PlantRecord | null> {
  const where = id === undefined ? sql`order by id asc limit 1` : sql`where id = ${id}`;
  const { rows } = await db.execute(sql`select ${PLANT_COLUMNS} from plants ${where}`);
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? toPlant(row) : null;
}

/** Defaults used only when a plant is CREATED; an existing row keeps its own. */
export interface PlantDefaults {
  name: string;
  slug: string;
  timeZone?: string;
  /** Facts seeded from the 1.x `app_settings` blobs, on creation only. */
  facts?: Partial<PlantFactColumns>;
  biddingZone?: string | null;
}

/** Column name for each writable plant fact. Nothing here can name a slug. */
const PLANT_FACT_COLUMNS = {
  latitude: "latitude",
  longitude: "longitude",
  label: "label",
  arrays: "arrays",
  tempCoefficient: "temp_coefficient",
  systemLoss: "system_loss",
  maxOutputW: "max_output_w",
  houseLoadW: "house_load_w",
  smartMeterSince: "smart_meter_since",
} as const satisfies Record<keyof PlantFactColumns, string>;

/**
 * The plant, creating it if this install has none.
 *
 * Two-step and deliberately so. `readPlant()` first, with no slug: an install
 * whose plant was named something else entirely must be ADOPTED, not joined by a
 * second plant carrying the default slug. Only when there is no plant at all does
 * the insert run, and it is `ON CONFLICT (slug) DO NOTHING` + re-select so two
 * processes booting at once still end up with one row and one id.
 *
 * Never updates an existing row. The defaults describe a plant nobody has
 * described yet; applying them on the second boot would rename the operator's
 * plant and re-seed facts they had since edited.
 */
export async function ensurePlant(db: PlantDb, defaults: PlantDefaults): Promise<PlantRecord> {
  return (await readPlant(db)) ?? (await createPlant(db, defaults));
}

/**
 * Insert the plant `defaults` describes, or adopt the row that already carries
 * its slug.
 *
 * Split out of {@link ensurePlant} so the INSERT itself — thirteen columns, a
 * JSONB cast and every column default — is reachable by a database test on an
 * install that already has a plant. `ON CONFLICT (slug) DO NOTHING` plus a
 * re-SELECT rather than `DO UPDATE`: two processes booting at once must end up
 * with one row and one id, and the loser of that race must not overwrite the
 * winner's row with its own defaults.
 */
// fallow-ignore-next-line unused-export -- the creation arm, split out of `ensurePlant` so a database test can reach the INSERT on an install that already has a plant (`apps/server/db-tests/plant-spine.test.ts`).
export async function createPlant(db: PlantDb, defaults: PlantDefaults): Promise<PlantRecord> {
  // Built column-by-column rather than as one fixed thirteen-column VALUES list.
  // Two reasons: an unstated fact then takes the COLUMN's own default (which is
  // where those defaults are declared and where they should come from), and the
  // list stays one loop instead of thirteen `??`s that have to be kept in step
  // with the schema by hand.
  const columns = ["name", "slug"];
  const values: SQL[] = [sql`${defaults.name}`, sql`${defaults.slug}`];
  const add = (column: string, value: SQL): void => {
    columns.push(column);
    values.push(value);
  };
  if (defaults.timeZone !== undefined) add("time_zone", sql`${defaults.timeZone}`);
  if (defaults.biddingZone != null) add("bidding_zone", sql`${defaults.biddingZone}`);
  for (const [key, column] of Object.entries(PLANT_FACT_COLUMNS)) {
    const value = defaults.facts?.[key as keyof PlantFactColumns];
    if (value === undefined) continue;
    add(column, key === "arrays" ? sql`${JSON.stringify(value)}::jsonb` : sql`${value}`);
  }

  await db.execute(sql`
    insert into plants (${sql.raw(columns.join(", "))})
    values (${sql.join(values, sql`, `)})
    on conflict (slug) do nothing`);

  const { rows } = await db.execute(
    sql`select ${PLANT_COLUMNS} from plants where slug = ${defaults.slug}`,
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`plant ${defaults.slug} could not be created`);
  return toPlant(row);
}

/** What {@link updatePlant} accepts: the facts, plus the three references. */
export interface PlantPatch extends Partial<PlantFactColumns> {
  /** Editable, always — this is what a slug exists so it never has to change. */
  name?: string;
  timeZone?: string;
  biddingZone?: string | null;
  tariffKey?: string | null;
}

/**
 * Update ONLY the fields the patch names.
 *
 * This is the clobber fix, at the engine. The 1.x record was one JSONB document
 * edited by two settings pages, so every save was a read-modify-write of the
 * whole thing and the second writer wrote back the first's stale half. An
 * `UPDATE` that names three columns cannot touch the fourth, whatever the caller
 * loaded.
 *
 * An EMPTY patch executes nothing: `update plants set where id = 1` is a syntax
 * error, and a form that changed nothing sends nothing.
 */
export async function updatePlant(db: PlantDb, id: number, patch: PlantPatch): Promise<void> {
  const assignments: SQL[] = [];
  for (const [key, column] of Object.entries(PLANT_FACT_COLUMNS)) {
    const value = patch[key as keyof PlantFactColumns];
    if (value === undefined) continue;
    assignments.push(
      key === "arrays"
        ? sql`${sql.raw(column)} = ${JSON.stringify(value)}::jsonb`
        : sql`${sql.raw(column)} = ${value}`,
    );
  }
  if (patch.name !== undefined) assignments.push(sql`name = ${patch.name}`);
  if (patch.timeZone !== undefined) assignments.push(sql`time_zone = ${patch.timeZone}`);
  if (patch.biddingZone !== undefined) assignments.push(sql`bidding_zone = ${patch.biddingZone}`);
  if (patch.tariffKey !== undefined) assignments.push(sql`tariff_key = ${patch.tariffKey}`);
  if (assignments.length === 0) return;

  await db.execute(sql`update plants set ${sql.join(assignments, sql`, `)} where id = ${id}`);
}

/** The endpoint settings a connection row holds. */
export interface ConnectionSettings {
  name: string;
  host: string;
  port: number;
  transport: string;
  timeoutMs: number;
  pollIntervalMs: number;
}

const CONNECTION_COLUMNS = sql`
  id, name, host, port, transport, timeout_ms as "timeoutMs",
  poll_interval_ms as "pollIntervalMs"`;

function toConnection(row: Record<string, unknown>): ConnectionRecord {
  return {
    id: int(row.id),
    name: String(row.name),
    host: String(row.host),
    port: int(row.port),
    transport: String(row.transport),
    timeoutMs: int(row.timeoutMs),
    pollIntervalMs: int(row.pollIntervalMs),
  };
}

/** The plant's endpoint, or null when it has none (simulate, imported history). */
// fallow-ignore-next-line unused-export -- used by `ensureConnection` in this file and asserted directly by `apps/server/db-tests/plant-spine.test.ts`; the device-settings wave reads it to render the endpoint.
export async function readConnection(
  db: PlantDb,
  plantId: number,
): Promise<ConnectionRecord | null> {
  const { rows } = await db.execute(
    sql`select ${CONNECTION_COLUMNS} from connections where plant_id = ${plantId} order by id asc limit 1`,
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? toConnection(row) : null;
}

/**
 * The plant's endpoint, created from `settings` or UPDATED to match them.
 *
 * Updated, not inserted-alongside, and that is the whole point: the operator
 * editing Settings → Inverter is MOVING their gateway, and a second row would
 * leave the device pointed at the old one while the poll loop used the new
 * values. The device's `connection_id` is what binds the two, so the endpoint's
 * id has to survive an edit.
 *
 * `name` IS overwritten here, unlike a plant's or a device's: the endpoint has no
 * UI that names it yet, so there is no operator choice to preserve. When one
 * arrives it moves out of this call the same way the device name did.
 */
export async function ensureConnection(
  db: PlantDb,
  plantId: number,
  settings: ConnectionSettings,
): Promise<ConnectionRecord> {
  const existing = await readConnection(db, plantId);
  if (existing) {
    await db.execute(sql`
      update connections set
        name = ${settings.name}, host = ${settings.host}, port = ${settings.port},
        transport = ${settings.transport}, timeout_ms = ${settings.timeoutMs},
        poll_interval_ms = ${settings.pollIntervalMs}
      where id = ${existing.id}`);
    return { ...settings, id: existing.id };
  }
  const { rows } = await db.execute(sql`
    insert into connections (plant_id, name, host, port, transport, timeout_ms, poll_interval_ms)
    values (${plantId}, ${settings.name}, ${settings.host}, ${settings.port},
            ${settings.transport}, ${settings.timeoutMs}, ${settings.pollIntervalMs})
    returning ${CONNECTION_COLUMNS}`);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`connection for plant ${plantId} could not be created`);
  return toConnection(row);
}

const DEVICE_COLUMNS = sql`
  id, slug, name, profile_id as "profileId", role, unit_id as "unitId",
  connection_id as "connectionId"`;

function toDevice(row: Record<string, unknown>): DeviceRecord {
  return {
    id: int(row.id),
    slug: String(row.slug),
    name: String(row.name),
    profileId: String(row.profileId),
    role: String(row.role),
    unitId: int(row.unitId),
    connectionId: maybeNum(row.connectionId),
  };
}

/** The plant's devices, lowest id first. */
export async function readDevices(db: PlantDb, plantId: number): Promise<DeviceRecord[]> {
  const { rows } = await db.execute(
    sql`select ${DEVICE_COLUMNS} from devices where plant_id = ${plantId} order by id asc`,
  );
  return (rows as Record<string, unknown>[]).map(toDevice);
}

/** Everything a device row needs at creation. */
export interface DeviceSpec {
  plantId: number;
  connectionId: number | null;
  unitId: number;
  /** FROZEN once written — the MQTT namespace and the API vocabulary. */
  slug: string;
  /** Creation default only; an existing device keeps the name it has. */
  name: string;
  profileId: string;
  role: string;
}

/**
 * The device `(plantId, slug)` names, creating it if it is not there.
 *
 * `ON CONFLICT (plant_id, slug) DO NOTHING` and then a SELECT, rather than
 * `DO UPDATE`: the conflicting row is a device that already has an id in five
 * years of readings, and the only fields provisioning may change on it are the
 * ones {@link updateDevice} exposes. In particular it must NOT overwrite `name`,
 * which the operator may have edited, and it CANNOT overwrite `slug`, which is
 * the conflict target and is frozen.
 */
export async function ensureDevice(db: PlantDb, spec: DeviceSpec): Promise<DeviceRecord> {
  await db.execute(sql`
    insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
    values (${spec.plantId}, ${spec.connectionId}, ${spec.unitId}, ${spec.slug},
            ${spec.name}, ${spec.profileId}, ${spec.role})
    on conflict (plant_id, slug) do nothing`);
  const { rows } = await db.execute(sql`
    select ${DEVICE_COLUMNS} from devices
    where plant_id = ${spec.plantId} and slug = ${spec.slug}`);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`device ${spec.slug} could not be created`);
  return toDevice(row);
}

/**
 * What may change on an existing device. Note what is absent: `slug` (frozen)
 * and `plant_id` (moving a device between plants would move its history).
 */
export interface DevicePatch {
  name?: string;
  profileId?: string;
  role?: string;
  unitId?: number;
  connectionId?: number | null;
}

/**
 * Re-point an existing device, keeping its id.
 *
 * The id is the whole reason this is an UPDATE and not a re-create: a PROFILE
 * SWAP must move which driver talks to the machine and leave every reading
 * exactly where it is. In 1.x the profile id WAS the stored identity, so a swap
 * orphaned all of history silently — the headline bug of this release, and this
 * function is the shape that cannot reintroduce it.
 */
export async function updateDevice(
  db: PlantDb,
  id: number,
  patch: DevicePatch,
): Promise<DeviceRecord> {
  const assignments: SQL[] = [];
  if (patch.name !== undefined) assignments.push(sql`name = ${patch.name}`);
  if (patch.profileId !== undefined) assignments.push(sql`profile_id = ${patch.profileId}`);
  if (patch.role !== undefined) assignments.push(sql`role = ${patch.role}`);
  if (patch.unitId !== undefined) assignments.push(sql`unit_id = ${patch.unitId}`);
  if (patch.connectionId !== undefined) {
    assignments.push(sql`connection_id = ${patch.connectionId}`);
  }
  if (assignments.length > 0) {
    await db.execute(sql`update devices set ${sql.join(assignments, sql`, `)} where id = ${id}`);
  }
  const { rows } = await db.execute(sql`select ${DEVICE_COLUMNS} from devices where id = ${id}`);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`device ${id} does not exist`);
  return toDevice(row);
}

/** One device's pack, as the plant-battery derivation needs it. */
export interface DeviceBatteryRecord extends DeviceBattery {
  deviceId: number;
}

const BATTERY_COLUMNS = sql`
  device_id as "deviceId", usable_kwh as "usableKwh", max_charge_w as "maxChargeW",
  min_soc as "minSoc", nominal_v as "nominalV"`;

function toBattery(row: Record<string, unknown>): DeviceBatteryRecord {
  return {
    deviceId: int(row.deviceId),
    usableKwh: Number(row.usableKwh),
    maxChargeW: maybeNum(row.maxChargeW),
    minSoc: Number(row.minSoc),
    nominalV: maybeNum(row.nominalV),
  };
}

/**
 * Every pack in the plant, in device-id order.
 *
 * The plant-level battery the forecast and the automation engine read is DERIVED
 * from these (`./batteries.ts`), and the derivation is capacity-weighted rather
 * than averaged — with one pack it is the identity function, which is exactly
 * why the reads must go through it rather than around it.
 */
export async function readPlantBatteries(
  db: PlantDb,
  plantId: number,
): Promise<DeviceBatteryRecord[]> {
  const { rows } = await db.execute(sql`
    select ${BATTERY_COLUMNS} from batteries b
    join devices d on d.id = b.device_id
    where d.plant_id = ${plantId}
    order by b.device_id asc`);
  return (rows as Record<string, unknown>[]).map(toBattery);
}

/** Upsert one device's pack. `device_id` is unique, so this is one row forever. */
export async function upsertDeviceBattery(
  db: PlantDb,
  deviceId: number,
  battery: DeviceBattery,
): Promise<void> {
  await db.execute(sql`
    insert into batteries (device_id, usable_kwh, max_charge_w, min_soc, nominal_v)
    values (${deviceId}, ${battery.usableKwh}, ${battery.maxChargeW}, ${battery.minSoc},
            ${battery.nominalV})
    on conflict (device_id) do update set
      usable_kwh = excluded.usable_kwh,
      max_charge_w = excluded.max_charge_w,
      min_soc = excluded.min_soc,
      nominal_v = excluded.nominal_v`);
}

/**
 * Remove a device's pack — "this plant has no storage".
 *
 * The DEVICE stays. A pack is a description of storage, not of the machine, and
 * deleting the device would take the meaning of every reading it wrote with it
 * (which `ON DELETE RESTRICT` would refuse anyway).
 */
export async function deleteDeviceBattery(db: PlantDb, deviceId: number): Promise<void> {
  await db.execute(sql`delete from batteries where device_id = ${deviceId}`);
}

/**
 * One `app_settings` value, RAW — no schema, no default.
 *
 * The seeding path needs this and cannot use `readSetting`: that accessor
 * `safeParse`s and silently falls back to the DEFAULT, so a stored blob the
 * current schema would reject reads back looking exactly like "nothing was ever
 * configured". Seeding from that answer would discard the coordinates, export cap
 * and pack of an install that had all three. `undefined` here means the row is
 * genuinely absent.
 */
export async function readRawSetting(db: PlantDb, key: string): Promise<unknown> {
  const { rows } = await db.execute(sql`select value from app_settings where key = ${key} limit 1`);
  const row = rows[0] as { value?: unknown } | undefined;
  // Unwrapped once, because a `jsonb` column can hold the document AS A JSON
  // STRING and a 1.x row genuinely can be in that shape (`./json-value.ts`).
  // Without this, a fully-configured install's coordinates, export cap and
  // battery read back as "nothing was ever configured" — which is the exact
  // silent loss the RAW accessor exists to prevent.
  return row === undefined ? undefined : jsonDocument(row.value);
}
