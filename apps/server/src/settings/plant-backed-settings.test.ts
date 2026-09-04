import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import type { PlantBattery } from "@SunReye/db/batteries";
import type { DeviceRecord, PlantPatch, PlantRecord } from "@SunReye/db/plant-repo";

/**
 * The three accessors that used to read three `app_settings` rows and now
 * compose over one plant row.
 *
 * What is under test is the ROUTING: which half of a save reaches the columns,
 * which reaches the JSONB row, and that a read puts the two back together in the
 * shape twenty call sites are typed on. The pure split/compose is proved in
 * `packages/db/src/plant-facts.test.ts`; the SQL is proved in
 * `apps/server/db-tests/plant-spine.test.ts`. This is the wiring in between,
 * which is where a field can silently go to the wrong place.
 *
 * The spreads are load-bearing: `mock.module` is process-global and permanent,
 * so a mock returning only the exports THIS suite needs would delete the rest
 * for every file that runs afterwards. Override what is stubbed, keep the rest
 * real, and hand the real exports back BY VALUE in afterAll.
 */
const realDb = await import("@SunReye/db");
const realInstance = await import("./plant-facts-instance");
const realDbExports = { ...realDb };
const realInstanceExports = { ...realInstance };

afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
  mock.module("./plant-facts-instance", () => ({ ...realInstanceExports }));
});

/** The `app_settings` row this suite's accessors read and write. */
let storedRow: unknown;
/** Every value written to `app_settings`, so a test asserts what was persisted. */
let written: unknown[] = [];

const select = () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => (storedRow === undefined ? [] : [{ value: storedRow }]),
  };
  return chain;
};
const insert = () => ({
  values: (row: { value: unknown }) => ({
    onConflictDoUpdate: async () => {
      written.push(row.value);
      storedRow = row.value;
    },
  }),
});
mock.module("@SunReye/db", () => ({ ...realDb, db: { select, insert } }));

/** The plant row and packs the accessors compose over. */
let plantRow: PlantRecord;
let derivedBattery: PlantBattery | null;
let patches: PlantPatch[] = [];
let deviceRows: DeviceRecord[] = [];

mock.module("./plant-facts-instance", () => ({
  ...realInstance,
  plantFacts: {
    plant: async () => plantRow,
    battery: async () => derivedBattery,
    patch: async (patch: PlantPatch) => {
      patches.push(patch);
      plantRow = { ...plantRow, ...patch } as PlantRecord;
    },
    devices: async () => deviceRows,
    invalidate: () => {},
  },
}));

const { getWeatherConfig, setWeatherConfig } = await import("./weather-settings");
const { getPlant, setPlant } = await import("./plant-settings");
const { getSpotPriceConfig, setSpotPriceConfig } = await import("./spot-price-settings");

beforeEach(() => {
  storedRow = undefined;
  written = [];
  patches = [];
  derivedBattery = null;
  deviceRows = [
    {
      id: 1,
      slug: "inverter",
      name: "Inverter",
      profileId: "deye",
      role: "inverter",
      unitId: 1,
      connectionId: 1,
      arrays: [{ kwp: 9.8, tilt: 30, azimuth: 0 }],
      tempCoefficient: -0.35,
      systemLoss: 11,
      retiredAt: null,
    },
  ];
  plantRow = {
    id: 1,
    name: "Limburg-Weilburg",
    slug: "limburg-weilburg",
    timeZone: "Europe/Berlin",
    biddingZone: "DE-LU",
    tariffKey: null,
    latitude: 50.4,
    longitude: 8.06,
    label: "Limburg",
    arrays: [{ kwp: 9.8, tilt: 30, azimuth: 0 }],
    tempCoefficient: -0.35,
    systemLoss: 11,
    maxOutputW: 7000,
    houseLoadW: 350,
    smartMeterSince: "2026-03-01",
  };
});

describe("getWeatherConfig", () => {
  test("serves the plant's facts from the columns and the switches from the row", async () => {
    storedRow = { enabled: true, forecast: { enabled: true, provider: "forecast-solar" } };
    const config = await getWeatherConfig();
    expect(config.latitude).toBe(50.4);
    expect(config.label).toBe("Limburg");
    // The arrays come from the INVERTER rows, stamped with the inverter's slug
    // and physics — not from the plant columns, which are legacy.
    expect(config.forecast.arrays).toEqual([
      {
        kwp: 9.8,
        tilt: 30,
        azimuth: 0,
        deviceSlug: "inverter",
        tempCoefficient: -0.35,
        systemLoss: 11,
      },
    ]);
    expect(config.forecast.maxOutputW).toBe(7000);
    expect(config.forecast.smartMeterSince).toBe("2026-03-01");
    expect(config.enabled).toBe(true);
    expect(config.forecast.provider).toBe("forecast-solar");
  });

  test("the battery every consumer reads is the DERIVED one", async () => {
    // The consumer contract of the plant-battery derivation: the clipping model,
    // the reserve floor and the blocker list all read `forecast.battery`, so
    // sourcing it here is what makes them go through the capacity-weighted
    // arithmetic instead of around it.
    derivedBattery = { usableKwh: 35, maxChargeW: 11500, minSoc: 11.428571, nominalV: 48 };
    const config = await getWeatherConfig();
    expect(config.forecast.battery?.usableKwh).toBe(35);
    expect(config.forecast.battery?.minSoc).toBeCloseTo(11.4286, 4);
  });

  test("a stale 1.x plant half still sitting in the row is IGNORED", async () => {
    // Preferring the JSONB would make every column write invisible until the
    // legacy key happened to be absent — the worst of both storages.
    storedRow = { latitude: 1, label: "stale", forecast: { systemLoss: 89 } };
    const config = await getWeatherConfig();
    expect(config.latitude).toBe(50.4);
    expect(config.label).toBe("Limburg");
    expect(config.forecast.systemLoss).toBe(11);
  });
});

describe("setWeatherConfig", () => {
  test("a location save patches ONLY the location columns", async () => {
    await setWeatherConfig({ latitude: 1, longitude: 2, label: "Elsewhere" });
    expect(patches.length).toBe(1);
    expect(Object.keys(patches[0] ?? {}).sort()).toEqual(["label", "latitude", "longitude"]);
  });

  test("a plant save patches ONLY the plant columns — the two cannot clobber", async () => {
    await setWeatherConfig({ forecast: { maxOutputW: 6000, houseLoadW: 300 } });
    expect(Object.keys(patches[0] ?? {}).sort()).toEqual(["houseLoadW", "maxOutputW"]);
    expect(patches[0]).not.toHaveProperty("latitude");
  });

  test("the JSONB row keeps only the preference half after a save", async () => {
    // The stale duplicate is removed rather than left for a later reader to
    // choose between — safe because the columns were seeded from it at
    // provisioning, before anything could write it.
    await setWeatherConfig({ enabled: true, latitude: 1 });
    // Asserted as the SHAPE, not as fixed values: `cachedSetting` holds this row
    // in module state for the life of the process, so its values carry across
    // this file's tests — which is exactly the caching production relies on. The
    // claim under test is which FIELDS survive a save.
    const row = written[0] as { enabled: boolean; forecast: Record<string, unknown> };
    expect(Object.keys(row).sort()).toEqual(["enabled", "forecast"]);
    expect(Object.keys(row.forecast).sort()).toEqual(["correction", "enabled", "provider"]);
    expect(row.enabled).toBe(true);
  });

  test("a save that names no plant fact patches no column at all", async () => {
    await setWeatherConfig({ enabled: true });
    expect(patches).toEqual([]);
    expect(written.length).toBe(1);
  });

  test.each(["arrays", "tempCoefficient", "systemLoss", "battery"])(
    "a patch naming forecast.%s is REFUSED — it is the inverter's now — and nothing is written",
    async (key) => {
      await expect(setWeatherConfig({ forecast: { [key]: null } })).rejects.toThrow(
        new RegExp(`forecast\\.${key}.*Devices`),
      );
      expect(patches).toEqual([]);
      expect(written).toEqual([]);
    },
  );

  test("validation is unchanged — an impossible latitude is still refused", async () => {
    // The patch is merged onto the current record and parsed in full, exactly as
    // it was when the whole thing was one JSONB document.
    await expect(setWeatherConfig({ latitude: 400 })).rejects.toThrow();
    expect(patches).toEqual([]);
  });

  test("the saved record is read back composed, not echoed", async () => {
    const saved = await setWeatherConfig({ forecast: { maxOutputW: 6500 } });
    expect(saved.forecast.maxOutputW).toBe(6500);
    expect(saved.latitude).toBe(50.4);
  });
});

describe("the plant config", () => {
  test("reads the zone and the name off the plant row", async () => {
    expect(await getPlant()).toEqual({
      timeZone: "Europe/Berlin",
      name: "Limburg-Weilburg",
    });
  });

  test("saving a zone alone does not touch the name", async () => {
    // The Display form sends the zone alone; a required name there would either
    // fail the save or blank the plant's label.
    const saved = await setPlant({ timeZone: "UTC" });
    expect(patches).toEqual([{ timeZone: "UTC" }]);
    expect(saved.name).toBe("Limburg-Weilburg");
  });

  test("a rename is a name-only write and never names a slug", async () => {
    // `plants.slug` becomes the MQTT namespace and Home Assistant keys entities
    // on `unique_id`, so it is frozen at onboarding.
    await setPlant({ timeZone: "Europe/Berlin", name: "Haus Müller" });
    expect(patches[0]).toEqual({ timeZone: "Europe/Berlin", name: "Haus Müller" });
    expect(patches[0]).not.toHaveProperty("slug");
  });

  test("an invalid zone is refused and nothing is written", async () => {
    await expect(setPlant({ timeZone: "Not/AZone" })).rejects.toThrow();
    expect(patches).toEqual([]);
  });
});

describe("the spot price config", () => {
  test("the zone comes from the plant column, the rest from the row", async () => {
    storedRow = { enabled: true, provider: "entso-e" };
    expect(await getSpotPriceConfig()).toEqual({
      enabled: true,
      provider: "entso-e",
      zone: "DE-LU",
    });
  });

  test("a plant with no zone yet reads as the default market, not as empty", async () => {
    // `spotPricesReady` gates on a non-empty zone, so an empty string would
    // silently disable a feed the operator had enabled.
    plantRow = { ...plantRow, biddingZone: null };
    expect((await getSpotPriceConfig()).zone).toBe("DE-LU");
  });

  test("saving splits the feed's settings from the plant's market", async () => {
    await setSpotPriceConfig({ enabled: true, provider: "energy-charts", zone: "AT" });
    expect(written[0]).toEqual({ enabled: true, provider: "energy-charts" });
    expect(patches).toEqual([{ biddingZone: "AT" }]);
  });

  test("an empty zone is refused by the schema, so neither half is written", async () => {
    await expect(setSpotPriceConfig({ enabled: true, zone: "" })).rejects.toThrow();
    expect(written).toEqual([]);
    expect(patches).toEqual([]);
  });
});
