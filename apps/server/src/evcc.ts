/**
 * EVCC ingest — surfaces an external EVCC instance's loadpoints (EV chargers)
 * from its MQTT state topics, plus the write path for its `/set` commands.
 *
 * EVCC publishes its full state as individual *retained* leaf topics under a
 * root (default `evcc`), so a fresh subscription receives a complete snapshot
 * immediately. This module runs its **own** MQTT client on the broker
 * configured in the MQTT settings — deliberately decoupled from the inverter
 * bridge (mqtt.ts) and its profile lifecycle, so EVCC ingest works even when
 * inverter→MQTT publishing is disabled.
 *
 * Contract notes (validated against a live EVCC 0.3x instance):
 * - loadpoint topics are `<root>/loadpoints/<n>/<key>` with **1-based** `n`
 *   and camelCase keys; keys can nest further (`chargeCurrents/l1`).
 * - `<root>/loadpoints` (no index) is a retained loadpoint-count topic.
 * - `<root>/status` is EVCC's own online/offline (LWT) topic — the freshness
 *   signal; broker-retained state can outlive a dead EVCC.
 * - commands are `<root>/loadpoints/<n>/<key>/set`; state topics use
 *   camelCase there too (`limitSoc/set`, unlike the REST API's lowercase path).
 * - live updates arrive with `retain=false`; only the snapshot on subscribe
 *   carries the retain flag, so it must never be filtered on.
 */

import { evccReady } from "@SunReye/db/evcc-config";
import mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import { getMqttConfig } from "./config";
import {
  createEvPowerEstimator,
  type ChargePowerSource,
  type LiveChargePower,
} from "./ev-power-estimator";
import { getEvccConfig } from "./evcc-settings";
import { log } from "./logging";

const logger = log("evcc");

/** A coerced EVCC topic payload (leaf values are JSON-ish primitives). */
export type EvccValue = string | number | boolean | null;

/** The per-loadpoint fields the web app renders (subset of EVCC's topics). */
export interface EvccLoadpoint {
  /** 1-based loadpoint index, as used in EVCC's topics. */
  index: number;
  /** Loadpoint label from the EVCC config (e.g. "Carport"). */
  title: string | null;
  /** Charge mode: `off` | `pv` | `minpv` | `now`. */
  mode: string | null;
  /** Current charge power in W, as last reported by EVCC. */
  chargePower: number;
  /**
   * Live charge power in W — the estimator's view, updated between EVCC's
   * publishes from command feed-forward and the 1 Hz house-load residual.
   * Equals {@link chargePower} whenever the last word was EVCC's own.
   */
  chargePowerLive: number;
  /** Provenance of {@link chargePowerLive} (freshness/confidence hint). */
  chargePowerSource: ChargePowerSource;
  charging: boolean;
  /** Vehicle plugged in. */
  connected: boolean;
  vehicleSoc: number | null;
  /** Vehicle range in km. */
  vehicleRange: number | null;
  /** Display name of the detected vehicle (nicer than the config slug). */
  vehicleTitle: string | null;
  /** Energy added this charging session in Wh. */
  sessionEnergy: number | null;
  /** Energy still needed to reach the charge limit in Wh (EVCC's estimate). */
  chargeRemainingEnergy: number | null;
  /** Charge limit in % (0 = no limit). */
  limitSoc: number | null;
  phasesActive: number | null;
}

export interface EvccState {
  /** Broker connected *and* EVCC's own status topic reports online. */
  reachable: boolean;
  loadpoints: EvccLoadpoint[];
  /**
   * Diagram hint: subtract the EV from the house-load node. Carried here (not in
   * the admin-only settings) so the session-scoped public dashboard can read it.
   */
  subtractFromHome: boolean;
}

/** Writable loadpoint commands exposed to the web app. */
export type EvccAction = "mode" | "limitSoc";

/**
 * Parse a loadpoint state topic into its 1-based index and (possibly nested)
 * key. Returns `null` for anything else under the root — including the
 * retained `<root>/loadpoints` count topic and `.../set` command echoes.
 */
export function parseLoadpointTopic(
  topicRoot: string,
  topic: string,
): { index: number; key: string } | null {
  const prefix = `${topicRoot}/loadpoints/`;
  if (!topic.startsWith(prefix)) return null;
  const [head, ...rest] = topic.slice(prefix.length).split("/");
  const index = Number(head);
  if (!Number.isInteger(index) || index < 1 || rest.length === 0) return null;
  if (rest[rest.length - 1] === "set") return null;
  return { index, key: rest.join("/") };
}

/**
 * Coerce a raw payload string into a primitive: numbers and booleans become
 * typed, `null`/empty become null, everything else stays a string (JSON
 * blobs like plan arrays are kept verbatim — the snapshot ignores them).
 */
export function coercePayload(raw: string): EvccValue {
  const s = raw.trim();
  if (s === "" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  // Number() accepts "" (handled above) and whitespace, but not "1x" — exactly
  // the numeric-or-not test needed here.
  const n = Number(s);
  return Number.isNaN(n) ? s : n;
}

const num = (v: EvccValue | undefined): number | null => (typeof v === "number" ? v : null);
const str = (v: EvccValue | undefined): string | null => (typeof v === "string" ? v : null);
const bool = (v: EvccValue | undefined): boolean => v === true;

/** Assemble the API snapshot for one loadpoint from its flat topic map. */
function toLoadpoint(
  index: number,
  values: Map<string, EvccValue>,
  live: LiveChargePower | null,
): EvccLoadpoint {
  const chargePower = num(values.get("chargePower")) ?? 0;
  return {
    index,
    title: str(values.get("title")),
    mode: str(values.get("mode")),
    chargePower,
    chargePowerLive: live?.watts ?? chargePower,
    chargePowerSource: live?.source ?? "measured",
    charging: bool(values.get("charging")),
    connected: bool(values.get("connected")),
    vehicleSoc: num(values.get("vehicleSoc")),
    vehicleRange: num(values.get("vehicleRange")),
    vehicleTitle: str(values.get("vehicleTitle")) ?? str(values.get("vehicleName")),
    sessionEnergy: num(values.get("sessionEnergy")),
    chargeRemainingEnergy: num(values.get("chargeRemainingEnergy")),
    limitSoc: num(values.get("limitSoc")),
    phasesActive: num(values.get("phasesActive")),
  };
}

let client: MqttClient | null = null;
let topicRoot = "evcc";
/** Snapshot of the config flag, refreshed on each rebuild (see rebuildEvcc). */
let subtractFromHome = false;
let connected = false;
/** Last value of `<root>/status` ("online"/"offline"); null until seen. */
let evccStatus: string | null = null;
const loadpoints = new Map<number, Map<string, EvccValue>>();
const estimator = createEvPowerEstimator();

/** Notified with the fresh snapshot whenever state changes (wired to the WS). */
type EvccListener = (state: EvccState) => void;
let listener: EvccListener = () => {};
let emitTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Register the push listener (the server wires this to a WS broadcast). Only one
 * is needed — the socket layer fans out to every subscriber.
 */
export function setEvccListener(fn: EvccListener): void {
  listener = fn;
}

/**
 * Coalesce a burst of topic updates into a single push. EVCC delivers its full
 * retained state as ~dozens of individual leaf messages on (re)subscribe, and
 * live changes often touch several related topics at once; a short debounce
 * collapses each burst into one snapshot emit with negligible added latency.
 */
const EMIT_DEBOUNCE_MS = 200;
function scheduleEmit(): void {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    const snap = evccSnapshot();
    if (snap) listener(snap);
  }, EMIT_DEBOUNCE_MS);
}

/**
 * Emit synchronously, superseding any debounced emit. Used for feed-forward
 * predictions, where the whole point is sub-poll latency — a command's
 * expected effect should paint immediately, not 200 ms later.
 */
function emitNow(): void {
  if (emitTimer) {
    clearTimeout(emitTimer);
    emitTimer = null;
  }
  const snap = evccSnapshot();
  if (snap) listener(snap);
}

/** Current EVCC state for `GET /api/evcc` and WS pushes, or `null` when off. */
export function evccSnapshot(): EvccState | null {
  if (!client) return null;
  return {
    reachable: connected && evccStatus === "online",
    loadpoints: [...loadpoints.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, values]) => toLoadpoint(index, values, estimator.live(index))),
    subtractFromHome,
  };
}

/**
 * Publish a loadpoint command to EVCC (`.../<action>/set`). EVCC applies it
 * and republishes the state topic, so the UI converges via the normal ingest.
 */
export function evccControl(loadpoint: number, action: EvccAction, value: string): void {
  if (!client || !connected) throw new Error("EVCC MQTT is not connected");
  client.publish(`${topicRoot}/loadpoints/${loadpoint}/${action}/set`, value);
}

/** Mirror the estimator-relevant state keys into it as they stream in. */
function trackEstimator(index: number, key: string, value: EvccValue): void {
  switch (key) {
    case "chargePower":
      if (typeof value === "number") estimator.anchorPower(index, value);
      break;
    case "charging":
      estimator.updateParams(index, { charging: value === true });
      break;
    case "connected":
      estimator.updateParams(index, { connected: value === true });
      break;
    case "mode":
      estimator.updateParams(index, { mode: typeof value === "string" ? value : null });
      break;
    case "phasesActive":
      estimator.updateParams(index, { phasesActive: typeof value === "number" ? value : null });
      break;
    case "effectiveMaxCurrent":
      estimator.updateParams(index, { maxCurrentA: typeof value === "number" ? value : null });
      break;
  }
}

function handleMessage(topic: string, payload: Buffer): void {
  if (topic === `${topicRoot}/status`) {
    evccStatus = payload.toString().trim();
    scheduleEmit(); // reachability changed
    return;
  }
  // `.../set` command echoes (our own writes and any external controller's on
  // this broker) are the feed-forward signal: the expected effect is known now,
  // one EVCC loop before its state topics confirm it.
  if (topic.endsWith("/set")) {
    const command = parseLoadpointTopic(topicRoot, topic.slice(0, -"/set".length));
    if (command && estimator.feedForward(command.index, command.key, payload.toString().trim())) {
      emitNow();
    }
    return;
  }
  const parsed = parseLoadpointTopic(topicRoot, topic);
  if (!parsed) return;
  let values = loadpoints.get(parsed.index);
  if (!values) {
    values = new Map();
    loadpoints.set(parsed.index, values);
  }
  const value = coercePayload(payload.toString());
  // An empty retained payload is MQTT's "topic deleted" signal.
  if (value === null && payload.length === 0) values.delete(parsed.key);
  else values.set(parsed.key, value);
  trackEstimator(parsed.index, parsed.key, value);
  scheduleEmit();
}

/**
 * Feed one house-load sample (W) from the inverter poll loop into the charge-
 * power estimator; `null` when the load metric is unavailable. Gated on the
 * `subtractFromHome` flag: it asserts the charger sits behind the house-load
 * meter, which is exactly the precondition for residual attribution — without
 * it the charger never shows in the load signal and steps would be misread.
 */
export function evccOnLoadSample(loadW: number | null): void {
  if (!client || !subtractFromHome) return;
  if (estimator.onLoadSample(loadW)) scheduleEmit();
}

async function stopClient(): Promise<void> {
  const previous = client;
  client = null;
  connected = false;
  evccStatus = null;
  loadpoints.clear();
  estimator.reset();
  if (emitTimer) {
    clearTimeout(emitTimer);
    emitTimer = null;
  }
  if (previous) await previous.endAsync();
}

/**
 * (Re)build the EVCC subscriber from the current EVCC + MQTT settings. Called
 * at boot and whenever either config is saved; tears down to "off" when
 * disabled. Reconnect/backoff on a live client is the mqtt lib's job.
 */
export async function rebuildEvcc(): Promise<void> {
  const [config, mqttConfig] = await Promise.all([getEvccConfig(), getMqttConfig()]);
  await stopClient();
  subtractFromHome = config.subtractFromHome;
  if (!evccReady(config, mqttConfig)) return;

  topicRoot = config.topicRoot;
  const next = mqtt.connect(mqttConfig.brokerUrl, {
    username: mqttConfig.username,
    password: mqttConfig.password,
  });
  client = next;

  next.on("connect", () => {
    connected = true;
    next.subscribe([`${topicRoot}/status`, `${topicRoot}/loadpoints/#`], (err) => {
      if (err) logger.error("subscribe failed: {error}", { error: err });
    });
    logger.info('connected to {brokerUrl} (root "{root}")', {
      brokerUrl: mqttConfig.brokerUrl,
      root: topicRoot,
    });
  });
  next.on("close", () => {
    connected = false;
    scheduleEmit(); // dropped connection → push reachable:false
  });
  next.on("message", handleMessage);
  next.on("error", (err) => {
    logger.error("client error: {error}", { error: err });
  });
}

/** Release the client (graceful shutdown). */
export async function stopEvcc(): Promise<void> {
  await stopClient();
}
