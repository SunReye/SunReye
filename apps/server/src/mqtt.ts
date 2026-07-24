/**
 * MQTT integration bridge.
 *
 * Publishes every entity's latest value (retained) to
 * `<prefix>/<inverterId>/<topic>` and accepts writes on `.../set` for writable
 * entities — the same topics the vendor docs describe. Optionally publishes
 * Home Assistant MQTT Discovery configs so SunReye auto-populates in HA with no
 * manual entity setup.
 *
 * Like every other transport in this app, the surface is generated from the
 * active profile's entity catalog: topics, discovery components, and validation
 * all derive from {@link ManifestMetric} / {@link EntityConstraint}. Adding a
 * metric to a profile extends the MQTT surface with zero code here.
 *
 * Config-driven and hot-swappable: `startMqttBridge(config, deps)` returns
 * `null` when disabled. The runtime controller owns the lifecycle and injects
 * the inverter `write`, so this module has no singleton/env coupling.
 */

import type { MqttConfig } from "@SunReye/db/mqtt-config";
import type { EntityConstraint, InverterSample, ManifestMetric } from "@SunReye/inverter-core";
import { entityConstraint } from "@SunReye/inverter-core";
import mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import type { ProfileContext } from "./inverter";
import { log } from "./logging";
import type { ForecastVariant, SolarForecastExport } from "./solar-forecast";

const logger = log("mqtt");

/** The stable HA device (per profile) that all entities attach to. */
type HaDevice = { identifiers: string[]; name: string; manufacturer: string; model: string };

/** HA object ids / unique ids must be a restricted charset; keys are dotted. */
const slug = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, "_");

/** Topic builders for a given prefix (`<prefix>/<inverterId>/...`). */
function topicsFor(prefix: string, profileId: string) {
  const base = `${prefix}/${profileId}`;
  return {
    base,
    availability: `${base}/status`,
    state: (m: ManifestMetric): string => `${base}/${m.topic}`,
    command: (m: ManifestMetric): string => `${base}/${m.topic}/set`,
    // PV production forecast, per variant (`raw` potential vs `usable` post-clipping):
    // a scalar state (today's kWh) plus the full forecast as retained JSON attributes.
    forecastState: (v: ForecastVariant): string => `${base}/forecast/${v}`,
    forecastAttrs: (v: ForecastVariant): string => `${base}/forecast/${v}/attributes`,
  };
}
type Topics = ReturnType<typeof topicsFor>;

/** HA `device_class` by unit. `%` depends on role, so it's handled separately. */
const DEVICE_CLASS_BY_UNIT: Record<string, string> = {
  W: "power",
  VA: "apparent_power",
  kWh: "energy",
  V: "voltage",
  A: "current",
  Hz: "frequency",
  "°C": "temperature",
};

/** HA `device_class`, inferred from unit/role. Omitted when nothing fits. */
function deviceClass(m: ManifestMetric): string | undefined {
  if (m.unit === "%") return m.role === "battery.soc" ? "battery" : undefined;
  return m.unit ? DEVICE_CLASS_BY_UNIT[m.unit] : undefined;
}

/** HA `state_class`: cumulative counters increase monotonically, else a scalar. */
function stateClass(m: ManifestMetric): string | undefined {
  if (m.kind === "cumulative") return "total_increasing";
  if (m.kind === "measurement") return "measurement";
  return undefined;
}

/** Drop `undefined`-valued keys so optional HA config fields are simply absent. */
function clean<T extends Record<string, unknown>>(config: T): T {
  return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)) as T;
}

/** Jinja mapping a published raw value to its friendly enum label (state side). */
const valueToLabelTemplate = (labels: Record<number, string>): string =>
  `{% set m = ${JSON.stringify(labels)} %}{{ m[value] if value in m else value }}`;

type Discovery = { component: string; config: Record<string, unknown> };

/**
 * HA `number` entities default their range to **0–100** when `min`/`max` are
 * omitted, silently rejecting any real setpoint above 100 (e.g. a 6000 W TOU
 * power). When a profile metric declares no `range`, fall back to this permissive
 * envelope so a missing range degrades to "accept realistic values" instead of
 * "reject > 100". Declaring an explicit `range` on the metric is still the right
 * fix — it renders a bounded slider and clamps writes; this is only a safety net
 * (notably for downloaded data profiles that may omit ranges).
 */
const NUMBER_RANGE_FALLBACK = { min: 0, max: 100_000 };

/**
 * The HA discovery component for an entity and its config payload.
 *
 * - writable enum → `select` (options are the friendly labels; templates map
 *   label ↔ raw value both ways).
 * - writable number → `number` (min/max from the profile range).
 * - read-only enum/status → `sensor` with a template that renders the label.
 * - everything else → `sensor` with device/state class.
 */
function discoveryConfig(
  m: ManifestMetric,
  c: EntityConstraint,
  topics: Topics,
  profileId: string,
  haDevice: HaDevice,
): Discovery {
  const labels = m.enumLabels;
  // The HA component (domain) this entity maps to — decided by the same branches
  // below. Needed up front because `default_entity_id` (unlike the deprecated
  // `object_id` it replaces) must carry the domain prefix, e.g. `sensor.…`.
  const component = c.writable ? (labels ? "select" : "number") : "sensor";
  const shared = clean({
    name: m.label,
    unique_id: `sunreye_${profileId}_${slug(m.key)}`,
    // Replaces deprecated `object_id` (removed in HA Core 2026.4). HA derives the
    // suggested entity_id from this; it must include the component domain.
    default_entity_id: `${component}.sunreye_${slug(m.key)}`,
    state_topic: topics.state(m),
    availability_topic: topics.availability,
    unit_of_measurement: m.unit ?? undefined,
    device: haDevice,
  });

  if (c.writable && labels) {
    // label→value for commands, value→label for state display.
    const toValue = Object.fromEntries(Object.entries(labels).map(([v, l]) => [l, Number(v)]));
    return {
      component: "select",
      config: {
        ...shared,
        command_topic: topics.command(m),
        options: Object.values(labels),
        command_template: `{% set m = ${JSON.stringify(toValue)} %}{{ m[value] }}`,
        value_template: valueToLabelTemplate(labels),
      },
    };
  }

  if (c.writable) {
    return {
      component: "number",
      config: clean({
        ...shared,
        command_topic: topics.command(m),
        min: c.min ?? NUMBER_RANGE_FALLBACK.min,
        max: c.max ?? NUMBER_RANGE_FALLBACK.max,
        mode: "box",
        device_class: deviceClass(m),
      }),
    };
  }

  if (labels) {
    return {
      component: "sensor",
      config: { ...shared, value_template: valueToLabelTemplate(labels) },
    };
  }

  return {
    component: "sensor",
    config: clean({ ...shared, device_class: deviceClass(m), state_class: stateClass(m) }),
  };
}

/** Human-readable suffix per forecast variant, for the HA sensor name. */
const FORECAST_VARIANT_LABEL: Record<ForecastVariant, string> = {
  raw: "Solar forecast",
  usable: "Solar forecast (usable)",
};

/**
 * HA discovery config for a PV production forecast sensor (one per variant: `raw`
 * potential and `usable` post-clipping output). State is today's expected kWh; the
 * full forecast — including the Solcast-style `detailedForecast` curve — rides
 * `json_attributes_topic` so blueprints read it via `state_attr`.
 */
export function forecastDiscoveryConfig(
  topics: Topics,
  profileId: string,
  haDevice: HaDevice,
  variant: ForecastVariant,
): Discovery {
  const key = variant === "raw" ? "forecast" : `forecast_${variant}`;
  return {
    component: "sensor",
    config: {
      name: FORECAST_VARIANT_LABEL[variant],
      unique_id: `sunreye_${profileId}_${key}`,
      default_entity_id: `sensor.sunreye_${profileId}_${key}`,
      state_topic: topics.forecastState(variant),
      json_attributes_topic: topics.forecastAttrs(variant),
      availability_topic: topics.availability,
      unit_of_measurement: "kWh",
      device_class: "energy",
      // A forecast, not a meter reading: it revises up and down as the provider
      // updates, so it's a measurement, not a monotonic `total_increasing`.
      state_class: "measurement",
      device: haDevice,
    },
  };
}

/** The two forecast variants published/discovered, in a stable order. */
const FORECAST_VARIANTS: ForecastVariant[] = ["raw", "usable"];

export interface MqttStatus {
  connected: boolean;
  lastError: string | null;
}

export interface MqttBridge {
  /** Publish every metric in a sample to its retained state topic. */
  publishSample(sample: InverterSample): void;
  /** Publish both PV forecast variants (retained); `null` is a no-op. */
  publishForecast(forecast: Record<ForecastVariant, SolarForecastExport> | null): void;
  status(): MqttStatus;
  close(): Promise<void>;
}

export interface MqttBridgeDeps {
  /** The active profile context (manifest, catalog, write validator). */
  ctx: ProfileContext;
  /** Apply an inbound command write (validated by the bridge first). */
  write(key: string, value: number): Promise<void>;
}

/**
 * Connect to the broker and wire up the bridge, or return `null` when MQTT is
 * disabled. Command subscriptions and (optional) HA discovery are (re)published
 * on every `connect` so they survive broker restarts and reconnects.
 */
export function startMqttBridge(config: MqttConfig, deps: MqttBridgeDeps): MqttBridge | null {
  if (!config.enabled) return null;

  const { profile, manifest, defByKey, validateWrite } = deps.ctx;
  const haDevice: HaDevice = {
    identifiers: [`sunreye_${profile.id}`],
    name: manifest.name,
    manufacturer: manifest.manufacturer,
    model: profile.id,
  };
  const topics = topicsFor(config.topicPrefix, profile.id);
  let connected = false;
  let lastError: string | null = null;
  // Latest forecast (both variants), kept so a reconnect can restore its retained
  // topics promptly (the runtime otherwise only re-publishes on its slow interval).
  let lastForecast: Record<ForecastVariant, SolarForecastExport> | null = null;

  /** Publish both forecast variants to their retained state + attributes topics. */
  function emitForecast(forecast: Record<ForecastVariant, SolarForecastExport>): void {
    for (const variant of FORECAST_VARIANTS) {
      const view = forecast[variant];
      client.publish(topics.forecastState(variant), String(view.todayKwh), { retain: true });
      client.publish(topics.forecastAttrs(variant), JSON.stringify(view), { retain: true });
    }
  }

  const client: MqttClient = mqtt.connect(config.brokerUrl, {
    username: config.username,
    password: config.password,
    // LWT: the broker flips us to "offline" if the connection drops, so HA
    // marks the entities unavailable instead of showing a stale last value.
    will: { topic: topics.availability, payload: "offline", qos: 0, retain: true },
  });

  // Writable entities, indexed by their command topic for O(1) inbound dispatch.
  const keyByCommandTopic = new Map<string, string>();
  for (const m of manifest.metrics) {
    if (m.writable) keyByCommandTopic.set(topics.command(m), m.key);
  }

  client.on("connect", () => {
    connected = true;
    lastError = null;
    client.publish(topics.availability, "online", { retain: true });

    const commandTopics = [...keyByCommandTopic.keys()];
    if (commandTopics.length > 0) {
      client.subscribe(commandTopics, (err) => {
        if (err) logger.error("subscribe failed: {error}", { error: err });
      });
    }

    if (config.haDiscoveryEnabled) {
      for (const m of manifest.metrics) {
        const def = defByKey.get(m.key);
        if (!def) continue;
        const { component, config: cfg } = discoveryConfig(
          m,
          entityConstraint(def),
          topics,
          profile.id,
          haDevice,
        );
        const topic = `${config.haDiscoveryPrefix}/${component}/sunreye_${profile.id}/${slug(m.key)}/config`;
        client.publish(topic, JSON.stringify(cfg), { retain: true });
      }
      for (const variant of FORECAST_VARIANTS) {
        const disc = forecastDiscoveryConfig(topics, profile.id, haDevice, variant);
        const objectId = variant === "raw" ? "forecast" : `forecast_${variant}`;
        client.publish(
          `${config.haDiscoveryPrefix}/${disc.component}/sunreye_${profile.id}/${objectId}/config`,
          JSON.stringify(disc.config),
          { retain: true },
        );
      }
      logger.info("published HA discovery for {count} entities", {
        count: manifest.metrics.length,
      });
    }

    // Restore the retained forecast topics on (re)connect.
    if (lastForecast) emitForecast(lastForecast);

    logger.info('connected to {brokerUrl} (prefix "{prefix}")', {
      brokerUrl: config.brokerUrl,
      prefix: topics.base,
    });
  });

  client.on("close", () => {
    connected = false;
  });

  client.on("message", async (topic, payload) => {
    const key = keyByCommandTopic.get(topic);
    if (!key) return; // Not a command topic we own.
    const value = Number(payload.toString().trim());
    if (Number.isNaN(value)) {
      logger.warn('{topic}: non-numeric payload "{payload}"', {
        topic,
        payload: payload.toString(),
      });
      return;
    }
    const error = validateWrite(key, value);
    if (error) {
      logger.warn("{topic}: rejected {value}: {error}", { topic, value, error });
      return;
    }
    try {
      await deps.write(key, value);
    } catch (err) {
      logger.error("write {key}={value} failed: {error}", { key, value, error: err });
    }
  });

  client.on("error", (err) => {
    lastError = err instanceof Error ? err.message : String(err);
    logger.error("client error: {error}", { error: err });
  });

  return {
    publishSample(sample) {
      // Skip while offline: state topics are retained "latest value", so there's
      // nothing to gain from queueing stale samples for replay on reconnect.
      if (!client.connected) return;
      for (const m of manifest.metrics) {
        const value = sample.metrics[m.key];
        if (value === undefined) continue;
        client.publish(topics.state(m), String(value), { retain: true });
      }
    },
    publishForecast(forecast) {
      if (!forecast) return;
      // Remember it for reconnect restore even while offline; only hit the wire
      // when connected (topics are retained "latest", nothing to queue).
      lastForecast = forecast;
      if (client.connected) emitForecast(forecast);
    },
    status() {
      return { connected, lastError };
    },
    async close() {
      // Flip availability to "offline" cleanly before disconnecting so HA
      // doesn't have to wait for the LWT timeout.
      await new Promise<void>((resolve) => {
        client.publish(topics.availability, "offline", { retain: true }, () => resolve());
      });
      await client.endAsync();
    },
  };
}
