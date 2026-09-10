/**
 * THE PRODUCTION READ behind `./mqtt-broker.ts` — id to broker params, over the
 * real plant spine.
 *
 * Its own module so `./mqtt-broker.ts` stays pure and fully unit-tested, and so
 * `mock.module` on `@SunReye/db` reaches this: the client is read PER CALL, never
 * captured at module evaluation (see `../settings/plant-facts-instance.ts` for
 * what capturing it costs).
 *
 * NEVER THROWS. Every caller — the boot-time bridge rebuild, the EVCC ingest —
 * runs where an exception aborts a boot that is still worth serving the
 * dashboard, the history and the settings pages from. An unreachable database is
 * reported as "no broker", which is the state those callers already handle.
 */

import { db } from "@SunReye/db";
import type { MqttParams } from "@SunReye/db/connection-kinds";
import { createConnection, readConnections, readPlant } from "@SunReye/db/plant-repo";
import { env } from "@SunReye/env/server";

import { log } from "../shared/logging";
import { bindMqttConnection, getMqttConfig } from "./config";
import { applyBrokerSeed, brokerFrom } from "./mqtt-broker";

const logger = log("mqtt");

/** The broker a `connectionId` names, or null for every way of not resolving. */
export async function readBroker(connectionId: number | null): Promise<MqttParams | null> {
  if (connectionId === null) return null;
  try {
    const client = { execute: (query: Parameters<typeof db.execute>[0]) => db.execute(query) };
    const plant = await readPlant(client);
    if (!plant) return null;
    return brokerFrom(await readConnections(client, plant.id), connectionId);
  } catch (error) {
    logger.warn("could not resolve MQTT connection {id}: {error} — treating it as no broker", {
      id: connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Run the boot-time broker seed against the real spine.
 *
 * The composition of `./mqtt-broker.ts`'s pure decision with the three writes it
 * can ask for. Never throws, for the same reason `syncProvisioning` does not: a
 * boot that cannot reach the database is still worth serving the dashboard, the
 * history and the settings pages from, and the next boot picks this up.
 */
export async function seedMqttBroker(): Promise<void> {
  try {
    const client = { execute: (query: Parameters<typeof db.execute>[0]) => db.execute(query) };
    const plant = await readPlant(client);
    // No plant yet is an onboarding-only boot: there is nothing for a connection
    // to belong to, and the next boot after provisioning does this.
    if (!plant) return;
    await applyBrokerSeed(env, {
      readConnections: () => readConnections(client, plant.id),
      createBroker: async (params) =>
        (await createConnection(client, plant.id, { name: "MQTT broker", kind: "mqtt", params }))
          .id,
      readConfig: () => getMqttConfig(),
      bind: async (connectionId) => void (await bindMqttConnection(connectionId)),
      logger,
    });
  } catch (error) {
    logger.warn("could not seed the MQTT broker connection: {error} — the export stays off", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
