/**
 * Runtime connection config, DB-backed and hot-editable — MQTT, plus what is now
 * only a LEGACY READER for the inverter.
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

/**
 * THE 1.x CONNECTION DOCUMENT, READ-ONLY. Not the poll loop's source.
 *
 * `app_settings.inverter` (host, port, transport, unitId, timeoutMs,
 * pollIntervalMs) was the authority until 2.0.0's dual-authority defect was
 * removed: the poll loop resolved its endpoint from here while
 * `../inverter/provision-boot.ts` copied this same document into `connections`
 * and `devices.unit_id` on every boot and every settings save. Two writable homes
 * for one fact, synced one way, with this one winning — so editing the
 * `connections` row (the thing the schema calls the endpoint) changed nothing,
 * and the loop could only ever drive ONE endpoint and ONE unit id no matter how
 * many the tables held. `../inverter/endpoint.ts` carries the full account.
 *
 * WHAT IS LEFT, AND WHAT MUST NOT COME BACK
 *
 * This reader survives because a 1.2.0 install's endpoint lives NOWHERE ELSE, and
 * the first boot after the in-place upgrade is the one chance to carry it into the
 * spine. It is consulted in exactly two places, both of them one-way:
 *
 *  - `../inverter/provision-boot.ts`'s boot SEED — creates rows this install has
 *    none of, never edits one it has;
 *  - `../inverter/endpoint.ts`'s `readConnectionSettings` — what the settings form
 *    shows before any endpoint row exists (the env-seeded defaults it has always
 *    shown).
 *
 * There is deliberately NO SETTER. Restoring one — or re-pointing the runtime at
 * this reader — restores the defect, because nothing downstream can tell which of
 * two homes an operator's edit landed in. The endpoint is written through
 * `../inverter/endpoint.ts`'s `saveConnectionSettings` and nowhere else.
 */
export async function getInverterConfig(): Promise<InverterConfig> {
  inverterCache ??= await readSetting(INVERTER_KEY, inverterConfigSchema, envInverterConfig());
  return inverterCache;
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
