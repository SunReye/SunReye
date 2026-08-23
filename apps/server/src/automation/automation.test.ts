import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type AutomationConfig, automationConfigSchema } from "@SunReye/db/automation-config";
import type { AutomationState } from "@SunReye/db/automation-state";
import {
  AUTOMATION_STATE_KEY,
  automationStateSchema,
  defaultAutomationState,
} from "@SunReye/db/automation-state";
import { type SpotPriceConfig, spotPriceConfigSchema } from "@SunReye/db/spot-price-config";
import { spotPricesReady } from "@SunReye/db/spot-price-config";
import { tariffConfigSchema } from "@SunReye/db/tariff";
import { type WeatherConfig, weatherConfigSchema } from "@SunReye/db/weather";
import type { InverterProfile, InverterSample, MetricDef } from "@SunReye/inverter-core";
import type { SolarForecast } from "../forecast/solar-forecast";
import { buildProfileContext } from "../inverter/inverter";
import type { SpotSlice } from "@SunReye/contracts/prices";
import { getAutomationConfig } from "../settings/automation-settings";
import type { AutomationStreamMessage } from "@SunReye/contracts/automation";
import {
  type AutomationModules,
  applyAutomationConfig,
  automationHistory,
  automationPlan,
  automationStatus,
  automationStreamSnapshot,
  buildProductionIO,
  composeAutomationIO,
  startAutomations,
  stopAutomations,
} from "./automation";
import { HISTORY_CAPACITY } from "./automation-history";
import type { AutomationIO } from "./peak-shaving-engine";
import { type Streams, createStreams } from "../shared/streams";

// --- Fixtures ------------------------------------------------------------------

const CHARGE_KEY = "settings.battery.max_charge_current";
const PV_KEY = "pv.power";
const SOC_KEY = "battery.soc";
const VOLT_KEY = "battery.voltage";

/** Noon UTC with a zero plant offset keeps local == UTC in every fixture. */
const NOON = Date.parse("2026-07-25T12:00:00Z");

const metric = (key: string, role: string, writable = false): MetricDef => ({
  key,
  topic: key.replaceAll(".", "/"),
  label: key,
  unit: null,
  group: "test",
  type: "U_WORD",
  addresses: [1],
  binding: { via: "modbus", addr: [1], type: "U_WORD" },
  scale: 1,
  access: writable ? "rw" : "r",
  role: role as MetricDef["role"],
  ...(writable ? { range: { min: 0, max: 185 } } : {}),
});

/** The three roles peak shaving requires, and nothing else. */
const profile: InverterProfile = {
  id: "test-profile",
  name: "Test",
  manufacturer: "Test",
  metrics: [
    metric(CHARGE_KEY, "setting.battery.max_charge_current", true),
    metric(PV_KEY, "pv.total.power"),
    metric(SOC_KEY, "battery.soc"),
    metric(VOLT_KEY, "battery.voltage"),
  ],
};

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

const config = (psOver: object = {}, over: object = {}): AutomationConfig =>
  automationConfigSchema.parse({
    enabled: true,
    disclaimerAcceptedAt: "2026-07-25T00:00:00Z",
    peakShaving: { enabled: true, safetyBufferW: 400, ...psOver },
    ...over,
  });

/** A midday forecast with enough surplus for the decision to have something to do. */
function forecastAt(watts: number[]): SolarForecast {
  const series = watts.map((w, i) => {
    const totalMin = 12 * 60 + i * 15;
    const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
    const mm = String(totalMin % 60).padStart(2, "0");
    return { time: `2026-07-25T${hh}:${mm}`, watts: w, peakWatts: w };
  });
  const raw = {
    series,
    todayKwh: 0,
    remainingTodayKwh: 0,
    tomorrowKwh: 0,
    next15: { maxPowerW: watts[0] ?? 0, avgPowerW: watts[0] ?? 0, energyKwh: 0 },
  };
  return { provider: "test", stepMinutes: 15, utcOffsetSeconds: 0, ...raw, raw };
}

// --- Fake clock + timers -------------------------------------------------------
//
// The loop re-arms at the configured cadence, which the schema floors at 5 s —
// far too long to wait out. `setTimeout` is captured instead, so an "interval
// tick" is a function call and the assertions can be about the *delay* the loop
// asked for rather than about wall-clock timing.

interface Armed {
  delayMs: number;
  run: () => void;
  cancelled: boolean;
}

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let armed: Armed[] = [];

function installFakeTimers(): void {
  globalThis.setTimeout = ((fn: () => void, delayMs = 0) => {
    const entry: Armed = { delayMs, run: fn, cancelled: false };
    armed.push(entry);
    return entry as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((handle: unknown) => {
    if (handle && typeof handle === "object" && "cancelled" in handle) {
      (handle as Armed).cancelled = true;
      return;
    }
    realClearTimeout(handle as Parameters<typeof clearTimeout>[0]);
  }) as unknown as typeof clearTimeout;
}

/** The timers still waiting to fire — the loop keeps at most one. */
const pending = (): Armed[] => armed.filter((a) => !a.cancelled);

/** Let every queued promise chain settle. No wall-clock time passes. */
const settle = (): Promise<void> => new Promise((r) => realSetTimeout(r, 0));

/** Fire the loop's armed timer, as the interval would. */
async function fireTimer(): Promise<void> {
  const next = pending().at(-1);
  if (!next) throw new Error("no timer armed");
  next.cancelled = true;
  next.run();
  await settle();
}

// --- IO harness ----------------------------------------------------------------

interface Harness {
  io: AutomationIO;
  writes: { key: string; value: number }[];
  /**
   * How many times the forecast has been read. The tick reads it once; the plan
   * projection reads it again, so the counter is how a *skipped* projection is
   * observed from outside the engine.
   */
  forecastReads(): number;
  set: {
    config(c: AutomationConfig): void;
    weather(w: WeatherConfig): void;
    forecast(f: SolarForecast | null): void;
    now(ms: number): void;
    /** Age the last poll past the engine's 30 s staleness window. */
    staleSample(): void;
    /** Make the *n*-th config read (1-based) reject, as a lost DB does. */
    failConfigRead(nth: number, message: string): void;
    /** Hold the next config read open until the returned function is called. */
    gateConfigRead(): () => void;
  };
  state(): AutomationState;
}

function harness(over: { config?: AutomationConfig } = {}): Harness {
  const ctx = buildProfileContext(profile);
  let cfg = over.config ?? config();
  let wx = weather();
  let fc: SolarForecast | null = forecastAt([6000, 6000, 6000, 6000]);
  let nowMs = NOON;
  let state: AutomationState = {};
  let reads = 0;
  let failAt: { nth: number; message: string } | null = null;
  let gate: Promise<void> | null = null;
  let forecastReads = 0;
  const writes: { key: string; value: number }[] = [];
  let sample: InverterSample = {
    time: new Date(nowMs).toISOString(),
    inverterId: "test-profile",
    metrics: { [PV_KEY]: 5000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 },
  };

  return {
    io: {
      ctx,
      write: async (key, value) => {
        writes.push({ key, value });
        // Mirror the register readback the next poll would deliver.
        sample.metrics[key] = value;
      },
      getConfig: async () => {
        reads++;
        if (failAt?.nth === reads) throw new Error(failAt.message);
        if (gate) {
          const held = gate;
          gate = null;
          await held;
        }
        return cfg;
      },
      getWeather: async () => wx,
      getForecast: async () => {
        forecastReads++;
        return fc;
      },
      getBaselineLoadW: async () => null,
      getEvcc: () => null,
      getPrices: async () => null,
      getTariff: async () => tariffConfigSchema.parse({}),
      evccCommand: () => {},
      latestSample: () => sample,
      loadState: async () => state,
      saveState: async (next) => {
        state = next;
      },
      now: () => nowMs,
    },
    writes,
    forecastReads: () => forecastReads,
    set: {
      config: (c) => (cfg = c),
      weather: (w) => (wx = w),
      forecast: (f) => (fc = f),
      now: (ms) => {
        nowMs = ms;
        // The poll loop keeps sampling, so the reading follows the clock.
        sample = { ...sample, time: new Date(ms).toISOString() };
      },
      staleSample: () => {
        sample = { ...sample, time: new Date(nowMs - 31_000).toISOString() };
      },
      failConfigRead: (nth, message) => (failAt = { nth, message }),
      gateConfigRead: () => {
        let release = (): void => {};
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        return () => release();
      },
    },
    state: () => state,
  };
}

// --- Stream capture ------------------------------------------------------------

let frames: AutomationStreamMessage[] = [];
/** The bus the loop is started with each test; frames captures its emits. */
let streams: Streams;
/** Detaches the `frames` subscriber — a test can call it to run with none. */
let unsubscribeFrames: () => void = () => {};

beforeEach(async () => {
  await stopAutomations();
  armed = [];
  frames = [];
  streams = createStreams();
  unsubscribeFrames = streams.subscribe("automations", (msg) => frames.push(msg));
  installFakeTimers();
});

afterEach(async () => {
  unsubscribeFrames();
  await stopAutomations();
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

/** Start the loop and let its immediate tick finish. */
async function start(h: Harness): Promise<void> {
  await startAutomations(plant, streams, async () => h.io);
  await settle();
}

// --- Tests ---------------------------------------------------------------------

describe("automation endpoints before the loop is started", () => {
  test("status reports the automation off rather than throwing", () => {
    expect(automationStatus().peakShaving.state).toBe("disabled");
    expect(automationStatus().peakShaving.enabled).toBe(false);
  });

  test("history is empty and carries the ring size the client paints against", () => {
    // Nothing has ticked yet, so the cadence is still the pre-config default.
    expect(automationHistory()).toEqual({
      tickMs: 30_000,
      capacity: HISTORY_CAPACITY,
      peakShaving: [],
    });
  });

  test("the plan is null instead of a fabricated projection", async () => {
    expect(await automationPlan()).toEqual({ peakShaving: null });
  });

  test("a socket opening during onboarding still gets a paintable snapshot", async () => {
    const snapshot = await automationStreamSnapshot();
    expect(snapshot.status.state).toBe("disabled");
    expect(snapshot.history).toEqual([]);
    expect(snapshot.point).toBeNull();
    expect(snapshot.plan).toBeNull();
  });

  test("a config apply before the engine exists is a no-op", async () => {
    await applyAutomationConfig();
    await settle();
    expect(frames).toEqual([]);
    expect(pending()).toEqual([]);
  });
});

describe("automation loop", () => {
  test("starting steers the plant once immediately, before any interval elapses", async () => {
    const h = harness();
    await start(h);

    expect(automationStatus().peakShaving.state).toBe("active");
    expect(h.writes.map((w) => w.key)).toEqual([CHARGE_KEY]);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.status.state).toBe("active");
  });

  test("the loop arms the next tick at the configured control interval", async () => {
    const h = harness({ config: config({ controlIntervalS: 60 }) });
    await start(h);

    expect(pending()).toHaveLength(1);
    expect(pending()[0]?.delayMs).toBe(60_000);
    expect(frames[0]?.tickMs).toBe(60_000);
    expect(automationHistory().tickMs).toBe(60_000);
  });

  test("a changed control interval takes effect on the next arm, without a restart", async () => {
    const h = harness({ config: config({ controlIntervalS: 60 }) });
    await start(h);
    h.set.config(config({ controlIntervalS: 300 }));

    await fireTimer();

    expect(pending()).toHaveLength(1);
    expect(pending()[0]?.delayMs).toBe(300_000);
    expect(frames.at(-1)?.tickMs).toBe(300_000);
  });

  test("only one timer is ever outstanding, so ticks cannot stack up", async () => {
    const h = harness();
    await start(h);
    await fireTimer();
    await fireTimer();

    expect(pending()).toHaveLength(1);
  });

  test("each tick streams the decision it appended, and only once", async () => {
    const h = harness();
    await start(h);
    const first = frames[0]?.point;
    expect(first?.t).toBe(NOON);

    h.set.now(NOON + 60_000);
    await fireTimer();

    expect(frames).toHaveLength(2);
    expect(frames[1]?.point?.t).toBe(NOON + 60_000);
    // The ring is only backfilled on the socket-open snapshot.
    expect(frames[1]?.history).toBeUndefined();
    expect(automationHistory().peakShaving.map((p) => p.t)).toEqual([NOON, NOON + 60_000]);
  });

  test("a tick that decides nothing streams a null point", async () => {
    // No battery capacity configured: the automation is blocked, so the tick
    // has a status to report but no decision to chart.
    const h = harness();
    h.set.weather(weather({ battery: null }));
    await start(h);

    expect(frames).toHaveLength(1);
    expect(frames[0]?.status.state).toBe("blocked");
    expect(frames[0]?.point).toBeNull();
    expect(automationHistory().peakShaving).toEqual([]);
  });

  test("a second decision in the same millisecond is not streamed twice", async () => {
    const h = harness();
    await start(h);
    // The clock does not move, so the new decision carries the streamed `t`.
    await fireTimer();

    expect(frames).toHaveLength(2);
    expect(frames[1]?.point).toBeNull();
    expect(frames[1]?.status.lastTickAt).toBe(new Date(NOON).toISOString());
  });

  test("the plant is never written while the automation is switched off", async () => {
    const h = harness({ config: config({ enabled: false }) });
    await start(h);

    expect(h.writes).toEqual([]);
    expect(frames[0]?.status.state).toBe("simulating");
    // A simulated decision is still charted, so the UI can preview it.
    expect(frames[0]?.point?.shadow).toBe(true);
  });

  test("shadow mode decides and charts but writes nothing", async () => {
    const h = harness({ config: config({ shadowMode: true }) });
    await start(h);

    expect(h.writes).toEqual([]);
    expect(frames[0]?.status.state).toBe("shadow");
    expect(frames[0]?.point?.shadow).toBe(true);
  });

  test("a blocked plant never touches the register", async () => {
    const h = harness();
    h.set.weather(weather({ maxOutputW: null, battery: null }));
    await start(h);
    await fireTimer();

    expect(h.writes).toEqual([]);
    expect(automationStatus().peakShaving.blockers).toEqual([
      { kind: "config", what: "export-limit" },
      { kind: "config", what: "battery" },
    ]);
  });

  test("readings older than the staleness window hold every write", async () => {
    const h = harness();
    h.set.staleSample();
    await start(h);
    await fireTimer();

    expect(h.writes).toEqual([]);
    expect(frames.at(-1)?.status.state).toBe("stale");
    expect(frames.at(-1)?.point).toBeNull();
  });

  test("a tick without a forecast still streams, with no projection", async () => {
    const h = harness();
    h.set.forecast(null);
    await start(h);

    expect(frames[0]?.plan).toBeNull();
    expect(frames[0]?.status.forecastAvailable).toBe(false);
    expect(await automationPlan()).toEqual({ peakShaving: null });
  });

  test("a failed broadcast is logged but keeps the loop armed", async () => {
    const h = harness();
    // The tick reads the config first; the cadence re-read after it is the one
    // that fails, so the decision stands but the frame cannot be built.
    h.set.failConfigRead(2, "database gone");
    await start(h);

    expect(frames).toEqual([]);
    expect(automationStatus().peakShaving.state).toBe("active");
    expect(pending()).toHaveLength(1);

    await fireTimer();
    expect(frames).toHaveLength(1);
    expect(frames[0]?.status.state).toBe("active");
  });

  test("a failed cadence re-read leaves the previous cadence in place", async () => {
    const h = harness({ config: config({ controlIntervalS: 120 }) });
    await start(h);
    h.set.failConfigRead(4, "database gone");

    await fireTimer();

    expect(automationHistory().tickMs).toBe(120_000);
    expect(pending()[0]?.delayMs).toBe(120_000);
  });

  test("a restart mid-tick silences the engine it retired", async () => {
    const h = harness();
    const release = h.set.gateConfigRead();
    void startAutomations(plant, streams, async () => h.io);
    await settle();
    expect(frames).toEqual([]);

    // A second start while the first tick is still in flight.
    const next = harness();
    await start(next);
    expect(frames).toHaveLength(1);

    release();
    await settle();

    // The retired engine finished its tick but must not push a frame.
    expect(frames).toHaveLength(1);
  });

  test("a restart disarms the old loop before the new IO is built", async () => {
    const h = harness();
    await start(h);
    const stale = pending()[0];

    let finishBuild = (): void => {};
    const building = new Promise<void>((resolve) => {
      finishBuild = resolve;
    });
    const next = harness();
    const starting = startAutomations(plant, streams, async () => {
      await building;
      return next.io;
    });
    await settle();

    // Nothing may tick the retired plant wiring while the new IO is assembled.
    expect(stale?.cancelled).toBe(true);
    expect(pending()).toEqual([]);

    finishBuild();
    await starting;
    await settle();
    expect(pending()).toHaveLength(1);
  });

  test("stopping cancels the armed tick", async () => {
    const h = harness();
    await start(h);
    expect(pending()).toHaveLength(1);

    await stopAutomations();

    expect(pending()).toEqual([]);
    expect(automationStatus().peakShaving.state).toBe("disabled");
    expect(automationHistory().peakShaving).toEqual([]);
    expect(await automationPlan()).toEqual({ peakShaving: null });
  });

  test("a stop while a tick is in flight does not re-arm the loop", async () => {
    const h = harness();
    const release = h.set.gateConfigRead();
    void startAutomations(plant, streams, async () => h.io);
    await settle();

    await stopAutomations();
    release();
    await settle();

    expect(pending()).toEqual([]);
    expect(frames).toEqual([]);
  });

  test("a restart re-streams the first decision even at the same timestamp", async () => {
    const h = harness();
    await start(h);
    expect(frames[0]?.point?.t).toBe(NOON);

    await stopAutomations();
    const again = harness();
    await start(again);

    expect(frames).toHaveLength(2);
    expect(frames[1]?.point?.t).toBe(NOON);
  });

  test("without a subscriber the loop still ticks and records", async () => {
    unsubscribeFrames();
    const h = harness();
    await start(h);

    expect(frames).toEqual([]);
    expect(automationStatus().peakShaving.state).toBe("active");
    expect(automationHistory().peakShaving).toHaveLength(1);
    expect(pending()).toHaveLength(1);
  });
});

describe("ticking with nobody watching the automations feed", () => {
  test("the plant is still steered — the broadcast is skipped, never the tick", async () => {
    // The whole point of the short-circuit is that it is a *broadcast*
    // optimisation. An idle instance that stopped writing the charge register
    // because no browser had the page open would leave the battery on whatever
    // the last tick set, silently, until someone looked.
    const h = harness();

    await startAutomations(
      plant,
      streams,
      async () => h.io,
      () => false,
    );
    await settle();

    expect(h.writes).toEqual([{ key: CHARGE_KEY, value: 50 }]);
    expect(automationStatus().peakShaving.state).toBe("active");
    expect(automationHistory().peakShaving).toHaveLength(1);
    // And the loop is still armed at the configured cadence, so it keeps going.
    expect(pending()).toHaveLength(1);
    expect(frames).toEqual([]);
  });

  test("the plan projection — the expensive part — is not computed", async () => {
    // The projection is the reason the short-circuit exists: it re-reads the
    // forecast and models the rest of the day on every control tick.
    const h = harness();
    let watching = true;

    await startAutomations(
      plant,
      streams,
      async () => h.io,
      () => watching,
    );
    await settle();
    const watched = h.forecastReads();

    watching = false;
    h.set.now(NOON + 60_000);
    await fireTimer();
    const unwatched = h.forecastReads() - watched;

    expect(unwatched).toBeLessThan(watched);
    // …but the tick itself still reads the forecast, because it still decides.
    expect(unwatched).toBeGreaterThan(0);
  });

  test("a decision taken while nobody watched is streamed to the viewer that arrives", async () => {
    // The delta framing marks a point as streamed when it goes out. Marking one
    // that was never sent would lose it: the tick that follows the viewer's
    // arrival streams the *newest* point, and the ring is only replayed on the
    // socket-open snapshot.
    const h = harness();
    let watching = false;

    await startAutomations(
      plant,
      streams,
      async () => h.io,
      () => watching,
    );
    await settle();
    expect(frames).toEqual([]);
    expect(automationHistory().peakShaving.map((p) => p.t)).toEqual([NOON]);

    watching = true;
    // The clock does not move, so this tick appends no new decision — the point
    // in the frame can only be the one decided while nobody was listening.
    await fireTimer();

    expect(frames).toHaveLength(1);
    expect(frames[0]?.point?.t).toBe(NOON);
  });

  test("the cadence is still re-read, so a config change lands unwatched", async () => {
    // The tick timer is armed from the cadence read inside the same path the
    // short-circuit lives on. Skipping it too would freeze an idle instance at
    // whatever interval it booted with.
    const h = harness({ config: config({ controlIntervalS: 60 }) });

    await startAutomations(
      plant,
      streams,
      async () => h.io,
      () => false,
    );
    await settle();
    expect(pending()[0]?.delayMs).toBe(60_000);

    h.set.config(config({ controlIntervalS: 300 }));
    await fireTimer();

    expect(pending()[0]?.delayMs).toBe(300_000);
    expect(automationHistory().tickMs).toBe(300_000);
  });
});

describe("hot-applying an automation config change", () => {
  test("the change is picked up immediately instead of on the next interval", async () => {
    const h = harness({ config: config({ controlIntervalS: 60 }) });
    await start(h);
    const armedBefore = pending()[0];

    h.set.config(config({ controlIntervalS: 300 }));
    await applyAutomationConfig();
    await settle();

    expect(armedBefore?.cancelled).toBe(true);
    expect(pending()).toHaveLength(1);
    expect(pending()[0]?.delayMs).toBe(300_000);
    expect(frames).toHaveLength(2);
  });

  test("disabling hands the user's own charge limit back", async () => {
    // Pinned away from the schema default (50 A) so the write below is proven to
    // be *the fallback rate* rather than coincidentally equal to the default.
    const h = harness({ config: config({ fallbackChargeA: 65 }) });
    await start(h);
    // 50 % SOC against a small forecast surplus lands on the fallback rate.
    expect(h.writes).toEqual([{ key: CHARGE_KEY, value: 65 }]);
    // The register the user had set (120 A) is what has to come back.
    expect(h.state()["test-profile:peakShaving"]?.previousValue).toBe(120);
    expect(automationStatus().peakShaving.restorePending).toBe(true);

    h.set.config(config({ enabled: false }));
    await applyAutomationConfig();
    await settle();

    expect(h.writes.at(-1)).toEqual({ key: CHARGE_KEY, value: 120 });
    expect(automationStatus().peakShaving.restorePending).toBe(false);
    expect(h.state()["test-profile:peakShaving"]).toBeUndefined();
  });
});

describe("the socket-open snapshot", () => {
  test("carries the whole ring plus the current status and plan", async () => {
    const h = harness();
    await start(h);
    h.set.now(NOON + 60_000);
    await fireTimer();

    const snapshot = await automationStreamSnapshot();

    expect(snapshot.status.state).toBe("active");
    expect(snapshot.history?.map((p) => p.t)).toEqual([NOON, NOON + 60_000]);
    expect(snapshot.point).toBeNull();
    expect(snapshot.tickMs).toBe(automationHistory().tickMs);
    expect(snapshot.plan).toEqual(await automationPlan().then((p) => p.peakShaving));
  });

  test("does not consume the delta the next tick still has to stream", async () => {
    const h = harness();
    await start(h);
    await automationStreamSnapshot();

    h.set.now(NOON + 60_000);
    await fireTimer();

    expect(frames.at(-1)?.point?.t).toBe(NOON + 60_000);
  });
});

// --- Production IO wiring -------------------------------------------------------

interface RecordingMods {
  mods: AutomationModules;
  reads: string[];
  readArgs: { key: string; schema: unknown; fallback: unknown }[];
  writes: { key: string; value: unknown }[];
  priceZones: string[];
  set: {
    stored(state: AutomationState | null): void;
    spotConfig(config: SpotPriceConfig): void;
  };
}

/** The production module surface, recorded rather than hitting a database. */
function recordingMods(): RecordingMods {
  const reads: string[] = [];
  const readArgs: { key: string; schema: unknown; fallback: unknown }[] = [];
  const writes: { key: string; value: unknown }[] = [];
  const priceZones: string[] = [];
  let stored: AutomationState | null = null;
  let spot = spotPriceConfigSchema.parse({ enabled: true, zone: "DE-LU" });
  return {
    reads,
    readArgs,
    writes,
    priceZones,
    set: {
      stored: (state) => (stored = state),
      spotConfig: (config) => (spot = config),
    },
    mods: {
      getAutomationConfig: async () => config(),
      getWeatherConfig: async () => weather(),
      fetchSolarForecast: async () => null,
      representativeHouseLoadW: async () => null,
      evccSnapshot: () => null,
      evccControl: () => {},
      getTariff: async () => tariffConfigSchema.parse({}),
      getSpotPriceConfig: async () => spot,
      // The real gate, so "off" and "no zone" are proven, not restated.
      spotPricesReady,
      loadSpotSlice: async (zone) => {
        priceZones.push(zone);
        return { zone } as SpotSlice;
      },
      latestSample: () => null,
      readSetting: async (key, schema, fallback) => {
        reads.push(key);
        readArgs.push({ key, schema, fallback });
        return (stored as typeof fallback | null) ?? fallback;
      },
      writeSetting: async (key, value) => {
        writes.push({ key, value });
      },
    },
  };
}

const plant = { ctx: buildProfileContext(profile), write: async () => {} };

describe("production IO wiring", () => {
  test("the persisted snapshot is read once and served from memory after that", async () => {
    const r = recordingMods();
    const io = composeAutomationIO(plant, r.mods);

    const first = await io.loadState();
    const second = await io.loadState();

    expect(r.reads).toEqual([AUTOMATION_STATE_KEY]);
    expect(first).toEqual(defaultAutomationState);
    expect(second).toBe(first);
  });

  test("a missing snapshot row reads as the empty state, not as a failure", async () => {
    const r = recordingMods();
    r.set.stored(null);

    expect(await composeAutomationIO(plant, r.mods).loadState()).toEqual(defaultAutomationState);
    // The validating read is what turns an absent row into the empty state, so
    // the schema and fallback it is handed are the behaviour under test.
    // Identity, not structural equality: the empty state *is* `{}`, so `toEqual`
    // would wave through any bare literal substituted for the shared constant.
    expect(r.readArgs).toHaveLength(1);
    expect(r.readArgs[0]?.key).toBe(AUTOMATION_STATE_KEY);
    expect(r.readArgs[0]?.schema).toBe(automationStateSchema);
    expect(r.readArgs[0]?.fallback).toBe(defaultAutomationState);
  });

  test("a saved snapshot is persisted and refreshes the cache without a re-read", async () => {
    const r = recordingMods();
    const io = composeAutomationIO(plant, r.mods);
    await io.loadState();
    const next: AutomationState = {
      "test-profile:peakShaving": { previousValue: 120, capturedAt: "2026-07-25T12:00:00Z" },
    };

    await io.saveState(next);

    expect(r.writes).toEqual([{ key: AUTOMATION_STATE_KEY, value: next }]);
    expect(await io.loadState()).toBe(next);
    expect(r.reads).toEqual([AUTOMATION_STATE_KEY]);
  });

  test("a stored snapshot survives the restart it was written for", async () => {
    const r = recordingMods();
    const held: AutomationState = {
      "test-profile:peakShaving": { previousValue: 90, capturedAt: "2026-07-25T12:00:00Z" },
    };
    r.set.stored(held);

    expect(await composeAutomationIO(plant, r.mods).loadState()).toEqual(held);
  });

  test("prices are only read for an enabled feed with a zone", async () => {
    const r = recordingMods();
    const io = composeAutomationIO(plant, r.mods);
    expect(await io.getPrices()).toEqual({ zone: "DE-LU" } as SpotSlice);
    expect(r.priceZones).toEqual(["DE-LU"]);

    r.set.spotConfig(spotPriceConfigSchema.parse({ enabled: false, zone: "DE-LU" }));
    expect(await io.getPrices()).toBeNull();

    r.set.spotConfig(spotPriceConfigSchema.parse({ enabled: true, zone: " " }));
    expect(await io.getPrices()).toBeNull();
    // A feed that cannot answer must stay distinguishable from a zero price.
    expect(r.priceZones).toEqual(["DE-LU"]);
  });

  test("the plant, config, forecast and EVCC handles are wired straight through", () => {
    const r = recordingMods();
    const io = composeAutomationIO(plant, r.mods);

    expect(io.ctx).toBe(plant.ctx);
    expect(io.write).toBe(plant.write);
    expect(io.getConfig).toBe(r.mods.getAutomationConfig);
    expect(io.getWeather).toBe(r.mods.getWeatherConfig);
    expect(io.getForecast).toBe(r.mods.fetchSolarForecast);
    expect(io.getBaselineLoadW).toBe(r.mods.representativeHouseLoadW);
    expect(io.getEvcc).toBe(r.mods.evccSnapshot);
    expect(io.evccCommand).toBe(r.mods.evccControl);
    expect(io.getTariff).toBe(r.mods.getTariff);
    expect(io.latestSample).toBe(r.mods.latestSample);
  });

  test("the tick reads the wall clock", () => {
    const io = composeAutomationIO(plant, recordingMods().mods);
    const before = Date.now();
    const now = io.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  test("the production IO binds the real settings and live-sample modules", async () => {
    const write = async () => {};
    const io = await buildProductionIO({ ctx: plant.ctx, write });

    expect(io.getConfig).toBe(getAutomationConfig);
    expect(io.ctx).toBe(plant.ctx);
    expect(io.write).toBe(write);

    // Reads the shared poll state live, rather than capturing it at build time.
    // `liveState.latest` is null until the first poll, so comparing the two
    // nulls would pass just as well against a hard-coded `() => null`. A probe
    // swapped in behind the property is what actually separates the two: a
    // build-time capture would still answer with the pre-swap value. The
    // descriptor is restored so no later suite inherits the probe.
    const { liveState } = await import("../shared/state");
    const original = Object.getOwnPropertyDescriptor(liveState, "latest");
    const probe: InverterSample = {
      time: new Date(NOON).toISOString(),
      inverterId: "probe",
      metrics: { [SOC_KEY]: 42 },
    };
    Object.defineProperty(liveState, "latest", { configurable: true, get: () => probe });
    try {
      expect(io.latestSample()).toBe(probe);
    } finally {
      if (original) Object.defineProperty(liveState, "latest", original);
    }
    expect(io.latestSample()).toBe(liveState.latest);

    expect(io.now()).toBeGreaterThan(0);
  });
});
