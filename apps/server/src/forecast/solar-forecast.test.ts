import { describe, expect, test } from "bun:test";
import { solarForecastConfigSchema } from "@SunReye/db/weather";
import { type CorrectionModel, correctionFactor } from "./forecast-correction";
import { pvPowerW } from "./pv-model";
import { type IrradianceForecast, buildSolarForecast, toForecastExport } from "./solar-forecast";

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
