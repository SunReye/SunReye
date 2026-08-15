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
 * all derive from the profile's manifest metrics and their constraints. Adding a
 * metric to a profile extends the MQTT surface with zero code here. The discovery
 * payload mapping itself is pure and lives in {@link ./mqtt-discovery}.
 *
 * Config-driven and hot-swappable: `startMqttBridge(config, deps)` returns
 * `null` when disabled. The runtime controller owns the lifecycle and injects
 * the inverter `write`, so this module has no singleton/env coupling.
 */

import type { MqttConfig } from "@SunReye/db/mqtt-config";
import type { InverterSample } from "@SunReye/inverter-core";
import { entityConstraint } from "@SunReye/inverter-core";
import mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import type { ProfileContext } from "./inverter";
import { log } from "../shared/logging";
import {
  FORECAST_VARIANTS,
  type HaDevice,
  discoveryConfig,
  forecastDiscoveryConfig,
  forecastObjectId,
  slug,
  topicsFor,
} from "./mqtt-discovery";
import type { ForecastVariant, SolarForecastExport } from "../forecast/solar-forecast";

const logger = log("mqtt");

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

  /** Subscribe to every writable entity's command topic (no-op when none). */
  function subscribeCommands(): void {
    const commandTopics = [...keyByCommandTopic.keys()];
    if (commandTopics.length === 0) return;
    client.subscribe(commandTopics, (err) => {
      if (err) logger.error("subscribe failed: {error}", { error: err });
    });
  }

  /** The retained discovery topic one announcement is published to. */
  const discoveryTopic = (component: string, objectId: string): string =>
    `${config.haDiscoveryPrefix}/${component}/sunreye_${profile.id}/${objectId}/config`;

  /** (Re)publish the retained HA discovery configs: one per entity, plus the
   *  two forecast sensors. Called on every connect so they survive a broker
   *  restart; retained, so HA re-reads them on its own reconnect. */
  function publishDiscovery(): void {
    for (const m of manifest.metrics) {
      const def = defByKey.get(m.key);
      if (!def) continue;
      const disc = discoveryConfig(m, entityConstraint(def), topics, profile.id, haDevice);
      client.publish(discoveryTopic(disc.component, slug(m.key)), JSON.stringify(disc.config), {
        retain: true,
      });
    }
    for (const variant of FORECAST_VARIANTS) {
      const disc = forecastDiscoveryConfig(topics, profile.id, haDevice, variant);
      client.publish(
        discoveryTopic(disc.component, forecastObjectId(variant)),
        JSON.stringify(disc.config),
        { retain: true },
      );
    }
    logger.info("published HA discovery for {count} entities", {
      count: manifest.metrics.length,
    });
  }

  client.on("connect", () => {
    connected = true;
    lastError = null;
    client.publish(topics.availability, "online", { retain: true });
    subscribeCommands();
    if (config.haDiscoveryEnabled) publishDiscovery();
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
    // An empty payload is how MQTT *deletes* a retained message, not a command:
    // `Number("")` is 0, so without this guard tidying up a retained setpoint
    // would drive the register to zero (e.g. max charge current → 0 A).
    const raw = payload.toString().trim();
    if (raw === "") {
      logger.warn("{topic}: empty payload ignored", { topic });
      return;
    }
    const value = Number(raw);
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
