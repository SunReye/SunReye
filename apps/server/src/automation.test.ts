import { beforeEach, describe, expect, test } from "bun:test";
import { type AutomationConfig, automationConfigSchema } from "@SunReye/db/automation-config";
import type { AutomationState } from "@SunReye/db/automation-state";
import { type WeatherConfig, weatherConfigSchema } from "@SunReye/db/weather";
import type { InverterProfile, InverterSample, MetricDef } from "@SunReye/inverter-core";
import {
  type AutomationIO,
  type ForecastSlice,
  createPeakShavingEngine,
  decideTargetA,
  evccAutomationInputs,
  resolvePeakShavingBlockers,
  surplusAboveKwh,
  validateAutomationEnable,
} from "./automation";
import type { EvccLoadpoint, EvccState } from "./evcc";
import { buildProfileContext } from "./inverter";
import type { SolarForecast } from "./solar-forecast";

// --- Fixtures ------------------------------------------------------------------

const CHARGE_KEY = "settings.battery.max_charge_current";
const PV_KEY = "pv.power";
const SOC_KEY = "battery.soc";
const VOLT_KEY = "battery.voltage";

const metric = (over: Partial<MetricDef> & { key: string }): MetricDef => ({
  topic: over.key.replaceAll(".", "/"),
  label: over.key,
  unit: null,
  group: "test",
  type: "U_WORD",
  addresses: [1],
  scale: 1,
  access: "r",
  ...over,
});

/** A synthetic profile mapping the peak-shaving roles (charge register 0–185 A). */
function profileWith(roles: Partial<Record<string, string>> = {}): InverterProfile {
  const defaults: Record<string, string> = {
    "setting.battery.max_charge_current": CHARGE_KEY,
    "pv.total.power": PV_KEY,
    "battery.soc": SOC_KEY,
    "battery.voltage": VOLT_KEY,
    ...roles,
  };
  const metrics: MetricDef[] = [];
  for (const [role, key] of Object.entries(defaults)) {
    if (!key) continue;
    metrics.push(
      metric({
        key,
        role: role as MetricDef["role"],
        access: role.startsWith("setting.") ? "rw" : "r",
        ...(role.startsWith("setting.") ? { range: { min: 0, max: 185 } } : {}),
      }),
    );
  }
  return { id: "test-profile", name: "Test", manufacturer: "Test", metrics };
}

const weather = (forecastOver: object = {}): WeatherConfig =>
  weatherConfigSchema.parse({
    enabled: true,
    latitude: 50,
    longitude: 8,
    forecast: {
      enabled: true,
      arrays: [{ kwp: 12, tilt: 30, azimuth: 0 }],
      maxOutputW: 8400,
      battery: { usableKwh: 15 },
      ...forecastOver,
    },
  });

const config = (over: object = {}, psOver: object = {}): AutomationConfig =>
  automationConfigSchema.parse({
    enabled: true,
    disclaimerAcceptedAt: "2026-07-25T00:00:00Z",
    peakShaving: { enabled: true, safetyBufferW: 400, ...psOver },
    ...over,
  });

// Noon UTC with a zero plant offset keeps local == UTC in every fixture.
const NOON = Date.parse("2026-07-25T12:00:00Z");

/** 15-min slots from `startHour`, one entry per watts value. */
function slice(startHour: number, watts: number[], utcOffsetSeconds = 0): ForecastSlice {
  return {
    stepMinutes: 15,
    utcOffsetSeconds,
    series: watts.map((w, i) => {
      const totalMin = startHour * 60 + i * 15;
      const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
      const mm = String(totalMin % 60).padStart(2, "0");
      return { time: `2026-07-25T${hh}:${mm}`, watts: w, peakWatts: w };
    }),
  };
}

function asForecast(view: ForecastSlice, next15MaxW?: number): SolarForecast {
  const first = view.series.find(
    (p) => Date.parse(`${p.time}:00Z`) - view.utcOffsetSeconds * 1000 >= NOON,
  );
  // Only the fields the engine touches are populated; the rest is inert filler.
  const filler = { todayKwh: 0, remainingTodayKwh: 0, tomorrowKwh: 0 };
  const raw = {
    series: view.series,
    ...filler,
    next15: { maxPowerW: next15MaxW ?? first?.watts ?? 0, energyKwh: 0 },
  };
  return {
    provider: "test",
    stepMinutes: view.stepMinutes,
    utcOffsetSeconds: view.utcOffsetSeconds,
    ...raw,
    raw,
  };
}

const baseInputs = {
  mode: "maximize-exports" as const,
  pvW: 5000,
  socPct: 50,
  batteryV: 50,
  exportLimitW: 8000,
  usableKwh: 15,
  maxChargeA: 100,
  fallbackChargeA: 25,
  topBalanceFloorA: 5,
  evChargeW: 0,
  evRemainingKwh: 0,
  forecast: null,
  nowMs: NOON,
};

/** A connected pv-mode loadpoint; override what the case needs. */
const loadpoint = (over: Partial<EvccLoadpoint> = {}): EvccLoadpoint => ({
  index: 1,
  title: null,
  mode: "pv",
  chargePower: 0,
  chargePowerLive: 0,
  chargePowerSource: "measured",
  charging: false,
  connected: true,
  vehicleSoc: null,
  vehicleRange: null,
  vehicleTitle: null,
  sessionEnergy: null,
  chargeRemainingEnergy: null,
  limitSoc: null,
  phasesActive: null,
  ...over,
});

const evccState = (loadpoints: EvccLoadpoint[], reachable = true): EvccState => ({
  reachable,
  loadpoints,
  subtractFromHome: true,
});

// --- surplusAboveKwh -------------------------------------------------------------

describe("surplusAboveKwh", () => {
  test("sums only the energy above the threshold", () => {
    // Four future 15-min slots: 1000 W above the limit for one full hour.
    const view = slice(13, [9000, 9000, 9000, 9000]);
    expect(surplusAboveKwh(view, 8000, NOON)).toBeCloseTo(1, 6);
    expect(surplusAboveKwh(view, 9000, NOON)).toBe(0);
  });

  test("prorates the running slot by the fraction still ahead", () => {
    const view = slice(12, [9000]); // 12:00–12:15, 1000 W above
    const halfway = NOON + 7.5 * 60_000;
    expect(surplusAboveKwh(view, 8000, halfway)).toBeCloseTo(0.125, 6);
  });

  test("ignores past slots and other days", () => {
    const view: ForecastSlice = {
      stepMinutes: 15,
      utcOffsetSeconds: 0,
      series: [
        { time: "2026-07-25T10:00", watts: 20_000, peakWatts: 20_000 }, // past
        { time: "2026-07-26T12:00", watts: 20_000, peakWatts: 20_000 }, // tomorrow
      ],
    };
    expect(surplusAboveKwh(view, 0, NOON)).toBe(0);
  });

  test("respects the plant's UTC offset when bucketing the local day", () => {
    // Plant at UTC+2: local 23:45 of the 25th is 21:45 UTC. At 21:00 UTC the
    // slot is still "today" locally and future — it must count.
    const view = slice(23, [9000], 2 * 3600);
    view.series[0]!.time = "2026-07-25T23:45";
    const nowMs = Date.parse("2026-07-25T21:00:00Z");
    expect(surplusAboveKwh(view, 8000, nowMs)).toBeCloseTo(0.25, 6);
  });
});

// --- decideTargetA ----------------------------------------------------------------

describe("decideTargetA — shared", () => {
  test("near-full holds the top-balance floor, not zero", () => {
    const d = decideTargetA({ ...baseInputs, socPct: 99 }); // 0.15 kWh headroom
    expect(d.targetA).toBe(5);
  });

  test("top-balance floor of zero restores blueprint behavior", () => {
    const d = decideTargetA({ ...baseInputs, socPct: 99, topBalanceFloorA: 0 });
    expect(d.targetA).toBe(0);
  });

  test("no forecast degrades to pure live shaving", () => {
    const d = decideTargetA({ ...baseInputs, pvW: 10_000 });
    expect(d.degraded).toBe(true);
    expect(d.targetA).toBe(Math.ceil(2000 / 50));
    expect(d.surplusAboveLimitKwh).toBeNull();
  });

  test("live shaving is capped at maxChargeA", () => {
    const d = decideTargetA({ ...baseInputs, pvW: 20_000, maxChargeA: 60 });
    expect(d.targetA).toBe(60);
  });

  test("targets are quantized up to 5 A steps (write-churn guard)", () => {
    // 210 W of excess at 50 V is 4.2 A raw → rounds up to the 5 A step, so
    // sub-step PV noise cannot move the target (and the register) every tick.
    const d = decideTargetA({ ...baseInputs, pvW: 8210 });
    expect(d.targetA).toBe(5);
    expect(decideTargetA({ ...baseInputs, pvW: 8260 }).targetA).toBe(10);
  });

  test("battery voltage drives the W→A conversion", () => {
    const at50 = decideTargetA({ ...baseInputs, pvW: 10_000, batteryV: 50 });
    const at400 = decideTargetA({ ...baseInputs, pvW: 10_000, batteryV: 400 });
    expect(at50.targetA).toBe(40);
    expect(at400.targetA).toBe(5);
  });
});

describe("decideTargetA — maximize-exports", () => {
  test("live excess above the limit is absorbed immediately", () => {
    const forecast = slice(13, [0, 0]);
    const d = decideTargetA({ ...baseInputs, pvW: 9500, forecast });
    expect(d.targetA).toBe(Math.ceil(1500 / 50));
    expect(d.thresholdW).toBe(8000);
  });

  test("holds charging when the coming peak alone fills the battery", () => {
    // 8 slots × 2h avg 11000 W → 6 kWh above the 8000 W limit; headroom at
    // 62% SOC is 5.7 kWh < 6 → every kWh is spoken for.
    const forecast = slice(13, Array(8).fill(11_000));
    const d = decideTargetA({ ...baseInputs, socPct: 62, pvW: 4000, forecast });
    expect(d.targetA).toBe(0);
  });

  test("falls back to the configured rate when headroom exceeds the peak", () => {
    // Same peak (6 kWh) but 7.5 kWh headroom at 50% → room to spare.
    const forecast = slice(13, Array(8).fill(11_000));
    const d = decideTargetA({ ...baseInputs, socPct: 50, pvW: 4000, forecast });
    expect(d.targetA).toBe(25);
  });

  test("boundary: room inside the reserve margin still holds", () => {
    // Headroom − surplus = 0.1 kWh, inside the 0.2 kWh margin → hold.
    const forecast = slice(13, Array(8).fill(11_000)); // 6 kWh surplus
    const usableKwh = (6 + 0.1) * 2; // 50% SOC → headroom = 6.1
    const d = decideTargetA({ ...baseInputs, usableKwh, socPct: 50, pvW: 4000, forecast });
    expect(d.targetA).toBe(0);
  });
});

describe("decideTargetA — grid-friendly", () => {
  // A midday bell: ramps 2→12 kW and back over 4 h of 15-min slots.
  const bell = slice(
    12,
    [2, 4, 6, 8, 10, 12, 12, 10, 8, 6, 4, 2].map((kw) => kw * 1000),
  );

  test("threshold search matches surplus to headroom", () => {
    // 4.5 kWh headroom at 70% SOC exceeds the 3 kWh above the limit, so the
    // search must lower the threshold until the surplus fills the battery.
    const inputs = { ...baseInputs, mode: "grid-friendly" as const, socPct: 70, forecast: bell };
    const d = decideTargetA(inputs);
    expect(d.thresholdW).toBeLessThan(inputs.exportLimitW);
    expect(surplusAboveKwh(bell, d.thresholdW, NOON)).toBeCloseTo(4.5, 1);
  });

  test("classic shave when the peak alone overfills the battery", () => {
    const d = decideTargetA({
      ...baseInputs,
      mode: "grid-friendly",
      socPct: 99, // tiny headroom → near-full branch guards first…
      forecast: bell,
    });
    expect(d.targetA).toBe(5); // …so the floor wins
    const d2 = decideTargetA({
      ...baseInputs,
      mode: "grid-friendly",
      usableKwh: 2, // 1 kWh headroom at 50% < surplus above the limit
      forecast: bell,
    });
    expect(d2.thresholdW).toBe(8000);
  });

  test("threshold rises toward the limit as SOC rises", () => {
    const lo = decideTargetA({ ...baseInputs, mode: "grid-friendly", socPct: 50, forecast: bell });
    const hi = decideTargetA({ ...baseInputs, mode: "grid-friendly", socPct: 85, forecast: bell });
    expect(hi.thresholdW).toBeGreaterThan(lo.thresholdW);
  });

  test("charges with everything above the dynamic threshold", () => {
    const inputs = { ...baseInputs, mode: "grid-friendly" as const, socPct: 80, forecast: bell };
    const d = decideTargetA({ ...inputs, pvW: 10_000 });
    expect(d.targetA).toBe(Math.min(100, Math.ceil((10_000 - d.thresholdW) / 50)));
  });

  test("absorbs all PV when the battery dwarfs the remaining day", () => {
    const smallDay = slice(13, [3000, 3000]);
    const d = decideTargetA({
      ...baseInputs,
      mode: "grid-friendly",
      socPct: 10,
      pvW: 3000,
      forecast: smallDay,
    });
    expect(d.thresholdW).toBeLessThan(50);
    expect(d.targetA).toBe(Math.ceil((3000 - d.thresholdW) / 50));
  });
});

// --- EVCC inputs -------------------------------------------------------------------

describe("evccAutomationInputs", () => {
  test("absent or unreachable EVCC degrades to zeros", () => {
    expect(evccAutomationInputs(null)).toEqual({ evChargeW: 0, evRemainingKwh: 0 });
    const state = evccState([loadpoint({ chargePowerLive: 5000 })], false);
    expect(evccAutomationInputs(state)).toEqual({ evChargeW: 0, evRemainingKwh: 0 });
  });

  test("sums live charge power and remaining demand across loadpoints", () => {
    const state = evccState([
      loadpoint({ chargePowerLive: 7000, chargeRemainingEnergy: 12_000 }),
      loadpoint({ index: 2, chargePowerLive: 4000, chargeRemainingEnergy: 3000 }),
    ]);
    expect(evccAutomationInputs(state)).toEqual({ evChargeW: 11_000, evRemainingKwh: 15 });
  });

  test("demand only counts connected loadpoints allowed to charge", () => {
    const state = evccState([
      loadpoint({ mode: "off", chargeRemainingEnergy: 9000 }),
      loadpoint({ index: 2, connected: false, chargeRemainingEnergy: 9000 }),
      loadpoint({ index: 3, mode: null, chargeRemainingEnergy: 9000 }),
      loadpoint({ index: 4, mode: "minpv", chargeRemainingEnergy: 2000 }),
    ]);
    expect(evccAutomationInputs(state)).toEqual({ evChargeW: 0, evRemainingKwh: 2 });
  });
});

describe("decideTargetA — EV interplay", () => {
  // Same midday bell as the grid-friendly suite: 2→12 kW and back, 15-min slots.
  const bell = slice(
    12,
    [2, 4, 6, 8, 10, 12, 12, 10, 8, 6, 4, 2].map((kw) => kw * 1000),
  );

  test("live EV draw is subtracted before shaving", () => {
    const forecast = slice(13, [0, 0]);
    const without = decideTargetA({ ...baseInputs, pvW: 9500, forecast });
    const withEv = decideTargetA({ ...baseInputs, pvW: 9500, evChargeW: 1500, forecast });
    expect(without.targetA).toBe(30);
    // The car already absorbs the whole excess → nothing to shave; small
    // remaining day + full headroom → fallback charging instead.
    expect(withEv.targetA).toBe(25);
  });

  test("EV demand frees held headroom for fallback charging", () => {
    // 6 kWh above the limit vs 5.7 kWh headroom at 62% → hold without the car.
    const forecast = slice(13, Array(8).fill(11_000));
    const inputs = { ...baseInputs, socPct: 62, pvW: 4000, forecast };
    expect(decideTargetA(inputs).targetA).toBe(0);
    // The car will eat 2 kWh of that peak → room to spare → fallback rate.
    expect(decideTargetA({ ...inputs, evRemainingKwh: 2 }).targetA).toBe(25);
  });

  test("grid-friendly lowers the plateau to cover the car's cut", () => {
    const inputs = { ...baseInputs, mode: "grid-friendly" as const, socPct: 70, forecast: bell };
    const without = decideTargetA(inputs);
    const withEv = decideTargetA({ ...inputs, evRemainingKwh: 1.5 });
    // Battery headroom AND the car must fill from above the threshold.
    expect(withEv.thresholdW).toBeLessThan(without.thresholdW);
    expect(surplusAboveKwh(bell, withEv.thresholdW, NOON)).toBeCloseTo(4.5 + 1.5, 1);
  });

  test("grid-friendly EV demand can turn a classic shave into a bisect", () => {
    // 2.7 kWh headroom at 82% < 3 kWh surplus → classic shave without the car.
    const inputs = { ...baseInputs, mode: "grid-friendly" as const, socPct: 82, forecast: bell };
    expect(decideTargetA(inputs).thresholdW).toBe(8000);
    expect(decideTargetA({ ...inputs, evRemainingKwh: 1 }).thresholdW).toBeLessThan(8000);
  });

  test("grid-friendly charges with what the car leaves above the threshold", () => {
    // 2.25 kWh headroom at 85% < 3 kWh surplus → classic shave at the limit.
    const inputs = {
      ...baseInputs,
      mode: "grid-friendly" as const,
      socPct: 85,
      pvW: 12_000,
      forecast: bell,
    };
    expect(decideTargetA(inputs).targetA).toBe(80); // (12000−8000)/50
    expect(decideTargetA({ ...inputs, evChargeW: 1000 }).targetA).toBe(60); // car takes 1 kW
  });
});

// --- Blockers + enable guard -----------------------------------------------------

describe("resolvePeakShavingBlockers", () => {
  test("all mapped and configured → no blockers", () => {
    expect(resolvePeakShavingBlockers(profileWith(), weather())).toEqual([]);
  });

  test.each(["setting.battery.max_charge_current", "pv.total.power", "battery.soc"] as const)(
    "missing role %s blocks",
    (role) => {
      const profile = profileWith({ [role]: undefined });
      expect(resolvePeakShavingBlockers(profile, weather())).toEqual([{ kind: "role", role }]);
    },
  );

  test("battery.voltage is optional", () => {
    const profile = profileWith({ "battery.voltage": undefined });
    expect(resolvePeakShavingBlockers(profile, weather())).toEqual([]);
  });

  test("missing plant config blocks", () => {
    expect(resolvePeakShavingBlockers(profileWith(), weather({ maxOutputW: null }))).toEqual([
      { kind: "config", what: "export-limit" },
    ]);
    expect(resolvePeakShavingBlockers(profileWith(), weather({ battery: null }))).toEqual([
      { kind: "config", what: "battery" },
    ]);
  });
});

describe("validateAutomationEnable", () => {
  test("master enable without accepted disclaimer is rejected", () => {
    const cfg = config({ disclaimerAcceptedAt: null }, { enabled: false });
    expect(validateAutomationEnable(cfg, profileWith(), weather())?.error).toContain("disclaimer");
  });

  test("peak shaving without the master gate is rejected", () => {
    const cfg = config({ enabled: false, disclaimerAcceptedAt: null });
    expect(validateAutomationEnable(cfg, profileWith(), weather())?.error).toContain("master");
  });

  test("peak shaving with blockers is rejected and carries them", () => {
    const result = validateAutomationEnable(config(), profileWith(), weather({ battery: null }));
    expect(result?.blockers).toEqual([{ kind: "config", what: "battery" }]);
  });

  test("no active profile is rejected", () => {
    expect(validateAutomationEnable(config(), null, weather())?.error).toContain("profile");
  });

  test("valid enables pass", () => {
    expect(validateAutomationEnable(config(), profileWith(), weather())).toBeNull();
    const offCfg = config({ enabled: false, disclaimerAcceptedAt: null }, { enabled: false });
    expect(validateAutomationEnable(offCfg, null, weather())).toBeNull();
  });
});

// --- Engine tick state machine ----------------------------------------------------

interface Harness {
  io: AutomationIO;
  writes: { key: string; value: number }[];
  set: {
    config(c: AutomationConfig): void;
    weather(w: WeatherConfig): void;
    forecast(f: SolarForecast | null): void;
    evcc(state: EvccState | null): void;
    sample(metrics: Record<string, number>, ageMs?: number): void;
    now(ms: number): void;
    state(s: AutomationState): void;
  };
  state(): AutomationState;
}

function harness(over: { config?: AutomationConfig } = {}): Harness {
  const ctx = buildProfileContext(profileWith());
  let cfg = over.config ?? config();
  let wx = weather();
  let fc: SolarForecast | null = asForecast(slice(12, [6000, 6000, 6000, 6000]));
  let ev: EvccState | null = null;
  let nowMs = NOON;
  let sample: InverterSample | null = null;
  let state: AutomationState = {};
  const writes: { key: string; value: number }[] = [];

  const setSample = (metrics: Record<string, number>, ageMs = 0) => {
    sample = {
      time: new Date(nowMs - ageMs).toISOString(),
      inverterId: "test-profile",
      metrics,
    };
  };
  setSample({ [PV_KEY]: 5000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });

  return {
    io: {
      ctx,
      write: async (key, value) => {
        writes.push({ key, value });
        // Mirror the register readback the next poll would deliver.
        if (sample) sample.metrics[key] = value;
      },
      getConfig: async () => cfg,
      getWeather: async () => wx,
      getForecast: async () => fc,
      getEvcc: () => ev,
      latestSample: () => sample,
      loadState: async () => state,
      saveState: async (next) => {
        state = next;
      },
      now: () => nowMs,
    },
    writes,
    set: {
      config: (c) => (cfg = c),
      weather: (w) => (wx = w),
      forecast: (f) => (fc = f),
      evcc: (state) => (ev = state),
      sample: setSample,
      now: (ms) => (nowMs = ms),
      state: (s) => (state = s),
    },
    state: () => state,
  };
}

describe("peak-shaving engine", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  test("activation snapshots the user value, then steers", async () => {
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.state).toBe("active");
    expect(status.restorePending).toBe(true);
    expect(h.state()["test-profile:peakShaving"]?.previousValue).toBe(120);
    // 50% SOC, small forecast surplus → fallback rate (default 50 A).
    expect(h.writes).toEqual([{ key: CHARGE_KEY, value: 50 }]);
  });

  test("writes only on change", async () => {
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    await engine.tick();
    await engine.tick();
    expect(h.writes).toHaveLength(1);
  });

  test("re-asserts after an external register edit and flags the override", async () => {
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    h.set.sample({ [PV_KEY]: 5000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 80 });
    const status = await engine.tick();
    expect(status.externalOverride).toBe(true);
    expect(h.writes).toHaveLength(2);
    expect(h.writes[1]).toEqual({ key: CHARGE_KEY, value: 50 });
  });

  test("stale sample halts all writes", async () => {
    const engine = createPeakShavingEngine(h.io);
    h.set.sample({ [PV_KEY]: 5000, [SOC_KEY]: 50, [CHARGE_KEY]: 120 }, 60_000);
    const status = await engine.tick();
    expect(status.state).toBe("stale");
    expect(h.writes).toHaveLength(0);
    expect(h.state()).toEqual({});
  });

  test("missing sample metrics halt writes", async () => {
    const engine = createPeakShavingEngine(h.io);
    h.set.sample({ [SOC_KEY]: 50 });
    expect((await engine.tick()).state).toBe("stale");
    expect(h.writes).toHaveLength(0);
  });

  test("night gate restores and idles, and re-activates at dawn", async () => {
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    expect(h.writes).toHaveLength(1);
    // Sun gone: PV 0 and nothing imminent in the forecast.
    h.set.sample({ [PV_KEY]: 0, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 50 });
    h.set.forecast(asForecast(slice(12, [0, 0, 0, 0]), 0));
    const night = await engine.tick();
    expect(night.state).toBe("idle");
    expect(h.writes[1]).toEqual({ key: CHARGE_KEY, value: 120 }); // restored
    expect(h.state()).toEqual({});
    // Dawn: PV still 0 but the next 15 min promise output → take over again.
    h.set.forecast(asForecast(slice(12, [500, 3000, 6000, 6000]), 500));
    const dawn = await engine.tick();
    expect(dawn.state).toBe("active");
    expect(h.state()["test-profile:peakShaving"]?.previousValue).toBe(120);
  });

  test("disable restores the snapshot and releases", async () => {
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    h.set.config(config({}, { enabled: false }));
    const status = await engine.tick();
    expect(status.state).toBe("disabled");
    expect(status.restorePending).toBe(false);
    expect(h.writes[1]).toEqual({ key: CHARGE_KEY, value: 120 });
    expect(h.state()).toEqual({});
  });

  test("master gate off makes the engine fully inert", async () => {
    h.set.config(config({ enabled: false }));
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.state).toBe("disabled");
    expect(status.enabled).toBe(false);
    expect(h.writes).toHaveLength(0);
  });

  test("blocked mid-run restores and reports the blockers", async () => {
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    h.set.weather(weather({ maxOutputW: null }));
    const status = await engine.tick();
    expect(status.state).toBe("blocked");
    expect(status.blockers).toEqual([{ kind: "config", what: "export-limit" }]);
    expect(h.writes[1]).toEqual({ key: CHARGE_KEY, value: 120 });
    await engine.tick();
    expect(h.writes).toHaveLength(2); // no further writes while blocked
  });

  test("a persisted snapshot survives a restart without re-capture", async () => {
    const first = createPeakShavingEngine(h.io);
    await first.tick();
    expect(h.state()["test-profile:peakShaving"]?.previousValue).toBe(120);
    // "Restart": new engine over the same persisted state; the register now
    // holds the automation's own value (50), which must NOT become the snapshot.
    const second = createPeakShavingEngine(h.io);
    await second.tick();
    expect(h.state()["test-profile:peakShaving"]?.previousValue).toBe(120);
  });

  test("failed restore keeps the snapshot for a retry", async () => {
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    const originalWrite = h.io.write;
    h.io.write = async () => {
      throw new Error("modbus timeout");
    };
    h.set.config(config({}, { enabled: false }));
    const failed = await engine.tick();
    expect(failed.lastError).toContain("modbus timeout");
    expect(h.state()["test-profile:peakShaving"]?.previousValue).toBe(120);
    h.io.write = originalWrite;
    const retried = await engine.tick();
    expect(retried.restorePending).toBe(false);
    expect(h.state()).toEqual({});
  });

  test("target respects the register's own bounds", async () => {
    // 30 kW of PV at 50 V wants 432 A; maxChargeA 500 lets it through to the
    // register clamp (0–185 A from the profile range).
    h.set.config(config({}, { maxChargeA: 500 }));
    h.set.sample({ [PV_KEY]: 30_000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.targetA).toBe(185);
    expect(h.writes[0]).toEqual({ key: CHARGE_KEY, value: 185 });
  });

  test("nominal voltage is used when the voltage metric is absent", async () => {
    h.set.config(config({}, { nominalBatteryV: 100 }));
    h.set.sample({ [PV_KEY]: 18_000, [SOC_KEY]: 50, [CHARGE_KEY]: 120 });
    const engine = createPeakShavingEngine(h.io);
    // Live excess 18000 − 8000 = 10000 W at 100 V nominal → 100 A.
    const status = await engine.tick();
    expect(status.targetA).toBe(100);
  });

  test("a charging car shrinks the shave target and shows in the status", async () => {
    // 3 kW of excess without the car → 60 A; the car eats all of it → the
    // battery falls back to the configured rate instead.
    h.set.sample({ [PV_KEY]: 11_000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    h.set.evcc(evccState([loadpoint({ chargePowerLive: 3000, charging: true })]));
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.evChargeW).toBe(3000);
    expect(status.liveExcessW).toBe(0);
    expect(h.writes[0]).toEqual({ key: CHARGE_KEY, value: 50 });
  });

  test("unreachable EVCC is ignored (pre-EVCC behavior)", async () => {
    h.set.sample({ [PV_KEY]: 11_000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    h.set.evcc(evccState([loadpoint({ chargePowerLive: 3000, charging: true })], false));
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.evChargeW).toBeNull();
    expect(h.writes[0]).toEqual({ key: CHARGE_KEY, value: 60 });
  });

  test("forecast outage degrades to live-only shaving", async () => {
    h.set.forecast(null);
    h.set.sample({ [PV_KEY]: 10_000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.forecastAvailable).toBe(false);
    expect(status.state).toBe("active");
    expect(h.writes[0]).toEqual({ key: CHARGE_KEY, value: 40 }); // (10000−8000)/50
  });
});
