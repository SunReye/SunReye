import { beforeEach, describe, expect, test } from "bun:test";

import type {
  ConnectionRecord,
  ConnectionSettings,
  DeviceBatteryRecord,
  DevicePatch,
  DeviceRecord,
  DeviceSpec,
  PlantDefaults,
  PlantPatch,
  PlantRecord,
} from "@SunReye/db/plant-repo";
import { inverterConfigSchema } from "@SunReye/db/inverter-config";

import {
  type ProvisionStore,
  dbProvisionStore,
  provisionDevice,
  provisionPlantRow,
  slugify,
} from "./provision";

/** The `plants` column defaults, as `packages/db/src/schema/plants.ts` declares them. */
const COLUMN_DEFAULTS = {
  tariffKey: null,
  latitude: null,
  longitude: null,
  label: "",
  arrays: [],
  tempCoefficient: -0.4,
  systemLoss: 14,
  maxOutputW: null,
  houseLoadW: null,
  smartMeterSince: null,
} as const satisfies Partial<PlantRecord>;

/**
 * An in-memory stand-in for the four dimension tables.
 *
 * A fake rather than a mock: every rule under test here is about WHICH rows
 * exist after a second boot, so the double has to actually hold rows. The SQL
 * those calls become is proved separately, against a real Postgres, in
 * `apps/server/db-tests/plant-spine.test.ts`.
 *
 * `nextId` never reuses a number, exactly as `GENERATED ALWAYS AS IDENTITY`
 * does not — so a test that accidentally re-created a row would show a changed
 * id, which is the failure that matters.
 */
function memoryStore(seed: { settings?: Record<string, unknown> } = {}) {
  let nextId = 1;
  const plants: PlantRecord[] = [];
  const connections: Array<ConnectionRecord & { plantId: number }> = [];
  const devices: Array<DeviceRecord & { plantId: number }> = [];
  const batteries: DeviceBatteryRecord[] = [];
  const settings = seed.settings ?? {};
  /** Every write the policy made, so a test can assert what was NOT touched. */
  const calls: string[] = [];

  const store: ProvisionStore = {
    async ensurePlant(defaults: PlantDefaults) {
      calls.push("ensurePlant");
      const existing = plants[0];
      if (existing) return existing;
      const created: PlantRecord = {
        ...COLUMN_DEFAULTS,
        id: nextId++,
        name: defaults.name,
        slug: defaults.slug,
        timeZone: defaults.timeZone ?? "auto",
        biddingZone: defaults.biddingZone ?? null,
        // Spread LAST, so an unstated fact keeps the column's own default —
        // which is what the real INSERT does now that it names only the columns
        // it was given.
        ...defaults.facts,
      };
      plants.push(created);
      return created;
    },
    async updatePlant(id: number, patch: PlantPatch) {
      calls.push(`updatePlant:${Object.keys(patch).join(",")}`);
      const plant = plants.find((p) => p.id === id);
      if (plant) Object.assign(plant, patch);
    },
    async ensureConnection(plantId: number, cfg: ConnectionSettings) {
      calls.push("ensureConnection");
      const existing = connections.find((c) => c.plantId === plantId);
      if (existing) {
        Object.assign(existing, cfg);
        return existing;
      }
      const created = { ...cfg, id: nextId++, plantId };
      connections.push(created);
      return created;
    },
    async readConnection(plantId: number) {
      return connections.find((c) => c.plantId === plantId) ?? null;
    },
    async readDevices(plantId: number) {
      return devices.filter((d) => d.plantId === plantId);
    },
    async ensureDevice(spec: DeviceSpec) {
      calls.push("ensureDevice");
      const existing = devices.find((d) => d.plantId === spec.plantId && d.slug === spec.slug);
      if (existing) return existing;
      // `retiredAt: null` because a `DeviceSpec` carries no lifecycle flag: a
      // device is created in service, and retirement is an UPDATE.
      const created = { ...spec, id: nextId++, retiredAt: null };
      devices.push(created);
      return created;
    },
    async updateDevice(id: number, patch: DevicePatch) {
      calls.push(`updateDevice:${Object.keys(patch).join(",")}`);
      const device = devices.find((d) => d.id === id);
      if (!device) throw new Error(`no device ${id}`);
      Object.assign(device, patch);
      return device;
    },
    async readPlantBatteries(plantId: number) {
      const ids = new Set(devices.filter((d) => d.plantId === plantId).map((d) => d.id));
      return batteries.filter((b) => ids.has(b.deviceId));
    },
    async upsertDeviceBattery(deviceId, battery) {
      calls.push("upsertDeviceBattery");
      const existing = batteries.find((b) => b.deviceId === deviceId);
      if (existing) Object.assign(existing, battery);
      else batteries.push({ deviceId, ...battery });
    },
    async deleteDeviceBattery(deviceId: number) {
      const at = batteries.findIndex((b) => b.deviceId === deviceId);
      if (at >= 0) batteries.splice(at, 1);
    },
    async readRawSetting(key: string) {
      return settings[key];
    },
  };

  return { store, plants, connections, devices, batteries, calls };
}

const warnings: Array<{ template: string; values?: Record<string, unknown> }> = [];
const logger = {
  info: () => {},
  warn: (template: string, values?: Record<string, unknown>) => {
    warnings.push({ template, values });
  },
};

beforeEach(() => {
  warnings.length = 0;
});

const profile = { id: "deye-sun-12k", name: "Deye SUN-12K" };
const seed = (over: Record<string, unknown> = {}) =>
  inverterConfigSchema.parse({ host: "10.0.0.5", unitId: 1, ...over });

describe("slugify", () => {
  test("makes a stable machine name out of a typed one", () => {
    expect(slugify("Haus Müller — Dach Süd")).toBe("haus-muller-dach-sud");
    expect(slugify("  My Plant  ")).toBe("my-plant");
    expect(slugify("A/B\\C")).toBe("a-b-c");
  });

  test("never yields an empty or edge-dashed slug", () => {
    // The slug becomes an MQTT topic segment and a URL vocabulary word; a
    // leading dash or an empty string would produce `prefix//topic`.
    expect(slugify("!!!")).toBe("");
    expect(slugify("---x---")).toBe("x");
  });

  test("is bounded, because a topic segment is not a free-text field", () => {
    expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(48);
  });
});

describe("provisionPlantRow", () => {
  test("creates the plant a fresh install has none of", async () => {
    const { store, plants } = memoryStore();
    const plant = await provisionPlantRow({ store, logger });
    expect(plants.length).toBe(1);
    expect(plant.name).toBe("My plant");
    expect(plant.slug).toBe("my-plant");
  });

  test("a label that slugifies to nothing still gets a legal topic segment", () => {
    // The slug is an MQTT topic segment; "" would render `<prefix>//<topic>`.
    return provisionPlantRow({
      store: memoryStore({ settings: { weather: { label: "!!!" } } }).store,
      logger,
    }).then((plant) => {
      expect(plant.name).toBe("!!!");
      expect(plant.slug).toBe("plant");
    });
  });

  test("names the plant after the weather label the install already typed", async () => {
    // "Derive sensible defaults from whatever exists" — and the label is the one
    // human-typed name a 1.x install has for its site.
    const { store } = memoryStore({
      settings: { weather: { label: "Limburg-Weilburg", latitude: 50.4 } },
    });
    const plant = await provisionPlantRow({ store, logger });
    expect(plant.name).toBe("Limburg-Weilburg");
    expect(plant.slug).toBe("limburg-weilburg");
  });

  test("seeds the plant columns from the 1.x app_settings blobs", async () => {
    const { store } = memoryStore({
      settings: {
        weather: {
          latitude: 50.4,
          longitude: 8.06,
          label: "Limburg",
          forecast: {
            arrays: [{ kwp: 9.8, tilt: 30, azimuth: 0 }],
            systemLoss: 11,
            maxOutputW: 7000,
            houseLoadW: 350,
            smartMeterSince: "2026-03-01",
          },
        },
        plant: { timeZone: "Europe/Berlin" },
        "spot-prices": { zone: "DE-LU" },
      },
    });
    const plant = await provisionPlantRow({ store, logger });
    expect(plant.latitude).toBe(50.4);
    expect(plant.arrays).toEqual([{ kwp: 9.8, tilt: 30, azimuth: 0 }]);
    expect(plant.systemLoss).toBe(11);
    expect(plant.maxOutputW).toBe(7000);
    expect(plant.houseLoadW).toBe(350);
    expect(plant.smartMeterSince).toBe("2026-03-01");
    expect(plant.timeZone).toBe("Europe/Berlin");
    expect(plant.biddingZone).toBe("DE-LU");
  });

  test("mines a legacy blob the current schema would REJECT", async () => {
    // readSetting would safeParse this to the default with no log and the
    // coordinates would be gone. The seeding probes the raw row instead.
    const { store } = memoryStore({
      settings: {
        weather: { latitude: 50.4, forecast: { arrays: [{ kwp: 9.8, tilt: 400, azimuth: 0 }] } },
      },
    });
    const plant = await provisionPlantRow({ store, logger });
    expect(plant.latitude).toBe(50.4);
    expect(plant.arrays).toEqual([]);
  });

  test("a second boot changes NOTHING — no second plant, no rename, no re-seed", async () => {
    const { store, plants, calls } = memoryStore({ settings: { weather: { label: "First" } } });
    const first = await provisionPlantRow({ store, logger });
    await store.updatePlant(first.id, { name: "Renamed by the operator", systemLoss: 20 });
    calls.length = 0;
    const second = await provisionPlantRow({ store, logger });
    expect(plants.length).toBe(1);
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Renamed by the operator");
    expect(second.systemLoss).toBe(20);
    // No UPDATE at all on the second boot: seeding is a creation-time act.
    expect(calls.filter((c) => c.startsWith("updatePlant"))).toEqual([]);
  });
});

describe("provisionDevice", () => {
  test("a fresh install gets a plant, a connection and one role='inverter' device", async () => {
    const { store, devices, connections } = memoryStore();
    const result = await provisionDevice({ store, logger, profile, seed: seed() });
    expect(connections.length).toBe(1);
    expect(devices.length).toBe(1);
    expect(devices[0]?.role).toBe("inverter");
    expect(devices[0]?.profileId).toBe("deye-sun-12k");
    expect(devices[0]?.unitId).toBe(1);
    expect(devices[0]?.connectionId).toBe(connections[0]?.id);
    expect(result?.deviceId).toBe(devices[0]?.id ?? -1);
  });

  test("the device is named from the profile and slugged from its ROLE", async () => {
    // The slug becomes `<prefix>/<plant-slug>/<device-slug>/<topic>` in a later
    // wave, so it must not be the profile id: a profile swap would move every
    // topic and orphan every discovered Home Assistant entity. The role is
    // stable across swaps; the NAME is where the model belongs.
    const { store, devices } = memoryStore();
    await provisionDevice({ store, logger, profile, seed: seed() });
    expect(devices[0]?.slug).toBe("inverter");
    expect(devices[0]?.name).toBe("Deye SUN-12K");
  });

  test("booting twice creates nothing new and RENUMBERS nothing", async () => {
    // The requirement, stated as its consequence: an int2 renumber silently
    // rebinds every historical reading to a different machine.
    const { store, devices, connections, plants } = memoryStore();
    const first = await provisionDevice({ store, logger, profile, seed: seed() });
    const second = await provisionDevice({ store, logger, profile, seed: seed() });
    const third = await provisionDevice({ store, logger, profile, seed: seed() });
    expect(plants.length).toBe(1);
    expect(connections.length).toBe(1);
    expect(devices.length).toBe(1);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  test("an operator's rename survives every later boot", async () => {
    const { store, devices } = memoryStore();
    const first = await provisionDevice({ store, logger, profile, seed: seed() });
    await store.updateDevice(first?.deviceId ?? -1, { name: "Garage inverter" });
    await provisionDevice({ store, logger, profile, seed: seed() });
    expect(devices[0]?.name).toBe("Garage inverter");
  });

  test("a PROFILE SWAP re-points the same device instead of adding one", async () => {
    // In 1.x the profile id WAS the stored identity, so a swap orphaned all of
    // history. The device must keep its id and its frozen slug.
    const { store, devices } = memoryStore();
    const first = await provisionDevice({ store, logger, profile, seed: seed() });
    const swapped = await provisionDevice({
      store,
      logger,
      profile: { id: "sigenergy-hybrid", name: "Sigenergy" },
      seed: seed(),
    });
    expect(devices.length).toBe(1);
    expect(swapped?.deviceId).toBe(first?.deviceId);
    expect(devices[0]?.slug).toBe("inverter");
    expect(devices[0]?.profileId).toBe("sigenergy-hybrid");
  });

  test("a later boot NEVER overwrites the endpoint the spine already holds", async () => {
    // THE WRITE-BACK, DELETED. Provisioning used to copy the legacy
    // `app_settings.inverter` document into `connections` and `devices.unit_id`
    // on every boot, which made that document the authority and silently undid
    // every edit an operator made to the endpoint. The seed CREATES rows; it
    // never edits one. `../routes/settings.ts` -> `./endpoint.ts` is the only
    // writer.
    const { store, connections, devices } = memoryStore();
    const first = await provisionDevice({ store, logger, profile, seed: seed() });
    // The operator moves the gateway (what the settings PUT does).
    await store.ensureConnection(1, {
      name: "Inverter",
      host: "10.0.0.9",
      port: 8899,
      transport: "rtu-over-tcp",
      timeoutMs: 3000,
      pollIntervalMs: 2000,
    });
    await store.updateDevice(first?.deviceId ?? -1, { unitId: 3 });
    // ...and a boot later the stale legacy document says something else entirely.
    await provisionDevice({ store, logger, profile, seed: seed({ host: "10.0.0.5", unitId: 1 }) });
    expect(connections.length).toBe(1);
    expect(connections[0]?.host).toBe("10.0.0.9");
    expect(connections[0]?.port).toBe(8899);
    expect(connections[0]?.pollIntervalMs).toBe(2000);
    expect(devices[0]?.unitId).toBe(3);
    expect(devices[0]?.connectionId).toBe(first?.connectionId);
  });

  test("the adopt patch names the PROFILE and nothing else about the endpoint", async () => {
    // Stated as the patch itself, because the patch is the write-back: `unitId`
    // or `connectionId` appearing here is the defect coming back. A profile swap
    // must still re-point the driver.
    const { store, calls } = memoryStore();
    await provisionDevice({ store, logger, profile, seed: seed() });
    await provisionDevice({ store, logger, profile, seed: seed() });
    expect(calls).toContain("updateDevice:profileId");
    expect(calls.filter((c) => c.startsWith("updateDevice")).join(" ")).not.toContain("unitId");
  });

  test("the endpoint is still SEEDED when the plant has none — the 1.2.0 upgrade", async () => {
    // The other half of the same rule: a 1.2.0 install's endpoint lives ONLY in
    // `app_settings`, and the first boot after the upgrade is the one chance to
    // carry it across. Not seeding would leave the plant with no address at all.
    const { store, connections } = memoryStore();
    await provisionDevice({
      store,
      logger,
      profile,
      seed: seed({ host: "10.0.0.5", port: 8899, transport: "rtu-over-tcp", pollIntervalMs: 5000 }),
    });
    expect(connections.length).toBe(1);
    expect(connections[0]).toMatchObject({
      host: "10.0.0.5",
      port: 8899,
      transport: "rtu-over-tcp",
      pollIntervalMs: 5000,
    });
  });

  test("a device created against an existing endpoint adopts it rather than adding one", async () => {
    // The onboarding order: the operator saves the connection first (no profile
    // active, so no device), then a profile is activated and this boot creates
    // the device. It must bind to the endpoint that is already there.
    const { store, connections, devices } = memoryStore();
    const plant = await store.ensurePlant({ name: "P", slug: "p" });
    const saved = await store.ensureConnection(plant.id, {
      name: "Inverter",
      host: "10.0.0.9",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
    await provisionDevice({ store, logger, profile, seed: seed({ host: "10.0.0.5" }) });
    expect(connections.length).toBe(1);
    expect(connections[0]?.host).toBe("10.0.0.9");
    expect(devices[0]?.connectionId).toBe(saved.id);
  });

  test("with no host there is no endpoint at all — the simulate case", async () => {
    // `connection_id` is nullable precisely for this, and NULLs are distinct in
    // `devices_connection_unit_key`, so simulate installs coexist.
    const { store, connections, devices } = memoryStore();
    const result = await provisionDevice({ store, logger, profile, seed: seed({ host: "" }) });
    expect(connections.length).toBe(0);
    expect(result?.connectionId).toBeNull();
    expect(devices[0]?.connectionId).toBeNull();
  });

  test("a blank host does not UNBIND a device that already has an endpoint", async () => {
    // Turning on INVERTER_SIMULATE on a real install must not silently detach
    // the device from the gateway it is physically wired to.
    const { store, devices } = memoryStore();
    const first = await provisionDevice({ store, logger, profile, seed: seed() });
    await provisionDevice({ store, logger, profile, seed: seed({ host: "   " }) });
    expect(devices[0]?.connectionId).toBe(first?.connectionId);
  });

  test("a role='controller' device is never hijacked into being the inverter", async () => {
    // A Victron GX or a Sigenergy plant controller reports plant-level values
    // from its OWN registers. Re-pointing it at the inverter profile would make
    // its readings claim to be an inverter's.
    const { store, devices } = memoryStore();
    const plant = await store.ensurePlant({ name: "P", slug: "p" });
    await store.ensureDevice({
      plantId: plant.id,
      connectionId: null,
      unitId: 100,
      slug: "gx",
      name: "GX",
      profileId: "victron-gx",
      role: "controller",
    });
    const result = await provisionDevice({ store, logger, profile, seed: seed() });
    expect(devices.length).toBe(2);
    expect(devices.find((d) => d.slug === "gx")?.role).toBe("controller");
    expect(devices.find((d) => d.slug === "gx")?.profileId).toBe("victron-gx");
    expect(devices.find((d) => d.id === result?.deviceId)?.role).toBe("inverter");
  });

  test("an OPTIMIZER is never hijacked, even when it carries the active profile id", async () => {
    // The virtual device has no endpoint and no registers. Re-pointing it at the
    // inverter profile would leave the install with a device the poll loop
    // filters out (`selectPollTargets` takes `role = 'inverter'` only) — so the
    // boot would look successful and store nothing at all.
    const { store, devices } = memoryStore();
    const plant = await store.ensurePlant({ name: "P", slug: "p" });
    await store.ensureDevice({
      plantId: plant.id,
      connectionId: null,
      unitId: 0,
      slug: "optimizer",
      name: "Optimizer",
      profileId: profile.id,
      role: "optimizer",
    });
    const result = await provisionDevice({ store, logger, profile, seed: seed() });
    expect(devices).toHaveLength(2);
    const optimizer = devices.find((d) => d.slug === "optimizer");
    expect(optimizer?.role).toBe("optimizer");
    expect(result?.deviceId).not.toBe(optimizer?.id);
    expect(devices.find((d) => d.id === result?.deviceId)?.role).toBe("inverter");
  });

  test("a RETIRED optimizer changes nothing — provisioning still gets its inverter", async () => {
    // Both filters at once: the virtual role and retirement. The refusal that
    // returns null is about the frozen INVERTER slug, and a retired virtual
    // device must not trip it.
    const { store, devices } = memoryStore();
    const plant = await store.ensurePlant({ name: "P", slug: "p" });
    const created = await store.ensureDevice({
      plantId: plant.id,
      connectionId: null,
      unitId: 0,
      slug: "optimizer",
      name: "Optimizer",
      profileId: profile.id,
      role: "optimizer",
    });
    await store.updateDevice(created.id, { retiredAt: new Date("2026-01-01T00:00:00Z") });
    const result = await provisionDevice({ store, logger, profile, seed: seed() });
    expect(devices).toHaveLength(2);
    expect(devices.find((d) => d.id === result?.deviceId)?.slug).toBe("inverter");
  });

  test("the legacy 1.x pack is moved onto the device's battery row, once", async () => {
    const { store, batteries } = memoryStore({
      settings: {
        weather: {
          forecast: { battery: { usableKwh: 30, maxChargeW: 9000, minSoc: 5, nominalV: 48 } },
        },
      },
    });
    await provisionDevice({ store, logger, profile, seed: seed() });
    expect(batteries.length).toBe(1);
    expect(batteries[0]).toMatchObject({
      usableKwh: 30,
      maxChargeW: 9000,
      minSoc: 5,
      nominalV: 48,
    });
  });

  test("the pack's nominal voltage comes through resolveNominalV, both legacy homes", async () => {
    // It has moved TWICE. An install that set 48 V on the AUTOMATIONS page and
    // never touched the plant record must keep charging at 48 V — a default here
    // would rescale every commanded charge current by 7 %.
    const { store, batteries } = memoryStore({
      settings: {
        weather: { forecast: { battery: { usableKwh: 10 } } },
        automations: { peakShaving: { nominalBatteryV: 48 } },
      },
    });
    await provisionDevice({ store, logger, profile, seed: seed() });
    expect(batteries[0]?.nominalV).toBe(48);
  });

  test("nothing states a voltage: null, never a default", async () => {
    const { store, batteries } = memoryStore({
      settings: { weather: { forecast: { battery: { usableKwh: 10 } } } },
    });
    await provisionDevice({ store, logger, profile, seed: seed() });
    expect(batteries[0]?.nominalV).toBeNull();
  });

  test("a pack already described in the new schema is never overwritten by the legacy one", async () => {
    const { store, batteries } = memoryStore({
      settings: { weather: { forecast: { battery: { usableKwh: 30, minSoc: 5 } } } },
    });
    const first = await provisionDevice({ store, logger, profile, seed: seed() });
    await store.upsertDeviceBattery(first?.deviceId ?? -1, {
      usableKwh: 12,
      maxChargeW: null,
      minSoc: 20,
      nominalV: null,
    });
    await provisionDevice({ store, logger, profile, seed: seed() });
    expect(batteries.length).toBe(1);
    expect(batteries[0]?.usableKwh).toBe(12);
    expect(batteries[0]?.minSoc).toBe(20);
  });

  test("no legacy pack means no pack row — a plant without storage stays without", async () => {
    const { store, batteries } = memoryStore();
    await provisionDevice({ store, logger, profile, seed: seed() });
    expect(batteries).toEqual([]);
  });

  test("a RETIRED device is not adopted by any of the three search arms", async () => {
    // `retired_at` exists because ON DELETE RESTRICT leaves no other way out of
    // service. Its third semantic is the load-bearing one: the row must never be
    // re-adopted. All three arms would otherwise hit this row — the profile id,
    // and "the plant's role='inverter' row".
    const { store, devices } = memoryStore();
    const plant = await store.ensurePlant({ name: "P", slug: "p" });
    const dead = await store.ensureDevice({
      plantId: plant.id,
      connectionId: null,
      unitId: 9,
      slug: "inverter-1",
      name: "The one that died",
      profileId: profile.id,
      role: "inverter",
    });
    await store.updateDevice(dead.id, { retiredAt: new Date("2026-08-01T00:00:00Z") });
    const result = await provisionDevice({ store, logger, profile, seed: seed() });
    expect(result?.deviceId).not.toBe(dead.id);
    expect(devices.length).toBe(2);
    expect(devices.find((d) => d.id === dead.id)?.retiredAt).not.toBeNull();
  });

  test("a retired device holding the FROZEN slug is not resurrected — nothing is provisioned", async () => {
    // `devices_plant_slug_key` is unconditional by design (the slug is written
    // into years of exports), so `ensureDevice` on a retired slug hands the
    // RETIRED row straight back. Writing readings to it, or clearing its
    // retirement, would both be the resurrection this column exists to prevent —
    // and the physical `(connection_id, unit_id)` claim is still the old
    // machine's. So the boot declines, loudly, and the writer's own "no device
    // names this source" degradation takes over.
    const { store, devices } = memoryStore();
    const plant = await store.ensurePlant({ name: "P", slug: "p" });
    const dead = await store.ensureDevice({
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "inverter",
      name: "The one that died",
      profileId: profile.id,
      role: "inverter",
    });
    await store.updateDevice(dead.id, { retiredAt: new Date("2026-08-01T00:00:00Z") });
    const result = await provisionDevice({ store, logger, profile, seed: seed() });
    expect(result).toBeNull();
    expect(devices.length).toBe(1);
    expect(devices[0]?.retiredAt).not.toBeNull();
    expect(warnings.map((w) => w.template).join(" ")).toContain("retired");
  });

  test("un-retiring a device makes the next boot adopt it again, id intact", async () => {
    // Retirement is an UPDATE both ways, and the whole point of never deleting
    // is that the id — and therefore five years of readings — survives.
    const { store, devices } = memoryStore();
    const first = await provisionDevice({ store, logger, profile, seed: seed() });
    await store.updateDevice(first?.deviceId ?? -1, {
      retiredAt: new Date("2026-08-01T00:00:00Z"),
    });
    await store.updateDevice(first?.deviceId ?? -1, { retiredAt: null });
    const again = await provisionDevice({ store, logger, profile, seed: seed() });
    expect(again?.deviceId).toBe(first?.deviceId);
    expect(devices.length).toBe(1);
  });

  test("the provisioned device is what the writer's source id resolves to", async () => {
    // The writer stamps `profile.id` as its source id and resolves slug first,
    // `profile_id` second. Both arms must land on this row or the poll loop
    // keeps dropping every batch it buffers.
    const { store, devices } = memoryStore();
    await provisionDevice({ store, logger, profile, seed: seed() });
    expect(devices[0]?.slug).toBe("inverter");
    expect(devices[0]?.profileId).toBe("deye-sun-12k");
  });
});

describe("dbProvisionStore", () => {
  test("every method reaches the client, and none of them holds it", async () => {
    // The adapter is thin on purpose — the policy above it is what has rules —
    // but "thin" is not "untested": a method wired to the wrong repository
    // function would provision the wrong table and only show up against a real
    // database. `execute` is answered with an empty result, so this proves the
    // wiring and the SQL is proved in `apps/server/db-tests/plant-spine.test.ts`.
    const executed: unknown[] = [];
    const client = {
      async execute(query: unknown) {
        executed.push(query);
        return { rows: [] as unknown[] };
      },
    };
    const store = dbProvisionStore(client);

    // The reads that tolerate an empty answer.
    expect(await store.readDevices(1)).toEqual([]);
    // "the plant has no endpoint yet" is the answer that makes the seed a seed.
    expect(await store.readConnection(1)).toBeNull();
    expect(await store.readPlantBatteries(1)).toEqual([]);
    expect(await store.readRawSetting("weather")).toBeUndefined();
    await store.updatePlant(1, { systemLoss: 11 });
    await store.upsertDeviceBattery(1, {
      usableKwh: 10,
      maxChargeW: null,
      minSoc: 10,
      nominalV: null,
    });
    await store.deleteDeviceBattery(1);
    // The three that need a row back say so rather than inventing an id.
    await expect(store.ensurePlant({ name: "x", slug: "x" })).rejects.toThrow();
    await expect(
      store.ensureConnection(1, {
        name: "n",
        host: "h",
        port: 502,
        transport: "tcp",
        timeoutMs: 2000,
        pollIntervalMs: 1000,
      }),
    ).rejects.toThrow();
    await expect(
      store.ensureDevice({
        plantId: 1,
        connectionId: null,
        unitId: 1,
        slug: "s",
        name: "n",
        profileId: "p",
        role: "inverter",
      }),
    ).rejects.toThrow();
    await expect(store.updateDevice(1, { name: "n" })).rejects.toThrow();
    expect(executed.length).toBeGreaterThan(10);
  });
});
