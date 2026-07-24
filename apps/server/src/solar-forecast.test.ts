import { describe, expect, test } from "bun:test";
import { solarForecastConfigSchema } from "@SunReye/db/weather";
import { type IrradianceForecast, buildSolarForecast, pvPowerW } from "./solar-forecast";

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
    expect(f.hourly).toHaveLength(3);
    expect(f.todayKwh).toBeGreaterThan(f.remainingTodayKwh);
    // Remaining keeps the running hour: only the 12:00 slot counts.
    expect(f.remainingTodayKwh).toBeCloseTo((f.hourly[1]?.watts ?? -1) / 1000, 6);
    expect(f.tomorrowKwh).toBeCloseTo((f.hourly[2]?.watts ?? -1) / 1000, 6);
  });

  test("prorates the running hour by the fraction still ahead", () => {
    // Local 12:30 → half of the 12:00 slot remains.
    const f = buildSolarForecast(config(), data, "test", Date.parse("2026-07-18T10:30:00Z"));
    expect(f.remainingTodayKwh).toBeCloseTo(((f.hourly[1]?.watts ?? -1) / 1000) * 0.5, 6);
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
    expect(f.hourly[1]?.watts ?? 0).toBeGreaterThan(single.hourly[1]?.watts ?? Infinity);
  });

  test("missing gti entries count as zero rather than crashing", () => {
    const sparse: IrradianceForecast = { ...data, gti: [] };
    const f = buildSolarForecast(config(), sparse, "test", nowMs);
    expect(f.todayKwh).toBe(0);
  });

  test("next15 reports the running hour's power and its quarter-hour energy", () => {
    const f = buildSolarForecast(config(), data, "test", nowMs);
    const noon = f.hourly[1]?.watts ?? 0;
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
    expect(f.hourly[0]?.watts).toBeCloseTo((p(800) + p(400)) / 2, 6);
    expect(f.hourly[1]?.watts).toBeCloseTo((p(400) + p(100)) / 2, 6);
    expect(f.hourly[2]?.watts).toBeCloseTo((p(100) + p(0)) / 2, 6);
    expect(f.hourly[3]?.watts).toBeCloseTo(p(0), 6);
    // The whole point: the 16:00 bar is pulled below its start-of-hour sample,
    // instead of over-reporting the descending limb.
    expect(f.hourly[0]?.watts ?? Infinity).toBeLessThan(p(800));
  });

  test("non-adjacent samples are not averaged across the gap", () => {
    // The default `data` fixture is sparse (4 h / 24 h gaps): each hour must keep
    // its own instantaneous estimate rather than trapezoid across the gap.
    const f = buildSolarForecast(config(), data, "test", nowMs);
    const p = (g: number, t: number) => pvPowerW({ gtiWm2: g, ambientC: t }, 10, -0.4, 14);
    expect(f.hourly[1]?.watts).toBeCloseTo(p(800, 25), 6);
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
    expect(withDni.hourly[0]?.watts ?? Infinity).toBeLessThan(plain.hourly[0]?.watts ?? 0);
  });

  test("wind series activates Faiman cooling: a windy hour outproduces a calm one", () => {
    const calm = buildSolarForecast(
      config(),
      { ...data, windSpeed: [0.5, 0.5, 0.5] },
      "test",
      nowMs,
    );
    const windy = buildSolarForecast(config(), { ...data, windSpeed: [8, 8, 8] }, "test", nowMs);
    expect(windy.hourly[1]?.watts ?? 0).toBeGreaterThan(calm.hourly[1]?.watts ?? Infinity);
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
  const raw = buildSolarForecast(config(), sun, "test", now).hourly.map((h) => h.watts);

  test("no clipping config leaves output identical to the raw estimate", () => {
    const f = buildSolarForecast(config(), sun, "test", now, {
      startSocPct: 40,
      houseLoadW: 500,
    });
    expect(f.hourly.map((h) => h.watts)).toEqual(raw);
  });

  test("battery soaks up surplus, then output clips to the feed-in cap", () => {
    const clip = config({ maxOutputW: 3000, battery: { usableKwh: 5, minSoc: 0 } });
    const f = buildSolarForecast(clip, sun, "test", now, { startSocPct: 0, houseLoadW: 0 });
    // Hour 1: 5 kWh headroom absorbs the above-cap surplus → no curtailment.
    expect(f.hourly[0]?.watts).toBeCloseTo(raw[0] ?? 0, 6);
    // Battery now full + no load → later hours clip to the 3 kW export cap.
    expect(f.hourly[1]?.watts).toBeCloseTo(3000, 6);
    expect(f.hourly[2]?.watts).toBeCloseTo(3000, 6);
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
    expect(withLoad.hourly[0]?.watts ?? 0).toBeGreaterThan(noLoad.hourly[0]?.watts ?? 0);
    expect(withLoad.hourly[0]?.watts).toBeCloseTo(3000 + 2000, 6);
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
    const rawNoon = buildSolarForecast(config(), twoDay, "test", at).hourly[3]?.watts ?? 0;
    // Battery started full but 4 kWh drained overnight, so day-2 noon has headroom
    // again and its usable output beats a full-battery (immediately clipping) day.
    expect(f.hourly[1]?.watts).toBe(0); // dark hour, all load from battery
    expect(f.hourly[3]?.watts ?? 0).toBeGreaterThan(3000 + 2000);
    expect(f.hourly[3]?.watts ?? 0).toBeLessThanOrEqual(rawNoon + 1e-6);
  });
});
