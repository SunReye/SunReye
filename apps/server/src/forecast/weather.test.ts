import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { type WeatherConfig, defaultWeather } from "@SunReye/db/weather";
import { fetchWeather } from "./weather";

const realFetch = globalThis.fetch;
let calls: string[] = [];
let now = 1_000_000;

/** Answer the next fetches in order; the last answer repeats. */
function answer(...responses: Array<Response | Error>) {
  let i = 0;
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    const next = responses[Math.min(i++, responses.length - 1)]!;
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
}

const body = (over: Record<string, unknown> = {}) =>
  Response.json({
    current: { temperature_2m: 18.4, weather_code: 61 },
    current_units: { temperature_2m: "°C" },
    daily: { shortwave_radiation_sum: [12.5] },
    ...over,
  });

/** Each test uses its own coordinates: the module caches one reading per location. */
const at = (latitude: number, longitude: number): WeatherConfig => ({
  ...defaultWeather,
  enabled: true,
  latitude,
  longitude,
  label: "Home",
});

beforeEach(() => {
  calls = [];
  spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  (Date.now as unknown as { mockRestore(): void }).mockRestore();
});

describe("fetchWeather", () => {
  test("disabled or coordinate-less config never calls upstream", async () => {
    answer(body());
    expect(await fetchWeather({ ...at(1, 1), enabled: false })).toBeNull();
    expect(await fetchWeather({ ...at(1, 1), latitude: null })).toBeNull();
    expect(await fetchWeather({ ...at(1, 1), longitude: null })).toBeNull();
    expect(calls).toEqual([]);
  });

  test("maps the Open-Meteo answer to a reading and queries the configured place", async () => {
    answer(body());
    const reading = await fetchWeather(at(48.1, 11.6));
    expect(reading).toEqual({
      temperature: 18.4,
      unit: "°C",
      code: 61,
      condition: "Rain",
      icon: "rain",
      solarRadiationSum: 12.5,
      label: "Home",
    });
    expect(calls[0]).toContain("latitude=48.1&longitude=11.6");
  });

  test("maps the WMO boundaries, and an unlisted code to Unknown", async () => {
    const icon = async (lat: number, code: number) => {
      answer(body({ current: { temperature_2m: 1, weather_code: code } }));
      return (await fetchWeather(at(lat, 2)))?.icon;
    };
    expect(await icon(10, 0)).toBe("clear");
    expect(await icon(11, 48)).toBe("fog");
    expect(await icon(12, 57)).toBe("drizzle");
    expect(await icon(13, 77)).toBe("snow");
    expect(await icon(14, 99)).toBe("thunder");
    answer(body({ current: { temperature_2m: 1, weather_code: 58 } }));
    expect(await fetchWeather(at(15, 2))).toMatchObject({
      condition: "Unknown",
      icon: "cloudy",
    });
  });

  test("a missing unit and an absent or null radiation sum fall back, not crash", async () => {
    answer(
      body({
        current_units: undefined,
        daily: { shortwave_radiation_sum: [null] },
      }),
    );
    expect(await fetchWeather(at(20, 3))).toMatchObject({
      unit: "°C",
      solarRadiationSum: null,
    });
    answer(body({ daily: undefined }));
    expect(await fetchWeather(at(21, 3))).toMatchObject({
      solarRadiationSum: null,
    });
    answer(body({ daily: { shortwave_radiation_sum: [] } }));
    expect(await fetchWeather(at(22, 3))).toMatchObject({
      solarRadiationSum: null,
    });
  });

  test("zero degrees is a reading, not a missing field", async () => {
    answer(body({ current: { temperature_2m: 0, weather_code: 0 } }));
    expect(await fetchWeather(at(30, 4))).toMatchObject({
      temperature: 0,
      code: 0,
    });
  });

  test("an answer without the current block is null when nothing is cached", async () => {
    answer(body({ current: undefined }));
    expect(await fetchWeather(at(40, 5))).toBeNull();
    answer(body({ current: { temperature_2m: 1 } }));
    expect(await fetchWeather(at(41, 5))).toBeNull();
  });

  test("a non-2xx answer and a network error are both null", async () => {
    answer(new Response("down", { status: 503 }));
    expect(await fetchWeather(at(50, 6))).toBeNull();
    answer(new Error("offline"));
    expect(await fetchWeather(at(51, 6))).toBeNull();
  });

  test("a fresh reading is reused inside the TTL and refetched after it", async () => {
    answer(body());
    const config = at(60, 7);
    await fetchWeather(config);
    now += 14 * 60_000;
    await fetchWeather(config);
    expect(calls).toHaveLength(1);
    now += 60_000;
    await fetchWeather(config);
    expect(calls).toHaveLength(2);
  });

  test("a failed refresh serves the stale reading for the same place only", async () => {
    const config = at(70, 8);
    answer(body(), new Error("offline"));
    const first = await fetchWeather(config);
    now += 16 * 60_000;
    expect(await fetchWeather(config)).toEqual(first!);
    answer(new Error("offline"));
    expect(await fetchWeather(at(71, 8))).toBeNull();
  });
});
