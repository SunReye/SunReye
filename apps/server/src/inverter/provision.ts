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
 *  - the endpoint is ADOPTED as it stands and only SEEDED when the plant has
 *    none (see below);
 *  - the legacy pack is seeded only when the plant has no pack rows at all.
 *
 * THIS DOES NOT OWN THE ENDPOINT. IT SEEDS ONE.
 *
 * It used to. `provisionDevice` took the `app_settings.inverter` document and
 * wrote it into `connections` and `devices.unit_id` on EVERY boot and on every
 * settings save, which made that document the authority and silently undid every
 * edit an operator made to the endpoint — two writable homes for one fact, with
 * the JSONB one winning. `./endpoint.ts` documents the defect in full and is now
 * the only writer.
 *
 * What survives here is the SEED, and it is load-bearing for exactly one case: a
 * 1.2.0 install's endpoint lives only in `app_settings`, and the first boot after
 * the in-place upgrade is the one chance to carry it into the spine. So the seed
 * CREATES rows the plant does not have and never edits one it does. Same shape as
 * the plant facts and the legacy pack below — "create with these" is the only
 * thing that can be re-run every boot without overwriting an operator's edit.
 *
 * RETIRED DEVICES ARE NOT ADOPTABLE
 *
 * `devices.retired_at` is what taking a machine out of service means (`ON DELETE
 * RESTRICT` leaves no other way, and its history is retained). The device search
 * therefore looks at ACTIVE devices only — otherwise all three arms below would
 * hand back the retired row and the next boot would resurrect it. The uniques are
 * unconditional by design, so `ensureDevice` on a retired SLUG hands that row
 * straight back too; that answer is checked rather than trusted.
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
  activeDevices,
  ensureConnection,
  ensureDevice,
  ensurePlant,
  isRetired,
  physicalDevices,
  readConnection,
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
  /** The plant's endpoint as it stands — what makes the seed a seed. */
  readConnection(plantId: number): Promise<ConnectionRecord | null>;
  ensureConnection(plantId: number, settings: ConnectionSettings): Promise<ConnectionRecord>;
  /** ACTIVE devices only in the production wiring — see the module note. */
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
    readConnection: (plantId) => readConnection(db, plantId),
    ensureConnection: (plantId, settings) => ensureConnection(db, plantId, settings),
    // Narrowed in the STATEMENT as well as filtered in `findDevice`: a retired
    // row that never reaches this code cannot be adopted by a future arm either.
    readDevices: (plantId) => readDevices(db, plantId, { includeRetired: false }),
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

/**
 * The endpoint facts a SEED states.
 *
 * Structurally the legacy `InverterConfig`, and named separately on purpose: the
 * only thing this module may do with these values is CREATE rows that do not
 * exist yet. Calling the field `config` is what made it read like the poll
 * loop's source of truth, which is exactly the defect `./endpoint.ts` names.
 * `host` is optional because the legacy document may never have been saved.
 */
export interface EndpointSeed {
  host?: string;
  port: number;
  transport: string;
  unitId: number;
  timeoutMs: number;
  pollIntervalMs: number;
}

export interface ProvisionDeviceDeps extends ProvisionPlantDeps {
  profile: ProvisionProfile;
  /** Used ONLY where the spine has no row yet. Never an edit. */
  seed: EndpointSeed;
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
 * note on roles. RETIRED devices are unreachable from ALL THREE: a machine that
 * has left the plant must not be adopted back by the arm that happens to still
 * match it. The production store already narrows the statement, so this filter is
 * the in-memory half of the same rule — two spellings of "in service" is exactly
 * how a retired device gets polled again.
 *
 * VIRTUAL devices are unreachable from all three as well ({@link physicalDevices}).
 * Arms 1 and 2 match on a slug and a profile id, neither of which says anything
 * about what is on the other end, so nothing else stops the optimizer's row from
 * being adopted and re-pointed at the inverter profile. The result would not
 * look like a failure: the device has no registers, `selectPollTargets` filters
 * it out by role, and the install would boot cleanly and store nothing at all.
 */
function findDevice(
  devices: readonly DeviceRecord[],
  slug: string,
  profileId: string,
): DeviceRecord | null {
  const active = physicalDevices(activeDevices(devices));
  return (
    active.find((d) => d.slug === slug) ??
    active.find((d) => d.profileId === profileId) ??
    active.find((d) => d.role === INVERTER_ROLE) ??
    null
  );
}

/**
 * The endpoint this device is reached through, or null for no endpoint at all.
 *
 * THREE ANSWERS, IN THIS ORDER, AND THE ORDER IS THE POINT:
 *
 *  1. the endpoint the plant ALREADY HAS, untouched. It is the operator's — the
 *    settings PUT wrote it — and re-stating the legacy document over it every
 *    boot is the write-back this release deletes. Moving a gateway therefore
 *    moves one row, once, from the one place that owns it.
 *  2. otherwise the SEED creates one, which is what carries a 1.2.0 install's
 *    endpoint into the spine on the first boot after the upgrade.
 *  3. a blank host means there is nothing to connect to — a fresh install whose
 *    connection step was never saved, or `INVERTER_SIMULATE`.
 *    `devices.connection_id` is nullable for exactly that, and NULLs are
 *    distinct in `devices_connection_unit_key`, so any number of endpoint-less
 *    devices coexist.
 *
 * Crucially this does NOT clear an existing binding. Turning on simulate mode on
 * a real install must not silently detach the device from the gateway it is
 * physically wired to — the readings would come from the simulator either way,
 * but the row would have lost where the machine actually is.
 */
async function endpointFor(
  store: ProvisionStore,
  plantId: number,
  seed: EndpointSeed,
  existing: DeviceRecord | null,
): Promise<number | null> {
  const current = await store.readConnection(plantId);
  if (current) return existing ? (existing.connectionId ?? current.id) : current.id;
  const host = seed.host?.trim() ?? "";
  if (host === "") return existing?.connectionId ?? null;
  const connection = await store.ensureConnection(plantId, {
    name: "Inverter",
    host,
    port: seed.port,
    transport: seed.transport,
    timeoutMs: seed.timeoutMs,
    pollIntervalMs: seed.pollIntervalMs,
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
 * Why a retired slug stops provisioning instead of being worked around.
 *
 * `devices_plant_slug_key` is unconditional by design — the slug is written into
 * years of exports, saved charts and Home Assistant `unique_id`s, so two machines
 * may never share one — which means `ensureDevice` on a retired slug hands the
 * RETIRED row straight back. Every way out of that is worse than declining:
 *
 *  - returning the row makes the writer stamp new readings with a device that
 *    left the plant, and re-reads it every second forever;
 *  - clearing `retired_at` is precisely the resurrection the column exists to
 *    prevent;
 *  - inserting under a fresh slug still has to claim the same
 *    `(connection_id, unit_id)`, which the retired row holds — so the insert
 *    fails anyway, and the new slug would be a name the operator never chose,
 *    frozen forever.
 *
 * So the boot says so and provisions no device. The writer's existing
 * degradation takes over (`./storage-identity.ts` drops the batch with one
 * warning), which is the same state a fresh install is in before onboarding, and
 * the operator's next move — adding the replacement device, or un-retiring this
 * one — is a decision only they can make.
 */
const RETIRED_SLUG_WARNING =
  "device slug {deviceSlug} belongs to device {deviceId}, RETIRED at {retiredAt} — not " +
  "resurrecting it; no device is provisioned and readings are not stored until the " +
  "replacement is added or this device is returned to service";

/**
 * Ensure this install has a plant, an endpoint and the device the poll loop's
 * readings belong to.
 *
 * Safe on every boot, and that is the requirement rather than a convenience:
 * this is the only thing standing between a fresh 2.0.0 install and a database
 * that records nothing.
 *
 * Returns null in exactly one case: the frozen slug belongs to a RETIRED device.
 * See {@link RETIRED_SLUG_WARNING} for why that is a refusal and not a fixup.
 */
export async function provisionDevice(deps: ProvisionDeviceDeps): Promise<ProvisionResult | null> {
  const legacy = await readLegacyPlant(deps.store);
  const plant = await provisionPlantRow(deps);

  const devices = await deps.store.readDevices(plant.id);
  const existing = findDevice(devices, INVERTER_ROLE, deps.profile.id);
  const connectionId = await endpointFor(deps.store, plant.id, deps.seed, existing);

  const device = existing
    ? // ONLY the profile. Not `role` or `name` — the role of an adopted device is
      // its own (arm 3 only ever adopts an inverter, and arms 1–2 could be
      // anything) and the name may have been edited by the operator; `slug`
      // cannot even be named here, being frozen. And NOT `unitId` or
      // `connectionId`: those are the spine's own, and re-stating a legacy
      // document over them on every boot is the write-back this release deletes.
      await deps.store.updateDevice(existing.id, { profileId: deps.profile.id })
    : await deps.store.ensureDevice({
        plantId: plant.id,
        connectionId,
        unitId: deps.seed.unitId,
        slug: INVERTER_ROLE,
        name: deps.profile.name?.trim() || deps.profile.id,
        profileId: deps.profile.id,
        role: INVERTER_ROLE,
        // The 1.x roof description lands on the ONE inverter this seed creates
        // — the same first-inverter rule migration 0005 applies to a plant that
        // already had rows. Creation only: an adopted device keeps its own.
        pv: {
          arrays: legacy.facts.arrays,
          tempCoefficient: legacy.facts.tempCoefficient,
          systemLoss: legacy.facts.systemLoss,
        },
      });

  if (isRetired(device)) {
    deps.logger.warn(RETIRED_SLUG_WARNING, {
      deviceSlug: device.slug,
      deviceId: device.id,
      retiredAt: device.retiredAt?.toISOString(),
    });
    return null;
  }

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
