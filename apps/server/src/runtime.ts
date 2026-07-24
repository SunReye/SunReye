/**
 * Runtime controller — owns the live inverter source, the poll loop, and the
 * MQTT bridge, and rebuilds them on the fly when connection settings change so
 * the operator never has to restart the process.
 *
 * The God-loop lives here: poll the source, cache the sample, persist it, hand
 * it to the WebSocket publisher (injected via {@link start}), and publish it to
 * the MQTT bridge. Connection health is tracked for the `/api/status` endpoint.
 */

import { db } from "@SunReye/db";
import type { InverterConfig } from "@SunReye/db/inverter-config";
import type { MqttConfig } from "@SunReye/db/mqtt-config";
import { metricsRaw } from "@SunReye/db/schema/metrics";
import { env } from "@SunReye/env/server";
import type { InverterSample, InverterSource } from "@SunReye/inverter-core";
import mqtt from "mqtt";
import { getInverterConfig, getMqttConfig } from "./config";
import { executeControl, injectControlValues } from "./control-expr";
import { dbControlStore } from "./control-store";
import {
  buildProfileContext,
  buildSource,
  getActiveProfileOrNull,
  resolveProfileById,
  type ProfileContext,
} from "./inverter";
import { log } from "./logging";
import { type MqttBridge, startMqttBridge } from "./mqtt";
import { fetchSolarForecast, toForecastExport } from "./solar-forecast";
import { liveState } from "./state";
import { getWeatherConfig } from "./weather-settings";

const logger = log("runtime");

type SampleListener = (sample: InverterSample) => void;

let ctx: ProfileContext | null = null;
let source: InverterSource | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let bridge: MqttBridge | null = null;
let onSample: SampleListener = () => {};
let polling = false;
let forecastTimer: ReturnType<typeof setInterval> | null = null;

// The PV forecast changes slowly (provider cache is 30 min) and its topics are
// retained, so re-publishing every 5 minutes keeps HA fresh without churn.
const FORECAST_PUBLISH_INTERVAL_MS = 5 * 60_000;

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

// --- History write buffer --------------------------------------------------
// The DB is purely the history store — live monitoring is served from
// `liveState`/WebSocket in memory — so *when* rows land is invisible to every
// feature. Accumulating many polls into one transaction collapses the
// commit/fsync/WAL churn that dominates SSD write wear (TBW) at 1 Hz, for zero
// functional change. Worst case a crash loses the buffered window of *history*
// (never live data, never corruption) — an acceptable trade for telemetry.
type MetricRow = typeof metricsRaw.$inferInsert;
let pending: MetricRow[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
// Hard cap so a prolonged DB outage can't grow the buffer without bound; past
// this the oldest rows are dropped (bounded, predictable memory).
const MAX_PENDING = 100_000;

/** Queue history rows for the next flush; eager-flush if the buffer is huge. */
function enqueueRows(rows: MetricRow[]): void {
  for (const row of rows) pending.push(row);
  // Guards against a mis-set (very long) flush interval or a stalled flush
  // producing one enormous transaction; the timer handles the normal path.
  if (!flushing && pending.length >= MAX_PENDING) void flushPending();
}

/** Write the buffered history rows in a single transaction. */
async function flushPending(): Promise<void> {
  if (flushing || pending.length === 0) return;
  flushing = true;
  const batch = pending;
  pending = [];
  try {
    await db.insert(metricsRaw).values(batch);
  } catch (error) {
    // Re-queue (oldest first) so a transient DB blip doesn't drop history, but
    // never past the cap — trim the oldest if we're over.
    pending = batch.concat(pending);
    if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING);
    logger.error("history flush failed, {count} rows queued: {error}", {
      count: pending.length,
      error,
    });
  } finally {
    flushing = false;
  }
}

/** The active profile context, set by {@link start} before the loop runs. */
function context(): ProfileContext {
  if (!ctx) throw new Error("runtime not started");
  return ctx;
}

const inverterStatus = {
  connected: false,
  simulate: env.INVERTER_SIMULATE,
  lastError: null as string | null,
  lastSampleAt: null as string | null,
};

/** One poll: read, cache, persist, fan out to WebSocket + MQTT. */
async function pollOnce(): Promise<void> {
  // Skip if the previous poll is still running (a slow/reconnecting source must
  // not let ticks stack up).
  if (!source || polling) return;
  polling = true;
  const active = source;
  try {
    const sample = await active.read();
    inverterStatus.connected = true;
    inverterStatus.lastError = null;
    inverterStatus.lastSampleAt = sample.time;
    // Composite controls own no register; fold their current (e.g. lock) state
    // into the sample so every downstream surface sees it.
    await injectControlValues(sample, context(), dbControlStore);
    liveState.set(sample);
    const rows = Object.entries(sample.metrics).map(([metric, value]) => ({
      time: new Date(sample.time),
      inverterId: sample.inverterId,
      metric,
      value,
    }));
    // Buffer for a batched flush (see the history write buffer above) rather
    // than committing one transaction per poll.
    if (rows.length > 0) enqueueRows(rows);
    onSample(sample);
    bridge?.publishSample(sample);
  } catch (error) {
    inverterStatus.connected = false;
    inverterStatus.lastError = error instanceof Error ? error.message : String(error);
    logger.error("poll loop error: {error}", { error });
  } finally {
    polling = false;
  }
}

function restartLoop(intervalMs: number): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollOnce, intervalMs);
}

/** Apply an inbound command write to the live source. */
export async function write(key: string, value: number): Promise<void> {
  if (!source) throw new Error("inverter not started");
  // A composite control (controlExpr) runs its declarative action instead of a
  // raw register write; the interpreter dispatches to the real target(s).
  const def = context().defByKey.get(key);
  if (def?.controlExpr) {
    // The module-level `let source` loses its non-null narrowing inside the
    // closure, so capture it here.
    const src = source;
    return executeControl(def, value, {
      ctx: context(),
      store: dbControlStore,
      write: (target, v) => src.write(target, v),
      readLive: (target) => liveState.latest?.metrics[target],
    });
  }
  await source.write(key, value);
}

async function rebuildInverter(config: InverterConfig): Promise<void> {
  // Drain buffered rows before swapping sources so a changed inverterId can't
  // land on rows captured under the previous one.
  await flushPending();
  const previous = source;
  source = buildSource(context().profile, config);
  // The simulator is always "connected"; a real Modbus source only proves it on
  // the first successful read, so start pessimistic and let pollOnce flip it.
  inverterStatus.connected = env.INVERTER_SIMULATE;
  inverterStatus.lastError = null;
  restartLoop(config.pollIntervalMs);
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

/** Boot the controller: build the source + bridge and start polling. */
export async function start(listener: SampleListener, profileCtx: ProfileContext): Promise<void> {
  ctx = profileCtx;
  onSample = listener;
  if (!flushTimer) {
    flushTimer = setInterval(() => void flushPending(), env.HISTORY_FLUSH_INTERVAL_MS);
  }
  if (!forecastTimer) {
    forecastTimer = setInterval(() => void publishForecastNow(), FORECAST_PUBLISH_INTERVAL_MS);
  }
  await rebuildInverter(await getInverterConfig());
  await rebuildBridge(await getMqttConfig());
}

/**
 * Rebuild the source (and restart the loop) for updated inverter settings. In
 * onboarding-only boot the runtime isn't started (no active profile), so the
 * config is persisted by the caller but there's nothing live to hot-apply yet —
 * it takes effect on the restart that activates a profile.
 */
export async function applyInverterConfig(config: InverterConfig): Promise<void> {
  if (!ctx) return;
  await rebuildInverter(config);
}

/** Rebuild the MQTT bridge for updated broker/discovery settings. */
export async function applyMqttConfig(config: MqttConfig): Promise<void> {
  if (!ctx) return;
  await rebuildBridge(config);
}

/** Live health for `/api/status` (tolerates the not-started onboarding boot). */
export function status() {
  return {
    inverter: { ...inverterStatus, profile: ctx?.profile.id ?? null },
    mqtt: bridge
      ? { enabled: true, ...bridge.status() }
      : { enabled: false, connected: false, lastError: null },
  };
}

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
export async function testInverter(
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
export function testMqtt(config: MqttConfig): Promise<{ ok: boolean; error?: string }> {
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
export async function stop(): Promise<void> {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  if (forecastTimer) clearInterval(forecastTimer);
  forecastTimer = null;
  // Persist whatever is buffered so a clean shutdown never drops history.
  await flushPending();
  await bridge?.close();
  await source?.close();
}
