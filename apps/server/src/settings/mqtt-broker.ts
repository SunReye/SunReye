/**
 * WHICH BROKER A SETTING'S `connectionId` MEANS.
 *
 * `app_settings.mqtt` names a connection rather than holding a broker URL
 * (#217), so every consumer that dials — the Home Assistant export
 * (`../inverter/mqtt.ts`), its connection test, and the EVCC ingest — needs the
 * same resolution: id -> the plant's `kind = 'mqtt'` row -> its params.
 *
 * THE RULE IS "ABSENT, NOT BROKEN", and it is spelled once here because three
 * callers would otherwise each choose. `mqtt.connectionId` is a SOFT reference:
 * it lives in a JSONB document with no foreign key, so an operator may delete
 * the connection it names and leave the id dangling. Every way of not resolving
 * — null, no such row, a row of another kind — answers `null`, which every
 * caller already treats as "the export is off". A throw would take a boot down
 * over a setting, and coercing a Modbus row's host into a broker URL would stand
 * up a client that retries a gateway forever.
 */

import type { MqttParams } from "@SunReye/db/connection-kinds";
import type { ConnectionRecord } from "@SunReye/db/plant-repo";

/**
 * The broker params a `connectionId` names, or null when it names none.
 *
 * Pure, and separate from the read, so every branch is unit-tested without a
 * database — see `./mqtt-broker.test.ts`.
 */
export function brokerFrom(
  connections: readonly ConnectionRecord[],
  connectionId: number | null,
): MqttParams | null {
  if (connectionId === null) return null;
  const found = connections.find((connection) => connection.id === connectionId);
  return found?.kind === "mqtt" ? found.params : null;
}

/** The env vars that seed a broker. Structural, so this stays testable without `env`. */
export interface BrokerEnv {
  MQTT_ENABLED: boolean;
  MQTT_BROKER_URL: string;
  MQTT_USERNAME?: string | undefined;
  MQTT_PASSWORD?: string | undefined;
}

/**
 * What a boot must do to give `app_settings.mqtt` a broker to name.
 *
 *  - `{ create }` — insert this broker connection, then bind the setting to it.
 *  - `{ bind }` — the plant already has a broker; point the setting at it.
 *  - `null` — nothing to do.
 */
export type BrokerSeed = { create: MqttParams } | { bind: number } | null;

/**
 * The one-time carry of the ENV broker into the spine.
 *
 * `MQTT_BROKER_URL` / `MQTT_USERNAME` / `MQTT_PASSWORD` are documented
 * "seed only" env vars, and until #217 they seeded a field of
 * `app_settings.mqtt`. The endpoint is a ROW now, so without this a docker
 * install that has always set `MQTT_BROKER_URL` would come up with the export
 * silently off — the same class of failure as an upgraded install losing its
 * gateway.
 *
 * IT CREATES, IT NEVER EDITS — the rule every seed in this codebase follows
 * (`../inverter/provision.ts`). A plant that already has a broker row is ADOPTED
 * rather than given a second one: two brokers would leave the operator unable to
 * tell which the export uses, and the 0006 migration's row is exactly such a
 * row. A setting that already names a resolvable broker is left completely
 * alone.
 *
 * A DANGLING id is re-bound rather than kept. `connectionId` is a soft reference
 * (see the header), so an operator deleting a connection and making another
 * leaves the setting reporting itself configured while publishing nothing.
 *
 * `MQTT_ENABLED` governs only whether to CREATE. An existing broker is adopted
 * whatever it says — the flag is a deploy-time request for an endpoint, not a
 * veto over one the plant already has, and treating it as a veto would undo the
 * migration's rebinding on the next boot.
 *
 * Pure: `./mqtt-broker.test.ts` covers every branch, and the wiring that turns
 * the answer into writes lives at the composition root.
 */
// fallow-ignore-next-line unused-export -- the pure decision behind `applyBrokerSeed`, asserted branch by branch in `./mqtt-broker.test.ts`; test files are not traced as consumers.
export function envBrokerSeed(
  env: BrokerEnv,
  connections: readonly ConnectionRecord[],
  config: { connectionId: number | null },
): BrokerSeed {
  if (brokerFrom(connections, config.connectionId) !== null) return null;
  const existing = connections.find((connection) => connection.kind === "mqtt");
  if (existing) return { bind: existing.id };
  const brokerUrl = env.MQTT_BROKER_URL.trim();
  if (!env.MQTT_ENABLED || brokerUrl === "") return null;
  return {
    create: {
      brokerUrl,
      ...(env.MQTT_USERNAME ? { username: env.MQTT_USERNAME } : {}),
      ...(env.MQTT_PASSWORD ? { password: env.MQTT_PASSWORD } : {}),
    },
  };
}

/** What applying a {@link BrokerSeed} needs, bound to one client by the caller. */
export interface BrokerSeedDeps {
  /** The plant's connections, or an empty list when there is no plant yet. */
  readConnections(): Promise<ConnectionRecord[]>;
  /** Insert a broker connection and answer its id. */
  createBroker(params: MqttParams): Promise<number>;
  /** The stored export config. */
  readConfig(): Promise<{ connectionId: number | null }>;
  /** Persist the export config with its broker bound. */
  bind(connectionId: number): Promise<void>;
  logger: { info(template: string, values?: Record<string, unknown>): void };
}

/**
 * Run {@link envBrokerSeed} and write what it decided — the boot-time wiring.
 *
 * Answers the connection id the export now names, or null. Says what it did out
 * loud: a boot that quietly created a connection would leave an operator with a
 * broker on their settings page that they never typed anywhere.
 */
export async function applyBrokerSeed(
  env: BrokerEnv,
  deps: BrokerSeedDeps,
): Promise<number | null> {
  const [connections, config] = await Promise.all([deps.readConnections(), deps.readConfig()]);
  const seed = envBrokerSeed(env, connections, config);
  if (seed === null) return config.connectionId;
  if ("bind" in seed) {
    await deps.bind(seed.bind);
    deps.logger.info("Home Assistant export bound to the plant's MQTT connection {id}", {
      id: seed.bind,
    });
    return seed.bind;
  }
  const id = await deps.createBroker(seed.create);
  await deps.bind(id);
  deps.logger.info(
    "created MQTT connection {id} for {brokerUrl} from MQTT_BROKER_URL, and bound the Home " +
      "Assistant export to it — the broker is an editable connection now, not an env var",
    { id, brokerUrl: seed.create.brokerUrl },
  );
  return id;
}
