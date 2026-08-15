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
 * - vehicle topics mirror that shape as `<root>/vehicles/<name>/<key>`, keyed
 *   by the EVCC config slug the loadpoint reports as `vehicleName`.
 * - `<root>/status` is EVCC's own online/offline (LWT) topic — the freshness
 *   signal; broker-retained state can outlive a dead EVCC.
 * - commands are `<root>/loadpoints/<n>/<key>/set`; state topics use
 *   camelCase there too (`limitSoc/set`, unlike the REST API's lowercase path).
 *   Vehicle-scoped commands exist too (`<root>/vehicles/<name>/<key>/set`).
 * - live updates arrive with `retain=false`; only the snapshot on subscribe
 *   carries the retain flag, so it must never be filtered on.
 * - the charge limit is **three-layered**: a durable per-vehicle `limitSoc`, a
 *   per-session loadpoint `limitSoc` override, and the loadpoint's
 *   `effectiveLimitSoc` as EVCC's resolution of the two. Read the effective
 *   one, write the vehicle one — see {@link limitSocTopic}.
 * - `batteryBoost` is only accepted in the `pv`/`minpv` modes; EVCC rejects it
 *   outright otherwise, and clears it on every mode change. So a boost command
 *   must follow its mode command, never precede it.
 *

 * The topic grammar and payload coercion those notes describe live in
 * {@link ./evcc-topics}, which is pure and unit-tested.
 */

import { evccReady } from "@SunReye/db/evcc-config";
import mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import { getMqttConfig } from "../settings/config";
import {
  createEvPowerEstimator,
  type ChargePowerSource,
  type LiveChargePower,
  type LoadpointParams,
} from "./ev-power-estimator";
import {
  type EvccValue,
  coercePayload,
  parseLoadpointTopic,
  parseVehicleTopic,
} from "./evcc-topics";
import { getEvccConfig } from "../settings/evcc-settings";
import { log } from "../shared/logging";
import type { Streams } from "../shared/streams";

const logger = log("evcc");

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
  /**
   * Config slug of the detected vehicle (`tesla_ble`) — the key under
   * `<root>/vehicles/`. Carried for the limit write path, which targets the
   * vehicle rather than the loadpoint; prefer {@link vehicleTitle} for display.
   */
  vehicleName: string | null;
  /** Energy added this charging session in Wh. */
  sessionEnergy: number | null;
  /** Energy still needed to reach the charge limit in Wh (EVCC's estimate). */
  chargeRemainingEnergy: number | null;
  /**
   * The loadpoint's *session* charge limit in %, EVCC's per-session override of
   * the vehicle's configured limit. `0` means "no override", **not** "no limit",
   * and EVCC clears it on unplug or restart — so it is never the value to
   * display on its own. See {@link effectiveLimitSoc}.
   */
  limitSoc: number | null;
  /**
   * The limit EVCC actually charges to, in % — its own resolution of the
   * session override and the vehicle's configured limit. This is what EVCC's UI
   * shows, so it is what the dashboard renders. `0`/null = no limit.
   */
  effectiveLimitSoc: number | null;
  /**
   * Charge limit read *from the car* in %, informational only: EVCC surfaces it
   * so a taper it does not control can be explained. Not writable, and not part
   * of the effective-limit resolution.
   */
  vehicleLimitSoc: number | null;
  /**
   * Battery boost: EVCC is deliberately draining the *house* battery into this
   * car. Transient — EVCC keeps it in memory only and clears it on any mode
   * change and on unplug, so there is no durable value to give back.
   *
   * EVCC refuses to enable it outside the `pv`/`minpv` modes.
   */
  batteryBoost: boolean;
  /**
   * House-battery SOC floor for {@link batteryBoost}, %: once the battery falls
   * below it EVCC stops draining but keeps the car prioritised over recharging,
   * so it settles at the limit instead of oscillating. `100` means *disabled*,
   * which is also EVCC's default. Unlike the boost flag this **is** persisted by
   * EVCC, so anything that changes it owes the user a restore.
   */
  batteryBoostLimit: number | null;
  /**
   * Usable pack size of the detected vehicle in kWh, from
   * `<root>/vehicles/<name>/capacity`. Null when no vehicle is detected, or
   * when EVCC has none configured for it (published as `0`) — a car without a
   * capacity is one nothing can be estimated for. Carried on the loadpoint
   * because that is where the SoC and the limit already are, and the three are
   * only useful together.
   */
  vehicleCapacityKwh: number | null;
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

/**
 * Writable loadpoint commands.
 *
 * `mode` and `limitSoc` are the two the web app relays; `batteryBoost` and
 * `batteryBoostLimit` are used by price-aware charging only (see
 * `./ev-pull-in`) and are deliberately not offered over HTTP.
 */
export type EvccAction = "mode" | "limitSoc" | "batteryBoost" | "batteryBoostLimit";

const num = (v: EvccValue | undefined): number | null => (typeof v === "number" ? v : null);
const str = (v: EvccValue | undefined): string | null => (typeof v === "string" ? v : null);
const bool = (v: EvccValue | undefined): boolean => v === true;

/**
 * Pack size of a named vehicle, in kWh. Null for an unnamed or unknown car, and
 * for the `0` EVCC publishes when a vehicle is configured without a capacity —
 * that is "unknown", not a zero-sized pack.
 */
function capacityOf(
  vehicleName: string | null,
  vehicleState: Map<string, Map<string, EvccValue>>,
): number | null {
  if (vehicleName === null) return null;
  const capacity = num(vehicleState.get(vehicleName)?.get("capacity"));
  return capacity !== null && capacity > 0 ? capacity : null;
}

/**
 * Assemble the API snapshot for one loadpoint from its flat topic map.
 *
 * `vehicleState` is the ingested `<root>/vehicles/…` tree: the loadpoint names
 * its vehicle, but the pack size is published on the vehicle itself.
 */
function toLoadpoint(
  index: number,
  values: Map<string, EvccValue>,
  live: LiveChargePower | null,
  vehicleState: Map<string, Map<string, EvccValue>>,
): EvccLoadpoint {
  const chargePower = num(values.get("chargePower")) ?? 0;
  const vehicleName = str(values.get("vehicleName"));
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
    vehicleTitle: str(values.get("vehicleTitle")) ?? vehicleName,
    vehicleName,
    sessionEnergy: num(values.get("sessionEnergy")),
    chargeRemainingEnergy: num(values.get("chargeRemainingEnergy")),
    limitSoc: num(values.get("limitSoc")),
    effectiveLimitSoc: num(values.get("effectiveLimitSoc")),
    vehicleLimitSoc: num(values.get("vehicleLimitSoc")),
    batteryBoost: bool(values.get("batteryBoost")),
    batteryBoostLimit: num(values.get("batteryBoostLimit")),
    vehicleCapacityKwh: capacityOf(vehicleName, vehicleState),
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
/**
 * Ingested `<root>/vehicles/<name>/…` state, keyed by config slug. Two jobs: it
 * tells {@link limitSocTopic} which vehicles EVCC actually knows, so a limit
 * write can be persisted on the right one, and it carries the pack size the
 * loadpoint snapshot folds in as
 * {@link EvccLoadpoint.vehicleCapacityKwh}.
 */
const vehicles = new Map<string, Map<string, EvccValue>>();
const estimator = createEvPowerEstimator();

/**
 * The read-side bus each fresh snapshot is emitted onto, injected by
 * {@link rebuildEvcc}. Null until the first (boot) rebuild wires it; the socket
 * layer fans one emit out to every `/ws/evcc` subscriber.
 */
let stream: Streams | null = null;
let emitTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (snap) stream?.emit("evcc", snap);
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
  if (snap) stream?.emit("evcc", snap);
}

/** Current EVCC state for `GET /api/evcc` and WS pushes, or `null` when off. */
export function evccSnapshot(): EvccState | null {
  if (!client) return null;
  return {
    reachable: connected && evccStatus === "online",
    loadpoints: [...loadpoints.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, values]) => toLoadpoint(index, values, estimator.live(index), vehicles)),
    subtractFromHome,
  };
}

/**
 * Where a charge-limit write belongs.
 *
 * EVCC keeps the limit in three layers: the durable per-vehicle `limitSoc`, a
 * per-session loadpoint `limitSoc` override, and the loadpoint's
 * `effectiveLimitSoc` resolving the two. Writing the loadpoint override only
 * sticks until EVCC clears the session (vehicle unplug, EVCC restart), after
 * which the limit silently reverts — so whenever the loadpoint reports a vehicle
 * we have actually ingested, persist the limit on that vehicle, exactly as
 * EVCC's own UI does. The loadpoint override remains the fallback for an
 * unidentified car (guest vehicle, no vehicle configured).
 */
function limitSocTopic(loadpoint: number): string {
  const vehicleName = str(loadpoints.get(loadpoint)?.get("vehicleName"));
  if (vehicleName !== null && vehicles.has(vehicleName)) {
    return `${topicRoot}/vehicles/${vehicleName}/limitSoc/set`;
  }
  return `${topicRoot}/loadpoints/${loadpoint}/limitSoc/set`;
}

/**
 * Publish a command to EVCC (`.../<action>/set`). EVCC applies it and
 * republishes the state topic, so the UI converges via the normal ingest.
 * `mode` is always loadpoint-scoped; `limitSoc` is routed by
 * {@link limitSocTopic}.
 */
export function evccControl(loadpoint: number, action: EvccAction, value: string): void {
  if (!client || !connected) throw new Error("EVCC MQTT is not connected");
  const topic =
    action === "limitSoc"
      ? limitSocTopic(loadpoint)
      : `${topicRoot}/loadpoints/${loadpoint}/${action}/set`;
  client.publish(topic, value);
}

/**
 * The loadpoint state topics the estimator mirrors, and the parameter each one
 * sets. Keys not listed here don't affect the estimate.
 */
const ESTIMATOR_PARAM_BY_KEY: Record<string, (value: EvccValue) => Partial<LoadpointParams>> = {
  charging: (v) => ({ charging: v === true }),
  connected: (v) => ({ connected: v === true }),
  mode: (v) => ({ mode: typeof v === "string" ? v : null }),
  phasesActive: (v) => ({ phasesActive: num(v) }),
  effectiveMaxCurrent: (v) => ({ maxCurrentA: num(v) }),
};

/** Mirror the estimator-relevant state keys into it as they stream in. */
function trackEstimator(index: number, key: string, value: EvccValue): void {
  // `chargePower` is EVCC's own measurement, not a parameter — it re-anchors.
  if (key === "chargePower") {
    if (typeof value === "number") estimator.anchorPower(index, value);
    return;
  }
  const toParams = ESTIMATOR_PARAM_BY_KEY[key];
  if (toParams) estimator.updateParams(index, toParams(value));
}

/**
 * Record one coerced leaf value in an entity's flat topic map, creating the map
 * on first sight of the entity. Returns the coerced value.
 */
function storeValue<K>(
  store: Map<K, Map<string, EvccValue>>,
  id: K,
  key: string,
  payload: Buffer,
): EvccValue {
  let values = store.get(id);
  if (!values) {
    values = new Map();
    store.set(id, values);
  }
  const value = coercePayload(payload.toString());
  // An empty retained payload is MQTT's "topic deleted" signal.
  if (value === null && payload.length === 0) values.delete(key);
  else values.set(key, value);
  return value;
}

function handleMessage(topic: string, payload: Buffer): void {
  if (topic === `${topicRoot}/status`) {
    evccStatus = payload.toString().trim();
    scheduleEmit(); // reachability changed
    return;
  }
  // `.../set` command echoes (our own writes and any external controller's on
  // this broker) are the feed-forward signal: the expected effect is known now,
  // one EVCC loop before its state topics confirm it. Only loadpoint commands
  // predict anything — vehicle-scoped echoes (our own limit writes) resolve to
  // no command here and are dropped.
  if (topic.endsWith("/set")) {
    const command = parseLoadpointTopic(topicRoot, topic.slice(0, -"/set".length));
    if (command && estimator.feedForward(command.index, command.key, payload.toString().trim())) {
      emitNow();
    }
    return;
  }
  const parsed = parseLoadpointTopic(topicRoot, topic);
  if (parsed) {
    const value = storeValue(loadpoints, parsed.index, parsed.key, payload);
    trackEstimator(parsed.index, parsed.key, value);
    scheduleEmit();
    return;
  }
  const vehicle = parseVehicleTopic(topicRoot, topic);
  if (!vehicle) return;
  // No emit: vehicle state is write-routing input only (see the vehicles map),
  // never part of the snapshot, so a push here would repeat the last one. EVCC
  // mirrors every limit change onto the loadpoint's own topics anyway, and that
  // branch above emits.
  storeValue(vehicles, vehicle.name, vehicle.key, payload);
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
  vehicles.clear();
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
 *
 * `streamBus` wires the read-side bus and is passed only on the boot call; the
 * settings-save rebuilds omit it and keep the bus wired at boot.
 */
export async function rebuildEvcc(streamBus?: Streams): Promise<void> {
  if (streamBus) stream = streamBus;
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
    next.subscribe(
      [`${topicRoot}/status`, `${topicRoot}/loadpoints/#`, `${topicRoot}/vehicles/#`],
      (err) => {
        if (err) logger.error("subscribe failed: {error}", { error: err });
      },
    );
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
