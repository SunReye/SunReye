/**
 * Runtime connection config, DB-backed and hot-editable — MQTT, plus what is now
 * only a LEGACY READER for the inverter.
 *
 * Reads are cached and seeded from env when no row exists yet, so existing
 * env-only deployments keep working until a setting is saved from the UI. The
 * MQTT password is write-only over the API: {@link maskMqttConfig} strips it on
 * read and {@link mergeMqttWrite} preserves the stored one when a write omits it.
 */

import { z } from "zod";

import { env } from "@SunReye/env/server";
import {
  INVERTER_KEY,
  type InverterConfig,
  inverterConfigSchema,
} from "@SunReye/db/inverter-config";
import { MQTT_KEY, type MqttConfig, mqttConfigSchema } from "@SunReye/db/mqtt-config";
import { readSetting, writeSetting } from "./app-settings";

/** Defaults seeded from env the first time a config is read (pre-save). */
const envInverterConfig = (): InverterConfig =>
  inverterConfigSchema.parse({
    host: env.INVERTER_HOST,
    port: env.INVERTER_PORT,
    unitId: env.INVERTER_UNIT_ID,
    transport: env.INVERTER_TRANSPORT,
    // The Solarman stick's serial. Only a seed, like everything else here — the
    // V5 port rediscovers it on every connect — but an appliance configured
    // entirely from env would otherwise pay that round trip forever.
    loggerSerial: env.INVERTER_LOGGER_SERIAL,
    pollIntervalMs: env.POLL_INTERVAL_MS,
    // SEEDS the saved config rather than overriding it forever. This is what
    // keeps Docker and the addon working exactly as before — their env var
    // still decides a fresh install — while letting the dashboard change it
    // afterwards. When it was read at every poll instead, an appliance owner
    // could save their inverter's address and keep seeing fake data, because
    // site.json had put INVERTER_SIMULATE=true in the container's environment
    // and nothing in the UI could reach it.
    simulate: env.INVERTER_SIMULATE,
  });

/**
 * The EXPORT half only. The broker half of these env vars — `MQTT_ENABLED`,
 * `MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD` — seeds a `connections`
 * row instead since #217, in `./mqtt-broker.ts`'s `envBrokerSeed`: the endpoint
 * is a row now, and there is no field here left to put it in.
 */
const envMqttConfig = (): MqttConfig =>
  mqttConfigSchema.parse({
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

/**
 * Whether the poller reads a fake inverter.
 *
 * Its OWN `app_settings` key, not a field of the legacy document above and not
 * a column on a `connections` row. Both would be wrong: the legacy document is
 * deliberately read-only (see above), and simulation is not a property of an
 * endpoint — it is the answer to "is there anything real to poll at all", which
 * is one fact per box.
 *
 * `INVERTER_SIMULATE` seeds it and then stops mattering. That is the whole
 * change: it used to be read on every poll, so an appliance owner could save
 * their inverter's address in Settings and keep seeing fake data, because
 * site.json had put the var in the container's environment and no dashboard
 * control could reach it.
 */
const SIMULATE_KEY = "inverter-simulate";
const simulateSchema = z.object({ simulate: z.boolean() });
let simulateCache: boolean | null = null;

export async function getSimulate(): Promise<boolean> {
  simulateCache ??= (
    await readSetting(SIMULATE_KEY, simulateSchema, { simulate: env.INVERTER_SIMULATE })
  ).simulate;
  return simulateCache;
}

export async function setSimulate(simulate: boolean): Promise<void> {
  await writeSetting(SIMULATE_KEY, { simulate });
  simulateCache = simulate;
}

export async function getMqttConfig(): Promise<MqttConfig> {
  mqttCache ??= await readSetting(MQTT_KEY, mqttConfigSchema, envMqttConfig());
  return mqttCache;
}

/**
 * Validate an incoming MQTT export write, merged over the stored config, without
 * persisting.
 *
 * The password merge is gone — there is no secret in this record any more
 * (#217), and `mergeConnectionParams` owns write-only fields once for every
 * connection kind. What replaced it is an ABSENT-KEY merge, and it is
 * load-bearing for exactly one reason: `connectionId` defaults to `null`, and
 * `null` means "the export is off". A body that simply does not mention the
 * field — the pre-#217 settings form, which sends a broker URL and an `enabled`
 * flag that no longer exist — would otherwise UNBIND the broker on every save
 * and turn the Home Assistant export off with nothing in the log.
 *
 * Turning it off explicitly still works: `connectionId: null` is a key that is
 * present, and it wins.
 */
async function mergeMqttConfig(input: unknown): Promise<MqttConfig> {
  const stored = await getMqttConfig();
  const named = typeof input === "object" && input !== null ? input : {};
  return mqttConfigSchema.parse({ ...stored, ...named });
}

export async function setMqttConfig(input: unknown): Promise<MqttConfig> {
  const config = await mergeMqttConfig(input);
  await writeSetting(MQTT_KEY, config);
  mqttCache = config;
  return config;
}

/**
 * Point the export at a broker connection, keeping every other field.
 *
 * The one write the boot-time seed makes (`./mqtt-broker.ts`), and its own
 * function so the seed cannot accidentally replace the whole document with
 * defaults on an install that has customised its topic prefix.
 */
export async function bindMqttConnection(connectionId: number): Promise<MqttConfig> {
  return setMqttConfig({ ...(await getMqttConfig()), connectionId });
}
