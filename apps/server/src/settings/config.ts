/**
 * Runtime connection config (inverter + MQTT), DB-backed and hot-editable.
 *
 * Reads are cached and seeded from env when no row exists yet, so existing
 * env-only deployments keep working until a setting is saved from the UI. The
 * MQTT password is write-only over the API: {@link maskMqttConfig} strips it on
 * read and {@link mergeMqttWrite} preserves the stored one when a write omits it.
 */

import { env } from "@SunReye/env/server";
import {
  INVERTER_KEY,
  type InverterConfig,
  inverterConfigSchema,
} from "@SunReye/db/inverter-config";
import {
  MQTT_KEY,
  type MqttConfig,
  mergeMqttWrite,
  mqttConfigSchema,
} from "@SunReye/db/mqtt-config";
import { readSetting, writeSetting } from "./app-settings";

/** Defaults seeded from env the first time a config is read (pre-save). */
const envInverterConfig = (): InverterConfig =>
  inverterConfigSchema.parse({
    host: env.INVERTER_HOST,
    port: env.INVERTER_PORT,
    unitId: env.INVERTER_UNIT_ID,
    transport: env.INVERTER_TRANSPORT,
    pollIntervalMs: env.POLL_INTERVAL_MS,
  });

const envMqttConfig = (): MqttConfig =>
  mqttConfigSchema.parse({
    enabled: env.MQTT_ENABLED,
    brokerUrl: env.MQTT_BROKER_URL,
    username: env.MQTT_USERNAME,
    password: env.MQTT_PASSWORD,
    topicPrefix: env.MQTT_TOPIC_PREFIX,
    haDiscoveryEnabled: env.HA_DISCOVERY_ENABLED,
    haDiscoveryPrefix: env.HA_DISCOVERY_PREFIX,
  });

let inverterCache: InverterConfig | null = null;
let mqttCache: MqttConfig | null = null;

export async function getInverterConfig(): Promise<InverterConfig> {
  inverterCache ??= await readSetting(INVERTER_KEY, inverterConfigSchema, envInverterConfig());
  return inverterCache;
}

export async function setInverterConfig(input: unknown): Promise<InverterConfig> {
  const config = inverterConfigSchema.parse(input);
  await writeSetting(INVERTER_KEY, config);
  inverterCache = config;
  return config;
}

export async function getMqttConfig(): Promise<MqttConfig> {
  mqttCache ??= await readSetting(MQTT_KEY, mqttConfigSchema, envMqttConfig());
  return mqttCache;
}

/**
 * Validate an incoming MQTT config and merge it over the stored one (preserving
 * the write-only password when absent) — without persisting. Used by both the
 * save path and the connection test.
 */
export async function mergeMqttConfig(input: unknown): Promise<MqttConfig> {
  return mergeMqttWrite(await getMqttConfig(), mqttConfigSchema.parse(input));
}

export async function setMqttConfig(input: unknown): Promise<MqttConfig> {
  const config = await mergeMqttConfig(input);
  await writeSetting(MQTT_KEY, config);
  mqttCache = config;
  return config;
}
