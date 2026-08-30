/**
 * The runtime controller: the God-loop, the batched history writer, the hot swap
 * of the live source and the MQTT bridge, the register-write funnel, and the two
 * "try it without disturbing production" probes.
 *
 * Nothing here talks to a socket or a database. Every collaborator the module
 * imports is replaced with an in-memory double, so the assertions are about the
 * controller's own decisions — when it polls, what it buffers, what it drops,
 * what it closes, and what it writes to a register.
 *
 * Two mechanics are worth reading before the tests:
 *
 * 1. `mock.module` is process-global and permanent — it is live for every test
 *    file in the process, whichever order the runner walked them in. So every
 *    factory below does two things. It spreads the real module, because a
 *    factory returning only the exports this suite needs would *delete* the
 *    rest for everyone downstream. And each stub delegates to the real export
 *    unless `intercepting` is set, which is true only while this file's own
 *    tests run: the suites that exercise these modules for real (the MQTT
 *    bridge, the automation loop, the price job) must never end up talking to
 *    the fakes below. And `afterAll` re-registers every first-party module from
 *    a by-value snapshot taken at load time, so the real exports — not merely
 *    delegating wrappers — are what the rest of the process imports.
 *
 * 2. Timers are captured rather than waited on. `setInterval`/`setTimeout` are
 *    wrapped for the length of the file: each armed timer is recorded (callback,
 *    period, handle) *and* still armed for real, at its real period. Every
 *    period the runtime uses is minutes to hours, so nothing fires by itself —
 *    the tests invoke the recorded callback directly and await it. That makes
 *    the poll loop, the flush, the forecast republish and both job kicks
 *    deterministic, and it lets `clearInterval` be observed so a leaked or
 *    doubled loop is a test failure rather than a slow drift in production.
 */

import { EventEmitter } from "node:events";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import type { ControlState } from "@SunReye/db/control-state";
import { controlStateKey } from "@SunReye/db/control-state";
import type { MqttConfig } from "@SunReye/db/mqtt-config";
import type { PollEndpoint } from "./endpoint";
import type { IdentityResolver } from "../shared/identity";
import type { MetricKeySpec } from "@SunReye/db/metric-keys";
import { control, metric } from "@SunReye/inverter-core";
import type {
  DeviceInstance,
  InverterProfile,
  InverterSample,
  InverterSource,
} from "@SunReye/inverter-core";
import type { DeviceRegistry } from "../devices/registry";

import type { StorageRow } from "./storage-policy";

// --- doubles ---------------------------------------------------------------

/**
 * Whether this file's doubles are in charge. Set for the length of this suite
 * only (see `beforeAll`/`afterAll`); everywhere else the stubs below hand
 * straight back to the real implementation.
 */
let intercepting = false;

/** A promise plus its resolver, for parking an async collaborator mid-flight. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Let every pending microtask (and any 0 ms timer) run. */
const settle = () => Bun.sleep(0);

/** One captured log line — enough to prove *which* line was emitted, and how often. */
interface LogLine {
  level: string;
  template: string;
  values: Record<string, unknown>;
}
let logLines: LogLine[] = [];
/** Captured lines whose template starts with `prefix`. */
const linesStartingWith = (prefix: string) => logLines.filter((l) => l.template.startsWith(prefix));

const LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
const { log } = await import("../shared/logging");
// LogTape caches one logger per category, and `runtime.ts` binds its own at
// import time — possibly long before this file loads, if another suite imported
// it first. So the tap goes on that shared instance rather than on the module:
// own properties shadow the prototype's methods, record while this suite is
// running, and always forward to LogTape. `afterAll` peels them off again.
const runtimeLogger = log("runtime") as unknown as Record<string, unknown>;
function tapRuntimeLogger(): void {
  for (const level of LEVELS) {
    const emit = (runtimeLogger[level] as (t: string, v?: Record<string, unknown>) => void).bind(
      runtimeLogger,
    );
    runtimeLogger[level] = (template: string, values: Record<string, unknown> = {}) => {
      if (intercepting) logLines.push({ level, template, values });
      emit(template, values);
    };
  }
}
function untapRuntimeLogger(): void {
  for (const level of LEVELS) delete runtimeLogger[level];
}

/**
 * Row batches the injected history buffer committed, in flush order.
 *
 * `StorageRow`, not the table's insert shape: the buffer carries the NAMES the
 * storage policy produces, and the id translation happens inside the real
 * commit (`./storage-identity.ts`), past this seam.
 */
const inserted: StorageRow[][] = [];

/**
 * Stands in for the injected history buffer. The runtime enqueues each poll's
 * rows, and calls `flush()` on the flush-timer tick, before a source swap, and
 * at shutdown; the double records every flushed batch. The buffer's own
 * boundaries — the cap, the oldest-row drop, the re-queue after a failed
 * transaction — are covered directly in `history-buffer.test.ts`, so the double
 * needs none of them: it only proves the runtime enqueues and flushes at the
 * right moments. Injecting it is why this file no longer mocks `@SunReye/db`.
 */
const historyDouble = {
  rows: [] as StorageRow[],
  enqueue(next: StorageRow[]): void {
    this.rows.push(...next);
  },
  async flush(): Promise<void> {
    if (this.rows.length === 0) return;
    inserted.push(this.rows);
    this.rows = [];
  },
  get pending(): number {
    return this.rows.length;
  },
  // The cap never fires in these doubles: the runtime's contract is enqueue and
  // flush, and the cap's own boundaries are covered in `history-buffer.test.ts`.
  dropped: 0,
};

/** Batches the injected config change-log buffer committed, in flush order. */
const configInserted: StorageRow[][] = [];

/**
 * Stands in for the injected config change-log buffer, exactly as
 * {@link historyDouble} stands in for the timeseries one. Two destinations, one
 * batching contract - the split itself is what these tests are about.
 */
const configDouble = {
  rows: [] as StorageRow[],
  enqueue(next: StorageRow[]): void {
    this.rows.push(...next);
  },
  async flush(): Promise<void> {
    if (this.rows.length === 0) return;
    configInserted.push(this.rows);
    this.rows = [];
  },
  get pending(): number {
    return this.rows.length;
  },
  // The cap never fires in these doubles: the runtime's contract is enqueue and
  // flush, and the cap's own boundaries are covered in `history-buffer.test.ts`.
  dropped: 0,
};

/**
 * What the DRIVER stamps on every sample it reads —
 * `packages/inverter-core/src/driver.ts` uses `profile.id`, and a profile is not
 * an identity. Kept as its own constant so the specs below can say out loud that
 * a stored row is NOT keyed by it.
 */
const SAMPLE_STAMP = "plant-1";
/** The `devices.slug` the registry registers, and what every stored row carries. */
const DEVICE_SLUG = "inverter-1";
const PROFILE_ID = "test-inverter";
const LOCK = "settings.lock";
const TARGET = "settings.max_discharge";

/**
 * The endpoint the SPINE resolves for this install, mutable per test.
 *
 * `PollEndpoint`, not `InverterConfig`: the loop's address comes from the
 * `connections` + `devices` rows through `./endpoint.ts`, and the `app_settings`
 * document it used to come from is now a one-way legacy reader nothing here
 * touches. A test "changes the connection" by changing THIS and asking the
 * runtime to re-read it, which is exactly what the settings PUT does.
 */
let pollEndpoint: PollEndpoint;
/** Broker settings the runtime boots with, mutable per test. */
let mqttConfig: MqttConfig;

const baseEndpoint = (over: Partial<PollEndpoint> = {}): PollEndpoint => ({
  host: "10.0.0.5",
  port: 502,
  transport: "tcp",
  unitId: 1,
  timeoutMs: 2000,
  // Long enough that the real timer never fires during a test; the loop is
  // driven by invoking the captured callback.
  pollIntervalMs: 60_000,
  ...over,
});

const baseMqttConfig = (over: Partial<MqttConfig> = {}): MqttConfig => ({
  enabled: true,
  brokerUrl: "mqtt://broker.test:1883",
  username: "user",
  password: "secret",
  topicPrefix: "sunreye",
  haDiscoveryEnabled: false,
  haDiscoveryPrefix: "homeassistant",
  ...over,
});

const realConfig = await import("../settings/config");
const realConfigExports = { ...realConfig };
const realGetMqttConfig = realConfig.getMqttConfig;
const realGetInverterConfig = realConfig.getInverterConfig;
/**
 * How often the LEGACY `app_settings.inverter` reader was consulted.
 *
 * Counted rather than merely stubbed: "the poll loop no longer polls from the
 * JSONB document" is the defect this release closes, and the only way to state it
 * as a test is that nothing on the boot or reload path asks for that document at
 * all. A value-based assertion would pass just as well if the runtime read both
 * and happened to prefer the right one.
 */
let legacyConfigReads = 0;
mock.module("../settings/config", () => ({
  ...realConfig,
  getInverterConfig: async () => {
    legacyConfigReads++;
    return realGetInverterConfig();
  },
  getMqttConfig: async () => (intercepting ? mqttConfig : realGetMqttConfig()),
}));

/**
 * The spine's answer, stubbed at the resolver rather than at the database.
 *
 * The rules INSIDE that resolution — which device, whose endpoint, what a
 * retired row means — are `endpoint.test.ts`'s subject and are proved against an
 * in-memory spine there. What this file is responsible for is what the loop does
 * with the answer, and that it re-reads it rather than being handed values.
 */
const realEndpoint = await import("./endpoint");
const realEndpointExports = { ...realEndpoint };
const realLoadPollEndpoint = realEndpoint.loadPollEndpoint;
mock.module("./endpoint", () => ({
  ...realEndpoint,
  loadPollEndpoint: async () => (intercepting ? pollEndpoint : realLoadPollEndpoint()),
}));

/** Stands in for the MQTT bridge: records everything the runtime publishes. */
class FakeBridge {
  samples: InverterSample[] = [];
  forecasts: unknown[] = [];
  closed = 0;
  constructor(readonly config: MqttConfig) {}
  publishSample(sample: InverterSample): void {
    this.samples.push(sample);
  }
  publishForecast(forecast: unknown): void {
    this.forecasts.push(forecast);
  }
  status() {
    return { connected: true, lastError: null };
  }
  async close(): Promise<void> {
    this.closed++;
  }
}
const bridges: FakeBridge[] = [];
/** The `write` the runtime injected into the bridge — MQTT's command path. */
let bridgeWrite: ((key: string, value: number) => Promise<void>) | null = null;
/** The `ctx` the runtime injected — carries the namespace every HA id is built from. */
let bridgeCtx: { profile: { id: string }; plantSlug?: string; deviceSlug?: string } | null = null;
const latestBridge = () => bridges.at(-1) as FakeBridge;

const realBridgeModule = await import("./mqtt");
const realBridgeExports = { ...realBridgeModule };
const realStartMqttBridge = realBridgeModule.startMqttBridge;
mock.module("./mqtt", () => ({
  ...realBridgeModule,
  startMqttBridge: (
    config: MqttConfig,
    deps: Parameters<typeof realBridgeModule.startMqttBridge>[1],
  ) => {
    if (!intercepting) return realStartMqttBridge(config, deps);
    if (!config.enabled) return null;
    bridgeWrite = deps.write;
    bridgeCtx = deps.ctx;
    const built = new FakeBridge(config);
    bridges.push(built);
    return built;
  },
}));

const automation = {
  started: 0,
  stopped: 0,
  /** The registered device the loop was handed — `devices.slug`, never a profile id. */
  deviceId: null as string | null,
  /**
   * How many timers had already been torn down when `stopAutomations` was
   * called. Automations write through the same funnel as everything else, so
   * they must be stopped *before* the loop and the transport go away —
   * otherwise a rule firing mid-shutdown writes into a closed source. Recording
   * the teardown position is the only way to observe that ordering.
   */
  clearedAtStop: -1,
  /**
   * The "is anyone watching the automations feed" predicate the runtime handed
   * on. Only the socket boundary can answer that question, so it is injected
   * into `start` and forwarded; a forward that gets dropped turns the engine's
   * broadcast short-circuit into "never broadcast" and the page goes quiet.
   */
  watching: null as (() => boolean) | null,
};
const realAutomation = await import("../automation/automation");
const realAutomationExports = { ...realAutomation };
const realStartAutomations = realAutomation.startAutomations;
const realStopAutomations = realAutomation.stopAutomations;
mock.module("../automation/automation", () => ({
  ...realAutomation,
  startAutomations: async (
    deps: Parameters<typeof realAutomation.startAutomations>[0],
    streamBus: Parameters<typeof realAutomation.startAutomations>[1],
    buildIO: Parameters<typeof realAutomation.startAutomations>[2],
    watching: Parameters<typeof realAutomation.startAutomations>[3],
  ) => {
    if (!intercepting) return realStartAutomations(deps, streamBus, buildIO, watching);
    automation.started++;
    automation.deviceId = deps.device.id;
    automation.watching = watching ?? null;
  },
  stopAutomations: async () => {
    if (!intercepting) return realStopAutomations();
    automation.stopped++;
    automation.clearedAtStop = cleared.length;
  },
}));

/**
 * House-load values handed to the EV charge-power estimator, in poll order.
 * The estimator hook is a constructor-injected collaborator (see the
 * `onLoadSample` dep passed to `createRuntime` below), so this suite records the
 * per-poll load through an injected spy rather than mocking `../evcc/evcc` — one
 * fewer process-global module mock to install and unwind.
 */
let loadSamples: (number | null)[] = [];

/** Sentinel handed back by `getWeatherConfig`, to prove it is threaded through. */
const WEATHER_CONFIG = { marker: "weather" };
const realWeatherSettings = await import("../settings/weather-settings");
const realWeatherSettingsExports = { ...realWeatherSettings };
const realGetWeatherConfig = realWeatherSettings.getWeatherConfig;
mock.module("../settings/weather-settings", () => ({
  ...realWeatherSettings,
  getWeatherConfig: async () =>
    intercepting
      ? (WEATHER_CONFIG as unknown as Awaited<
          ReturnType<typeof realWeatherSettings.getWeatherConfig>
        >)
      : realGetWeatherConfig(),
}));

/** A two-slot forecast; `toForecastExport` (real) shapes it for publication. */
const forecastFixture = () => ({
  provider: "test-provider",
  stepMinutes: 60,
  utcOffsetSeconds: 7200,
  series: [
    { time: "2026-08-15T10:00", watts: 3000, peakWatts: 3400 },
    { time: "2026-08-15T11:00", watts: 4000, peakWatts: 4200 },
  ],
  todayKwh: 7,
  remainingTodayKwh: 7,
  tomorrowKwh: 9,
  next15: { maxPowerW: 3400, energyKwh: 0.8 },
  raw: {
    series: [
      { time: "2026-08-15T10:00", watts: 3500, peakWatts: 3900 },
      { time: "2026-08-15T11:00", watts: 5000, peakWatts: 5200 },
    ],
    todayKwh: 8.5,
    remainingTodayKwh: 8.5,
    tomorrowKwh: 11,
    next15: { maxPowerW: 3900, energyKwh: 0.9 },
  },
});
type Forecast = ReturnType<typeof forecastFixture>;

let forecastResult: Forecast | null = null;
let forecastError: string | null = null;
let forecastConfigSeen: unknown = null;
const realSolarForecast = await import("../forecast/solar-forecast");
const realSolarForecastExports = { ...realSolarForecast };
const realFetchSolarForecast = realSolarForecast.fetchSolarForecast;
mock.module("../forecast/solar-forecast", () => ({
  ...realSolarForecast,
  fetchSolarForecast: async (
    config: Parameters<typeof realSolarForecast.fetchSolarForecast>[0],
  ) => {
    if (!intercepting) return realFetchSolarForecast(config);
    forecastConfigSeen = config;
    if (forecastError) throw new Error(forecastError);
    return forecastResult as unknown as Awaited<
      ReturnType<typeof realSolarForecast.fetchSolarForecast>
    >;
  },
}));

let learnRuns = 0;
let learnError: string | null = null;
let learnConfigSeen: unknown = null;
const realLearnJob = await import("../forecast/forecast-correction-job");
const realLearnJobExports = { ...realLearnJob };
const realRunLearn = realLearnJob.runForecastCorrectionLearn;
mock.module("../forecast/forecast-correction-job", () => ({
  ...realLearnJob,
  runForecastCorrectionLearn: async (
    config: Parameters<typeof realLearnJob.runForecastCorrectionLearn>[0],
  ) => {
    if (!intercepting) return realRunLearn(config);
    learnRuns++;
    learnConfigSeen = config;
    if (learnError) throw new Error(learnError);
    return { learnedDays: 0 } as unknown as Awaited<
      ReturnType<typeof realLearnJob.runForecastCorrectionLearn>
    >;
  },
}));

const SPOT_CONFIG = { marker: "spot" };
const realSpotSettings = await import("../settings/spot-price-settings");
const realSpotSettingsExports = { ...realSpotSettings };
const realGetSpotPriceConfig = realSpotSettings.getSpotPriceConfig;
mock.module("../settings/spot-price-settings", () => ({
  ...realSpotSettings,
  getSpotPriceConfig: async () =>
    intercepting
      ? (SPOT_CONFIG as unknown as Awaited<ReturnType<typeof realSpotSettings.getSpotPriceConfig>>)
      : realGetSpotPriceConfig(),
}));

let spotRuns = 0;
let spotError: string | null = null;
let spotOutcome: "stored" | "complete" | "disabled" = "complete";
let spotStored = 0;
const realSpotJob = await import("../prices/spot-price-job");
const realSpotJobExports = { ...realSpotJob };
const realRunSpotPriceSync = realSpotJob.runSpotPriceSync;
mock.module("../prices/spot-price-job", () => ({
  ...realSpotJob,
  runSpotPriceSync: async (...args: Parameters<typeof realSpotJob.runSpotPriceSync>) => {
    if (!intercepting) return realRunSpotPriceSync(...args);
    spotRuns++;
    if (spotError) throw new Error(spotError);
    return { outcome: spotOutcome, stored: spotStored };
  },
}));

/**
 * Composite-control state, in memory instead of `app_settings`. It is injected
 * into the runtime as its control store (shared by the write funnel and the
 * per-poll state injection), so this suite no longer mocks `./control-store` —
 * the store is a constructor-injected collaborator, exactly like the history
 * buffer above.
 */
let controlState: ControlState = {};
const controlStore = {
  get: async () => controlState,
  set: async (next: ControlState) => {
    controlState = next;
  },
};

/** Stands in for a Modbus transport: records reads, writes and closes. */
class FakeSource implements InverterSource {
  reads = 0;
  closed = 0;
  writes: { key: string; value: number }[] = [];
  constructor(
    readonly profile: InverterProfile,
    readonly config: SourceConnection,
  ) {}
  async read(): Promise<InverterSample> {
    this.reads++;
    return readResult();
  }
  async write(key: string, value: number): Promise<void> {
    if (writeError) throw new Error(writeError);
    this.writes.push({ key, value });
  }
  async close(): Promise<void> {
    this.closed++;
  }
}
/** Every source the runtime built, live ones and throwaway probes alike. */
const sources: FakeSource[] = [];
const latestSource = () => sources.at(-1) as FakeSource;
/** What the next `read()` resolves (or rejects) with. */
let readResult: () => Promise<InverterSample> = async () => liveSample();
/** When set, every register write rejects with this message. */
let writeError: string | null = null;

/** Override for the by-id profile lookup; `null` means "use the real one". */
let resolveOverride: ((id: string) => InverterProfile | null) | null = null;

/**
 * The profile the registry's primary device is described by — the roster this
 * runtime polls, as the plant's `devices` rows state it.
 *
 * This is what replaced the `activeProfile` module global: the runtime no longer
 * asks a module which profile is active, it asks the registry which DEVICES
 * exist and what each one binds.
 */
let registryProfile: InverterProfile | null = null;

const realInverter = await import("./inverter");
type SourceConnection = Parameters<typeof realInverter.buildSource>[1];
const realInverterExports = { ...realInverter };
const realBuildSource = realInverter.buildSource;
const realResolveProfileById = realInverter.resolveProfileById;
const { buildProfileContext } = realInverter;
mock.module("./inverter", () => ({
  ...realInverter,
  buildSource: (profile: InverterProfile, config: SourceConnection) => {
    if (!intercepting) return realBuildSource(profile, config);
    const built = new FakeSource(profile, config);
    sources.push(built);
    return built;
  },
  // Both profile lookups fall through to the real implementation unless a test
  // has taken them over, so a later test file that imports this module keeps
  // production behaviour.
  resolveProfileById: async (id: string) =>
    resolveOverride ? resolveOverride(id) : realResolveProfileById(id),
}));

/** Stands in for `mqtt`'s client in the broker probe. */
class FakeMqttClient extends EventEmitter {
  ends: { force: boolean }[] = [];
  constructor(
    readonly url: string,
    readonly options: Record<string, unknown>,
  ) {
    super();
  }
  end(force: boolean, callback: () => void): void {
    this.ends.push({ force });
    callback();
  }
}
let mqttClient: FakeMqttClient | null = null;
// Third-party, so no spread rule applies — but `mqtt` is mocked by the bridge
// suite too, so this still hands back whatever was in place before when this
// suite is not the one running.
const upstreamMqtt = await import("mqtt");
const upstreamConnect = upstreamMqtt.default.connect;
mock.module("mqtt", () => ({
  ...upstreamMqtt,
  default: {
    ...upstreamMqtt.default,
    connect: (url: string, options: Record<string, unknown>) => {
      if (!intercepting) return upstreamConnect(url, options);
      mqttClient = new FakeMqttClient(url, options);
      return mqttClient;
    },
  },
}));

// --- profiles --------------------------------------------------------------

/** A plant with a load role, a bounded writable register and a discharge lock. */
function mainProfile(): InverterProfile {
  return {
    id: PROFILE_ID,
    name: "Test Inverter",
    manufacturer: "ACME",
    metrics: [
      metric("load/power", {
        label: "House load",
        unit: "W",
        group: "load",
        addr: 10,
        role: "load.power",
      }),
      metric("battery/soc", {
        label: "Battery SOC",
        unit: "%",
        group: "battery",
        addr: 11,
        role: "battery.soc",
      }),
      metric("settings/max_discharge", {
        label: "Max discharge",
        unit: "A",
        group: "settings",
        addr: 12,
        access: "rw",
        range: { min: 0, max: 185 },
      }),
      metric("settings/mode", {
        label: "Work mode",
        group: "settings",
        addr: 13,
        access: "rw",
        enumLabels: { 0: "Off", 1: "Sell" },
      }),
      control<typeof TARGET>("settings/lock", {
        label: "Discharge lock",
        group: "settings",
        enumLabels: { 0: "Unlocked", 1: "Locked" },
        controlExpr: { snapshotToggle: { target: TARGET, lockedValue: 0 } },
      }),
    ],
  };
}

/** A plant that maps no house load at all (an inverter behind no meter). */
function meterlessProfile(): InverterProfile {
  return {
    id: "meterless",
    name: "Meterless",
    manufacturer: "ACME",
    metrics: [
      metric("battery/soc", {
        label: "Battery SOC",
        unit: "%",
        group: "battery",
        addr: 11,
        role: "battery.soc",
      }),
    ],
  };
}

const READINGS = { "load.power": 1200, "battery.soc": 55, [TARGET]: 30 };

function liveSample(
  metrics: Record<string, number> = READINGS,
  time = "2026-08-15T10:00:00.000Z",
): InverterSample {
  return { time, inverterId: SAMPLE_STAMP, metrics: { ...metrics } };
}

// --- timer capture ---------------------------------------------------------

interface Armed {
  kind: "interval" | "timeout";
  ms: number;
  fn: () => unknown;
  handle: unknown;
}
let armed: Armed[] = [];
let cleared: unknown[] = [];
/** Collapse the broker probe's 5 s guard so the timeout path is testable. */
let shortenBrokerTimeout = false;

/** The cadences the runtime is contracted to arm (ms). */
const FORECAST_MS = 5 * 60_000;
const LEARN_MS = 12 * 3600_000;
const LEARN_KICK_MS = 2 * 60_000;
const SPOT_MS = 30 * 60_000;
const SPOT_KICK_MS = 30_000;
const FLUSH_MS = 600_000;
const BROKER_PROBE_MS = 5000;

const timers = { setInterval, setTimeout, clearInterval, clearTimeout };

/** Every timer armed at `ms`, newest last. */
const armedAt = (ms: number, kind: Armed["kind"] = "interval") =>
  armed.filter((t) => t.kind === kind && t.ms === ms);

/** The most recent timer armed at `ms` — the one currently in charge. */
function timerFor(ms: number, kind: Armed["kind"] = "interval"): Armed {
  const found = armedAt(ms, kind).at(-1);
  if (!found) throw new Error(`no ${kind} armed at ${ms} ms`);
  return found;
}

/** Run one tick of the poll loop and wait for it to finish. */
const poll = () => timerFor(pollEndpoint.pollIntervalMs).fn() as Promise<void>;

/** Fire a fire-and-forget timer callback and let its promise chain settle. */
async function fire(ms: number, kind: Armed["kind"] = "interval"): Promise<void> {
  timerFor(ms, kind).fn();
  await settle();
}

const originalFlushInterval = process.env.HISTORY_FLUSH_INTERVAL_MS;
const originalSimulate = process.env.INVERTER_SIMULATE;

beforeAll(() => {
  intercepting = true;
  tapRuntimeLogger();
  // `env` is `process.env` itself under SKIP_ENV_VALIDATION, so the flush
  // cadence can be pinned to something that never fires on its own.
  process.env.HISTORY_FLUSH_INTERVAL_MS = String(FLUSH_MS);
  globalThis.setInterval = ((fn: () => unknown, ms?: number, ...rest: unknown[]) => {
    const handle = timers.setInterval(fn, ms, ...rest);
    armed.push({ kind: "interval", ms: Number(ms), fn, handle });
    return handle;
  }) as typeof setInterval;
  globalThis.setTimeout = ((fn: () => unknown, ms?: number, ...rest: unknown[]) => {
    const delay = shortenBrokerTimeout && Number(ms) === BROKER_PROBE_MS ? 0 : ms;
    const handle = timers.setTimeout(fn, delay, ...rest);
    armed.push({ kind: "timeout", ms: Number(ms), fn, handle });
    return handle;
  }) as typeof setTimeout;
  globalThis.clearInterval = ((handle: unknown) => {
    cleared.push(handle);
    return timers.clearInterval(handle as Parameters<typeof clearInterval>[0]);
  }) as typeof clearInterval;
  globalThis.clearTimeout = ((handle: unknown) => {
    cleared.push(handle);
    return timers.clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
  }) as typeof clearTimeout;
});

afterAll(() => {
  // Hand every doubled module back to its real implementation. Dropping
  // `intercepting` makes the stubs delegate, but a delegating stub is still a
  // different function object installed in place of the real export for every
  // file that loads after this one — `dbControlStore` above is not even the same
  // shape as the real handle. So the modules are re-registered outright, from
  // the snapshots taken by value at load time: a namespace is live, so
  // `realInverter.buildSource` is by now the stub, and `() => realInverter`
  // would restore the double instead of the module.
  intercepting = false;
  mock.module("../settings/config", () => ({ ...realConfigExports }));
  mock.module("./endpoint", () => ({ ...realEndpointExports }));
  mock.module("./mqtt", () => ({ ...realBridgeExports }));
  mock.module("../automation/automation", () => ({ ...realAutomationExports }));
  mock.module("../settings/weather-settings", () => ({ ...realWeatherSettingsExports }));
  mock.module("../forecast/solar-forecast", () => ({ ...realSolarForecastExports }));
  mock.module("../forecast/forecast-correction-job", () => ({ ...realLearnJobExports }));
  mock.module("../settings/spot-price-settings", () => ({ ...realSpotSettingsExports }));
  mock.module("../prices/spot-price-job", () => ({ ...realSpotJobExports }));
  mock.module("./inverter", () => ({ ...realInverterExports }));
  untapRuntimeLogger();
  registryProfile = null;
  registryDevice = null;
  extraDevices = [];
  rosterReadFails = false;
  resolveOverride = null;
  Object.assign(globalThis, timers);
  if (originalFlushInterval === undefined) delete process.env.HISTORY_FLUSH_INTERVAL_MS;
  else process.env.HISTORY_FLUSH_INTERVAL_MS = originalFlushInterval;
  if (originalSimulate === undefined) delete process.env.INVERTER_SIMULATE;
  else process.env.INVERTER_SIMULATE = originalSimulate;
  setSystemTime();
});

// The history buffer and the control-state store are constructor-injected
// collaborators, so this suite drives its own runtime instance with the
// in-memory doubles above rather than the module's default instance — which is
// why no `@SunReye/db` and no `./control-store` mock is needed.
const { createRuntime } = await import("./runtime");
const { deviceInstance, instanceFromProfile } = await import("@SunReye/inverter-core");
/**
 * The plant's roster, as the registry answers it.
 *
 * Injected rather than mocked for the same reason the identity resolver is: the
 * production registry reads the `devices` table, so a suite without a double
 * would fail on a missing database client instead of on the behaviour it names.
 * The instance is rebuilt only on {@link DeviceRegistry.reload}, exactly as the
 * real one is — the runtime memoizes the load-power key against the INSTANCE, so
 * a double that minted a new object per call would hide a broken cache.
 */
let registryDevice: DeviceInstance | null = null;
/**
 * Registered devices that are NOT the polled inverter — an optimizer, an EV
 * charger: a row in the same table, with no endpoint and no poll of its own.
 * Mutated by a test to add or retire one between reloads.
 */
let extraDevices: DeviceInstance[] = [];
/** How often the roster was re-read, so a recovery attempt can be counted. */
let deviceReloads = 0;
/**
 * Whether the roster read fails. The real registry keeps its LAST GOOD snapshot
 * when the query throws — which at boot is the empty one, so a database that is
 * slow to accept connections leaves the process polling with nowhere to store.
 */
let rosterReadFails = false;
const roster = () => (registryDevice ? [registryDevice, ...extraDevices] : extraDevices);
const devicesDouble: DeviceRegistry = {
  reload: async () => {
    deviceReloads += 1;
    // A failed read keeps the last good roster rather than emptying the plant.
    if (rosterReadFails) return roster();
    registryDevice = registryProfile
      ? instanceFromProfile({
          id: DEVICE_SLUG,
          deviceClass: "inverter",
          integration: "profile",
          profile: registryProfile,
        })
      : null;
    return roster();
  },
  list: () => roster(),
  get: (id) => roster().find((d) => d.id === id),
  primary: () => registryDevice,
  primaryProfile: () => registryProfile,
  driverProfile: () => registryProfile,
  profileIds: () => (registryProfile ? [registryProfile.id] : []),
  usesProfile: (id) => registryProfile?.id === id,
  bindings: () =>
    registryProfile && registryDevice
      ? [{ deviceId: DEVICE_SLUG, profileId: registryProfile.id }]
      : [],
};

const identityDouble: IdentityResolver = {
  deviceId: async () => 1,
  registerMetrics: async (specs) => {
    registeredSpecs.push([...specs]);
  },
  metricIds: async (keys) => new Map(keys.map((k, i) => [k, i + 1])),
  metricId: async () => 1,
  reset: () => {},
};

/**
 * A runtime over this file's doubles — ONE PER TEST (see `beforeEach`).
 *
 * Per test rather than per file because the runtime owns the write seam, and
 * the write seam legitimately REMEMBERS: `./device-writer.ts` keeps one storage
 * policy per device for as long as that device's declarations are unchanged, so
 * its change-log memory and hardware-evidence set survive a reload — which is
 * the whole point of it (a settings save must not write a phantom change row).
 * A single runtime shared by every test in the file would carry that memory
 * across tests too, and the second spec to poll the same device would see the
 * first spec's settings already logged.
 */
const newRuntime = () =>
  createRuntime({
    devices: devicesDouble,
    history: historyDouble,
    configLog: configDouble,
    controlStore,
    identity: identityDouble,
    // The MQTT namespace, injected for the same reason the resolver is: the real
    // reader queries the dimension spine, so without a double every bridge spec
    // would fail on a missing database client — and the runtime's own guard turns
    // that failure into "MQTT is off", which looks identical to a bridge that was
    // never built. `namespaceReads` records the profile id it was asked for, so a
    // rebuild-cadence claim can be asserted rather than assumed.
    mqttNamespace: async (profileId) => {
      namespaceReads.push(profileId);
      if (namespaceOutcome instanceof Error) throw namespaceOutcome;
      return namespaceOutcome;
    },
    // The EV charge-power estimator hook, injected as a spy instead of mocking
    // `../evcc/evcc`: every poll's house-load value is recorded here, which is why
    // this suite no longer installs (or has to unwind) an evcc module mock.
    onLoadSample: (watts) => loadSamples.push(watts),
  });

type Runtime = ReturnType<typeof createRuntime>;
/** The instance the current test is driving; replaced in `beforeEach`. */
let runtime: Runtime = newRuntime();
// Delegating wrappers rather than a destructure: the methods below must always
// reach the CURRENT instance, and a destructured reference would pin every test
// to the one built at load time.
const reloadEndpoint: Runtime["reloadEndpoint"] = () => runtime.reloadEndpoint();
const applyMqttConfig: Runtime["applyMqttConfig"] = (config) => runtime.applyMqttConfig(config);
const start: Runtime["start"] = (bus, ctx, watched) => runtime.start(bus, ctx, watched);
const status: Runtime["status"] = () => runtime.status();
const stop: Runtime["stop"] = () => runtime.stop();
const syncSpotPricesNow: Runtime["syncSpotPricesNow"] = () => runtime.syncSpotPricesNow();
const testInverter: Runtime["testInverter"] = (profileId, config) =>
  runtime.testInverter(profileId, config);
const testMqtt: Runtime["testMqtt"] = (config) => runtime.testMqtt(config);
const write: Runtime["write"] = (...args) => runtime.write(...args);
const { liveState } = await import("../shared/state");
const { createStreams } = await import("../shared/streams");

/**
 * Metric specs the runtime EAGERLY registered, per call.
 *
 * The resolver is injected rather than mocked because the real one talks to the
 * database on a `void`-ed promise whose rejection is swallowed — so a unit that
 * never made it into the registration would look exactly like a unit that did.
 */
let registeredSpecs: MetricKeySpec[][] = [];

/** Profile ids the bridge asked the namespace reader for, one per rebuild. */
let namespaceReads: string[] = [];

/**
 * What the namespace reader does next: hand back slugs, or throw.
 *
 * Both failure shapes matter and they are NOT the same test. A
 * `MissingMqttNamespaceError` is "the spine has no device row yet"; anything
 * else is "the database did not answer". The runtime must treat them
 * identically — MQTT off, poll loop up — and the first version of that guard did
 * not, so a missing client aborted `start()`.
 */
let namespaceOutcome: { plantSlug: string; deviceSlug: string } | Error = {
  plantSlug: "test-plant",
  deviceSlug: "inverter",
};

/** Samples emitted on the `metrics` topic, in poll order. */
let published: InverterSample[] = [];
/** How often a "fresh prices stored" signal reached the `statistics` topic. */
let spotSyncNotifications = 0;
/** The bus the runtime was booted with, for a test that wants its own subscriber. */
let streams: ReturnType<typeof createStreams>;

/** Boot the runtime with a profile context and hand back that context. */
async function boot(profile: InverterProfile = mainProfile()) {
  const ctx = buildProfileContext(profile);
  // The plant's device row names this profile — `start()` reloads the registry,
  // just as it does in production after `syncProvisioning`.
  registryProfile = profile;
  streams = createStreams();
  streams.subscribe("metrics", (sample) => published.push(sample));
  await start(streams, ctx);
  return ctx;
}

/**
 * Move the plant's endpoint and let the runtime re-read it.
 *
 * Two steps on purpose: the settings PUT writes the `connections` row and then
 * asks the loop to re-resolve. A helper that handed values straight to the
 * runtime would be the write-back this release deleted, re-created in the test
 * double.
 */
async function moveEndpoint(over: Partial<PollEndpoint> = {}): Promise<void> {
  pollEndpoint = baseEndpoint(over);
  await reloadEndpoint();
}

beforeEach(() => {
  runtime = newRuntime();
  pollEndpoint = baseEndpoint();
  legacyConfigReads = 0;
  registeredSpecs = [];
  mqttConfig = baseMqttConfig();
  armed = [];
  cleared = [];
  logLines = [];
  inserted.length = 0;
  historyDouble.rows = [];
  configDouble.rows = [];
  configInserted.length = 0;
  bridges.length = 0;
  bridgeCtx = null;
  namespaceReads = [];
  namespaceOutcome = { plantSlug: "test-plant", deviceSlug: "inverter" };
  sources.length = 0;
  published = [];
  loadSamples = [];
  controlState = {};
  writeError = null;
  readResult = async () => liveSample();
  forecastResult = null;
  forecastError = null;
  forecastConfigSeen = null;
  learnConfigSeen = null;
  learnError = null;
  learnRuns = 0;
  spotError = null;
  spotRuns = 0;
  spotOutcome = "complete";
  spotStored = 0;
  spotSyncNotifications = 0;
  registryProfile = null;
  registryDevice = null;
  extraDevices = [];
  deviceReloads = 0;
  rosterReadFails = false;
  resolveOverride = null;
  mqttClient = null;
  bridgeWrite = null;
  automation.started = 0;
  automation.stopped = 0;
  automation.deviceId = null;
  automation.clearedAtStop = -1;
  automation.watching = null;
  shortenBrokerTimeout = false;
  setSystemTime();
});

afterEach(async () => {
  await stop();
  setSystemTime();
});

// ---------------------------------------------------------------------------
// These run first on purpose: once a profile has been activated the module-level
// context is never cleared again, so the onboarding-only boot can only be
// observed before the first `start`.
// ---------------------------------------------------------------------------

describe("before a profile is active", () => {
  test("reports no profile, no connection and no broker", () => {
    expect(status().inverter).toMatchObject({
      connected: false,
      lastError: null,
      lastSampleAt: null,
      profile: null,
    });
    expect(status().mqtt).toEqual({ enabled: false, connected: false, lastError: null });
  });

  test("refuses a register write instead of writing into the void", async () => {
    await expect(write(TARGET, 20)).rejects.toThrow("inverter not started");
  });

  test("saved connection settings are persisted but not hot-applied", async () => {
    await moveEndpoint({ host: "10.0.0.9" });
    await applyMqttConfig(baseMqttConfig());
    expect(sources).toHaveLength(0);
    expect(bridges).toHaveLength(0);
    expect(armed).toHaveLength(0);
  });

  test("shutting down a runtime that never started is a no-op, not a crash", async () => {
    await expect(stop()).resolves.toBeUndefined();
    expect(automation.stopped).toBe(1);
    expect(inserted).toHaveLength(0);
  });

  test("a test read is refused when no profile is selected", async () => {
    // No device registered, so nothing says which profile a bare re-test means.
    registryProfile = null;
    await expect(testInverter(null, baseEndpoint())).resolves.toEqual({
      ok: false,
      error: "No profile selected",
    });
    expect(sources).toHaveLength(0);
  });

  test("a price sync landing before the websocket sink is wired is not an error", async () => {
    // The 30 s post-boot kick can beat the boot that injects the stream; a sync
    // with no bus wired yet has to absorb that rather than throw inside a timer.
    spotOutcome = "stored";
    spotStored = 96;

    await expect(syncSpotPricesNow()).resolves.toBeUndefined();
    expect(spotRuns).toBe(1);
  });

  test("a test read against an uninstalled profile names the id", async () => {
    resolveOverride = () => null;
    await expect(testInverter("gone-with-the-upgrade", baseEndpoint())).resolves.toEqual({
      ok: false,
      error: 'Unknown profile "gone-with-the-upgrade"',
    });
  });
});

describe("eager metric registration", () => {
  test("registers the profile's keys WITH their units and counter class", async () => {
    // `metric_keys.unit` is what every reader labels an axis from, and a
    // continuous aggregate cannot ask the profile what a key means — so the unit
    // and the counter class have to be recorded alongside the key, at the one hook
    // that already walks `profile.metrics`. Until this was wired the column
    // existed, the upsert existed, and every row held NULL.
    await boot();
    await poll();
    const specs = registeredSpecs.at(0) ?? [];
    expect(specs).toContainEqual({ key: "battery.soc", isCounter: false, unit: "%" });
    expect(specs).toContainEqual({ key: "load.power", isCounter: false, unit: "W" });
  });

  test("a metric with no unit registers null — never an empty string", async () => {
    // `undefined`/`null` is "I do not know" and never erases a stored unit; `""`
    // is a STATEMENT that the metric is dimensionless. Collapsing the two would
    // let a profile that says nothing overwrite one that said something.
    await boot();
    await poll();
    const specs = registeredSpecs.at(0) ?? [];
    const lock = specs.find((spec) => spec.key === LOCK);
    expect(lock).toBeDefined();
    expect(lock?.unit ?? null).toBeNull();
  });
});

describe("where the endpoint comes from", () => {
  test("boot resolves the address from the SPINE and never reads the legacy blob", async () => {
    // 2.0.0's dual-authority defect: the loop read `app_settings.inverter` while
    // provisioning copied that same document into `connections` and
    // `devices.unit_id` on every boot, so the JSONB one won and editing the
    // endpoint row did nothing. The document is a one-way legacy reader now —
    // used by the upgrade seed, never by the loop.
    pollEndpoint = baseEndpoint({ host: "10.1.2.3", unitId: 7, port: 8899 });
    await boot();
    expect(latestSource().config).toMatchObject({ host: "10.1.2.3", unitId: 7, port: 8899 });
    expect(legacyConfigReads).toBe(0);
  });

  test("a reload RE-READS the spine instead of being handed the values", async () => {
    // `reloadEndpoint()` takes no argument on purpose: the settings PUT writes the
    // `connections` row and then asks the loop to look again. Passing the typed
    // values in would be the same write-back one indirection further out.
    await boot();
    await moveEndpoint({ host: "10.4.5.6", unitId: 9 });
    expect(latestSource().config).toMatchObject({ host: "10.4.5.6", unitId: 9 });
    expect(legacyConfigReads).toBe(0);
  });

  test("the cadence the loop arms is the ENDPOINT's, not the process default", async () => {
    // `connections.poll_interval_ms` is a per-endpoint fact — a slow RS485 bridge
    // and a GX on Ethernet do not share a cadence.
    pollEndpoint = baseEndpoint({ pollIntervalMs: 15_000 });
    await boot();
    expect(armedAt(15_000)).toHaveLength(1);
  });
});

describe("the poll loop", () => {
  test("one tick reaches every downstream surface", async () => {
    await boot();
    expect(status().inverter.connected).toBeFalsy();

    await poll();

    expect(latestSource().reads).toBe(1);
    expect(liveState.latest?.metrics["battery.soc"]).toBe(55);
    expect(published).toHaveLength(1);
    expect(latestBridge().samples).toHaveLength(1);
    expect(status().inverter).toMatchObject({
      connected: true,
      lastError: null,
      lastSampleAt: "2026-08-15T10:00:00.000Z",
      profile: PROFILE_ID,
    });
    expect(status().mqtt).toEqual({ enabled: true, connected: true, lastError: null });
  });

  test("a stored row is keyed by the DEVICE, never by what the driver stamped", async () => {
    // The driver labels every sample with `profile.id` — a profile, which is
    // swapped, uninstalled and re-downloaded inside the five years a reading is
    // retained. The registry's device id (`devices.slug`) is the identity, and
    // this is the spec that says the two are not the same string.
    await boot();
    await poll();
    await stop();

    const rows = inserted.flat();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.inverterId === DEVICE_SLUG)).toBe(true);
    expect(rows.some((r) => r.inverterId === SAMPLE_STAMP)).toBe(false);
  });

  test("with no device registered, nothing is keyed to a device that does not exist", async () => {
    // A boot that raced provisioning, or an install whose device row could not
    // be created. Previously the rows were routed anyway and dropped one layer
    // down; either way nothing is stored, and nothing may be invented.
    await boot();
    registryProfile = null;
    await devicesDouble.reload();
    await poll();
    await stop();

    expect(inserted.flat()).toHaveLength(0);
    // The live surfaces are unaffected: what is stored and what is shown are
    // different questions.
    expect(published).toHaveLength(1);
  });

  test("a sample with no device to key it to says so — once, not once a second", async () => {
    // Storing NOTHING while reporting `connected: true` and serving live frames
    // is the loudest possible failure and the quietest possible log line. One
    // layer down, `./storage-identity.ts` warns once per unresolvable source
    // for exactly this reason; this path must be at least as loud.
    await boot();
    registryProfile = null;
    await devicesDouble.reload();
    const reloadsBefore = deviceReloads;

    await poll();
    await settle();
    await poll();
    await settle();

    expect(inserted.flat()).toHaveLength(0);
    expect(linesStartingWith("no registered device")).toHaveLength(1);
    // And the recovery attempt is one, not one per sample: at 1 Hz, a query per
    // dropped sample is a second failure on top of the first.
    expect(deviceReloads - reloadsBefore).toBe(1);
  });

  test("a roster lost to a failed read at boot is re-read, not lost for the process's life", async () => {
    // `readPlantDevices()` throws on both boot calls (a statement timeout, a
    // lock, Postgres still starting) and the registry keeps its last good
    // roster — which at boot is the EMPTY one. Without a retry the process
    // polls at 1 Hz, serves live frames and stores nothing until someone
    // restarts it.
    rosterReadFails = true;
    await boot();
    await poll();
    await settle();
    expect(inserted.flat()).toHaveLength(0);

    // The database answers again. The next dropped sample re-reads the roster
    // (the recovery is rate-limited, so time has to pass) and the poll after it
    // stores.
    rosterReadFails = false;
    setSystemTime(new Date(Date.now() + 60_000));
    await poll();
    await settle();
    await poll();
    await stop();

    const rows = inserted.flat();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.inverterId === DEVICE_SLUG)).toBe(true);
  });

  test("repeated polls of an unchanged reading write no history row at all", async () => {
    // 69.8 % of every row this app used to write was a byte-identical repeat of
    // its predecessor. A series row is an interval now, so three polls of an
    // unchanged value are not three rows — they are one interval, still open.
    await boot();
    await poll();
    await poll();
    await poll();

    expect(inserted).toHaveLength(0);
    await fire(FLUSH_MS);
    expect(inserted).toHaveLength(0);

    // The interval lands when it closes, carrying how long the value was held.
    await stop();
    const rows = inserted.flat();
    expect(rows.map((r) => r.metric).sort()).toEqual(["battery.soc", "load.power"]);
    expect(rows.every((r) => typeof r.durMs === "number" && (r.durMs as number) > 0)).toBe(true);
  });

  test("a changed reading closes the previous interval, and it is buffered until the flush", async () => {
    await boot();
    await poll();
    setSystemTime(new Date("2026-08-15T10:00:06.000Z"));
    readResult = async () =>
      liveSample({ ...READINGS, "load.power": 2400 }, "2026-08-15T10:00:06.000Z");
    await poll();

    // Nothing has hit the database yet — that is the whole point of the buffer.
    expect(inserted).toHaveLength(0);

    await fire(FLUSH_MS);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toHaveLength(1);
    expect(inserted[0]?.[0]).toEqual({
      time: new Date("2026-08-15T10:00:00.000Z"),
      inverterId: DEVICE_SLUG,
      metric: "load.power",
      value: 1200,
      durMs: 6000,
    });
  });

  test("a configuration register is logged once on change, not written every poll", async () => {
    await boot();
    await poll();
    await poll();
    await poll();
    await fire(FLUSH_MS);

    // 34 % of every row this app wrote was a configuration register repeating
    // itself into a timeseries table. Three polls of an unchanged setting are
    // one row now.
    const config = configInserted.flat();
    expect(config.map((r) => r.metric).sort()).toEqual(["settings.lock", "settings.max_discharge"]);
    expect(config.find((r) => r.metric === TARGET)).toEqual({
      time: new Date("2026-08-15T10:00:00.000Z"),
      inverterId: DEVICE_SLUG,
      metric: TARGET,
      value: 30,
    });
    // ...and none of them reached the hypertable.
    expect(inserted.flat().map((r) => r.metric)).not.toContain(TARGET);
  });

  test("a changed configuration register is logged again", async () => {
    await boot();
    await poll();
    readResult = async () => liveSample({ ...READINGS, [TARGET]: 60 });
    await poll();
    await fire(FLUSH_MS);

    const values = configInserted
      .flat()
      .filter((r) => r.metric === TARGET)
      .map((r) => r.value);
    expect(values).toEqual([30, 60]);
  });

  test("the live frame still carries every key the profile reads", async () => {
    // The no-regression proof for #113: only *persistence* moved. Charts,
    // controls, the MQTT bridge and the peak-shaving engine all read this frame.
    await boot();
    await poll();

    const frame = published.at(-1) as { metrics: Record<string, number> };
    expect(Object.keys(frame.metrics).sort()).toEqual([
      "battery.soc",
      "load.power",
      "settings.lock",
      TARGET,
    ]);
  });

  test("the config change-log is drained on the flush tick and at shutdown", async () => {
    await boot();
    await poll();
    // Nothing has hit the database yet - the change-log is batched like history.
    expect(configInserted).toHaveLength(0);
    await fire(FLUSH_MS);
    expect(configInserted).toHaveLength(1);

    readResult = async () => liveSample({ ...READINGS, [TARGET]: 90 });
    await poll();
    await stop();
    expect(configInserted.flat().map((r) => r.value)).toContain(90);
  });

  test("a read that yields no metrics writes no history row", async () => {
    await boot(meterlessProfile());
    readResult = async () => liveSample({});

    await poll();
    await fire(FLUSH_MS);

    expect(published).toHaveLength(1);
    expect(inserted).toHaveLength(0);
  });

  test("a tick is skipped while the previous read is still in flight", async () => {
    await boot();
    const gate = deferred();
    readResult = async () => {
      await gate.promise;
      return liveSample();
    };

    const first = poll();
    await settle();
    await poll(); // the stacked tick must not start a second read
    gate.release();
    await first;

    expect(latestSource().reads).toBe(1);
    expect(published).toHaveLength(1);
  });

  test("a config with no host idles instead of dialling localhost every second", async () => {
    pollEndpoint = baseEndpoint({ host: "   " });
    await boot();

    expect(status().inverter.lastError).toBe("No inverter host configured");
    expect(linesStartingWith("no inverter host configured")).toHaveLength(1);

    await poll();

    expect(sources).toHaveLength(1);
    expect(latestSource().reads).toBe(0);
    expect(published).toHaveLength(0);
  });

  test("polling resumes as soon as a host is saved", async () => {
    pollEndpoint = baseEndpoint({ host: "" });
    await boot();
    await poll();
    expect(published).toHaveLength(0);

    await moveEndpoint({ host: "10.0.0.7" });
    await poll();

    expect(published).toHaveLength(1);
    expect(status().inverter.lastError).toBeNull();
  });

  test("a house load of zero is a reading, not a missing value", async () => {
    await boot();
    readResult = async () => liveSample({ ...READINGS, "load.power": 0 });

    await poll();

    expect(loadSamples).toEqual([0]);
  });

  test("a negative house load (net export) is passed through unchanged", async () => {
    await boot();
    readResult = async () => liveSample({ ...READINGS, "load.power": -450 });

    await poll();

    expect(loadSamples).toEqual([-450]);
  });

  test("a load reading that is absent or not finite is reported as unknown", async () => {
    await boot();
    readResult = async () => liveSample({ "battery.soc": 55 });
    await poll();
    readResult = async () => liveSample({ ...READINGS, "load.power": Number.NaN });
    await poll();

    expect(loadSamples).toEqual([null, null]);
  });

  test("a plant that maps no load role reports no load", async () => {
    await boot(meterlessProfile());

    await poll();
    await poll();

    // Memoized per context: the second tick must reach the same answer.
    expect(loadSamples).toEqual([null, null]);
  });

  test("switching profiles re-derives which key carries the house load", async () => {
    await boot(meterlessProfile());
    await poll();
    expect(loadSamples).toEqual([null]);

    await boot(mainProfile());
    await poll();

    expect(loadSamples).toEqual([null, 1200]);
  });
});

describe("when the inverter stops answering", () => {
  test("the connection is marked lost and the transport message reaches /api/status", async () => {
    await boot();
    await poll();
    readResult = async () => {
      throw new Error("ETIMEDOUT reading holding registers 10..13");
    };

    await poll();

    expect(status().inverter).toMatchObject({
      connected: false,
      lastError: "ETIMEDOUT reading holding registers 10..13",
      // The last good sample time is deliberately kept.
      lastSampleAt: "2026-08-15T10:00:00.000Z",
    });
    expect(published).toHaveLength(1);
  });

  test("the same failure repeating every second is logged once, not once per tick", async () => {
    await boot();
    readResult = async () => {
      throw new Error("ECONNREFUSED");
    };

    await poll();
    await poll();
    await poll();

    expect(linesStartingWith("poll loop error")).toHaveLength(1);
    expect(status().inverter.lastError).toBe("ECONNREFUSED");
  });

  test("an unchanged outage is re-logged after five minutes so it stays visible", async () => {
    setSystemTime(new Date("2026-08-15T10:00:00.000Z"));
    await boot();
    readResult = async () => {
      throw new Error("ECONNREFUSED");
    };
    await poll();
    await poll();
    expect(linesStartingWith("poll loop error")).toHaveLength(1);

    setSystemTime(new Date("2026-08-15T10:04:59.000Z"));
    await poll();
    expect(linesStartingWith("poll loop error")).toHaveLength(1);

    setSystemTime(new Date("2026-08-15T10:05:00.000Z"));
    await poll();
    expect(linesStartingWith("poll loop error")).toHaveLength(2);
  });

  test("a different failure is logged immediately", async () => {
    await boot();
    readResult = async () => {
      throw new Error("ECONNREFUSED");
    };
    await poll();
    readResult = async () => {
      throw new Error("CRC mismatch");
    };
    await poll();

    expect(linesStartingWith("poll loop error").map((l) => l.values.error)).toEqual([
      "ECONNREFUSED",
      "CRC mismatch",
    ]);
  });

  test("a recovery resets the collapse, so the same error is logged again afterwards", async () => {
    await boot();
    readResult = async () => {
      throw new Error("ECONNREFUSED");
    };
    await poll();
    readResult = async () => liveSample();
    await poll();
    expect(status().inverter).toMatchObject({ connected: true, lastError: null });

    readResult = async () => {
      throw new Error("ECONNREFUSED");
    };
    await poll();

    expect(linesStartingWith("poll loop error")).toHaveLength(2);
  });

  test("a thrown non-Error still surfaces as a status message", async () => {
    await boot();
    readResult = async () => {
      throw "socket closed by peer";
    };

    await poll();

    expect(status().inverter.lastError).toBe("socket closed by peer");
  });
});

describe("the history write buffer", () => {
  // The buffer's own boundaries — the cap, the oldest-row drop, the re-queue
  // after a failed transaction, the concurrent-flush guard — are covered in
  // `history-buffer.test.ts`, which drives the buffer directly. What remains
  // here is the runtime's orchestration of it: that it flushes on shutdown, is
  // drained before a source swap, and buffers across polls (see "the poll loop").
  test("a clean shutdown persists whatever is still buffered", async () => {
    await boot();
    await poll();
    expect(inserted).toHaveLength(0);

    await stop();

    expect(inserted).toHaveLength(1);
    // The poll's two telemetry readings; its two configuration values are
    // flushed to the change-log by the same shutdown path.
    expect(inserted[0]).toHaveLength(2);
    expect(configInserted[0]).toHaveLength(2);
  });
});

describe("the write seam is reachable from outside the poll loop", () => {
  /** A registered device with no endpoint, no registers and no poll — #172's shape. */
  const optimizer = deviceInstance({
    id: "optimizer",
    deviceClass: "optimizer",
    integration: "optimizer",
    metrics: [{ key: "decision.target", unit: "A", group: "misc", access: "r" }],
  });
  const commitTime = new Date("2026-08-15T10:00:00.000Z");
  const laterTime = new Date("2026-08-15T10:00:05.000Z");

  test("a device with no endpoint is written through the runtime's OWN writer", async () => {
    // #88 (EVCC pushing samples off MQTT) and #172 (the optimizer recording its
    // decisions) have an instance and a set of readings, and no poll loop. If
    // the seam is not reachable from the runtime they each have to stand up a
    // second `createDeviceWriter` — a second set of history buffers, a second
    // identity resolver and a second flush cadence per integration.
    await boot();

    runtime.commit(optimizer, { time: commitTime, metrics: { "decision.target": 16 } });
    runtime.commit(optimizer, { time: laterTime, metrics: { "decision.target": 10 } });
    await stop();

    const rows = inserted.flat().filter((r) => r.inverterId === "optimizer");
    // Two intervals: the first closed by the second commit, the second by the
    // shutdown flush — the same change-encoding every polled device gets, from
    // the same buffers and the same flush cadence.
    expect(rows.map((r) => [r.metric, r.value])).toEqual([
      ["decision.target", 16],
      ["decision.target", 10],
    ]);
    expect(rows[0]).toEqual({
      inverterId: "optimizer",
      metric: "decision.target",
      time: commitTime,
      value: 16,
      durMs: 5000,
    });
  });

  test("a device with no poll loop is flushed on the cadence even though no profile booted", async () => {
    // `../index.ts` guards `runtime.start` with `if (ctx)`, and the flush
    // schedule is armed inside `start`. But the plant row is created whether or
    // not a profile is active, and the EVCC registrar is wired unconditionally —
    // so on a boot with a plant and no active profile (a fresh install past
    // provisioning, or a configured profile that failed to load) the seam's rows
    // went into a buffer that nothing flushed until shutdown, capped at 100 000
    // rows with the oldest dropped past that.
    runtime.armStorage();
    runtime.commit(optimizer, { time: commitTime, metrics: { "decision.target": 16 } });
    runtime.commit(optimizer, { time: laterTime, metrics: { "decision.target": 10 } });

    await fire(FLUSH_MS);

    const rows = inserted.flat().filter((r) => r.inverterId === "optimizer");
    expect(rows.map((r) => r.value)).toEqual([16]);
  });

  test("arming storage twice does not stack a second flush schedule", async () => {
    runtime.armStorage();
    runtime.armStorage();

    expect(armedAt(FLUSH_MS)).toHaveLength(1);
  });

  test("a device retired under a running server is forgotten when the roster says so", async () => {
    // `writer.forget` was dead in production: a retired device kept its policy
    // and its open intervals until `stop()`, which then flushed them under the
    // retired slug — hours later, timestamped now.
    await boot();
    extraDevices = [optimizer];
    await reloadEndpoint();
    runtime.commit(optimizer, { time: commitTime, metrics: { "decision.target": 16 } });

    // The operator retires it. The roster re-read is where that becomes true.
    extraDevices = [];
    await reloadEndpoint();

    const rows = inserted.flat().filter((r) => r.inverterId === "optimizer");
    expect(rows.map((r) => r.value)).toEqual([16]);

    // And nothing of its is still held: shutdown adds no second copy.
    const before = inserted.flat().length;
    await stop();
    expect(inserted.flat().filter((r) => r.inverterId === "optimizer")).toHaveLength(1);
    expect(inserted.flat().length).toBeGreaterThanOrEqual(before);
  });
});

describe("swapping the live source", () => {
  test("buffered history is drained before a new inverter id can claim it", async () => {
    await boot();
    await poll();
    expect(inserted).toHaveLength(0);

    await moveEndpoint({ host: "10.0.0.8" });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.every((row) => row.inverterId === DEVICE_SLUG)).toBe(true);
    expect(sources).toHaveLength(2);
  });

  test("the previous source is closed and its loop torn down before the new cadence", async () => {
    await boot();
    const first = latestSource();
    const firstTimer = timerFor(60_000);

    await moveEndpoint({ pollIntervalMs: 5000 });

    expect(first.closed).toBe(1);
    expect(cleared).toContain(firstTimer.handle);
    expect(armedAt(5000)).toHaveLength(1);
    expect(latestSource()).not.toBe(first);
  });

  // `connected` is seeded from `INVERTER_SIMULATE`, which under
  // SKIP_ENV_VALIDATION is the raw (absent) environment value rather than the
  // parsed boolean — hence truthy/falsy rather than an identity check on the
  // seed. The value the loop itself sets is asserted exactly.
  test("a real inverter is pessimistic until its first successful read", async () => {
    await boot();
    expect(status().inverter.connected).toBeFalsy();

    await poll();

    expect(status().inverter.connected).toBe(true);
  });

  test("a simulated inverter is connected before it has read anything, host or not", async () => {
    process.env.INVERTER_SIMULATE = "true";
    try {
      await boot();
      await moveEndpoint({ host: "" });

      expect(status().inverter.connected).toBeTruthy();
      expect(status().inverter.lastError).toBeNull();

      // Simulation ignores the connection entirely, so the loop still runs.
      await poll();
      expect(published).toHaveLength(1);
    } finally {
      if (originalSimulate === undefined) delete process.env.INVERTER_SIMULATE;
      else process.env.INVERTER_SIMULATE = originalSimulate;
    }
  });

  test("a stale poll error is cleared by the swap, not carried into the new source", async () => {
    await boot();
    readResult = async () => {
      throw new Error("ECONNREFUSED");
    };
    await poll();
    expect(status().inverter.lastError).toBe("ECONNREFUSED");

    await moveEndpoint({ host: "10.0.0.8" });

    expect(status().inverter.lastError).toBeNull();
    // …and the same error on the new source is logged again rather than collapsed.
    await poll();
    expect(linesStartingWith("poll loop error")).toHaveLength(2);
  });
});

describe("the MQTT bridge", () => {
  test("a fresh bridge is seeded with the current forecast, both variants", async () => {
    forecastResult = forecastFixture();

    await boot();
    await settle();

    expect(forecastConfigSeen).toBe(WEATHER_CONFIG);
    const published0 = latestBridge().forecasts[0] as {
      raw: { todayKwh: number; detailedForecast: { period_start: string; watts: number }[] };
      usable: { todayKwh: number; detailedForecast: { period_start: string; watts: number }[] };
    };
    expect(published0.usable.todayKwh).toBe(7);
    expect(published0.raw.todayKwh).toBe(8.5);
    // The plant-local slot times become offset-aware timestamps for HA.
    expect(published0.usable.detailedForecast[0]).toEqual({
      period_start: "2026-08-15T10:00:00+02:00",
      watts: 3000,
    });
    expect(published0.raw.detailedForecast[1]?.watts).toBe(5000);
  });

  test("the bridge is named by the plant and device slugs, never by the profile id", async () => {
    await boot();
    await settle();

    expect(bridgeCtx?.plantSlug).toBe("test-plant");
    expect(bridgeCtx?.deviceSlug).toBe("inverter");
    // The point of the whole change: Home Assistant keys entities on `unique_id`
    // and a discovery announcement is retained, so an identity built from the
    // profile id is renamed — irreversibly — the first time the profile changes.
    expect(bridgeCtx?.plantSlug).not.toBe(bridgeCtx?.profile.id);
    expect(bridgeCtx?.deviceSlug).not.toBe(bridgeCtx?.profile.id);
  });

  test("the namespace is read once per bridge rebuild, not once per publish", async () => {
    await boot();
    await settle();
    const afterBoot = namespaceReads.length;
    expect(afterBoot).toBe(1);

    // Several forecast publishes go out on the seeded bridge; none of them may
    // re-read a value the schema freezes.
    await settle();
    expect(namespaceReads.length).toBe(afterBoot);

    await applyMqttConfig(baseMqttConfig({ brokerUrl: "mqtt://elsewhere:1883" }));
    await settle();
    expect(namespaceReads.length).toBe(afterBoot + 1);
  });

  test("an unprovisioned spine turns MQTT OFF and leaves the poll loop running", async () => {
    const { MissingMqttNamespaceError } = await import("./mqtt-namespace");
    namespaceOutcome = new MissingMqttNamespaceError("no device row can name the MQTT namespace");

    await boot();
    await poll();
    await settle();

    // No bridge — and crucially not a bridge announced under a name that could
    // never be corrected.
    expect(bridges).toHaveLength(0);
    // The readings are what the plant is for; they must survive a broker-less boot.
    expect(published.length).toBeGreaterThan(0);
    expect(status().inverter.lastError).toBeNull();
  });

  test("a DATABASE failure is treated the same as a missing row, not thrown into start()", async () => {
    // Not a MissingMqttNamespaceError. The first version of this guard rethrew
    // anything else, so a missing database client aborted the runtime and handed
    // the addon's supervisor a crash loop — on the one deployment target whose
    // supervisor restarts forever.
    namespaceOutcome = new Error("connection refused");

    await boot();
    await poll();
    await settle();

    expect(bridges).toHaveLength(0);
    expect(published.length).toBeGreaterThan(0);
  });

  test("a disabled forecast publishes null rather than a stale curve", async () => {
    forecastResult = null;

    await boot();
    await settle();

    expect(latestBridge().forecasts).toEqual([null]);
  });

  test("a forecast provider failure is logged and never breaks the bridge swap", async () => {
    forecastError = "open-meteo returned 503";

    await boot();
    await settle();

    expect(bridges).toHaveLength(1);
    expect(linesStartingWith("forecast publish failed")).toHaveLength(1);
    expect(latestBridge().forecasts).toHaveLength(0);
  });

  test("the forecast is re-published on its own cadence", async () => {
    forecastResult = forecastFixture();
    await boot();
    await settle();
    expect(latestBridge().forecasts).toHaveLength(1);

    await fire(FORECAST_MS);

    expect(latestBridge().forecasts).toHaveLength(2);
  });

  test("changing broker settings closes the previous connection", async () => {
    await boot();
    const first = latestBridge();

    await applyMqttConfig(baseMqttConfig({ brokerUrl: "mqtt://other.test:1883" }));
    await settle();

    expect(first.closed).toBe(1);
    expect(latestBridge()).not.toBe(first);
    expect(latestBridge().config.brokerUrl).toBe("mqtt://other.test:1883");
  });

  test("disabling MQTT leaves no bridge, and nothing is published to one", async () => {
    mqttConfig = baseMqttConfig({ enabled: false });
    forecastResult = forecastFixture();

    await boot();
    await settle();
    await poll();
    await fire(FORECAST_MS);

    expect(bridges).toHaveLength(0);
    expect(status().mqtt).toEqual({ enabled: false, connected: false, lastError: null });
    // The publisher short-circuits before it even asks the provider.
    expect(forecastConfigSeen).toBeNull();
  });

  test("an inbound broker command goes through the same write funnel as every other path", async () => {
    await boot();

    await bridgeWrite?.(TARGET, 45);

    expect(latestSource().writes).toEqual([{ key: TARGET, value: 45 }]);
  });
});

describe("register writes", () => {
  test("a plain register write reaches the live source unchanged", async () => {
    await boot();

    await write(TARGET, 60);

    expect(latestSource().writes).toEqual([{ key: TARGET, value: 60 }]);
  });

  test("a write to a key the profile does not define is refused, never handed on", async () => {
    await boot();

    await expect(write("vendor.undocumented", 3)).rejects.toThrow(
      "Unknown entity: vendor.undocumented",
    );
    expect(latestSource().writes).toEqual([]);
  });

  test("a transport failure on write is surfaced, not swallowed", async () => {
    await boot();
    writeError = "Modbus exception 4: slave device failure";

    await expect(write(TARGET, 60)).rejects.toThrow("Modbus exception 4");
  });

  test("locking a composite control snapshots the live value and writes the locked one", async () => {
    await boot();
    await poll(); // the lock captures what the register currently reads

    await write(LOCK, 1);

    expect(latestSource().writes).toEqual([{ key: TARGET, value: 0 }]);
    expect(controlState[controlStateKey(PROFILE_ID, LOCK)]).toMatchObject({ previousValue: 30 });
  });

  test("locking is refused while the current register value is unknown", async () => {
    await boot();
    readResult = async () => liveSample({ "battery.soc": 55 });
    await poll();

    await expect(write(LOCK, 1)).rejects.toThrow(/current value of "settings.max_discharge"/);
    expect(latestSource().writes).toEqual([]);
    expect(controlState).toEqual({});
  });

  test("unlocking restores the captured value and clears the snapshot", async () => {
    await boot();
    await poll();
    await write(LOCK, 1);

    await write(LOCK, 0);

    expect(latestSource().writes).toEqual([
      { key: TARGET, value: 0 },
      { key: TARGET, value: 30 },
    ]);
    expect(controlState).toEqual({});
  });

  test("the lock state rides along in every sample, even though it owns no register", async () => {
    await boot();
    await poll();
    expect(published[0]?.metrics[LOCK]).toBe(0);

    await write(LOCK, 1);
    await poll();

    expect(published[1]?.metrics[LOCK]).toBe(1);
    expect(liveState.latest?.metrics[LOCK]).toBe(1);
  });
});

describe("the background jobs", () => {
  test("boot arms the flush, forecast, learn and price schedules exactly once", async () => {
    await boot();

    expect(armedAt(FLUSH_MS)).toHaveLength(1);
    expect(armedAt(FORECAST_MS)).toHaveLength(1);
    expect(armedAt(LEARN_MS)).toHaveLength(1);
    expect(armedAt(LEARN_KICK_MS, "timeout")).toHaveLength(1);
    expect(armedAt(SPOT_MS)).toHaveLength(1);
    expect(armedAt(SPOT_KICK_MS, "timeout")).toHaveLength(1);
  });

  test("a second boot re-points the source without stacking a second set of jobs", async () => {
    await boot();
    await boot();

    expect(armedAt(FLUSH_MS)).toHaveLength(1);
    expect(armedAt(FORECAST_MS)).toHaveLength(1);
    expect(armedAt(LEARN_MS)).toHaveLength(1);
    expect(armedAt(SPOT_MS)).toHaveLength(1);
    // Only the poll loop is rebuilt, because the connection config was re-read.
    expect(armedAt(pollEndpoint.pollIntervalMs)).toHaveLength(2);
  });

  test("the forecast correction is kicked shortly after boot and twice a day after that", async () => {
    await boot();

    await fire(LEARN_KICK_MS, "timeout");
    expect(learnRuns).toBe(1);
    expect(learnConfigSeen).toBe(WEATHER_CONFIG);

    await fire(LEARN_MS);
    expect(learnRuns).toBe(2);
  });

  test("a failing correction run is logged, never thrown into the timer", async () => {
    await boot();
    learnError = "reanalysis archive unavailable";

    await fire(LEARN_KICK_MS, "timeout");

    expect(linesStartingWith("forecast correction learn failed")).toHaveLength(1);
  });

  test("the price sync is kicked shortly after boot and every half hour after that", async () => {
    await boot();

    await fire(SPOT_KICK_MS, "timeout");
    expect(spotRuns).toBe(1);

    await fire(SPOT_MS);
    expect(spotRuns).toBe(2);
  });

  test("only a run that actually stored slots wakes the open dashboards", async () => {
    await boot();
    streams.subscribe("statistics", () => {
      spotSyncNotifications++;
    });

    spotOutcome = "complete";
    await syncSpotPricesNow();
    expect(spotSyncNotifications).toBe(0);

    spotOutcome = "stored";
    spotStored = 96;
    await syncSpotPricesNow();
    expect(spotSyncNotifications).toBe(1);
  });

  test("a failing price sync is logged and leaves the schedule intact", async () => {
    await boot();
    spotError = "ENTSO-E rejected the token";

    await syncSpotPricesNow();

    expect(linesStartingWith("spot price sync failed")).toHaveLength(1);
    expect(spotSyncNotifications).toBe(0);
  });
});

describe("shutdown", () => {
  test("every timer is cleared and both connections released", async () => {
    await boot();
    await poll();
    const source = latestSource();
    const bridge = latestBridge();
    const handles = [
      timerFor(pollEndpoint.pollIntervalMs).handle,
      timerFor(FLUSH_MS).handle,
      timerFor(FORECAST_MS).handle,
      timerFor(LEARN_MS).handle,
      timerFor(LEARN_KICK_MS, "timeout").handle,
      timerFor(SPOT_MS).handle,
      timerFor(SPOT_KICK_MS, "timeout").handle,
    ];

    await stop();

    for (const handle of handles) expect(cleared).toContain(handle);
    expect(source.closed).toBe(1);
    expect(bridge.closed).toBe(1);
    expect(automation.stopped).toBe(1);
  });

  test("the automations audience predicate reaches the engine that short-circuits on it", async () => {
    const ctx = buildProfileContext(mainProfile());
    // The loop only starts once a device is registered to key its state by.
    registryProfile = mainProfile();
    streams = createStreams();
    let watched = false;

    await start(streams, ctx, () => watched);

    // The identity is not the contract — the *answer* is. A forward that
    // captured the boolean once (rather than the predicate) would read false
    // forever, and the automations page would never receive a frame.
    expect(automation.watching?.()).toBe(false);
    watched = true;
    expect(automation.watching?.()).toBe(true);
  });

  test("automations are stopped before the loop that feeds them", async () => {
    await boot();
    expect(automation.started).toBe(1);
    // The loop is handed the registered DEVICE — the identity its state is
    // namespaced by — not the profile that happens to describe it.
    expect(automation.deviceId).toBe(DEVICE_SLUG);
    const pollHandle = timerFor(pollEndpoint.pollIntervalMs).handle;
    // Nothing has been torn down yet, so the count below starts from zero.
    expect(cleared).toHaveLength(0);

    await stop();

    expect(automation.stopped).toBe(1);
    // The ordering is the point: a rule firing during shutdown writes through
    // the same funnel as everything else, so automations have to be stopped
    // while the loop and the transport are still up. Had `stopAutomations` run
    // anywhere later, timers would already have been cleared by this moment.
    expect(automation.clearedAtStop).toBe(0);
    expect(cleared).toContain(pollHandle);
  });

  test("with no registered inverter the automation loop is not started at all", async () => {
    // Every register the loop takes is snapshotted under a device id. With no
    // device there is no identity to key that snapshot by, so starting would
    // mean steering the plant with no way to hand the user's value back.
    registryProfile = null;
    streams = createStreams();

    await start(streams, buildProfileContext(mainProfile()));

    expect(automation.started).toBe(0);
    expect(automation.deviceId).toBeNull();
  });

  test("stopping twice is safe", async () => {
    await boot();

    await stop();
    await expect(stop()).resolves.toBeUndefined();
  });

  test("a restart re-arms the schedules that shutdown tore down", async () => {
    await boot();
    await stop();
    armed = [];

    await boot();

    expect(armedAt(FLUSH_MS)).toHaveLength(1);
    expect(armedAt(SPOT_MS)).toHaveLength(1);
  });
});

describe("testing a connection before saving it", () => {
  const probeSample = () =>
    liveSample({
      "settings.mode": 1,
      "load.power": 1200,
      "battery.soc": 55,
      "mystery.value": 7,
      [TARGET]: 30,
    });

  test("the full snapshot comes back sorted by group then label, with enum labels resolved", async () => {
    registryProfile = mainProfile();
    readResult = async () => probeSample();

    const result = await testInverter(null, baseEndpoint());

    expect(result.ok).toBe(true);
    expect(result.metricCount).toBe(5);
    expect(result.metrics).toEqual([
      { key: "battery.soc", label: "Battery SOC", unit: "%", group: "battery", value: 55 },
      { key: "load.power", label: "House load", unit: "W", group: "load", value: 1200 },
      // Unmapped by the profile: raw key, no unit, "other".
      { key: "mystery.value", label: "mystery.value", unit: null, group: "other", value: 7 },
      { key: TARGET, label: "Max discharge", unit: "A", group: "settings", value: 30 },
      {
        key: "settings.mode",
        label: "Work mode",
        unit: null,
        group: "settings",
        value: 1,
        display: "Sell",
      },
    ]);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("an explicit profile id is resolved without the runtime being started", async () => {
    resolveOverride = (id) => (id === PROFILE_ID ? mainProfile() : null);
    readResult = async () => liveSample({ "battery.soc": 55 });

    const result = await testInverter(PROFILE_ID, baseEndpoint({ host: "10.0.0.99" }));

    expect(result.ok).toBe(true);
    expect(latestSource().config.host).toBe("10.0.0.99");
  });

  test("the probe never disturbs the live source, and is always closed", async () => {
    await boot();
    const live = latestSource();
    registryProfile = mainProfile();
    readResult = async () => probeSample();

    await testInverter(null, baseEndpoint({ host: "10.0.0.42" }));
    const probe = latestSource();

    expect(probe).not.toBe(live);
    expect(probe.closed).toBe(1);
    expect(live.closed).toBe(0);
    expect(live.reads).toBe(0);
    expect(published).toHaveLength(0);
  });

  test("a failing read is reported, and the probe is still closed", async () => {
    registryProfile = mainProfile();
    readResult = async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.42:502");
    };

    const result = await testInverter(null, baseEndpoint());

    expect(result).toEqual({ ok: false, error: "connect ECONNREFUSED 10.0.0.42:502" });
    expect(latestSource().closed).toBe(1);
  });

  test("a thrown non-Error is stringified rather than lost", async () => {
    registryProfile = mainProfile();
    readResult = async () => {
      throw "gateway timeout";
    };

    await expect(testInverter(null, baseEndpoint())).resolves.toEqual({
      ok: false,
      error: "gateway timeout",
    });
  });
});

describe("testing a broker before saving it", () => {
  const config = () => baseMqttConfig({ brokerUrl: "mqtt://probe.test:1883" });

  test("a successful connect reports ok and hangs up the throwaway client", async () => {
    const pending = testMqtt(config());
    mqttClient?.emit("connect");

    await expect(pending).resolves.toEqual({ ok: true });
    expect(mqttClient?.ends).toEqual([{ force: true }]);
  });

  test("credentials are offered and a bad broker is never retried", async () => {
    const pending = testMqtt(config());
    mqttClient?.emit("connect");
    await pending;

    expect(mqttClient?.url).toBe("mqtt://probe.test:1883");
    expect(mqttClient?.options).toMatchObject({
      username: "user",
      password: "secret",
      connectTimeout: 4000,
      reconnectPeriod: 0,
    });
  });

  test("the broker's own error message is handed back", async () => {
    const pending = testMqtt(config());
    mqttClient?.emit("error", new Error("Connection refused: Not authorized"));

    await expect(pending).resolves.toEqual({
      ok: false,
      error: "Connection refused: Not authorized",
    });
  });

  test("a broker that never answers gives up rather than hanging the settings page", async () => {
    shortenBrokerTimeout = true;

    await expect(testMqtt(config())).resolves.toEqual({
      ok: false,
      error: "connection timed out",
    });
    expect(mqttClient?.ends).toEqual([{ force: true }]);
  });

  test("an error arriving after a successful connect does not overturn the result", async () => {
    const pending = testMqtt(config());
    mqttClient?.emit("connect");
    mqttClient?.emit("error", new Error("broker went away"));

    await expect(pending).resolves.toEqual({ ok: true });
    expect(mqttClient?.ends).toHaveLength(1);
  });
});
