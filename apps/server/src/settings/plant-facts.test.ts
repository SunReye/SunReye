import { describe, expect, test } from "bun:test";

import type { DeviceBattery } from "@SunReye/db/batteries";
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
import type { ProvisionStore } from "../inverter/provision";

import { createPlantFacts } from "./plant-facts";

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
 * The same in-memory spine `../inverter/provision.test.ts` drives, kept local
 * rather than shared: a fixture exported between suites is a fixture two suites
 * then constrain, and the SQL these calls become is proved in
 * `apps/server/db-tests/plant-spine.test.ts` either way.
 */
function memoryStore(seed: { settings?: Record<string, unknown> } = {}) {
  let nextId = 1;
  const plants: PlantRecord[] = [];
  const devices: Array<DeviceRecord & { plantId: number }> = [];
  const connections: Array<ConnectionRecord & { plantId: number }> = [];
  const batteries: DeviceBatteryRecord[] = [];
  const settings = seed.settings ?? {};
  const store: ProvisionStore = {
    async ensurePlant(defaults: PlantDefaults) {
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
      const plant = plants.find((p) => p.id === id);
      if (plant) Object.assign(plant, patch);
    },
    async readConnection(plantId: number) {
      return connections.find((c) => c.plantId === plantId) ?? null;
    },
    async ensureConnection(plantId: number, cfg: ConnectionSettings) {
      const created = { ...cfg, id: nextId++, plantId };
      connections.push(created);
      return created;
    },
    async readDevices(plantId: number) {
      return devices.filter((d) => d.plantId === plantId);
    },
    async ensureDevice(spec: DeviceSpec) {
      // A `DeviceSpec` carries no lifecycle flag: a device is created in
      // service, and retirement is an UPDATE.
      const { pv, ...fields } = spec;
      const created = {
        arrays: [],
        tempCoefficient: -0.4,
        systemLoss: 14,
        ...pv,
        ...fields,
        id: nextId++,
        retiredAt: null,
      };
      devices.push(created);
      return created;
    },
    async updateDevice(id: number, patch: DevicePatch) {
      const device = devices.find((d) => d.id === id);
      if (!device) throw new Error(`no device ${id}`);
      Object.assign(device, patch);
      return device;
    },
    async readPlantBatteries(plantId: number) {
      const ids = new Set(devices.filter((d) => d.plantId === plantId).map((d) => d.id));
      return batteries.filter((b) => ids.has(b.deviceId));
    },
    async upsertDeviceBattery(deviceId: number, battery: DeviceBattery) {
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
  return { store, plants, devices, batteries };
}

const warnings: string[] = [];
const logger = {
  info: () => {},
  warn: (template: string) => {
    warnings.push(template);
  },
};

/** A facts accessor with a device already provisioned, ready to be written to. */
async function facts(seed: Parameters<typeof memoryStore>[0] = {}) {
  warnings.length = 0;
  const memory = memoryStore(seed);
  const accessor = createPlantFacts({ store: memory.store, logger });
  const plant = await accessor.plant();
  memory.devices.push({
    id: 100,
    plantId: plant.id,
    slug: "inverter",
    name: "Inverter",
    profileId: "p",
    role: "inverter",
    arrays: [],
    tempCoefficient: -0.4,
    systemLoss: 14,
    retiredAt: null,
    unitId: 1,
    connectionId: null,
  });
  accessor.invalidate();
  return { ...memory, accessor };
}

describe("the plant facts accessor", () => {
  test("reads the plant row once and serves it from memory", async () => {
    const { accessor, plants } = await facts();
    const first = await accessor.plant();
    await accessor.plant();
    expect(plants.length).toBe(1);
    expect((await accessor.plant()).id).toBe(first.id);
  });

  test("a write invalidates the cache, so the next read sees it", async () => {
    const { accessor } = await facts();
    await accessor.patch({ systemLoss: 11 });
    expect((await accessor.plant()).systemLoss).toBe(11);
    await accessor.patch({ systemLoss: 12 });
    expect((await accessor.plant()).systemLoss).toBe(12);
  });

  test("the derived plant battery is CAPACITY-WEIGHTED across two devices", async () => {
    // The regression this exists to prevent is invisible with one device, where
    // the derivation is the identity function.
    const { accessor, store, devices, plants } = await facts();
    devices.push({
      id: 101,
      plantId: plants[0]?.id ?? 1,
      slug: "inverter-2",
      name: "Second",
      profileId: "p",
      role: "inverter",
      arrays: [],
      tempCoefficient: -0.4,
      systemLoss: 14,
      retiredAt: null,
      unitId: 2,
      connectionId: null,
    });
    await store.upsertDeviceBattery(100, {
      usableKwh: 30,
      maxChargeW: 9000,
      minSoc: 5,
      nominalV: 48,
    });
    await store.upsertDeviceBattery(101, {
      usableKwh: 5,
      maxChargeW: 2500,
      minSoc: 50,
      nominalV: null,
    });
    accessor.invalidate();
    const battery = await accessor.battery();
    expect(battery?.usableKwh).toBe(35);
    expect(battery?.maxChargeW).toBe(11500);
    // The plain mean would say 27.5 %, reserving 9.6 kWh that does not exist.
    expect(battery?.minSoc).toBeCloseTo(11.4286, 4);
    expect(battery?.nominalV).toBe(48);
  });

  test("no pack rows is no battery, not a battery of zero", async () => {
    const { accessor } = await facts();
    expect(await accessor.battery()).toBeNull();
  });

  /**
   * The STATED pack voltage, as the pack rows say it — the number the
   * peak-shaving engine scales every commanded charge current by.
   *
   * Separate from `battery().nominalV` on purpose. That one is the AGGREGATE's,
   * and the aggregate takes "the first stated value" across packs, which is an
   * arbitrary pick when they disagree (`@SunReye/db/batteries` says so in as many
   * words: mixed voltages are a configuration it cannot express). An arbitrary
   * pick is fine for a forecast and is not fine for a register write, so the
   * engine asks this instead and gets `null` — "cannot say" — rather than a coin
   * toss, and then falls back to what the operator actually stated somewhere.
   */
  test("the stated pack voltage is the packs' one agreed value", async () => {
    const { accessor, store } = await facts();
    await store.upsertDeviceBattery(100, {
      usableKwh: 30,
      maxChargeW: null,
      minSoc: 5,
      nominalV: 48,
    });
    accessor.invalidate();
    expect(await accessor.packNominalV()).toBe(48);
  });

  test("is null when no pack states one", async () => {
    const { accessor, store } = await facts();
    // A pack row that exists before its voltage is entered. Null keeps the
    // engine on whatever this install was already charging at, instead of
    // silently rescaling every current to a 51.2 V default.
    await store.upsertDeviceBattery(100, {
      usableKwh: 30,
      maxChargeW: null,
      minSoc: 5,
      nominalV: null,
    });
    accessor.invalidate();
    expect(await accessor.packNominalV()).toBeNull();
  });

  test("is null on a plant with no pack at all", async () => {
    const { accessor } = await facts();
    expect(await accessor.packNominalV()).toBeNull();
  });

  test("is null when two packs disagree, and the agreed value when they do not", async () => {
    const { accessor, store, devices, plants } = await facts();
    devices.push({
      id: 101,
      plantId: plants[0]?.id ?? 1,
      slug: "inverter-2",
      name: "Second",
      profileId: "p",
      role: "inverter",
      arrays: [],
      tempCoefficient: -0.4,
      systemLoss: 14,
      retiredAt: null,
      unitId: 2,
      connectionId: null,
    });
    const pack = (nominalV: number | null) => ({
      usableKwh: 10,
      maxChargeW: null,
      minSoc: 10,
      nominalV,
    });
    await store.upsertDeviceBattery(100, pack(48));
    await store.upsertDeviceBattery(101, pack(51.2));
    accessor.invalidate();
    expect(await accessor.packNominalV()).toBeNull();

    // Two packs at the same voltage is not a disagreement — that is one answer
    // stated twice, and refusing it would drop a two-pack plant to the legacy
    // default for no reason.
    await store.upsertDeviceBattery(101, pack(48));
    accessor.invalidate();
    expect(await accessor.packNominalV()).toBe(48);

    // One silent pack does not veto the one that spoke: nothing contradicts 48.
    await store.upsertDeviceBattery(101, pack(null));
    accessor.invalidate();
    expect(await accessor.packNominalV()).toBe(48);
  });

  test("the device rows are read once and served from memory, and a write drops them", async () => {
    const { accessor, devices, plants } = await facts();
    const first = await accessor.devices();
    expect(first.map((d) => d.slug)).toEqual(["inverter"]);
    devices.push({
      id: 101,
      plantId: plants[0]?.id ?? 1,
      slug: "inverter-2",
      name: "Second",
      profileId: "p",
      role: "inverter",
      arrays: [],
      tempCoefficient: -0.4,
      systemLoss: 14,
      retiredAt: null,
      unitId: 2,
      connectionId: null,
    });
    // Cached: the push is not seen…
    expect((await accessor.devices()).length).toBe(1);
    // …until something invalidates.
    await accessor.patch({ label: "moved" });
    expect((await accessor.devices()).map((d) => d.slug)).toEqual(["inverter", "inverter-2"]);
  });
});

describe("a failed read is never cached as a value", () => {
  test("the plant read is retried after a failure", async () => {
    // Otherwise one database hiccup at boot idles the whole settings layer for
    // the life of the process: every accessor above this one composes over the
    // plant row, and a rejected promise held in the cache is returned forever.
    let attempts = 0;
    const memory = memoryStore();
    const flaky = {
      ...memory.store,
      async ensurePlant(defaults: PlantDefaults) {
        attempts++;
        if (attempts === 1) throw new Error("database is down");
        return memory.store.ensurePlant(defaults);
      },
    };
    const accessor = createPlantFacts({ store: flaky, logger });
    await expect(accessor.plant()).rejects.toThrow("database is down");
    expect((await accessor.plant()).id).toBeGreaterThan(0);
    expect(attempts).toBe(2);
  });

  test("the pack read is retried after a failure too", async () => {
    let attempts = 0;
    const memory = memoryStore();
    const flaky = {
      ...memory.store,
      async readPlantBatteries(plantId: number) {
        attempts++;
        if (attempts === 1) throw new Error("packs unavailable");
        return memory.store.readPlantBatteries(plantId);
      },
    };
    const accessor = createPlantFacts({ store: flaky, logger });
    await expect(accessor.battery()).rejects.toThrow("packs unavailable");
    expect(await accessor.battery()).toBeNull();
    expect(attempts).toBe(2);
  });
});
