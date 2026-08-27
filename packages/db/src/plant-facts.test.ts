import { describe, expect, test } from "bun:test";

import { type DeviceBattery, derivePlantBattery } from "./batteries";
import {
  type PlantFactColumns,
  columnsFromPlantRow,
  composeWeatherConfig,
  plantBatteryFrom,
  legacyColumnsFromWeatherRow,
  splitWeatherWrite,
  spotPricePrefsSchema,
  weatherPrefsSchema,
} from "./plant-facts";
import { defaultWeather, weatherConfigSchema, type WeatherConfig } from "./weather";

/** The columns of a plant that has been fully described. */
function columns(overrides: Partial<PlantFactColumns> = {}): PlantFactColumns {
  return {
    latitude: 50.4,
    longitude: 8.06,
    label: "Limburg-Weilburg",
    arrays: [{ kwp: 9.8, tilt: 30, azimuth: 0 }],
    tempCoefficient: -0.35,
    systemLoss: 12,
    maxOutputW: 7000,
    houseLoadW: 400,
    smartMeterSince: "2026-03-01",
    ...overrides,
  };
}

/** The derivation under test as the composer will call it. */
const derived = (packs: DeviceBattery[]) => derivePlantBattery(packs);

const pack = (o: Partial<DeviceBattery> = {}): DeviceBattery => ({
  usableKwh: 10,
  maxChargeW: 5000,
  minSoc: 10,
  nominalV: 51.2,
  ...o,
});

describe("composeWeatherConfig", () => {
  test("plant facts come from the COLUMNS, not from the app_settings record", () => {
    // The stored record still carries 1.x values in its plant half. Once the
    // columns own the data those values must be ignored entirely — a fallback
    // that preferred the JSONB would make every column write invisible.
    const stale = weatherConfigSchema.parse({
      enabled: true,
      latitude: 1,
      longitude: 2,
      label: "stale",
      forecast: { enabled: true, arrays: [{ kwp: 1, tilt: 1, azimuth: 1 }], systemLoss: 89 },
    });
    const composed = composeWeatherConfig(stale, columns(), null);
    expect(composed.latitude).toBe(50.4);
    expect(composed.longitude).toBe(8.06);
    expect(composed.label).toBe("Limburg-Weilburg");
    expect(composed.forecast.arrays).toEqual([{ kwp: 9.8, tilt: 30, azimuth: 0 }]);
    expect(composed.forecast.systemLoss).toBe(12);
    expect(composed.forecast.tempCoefficient).toBe(-0.35);
    expect(composed.forecast.maxOutputW).toBe(7000);
    expect(composed.forecast.houseLoadW).toBe(400);
    expect(composed.forecast.smartMeterSince).toBe("2026-03-01");
  });

  test("the switches and the provider stay owned by the app_settings record", () => {
    const stored = weatherConfigSchema.parse({
      enabled: true,
      forecast: { enabled: true, provider: "forecast-solar", correction: { enabled: true } },
    });
    const composed = composeWeatherConfig(stored, columns(), null);
    expect(composed.enabled).toBe(true);
    expect(composed.forecast.enabled).toBe(true);
    expect(composed.forecast.provider).toBe("forecast-solar");
    expect(composed.forecast.correction.enabled).toBe(true);
  });

  test("the battery is the DERIVED plant battery — capacity-weighted across packs", () => {
    // The consumer contract of part C: every reader of `forecast.battery` gets
    // the derivation, so a second pack cannot be averaged in by accident.
    const composed = composeWeatherConfig(
      defaultWeather,
      columns(),
      derived([pack({ usableKwh: 30, minSoc: 5 }), pack({ usableKwh: 5, minSoc: 50 })]),
    );
    expect(composed.forecast.battery?.usableKwh).toBe(35);
    expect(composed.forecast.battery?.minSoc).toBeCloseTo(11.4286, 4);
  });

  test("no pack rows means no battery — not a battery of zero", () => {
    expect(composeWeatherConfig(defaultWeather, columns(), null).forecast.battery).toBeNull();
  });

  test("the composed record still satisfies the weather schema", () => {
    // Every consumer is typed on WeatherConfig; a composition that could not be
    // re-validated would be a shape the readers never see in production.
    const composed = composeWeatherConfig(defaultWeather, columns(), derived([pack()]));
    expect(() => weatherConfigSchema.parse(composed)).not.toThrow();
  });
});

describe("splitWeatherWrite", () => {
  const validated = (patch: Record<string, unknown>): WeatherConfig =>
    weatherConfigSchema.parse({ ...defaultWeather, ...patch });

  test("writes ONLY the columns the patch named — that is the clobber fix", () => {
    // The weather form saves a location. `systemLoss` is not in the patch, so
    // no UPDATE may name it: whatever the plant form wrote stays.
    const patch = { latitude: 50.4, longitude: 8.06, label: "Limburg" };
    const split = splitWeatherWrite(patch, validated(patch));
    expect(Object.keys(split.columns).sort()).toEqual(["label", "latitude", "longitude"]);
    expect(split.columns.latitude).toBe(50.4);
  });

  test("a nested forecast patch routes the plant half to columns", () => {
    const patch = {
      forecast: { arrays: [{ kwp: 5, tilt: 20, azimuth: -90 }], maxOutputW: 7000 },
    };
    const split = splitWeatherWrite(patch, validated(patch));
    expect(Object.keys(split.columns).sort()).toEqual(["arrays", "maxOutputW"]);
    expect(split.columns.arrays).toEqual([{ kwp: 5, tilt: 20, azimuth: -90 }]);
    expect(split.columns.maxOutputW).toBe(7000);
  });

  test("null is a VALUE and clears its column; absent leaves it alone", () => {
    // The smart-meter date is exactly this distinction: unsetting it must be
    // expressible, so `null` has to survive the split as a named column.
    const patch = { forecast: { smartMeterSince: null } };
    const split = splitWeatherWrite(patch, validated(patch));
    expect("smartMeterSince" in split.columns).toBe(true);
    expect(split.columns.smartMeterSince).toBeNull();
    expect("houseLoadW" in split.columns).toBe(false);
  });

  test("undefined is absent, not a value", () => {
    const patch = { latitude: undefined, longitude: 8 };
    const split = splitWeatherWrite(patch, validated({ longitude: 8 }));
    expect("latitude" in split.columns).toBe(false);
    expect(split.columns.longitude).toBe(8);
  });

  test("the battery is reported only when the patch named it", () => {
    const untouched = splitWeatherWrite({ latitude: 1 }, validated({ latitude: 1 }));
    expect(untouched.battery).toBeNull();

    const patch = { forecast: { battery: { usableKwh: 12, minSoc: 8 } } };
    const named = splitWeatherWrite(patch, validated(patch));
    expect(named.battery?.value).toEqual({
      usableKwh: 12,
      maxChargeW: null,
      minSoc: 8,
      nominalV: null,
    });
  });

  test("clearing the battery is a named write of null, not an absence", () => {
    // "The plant has no storage" and "this form did not mention storage" are
    // different instructions; collapsing them would make a pack unremovable.
    const patch = { forecast: { battery: null } };
    const split = splitWeatherWrite(patch, validated(patch));
    expect(split.battery).toEqual({ value: null });
  });

  test("the settings half carries the switches and never a plant fact", () => {
    const patch = { enabled: true, latitude: 1, forecast: { provider: "x", systemLoss: 3 } };
    const split = splitWeatherWrite(patch, validated(patch));
    expect(split.settings.enabled).toBe(true);
    expect(split.settings.forecast.provider).toBe("x");
    expect(split.settings).not.toHaveProperty("latitude");
    expect(split.settings.forecast).not.toHaveProperty("systemLoss");
    expect(split.settings.forecast).not.toHaveProperty("battery");
  });

  test("an empty patch writes nothing at all", () => {
    const split = splitWeatherWrite({}, defaultWeather);
    expect(split.columns).toEqual({});
    expect(split.battery).toBeNull();
  });
});

describe("legacyColumnsFromWeatherRow", () => {
  test("mines a raw 1.x weather blob field by field", () => {
    // NOT through readSetting: it safeParses to the DEFAULT with no log, so a
    // blob that no longer validates would be reported as "nothing was ever set"
    // and the install would silently lose the settings this seeding exists for.
    const legacy = legacyColumnsFromWeatherRow({
      enabled: true,
      latitude: 50.4,
      longitude: 8.06,
      label: "Limburg",
      forecast: {
        arrays: [{ kwp: 9.8, tilt: 30, azimuth: 0 }],
        tempCoefficient: -0.33,
        systemLoss: 11,
        maxOutputW: 7000,
        houseLoadW: 350,
        smartMeterSince: "2026-03-01",
      },
    });
    expect(legacy).toEqual({
      latitude: 50.4,
      longitude: 8.06,
      label: "Limburg",
      arrays: [{ kwp: 9.8, tilt: 30, azimuth: 0 }],
      tempCoefficient: -0.33,
      systemLoss: 11,
      maxOutputW: 7000,
      houseLoadW: 350,
      smartMeterSince: "2026-03-01",
    });
  });

  test("survives a blob the current schema would REJECT, keeping the good fields", () => {
    // A tilt of 400 fails weatherConfigSchema, so readSetting would discard the
    // whole record — coordinates and all. Field-by-field mining keeps what is
    // usable and drops only what is not.
    const legacy = legacyColumnsFromWeatherRow({
      latitude: 50.4,
      forecast: { arrays: [{ kwp: 9.8, tilt: 400, azimuth: 0 }], systemLoss: "twelve" },
    });
    expect(legacy.latitude).toBe(50.4);
    expect("arrays" in legacy).toBe(false);
    expect("systemLoss" in legacy).toBe(false);
  });

  test("an absent row yields nothing to seed, not a set of defaults", () => {
    // Seeding a default would be indistinguishable from the operator having
    // typed it, and the plant columns already carry their own defaults.
    expect(legacyColumnsFromWeatherRow(undefined)).toEqual({});
    expect(legacyColumnsFromWeatherRow(null)).toEqual({});
    expect(legacyColumnsFromWeatherRow("not an object")).toEqual({});
  });

  test("a legacy battery is mined too, so the pack row can be seeded from it", () => {
    const legacy = legacyColumnsFromWeatherRow({
      forecast: { battery: { usableKwh: 30, maxChargeW: 9000, minSoc: 5, nominalV: 48 } },
    });
    expect(legacy.battery).toEqual({
      usableKwh: 30,
      maxChargeW: 9000,
      minSoc: 5,
      nominalV: 48,
    });
  });

  test("a battery with no usable capacity is not a pack", () => {
    // `usableKwh` is what makes the block exist at all (see the plant form);
    // a reserve with no capacity describes nothing.
    expect(
      legacyColumnsFromWeatherRow({ forecast: { battery: { minSoc: 5 } } }).battery,
    ).toBeUndefined();
  });
});

describe("weatherPrefsSchema", () => {
  test("keeps the switches of a 1.x row and DROPS its stale plant half", () => {
    // The stale copy has to go: two versions of the plant's coordinates in two
    // places is exactly the ambiguity the columns exist to remove. Safe only
    // because provisioning has already seeded the columns from this same row.
    const prefs = weatherPrefsSchema.parse({
      enabled: true,
      latitude: 50.4,
      longitude: 8.06,
      label: "Limburg",
      forecast: {
        enabled: true,
        provider: "forecast-solar",
        correction: { enabled: true },
        arrays: [{ kwp: 9.8, tilt: 30, azimuth: 0 }],
        systemLoss: 11,
        battery: { usableKwh: 30 },
      },
    });
    expect(prefs).toEqual({
      enabled: true,
      forecast: { enabled: true, provider: "forecast-solar", correction: { enabled: true } },
    });
  });

  test("an absent row parses to the off defaults rather than failing", () => {
    // `readSetting` hands the schema whatever is stored, including nothing.
    expect(weatherPrefsSchema.parse({})).toEqual({
      enabled: false,
      forecast: { enabled: false, provider: "open-meteo", correction: { enabled: false } },
    });
  });
});

describe("spotPricePrefsSchema", () => {
  test("keeps the feed's own settings and drops the bidding zone", () => {
    // The zone is a fact about where the PLANT settles, so it is a plant column.
    const prefs = spotPricePrefsSchema.parse({
      enabled: true,
      provider: "entso-e",
      zone: "DE-LU",
    });
    expect(prefs).toEqual({ enabled: true, provider: "entso-e" });
  });
});

describe("columnsFromPlantRow", () => {
  test("passes the plant's own columns through unchanged", () => {
    const row = {
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
    expect(columnsFromPlantRow(row)).toEqual(row);
  });

  test("a JSONB arrays column holding anything else reads as no arrays", () => {
    // The column is JSONB, so a row written by hand — a restore, an import — can
    // hold a string, an object, or an array of malformed entries, and every
    // reader indexes into these.
    const base = {
      latitude: null,
      longitude: null,
      label: "",
      tempCoefficient: -0.4,
      systemLoss: 14,
      maxOutputW: null,
      houseLoadW: null,
      smartMeterSince: null,
    };
    expect(columnsFromPlantRow({ ...base, arrays: "nope" }).arrays).toEqual([]);
    expect(
      columnsFromPlantRow({ ...base, arrays: [{ kwp: 0, tilt: 0, azimuth: 0 }] }).arrays,
    ).toEqual([]);
    expect(columnsFromPlantRow({ ...base, arrays: [42] }).arrays).toEqual([]);
    expect(
      columnsFromPlantRow({ ...base, arrays: [{ kwp: 1, tilt: 1, azimuth: 999 }] }).arrays,
    ).toEqual([]);
  });
});

describe("plantBatteryFrom", () => {
  test("is the capacity-weighted derivation, not a second copy of the arithmetic", () => {
    // One entry point for the derivation is the point: with a single pack every
    // rule is the identity function, so a duplicated implementation would look
    // correct until a second device arrived.
    expect(plantBatteryFrom([])).toBeNull();
    const derived = plantBatteryFrom([
      { usableKwh: 30, maxChargeW: 9000, minSoc: 5, nominalV: 48 },
      { usableKwh: 5, maxChargeW: 2500, minSoc: 50, nominalV: null },
    ]);
    expect(derived?.usableKwh).toBe(35);
    expect(derived?.minSoc).toBeCloseTo(11.4286, 4);
    expect(derived?.nominalV).toBe(48);
  });
});
