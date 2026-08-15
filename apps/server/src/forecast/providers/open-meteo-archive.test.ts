/**
 * The reanalysis archive provider: the near-truth weather the learned correction
 * measures the model against. Nothing here is mocked at module level — the
 * provider's only outside edge is `fetch`, so the suite swaps `globalThis.fetch`
 * (the pattern solar-forecast.test.ts uses for the live provider) and drives the
 * real request-building and assembly code through it. That keeps the assertions
 * on what actually reaches Open-Meteo: which days are asked for, which plane
 * carries the shared variables, and what a short or absent series does.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PlaneOfArray } from "../solar-forecast";
import { fetchHistoricalIrradiance } from "./open-meteo-archive";

const BERLIN = { latitude: 52.52, longitude: 13.405 };
const SOUTH: PlaneOfArray = { tilt: 30, azimuth: 0 };
const EAST: PlaneOfArray = { tilt: 30, azimuth: -90 };

/** Three settled hours, the shape the archive answers a one-day range with. */
const HOURS = ["2026-07-01T10:00", "2026-07-01T11:00", "2026-07-01T12:00"];

/** A full hourly payload for the first (extras-carrying) plane. */
const firstPlane = (over: object = {}) => ({
  utc_offset_seconds: 7200,
  hourly: {
    time: [...HOURS],
    temperature_2m: [18, 20, 22],
    global_tilted_irradiance_instant: [300, 600, 900],
    direct_normal_irradiance_instant: [500, 700, 800],
    wind_speed_10m: [1, 2, 3],
    ...over,
  },
});

/** A follow-up plane's payload: GTI only, no plane-independent extras. */
const laterPlane = (gti: (number | null)[] = [100, 200, 300]) => ({
  utc_offset_seconds: 7200,
  hourly: { time: [...HOURS], global_tilted_irradiance_instant: gti },
});

const nativeFetch = globalThis.fetch;
const nativeTimeout = AbortSignal.timeout;

/** Every URL the provider requested, in call order. */
let urls: string[] = [];
/** Every timeout (ms) handed to `AbortSignal.timeout`, in call order. */
let timeouts: number[] = [];
/** Answers per call index; the last entry repeats for any further call. */
let bodies: (() => unknown)[] = [];
let statuses: number[] = [];
let networkError: Error | null = null;

const at = <T>(list: T[], i: number): T | undefined => list[Math.min(i, list.length - 1)];

beforeEach(() => {
  urls = [];
  timeouts = [];
  bodies = [firstPlane];
  statuses = [200];
  networkError = null;
  AbortSignal.timeout = ((ms: number) => {
    timeouts.push(ms);
    return nativeTimeout.call(AbortSignal, ms);
  }) as typeof AbortSignal.timeout;
  globalThis.fetch = (async (input: unknown) => {
    const i = urls.length;
    urls.push(String(input));
    if (networkError) throw networkError;
    const status = at(statuses, i) ?? 200;
    if (status !== 200) return { ok: false, status } as Response;
    return { ok: true, json: async () => at(bodies, i)?.() } as unknown as Response;
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = nativeFetch;
  AbortSignal.timeout = nativeTimeout;
});

/** The query parameters of one recorded request. */
const params = (i = 0): URLSearchParams => new URL(urls[i] ?? "").searchParams;

describe("fetchHistoricalIrradiance request", () => {
  test("asks the archive endpoint for the inclusive day range it was given", async () => {
    await fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-06-18", "2026-07-01");

    expect(urls).toHaveLength(1);
    expect(urls[0]?.startsWith("https://archive-api.open-meteo.com/v1/archive?")).toBe(true);
    const q = params();
    expect(q.get("start_date")).toBe("2026-06-18");
    expect(q.get("end_date")).toBe("2026-07-01");
    expect(q.get("latitude")).toBe("52.52");
    expect(q.get("longitude")).toBe("13.405");
    expect(q.get("tilt")).toBe("30");
    expect(q.get("azimuth")).toBe("0");
    expect(q.get("wind_speed_unit")).toBe("ms");
    expect(q.get("timezone")).toBe("auto");
  });

  test("reads the past at hourly resolution, never the live 15-minute forecast window", async () => {
    await fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-06-18", "2026-06-18");

    const q = params();
    expect(q.get("hourly")?.split(",")).toEqual([
      "global_tilted_irradiance_instant",
      "direct_normal_irradiance_instant",
      "temperature_2m",
      "wind_speed_10m",
    ]);
    expect(q.has("minutely_15")).toBe(false);
    expect(q.has("forecast_days")).toBe(false);
  });

  test("a single day is a range whose ends are the same date", async () => {
    await fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-07-01", "2026-07-01");

    // Asserted against the literal on both ends: comparing the two params to
    // each other would also hold if the provider dropped both.
    expect(params().get("start_date")).toBe("2026-07-01");
    expect(params().get("end_date")).toBe("2026-07-01");
  });

  test("a southern-hemisphere plant keeps its negative latitude and west azimuth", async () => {
    await fetchHistoricalIrradiance(
      { latitude: -33.87, longitude: 151.21 },
      [{ tilt: 22.5, azimuth: -90 }],
      "2026-07-01",
      "2026-07-01",
    );

    const q = params();
    expect(q.get("latitude")).toBe("-33.87");
    expect(q.get("azimuth")).toBe("-90");
    expect(q.get("tilt")).toBe("22.5");
  });

  test("a multi-week range gets a longer deadline than the live two-day request", async () => {
    await fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-06-01", "2026-07-01");

    expect(timeouts).toEqual([15_000]);
  });

  test("requests one range per distinct orientation, extras only on the first", async () => {
    bodies = [firstPlane, laterPlane];

    await fetchHistoricalIrradiance(
      BERLIN,
      [SOUTH, EAST, { ...SOUTH }],
      "2026-07-01",
      "2026-07-01",
    );

    expect(urls).toHaveLength(2);
    expect(params(0).get("azimuth")).toBe("0");
    expect(params(1).get("azimuth")).toBe("-90");
    expect(params(0).get("hourly")).toContain("temperature_2m");
    expect(params(1).get("hourly")).toBe("global_tilted_irradiance_instant");
    // Both requests cover the same window — the correction pairs them hour by hour.
    expect(params(1).get("start_date")).toBe("2026-07-01");
    expect(params(1).get("end_date")).toBe("2026-07-01");
  });
});

describe("fetchHistoricalIrradiance assembly", () => {
  test("returns the reanalysis hours in the forecast shape the PV model consumes", async () => {
    const f = await fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-07-01", "2026-07-01");

    expect(f.times).toEqual(HOURS);
    expect(f.location).toEqual(BERLIN);
    expect(f.utcOffsetSeconds).toBe(7200);
    expect(f.temperature).toEqual([18, 20, 22]);
    expect(f.gti).toEqual([[300, 600, 900]]);
    expect(f.dni).toEqual([500, 700, 800]);
    expect(f.windSpeed).toEqual([1, 2, 3]);
  });

  test("gives every array its own plane's irradiance, twins sharing one series", async () => {
    bodies = [firstPlane, laterPlane];

    const f = await fetchHistoricalIrradiance(
      BERLIN,
      [SOUTH, EAST, { ...SOUTH }],
      "2026-07-01",
      "2026-07-01",
    );

    expect(f.gti).toEqual([
      [300, 600, 900],
      [100, 200, 300],
      [300, 600, 900],
    ]);
  });

  test("a winter night is read as its real values, not as missing data", async () => {
    bodies = [
      () =>
        firstPlane({
          temperature_2m: [-7.5, 0, 2],
          global_tilted_irradiance_instant: [0, 0, 0],
          direct_normal_irradiance_instant: [0, 0, 0],
          wind_speed_10m: [0, 0, 0],
        }),
    ];

    const f = await fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-01-05", "2026-01-05");

    expect(f.temperature).toEqual([-7.5, 0, 2]);
    expect(f.gti).toEqual([[0, 0, 0]]);
    expect(f.dni).toEqual([0, 0, 0]);
    expect(f.windSpeed).toEqual([0, 0, 0]);
  });

  test("a gap in a reanalysis series reads as zero, not as a hole", async () => {
    bodies = [
      () =>
        firstPlane({
          temperature_2m: [18, null, 22],
          global_tilted_irradiance_instant: [300, null, 900],
          direct_normal_irradiance_instant: [null, 700, 800],
          wind_speed_10m: [1, 2, null],
        }),
    ];

    const f = await fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-07-01", "2026-07-01");

    expect(f.temperature).toEqual([18, 0, 22]);
    expect(f.gti).toEqual([[300, 0, 900]]);
    expect(f.dni).toEqual([0, 700, 800]);
    expect(f.windSpeed).toEqual([1, 2, 0]);
  });

  test("an archive answer without a UTC offset is read as UTC, not as a shifted day", async () => {
    bodies = [() => ({ hourly: firstPlane().hourly })];

    const f = await fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-07-01", "2026-07-01");

    expect(f.utcOffsetSeconds).toBe(0);
  });

  test("keeps a west-of-UTC plant's negative offset", async () => {
    bodies = [() => ({ ...firstPlane(), utc_offset_seconds: -25_200 })];

    const f = await fetchHistoricalIrradiance(
      { latitude: 37.77, longitude: -122.42 },
      [SOUTH],
      "2026-07-01",
      "2026-07-01",
    );

    expect(f.utcOffsetSeconds).toBe(-25_200);
  });

  test("takes the offset from the first plane's answer, which carries the shared fields", async () => {
    bodies = [firstPlane, () => ({ ...laterPlane(), utc_offset_seconds: 0 })];

    const f = await fetchHistoricalIrradiance(BERLIN, [SOUTH, EAST], "2026-07-01", "2026-07-01");

    expect(f.utcOffsetSeconds).toBe(7200);
  });
});

describe("fetchHistoricalIrradiance failures", () => {
  test("a rejected archive request fails loudly with its status", async () => {
    statuses = [503];

    await expect(
      fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-07-01", "2026-07-01"),
    ).rejects.toThrow("HTTP 503");
  });

  test("a range the archive has not settled yet fails rather than yielding empty days", async () => {
    statuses = [400];

    await expect(
      fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-07-01", "2026-07-01"),
    ).rejects.toThrow("HTTP 400");
  });

  test("a network failure propagates so the caller can retry the same window", async () => {
    networkError = new Error("The operation timed out.");

    await expect(
      fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-06-01", "2026-07-01"),
    ).rejects.toThrow("The operation timed out.");
  });

  test("one failed plane fails the whole window — a half-covered day is never assembled", async () => {
    bodies = [firstPlane, laterPlane];
    statuses = [200, 500];

    await expect(
      fetchHistoricalIrradiance(BERLIN, [SOUTH, EAST], "2026-07-01", "2026-07-01"),
    ).rejects.toThrow("HTTP 500");
  });

  test("an answer without the hourly container is rejected", async () => {
    bodies = [() => ({ utc_offset_seconds: 7200 })];

    await expect(
      fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-07-01", "2026-07-01"),
    ).rejects.toThrow("missing series fields");
  });

  test("an hourly container without timestamps or temperatures is rejected", async () => {
    bodies = [() => ({ utc_offset_seconds: 7200, hourly: {} })];
    await expect(
      fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-07-01", "2026-07-01"),
    ).rejects.toThrow("missing series fields");

    bodies = [() => ({ hourly: { time: HOURS, global_tilted_irradiance_instant: [1, 2, 3] } })];
    await expect(
      fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-07-01", "2026-07-01"),
    ).rejects.toThrow("missing series fields");
  });

  test("an irradiance series shorter than the hours it claims to cover is rejected", async () => {
    bodies = [() => firstPlane({ global_tilted_irradiance_instant: [300, 600] })];

    await expect(
      fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-07-01", "2026-07-01"),
    ).rejects.toThrow("missing irradiance series");
  });

  test("a second plane that came back without irradiance is rejected", async () => {
    bodies = [firstPlane, () => ({ utc_offset_seconds: 7200, hourly: { time: HOURS } })];

    await expect(
      fetchHistoricalIrradiance(BERLIN, [SOUTH, EAST], "2026-07-01", "2026-07-01"),
    ).rejects.toThrow("missing irradiance series");
  });

  test("extras that do not line up with the hours are dropped, leaving the model its fallbacks", async () => {
    bodies = [
      () =>
        firstPlane({
          direct_normal_irradiance_instant: [500, 700],
          wind_speed_10m: [],
        }),
    ];

    const f = await fetchHistoricalIrradiance(BERLIN, [SOUTH], "2026-07-01", "2026-07-01");

    expect(f.dni).toBeUndefined();
    expect(f.windSpeed).toBeUndefined();
    expect(f.gti).toEqual([[300, 600, 900]]);
  });

  test("a plant with no arrays is rejected without calling the archive", async () => {
    await expect(fetchHistoricalIrradiance(BERLIN, [], "2026-07-01", "2026-07-01")).rejects.toThrow(
      "missing series fields",
    );
    expect(urls).toEqual([]);
  });
});
