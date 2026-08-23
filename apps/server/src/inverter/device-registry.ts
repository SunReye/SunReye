/**
 * The device registry: what replaced `let activeProfile`.
 *
 * The runtime used to hold exactly one device, resolved once at boot into a
 * module-level binding, and every consumer that wanted "the inverter" read that
 * binding. This holds a set of devices, each with the source it is reached
 * through and its own decoded {@link ProfileContext}, and hands out the same
 * single device to every existing caller through {@link DeviceRegistry.default}
 * for as long as an install has one.
 *
 * Backed by the `sources` and `devices` tables, but reached through an injected
 * {@link RegistryIo} rather than importing the database — the same direction the
 * runtime went in, and the reason its tests need no `mock.module` for this.
 */

import { getLogger } from "@logtape/logtape";
import {
  DEFAULT_SOURCE_ID,
  parseDeviceRows,
  parseSourceRows,
  type DeviceInsert,
  type DeviceRow,
  type SourceInsert,
  type SourceRow,
} from "@SunReye/db/devices";
import type { InverterConfig } from "@SunReye/db/inverter-config";
import type { InverterProfile } from "@SunReye/inverter-core";

import { db } from "@SunReye/db";
import { devices as devicesTable, sources as sourcesTable } from "@SunReye/db/schema/devices";
import { eq } from "drizzle-orm";
import { tryGetProfile } from "@SunReye/inverter-core";

import { getInverterConfig } from "../settings/config";
import { activeProfileId, buildProfileContext, type ProfileContext } from "./inverter";

const logger = getLogger(["server", "devices"]);

/** A connection, as the registry sees it. */
export interface Source {
  id: string;
  kind: string;
  label: string;
  /** The connection blob; shaped by `kind`, validated where it is dialled. */
  config: Record<string, unknown>;
  enabled: boolean;
}

/** One device: what it is, how it is reached, and how its metrics decode. */
export interface Device {
  /** Written into `metrics_raw.inverter_id`; never reassigned. */
  id: string;
  label: string;
  deviceClass: string;
  /**
   * The connection object, shared by identity with every other device on it —
   * two unit ids on one gateway get the same `Source`, which is what lets a
   * transport decide to share a socket between them.
   */
  source: Source;
  /** How to pick this device out of the ones sharing that connection. */
  address: Record<string, unknown>;
  enabled: boolean;
  /** This device's own manifest, metric map and write validation. */
  ctx: ProfileContext;
}

export interface DeviceRegistry {
  /** Every registered device, disabled ones included — they still own history. */
  devices(): Device[];
  /** The devices a poll loop should be built for. */
  pollable(): Device[];
  get(id: string): Device | undefined;
  /**
   * The device a caller means when it does not say. Exists so the single-device
   * surfaces — `/api/v1`, the MQTT bridge, the forecast's PV lookup — keep
   * working unchanged while they are migrated one at a time.
   */
  default(): Device | undefined;
}

/**
 * The one process-wide binding left, and it holds the registry rather than a
 * device — which is the difference between "this install has an inverter" and
 * "this install has devices".
 *
 * The ten call sites that used to read `activeProfile` read {@link
 * activeProfileOrNull} instead, so they keep meaning the default device until
 * each is given one of its own. Two of them (the forecast's PV lookup) reach it
 * through a lazy `await import`, which is why this is a holder and not a
 * parameter.
 */
let installed: DeviceRegistry | null = null;

/** Install the registry built at boot, or clear it (tests, teardown). */
// fallow-ignore-next-line unused-export -- the injection seam device-registry.test.ts drives; test files aren't traced as consumers
export function setDeviceRegistry(registry: DeviceRegistry | null): void {
  installed = registry;
}

/**
 * The default device's profile, or `null` when nothing is configured — the
 * onboarding-only boot. The direct replacement for `getActiveProfileOrNull`.
 */
export function activeProfileOrNull(): InverterProfile | null {
  return installed?.default()?.ctx.profile ?? null;
}

/**
 * Whether any registered device needs this profile to decode itself.
 *
 * Replaces comparing against one active id. With two devices, uninstalling the
 * profile the *second* one uses is just as destructive as uninstalling the
 * first's, and nothing was checking it. Disabled devices count: disabled means
 * not polled, not gone.
 */
export function profileInUse(profileId: string): boolean {
  return installed?.devices().some((d) => d.ctx.profile.id === profileId) ?? false;
}

/** Everything the registry needs from the outside world. */
export interface RegistryIo {
  listSources(): Promise<SourceRow[]>;
  listDevices(): Promise<DeviceRow[]>;
  insertSource(row: SourceInsert): Promise<void>;
  insertDevice(row: DeviceInsert): Promise<void>;
  /** Switch a device on or off without deleting it — it still owns its history. */
  setDeviceEnabled(id: string, enabled: boolean): Promise<void>;
  /** The `activeProfile` setting — the single-device pointer being replaced. */
  activeProfileId(): Promise<string | null>;
  /** The saved connection, which becomes the seeded source's config. */
  inverterConfig(): Promise<InverterConfig>;
  /** A profile from the in-process profile registry, if it is installed. */
  resolveProfile(id: string): InverterProfile | undefined;
}

/**
 * Turn an already-running install into its first source and device.
 *
 * Runs once, when the tables are empty and a profile is configured. The device
 * takes the profile's id verbatim: it is already the `inverter_id` of every
 * historical reading and the Home Assistant entity prefix, so anything else
 * silently splits the history and re-registers every entity.
 *
 * The unit id moves from the connection to the device, where it always belonged
 * — it addresses a device *within* a connection, which is exactly how a second
 * inverter on the same gateway will be described.
 */
async function seed(io: RegistryIo, profileId: string): Promise<void> {
  const { unitId, ...connection } = await io.inverterConfig();
  // The unit id is not part of the connection: it addresses a device *within*
  // one, which is exactly how the second inverter on this gateway will be
  // described. Everything else is the connection, stored as a snapshot —
  // `app_settings` is still the live truth the runtime dials from, until the
  // slice that moves it here.
  await io.insertSource({
    id: DEFAULT_SOURCE_ID,
    kind: "modbus",
    label: "Inverter",
    config: connection,
    enabled: true,
  });
  await io.insertDevice({
    id: profileId,
    sourceId: DEFAULT_SOURCE_ID,
    profileId,
    deviceClass: "inverter",
    label: "Inverter",
    address: { unitId },
    enabled: true,
  });
  logger.info("registered a device for the active profile: {profileId}", { profileId, connection });
}

/**
 * Make the registry agree with the `activeProfile` setting, which is still the
 * single-device pointer the UI writes.
 *
 * This is not just first-boot seeding. Switching profiles is the ordinary
 * onboarding-correction path — the admin picks the wrong variant of a model,
 * notices, and picks the right one — and before the registry the next boot
 * simply resolved the new id. A registry that seeded once and never looked again
 * would keep decoding a live inverter with the old register map, indefinitely
 * and silently.
 *
 * So: the device for the active profile is created if it is missing and
 * re-enabled if it is there, and any device this seeder previously created for a
 * different profile is *disabled* rather than deleted — its id is the key its
 * readings are stored under, and those outlive the switch. That mirrors what
 * used to happen exactly: the old series stopped growing and stayed where it
 * was.
 */
async function reconcile(io: RegistryIo): Promise<void> {
  const profileId = await io.activeProfileId();
  if (!profileId) return;
  if (!io.resolveProfile(profileId)) {
    // The saved id names a profile this install no longer has — an upgrade that
    // dropped a built-in package, say. Boot degrades to onboarding exactly as it
    // did before the registry existed, and crucially without disabling the
    // device that is working in the meantime.
    logger.warn("active profile {profileId} is not installed — leaving the registry as it is", {
      profileId,
    });
    return;
  }

  const rows = await io.listDevices();
  const existing = rows.find((d) => d.id === profileId);
  if (!existing) await seed(io, profileId);
  else if (!existing.enabled) {
    // Switching back to a profile this install used before. Its device row is
    // the one whose id its history is already under, so it is re-enabled rather
    // than duplicated.
    await io.setDeviceEnabled(profileId, true);
    logger.info("re-enabled the device for {profileId}", { profileId });
  }

  // Everything this seeder owns — the devices it put on the default source —
  // that is not the active one. A device on any other source was not created
  // here and is none of this function's business.
  for (const row of rows) {
    if (row.id === profileId || row.sourceId !== DEFAULT_SOURCE_ID || !row.enabled) continue;
    await io.setDeviceEnabled(row.id, false);
    logger.info("device {id} is no longer the active profile — disabled, history kept", {
      id: row.id,
    });
  }
}

/**
 * Read the tables, seeding them first if this is the first boot after the
 * registry landed, and resolve every row into a live {@link Device}.
 *
 * A row that cannot be resolved is dropped with a reason and the rest still
 * load. One unreadable device must not cost the plant — which is the whole
 * reason this is a table and not an `app_settings` value.
 */
// fallow-ignore-next-line unused-export -- built here by initDeviceRegistry and driven directly by device-registry.test.ts against a fake io; test files aren't traced as consumers
export async function createDeviceRegistry(io: RegistryIo): Promise<DeviceRegistry> {
  await reconcile(io);

  const { sources: sourceRecords, skipped: badSources } = parseSourceRows(await io.listSources());
  const { devices: deviceRecords, skipped: badDevices } = parseDeviceRows(await io.listDevices());
  for (const { id, reason } of [...badSources, ...badDevices]) {
    logger.error("ignoring unreadable registry row {id}: {reason}", { id, reason });
  }

  const sources = new Map<string, Source>(sourceRecords.map((s) => [s.id, { ...s }]));
  const devices: Device[] = [];
  for (const record of deviceRecords) {
    const source = sources.get(record.sourceId);
    if (!source) {
      logger.error("device {id} names source {sourceId}, which does not exist — skipping", {
        id: record.id,
        sourceId: record.sourceId,
      });
      continue;
    }
    const profile = io.resolveProfile(record.profileId);
    if (!profile) {
      logger.warn("device {id} needs profile {profileId}, which is not installed — skipping", {
        id: record.id,
        profileId: record.profileId,
      });
      continue;
    }
    devices.push({
      id: record.id,
      label: record.label,
      deviceClass: record.deviceClass,
      source,
      address: record.address,
      enabled: record.enabled,
      // Built per device rather than shared: one manifest across two devices is
      // how two machines end up rendering as one.
      ctx: buildProfileContext(profile),
    });
  }

  const activeId = await io.activeProfileId();
  const byId = new Map(devices.map((d) => [d.id, d]));

  return {
    devices: () => [...devices],
    pollable: () => devices.filter((d) => d.enabled && d.source.enabled),
    get: (id) => byId.get(id),
    // The saved pointer still wins while it exists, so a caller that has not
    // been told about devices yet resolves to the one it always meant.
    default: () => (activeId ? byId.get(activeId) : undefined) ?? devices[0],
  };
}

/** The real backend: the two tables, the saved connection, the profile registry. */
function dbRegistryIo(): RegistryIo {
  return {
    listSources: () => db.select().from(sourcesTable),
    listDevices: () => db.select().from(devicesTable),
    insertSource: async (row) => {
      await db.insert(sourcesTable).values(row).onConflictDoNothing();
    },
    insertDevice: async (row) => {
      await db.insert(devicesTable).values(row).onConflictDoNothing();
    },
    setDeviceEnabled: async (id, enabled) => {
      await db.update(devicesTable).set({ enabled }).where(eq(devicesTable.id, id));
    },
    activeProfileId,
    inverterConfig: getInverterConfig,
    resolveProfile: tryGetProfile,
  };
}

/**
 * Build the registry from the database and install it as the process's own.
 * Called once, from the composition root, before any route or bridge is built.
 */
export async function initDeviceRegistry(): Promise<DeviceRegistry> {
  const registry = await createDeviceRegistry(dbRegistryIo());
  setDeviceRegistry(registry);
  const all = registry.devices();
  logger.info("device registry: {count} device(s), {pollable} pollable", {
    count: all.length,
    pollable: registry.pollable().length,
    ids: all.map((d) => d.id),
  });
  return registry;
}
