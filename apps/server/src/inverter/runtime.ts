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
import {
  type DeviceInstance,
  type EntityConstraint,
  type InverterSample,
  type InverterSource,
  entityConstraint,
} from "@SunReye/inverter-core";
import mqtt from "mqtt";
import { startAutomations, stopAutomations } from "../automation/automation";
import { OPTIMIZER_DEVICE_ID, optimizerDeviceSpec } from "../automation/optimizer-device";
import { type DeviceRowState, createOptimizerRegistrar } from "../automation/optimizer-registrar";
import { ensureDevice, isRetired, readPlant } from "@SunReye/db/plant-repo";
import { getMqttConfig } from "../settings/config";
import type { ControlStore } from "./control-expr";
import { dbControlStore } from "./control-store";
import { createControlWriter } from "./control-writer";
import { type HistoryBuffer, createHistoryBuffer } from "./history-buffer";
import type { StorageRow } from "./storage-policy";
import { createDeviceWriter } from "./device-writer";
import type { DeviceRegistry } from "../devices/registry";
import { deviceRegistry } from "../devices/registry-instance";
import { createIdentifiedCommit, createRowIdentifier } from "./storage-identity";
import { type IdentityResolver, createIdentityResolver } from "../shared/identity";
import { type JobScheduler, type ScheduledJob, createJobScheduler } from "./job-scheduler";
import { evccOnLoadSample } from "../evcc/evcc";
import {
  buildProfileContext,
  buildSource,
  resolveProfileById,
  type ProfileContext,
} from "./inverter";
import { runForecastCorrectionLearn } from "../forecast/forecast-correction-job";
import { log } from "../shared/logging";
import { type MqttBridge, startMqttBridge } from "./mqtt";
import type { MqttNamespace } from "./mqtt-discovery";
import { MissingMqttNamespaceError, readMqttNamespace } from "./mqtt-namespace";
import { fetchSolarForecast, toForecastExport } from "../forecast/solar-forecast";
import { runSpotPriceSync } from "../prices/spot-price-job";
import { getSpotPriceConfig } from "../settings/spot-price-settings";
import { liveState } from "../shared/state";
import { getWeatherConfig } from "../settings/weather-settings";
import type { Streams } from "../shared/streams";

const logger = log("runtime");

/**
 * The optimizer's `devices` row, over the real plant spine.
 *
 * RETIRED IS NOT REGISTERED. `ensureDevice` is `ON CONFLICT DO NOTHING` +
 * SELECT, so it answers "the row is there" for a row the operator retired in
 * Settings → Devices — while the roster read excludes exactly that row. The
 * registrar has to be told the difference or it waits for an instance that is
 * never coming.
 *
 * `"absent"` is a legal answer: the automation loop can be armed on a boot that
 * has no plant yet, and taking it down over a missing device row would be worse
 * than storing nothing until the next tick.
 */
async function ensureOptimizerRow(): Promise<DeviceRowState> {
  const plantDb = { execute: (query: Parameters<typeof db.execute>[0]) => db.execute(query) };
  const plant = await readPlant(plantDb);
  if (!plant) return "absent";
  return isRetired(await ensureDevice(plantDb, optimizerDeviceSpec(plant.id)))
    ? "retired"
    : "ready";
}

/** Re-log an unchanged, ongoing poll failure at most this often. */
const POLL_ERROR_RELOG_MS = 300_000;

/**
 * Re-read the plant's roster at most this often while samples have nowhere to
 * go.
 *
 * The registry is otherwise re-read twice in the process's life (at boot, and
 * on a settings save), and a failed read deliberately keeps the last good
 * roster — which at boot is the EMPTY one. So a database that is slow to accept
 * connections used to cost the whole process's history: 1 Hz polling, live
 * frames, `connected: true`, and not one row stored until someone restarted it.
 * A dropped sample is the evidence that the roster is wrong, so it is also when
 * to re-read one — rate-limited, because the alternative at 1 Hz is a query per
 * dropped sample, which is a second failure on top of the first.
 */
const ROSTER_RECOVERY_INTERVAL_MS = 30_000;

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
   * Resolves the plant/device slugs the MQTT bridge and every Home Assistant
   * `unique_id` are named after. Defaults to the real read.
   *
   * Injected for the same reason {@link identity} is: the production reader
   * queries the dimension spine, so a unit test that did not stub it would fail
   * on a missing database client rather than on the behaviour it names — and
   * worse, it would fail identically whether the bridge was named correctly or
   * not.
   */
  mqttNamespace?: (profileId: string) => Promise<MqttNamespace>;
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
   * Create the optimizer's `devices` row if absent, and say what the table now
   * holds for it (#172). Defaults to the real plant read + upsert.
   *
   * Injected for the same reason {@link identity} is: the production version
   * queries the plant spine, so a unit test that did not stub it would fail on a
   * missing database client rather than on the behaviour it names.
   */
  ensureOptimizerDevice?: () => Promise<DeviceRowState>;
  /**
   * The name → int2 resolver both commits and the eager metric registration go
   * through. Defaults to one bound to the real database; injected so a test can
   * assert WHAT was registered — the production resolver's registration is a
   * `void`-ed promise whose rejection is swallowed, so a spec that never arrived
   * is indistinguishable from one that did.
   */
  identity?: IdentityResolver;
  /**
   * The plant's registered devices. Defaults to the process registry; injected
   * so a test drives the loop against a roster it states rather than against
   * whatever the database holds.
   *
   * The loop polls the registry's primary inverter — one endpoint, as this
   * release does (`./endpoint.ts`) — but every sample it stores goes through
   * `./device-writer.ts`, which is keyed by the INSTANCE and has no idea a poll
   * loop exists.
   */
  devices?: DeviceRegistry;
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
  const mqttNamespaceOf = deps.mqttNamespace ?? readMqttNamespace;
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
  const devices = deps.devices ?? deviceRegistry;
  /**
   * THE WRITE SEAM. Every stored reading — this loop's and, from #88 and #172
   * on, every other integration's — goes through here, keyed by the device
   * instance rather than by whatever id a driver stamped on its sample.
   */
  const writer = createDeviceWriter({
    series: historyBuffer,
    config: configLogBuffer,
    // EAGER metric registration, so the ids exist before the first sample and
    // the writer's own lazy fallback (`./storage-identity.ts`) is only ever
    // reached by a key the device never declared. Not awaited: the registration
    // is a `void`-ed promise whose failure is a warning, not a lost reading.
    registerMetrics: (specs) => {
      void identity.registerMetrics(specs).catch((error: unknown) => {
        logger.warn("metric key registration failed: {error}", { error });
      });
    },
  });
  const onLoadSample = deps.onLoadSample ?? evccOnLoadSample;
  /**
   * The optimizer's path to the write seam above — one device, ensured once,
   * committed to on every tick that decided something.
   *
   * Built here rather than in `../index.ts` (where EVCC's registrar is
   * composed), because the engine it feeds is started by {@link start} and
   * nothing outside this file holds both that and `writer.commit`. Nothing about
   * it is armed until a decision arrives.
   */
  const optimizer = createOptimizerRegistrar({
    ensureDevice: deps.ensureOptimizerDevice ?? ensureOptimizerRow,
    reloadRegistry: () => reloadDevices(),
    device: () => devices.get(OPTIMIZER_DEVICE_ID),
    commit: writer.commit,
    logger,
  });
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
  /** Whether the "nothing to key this sample to" warning has been said already. */
  let missingDeviceWarned = false;
  /** When the roster was last re-read because a sample had nowhere to go. */
  let lastRosterRecoveryAt = 0;
  /** Whether such a re-read is in flight, so ticks do not stack them up. */
  let rosterRecovering = false;

  const inverterStatus = {
    connected: false,
    simulate: env.INVERTER_SIMULATE,
    lastError: null as string | null,
    lastSampleAt: null as string | null,
  };

  // The `load.power` metric key of the active profile, memoized per context (the
  // lookup is a linear scan; the poll loop runs at 1 Hz forever).
  let loadKeyCache: { device: DeviceInstance; key: string | null } | null = null;

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
   * The device this loop's readings are FROM — the registry's primary inverter,
   * or null when the plant has no device row yet.
   *
   * Read per tick rather than captured, so a device added or retired under a
   * running server takes effect on the next reload without a restart. This
   * release polls ONE endpoint (`./endpoint.ts` says so out loud), so the loop
   * asks for one device; the write path below it does not care how many there
   * are.
   */
  function pollDevice(): DeviceInstance | null {
    return devices.primary();
  }

  /**
   * Re-read the plant's roster, and drop what is no longer on it.
   *
   * The forget half is what makes a device RETIRED under a running server a
   * complete event: its policy holds open series intervals, and an interval is
   * written when it closes. Left to `stop()` they would be flushed under the
   * retired slug at shutdown — hours later, timestamped now, keyed to a device
   * the operator removed. Forgetting writes them out at the moment the roster
   * says the device is gone, which is the last moment they are history.
   */
  async function reloadDevices(): Promise<void> {
    const before = devices.list().map((d) => d.id);
    const after = new Set((await devices.reload()).map((d) => d.id));
    for (const id of before) if (!after.has(id)) writer.forget(id);
  }

  /**
   * A sample had no device to key it to: say so once, and try to fix it.
   *
   * Once, not once a second — `./storage-identity.ts` warns once per
   * unresolvable source one layer down for the same reason, and the flag is
   * cleared on the next stored sample so a roster lost LATER warns again.
   */
  function noDeviceForSample(): void {
    if (!missingDeviceWarned) {
      missingDeviceWarned = true;
      logger.warn(
        "no registered device to key this plant's readings to — nothing is being stored. " +
          "Re-reading the plant's devices; live frames are unaffected.",
      );
    }
    const now = Date.now();
    if (rosterRecovering || now - lastRosterRecoveryAt < ROSTER_RECOVERY_INTERVAL_MS) return;
    lastRosterRecoveryAt = now;
    rosterRecovering = true;
    // Not awaited: the poll loop must not wait on a query, and the sample that
    // triggered this one is dropped either way — the reload is for the next.
    void reloadDevices()
      .catch((error: unknown) => {
        logger.warn("could not re-read the plant's devices: {error}", { error });
      })
      .finally(() => {
        rosterRecovering = false;
      });
  }

  /**
   * Flush every registered device's open series intervals into the history
   * buffer. Called before a source swap and at shutdown: a series row is
   * written when its interval CLOSES, so without this the currently-held value
   * of every metric is lost — and on a restart loop that is every metric, every
   * time.
   */
  function closeSeriesIntervals(): void {
    writer.close(new Date());
  }

  /** The house-load value (W) of a sample, or null when the device maps no load role. */
  function loadPowerOf(device: DeviceInstance, sample: InverterSample): number | null {
    if (loadKeyCache?.device !== device) {
      // THROUGH THE CONTRACT, not by re-scanning a metric list: a role lookup is
      // what `DeviceInstance.roles` is for, and it answers the same way for a
      // device whose mapping was never a profile at all.
      loadKeyCache = { device, key: device.roles.get("load.power")?.metrics[0]?.key ?? null };
    }
    if (!loadKeyCache.key) return null;
    const value = sample.metrics[loadKeyCache.key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  /**
   * Everything one good sample causes: the live cache, the EV estimator's load
   * hook, persistence, the WebSocket frame and the MQTT publish.
   *
   * Split out of {@link pollOnce}, which is otherwise the loop's error policy
   * and this in one function — two subjects, and the tick-collapse logging below
   * is the half that must stay easy to read.
   */
  function fanOut(read: InverterSample): void {
    const device = pollDevice();
    // The driver stamps the PROFILE's id (`packages/inverter-core/src/driver.ts`);
    // the sample every downstream surface sees carries the DEVICE's slug — the
    // identity history is keyed by, the name `/api/sources` lists, and what the
    // plant fold matches a member on (#202). Two devices on one profile are
    // two samples, not one, from here on. With no device row the stamp stays
    // as read: nothing is stored for it anyway (see below).
    const sample: InverterSample = device ? { ...read, inverterId: device.id } : read;
    liveState.set(sample);
    // The EV charge-power estimator refines its estimate from the 1 Hz house
    // load — between EVCC's much slower publishes (no-op when EVCC is off).
    onLoadSample(device ? loadPowerOf(device, sample) : null);
    // Persistence only: the live frame below carries every key regardless of
    // where — or whether — its value is stored.
    //
    // Keyed by the DEVICE object, not by the stamp: a profile is swapped,
    // uninstalled and re-downloaded inside the five years a reading is retained.
    // With no device row there is nothing to key a row to, so nothing is routed
    // — and that is said out loud and retried, because a process that polls,
    // publishes and reports `connected: true` while storing nothing is
    // otherwise indistinguishable from a healthy one.
    if (device) {
      // Cleared on success, so a roster lost later warns again.
      missingDeviceWarned = false;
      writer.commit(device, sample);
    } else noDeviceForSample();
    streams?.emit("metrics", sample);
    bridge?.publishSample(sample);
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
      fanOut(sample);
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

  /**
   * (Re)build the MQTT bridge, naming it by the plant's and device's FROZEN slugs.
   *
   * The namespace is read HERE, once per rebuild, and that cadence is the whole
   * design: the slugs are frozen, so re-reading them per publish would be a
   * query for a value that cannot change, while never re-reading them would
   * leave the bridge on the old namespace after a profile swap (which
   * `readMqttNamespace` resolves through its second arm).
   *
   * A MISSING NAMESPACE TURNS MQTT OFF; IT DOES NOT TAKE THE POLL LOOP DOWN.
   * `syncProvisioning` swallows its own failures and returns null, so "the spine
   * has no device row yet" is genuinely reachable at boot — and this function is
   * awaited from `start()`, where an unguarded throw would abort the runtime and,
   * on the one deployment target (a Home Assistant addon), hand its supervisor a
   * crash loop. Readings still matter without a broker, so the bridge stays null
   * and the next boot picks it up.
   *
   * What this must NEVER do is fall back to `profile.id`. That fallback is the
   * defect: Home Assistant keys entities on `unique_id`, a discovery
   * announcement is retained, and a profile-keyed identity therefore renames
   * every entity — irreversibly — the first time a profile changes. Silence is
   * recoverable; a wrong permanent identity is not. The `ctx` type has no
   * optional form precisely so this cannot be reintroduced by accident.
   */
  async function rebuildBridge(config: MqttConfig): Promise<void> {
    const previous = bridge;
    const ctx = context();
    let namespace: MqttNamespace | null = null;
    try {
      namespace = await mqttNamespaceOf(ctx.profile.id);
    } catch (error) {
      // EVERY failure, not just MissingMqttNamespaceError. An unprovisioned spine
      // and an unreachable database are equally recoverable — both are fixed by
      // the next boot — and neither is a reason to abort `start()` and hand the
      // addon's supervisor a crash loop. Narrowing this to the one error class
      // was the first version of this guard and it was wrong: a DrizzleQueryError
      // from a missing client took the whole runtime down.
      const reason = error instanceof MissingMqttNamespaceError ? error.message : String(error);
      logger.warn(
        "MQTT is off: {reason}. Home Assistant entities are named after the plant and device " +
          "slugs, so the bridge waits for those rows rather than announcing under a name that " +
          "could never be corrected.",
        { reason },
      );
    }
    bridge =
      namespace === null ? null : startMqttBridge(config, { ctx: { ...ctx, ...namespace }, write });
    if (previous) await previous.close();
    // Seed a fresh bridge with the current forecast instead of waiting a full
    // interval; harmless when the forecast is disabled (publishes null → no-op).
    void publishForecastNow();
  }

  /**
   * The job that drains both write buffers into their tables.
   *
   * A function rather than a constant so the cadence is READ at arm time — `env`
   * is dynamic — and so {@link armStorage} arms the identical job rather than a
   * second copy of it that could drift.
   */
  function flushJob(): ScheduledJob {
    return {
      run: () => {
        void historyBuffer.flush();
        void configLogBuffer.flush();
      },
      intervalMs: env.HISTORY_FLUSH_INTERVAL_MS,
    };
  }

  /**
   * Arm the flush cadence WITHOUT booting a poll loop.
   *
   * For a boot with no active profile: a fresh install past provisioning, or a
   * configured profile that failed to load. `start` is skipped there, but the
   * plant row exists and the integrations that write through {@link commit} —
   * EVCC's loadpoints (#88), the optimizer (#172) — are wired unconditionally,
   * because neither has a poll loop and neither is a reason to have one. Without
   * this their rows accumulate in a 100 000-row buffer that nothing drains until
   * shutdown, dropping the oldest past the cap: the writer's whole contract,
   * silently unmet, on exactly the installs least likely to notice.
   *
   * Idempotent, and harmless beside `start`: the scheduler arms nothing while
   * already running. The composition root calls one or the other, never both.
   */
  function armStorage(): void {
    scheduler.start([flushJob()]);
  }

  /**
   * Boot the controller: build the source + bridge and start polling.
   *
   * `automationsWatched` answers whether anyone is subscribed to the
   * `automations` topic right now. Only the socket boundary knows, so it is
   * passed straight through to the engine loop, which skips the frame (and the
   * plan projection built for it) when nobody is listening.
   */
  /**
   * The bounds a register declares, for the automation loop's clamp.
   *
   * A register range is a TRANSPORT fact — it lives on the map that says how to
   * talk to the device — so it is read off the profile context here and handed
   * to the loop as a function, rather than the loop being given a profile it
   * would then be able to resolve roles from.
   */
  function constraintOf(profileCtx: ProfileContext, key: string): EntityConstraint | null {
    const def = profileCtx.defByKey.get(key);
    return def ? entityConstraint(def) : null;
  }

  async function start(
    streamBus: Streams,
    profileCtx: ProfileContext,
    automationsWatched?: () => boolean,
  ): Promise<void> {
    ctx = profileCtx;
    streams = streamBus;
    // The roster is read here rather than at construction: `../index.ts`
    // provisions the plant's device rows immediately before this call, and a
    // registry built before them would hold an empty plant for the life of the
    // process.
    await reloadDevices();
    // The scheduler arms each of these once and is idempotent while running, so
    // a re-boot re-points the source without stacking a second set of jobs.
    scheduler.start([
      flushJob(),
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
    // Automations write through the same funnel as every other path, and steer
    // the registry's primary inverter. They push their tick outcomes onto the
    // same injected bus.
    //
    // NO DEVICE, NO LOOP. Every register the automation takes is snapshotted
    // under a device id and handed back from it; with nothing registered there
    // is no identity to key that by, so steering the plant would mean steering
    // it with no way back to the user's own values.
    const steered = pollDevice();
    if (!steered) {
      logger.warn(
        "no registered inverter — the automation loop is not started; it starts on the next boot after a device is provisioned",
      );
      return;
    }
    await startAutomations(
      {
        device: steered,
        constraint: (key) => constraintOf(profileCtx, key),
        write,
        // #172: what the loop DECIDES is a reading too, and it goes through the
        // one seam above rather than into a private in-memory ring.
        recordDecision: optimizer.record,
      },
      streamBus,
      undefined,
      automationsWatched,
    );
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
    // The roster and the address are re-read together: the settings save that
    // asks for this is also how a device is added, renamed or retired, and a
    // loop polling the new endpoint under the old roster would key its readings
    // to a device that is no longer there.
    await reloadDevices();
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
   * so this works during onboarding — before any device is registered — against
   * the chosen (built-in or freshly-installed) profile. A null `profileId` falls
   * back to the profile of the registry's primary device, for the ordinary
   * settings-page re-test.
   */
  async function testInverter(
    profileId: string | null,
    config: InverterConfig,
  ): Promise<TestInverterResult> {
    const profile = profileId ? await resolveProfileById(profileId) : devices.primaryProfile();
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
    // The optimizer's device is NOT retired by a stop — the plant still has one,
    // its row, its history and its open intervals stay exactly as they are, and
    // `closeSeriesIntervals` below writes out what it was holding. Forgetting the
    // registration only means the next start re-registers immediately rather
    // than waiting out the retry interval.
    optimizer.suspend();
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
    /** Arm the flush cadence for a boot that never calls {@link start}. */
    armStorage,
    write,
    /**
     * THE WRITE SEAM: store one registered device's readings, through the ONE
     * wired writer.
     *
     * On the runtime rather than closure-local because the seam exists for the
     * integrations that have no poll loop — #88's EVCC samples off MQTT, #172's
     * optimizer decisions. A caller that could not reach this would have to
     * build a second `createDeviceWriter`, and with it a second pair of history
     * buffers, a second identity resolver and a second flush cadence: one
     * buffering regime per integration, each with its own cap and its own drop
     * policy, writing into the same two tables.
     *
     * The device must be one the registry knows — the identity is `devices.slug`
     * and `./storage-identity.ts` drops rows naming a device with no row.
     */
    commit: writer.commit,
    /**
     * Drop a device, writing out what it held open.
     *
     * The runtime calls this itself for a device the roster no longer lists;
     * exposed for an integration that knows its device is gone before a reload
     * does.
     */
    forgetDevice: writer.forget,
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
// Wired in `../index.ts` for the boot that has no profile to poll (#88).
export const armStorage = defaultRuntime.armStorage;
export const write = defaultRuntime.write;
// The write seam, on the process's one runtime — the whole point of it being on
// the runtime at all (see `commit` above). Wired in `../index.ts` for EVCC's
// loadpoints (#88); #172's optimizer is the second caller.
export const commit = defaultRuntime.commit;
export const forgetDevice = defaultRuntime.forgetDevice;
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
