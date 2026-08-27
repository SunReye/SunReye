/**
 * Provisioning: the code that puts the plant, its endpoint and its device in the
 * database.
 *
 * WHAT WAS BROKEN
 *
 * 2.0.0 re-keyed every reading to `(device_id int2, metric_id int2)` and made
 * `device_id` a real foreign key. The writer therefore resolves a device before
 * inserting, and when nothing names its source it DROPS the batch with one
 * warning ("no device row names {source}; … Onboarding must create the plant's
 * device." — `./storage-identity.ts`). That degradation is right: it beats
 * failing a 100 000-row flush because one source is unknown. But nothing in the
 * codebase created a `devices` row, so a fresh 2.0.0 install persisted NO history
 * at all, forever, with one line in the log. This module is the other half of
 * that seam.
 *
 * TWO ENTRY POINTS, BECAUSE THE PLANT DOES NOT NEED A PROFILE
 *
 *  - {@link provisionPlantRow} — the plant alone. A plant is a SITE: coordinates,
 *    PV surfaces, a time zone, a bidding zone. None of that depends on which
 *    inverter is attached, and the server boots onboarding-only (no active
 *    profile) on a fresh install while the settings pages that edit those facts
 *    are already reachable. So the plant row is ensured on every boot, profile or
 *    no profile, and the settings layer can rely on it existing.
 *  - {@link provisionDevice} — the plant plus its connection, its device and (for
 *    a 1.x upgrade) its battery pack. Needs the active profile, because a device
 *    is the thing a profile describes how to talk to.
 *
 * IDEMPOTENCE IS THE WHOLE CONTRACT
 *
 * This runs on EVERY boot. `plants.id`, `connections.id` and `devices.id` are
 * `smallint GENERATED ALWAYS AS IDENTITY`, and `device_id` is written into every
 * one of five years of raw readings. A second boot that inserted instead of
 * adopting would not merely duplicate a row — the new device would take a new id,
 * every existing reading would keep the old one, and the charts would go empty
 * with nothing deleted and nothing logged. That is the 1.x bug this release broke
 * its schema to fix, arriving from the other direction. So:
 *
 *  - the plant is ADOPTED whatever it is called (`ensurePlant`);
 *  - the device is found by frozen slug, then by profile id, then as the plant's
 *    existing `role = 'inverter'` row, and only inserted when none of those hit;
 *  - the endpoint is EDITED in place, because moving a gateway must move one row
 *    rather than leave the device bound to the old one;
 *  - the legacy pack is seeded only when the plant has no pack rows at all.
 *
 * SLUGS ARE FROZEN, NAMES ARE NOT
 *
 * `plants.slug` and `devices.slug` become the MQTT namespace
 * (`<prefix>/<plant-slug>/<device-slug>/<topic>`) in a later wave, and Home
 * Assistant keys its entities on `unique_id`. So a slug is written once, at
 * creation, and nothing here can change one afterwards — not a rename, not a
 * profile swap, not a re-provision. `name` is freely editable and is what the
 * migration's onboarding step will ASK the operator for; provisioning only has to
 * put a defensible default there and get out of the way.
 *
 * In particular the device slug is derived from its ROLE (`inverter`), not from
 * the profile id. A profile-derived slug would move the entire MQTT namespace on
 * a profile swap, which is the exact class of silent orphaning 2.0.0 exists to
 * end. The writer still finds the row through the `profile_id` arm of
 * `../shared/identity.ts`, so nothing depends on the slug carrying the model.
 *
 * ROLES: A PLANT TOTAL IS NOT A SUM OF INVERTERS
 *
 * The provisioned device is `role = 'inverter'`. The schema also models
 * `role = 'controller'` — a Victron GX, a Sigenergy plant controller — whose own
 * registers carry plant-level values. Nothing here writes anything that assumes a
 * plant total is the sum of the plant's inverters, and the device search below
 * deliberately never adopts a controller: re-pointing one at an inverter profile
 * would make its readings claim to be an inverter's.
 */

import { AUTOMATION_KEY } from "@SunReye/db/automation-config";
import { type DeviceBattery, resolveNominalV } from "@SunReye/db/batteries";
import type { InverterConfig } from "@SunReye/db/inverter-config";
import {
  type ConnectionRecord,
  type ConnectionSettings,
  type DeviceBatteryRecord,
  type DevicePatch,
  type DeviceRecord,
  type DeviceSpec,
  type PlantDefaults,
  type PlantPatch,
  type PlantRecord,
  ensureConnection,
  ensureDevice,
  ensurePlant,
  readDevices,
  deleteDeviceBattery,
  readPlantBatteries,
  readRawSetting,
  updateDevice,
  updatePlant,
  upsertDeviceBattery,
} from "@SunReye/db/plant-repo";
import { type LegacyPlantFacts, legacyColumnsFromWeatherRow } from "@SunReye/db/plant-facts";
import { PLANT_KEY } from "@SunReye/db/plant";
import { SPOT_PRICE_KEY } from "@SunReye/db/spot-price-config";
import { WEATHER_KEY } from "@SunReye/db/weather";

/**
 * The dimension tables, as this module needs them.
 *
 * An interface rather than the module's functions directly, for the same reason
 * `../shared/identity.ts` takes a structural client: every rule in this file is
 * about WHICH ROWS EXIST after a second boot, and that is only testable against
 * something that actually holds rows. `provision.test.ts` drives it with an
 * in-memory store; the SQL those calls become is proved against a real Postgres
 * in `apps/server/db-tests/plant-spine.test.ts`.
 */
export interface ProvisionStore {
  ensurePlant(defaults: PlantDefaults): Promise<PlantRecord>;
  updatePlant(id: number, patch: PlantPatch): Promise<void>;
  ensureConnection(plantId: number, settings: ConnectionSettings): Promise<ConnectionRecord>;
  readDevices(plantId: number): Promise<DeviceRecord[]>;
  ensureDevice(spec: DeviceSpec): Promise<DeviceRecord>;
  updateDevice(id: number, patch: DevicePatch): Promise<DeviceRecord>;
  readPlantBatteries(plantId: number): Promise<DeviceBatteryRecord[]>;
  upsertDeviceBattery(deviceId: number, battery: DeviceBattery): Promise<void>;
  /** Remove a device's pack — "this plant has no storage". The device stays. */
  deleteDeviceBattery(deviceId: number): Promise<void>;
  /** RAW, never through `readSetting` — see {@link provisionPlantRow}. */
  readRawSetting(key: string): Promise<unknown>;
}

/** The one client shape the repository needs. */
export interface ProvisionDb {
  execute: Parameters<typeof readRawSetting>[0]["execute"];
}

/** Bind the repository's functions to one client. */
export function dbProvisionStore(db: ProvisionDb): ProvisionStore {
  return {
    ensurePlant: (defaults) => ensurePlant(db, defaults),
    updatePlant: (id, patch) => updatePlant(db, id, patch),
    ensureConnection: (plantId, settings) => ensureConnection(db, plantId, settings),
    readDevices: (plantId) => readDevices(db, plantId),
    ensureDevice: (spec) => ensureDevice(db, spec),
    updateDevice: (id, patch) => updateDevice(db, id, patch),
    readPlantBatteries: (plantId) => readPlantBatteries(db, plantId),
    upsertDeviceBattery: (deviceId, battery) => upsertDeviceBattery(db, deviceId, battery),
    deleteDeviceBattery: (deviceId) => deleteDeviceBattery(db, deviceId),
    readRawSetting: (key) => readRawSetting(db, key),
  };
}

/** The one failure path this logs; kept minimal so any logger satisfies it. */
export interface ProvisionLogger {
  info(template: string, values?: Record<string, unknown>): void;
  warn(template: string, values?: Record<string, unknown>): void;
}

/**
 * The longest slug this will emit — a topic segment, not a free-text field.
 *
 * Exported because migration onboarding refuses a NAME longer than this rather
 * than letting `slugify` silently cut it (`../migration/onboarding.ts`): the slug
 * is the MQTT namespace and it is frozen, so a truncation the operator never
 * chose is permanent.
 */
export const SLUG_MAX = 48;

/**
 * A typed name as a stable machine name.
 *
 * Diacritics are folded rather than stripped ("Süd" → "sud", not "sd"): the slug
 * is what a German operator sees in their MQTT topics and their Home Assistant
 * entity ids, and a dropped umlaut makes a word unreadable. Everything else
 * non-alphanumeric collapses to a single dash, and the result never begins or
 * ends with one — `<prefix>//<topic>` is not a topic.
 *
 * Returns `""` when nothing survives, which is a real case ("!!!"), and the
 * callers all have a named fallback for it. It never invents one here: the
 * fallback belongs where the meaning is ("plant", "inverter").
 */
export function slugify(text: string): string {
  return (
    text
      .normalize("NFKD")
      // Combining marks left by the decomposition above; `Ü` is now `U` + a mark.
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SLUG_MAX)
      .replace(/-+$/g, "")
  );
}

/** What a 1.x install has to say about its plant, mined from the raw rows. */
interface LegacyPlant {
  facts: LegacyPlantFacts;
  timeZone: string | null;
  biddingZone: string | null;
  /** `automations.peakShaving.nominalBatteryV` — the pack voltage's FIRST home. */
  automationNominalV: number | null;
}

/** A plain object, or `{}` — a raw JSONB value can be anything at all. */
function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A non-empty trimmed string, or null. */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Everything the 1.x `app_settings` blobs say about the plant.
 *
 * Every read here is RAW. `readSetting` `safeParse`s and falls back to the
 * DEFAULT with no log line, so a stored record the current schema would reject —
 * one PV array with an out-of-range tilt is enough — comes back
 * indistinguishable from "nothing was ever configured". Seeding a new plant from
 * that answer would silently discard the coordinates, export cap and pack of an
 * install that had all three. So the rows are probed and mined field by field
 * (`@SunReye/db/plant-facts`'s `legacyColumnsFromWeatherRow`).
 */
async function readLegacyPlant(store: ProvisionStore): Promise<LegacyPlant> {
  const [weather, plant, spot, automations] = await Promise.all([
    store.readRawSetting(WEATHER_KEY),
    store.readRawSetting(PLANT_KEY),
    store.readRawSetting(SPOT_PRICE_KEY),
    store.readRawSetting(AUTOMATION_KEY),
  ]);
  const nominalV = object(object(automations).peakShaving).nominalBatteryV;
  return {
    facts: legacyColumnsFromWeatherRow(weather),
    timeZone: text(object(plant).timeZone),
    biddingZone: text(object(spot).zone),
    automationNominalV: typeof nominalV === "number" && nominalV > 0 ? nominalV : null,
  };
}

/** Default plant name when the install has typed no name for its site anywhere. */
const DEFAULT_PLANT_NAME = "My plant";
/** Fallback plant slug — the one word that is always a legal topic segment. */
const DEFAULT_PLANT_SLUG = "plant";

export interface ProvisionPlantDeps {
  store: ProvisionStore;
  logger: ProvisionLogger;
}

/**
 * The plant row, created and seeded from the 1.x settings on first boot.
 *
 * The NAME is derived from the one human-typed name a 1.x install has for its
 * site: the weather tile's `label` ("Limburg-Weilburg"). Falling back to
 * {@link DEFAULT_PLANT_NAME} rather than to the profile's model name, because a
 * plant is a place and an inverter model is not one — and because the migration's
 * onboarding step will ask for this, so the default only has to be inoffensive
 * and renameable.
 *
 * The seeding happens ONLY when the row is created. It has to: a re-seed on the
 * second boot would overwrite whatever the operator edited in between with the
 * value still sitting in the legacy blob. That is why {@link ProvisionStore}'s
 * `ensurePlant` takes the facts rather than this function applying them after —
 * "create with these" is expressible atomically, "update if untouched" is not.
 */
export async function provisionPlantRow(deps: ProvisionPlantDeps): Promise<PlantRecord> {
  const legacy = await readLegacyPlant(deps.store);
  const name = legacy.facts.label?.trim() || DEFAULT_PLANT_NAME;
  const plant = await deps.store.ensurePlant({
    name,
    slug: slugify(name) || DEFAULT_PLANT_SLUG,
    timeZone: legacy.timeZone ?? undefined,
    biddingZone: legacy.biddingZone,
    facts: legacy.facts,
  });
  return plant;
}

/** Fallback device slug, and the role every provisioned device carries. */
const INVERTER_ROLE = "inverter";

/** The minimal profile facts provisioning needs — id for the driver, name for the label. */
export interface ProvisionProfile {
  id: string;
  name?: string;
}

export interface ProvisionDeviceDeps extends ProvisionPlantDeps {
  profile: ProvisionProfile;
  config: InverterConfig;
}

export interface ProvisionResult {
  plantId: number;
  plantSlug: string;
  connectionId: number | null;
  deviceId: number;
  /** FROZEN — the later wave's MQTT namespace segment. */
  deviceSlug: string;
}

/**
 * Find the device this provisioning is about, or null when there is none yet.
 *
 * Three arms, narrowing:
 *
 *  1. the frozen slug. The normal case on every boot after the first.
 *  2. the profile id. Catches a device whose slug an operator (or an import)
 *     chose differently, and is the same arm `../shared/identity.ts` resolves
 *     the writer's source id through.
 *  3. the plant's lowest-id `role = 'inverter'` device. This is what makes a
 *     PROFILE SWAP re-point an existing device instead of adding a second one:
 *     after a swap neither the slug (frozen) nor the profile id matches, and
 *     inserting would strand every reading the machine has ever written.
 *
 * Controllers and meters are unreachable from arm 3 on purpose — see the module
 * note on roles.
 */
function findDevice(
  devices: readonly DeviceRecord[],
  slug: string,
  profileId: string,
): DeviceRecord | null {
  return (
    devices.find((d) => d.slug === slug) ??
    devices.find((d) => d.profileId === profileId) ??
    devices.find((d) => d.role === INVERTER_ROLE) ??
    null
  );
}

/**
 * The endpoint this device is reached through, or null for no endpoint at all.
 *
 * A blank host means there is nothing to connect to — a fresh install whose
 * connection step was never saved, or `INVERTER_SIMULATE`. `devices.connection_id`
 * is nullable for exactly that, and NULLs are distinct in
 * `devices_connection_unit_key`, so any number of endpoint-less devices coexist.
 *
 * Crucially this does NOT clear an existing binding. Turning on simulate mode on
 * a real install must not silently detach the device from the gateway it is
 * physically wired to — the readings would come from the simulator either way,
 * but the row would have lost where the machine actually is.
 */
async function endpointFor(
  store: ProvisionStore,
  plantId: number,
  config: InverterConfig,
  existing: DeviceRecord | null,
): Promise<number | null> {
  const host = config.host?.trim() ?? "";
  if (host === "") return existing?.connectionId ?? null;
  const connection = await store.ensureConnection(plantId, {
    name: "Inverter",
    host,
    port: config.port,
    transport: config.transport,
    timeoutMs: config.timeoutMs,
    pollIntervalMs: config.pollIntervalMs,
  });
  return connection.id;
}

/**
 * Carry a 1.x battery record onto the device's pack row.
 *
 * Only when the plant has NO pack rows at all. Once one exists it is the
 * operator's description of their storage, and the legacy blob is a stale copy of
 * an earlier one — re-applying it every boot would undo every edit.
 *
 * `nominalV` goes through `resolveNominalV`, which is the fallback chain for a
 * value that has now moved TWICE (automations page → plant forecast record →
 * battery row). There is no second resolver here: every commanded charge current
 * is scaled by this number, so a 48 V pack driven as 51.2 V is charged 7 % below
 * what was asked for, silently and forever.
 */
async function seedLegacyPack(
  deps: ProvisionDeviceDeps,
  plantId: number,
  deviceId: number,
  legacy: LegacyPlant,
): Promise<void> {
  const pack = legacy.facts.battery;
  if (!pack) return;
  const existing = await deps.store.readPlantBatteries(plantId);
  if (existing.length > 0) return;
  const nominalV = resolveNominalV(null, pack.nominalV, legacy.automationNominalV);
  await deps.store.upsertDeviceBattery(deviceId, { ...pack, nominalV });
  deps.logger.info(
    "moved the 1.x battery record onto device {deviceId} ({usableKwh} kWh, reserve {minSoc} %)",
    { deviceId, usableKwh: pack.usableKwh, minSoc: pack.minSoc },
  );
}

/**
 * Ensure this install has a plant, an endpoint and the device the poll loop's
 * readings belong to.
 *
 * Safe on every boot, and that is the requirement rather than a convenience:
 * this is the only thing standing between a fresh 2.0.0 install and a database
 * that records nothing.
 */
export async function provisionDevice(deps: ProvisionDeviceDeps): Promise<ProvisionResult> {
  const legacy = await readLegacyPlant(deps.store);
  const plant = await provisionPlantRow(deps);

  const devices = await deps.store.readDevices(plant.id);
  const existing = findDevice(devices, INVERTER_ROLE, deps.profile.id);
  const connectionId = await endpointFor(deps.store, plant.id, deps.config, existing);

  const device = existing
    ? // NOT `role`, and NOT `name`: the role of an adopted device is its own
      // (arm 3 only ever adopts an inverter, and arms 1–2 could be anything), and
      // the name may have been edited by the operator. `slug` cannot even be
      // named here — it is frozen.
      await deps.store.updateDevice(existing.id, {
        profileId: deps.profile.id,
        unitId: deps.config.unitId,
        connectionId,
      })
    : await deps.store.ensureDevice({
        plantId: plant.id,
        connectionId,
        unitId: deps.config.unitId,
        slug: INVERTER_ROLE,
        name: deps.profile.name?.trim() || deps.profile.id,
        profileId: deps.profile.id,
        role: INVERTER_ROLE,
      });

  if (!existing) {
    deps.logger.info(
      "provisioned plant {plantSlug} (id {plantId}) and device {deviceSlug} (id {deviceId})",
      {
        plantSlug: plant.slug,
        plantId: plant.id,
        deviceSlug: device.slug,
        deviceId: device.id,
      },
    );
  }

  await seedLegacyPack(deps, plant.id, device.id, legacy);

  return {
    plantId: plant.id,
    plantSlug: plant.slug,
    connectionId,
    deviceId: device.id,
    deviceSlug: device.slug,
  };
}
