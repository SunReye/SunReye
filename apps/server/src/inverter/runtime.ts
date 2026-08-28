/**
 * Runtime controller — owns the live inverter source, the poll loop, and the
 * MQTT bridge, and rebuilds them on the fly when connection settings change so
 * the operator never has to restart the process.
 *
 * The God-loop lives here: poll the source, cache the sample, persist it, hand
 * it to the WebSocket publisher (injected via {@link Runtime.start}), and
 * publish it to the MQTT bridge. Connection health is tracked for the
 * `/api/status` endpoint.
 *
 * The controller is a {@link createRuntime} factory: every field it owns is
 * closure-local, so a second instance shares nothing with the first. The
 * module keeps a single default instance and re-exports its methods, so no
 * call site changes.
 */

import { db } from "@SunReye/db";
import type { InverterConfig } from "@SunReye/db/inverter-config";
import { type PollEndpoint, loadPollEndpoint } from "./endpoint";
import type { MqttConfig } from "@SunReye/db/mqtt-config";
import { metricsConfigLog, metricsRaw } from "@SunReye/db/schema/metrics";
import { env } from "@SunReye/env/server";
import { type InverterSample, type InverterSource, metricKeySpecs } from "@SunReye/inverter-core";
import mqtt from "mqtt";
import { startAutomations, stopAutomations } from "../automation/automation";
import { getMqttConfig } from "../settings/config";
import type { ControlStore } from "./control-expr";
import { dbControlStore } from "./control-store";
import { createControlWriter } from "./control-writer";
import { type HistoryBuffer, createHistoryBuffer } from "./history-buffer";
import { type StoragePolicy, type StorageRow, createStoragePolicy } from "./storage-policy";
import { createIdentifiedCommit, createRowIdentifier } from "./storage-identity";
import { type IdentityResolver, createIdentityResolver } from "../shared/identity";
import { type JobScheduler, createJobScheduler } from "./job-scheduler";
import { evccOnLoadSample } from "../evcc/evcc";
import {
  buildProfileContext,
  buildSource,
  getActiveProfileOrNull,
  resolveProfileById,
  type ProfileContext,
} from "./inverter";
import { runForecastCorrectionLearn } from "../forecast/forecast-correction-job";
import { log } from "../shared/logging";
import { type MqttBridge, startMqttBridge } from "./mqtt";
import { fetchSolarForecast, toForecastExport } from "../forecast/solar-forecast";
import { runSpotPriceSync } from "../prices/spot-price-job";
import { getSpotPriceConfig } from "../settings/spot-price-settings";
import { liveState } from "../shared/state";
import { getWeatherConfig } from "../settings/weather-settings";
import type { Streams } from "../shared/streams";

const logger = log("runtime");

/** Re-log an unchanged, ongoing poll failure at most this often. */
const POLL_ERROR_RELOG_MS = 300_000;

// The PV forecast changes slowly (provider cache is 30 min) and its topics are
// retained, so re-publishing every 5 minutes keeps HA fresh without churn.
const FORECAST_PUBLISH_INTERVAL_MS = 5 * 60_000;

// The correction learns from newly-*settled* reanalysis days, so there's at most
// one new day to fold in per day — twice-daily is ample, with a short post-boot
// kick so a fresh install backfills without waiting a full interval.
const LEARN_INTERVAL_MS = 12 * 3600_000;
const LEARN_KICK_DELAY_MS = 2 * 60_000;

// Day-ahead prices clear around 12:45–13:10 market time, but not reliably — a
// timer aimed at the publication moment would turn a short delay into a day-long
// outage. So poll on a plain interval, which no-ops (one indexed count, zero
// network) once both delivery days are stored; the interval *is* the retry.
const SPOT_INTERVAL_MS = 30 * 60_000;
const SPOT_KICK_DELAY_MS = 30_000;

/** One captured value from a test read, enriched for a plausibility check. */
export interface TestSnapshotMetric {
  key: string;
  label: string;
  unit: string | null;
  group: string;
  value: number;
  /** Enum label for the raw value, when the metric is an enum/status. */
  display?: string;
}

export interface TestInverterResult {
  ok: boolean;
  error?: string;
  metricCount?: number;
  /** Wall-clock duration of the single test read, ms. */
  durationMs?: number;
  /** Full snapshot of captured values, sorted by group then label. */
  metrics?: TestSnapshotMetric[];
}

/** Collaborators injected into a runtime; each defaults to its production wiring. */
export interface RuntimeDeps {
  /**
   * The batched history writer. Defaults to one committing to the real db — the
   * only collaborator the runtime holds mutable buffer state for, lifted out so
   * it owns its own cap/drop/re-queue boundaries and is tested without a runtime.
   *
   * It buffers {@link StorageRow}s — the NAME-carrying shape the storage policy
   * produces — and the id translation happens inside the commit. See
   * `./storage-identity.ts` for why the boundary is there and not in the policy.
   */
  history?: HistoryBuffer<StorageRow>;
  /**
   * The batched writer for the configuration change-log — the second
   * destination the storage policy routes to. Same batching contract as
   * {@link history}, a different table: configuration registers are not
   * timeseries, and rewriting them into the hypertable every poll was 34 % of
   * every row this app wrote.
   */
  configLog?: HistoryBuffer<StorageRow>;
  /**
   * The background job scheduler. Defaults to one arming the process globals; it
   * owns the arm/teardown of the flush, forecast, learn and price schedules (and
   * their post-boot kicks) so the runtime states them once and never juggles a
   * handle. The poll loop is not one of its jobs — its cadence is re-armed on
   * every source rebuild, so the runtime keeps it.
   */
  scheduler?: JobScheduler;
  /**
   * Persistent state for composite (`controlExpr`) controls, consumed by both
   * the write funnel and the per-poll state injection. Defaults to the
   * `app_settings`-backed store; injected so a test drives the funnel against an
   * in-memory double and this module no longer needs the store mocked.
   */
  controlStore?: ControlStore;
  /**
   * The EV charge-power estimator's house-load hook, fed one sample (W, or null
   * when the profile maps no load) per poll. Defaults to the real EVCC ingest's
   * {@link evccOnLoadSample} (a no-op when EVCC is off); injected so a test
   * records the per-poll load through a spy rather than mocking `../evcc/evcc`.
   */
  onLoadSample?: (watts: number | null) => void;
  /**
   * The name → int2 resolver both commits and the eager metric registration go
   * through. Defaults to one bound to the real database; injected so a test can
   * assert WHAT was registered — the production resolver's registration is a
   * `void`-ed promise whose rejection is swallowed, so a spec that never arrived
   * is indistinguishable from one that did.
   */
  identity?: IdentityResolver;
}

/**
 * Build a runtime controller. Every collaborator is a module import captured by
 * the closure below (or injected via {@link RuntimeDeps}), and every mutable
 * field is closure-local — no module-level state, so a second instance is
 * independent.
 */
// fallow-ignore-next-line unused-export -- the injection seam exercised by runtime.test.ts (which builds its own instance with a fake history buffer); test files aren't traced as consumers
export function createRuntime(deps: RuntimeDeps = {}) {
  /**
   * The name -> int2 resolution both commits go through. One resolver for both
   * buffers, so a device or metric id is looked up once per process rather than
   * once per table, and closure-local like every other field here.
   */
  const identity = deps.identity ?? createIdentityResolver({ db });
  const rowIdentifier = createRowIdentifier({ resolver: identity, logger });
  /**
   * Commit one batch to `table`, resolving the identity first.
   *
   * These two commits are the ONLY INSERTs into the timeseries and the config
   * change-log, which is exactly why the translation belongs on this path: one
   * place, on the way out, with the in-memory routing above it still keyed by
   * name. The resolve-then-insert step itself lives in `./storage-identity.ts`,
   * where it is reachable by a test — this suite injects both buffers, so a
   * closure built here never runs under test.
   */
  const commitIdentified = (table: typeof metricsRaw | typeof metricsConfigLog) =>
    createIdentifiedCommit({
      identify: (rows) => rowIdentifier.identify(rows),
      insert: (values) => db.insert(table).values(values),
    });
  const historyBuffer =
    deps.history ??
    createHistoryBuffer<StorageRow>({ commit: commitIdentified(metricsRaw), logger });
  const configLogBuffer =
    deps.configLog ??
    createHistoryBuffer<StorageRow>({ commit: commitIdentified(metricsConfigLog), logger });
  const scheduler = deps.scheduler ?? createJobScheduler();
  const onLoadSample = deps.onLoadSample ?? evccOnLoadSample;
  let ctx: ProfileContext | null = null;
  let source: InverterSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let bridge: MqttBridge | null = null;
  /**
   * The read-side bus, injected by {@link start}. Each poll sample is emitted on
   * `metrics` and a price sync that stored fresh slots on `statistics`; the server
   * subscribes the WebSocket broadcasts. Null before boot — the 30 s post-boot
   * price kick can beat the wiring, so every emit here is guarded.
   */
  let streams: Streams | null = null;
  let polling = false;
  /**
   * Whether the current config names something to connect to. A saved config with
   * no host (fresh install, or onboarding where the connection step was never
   * saved) would otherwise connect to the empty host — i.e. localhost — and fail
   * once per tick forever; idle instead and say so once.
   */
  let connectable = false;
  /** Last logged poll failure, to collapse an identical error repeating at 1 Hz. */
  let lastPollError: string | null = null;
  let lastPollErrorAt = 0;

  const inverterStatus = {
    connected: false,
    simulate: env.INVERTER_SIMULATE,
    lastError: null as string | null,
    lastSampleAt: null as string | null,
  };

  // The `load.power` metric key of the active profile, memoized per context (the
  // lookup is a linear scan; the poll loop runs at 1 Hz forever).
  let loadKeyCache: { ctx: ProfileContext; key: string | null } | null = null;
  let policyCache: { ctx: ProfileContext; policy: StoragePolicy } | null = null;

  /** Fetch the current forecast and hand it to the MQTT bridge (no-op if disabled). */
  async function publishForecastNow(): Promise<void> {
    if (!bridge) return;
    try {
      const forecast = await fetchSolarForecast(await getWeatherConfig());
      bridge.publishForecast(
        forecast
          ? { raw: toForecastExport(forecast, "raw"), usable: toForecastExport(forecast, "usable") }
          : null,
      );
    } catch (error) {
      logger.warn("forecast publish failed: {error}", { error });
    }
  }

  /** Fold newly-settled days into the forecast correction grid (no-op if disabled). */
  async function learnCorrectionNow(): Promise<void> {
    try {
      await runForecastCorrectionLearn(await getWeatherConfig());
    } catch (error) {
      logger.warn("forecast correction learn failed: {error}", { error });
    }
  }

  /**
   * Store today's and tomorrow's day-ahead prices (no-op if disabled or already
   * complete). Exported so saving the price source can refresh immediately instead
   * of leaving the UI empty until the next tick.
   */
  async function syncSpotPricesNow(): Promise<void> {
    try {
      const result = await runSpotPriceSync(await getSpotPriceConfig());
      // Only a real upsert changes what price-derived views show; the no-op tick
      // (both delivery days already complete) must not make every open page refetch.
      // A `prices` signal on the statistics topic tells open dashboards their
      // price-derived views are now stale.
      if (result.outcome === "stored") streams?.emit("statistics", { type: "prices" });
    } catch (error) {
      logger.warn("spot price sync failed: {error}", { error });
    }
  }

  /** The active profile context, set by {@link start} before the loop runs. */
  function context(): ProfileContext {
    if (!ctx) throw new Error("runtime not started");
    return ctx;
  }

  /**
   * The storage policy for the active profile: which metrics are timeseries,
   * which are configuration, which are not persisted at all. Cached against the
   * profile context the same way {@link loadPowerOf} caches its key, so a
   * profile swap rebuilds it (and resets its change-log memory) rather than
   * carrying one profile's classes into the next.
   */
  function storagePolicy(): StoragePolicy {
    const current = context();
    if (policyCache?.ctx !== current) {
      // A profile swap ends every open interval. Close them under the outgoing
      // policy first: a series row is written when its interval closes, so
      // dropping the policy instead would lose the currently-held value of every
      // metric — and on a restart loop, that is every metric, every time.
      closeSeriesIntervals();
      policyCache = {
        ctx: current,
        policy: createStoragePolicy({ metrics: current.profile.metrics }),
      };
      // EAGER metric registration, on the same hook and against the same list:
      // the ids then exist before the first poll, so the writer's own fallback
      // (`./storage-identity.ts`) is only ever reached by a key this list did not
      // contain — a computed metric, a replayed capture, a profile edited under a
      // running server. Not awaited, because this function is synchronous by
      // design and the fallback is what makes that safe.
      //
      // `metricKeySpecs` states the key, the COUNTER CLASS and the UNIT together,
      // and all three have to travel with the key for the same reason: a
      // continuous aggregate cannot ask the profile what a metric means. The class
      // decides whether a `counter_agg` partial means anything; the unit is what
      // every reader labels an axis from. Built by the core rather than inline
      // here so the one place that knows what a metric declares is the one place
      // that answers.
      void identity
        .registerMetrics(metricKeySpecs(current.profile.metrics))
        .catch((error: unknown) => {
          logger.warn("metric key registration failed: {error}", { error });
        });
    }
    return policyCache.policy;
  }

  /** Flush the open series intervals into the history buffer (no-op when none). */
  function closeSeriesIntervals(): void {
    if (policyCache) historyBuffer.enqueue(policyCache.policy.close(new Date()));
  }

  /** The house-load value (W) of a sample, or null when the profile has no load role. */
  function loadPowerOf(sample: InverterSample): number | null {
    const current = context();
    if (loadKeyCache?.ctx !== current) {
      loadKeyCache = {
        ctx: current,
        key: current.profile.metrics.find((m) => m.role === "load.power")?.key ?? null,
      };
    }
    if (!loadKeyCache.key) return null;
    const value = sample.metrics[loadKeyCache.key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  /** One poll: read, cache, persist, fan out to WebSocket + MQTT. */
  async function pollOnce(): Promise<void> {
    // Skip if the previous poll is still running (a slow/reconnecting source must
    // not let ticks stack up).
    if (!source || polling || !connectable) return;
    polling = true;
    const active = source;
    try {
      const sample = await active.read();
      inverterStatus.connected = true;
      inverterStatus.lastError = null;
      inverterStatus.lastSampleAt = sample.time;
      lastPollError = null;
      // Composite controls own no register; fold their current (e.g. lock) state
      // into the sample so every downstream surface sees it (same store as the
      // write funnel).
      await controlWriter.injectState(sample);
      liveState.set(sample);
      // The EV charge-power estimator refines its estimate from the 1 Hz house
      // load — between EVCC's much slower publishes (no-op when EVCC is off).
      onLoadSample(loadPowerOf(sample));
      // Persistence only: the live frame below carries every key regardless of
      // where — or whether — its value is stored.
      const routed = storagePolicy().route(sample);
      // Buffer for a batched flush (see {@link historyBuffer}) rather than
      // committing one transaction per poll. An empty list is a no-op in the
      // buffer, so neither destination is guarded here.
      historyBuffer.enqueue(routed.series);
      configLogBuffer.enqueue(routed.config);
      streams?.emit("metrics", sample);
      bridge?.publishSample(sample);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      inverterStatus.connected = false;
      inverterStatus.lastError = message;
      // A dead inverter fails every tick with the same error; log the message (not
      // the stack — at 1 Hz it buries every other line) on change, then only every
      // POLL_ERROR_RELOG_MS so a long outage still shows in the log. `/api/status`
      // always carries the current error regardless.
      const now = Date.now();
      if (message !== lastPollError || now - lastPollErrorAt >= POLL_ERROR_RELOG_MS) {
        lastPollError = message;
        lastPollErrorAt = now;
        logger.error("poll loop error: {error}", { error: message });
      }
    } finally {
      polling = false;
    }
  }

  function restartLoop(intervalMs: number): void {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollOnce, intervalMs);
  }

  /**
   * The register-write funnel: every inbound command (web, MQTT bridge,
   * automation) travels this single awaited path. It reads the live source
   * lazily so a source swap is transparent, and shares its control-state store
   * with the per-poll `injectState`. `write` is bound out as
   * a stable reference the bridge and the automations keep calling through swaps.
   */
  const controlWriter = createControlWriter({
    getSource: () => source,
    getContext: context,
    store: deps.controlStore ?? dbControlStore,
    readLive: (target) => liveState.latest?.metrics[target],
  });
  const { write } = controlWriter;

  /**
   * Point the live source at `endpoint` and re-arm the loop at its cadence.
   *
   * The endpoint comes from the `connections` + `devices` spine
   * (`./endpoint.ts`), never from `app_settings`. Until 2.0.0's dual-authority
   * defect was removed this took the legacy JSONB document while provisioning
   * copied that same document into the tables on every boot — so an operator
   * editing the endpoint row changed nothing and the poll loop could only ever
   * drive one endpoint and one unit id.
   */
  async function rebuildInverter(endpoint: PollEndpoint): Promise<void> {
    // Drain buffered rows before swapping sources so a changed inverterId can't
    // land on rows captured under the previous one.
    closeSeriesIntervals();
    await historyBuffer.flush();
    await configLogBuffer.flush();
    const previous = source;
    source = buildSource(context().profile, endpoint);
    // The simulator is always "connected"; a real Modbus source only proves it on
    // the first successful read, so start pessimistic and let pollOnce flip it.
    inverterStatus.connected = env.INVERTER_SIMULATE;
    inverterStatus.lastError = null;
    lastPollError = null;
    connectable = env.INVERTER_SIMULATE || endpoint.host.trim() !== "";
    if (!connectable) {
      inverterStatus.lastError = "No inverter host configured";
      logger.warn(
        "no inverter host configured — polling idle (set the connection in Settings → Inverter)",
      );
    }
    restartLoop(endpoint.pollIntervalMs);
    if (previous) await previous.close();
  }

  async function rebuildBridge(config: MqttConfig): Promise<void> {
    const previous = bridge;
    bridge = startMqttBridge(config, { ctx: context(), write });
    if (previous) await previous.close();
    // Seed a fresh bridge with the current forecast instead of waiting a full
    // interval; harmless when the forecast is disabled (publishes null → no-op).
    void publishForecastNow();
  }

  /**
   * Boot the controller: build the source + bridge and start polling.
   *
   * `automationsWatched` answers whether anyone is subscribed to the
   * `automations` topic right now. Only the socket boundary knows, so it is
   * passed straight through to the engine loop, which skips the frame (and the
   * plan projection built for it) when nobody is listening.
   */
  async function start(
    streamBus: Streams,
    profileCtx: ProfileContext,
    automationsWatched?: () => boolean,
  ): Promise<void> {
    ctx = profileCtx;
    streams = streamBus;
    // The scheduler arms each of these once and is idempotent while running, so
    // a re-boot re-points the source without stacking a second set of jobs. The
    // flush cadence is read here (env is dynamic) rather than baked in.
    scheduler.start([
      {
        run: () => {
          void historyBuffer.flush();
          void configLogBuffer.flush();
        },
        intervalMs: env.HISTORY_FLUSH_INTERVAL_MS,
      },
      { run: () => void publishForecastNow(), intervalMs: FORECAST_PUBLISH_INTERVAL_MS },
      {
        run: () => void learnCorrectionNow(),
        intervalMs: LEARN_INTERVAL_MS,
        kickMs: LEARN_KICK_DELAY_MS,
      },
      {
        run: () => void syncSpotPricesNow(),
        intervalMs: SPOT_INTERVAL_MS,
        kickMs: SPOT_KICK_DELAY_MS,
      },
    ]);
    await rebuildInverter(await loadPollEndpoint());
    await rebuildBridge(await getMqttConfig());
    // Automations write through the same funnel as every other path; they only
    // run while a profile is active (this function is never called without one).
    // They push their tick outcomes onto the same injected bus.
    await startAutomations({ ctx: profileCtx, write }, streamBus, undefined, automationsWatched);
  }

  /**
   * Re-resolve the endpoint from the spine and rebuild the source on it.
   *
   * Takes no argument, and that is the point: the caller that just saved a
   * connection does not hand the runtime the values it typed — it writes the
   * `connections` row and then asks the loop to re-read the authority. Anything
   * else is the write-back again, one indirection further out.
   *
   * In an onboarding-only boot the runtime isn't started (no active profile), so
   * the save is persisted by the caller but there is nothing live to hot-apply
   * yet — it takes effect on the restart that activates a profile.
   */
  async function reloadEndpoint(): Promise<void> {
    if (!ctx) return;
    await rebuildInverter(await loadPollEndpoint());
  }

  /** Rebuild the MQTT bridge for updated broker/discovery settings. */
  async function applyMqttConfig(config: MqttConfig): Promise<void> {
    if (!ctx) return;
    await rebuildBridge(config);
  }

  /** Live health for `/api/status` (tolerates the not-started onboarding boot). */
  function status() {
    return {
      inverter: { ...inverterStatus, profile: ctx?.profile.id ?? null },
      mqtt: bridge
        ? { enabled: true, ...bridge.status() }
        : { enabled: false, connected: false, lastError: null },
    };
  }

  /**
   * Try a config against a throwaway source without disturbing the live one.
   * Times the read and returns the full captured snapshot so the operator can
   * eyeball every value for plausibility before saving.
   *
   * The profile is resolved independent of the running runtime ({@link resolveProfileById}),
   * so this works during onboarding — before any profile is active — against the
   * chosen (built-in or freshly-installed) profile. A null `profileId` falls back
   * to the active profile, for the ordinary settings-page re-test.
   */
  async function testInverter(
    profileId: string | null,
    config: InverterConfig,
  ): Promise<TestInverterResult> {
    const profile = profileId ? await resolveProfileById(profileId) : getActiveProfileOrNull();
    if (!profile) {
      return {
        ok: false,
        error: profileId ? `Unknown profile "${profileId}"` : "No profile selected",
      };
    }
    const testCtx = buildProfileContext(profile);
    const probe = buildSource(profile, config);
    try {
      const started = performance.now();
      const sample = await probe.read();
      const durationMs = Math.round(performance.now() - started);
      const metrics = Object.entries(sample.metrics)
        .map(([key, value]) => {
          const meta = testCtx.metaByKey.get(key);
          const display = meta?.enumLabels?.[value];
          return {
            key,
            label: meta?.label ?? key,
            unit: meta?.unit ?? null,
            group: meta?.group ?? "other",
            value,
            ...(display ? { display } : {}),
          };
        })
        .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
      return { ok: true, metricCount: metrics.length, durationMs, metrics };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      await probe.close();
    }
  }

  /** Try connecting to a broker without disturbing the live bridge. */
  function testMqtt(config: MqttConfig): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const client = mqtt.connect(config.brokerUrl, {
        username: config.username,
        password: config.password,
        connectTimeout: 4000,
        reconnectPeriod: 0, // one shot — don't loop retrying a bad broker
      });
      let settled = false;
      const done = (result: { ok: boolean; error?: string }) => {
        if (settled) return;
        settled = true;
        client.end(true, () => {});
        resolve(result);
      };
      client.once("connect", () => done({ ok: true }));
      client.once("error", (err) => done({ ok: false, error: err.message }));
      setTimeout(() => done({ ok: false, error: "connection timed out" }), 5000);
    });
  }

  /** Stop polling and release the source + bridge (graceful shutdown). */
  async function stop(): Promise<void> {
    // Stops the tick only — deliberately no register restore, so a reboot with
    // the automation enabled resumes seamlessly (its snapshot is persisted).
    await stopAutomations();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    // Clears the flush, forecast, learn and price schedules (and their kicks) —
    // every timer but the poll loop, which the runtime owns because it is re-armed
    // on each source rebuild.
    scheduler.stop();
    // Persist whatever is buffered so a clean shutdown never drops history —
    // including the interval each metric currently has open.
    closeSeriesIntervals();
    await historyBuffer.flush();
    await configLogBuffer.flush();
    await bridge?.close();
    await source?.close();
  }

  return {
    start,
    write,
    status,
    stop,
    reloadEndpoint,
    applyMqttConfig,
    testInverter,
    testMqtt,
    syncSpotPricesNow,
  };
}

/**
 * The single default instance the process runs. The module re-exports its
 * methods so every existing `import * as runtime` call site is unchanged.
 */
const defaultRuntime = createRuntime();

export const start = defaultRuntime.start;
export const write = defaultRuntime.write;
export const status = defaultRuntime.status;
export const stop = defaultRuntime.stop;
export const reloadEndpoint = defaultRuntime.reloadEndpoint;
export const applyMqttConfig = defaultRuntime.applyMqttConfig;
// Annotated (rather than inferred) so the wire type `TestInverterResult` stays
// a directly-referenced export: it flows into the Eden-inferred `app` type, so
// tsc needs it exported, and the explicit signature keeps it reachable.
export const testInverter: (
  profileId: string | null,
  config: InverterConfig,
) => Promise<TestInverterResult> = defaultRuntime.testInverter;
export const testMqtt = defaultRuntime.testMqtt;
export const syncSpotPricesNow = defaultRuntime.syncSpotPricesNow;
