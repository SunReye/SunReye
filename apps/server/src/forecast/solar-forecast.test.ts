import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import {
  type WeatherConfig,
  solarForecastConfigSchema,
  weatherConfigSchema,
} from "@SunReye/db/weather";
import {
  type CanonicalRole,
  type InverterProfile,
  type InverterSample,
  type ProfileData,
  hydrateProfile,
} from "@SunReye/inverter-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import { type CorrectionModel, correctionFactor } from "./forecast-correction";
import { pvPowerW } from "./pv-model";
import { openMeteoIrradiance } from "./providers/open-meteo";
import {
  type IrradianceForecast,
  type SolarForecast,
  type SolarForecastPoint,
  buildSolarForecast,
  fetchSolarForecast,
  forecastProviderCatalog,
  representativeHouseLoadW,
  toForecastExport,
} from "./solar-forecast";

const config = (over: object = {}) =>
  solarForecastConfigSchema.parse({
    enabled: true,
    arrays: [{ kwp: 10, tilt: 30, azimuth: 0 }],
    tempCoefficient: -0.4,
    systemLoss: 14,
    ...over,
  });

describe("pvPowerW", () => {
  test("zero at night and never negative", () => {
    expect(pvPowerW({ gtiWm2: 0, ambientC: 15 }, 10, -0.4, 14)).toBe(0);
    expect(pvPowerW({ gtiWm2: -5, ambientC: 15 }, 10, -0.4, 14)).toBe(0);
  });

  test("STC-ish conditions yield roughly kWp minus losses", () => {
    // 1000 W/m² with cells at exactly 25 °C (ambient 25 - rise 31.25 ≈ -6.25).
    const w = pvPowerW({ gtiWm2: 1000, ambientC: 25 - (1000 * 25) / 800 }, 10, -0.4, 14);
    expect(w).toBeCloseTo(10 * 1000 * 0.86, 0);
  });

  test("hot cells produce less than cool cells at equal irradiance", () => {
    const cool = pvPowerW({ gtiWm2: 800, ambientC: 5 }, 10, -0.4, 14);
    const hot = pvPowerW({ gtiWm2: 800, ambientC: 35 }, 10, -0.4, 14);
    expect(hot).toBeLessThan(cool);
  });

  test("temperature coefficient of zero disables derating", () => {
    const w = pvPowerW({ gtiWm2: 500, ambientC: 40 }, 10, 0, 0);
    expect(w).toBeCloseTo(5000, 5);
  });

  test("normal-incidence beam loses nothing to the IAM", () => {
    // All 300 W/m² arrives as beam straight onto the glass: IAM(1) = 1, no
    // diffuse remainder — identical to the model without the split.
    const withIam = pvPowerW({ gtiWm2: 300, ambientC: 20, dniWm2: 400, cosAoi: 1 }, 10, -0.4, 14);
    const legacy = pvPowerW({ gtiWm2: 300, ambientC: 20 }, 10, -0.4, 14);
    expect(withIam).toBeCloseTo(legacy, 6);
  });

  test("glancing beam is derated harder than the flat system loss", () => {
    const glancing = pvPowerW(
      { gtiWm2: 300, ambientC: 20, dniWm2: 600, cosAoi: 0.15 },
      10,
      -0.4,
      14,
    );
    const legacy = pvPowerW({ gtiWm2: 300, ambientC: 20 }, 10, -0.4, 14);
    expect(glancing).toBeLessThan(legacy);
  });

  test("sun behind the plane leaves only diffuse light", () => {
    // Temp coefficient zeroed: cells heat with the *full* incident GTI, not the
    // post-IAM effective irradiance, so only the optical path is compared here.
    const behind = pvPowerW({ gtiWm2: 100, ambientC: 20, dniWm2: 500, cosAoi: -0.3 }, 10, 0, 14);
    const allDiffuse = pvPowerW({ gtiWm2: 100 * 0.95, ambientC: 20 }, 10, 0, 14);
    expect(behind).toBeCloseTo(allDiffuse, 6);
  });

  test("wind cools the cells and lifts output (Faiman)", () => {
    const calm = pvPowerW({ gtiWm2: 800, ambientC: 30, windMs: 0.5 }, 10, -0.4, 14);
    const windy = pvPowerW({ gtiWm2: 800, ambientC: 30, windMs: 6 }, 10, -0.4, 14);
    expect(windy).toBeGreaterThan(calm);
  });

  test("~1 m/s wind matches the NOCT fallback within a few percent", () => {
    const faiman = pvPowerW({ gtiWm2: 1000, ambientC: 25, windMs: 1 }, 10, -0.4, 14);
    const noct = pvPowerW({ gtiWm2: 1000, ambientC: 25 }, 10, -0.4, 14);
    expect(Math.abs(faiman - noct) / noct).toBeLessThan(0.02);
  });
});

describe("buildSolarForecast", () => {
  // Two local days, one sunny hour each; local time = UTC+2.
  const data: IrradianceForecast = {
    times: ["2026-07-18T08:00", "2026-07-18T12:00", "2026-07-19T12:00"],
    utcOffsetSeconds: 7200,
    location: { latitude: 48, longitude: 9 },
    temperature: [20, 25, 25],
    gti: [[100, 800, 400]],
  };
  // Local noon on the 18th → 10:00 UTC.
  const nowMs = Date.parse("2026-07-18T10:00:00Z");

  test("buckets kWh into today / remaining / tomorrow by local day", () => {
    const f = buildSolarForecast(config(), data, "test", nowMs);
    expect(f.provider).toBe("test");
    expect(f.series).toHaveLength(3);
    expect(f.todayKwh).toBeGreaterThan(f.remainingTodayKwh);
    // Remaining keeps the running hour: only the 12:00 slot counts.
    expect(f.remainingTodayKwh).toBeCloseTo((f.series[1]?.watts ?? -1) / 1000, 6);
    expect(f.tomorrowKwh).toBeCloseTo((f.series[2]?.watts ?? -1) / 1000, 6);
  });

  test("prorates the running hour by the fraction still ahead", () => {
    // Local 12:30 → half of the 12:00 slot remains.
    const f = buildSolarForecast(config(), data, "test", Date.parse("2026-07-18T10:30:00Z"));
    expect(f.remainingTodayKwh).toBeCloseTo(((f.series[1]?.watts ?? -1) / 1000) * 0.5, 6);
  });

  test("sums power across multiple arrays with their own orientation series", () => {
    const two = config({
      arrays: [
        { kwp: 5, tilt: 30, azimuth: -45 },
        { kwp: 5, tilt: 30, azimuth: 45 },
      ],
    });
    const twoPlanes: IrradianceForecast = {
      ...data,
      gti: [
        [100, 800, 400],
        [50, 400, 200],
      ],
    };
    const f = buildSolarForecast(two, twoPlanes, "test", nowMs);
    const single = buildSolarForecast(
      config({ arrays: [{ kwp: 5, tilt: 30, azimuth: -45 }] }),
      data,
      "test",
      nowMs,
    );
    expect(f.series[1]?.watts ?? 0).toBeGreaterThan(single.series[1]?.watts ?? Infinity);
  });

  test("missing gti entries count as zero rather than crashing", () => {
    const sparse: IrradianceForecast = { ...data, gti: [] };
    const f = buildSolarForecast(config(), sparse, "test", nowMs);
    expect(f.todayKwh).toBe(0);
  });

  test("next15 reports the running hour's power and its quarter-hour energy", () => {
    const f = buildSolarForecast(config(), data, "test", nowMs);
    const noon = f.series[1]?.watts ?? 0;
    expect(f.next15.maxPowerW).toBeCloseTo(noon, 6);
    expect(f.next15.energyKwh).toBeCloseTo(noon / 1000 / 4, 6);
  });

  test("integrates consecutive hours as a trapezoid, taming the sunset ramp", () => {
    // A declining evening limb of instantaneous irradiance on consecutive hours.
    const ramp: IrradianceForecast = {
      times: ["2026-07-18T16:00", "2026-07-18T17:00", "2026-07-18T18:00", "2026-07-18T19:00"],
      utcOffsetSeconds: 7200,
      location: { latitude: 48, longitude: 9 },
      temperature: [25, 25, 25, 25],
      gti: [[800, 400, 100, 0]],
    };
    const before = Date.parse("2026-07-18T13:00:00Z"); // local 15:00, ahead of the limb
    const f = buildSolarForecast(config(), ramp, "test", before);
    const p = (g: number) => pvPowerW({ gtiWm2: g, ambientC: 25 }, 10, -0.4, 14);
    // Each hour is the mean of its two endpoints; the last has no successor.
    expect(f.series[0]?.watts).toBeCloseTo((p(800) + p(400)) / 2, 6);
    expect(f.series[1]?.watts).toBeCloseTo((p(400) + p(100)) / 2, 6);
    expect(f.series[2]?.watts).toBeCloseTo((p(100) + p(0)) / 2, 6);
    expect(f.series[3]?.watts).toBeCloseTo(p(0), 6);
    // The whole point: the 16:00 bar is pulled below its start-of-hour sample,
    // instead of over-reporting the descending limb.
    expect(f.series[0]?.watts ?? Infinity).toBeLessThan(p(800));
  });

  test("non-adjacent samples are not averaged across the gap", () => {
    // The default `data` fixture is sparse (4 h / 24 h gaps): each hour must keep
    // its own instantaneous estimate rather than trapezoid across the gap.
    const f = buildSolarForecast(config(), data, "test", nowMs);
    const p = (g: number, t: number) => pvPowerW({ gtiWm2: g, ambientC: t }, 10, -0.4, 14);
    expect(f.series[1]?.watts).toBeCloseTo(p(800, 25), 6);
  });

  test("DNI series activates the IAM: evening beam on a south panel is cut", () => {
    // Local 19:00 in July at 48°N: sun low in the west, badly off a south-
    // facing panel's normal — the beam share must lose more than diffuse.
    const evening: IrradianceForecast = {
      times: ["2026-07-18T19:00"],
      utcOffsetSeconds: 7200,
      location: { latitude: 48, longitude: 9 },
      temperature: [25],
      gti: [[300]],
    };
    const at = Date.parse("2026-07-18T16:00:00Z"); // local 18:00, hour is ahead
    const plain = buildSolarForecast(config(), evening, "test", at);
    const withDni = buildSolarForecast(config(), { ...evening, dni: [500] }, "test", at);
    expect(withDni.series[0]?.watts ?? Infinity).toBeLessThan(plain.series[0]?.watts ?? 0);
  });

  test("wind series activates Faiman cooling: a windy hour outproduces a calm one", () => {
    const calm = buildSolarForecast(
      config(),
      { ...data, windSpeed: [0.5, 0.5, 0.5] },
      "test",
      nowMs,
    );
    const windy = buildSolarForecast(config(), { ...data, windSpeed: [8, 8, 8] }, "test", nowMs);
    expect(windy.series[1]?.watts ?? 0).toBeGreaterThan(calm.series[1]?.watts ?? Infinity);
  });
});

describe("buildSolarForecast 15-minute grid", () => {
  // One local hour sampled every 15 min (UTC+2), plus the next hour's first
  // sample so every quarter-hour slot has both trapezoid endpoints.
  const quarter: IrradianceForecast = {
    times: [
      "2026-07-18T12:00",
      "2026-07-18T12:15",
      "2026-07-18T12:30",
      "2026-07-18T12:45",
      "2026-07-18T13:00",
    ],
    utcOffsetSeconds: 7200,
    location: { latitude: 48, longitude: 9 },
    temperature: [25, 25, 25, 25, 25],
    gti: [[800, 900, 700, 600, 500]],
  };
  const at = Date.parse("2026-07-18T10:00:00Z"); // local noon
  const p = (g: number) => pvPowerW({ gtiWm2: g, ambientC: 25 }, 10, -0.4, 14);

  test("reports the grid's step and weights energy by slot width", () => {
    const f = buildSolarForecast(config(), quarter, "test", at);
    expect(f.stepMinutes).toBe(15);
    // Every slot is a quarter hour (the last inherits the preceding width).
    const sum = f.series.reduce((s, x) => s + x.watts, 0) / 4 / 1000;
    expect(f.todayKwh).toBeCloseTo(sum, 6);
  });

  test("per-slot watts is the trapezoid mean, peak the larger endpoint", () => {
    const f = buildSolarForecast(config(), quarter, "test", at);
    expect(f.series[0]?.watts).toBeCloseTo((p(800) + p(900)) / 2, 6);
    expect(f.series[0]?.peakWatts).toBeCloseTo(p(900), 6);
    expect(f.series[1]?.peakWatts).toBeCloseTo(p(900), 6);
  });

  test("next15 covers exactly the first quarter-hour slot", () => {
    const f = buildSolarForecast(config(), quarter, "test", at);
    expect(f.next15.energyKwh).toBeCloseTo((f.series[0]?.watts ?? 0) / 4 / 1000, 6);
    expect(f.next15.maxPowerW).toBeCloseTo(f.series[0]?.peakWatts ?? 0, 6);
    // The tile draws the AVERAGE, so tile kW × 0.25 h must equal tile kWh, and
    // over a single fully-covered 15-min slot the average equals the slot watts
    // — well below the (spiky) peak. See issue #49.
    expect(f.next15.avgPowerW).toBeCloseTo(f.series[0]?.watts ?? 0, 6);
    expect(f.next15.avgPowerW).toBeLessThan(f.next15.maxPowerW);
    expect((f.next15.avgPowerW / 1000) * 0.25).toBeCloseTo(f.next15.energyKwh, 9);
  });

  test("remaining prorates the running quarter-hour slot", () => {
    // Local 12:20 → 10 of the 12:15 slot's 15 minutes remain.
    const f = buildSolarForecast(config(), quarter, "test", Date.parse("2026-07-18T10:20:00Z"));
    const rest = f.series.slice(2).reduce((s, x) => s + x.watts, 0);
    const expected = ((f.series[1]?.watts ?? 0) * (10 / 15) + rest) / 4 / 1000;
    expect(f.remainingTodayKwh).toBeCloseTo(expected, 6);
  });
});

describe("buildSolarForecast clipping", () => {
  // Four consecutive full-sun hours on one local day (UTC+2), so a small feed-in
  // cap + battery must curtail once the battery fills. Now = local 10:00, so all
  // four hours are simulated.
  const sun: IrradianceForecast = {
    times: ["2026-07-18T10:00", "2026-07-18T11:00", "2026-07-18T12:00", "2026-07-18T13:00"],
    utcOffsetSeconds: 7200,
    location: { latitude: 48, longitude: 9 },
    temperature: [25, 25, 25, 25],
    gti: [[1000, 1000, 1000, 1000]],
  };
  const now = Date.parse("2026-07-18T08:00:00Z"); // local 10:00
  const raw = buildSolarForecast(config(), sun, "test", now).series.map((h) => h.watts);

  test("no clipping config leaves output identical to the raw estimate", () => {
    const f = buildSolarForecast(config(), sun, "test", now, {
      startSocPct: 40,
      houseLoadW: 500,
    });
    expect(f.series.map((h) => h.watts)).toEqual(raw);
  });

  test("battery soaks up surplus, then output clips to the feed-in cap", () => {
    const clip = config({ maxOutputW: 3000, battery: { usableKwh: 5, minSoc: 0 } });
    const f = buildSolarForecast(clip, sun, "test", now, { startSocPct: 0, houseLoadW: 0 });
    // Hour 1: 5 kWh headroom absorbs the above-cap surplus → no curtailment.
    expect(f.series[0]?.watts).toBeCloseTo(raw[0] ?? 0, 6);
    // Battery now full + no load → later hours clip to the 3 kW export cap.
    expect(f.series[1]?.watts).toBeCloseTo(3000, 6);
    expect(f.series[2]?.watts).toBeCloseTo(3000, 6);
    expect(f.todayKwh).toBeLessThan(buildSolarForecast(config(), sun, "test", now).todayKwh);
  });

  test("a bigger battery curtails less (more headroom for surplus)", () => {
    const small = buildSolarForecast(
      config({ maxOutputW: 3000, battery: { usableKwh: 3, minSoc: 0 } }),
      sun,
      "test",
      now,
      { startSocPct: 0, houseLoadW: 0 },
    );
    const big = buildSolarForecast(
      config({ maxOutputW: 3000, battery: { usableKwh: 15, minSoc: 0 } }),
      sun,
      "test",
      now,
      { startSocPct: 0, houseLoadW: 0 },
    );
    expect(big.todayKwh).toBeGreaterThan(small.todayKwh);
  });

  test("house load is served before the cap, lifting usable output", () => {
    const clip = config({ maxOutputW: 3000, battery: { usableKwh: 5, minSoc: 0 } });
    const noLoad = buildSolarForecast(clip, sun, "test", now, { startSocPct: 100, houseLoadW: 0 });
    const withLoad = buildSolarForecast(clip, sun, "test", now, {
      startSocPct: 100, // battery starts full → clipping bites immediately
      houseLoadW: 2000,
    });
    // Battery full from the start, so hour 1 clips; load consumes 2 kW behind the
    // cap that would otherwise be curtailed.
    expect(withLoad.series[0]?.watts ?? 0).toBeGreaterThan(noLoad.series[0]?.watts ?? 0);
    expect(withLoad.series[0]?.watts).toBeCloseTo(3000 + 2000, 6);
  });

  // Local 12:00 — the 10:00 and 11:00 slots are past, 12:00 is running.
  const laterNow = Date.parse("2026-07-18T10:00:00Z");

  test("without a day-start SOC, past slots keep the raw estimate", () => {
    const clip = config({ maxOutputW: 3000, battery: { usableKwh: 5, minSoc: 0 } });
    const f = buildSolarForecast(clip, sun, "test", laterNow, {
      startSocPct: 100,
      houseLoadW: 0,
    });
    expect(f.series[0]?.watts).toBeCloseTo(raw[0] ?? 0, 6); // past — unclipped
    expect(f.series[2]?.watts).toBeCloseTo(3000, 6); // future — battery full → cap
  });

  test("a day-start SOC lets the sim clip past slots too (no seam at now)", () => {
    const clip = config({ maxOutputW: 3000, battery: { usableKwh: 5, minSoc: 0 } });
    const f = buildSolarForecast(clip, sun, "test", laterNow, {
      startSocPct: 100,
      houseLoadW: 0,
      dayStartSocPct: 100,
    });
    // Battery already full at the series start → every hour clips, past included.
    for (const h of f.series) expect(h.watts).toBeCloseTo(3000, 6);
  });

  test("the measured live SOC overrides the simulated one at the seam", () => {
    // Huge battery from empty: the sim alone would never fill it today, but the
    // live reading says it is full now — future slots must clip immediately.
    const clip = config({ maxOutputW: 3000, battery: { usableKwh: 50, minSoc: 0 } });
    const f = buildSolarForecast(clip, sun, "test", laterNow, {
      startSocPct: 100,
      houseLoadW: 0,
      dayStartSocPct: 0,
    });
    expect(f.series[0]?.watts).toBeCloseTo(raw[0] ?? 0, 6); // past: headroom, no clip
    expect(f.series[2]?.watts).toBeCloseTo(3000, 6); // future: full per live SOC
  });

  test("a cap-only plant clips past slots without any SOC", () => {
    const f = buildSolarForecast(config({ maxOutputW: 3000 }), sun, "test", laterNow, {
      startSocPct: null,
      houseLoadW: 0,
    });
    for (const h of f.series) expect(h.watts).toBeCloseTo(3000, 6);
  });

  test("overnight discharge reclaims headroom so the next day isn't over-curtailed", () => {
    // Sunny noon, then two dark high-load hours, then a sunny noon the next day.
    const twoDay: IrradianceForecast = {
      times: ["2026-07-18T12:00", "2026-07-18T20:00", "2026-07-19T04:00", "2026-07-19T12:00"],
      utcOffsetSeconds: 7200,
      location: { latitude: 48, longitude: 9 },
      temperature: [25, 25, 25, 25],
      gti: [[1000, 0, 0, 1000]],
    };
    const at = Date.parse("2026-07-18T10:00:00Z"); // local noon on day 1
    const clip = config({ maxOutputW: 3000, battery: { usableKwh: 5, minSoc: 0 } });
    const f = buildSolarForecast(clip, twoDay, "test", at, { startSocPct: 100, houseLoadW: 2000 });
    const rawNoon = buildSolarForecast(config(), twoDay, "test", at).series[3]?.watts ?? 0;
    // Battery started full but 4 kWh drained overnight, so day-2 noon has headroom
    // again and its usable output beats a full-battery (immediately clipping) day.
    expect(f.series[1]?.watts).toBe(0); // dark hour, all load from battery
    expect(f.series[3]?.watts ?? 0).toBeGreaterThan(3000 + 2000);
    expect(f.series[3]?.watts ?? 0).toBeLessThanOrEqual(rawNoon + 1e-6);
  });
});

describe("toForecastExport", () => {
  const data: IrradianceForecast = {
    times: ["2026-07-18T08:00", "2026-07-18T12:00", "2026-07-19T12:00"],
    utcOffsetSeconds: 7200,
    location: { latitude: 48, longitude: 9 },
    temperature: [20, 25, 25],
    gti: [[100, 800, 400]],
  };
  const nowMs = Date.parse("2026-07-18T10:00:00Z");

  test("mirrors the series into an offset-aware Solcast-style curve", () => {
    const f = buildSolarForecast(config(), data, "test", nowMs);
    const exported = toForecastExport(f, "raw");
    expect(exported.detailedForecast).toHaveLength(f.raw.series.length);
    expect(exported.detailedForecast[0]).toEqual({
      period_start: "2026-07-18T08:00:00+02:00",
      watts: f.raw.series[0]?.watts ?? -1,
    });
    // Native fields pass through untouched.
    expect(exported.todayKwh).toBe(f.raw.todayKwh);
    expect(exported.provider).toBe("test");
    // The export carries no nested `raw` — it is one flat view.
    expect("raw" in exported).toBe(false);
  });

  test("emits Z for a UTC plant and a negative offset west of UTC", () => {
    const utc = toForecastExport(
      buildSolarForecast(config(), { ...data, utcOffsetSeconds: 0 }, "t", nowMs),
      "raw",
    );
    expect(utc.detailedForecast[0]?.period_start).toBe("2026-07-18T08:00:00Z");
    const west = toForecastExport(
      buildSolarForecast(config(), { ...data, utcOffsetSeconds: -18_000 }, "t", nowMs),
      "raw",
    );
    expect(west.detailedForecast[0]?.period_start).toBe("2026-07-18T08:00:00-05:00");
  });

  test("raw exceeds a feed-in cap that usable clips away", () => {
    // 10 kWp plant, 3 kW export cap, no battery, no house load: the sunny slot's
    // raw potential sits well above 3 kW, but the usable view is curtailed to it.
    const capped = config({ maxOutputW: 3000 });
    const f = buildSolarForecast(capped, data, "test", nowMs, { startSocPct: null, houseLoadW: 0 });
    const raw = toForecastExport(f, "raw");
    const usable = toForecastExport(f, "usable");
    const noonRaw = raw.detailedForecast[1]?.watts ?? 0;
    const noonUsable = usable.detailedForecast[1]?.watts ?? 0;
    expect(noonRaw).toBeGreaterThan(3000);
    expect(noonUsable).toBeLessThanOrEqual(3000 + 1e-6);
    expect(raw.todayKwh).toBeGreaterThan(usable.todayKwh);
  });
});

describe("buildSolarForecast correction", () => {
  // Local times: hour 8 on the 18th, then noon on the 18th and 19th (UTC+2).
  const data: IrradianceForecast = {
    times: ["2026-07-18T08:00", "2026-07-18T12:00", "2026-07-19T12:00"],
    utcOffsetSeconds: 7200,
    location: { latitude: 48, longitude: 9 },
    temperature: [20, 25, 25],
    gti: [[100, 800, 400]],
  };
  const nowMs = Date.parse("2026-07-18T10:00:00Z");
  const baseline = buildSolarForecast(config(), data, "test", nowMs).series.map((s) => s.watts);

  test("an empty model leaves the forecast identical", () => {
    const empty: CorrectionModel = new Map();
    const f = buildSolarForecast(config(), data, "test", nowMs, undefined, empty);
    expect(f.series.map((s) => s.watts)).toEqual(baseline);
  });

  test("a learned cell scales only its own (month, hour) slots", () => {
    const model: CorrectionModel = new Map([["7:12", { ratio: 1.4, weight: 100 }]]);
    const factor = correctionFactor(model, 7, 12);
    expect(factor).toBeGreaterThan(1);

    const f = buildSolarForecast(config(), data, "test", nowMs, undefined, model);
    // The 08:00 slot has no matching cell → untouched.
    expect(f.series[0]?.watts).toBeCloseTo(baseline[0] ?? -1, 6);
    // Both noon slots (month 7, hour 12) scale by the applied factor.
    expect(f.series[1]?.watts).toBeCloseTo((baseline[1] ?? 0) * factor, 6);
    expect(f.series[2]?.watts).toBeCloseTo((baseline[2] ?? 0) * factor, 6);
  });
});

describe("forecastProviderCatalog", () => {
  test("advertises every registered provider with a label and its capability flags", () => {
    const catalog = forecastProviderCatalog();
    expect(catalog.map((p) => p.id)).toContain("open-meteo");
    // A non-empty label is what the settings dropdown renders per provider.
    expect(catalog.every((p) => p.label.length > 0)).toBe(true);
    // Open-Meteo delivers DNI and wind, so both physics refinements are on. The
    // flag pair is what lets the form say which optionals a source resolves.
    const openMeteo = catalog.find((p) => p.id === "open-meteo");
    expect(openMeteo?.capabilities).toEqual({ dni: true, windSpeed: true });
  });

  test("the capability flags are not decoration — the provider actually supplies them", async () => {
    // Mirror open-meteo-archive.test.ts: swap `globalThis.fetch`, drive the real
    // provider, and assert the forecast carries exactly the optional series the
    // provider's `capabilities` claim it does.
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          utc_offset_seconds: 7200,
          minutely_15: {
            time: ["2026-07-18T12:00", "2026-07-18T12:15"],
            temperature_2m: [25, 25],
            global_tilted_irradiance_instant: [800, 800],
            direct_normal_irradiance_instant: [500, 500],
            wind_speed_10m: [3, 3],
          },
        }),
      }) as unknown as Response) as unknown as typeof fetch;
    try {
      const forecast = await openMeteoIrradiance.fetch({ latitude: 48, longitude: 9 }, [
        { tilt: 30, azimuth: 0 },
      ]);
      expect(openMeteoIrradiance.capabilities.dni).toBe(true);
      expect(forecast.dni).toEqual([500, 500]);
      expect(openMeteoIrradiance.capabilities.windSpeed).toBe(true);
      expect(forecast.windSpeed).toEqual([3, 3]);
    } finally {
      globalThis.fetch = nativeFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// fetchSolarForecast — the impure edge: provider selection, the irradiance
// cache, and the live/measured inputs the clipping sim runs on.
//
// Two deliberate choices about what is *not* stubbed:
//
//   * The provider. `PROVIDERS` is a module-level map captured when
//     solar-forecast is first imported — which may be from a different test
//     file, long before this one loads — so `mock.module` on the provider would
//     be a coin flip on file order. Swapping `globalThis.fetch` instead drives
//     the real Open-Meteo provider through the real registry, whatever the
//     order, and covers the plane-deduplication and HTTP failure paths for free.
//   * The rollup queries. `../shared/history` is the module `history.test.ts`
//     imports directly, and `mock.module` is permanent — mocking it here would
//     replace the functions that suite asserts SQL on. So the DB singleton is
//     swapped instead (the pattern history.test.ts already uses), and the real
//     queries run against it.
//
// The spreads are load-bearing: `mock.module` is process-global and permanent,
// so a factory returning only the exports this suite needs would delete the rest
// for every test file that runs after it.
// ---------------------------------------------------------------------------
//
// And each stub is handed back in `afterAll` below, because a spread mock is
// still permanent: `db`, `getActiveProfileOrNull` and `liveState` would stay
// swapped for every later file, including `../shared/state`'s and
// `../inverter/inverter`'s own suites. A module namespace is live — after the
// mocks, `realState.liveState` IS `poll` — so the real exports are snapshotted
// by value here, at load time, before anything is installed.
const realDb = await import("@SunReye/db");
const realInverter = await import("../inverter/inverter");
const realState = await import("../shared/state");

const realDbExports = { ...realDb };
const realInverterExports = { ...realInverter };
const realStateExports = { ...realState };

/** Every statement `db.execute` was handed, flattened for substring matching. */
const queries: { sql: string; params: unknown[] }[] = [];
/** Rows the median-house-load query answers with. */
let medianRows: unknown[] = [];
/** Rows the day-start-SOC hourly-average query answers with. */
let hourlyRows: unknown[] = [];
/** Learned correction cells `getCorrectionCells` answers with. */
let correctionRows: { month: number; hour: number; ratio: number; weight: number }[] = [];

const proxy = drizzle(async (sqlText: string, params: unknown[]) => {
  queries.push({ sql: sqlText.replace(/\s+/g, " ").trim(), params });
  if (sqlText.includes("percentile_cont")) return { rows: medianRows };
  if (sqlText.includes("avg_value")) return { rows: hourlyRows };
  return { rows: [] };
});

const dbStub = {
  // The proxy driver resolves to the rows themselves; node-postgres resolves to
  // `{ rows }`. Re-wrap so the queries see the shape production gives them.
  execute: async (q: never) => ({ rows: await proxy.execute(q) }),
  // `getCorrectionCells` is the only `select()` this suite reaches, and the
  // proxy driver maps selects positionally; answer the chain with the row
  // objects drizzle would hand back instead.
  select: () => ({ from: () => ({ where: async () => correctionRows }) }),
};
mock.module("@SunReye/db", () => ({ ...realDb, db: dbStub }));

let activeProfile: InverterProfile | null = null;
mock.module("../inverter/inverter", () => ({
  ...realInverter,
  getActiveProfileOrNull: () => activeProfile,
}));

// A faithful stand-in for the poll cache, not a bare `{ latest }` bag: the real
// `liveState` exposes a getter plus `set`, and other suites drive the loop
// through that setter. A mock missing it would break them, permanently and by
// file order. This one only adds the reset the real module has no reason to.
let latestSample: InverterSample | null = null;
const poll = {
  get latest(): InverterSample | null {
    return latestSample;
  },
  set(sample: InverterSample): void {
    latestSample = sample;
  },
  reset(sample: InverterSample | null): void {
    latestSample = sample;
  },
};
mock.module("../shared/state", () => ({ ...realState, liveState: poll }));

// Registered at file scope, so it runs after every describe below — the whole
// file needs the stubs until then. From here on the process gets the real
// modules back.
afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
  mock.module("../inverter/inverter", () => ({ ...realInverterExports }));
  mock.module("../shared/state", () => ({ ...realStateExports }));
});

const HOUR = 3_600_000;

/** A profile mapping one metric per canonical role, keyed by the role itself. */
const profileWith = (...roles: CanonicalRole[]): InverterProfile => {
  const data: ProfileData = {
    schemaVersion: 1,
    id: "test-inverter",
    name: "Test",
    manufacturer: "Test",
    version: "1.0.0",
    metrics: roles.map((role) => ({
      key: role,
      topic: role.replaceAll(".", "/"),
      label: role,
      unit: null,
      group: "inverter",
      type: "U_WORD",
      addresses: [1],
      scale: 1,
      access: "r",
      role,
    })),
  };
  return hydrateProfile(data);
};

const liveSample = (metrics: Record<string, number>): InverterSample => ({
  time: new Date().toISOString(),
  inverterId: "live-inverter",
  metrics,
});

// --- the Open-Meteo stub -----------------------------------------------------

/** Plant-local quarter hours 11:00 → 12:45; the simulated clock sits at 12:00. */
const SLOT_TIMES = ["11:00", "11:15", "11:30", "11:45", "12:00", "12:15", "12:30", "12:45"];

/**
 * Each test runs a full day after the previous one, so the module-level
 * irradiance cache (30 min) and house-load cache (6 h) are always cold unless a
 * test deliberately reuses them.
 */
let clockMs = Date.parse("2026-07-18T10:00:00Z"); // 12:00 plant-local at UTC+2

/** The plant-local calendar date the simulated clock currently sits on. */
const localDate = (): string => new Date(Date.now() + 7200_000).toISOString().slice(0, 10);

/** A flat, full-sun 15-minute series for the current simulated day. */
const sunnySeries = () => ({
  utc_offset_seconds: 7200,
  minutely_15: {
    time: SLOT_TIMES.map((t) => `${localDate()}T${t}`),
    temperature_2m: SLOT_TIMES.map(() => 25),
    global_tilted_irradiance_instant: SLOT_TIMES.map(() => 1000),
  },
});

/** 1000 W/m² at 25 °C on a 10 kWp array, per the model — every slot is flat. */
const SLOT_W = pvPowerW({ gtiWm2: 1000, ambientC: 25 }, 10, -0.4, 14);

const nativeFetch = globalThis.fetch;
let urls: string[] = [];
let body: () => unknown = sunnySeries;
let networkError: Error | null = null;
let httpStatus = 200;

/** Reset every stub and advance the simulated clock into a fresh day. */
function resetHarness(): void {
  clockMs += 24 * HOUR;
  setSystemTime(new Date(clockMs));
  queries.length = 0;
  medianRows = [];
  hourlyRows = [];
  correctionRows = [];
  activeProfile = null;
  poll.reset(null);
  urls = [];
  body = sunnySeries;
  networkError = null;
  httpStatus = 200;
  globalThis.fetch = (async (input: unknown) => {
    urls.push(String(input));
    if (networkError) throw networkError;
    if (httpStatus !== 200) return { ok: false, status: httpStatus } as Response;
    return { ok: true, json: async () => body() } as unknown as Response;
  }) as typeof fetch;
}

/**
 * Hand the process back what this suite borrowed. The stubbed modules stay
 * registered (`mock.module` is permanent), so their *state* has to be neutral
 * again — a leaked active profile or poll sample would silently change what a
 * later file's real code sees.
 */
function restoreHarness(): void {
  globalThis.fetch = nativeFetch;
  setSystemTime();
  activeProfile = null;
  poll.reset(null);
}

/**
 * A ready plant. Every call gets its own longitude (7 m apart — physically
 * irrelevant) so a test never inherits another test's cache entry; tests that
 * want a cache hit reuse the returned object.
 */
let plantSeq = 0;
const plant = (forecastOver: object = {}, over: object = {}): WeatherConfig =>
  weatherConfigSchema.parse({
    enabled: true,
    latitude: 48,
    longitude: 9 + 0.0001 * ++plantSeq,
    ...over,
    forecast: {
      enabled: true,
      arrays: [{ kwp: 10, tilt: 30, azimuth: 0 }],
      ...forecastOver,
    },
  });

/** `fetchSolarForecast` is nullable by design; unwrap where a test demands one. */
function must(f: SolarForecast | null): SolarForecast {
  if (!f) throw new Error("expected a forecast, got null");
  return f;
}

const watts = (f: SolarForecast): number[] => f.series.map((p) => p.watts);
const medianQueries = () => queries.filter((q) => q.sql.includes("percentile_cont"));
const hourlyQueries = () => queries.filter((q) => q.sql.startsWith("select bucket, avg_value"));

/**
 * Watts of slot `i`. A slot the series never produced is a broken expectation,
 * not a value to compare — name it rather than folding it into a sentinel.
 */
const slotW = (series: SolarForecastPoint[], i: number): number => {
  const point = series[i];
  if (!point) throw new Error(`expected a slot at index ${i}, series holds ${series.length}`);
  return point.watts;
};

/** Bound parameters of the first `label` query the run issued. */
const firstParams = (matching: typeof queries, label: string): unknown[] => {
  const first = matching[0];
  if (!first) throw new Error(`expected at least one ${label} query, none ran`);
  return first.params;
};

describe("fetchSolarForecast provider selection", () => {
  beforeEach(resetHarness);
  afterEach(restoreHarness);
  afterAll(restoreHarness);

  test("turns the configured provider's irradiance into the plant's forecast", async () => {
    const f = must(await fetchSolarForecast(plant()));
    expect(f.provider).toBe("open-meteo");
    expect(f.stepMinutes).toBe(15);
    expect(f.utcOffsetSeconds).toBe(7200);
    expect(f.series).toHaveLength(8);
    expect(f.series[0]?.watts).toBeCloseTo(SLOT_W, 6);
    // Now sits exactly at the 12:00 slot, so half the flat day is still ahead.
    expect(f.todayKwh).toBeCloseTo((8 * SLOT_W) / 4 / 1000, 6);
    expect(f.remainingTodayKwh).toBeCloseTo(f.todayKwh / 2, 6);
    expect(f.tomorrowKwh).toBe(0);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("latitude=48");
    expect(urls[0]).toContain("tilt=30&azimuth=0");
  });

  test("requests one series per distinct orientation, sharing it between twin arrays", async () => {
    const f = must(
      await fetchSolarForecast(
        plant({
          arrays: [
            { kwp: 4, tilt: 30, azimuth: -45 },
            { kwp: 4, tilt: 30, azimuth: 45 },
            { kwp: 2, tilt: 30, azimuth: -45 },
          ],
        }),
      ),
    );
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("azimuth=-45");
    expect(urls[1]).toContain("azimuth=45");
    // The plane-independent extras ride only the first request.
    expect(urls[0]).toContain("temperature_2m");
    expect(urls[1]).not.toContain("temperature_2m");
    // All 10 kWp are still modelled, split across the three arrays.
    expect(f.series[0]?.watts).toBeCloseTo(SLOT_W, 6);
  });

  test("an unknown provider yields no forecast and never calls out", async () => {
    expect(await fetchSolarForecast(plant({ provider: "solcast" }))).toBeNull();
    expect(await fetchSolarForecast(plant({ provider: "" }))).toBeNull();
    expect(urls).toEqual([]);
  });

  test("a plant that is not ready to forecast is never fetched for", async () => {
    expect(await fetchSolarForecast(plant({ enabled: false }))).toBeNull();
    expect(await fetchSolarForecast(plant({ arrays: [] }))).toBeNull();
    expect(await fetchSolarForecast(plant({}, { enabled: false }))).toBeNull();
    expect(await fetchSolarForecast(plant({}, { latitude: null }))).toBeNull();
    expect(await fetchSolarForecast(plant({}, { longitude: null }))).toBeNull();
    expect(urls).toEqual([]);
  });
});

describe("fetchSolarForecast irradiance cache", () => {
  beforeEach(resetHarness);
  afterEach(restoreHarness);
  afterAll(restoreHarness);

  test("reuses the fetched series inside the TTL, refetching once it lapses", async () => {
    const p = plant();
    const first = must(await fetchSolarForecast(p));

    setSystemTime(new Date(clockMs + 29 * 60_000));
    const second = must(await fetchSolarForecast(p));
    expect(urls).toHaveLength(1);
    // Cached irradiance, but the sums are rebuilt against the new "now": the
    // whole day is unchanged while what is left of it has shrunk.
    expect(second.todayKwh).toBeCloseTo(first.todayKwh, 6);
    expect(second.remainingTodayKwh).toBeLessThan(first.remainingTodayKwh);

    // 30 minutes is the edge of the window, not still inside it.
    setSystemTime(new Date(clockMs + 30 * 60_000));
    await fetchSolarForecast(p);
    expect(urls).toHaveLength(2);
  });

  test("a change to the plant's own configuration invalidates the cached series", async () => {
    const p = plant();
    await fetchSolarForecast(p);
    const rebuilt: WeatherConfig = {
      ...p,
      forecast: { ...p.forecast, arrays: [{ kwp: 20, tilt: 30, azimuth: 0 }] },
    };
    const bigger = must(await fetchSolarForecast(rebuilt));
    expect(urls).toHaveLength(2);
    expect(bigger.series[0]?.watts).toBeCloseTo(2 * SLOT_W, 6);
  });

  test("a network timeout with nothing cached yields no forecast", async () => {
    networkError = Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
    expect(await fetchSolarForecast(plant())).toBeNull();
    expect(urls).toHaveLength(1);
  });

  test("a non-2xx provider response with nothing cached yields no forecast", async () => {
    httpStatus = 503;
    expect(await fetchSolarForecast(plant())).toBeNull();
  });

  test("a stale series for the same plant beats no forecast when the provider is down", async () => {
    const p = plant();
    const fresh = must(await fetchSolarForecast(p));

    setSystemTime(new Date(clockMs + 45 * 60_000)); // well past the 30-minute TTL
    networkError = new Error("ECONNREFUSED");
    const stale = must(await fetchSolarForecast(p));

    expect(urls).toHaveLength(2); // it did try again first
    expect(watts(stale)).toEqual(watts(fresh));
    // Served stale, but still re-derived: 45 minutes less of the day remain.
    expect(stale.remainingTodayKwh).toBeLessThan(fresh.remainingTodayKwh);
  });

  test("a stale series for a different plant is not served in place of the failed one", async () => {
    await fetchSolarForecast(plant()); // caches under its own key
    networkError = new Error("ECONNREFUSED");
    expect(await fetchSolarForecast(plant())).toBeNull();
  });

  test("an empty provider series is an empty forecast, not a crash", async () => {
    body = () => ({
      utc_offset_seconds: 0,
      minutely_15: { time: [], temperature_2m: [], global_tilted_irradiance_instant: [] },
    });
    const f = must(await fetchSolarForecast(plant()));
    expect(f.series).toEqual([]);
    expect(f.raw.series).toEqual([]);
    expect(f.todayKwh).toBe(0);
    expect(f.remainingTodayKwh).toBe(0);
    expect(f.tomorrowKwh).toBe(0);
    expect(f.next15).toEqual({ maxPowerW: 0, energyKwh: 0, avgPowerW: 0 });
    // No grid to measure, so the slot width falls back to the one-hour cap.
    expect(f.stepMinutes).toBe(60);
  });
});

describe("fetchSolarForecast clipping inputs", () => {
  beforeEach(resetHarness);
  afterEach(restoreHarness);
  afterAll(restoreHarness);

  const clipped = (over: object = {}) =>
    plant({ maxOutputW: 3000, battery: { usableKwh: 4, minSoc: 0 }, ...over });

  test("the live SOC and the 14-day median house load drive the clipping model", async () => {
    activeProfile = profileWith("battery.soc", "load.power");
    poll.reset(liveSample({ "battery.soc": 95 }));
    medianRows = [{ median: 800 }];
    const f = must(await fetchSolarForecast(clipped()));

    const [metric, inverterId, since] = firstParams(medianQueries(), "median house-load");
    expect(metric).toBe("load.power");
    expect(inverterId).toBe("live-inverter"); // the live sample names the plant
    expect(Date.now() - (since as Date).getTime()).toBe(14 * 24 * HOUR);

    // The day-start SOC is read for the series' own first hour (11:00 local).
    const [socMetric, socInverter, from, to] = firstParams(hourlyQueries(), "day-start SOC rollup");
    expect(socMetric).toBe("battery.soc");
    expect(socInverter).toBe("live-inverter");
    expect((from as Date).toISOString()).toBe(`${localDate()}T09:00:00.000Z`);
    expect((to as Date).toISOString()).toBe(`${localDate()}T10:00:00.000Z`);

    // Nearly full battery + a 3 kW cap: the future clips, the unmeasured past
    // keeps its raw estimate.
    expect(slotW(f.series, 0)).toBeCloseTo(slotW(f.raw.series, 0), 6);
    expect(slotW(f.series, 7)).toBeLessThan(slotW(f.raw.series, 7));
    expect(f.todayKwh).toBeLessThan(f.raw.todayKwh);
  });

  test("a configured house load wins over history, and a cap-only plant skips the SOC read", async () => {
    activeProfile = profileWith("battery.soc", "load.power");
    poll.reset(liveSample({ "battery.soc": 50 }));
    medianRows = [{ median: 800 }];
    const f = must(await fetchSolarForecast(plant({ maxOutputW: 3000, houseLoadW: 2000 })));

    expect(medianQueries()).toEqual([]);
    expect(hourlyQueries()).toEqual([]); // no battery to reconstruct
    // No battery, so the whole day is simulated: load is served behind the cap.
    for (const p of f.series) expect(p.watts).toBeCloseTo(5000, 6);
  });

  test("with no clipping limit configured the live inputs are never read at all", async () => {
    activeProfile = profileWith("battery.soc", "load.power");
    poll.reset(liveSample({ "battery.soc": 50 }));
    medianRows = [{ median: 800 }];
    const f = must(await fetchSolarForecast(plant()));
    expect(queries).toEqual([]);
    expect(watts(f)).toEqual(watts(f).map((_, i) => f.raw.series[i]?.watts ?? -1));
  });

  test("a plant with no active profile still forecasts, just without live inputs", async () => {
    activeProfile = null;
    medianRows = [{ median: 800 }];
    const f = must(await fetchSolarForecast(plant({ maxOutputW: 3000 })));
    expect(queries).toEqual([]);
    // No load and no battery known: everything above the export cap is lost.
    for (const p of f.series) expect(p.watts).toBeCloseTo(3000, 6);
  });

  test("a plant that maps no SOC metric leaves the day-start SOC unread", async () => {
    activeProfile = profileWith("load.power");
    poll.reset(liveSample({ "load.power": 700 }));
    medianRows = [{ median: 400 }];
    const f = must(await fetchSolarForecast(clipped()));
    expect(hourlyQueries()).toEqual([]);
    // Nothing measured at either end, so the morning keeps its raw estimate.
    expect(f.series[0]?.watts).toBeCloseTo(f.raw.series[0]?.watts ?? -1, 6);
  });

  test("a measured day-start SOC lets the sim curtail the morning too", async () => {
    activeProfile = profileWith("battery.soc", "load.power");
    poll.reset(liveSample({ "battery.soc": 100 }));
    medianRows = [{ median: 0 }];
    hourlyRows = [{ bucket: `${localDate()}T09:00:00.000Z`, avg_value: 100 }];
    const f = must(await fetchSolarForecast(clipped()));
    // Full at the day's start and full now: every slot clips to the cap, with no
    // seam between the reconstructed past and the forecast future.
    for (const p of f.series) expect(p.watts).toBeCloseTo(3000, 6);
  });

  test("a day-start SOC is read as a percentage of the pack, not as kWh", async () => {
    activeProfile = profileWith("battery.soc", "load.power");
    poll.reset(liveSample({ "battery.soc": 100 }));
    medianRows = [{ median: 0 }];
    // 1 % of a 4 kWh pack is 0.04 kWh — all but empty at sunrise. The pack
    // charges on the whole surplus over the house load, not merely the part
    // above the export cap, so it swallows 7525 W (1.88 kWh) per quarter hour
    // and its 3.96 kWh of headroom runs out partway through the third slot.
    // Read as kWh, that same 1 would instead be a *quarter*-full pack; read as
    // a bare multiple of capacity, a full one. Only the percentage leaves the
    // first two slots with enough headroom to avoid curtailment entirely.
    hourlyRows = [{ bucket: `${localDate()}T09:00:00.000Z`, avg_value: 1 }];
    const f = must(await fetchSolarForecast(clipped()));

    // 11:00 and 11:15 are absorbed whole, so nothing is curtailed yet.
    expect(f.series[0]?.watts).toBeCloseTo(SLOT_W, 6);
    expect(f.series[1]?.watts).toBeCloseTo(SLOT_W, 6);
    // 11:30 fills the pack partway through and is curtailed for the remainder.
    expect(f.series[2]?.watts ?? 0).toBeGreaterThan(3000);
    expect(f.series[2]?.watts ?? 0).toBeLessThan(SLOT_W);
    // Full from 11:45 on, so the rest of the morning sits on the export cap.
    expect(f.series[3]?.watts).toBeCloseTo(3000, 6);
  });

  test("the live SOC re-seeding the seam is a percentage of the pack too", async () => {
    activeProfile = profileWith("battery.soc", "load.power");
    medianRows = [{ median: 0 }];
    // Full at sunrise, all but empty now: the reconstructed morning clips on the
    // export cap, then 12:00 hands the sim the measured 1 % — 0.04 kWh — and the
    // afternoon has almost the whole pack to charge into again. Scaling that 1
    // by capacity instead of by a hundred would re-seed a *full* pack and leave
    // the seam invisible, with the afternoon still pinned to the cap.
    poll.reset(liveSample({ "battery.soc": 1 }));
    hourlyRows = [{ bucket: `${localDate()}T09:00:00.000Z`, avg_value: 100 }];
    const f = must(await fetchSolarForecast(clipped()));

    // The past: full pack, nothing to absorb, everything above the cap is lost.
    for (let i = 0; i < 4; i++) expect(slotW(f.series, i)).toBeCloseTo(3000, 6);
    // The seam at 12:00 re-seeds from the live reading, so the surplus is
    // absorbed whole again rather than curtailed.
    expect(slotW(f.series, 4)).toBeCloseTo(SLOT_W, 6);
    expect(slotW(f.series, 5)).toBeCloseTo(SLOT_W, 6);
    // …until that headroom is used up in turn.
    expect(slotW(f.series, 6)).toBeGreaterThan(3000);
    expect(slotW(f.series, 6)).toBeLessThan(SLOT_W);
    expect(slotW(f.series, 7)).toBeCloseTo(3000, 6);
  });

  test("the battery's charge ceiling caps how much surplus it can absorb", async () => {
    activeProfile = profileWith("battery.soc", "load.power");
    poll.reset(liveSample({})); // no live SOC → the simulated state runs the day
    medianRows = [{ median: 0 }];
    hourlyRows = [{ bucket: `${localDate()}T09:00:00.000Z`, avg_value: 0 }];
    // An oversized pack, empty at sunrise: headroom never binds, so the only
    // thing standing between the surplus and the battery is the charge ceiling.
    const f = must(
      await fetchSolarForecast(
        clipped({ battery: { usableKwh: 20, minSoc: 0, maxChargeW: 1000 } }),
      ),
    );
    // Every slot lands on the same ceiling: 3 kW out to the grid plus the 1 kW
    // the pack will take. The remaining ~3.5 kW has nowhere to go and is lost,
    // even though the battery is nearly empty the whole day.
    for (const p of f.series) expect(p.watts).toBeCloseTo(4000, 6);
    expect(SLOT_W).toBeGreaterThan(4000); // the surplus really was curtailed
  });

  test("no rollup covering the first hour leaves the morning at its raw estimate", async () => {
    activeProfile = profileWith("battery.soc", "load.power");
    poll.reset(liveSample({ "battery.soc": 100 }));
    medianRows = [{ median: 0 }];
    hourlyRows = [];
    const f = must(await fetchSolarForecast(clipped()));
    expect(hourlyQueries()).toHaveLength(1);
    for (let i = 0; i < 4; i++) {
      expect(f.series[i]?.watts).toBeCloseTo(f.raw.series[i]?.watts ?? -1, 6);
    }
    // The future still clips off the live reading.
    expect(f.series[7]?.watts).toBeCloseTo(3000, 6);
  });

  test("a measured 0 % day-start SOC is a reading; an unreadable row is not", async () => {
    activeProfile = profileWith("battery.soc", "load.power");
    poll.reset(liveSample({ "battery.soc": 100 }));
    medianRows = [{ median: 0 }];
    const p = clipped({ battery: { usableKwh: 0.5, minSoc: 0 } });

    hourlyRows = [{ bucket: `${localDate()}T09:00:00.000Z`, avg_value: 0 }];
    const empty = must(await fetchSolarForecast(p));
    // Empty at sunrise is knowledge: the morning is simulated, and the half kWh
    // of headroom runs out inside the first slot.
    expect(empty.series[0]?.watts ?? 0).toBeLessThan(empty.raw.series[0]?.watts ?? 0);

    hourlyRows = [{ bucket: `${localDate()}T09:00:00.000Z` }]; // avg column absent
    const unreadable = must(await fetchSolarForecast(p));
    expect(unreadable.series[0]?.watts).toBeCloseTo(unreadable.raw.series[0]?.watts ?? -1, 6);
    // Irradiance came from cache both times; the SOC was re-read on each call.
    expect(urls).toHaveLength(1);
    expect(hourlyQueries()).toHaveLength(2);
  });

  test("a live SOC of 0 % is a real reading, not a missing one", async () => {
    activeProfile = profileWith("battery.soc", "load.power");
    hourlyRows = [];
    const p = clipped({ houseLoadW: 0, battery: { usableKwh: 4, minSoc: 60 } });

    poll.reset(liveSample({ "battery.soc": 0 }));
    const flat = must(await fetchSolarForecast(p));

    // No SOC in the sample at all: the sim falls back to the reserve floor,
    // which leaves far less headroom than an empty pack does.
    poll.reset(liveSample({}));
    const absent = must(await fetchSolarForecast(p));

    // A non-numeric reading is unavailable, exactly like an absent one.
    poll.reset(liveSample({ "battery.soc": Number.NaN }));
    const broken = must(await fetchSolarForecast(p));

    expect(flat.remainingTodayKwh).toBeGreaterThan(absent.remainingTodayKwh);
    expect(broken.remainingTodayKwh).toBeCloseTo(absent.remainingTodayKwh, 9);
    // Only the usable view moves — the raw PV potential is untouched by SOC.
    expect(flat.raw.remainingTodayKwh).toBeCloseTo(absent.raw.remainingTodayKwh, 9);
    expect(urls).toHaveLength(1); // one fetch, three live reads
  });
});

describe("fetchSolarForecast reserve floor", () => {
  beforeEach(resetHarness);
  afterEach(restoreHarness);
  afterAll(restoreHarness);

  /** Dark all morning, full sun all afternoon: the pack drains, then refills. */
  const darkThenSun = () => ({
    utc_offset_seconds: 7200,
    minutely_15: {
      time: SLOT_TIMES.map((t) => `${localDate()}T${t}`),
      temperature_2m: SLOT_TIMES.map(() => 25),
      global_tilted_irradiance_instant: SLOT_TIMES.map((_, i) => (i < 4 ? 0 : 1000)),
    },
  });

  /**
   * A day-start SOC with no live SOC to re-seed from, so the simulated battery
   * state carries across the seam — which is what makes the morning's discharge
   * still visible in the afternoon.
   */
  const afternoon = async (minSoc: number): Promise<number[]> => {
    body = darkThenSun;
    activeProfile = profileWith("battery.soc", "load.power");
    poll.reset(liveSample({})); // no live SOC → nothing to re-seed with
    hourlyRows = [{ bucket: `${localDate()}T09:00:00.000Z`, avg_value: 100 }];
    const f = must(
      await fetchSolarForecast(
        plant({ maxOutputW: 3000, houseLoadW: 2000, battery: { usableKwh: 4, minSoc } }),
      ),
    );
    return watts(f);
  };

  test("a reserve floor the morning may not dig into leaves less room to charge into", async () => {
    const drained = await afternoon(0);
    const reserved = await afternoon(75);

    // 11:00–11:30 are dark, so neither plant produces anything to curtail, and
    // 11:45 is the sunrise ramp both share — the pack states diverge unseen.
    for (let i = 0; i < 3; i++) {
      expect(drained[i]).toBe(0);
      expect(reserved[i]).toBe(0);
    }
    expect(reserved[3]).toBeCloseTo(drained[3] ?? -1, 6);

    // Without a floor the pack covers the 2 kW house load through the whole dark
    // stretch, and the 1.5 kWh of headroom that frees swallows the noon surplus
    // whole — nothing is curtailed.
    expect(drained[4]).toBeCloseTo(SLOT_W, 6);
    // A 75 % floor halts that discharge halfway through, so the pack meets the
    // sun fuller, runs out of headroom sooner, and spills over the export cap.
    expect(reserved[4] ?? 0).toBeLessThan(drained[4] ?? 0);
    expect(reserved[4] ?? 0).toBeGreaterThan(3000);

    // By 12:15 both packs are full, so both settle onto the same ceiling: the
    // house load served behind a 3 kW cap. The floor costs headroom, not output.
    for (let i = 5; i < 8; i++) {
      expect(drained[i]).toBeCloseTo(5000, 6);
      expect(reserved[i]).toBeCloseTo(5000, 6);
    }
  });
});

describe("fetchSolarForecast learned correction", () => {
  beforeEach(resetHarness);
  afterEach(restoreHarness);
  afterAll(restoreHarness);

  const learnedCell = { ratio: 1.4, weight: 100 };

  test("a learned model that is not enabled is never even loaded", async () => {
    activeProfile = profileWith("battery.soc");
    correctionRows = [{ month: 7, hour: 12, ...learnedCell }];
    const f = must(await fetchSolarForecast(plant()));
    expect(queries).toEqual([]);
    expect(f.series[4]?.watts).toBeCloseTo(SLOT_W, 6);
  });

  test("an enabled correction scales only the slots its (month, hour) cell covers", async () => {
    activeProfile = profileWith("battery.soc");
    poll.reset(null); // no live sample → the active profile names the plant
    const month = Number(localDate().slice(5, 7));
    correctionRows = [{ month, hour: 12, ...learnedCell }];

    const f = must(await fetchSolarForecast(plant({ correction: { enabled: true } })));
    const factor = correctionFactor(new Map([[`${month}:12`, learnedCell]]), month, 12);
    expect(factor).toBeGreaterThan(1);

    // 11:00–11:30 carry no cell for hour 11 and pass through untouched.
    expect(f.series[0]?.watts).toBeCloseTo(SLOT_W, 6);
    expect(f.series[2]?.watts).toBeCloseTo(SLOT_W, 6);
    // The correction is applied per *sample*, before slot integration, so the
    // 11:45 slot straddles the boundary: an uncorrected endpoint averaged with
    // a corrected one, instead of a step at the top of the hour.
    expect(f.series[3]?.watts).toBeCloseTo((SLOT_W + SLOT_W * factor) / 2, 6);
    // 12:00 onwards are lifted by the learned factor — in the raw view too, so
    // any clipping downstream is computed on corrected PV.
    expect(f.series[4]?.watts).toBeCloseTo(SLOT_W * factor, 6);
    expect(f.raw.series[7]?.watts).toBeCloseTo(SLOT_W * factor, 6);
  });

  test("an enabled correction with nothing learned yet changes nothing", async () => {
    activeProfile = profileWith("battery.soc");
    correctionRows = [];
    const f = must(await fetchSolarForecast(plant({ correction: { enabled: true } })));
    for (const p of f.series) expect(p.watts).toBeCloseTo(SLOT_W, 6);
  });

  test("without an active profile there is no plant to correct for", async () => {
    activeProfile = null;
    correctionRows = [{ month: 7, hour: 12, ...learnedCell }];
    const f = must(await fetchSolarForecast(plant({ correction: { enabled: true } })));
    expect(queries).toEqual([]);
    for (const p of f.series) expect(p.watts).toBeCloseTo(SLOT_W, 6);
  });
});

describe("representativeHouseLoadW", () => {
  beforeEach(resetHarness);
  afterEach(restoreHarness);
  afterAll(restoreHarness);

  test("the configured load wins over history — including a configured zero", async () => {
    activeProfile = profileWith("load.power");
    medianRows = [{ median: 800 }];
    expect(await representativeHouseLoadW(plant({ houseLoadW: 250 }))).toBe(250);
    expect(await representativeHouseLoadW(plant({ houseLoadW: 0 }))).toBe(0);
    expect(medianQueries()).toEqual([]);
  });

  test("without an active profile there is no load to represent", async () => {
    activeProfile = null;
    medianRows = [{ median: 800 }];
    expect(await representativeHouseLoadW(plant())).toBeNull();
    expect(medianQueries()).toEqual([]);
  });

  test("a plant that maps no load metric reports none, without querying", async () => {
    activeProfile = profileWith("battery.soc");
    medianRows = [{ median: 900 }];
    expect(await representativeHouseLoadW(plant())).toBeNull();
    expect(medianQueries()).toEqual([]);
  });

  test("empty rollups report no load rather than a load of zero", async () => {
    activeProfile = profileWith("load.power");
    medianRows = [];
    expect(await representativeHouseLoadW(plant())).toBeNull();
    expect(medianQueries()).toHaveLength(1);
  });

  test("the median is queried once and reused until its 6-hour TTL lapses", async () => {
    activeProfile = profileWith("load.power");
    medianRows = [{ median: 900 }];
    expect(await representativeHouseLoadW(plant())).toBe(900);
    expect(medianQueries()[0]?.params?.[1]).toBe("test-inverter"); // no live sample

    medianRows = [{ median: 150 }]; // history moves on…
    expect(await representativeHouseLoadW(plant())).toBe(900); // …the cache holds
    expect(medianQueries()).toHaveLength(1);

    setSystemTime(new Date(clockMs + 6 * HOUR)); // exactly the TTL is already stale
    expect(await representativeHouseLoadW(plant())).toBe(150);
    expect(medianQueries()).toHaveLength(2);
  });
});

describe("buildSolarForecast array orientation", () => {
  /**
   * One instantaneous sample with a beam/diffuse split, so the incidence angle
   * (and therefore the array's orientation) actually bites.
   */
  const oriented = (azimuth: number, localTime: string, tilt = 35, tempCoefficient = -0.4) => {
    const data: IrradianceForecast = {
      times: [localTime],
      utcOffsetSeconds: 7200,
      location: { latitude: 48, longitude: 9 },
      temperature: [20],
      gti: [[500]],
      dni: [700],
    };
    const at = Date.parse(`${localTime}:00Z`) - 7200_000;
    const cfg = config({ arrays: [{ kwp: 10, tilt, azimuth }], tempCoefficient });
    return buildSolarForecast(cfg, data, "test", at).series[0]?.watts ?? 0;
  };

  test("an east array leads in the morning and a west array in the afternoon", () => {
    const morning = "2026-07-18T08:00";
    const evening = "2026-07-18T18:00";
    expect(oriented(-90, morning)).toBeGreaterThan(oriented(90, morning));
    expect(oriented(90, evening)).toBeGreaterThan(oriented(-90, evening));
    // The same panels mirrored about solar noon: near-equal, but not exactly —
    // declination and the equation of time both drift across the day.
    const east = oriented(-90, morning);
    const west = oriented(90, evening);
    expect(Math.abs(east - west) / east).toBeLessThan(0.01);
  });

  test("a flat array's output does not depend on the azimuth it is given", () => {
    const at = "2026-07-18T09:00";
    expect(oriented(-90, at, 0)).toBeCloseTo(oriented(90, at, 0), 9);
    expect(oriented(180, at, 0)).toBeCloseTo(oriented(0, at, 0), 9);
  });

  test("a vertical north wall loses the whole beam and keeps only diffuse light", () => {
    const at = "2026-07-18T13:00"; // high summer sun, squarely behind the wall
    const north = oriented(180, at, 90, 0);
    // Beam reflected away entirely; the sky dome's constant modifier survives.
    expect(north).toBeCloseTo(pvPowerW({ gtiWm2: 500 * 0.95, ambientC: 20 }, 10, 0, 14), 6);
    // A roof pointed at that sun collects the beam on top of the same diffuse.
    expect(oriented(0, at, 35, 0)).toBeGreaterThan(north);
    // A *vertical* south wall does not: at 64° elevation the beam hits its glass
    // so glancingly that the IAM costs it more than the diffuse factor costs the
    // north wall — the reason a facade is not a roof.
    expect(oriented(0, at, 90, 0)).toBeLessThan(north);
  });

  test("a steeply tilted array beats a flat one at low winter-style sun", () => {
    const at = "2026-12-18T12:00";
    expect(oriented(0, at, 60)).toBeGreaterThan(oriented(0, at, 0));
  });
});
