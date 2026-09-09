import { describe, expect, test } from "bun:test";

import { defaultWeather, forecastReady, weatherConfigSchema, weatherReady } from "./weather";

describe("weather config", () => {
  test("defaults to disabled with no location", () => {
    expect(defaultWeather.enabled).toBe(false);
    expect(defaultWeather.latitude).toBeNull();
    expect(defaultWeather.longitude).toBeNull();
  });

  test("rejects out-of-range coordinates", () => {
    expect(weatherConfigSchema.safeParse({ latitude: 91, longitude: 0 }).success).toBe(false);
    expect(weatherConfigSchema.safeParse({ latitude: 0, longitude: 181 }).success).toBe(false);
  });

  test("weatherReady requires enabled + both coordinates", () => {
    const base = defaultWeather;
    expect(weatherReady(base)).toBe(false);
    expect(weatherReady({ ...base, enabled: true, latitude: 50, longitude: null })).toBe(false);
    expect(weatherReady({ ...base, enabled: false, latitude: 50, longitude: 8 })).toBe(false);
    expect(weatherReady({ ...base, enabled: true, latitude: 50, longitude: 8 })).toBe(true);
  });

  test("legacy configs without forecast parse with sane defaults", () => {
    const parsed = weatherConfigSchema.parse({ enabled: true, latitude: 50, longitude: 8 });
    expect(parsed.forecast.enabled).toBe(false);
    expect(parsed.forecast.provider).toBe("open-meteo");
    expect(parsed.forecast.arrays).toEqual([]);
    expect(parsed.forecast.tempCoefficient).toBe(-0.4);
    expect(parsed.forecast.systemLoss).toBe(14);
  });

  test("rejects out-of-range array parameters", () => {
    const arrays = (over: object) => ({
      enabled: true,
      latitude: 50,
      longitude: 8,
      forecast: { enabled: true, arrays: [{ kwp: 10, tilt: 30, azimuth: 0, ...over }] },
    });
    expect(weatherConfigSchema.safeParse(arrays({})).success).toBe(true);
    expect(weatherConfigSchema.safeParse(arrays({ kwp: -1 })).success).toBe(false);
    expect(weatherConfigSchema.safeParse(arrays({ tilt: 91 })).success).toBe(false);
    expect(weatherConfigSchema.safeParse(arrays({ azimuth: 181 })).success).toBe(false);
  });

  test("forecastReady needs weather + enabled forecast + at least one array", () => {
    const on = weatherConfigSchema.parse({
      enabled: true,
      latitude: 50,
      longitude: 8,
      forecast: { enabled: true, arrays: [{ kwp: 10, tilt: 30, azimuth: 0 }] },
    });
    expect(forecastReady(on)).toBe(true);
    expect(forecastReady({ ...on, forecast: { ...on.forecast, arrays: [] } })).toBe(false);
    expect(forecastReady({ ...on, forecast: { ...on.forecast, enabled: false } })).toBe(false);
    expect(forecastReady({ ...on, enabled: false })).toBe(false);
  });
});

/**
 * Per-array physics. `tempCoefficient` is a MODULE datasheet number and
 * `systemLoss` is per-string (soiling, shading, mismatch, DC wiring) — two
 * strings of different panels, or a shaded east one beside a clean south one,
 * genuinely differ. The plant columns stay the DEFAULT, so an operator with one
 * uniform array never has to touch these.
 */
describe("per-array overrides", () => {
  const withArray = (over: object) =>
    weatherConfigSchema.safeParse({
      enabled: true,
      latitude: 50,
      longitude: 8,
      forecast: { enabled: true, arrays: [{ kwp: 10, tilt: 30, azimuth: 0, ...over }] },
    });

  test("a stored 3-field array still round-trips UNCHANGED", () => {
    const parsed = weatherConfigSchema.parse({
      enabled: true,
      latitude: 50,
      longitude: 8,
      forecast: { enabled: true, arrays: [{ kwp: 9.8, tilt: 30, azimuth: -15 }] },
    });
    // The key list, not just the values: the point is that nothing was ADDED. A
    // defaulted override would be the plant-wide fudge factor wearing a
    // per-array name, and it would make "the operator stated this" unreadable.
    expect(parsed.forecast.arrays).toEqual([{ kwp: 9.8, tilt: 30, azimuth: -15 }]);
    expect(Object.keys(parsed.forecast.arrays[0] ?? {}).sort()).toEqual(["azimuth", "kwp", "tilt"]);
  });

  test("accepts a device slug and both physics overrides", () => {
    const parsed = withArray({
      deviceSlug: "deye-sun-12k",
      tempCoefficient: -0.29,
      systemLoss: 22,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.forecast.arrays[0]).toEqual({
      kwp: 10,
      tilt: 30,
      azimuth: 0,
      deviceSlug: "deye-sun-12k",
      tempCoefficient: -0.29,
      systemLoss: 22,
    });
  });

  test("holds the overrides to the same bounds as the plant columns", () => {
    expect(withArray({ tempCoefficient: 0.1 }).success).toBe(false);
    expect(withArray({ tempCoefficient: -2.1 }).success).toBe(false);
    expect(withArray({ systemLoss: -1 }).success).toBe(false);
    expect(withArray({ systemLoss: 91 }).success).toBe(false);
    // The boundaries themselves are legal: 0 %/°C is a (fictional) perfectly
    // temperature-stable panel, 0 % is a lossless string. Neither is a typo, and
    // both must stay distinguishable from "not stated".
    expect(withArray({ tempCoefficient: 0, systemLoss: 0 }).success).toBe(true);
    expect(withArray({ tempCoefficient: -2, systemLoss: 90 }).success).toBe(true);
  });

  test("refuses an empty device slug", () => {
    // `""` is not "no device", it is a slug that matches nothing — and it would
    // sail through every `?? plantDefault` in the model as a stated value.
    expect(withArray({ deviceSlug: "" }).success).toBe(false);
  });
});

/**
 * Nominal pack voltage, which the peak-shaving engine converts watts into
 * charge-current amps with. It moved here from the automations config because it
 * describes the battery, not the automation — and every commanded current is
 * scaled by it, so a wrong value is not cosmetic.
 */
describe("the plant battery's nominal voltage", () => {
  const battery = (over: Record<string, unknown> = {}) =>
    weatherConfigSchema.parse({
      forecast: { battery: { usableKwh: 15, ...over } },
    }).forecast.battery;

  test("is null when never stated, not 51.2", () => {
    // The difference is load-bearing: null means "fall back to whatever this
    // install already had on the automations page", while a default would
    // silently overwrite a 48 V pack's setting with a 51.2 V one.
    expect(battery()?.nominalV).toBeNull();
  });

  test("keeps a stated voltage", () => {
    expect(battery({ nominalV: 48 })?.nominalV).toBe(48);
    expect(battery({ nominalV: 51.2 })?.nominalV).toBe(51.2);
  });

  test("refuses a voltage that cannot be one", () => {
    // Zero and negatives divide the wrong way or by zero; the ceiling is a typo
    // guard for someone entering millivolts.
    for (const bad of [0, -48, 5000]) {
      expect(() =>
        weatherConfigSchema.parse({ forecast: { battery: { usableKwh: 15, nominalV: bad } } }),
      ).toThrow();
    }
  });

  test("exists only where a battery does", () => {
    expect(weatherConfigSchema.parse({ forecast: {} }).forecast.battery).toBeNull();
  });
});
