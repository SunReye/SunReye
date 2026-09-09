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
import { entityConstraint, instanceFromProfile } from "@SunReye/inverter-core";
import type { SpotSlice } from "@SunReye/contracts/prices";
import { getAutomationConfig } from "../settings/automation-settings";
import type { AutomationStreamMessage, PeakShavingStatus } from "@SunReye/contracts/automation";
import {
  type AutomationModules,
  applyAutomationConfig,
  automationPlan,
  automationStatus,
  automationStreamSnapshot,
  buildProductionIO,
  composeAutomationIO,
  startAutomations,
  stopAutomations,
} from "./automation";
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

/**
 * The same plant with a watt-denominated battery limit — Victron ESS, SMA and
 * every device whose charge ceiling is set in power rather than current. Same
 * register key, so the fixture's live readback needs no special case.
 */
const powerLimitProfile = (): InverterProfile => ({
  id: "test-profile",
  name: "Test",
  manufacturer: "Test",
  metrics: [
    {
      ...metric(CHARGE_KEY, "setting.battery.max_charge_power", true),
      unit: "W",
      range: { min: 0, max: 15_000 },
    },
    metric(PV_KEY, "pv.total.power"),
    metric(SOC_KEY, "battery.soc"),
    metric(VOLT_KEY, "battery.voltage"),
  ],
});

/** The plant's one registered device — `devices.slug`, never a profile id. */
const DEVICE_ID = "inv-1";

/** The registry's instance for a profile, plus the register-bounds seam beside it. */
const plantOf = (p: InverterProfile) => {
  const ctx = buildProfileContext(p);
  return {
    device: instanceFromProfile({
      id: DEVICE_ID,
      deviceClass: "inverter" as const,
      integration: "profile",
      profile: p,
    }),
    constraint: (key: string) => {
      const def = ctx.defByKey.get(key);
      return def ? entityConstraint(def) : null;
    },
  };
};

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
  /**
   * Every decision the loop handed to the write seam, in order — the optimizer's
   * path to `metrics_raw`, which is where a decision lives now.
   */
  decisions: { status: PeakShavingStatus; at: Date }[];
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

function harness(over: { config?: AutomationConfig; profile?: InverterProfile } = {}): Harness {
  const steered = plantOf(over.profile ?? profile);
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
  const decisions: Harness["decisions"] = [];
  let sample: InverterSample = {
    time: new Date(nowMs).toISOString(),
    inverterId: "test-profile",
    metrics: { [PV_KEY]: 5000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 },
  };

  return {
    io: {
      ...steered,
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
      // No pack row states a voltage, so these cases keep resolving down the
      // legacy chain they were written against.
      getPackNominalV: async () => null,
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
      // Snapshotted BY VALUE: the engine mutates its status in place, so a
      // consumer holding the reference would read every later tick's numbers.
      recordDecision: async (status, _localSinkW, at) => {
        decisions.push({ status: { ...status }, at });
      },
    },
    writes,
    decisions,
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

  test("the plan is null instead of a fabricated projection", async () => {
    expect(await automationPlan()).toEqual({ peakShaving: null });
  });

  test("a socket opening during onboarding still gets a paintable snapshot", async () => {
    const snapshot = await automationStreamSnapshot();
    expect(snapshot.status.state).toBe("disabled");
    expect(snapshot.plan).toBeNull();
    // Nothing has ticked, so the cadence is still the pre-config default.
    expect(snapshot.tickMs).toBe(30_000);
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

  test("a watt-denominated plant is steered in watts", async () => {
    // The decision stays in amps — it is sized from the pack, and the config's
    // limits are amps — so the *write* converts at the measured pack voltage.
    // 50 A on a 50 V pack is 2500 W.
    const h = harness({ profile: powerLimitProfile() });
    await start(h);

    expect(h.writes).toEqual([{ key: CHARGE_KEY, value: 2500 }]);
    // The reported plan is still the amps figure the engine decided.
    expect(automationStatus().peakShaving.targetA).toBe(50);
  });

  test("a watt-denominated register is clamped in its own unit", async () => {
    // A 0–185 clamp would have cut 2500 W down to 185 W — the current register's
    // bounds have no meaning for a power register.
    const h = harness({ profile: powerLimitProfile() });
    await start(h);

    expect(h.writes.at(-1)?.value).toBeGreaterThan(185);
  });

  test("the loop arms the next tick at the configured control interval", async () => {
    const h = harness({ config: config({ controlIntervalS: 60 }) });
    await start(h);

    expect(pending()).toHaveLength(1);
    expect(pending()[0]?.delayMs).toBe(60_000);
    expect(frames[0]?.tickMs).toBe(60_000);
    expect((await automationStreamSnapshot()).tickMs).toBe(60_000);
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

  test("each tick streams the live picture, and the decision goes to the writer", async () => {
    // The frame carries STATUS and PLAN only — the two things a hypertable must
    // never hold. What the tick decided went to the write seam instead of into a
    // ring the frame then had to replay.
    const h = harness();
    await start(h);
    expect(frames[0]?.status.state).toBe("active");
    expect(h.decisions.map((d) => d.at.getTime())).toEqual([NOON]);

    h.set.now(NOON + 60_000);
    await fireTimer();

    expect(frames).toHaveLength(2);
    expect(h.decisions.map((d) => d.at.getTime())).toEqual([NOON, NOON + 60_000]);
  });

  test("a tick that decides nothing records nothing, and still streams its status", async () => {
    // No battery capacity configured: the automation is blocked, so the tick
    // has a status to report but no decision. A gap in the series is the truth
    // about it, and a row saying "0 A" would not be.
    const h = harness();
    h.set.weather(weather({ battery: null }));
    await start(h);

    expect(frames).toHaveLength(1);
    expect(frames[0]?.status.state).toBe("blocked");
    expect(h.decisions).toEqual([]);
  });

  test("the plant is never written while the automation is switched off", async () => {
    const h = harness({ config: config({ enabled: false }) });
    await start(h);

    expect(h.writes).toEqual([]);
    expect(frames[0]?.status.state).toBe("simulating");
    // A simulated decision is still recorded, so the preview has a history.
    expect(h.decisions[0]?.status.state).toBe("simulating");
  });

  test("shadow mode decides and charts but writes nothing", async () => {
    const h = harness({ config: config({ shadowMode: true }) });
    await start(h);

    expect(h.writes).toEqual([]);
    expect(frames[0]?.status.state).toBe("shadow");
    expect(h.decisions[0]?.status.state).toBe("shadow");
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
    // A stale tick decided nothing, so it stored nothing: a gap in the series is
    // the truth about it.
    expect(h.decisions).toEqual([]);
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

    expect((await automationStreamSnapshot()).tickMs).toBe(120_000);
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

  test("a restart records its first decision again, even at the same timestamp", async () => {
    // The dedupe this replaced lived in the STREAM: a module global remembering
    // which decision had gone out, which a restart had to clear or the first
    // tick after it went missing. Storage has no such memory to get wrong — a
    // decision is a row, and a restart writes rows exactly as before it.
    const h = harness();
    await start(h);
    expect(h.decisions.map((d) => d.at.getTime())).toEqual([NOON]);

    await stopAutomations();
    const again = harness();
    await start(again);

    expect(again.decisions.map((d) => d.at.getTime())).toEqual([NOON]);
    expect(frames).toHaveLength(2);
  });

  test("without a subscriber the loop still ticks and records", async () => {
    unsubscribeFrames();
    const h = harness();
    await start(h);

    expect(frames).toEqual([]);
    expect(automationStatus().peakShaving.state).toBe("active");
    expect(h.decisions).toHaveLength(1);
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
    expect(h.decisions).toHaveLength(1);
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

  test("a decision taken while nobody watched is STORED, and the viewer reads it back", async () => {
    // The delta framing this replaced was the fragile part: a module global
    // marked a decision streamed when it went out, and one marked but never sent
    // was lost, because the next frame only ever carried the newest. Storage has
    // no audience: every decision is written whether or not a browser is open,
    // and the page that opens an hour later reads them from `/api/history`.
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
    expect(h.decisions.map((d) => d.at.getTime())).toEqual([NOON]);

    watching = true;
    await fireTimer();

    // The viewer's first frame is the live picture; the decision behind it was
    // already history before they arrived.
    expect(frames).toHaveLength(1);
    expect(frames[0]?.status.state).toBe("active");
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
    expect((await automationStreamSnapshot()).tickMs).toBe(300_000);
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
    expect(h.state()[`${DEVICE_ID}:peakShaving`]?.previousValue).toBe(120);
    expect(automationStatus().peakShaving.restorePending).toBe(true);

    h.set.config(config({ enabled: false }));
    await applyAutomationConfig();
    await settle();

    expect(h.writes.at(-1)).toEqual({ key: CHARGE_KEY, value: 120 });
    expect(automationStatus().peakShaving.restorePending).toBe(false);
    expect(h.state()[`${DEVICE_ID}:peakShaving`]).toBeUndefined();
  });
});

describe("the socket-open snapshot", () => {
  test("carries the current status and plan — and no decision backfill", async () => {
    const h = harness();
    await start(h);
    h.set.now(NOON + 60_000);
    await fireTimer();

    const snapshot = await automationStreamSnapshot();

    expect(snapshot.status.state).toBe("active");
    expect(snapshot.plan).toEqual(await automationPlan().then((p) => p.peakShaving));
    // ONE VARIANT. There is nothing on this frame a later frame omits, so a
    // client never has to sniff which kind it is holding: the decisions it used
    // to replay are in `metrics_raw`, under the `optimizer` device slug.
    expect(Object.keys(snapshot).sort()).toEqual(["plan", "status", "tickMs"]);
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
      packNominalV: async () => 48,
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
      // The plant's one device, running the fixture profile — the binding the
      // one-time state re-key adopts a 1.x blob by.
      deviceProfileBindings: () => [{ deviceId: "inv-1", profileId: profile.id }],
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

const plant = { ...plantOf(profile), write: async () => {} };

/** Capture stamp for the stored-blob fixtures; the migration never reads it. */
const CAPTURED = "2026-07-25T12:00:00Z";

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
      "inv-1:peakShaving": { previousValue: 120, capturedAt: CAPTURED },
    };

    await io.saveState(next);

    expect(r.writes).toEqual([{ key: AUTOMATION_STATE_KEY, value: next }]);
    expect(await io.loadState()).toBe(next);
    expect(r.reads).toEqual([AUTOMATION_STATE_KEY]);
  });

  test("a 1.x profile-keyed blob is adopted by its device, once and only once", async () => {
    // The 1.x shape: namespaced by the profile the device was running. Left
    // alone, the held charge-current value can never be handed back once the
    // profile is corrected or swapped.
    const r = recordingMods();
    r.set.stored({
      "test-profile:peakShaving": { previousValue: 90, capturedAt: CAPTURED },
      "test-profile:evccMode:1": { previousValue: "pv", capturedAt: CAPTURED },
    });
    const migrated: AutomationState = {
      "inv-1:peakShaving": { previousValue: 90, capturedAt: CAPTURED },
      "inv-1:evccMode:1": { previousValue: "pv", capturedAt: CAPTURED },
    };
    const io = composeAutomationIO(plant, r.mods);

    expect(await io.loadState()).toEqual(migrated);
    expect(r.writes).toEqual([{ key: AUTOMATION_STATE_KEY, value: migrated }]);

    // A second read is served from the cache: no re-read, and above all no
    // second write of a blob that is already in the new shape.
    expect(await io.loadState()).toEqual(migrated);
    expect(r.reads).toEqual([AUTOMATION_STATE_KEY]);
    expect(r.writes).toHaveLength(1);
  });

  test("re-reading an already-migrated blob writes nothing at all", async () => {
    // The pass runs on every boot; it must be inert once there is nothing left
    // to adopt, or every restart would rewrite the settings row.
    const r = recordingMods();
    const held: AutomationState = {
      "inv-1:peakShaving": { previousValue: 90, capturedAt: CAPTURED },
    };
    r.set.stored(held);

    expect(await composeAutomationIO(plant, r.mods).loadState()).toEqual(held);
    expect(r.writes).toEqual([]);
  });

  test("a blob no device can adopt is kept exactly as it was, and named", async () => {
    // The profile is not bound to any device any more. The entry is still the
    // user's own register value, so it is never dropped — and never rewritten
    // under a guessed device either.
    const r = recordingMods();
    const orphaned: AutomationState = {
      "gone-profile:peakShaving": { previousValue: 90, capturedAt: CAPTURED },
    };
    r.set.stored(orphaned);

    expect(await composeAutomationIO(plant, r.mods).loadState()).toEqual(orphaned);
    expect(r.writes).toEqual([]);
  });

  test("an empty blob needs no migration and no write", async () => {
    const r = recordingMods();
    r.set.stored({});
    expect(await composeAutomationIO(plant, r.mods).loadState()).toEqual({});
    expect(r.writes).toEqual([]);
  });

  test("a stored snapshot survives the restart it was written for", async () => {
    const r = recordingMods();
    const held: AutomationState = {
      "inv-1:peakShaving": { previousValue: 90, capturedAt: CAPTURED },
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

    expect(io.device).toBe(plant.device);
    expect(io.constraint).toBe(plant.constraint);
    expect(io.write).toBe(plant.write);
    expect(io.getConfig).toBe(r.mods.getAutomationConfig);
    expect(io.getWeather).toBe(r.mods.getWeatherConfig);
    // The pack voltage's newest home. An unwired arm here is the failure the
    // whole chain exists to prevent: the engine would fall to a legacy value and
    // scale every commanded charge current by it, silently.
    expect(io.getPackNominalV).toBe(r.mods.packNominalV);
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
    const io = await buildProductionIO({ ...plantOf(profile), write });

    expect(io.getConfig).toBe(getAutomationConfig);
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
