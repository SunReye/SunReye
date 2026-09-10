/**
 * ONE PASS OF `openConnections` OVER THE REAL PLANT — the composition root of
 * the connection tier.
 *
 * Called at boot and after every write that can change what a connection is
 * (`./after-device-write.ts`'s reload chain). Reading the rows and re-applying
 * them is the whole job: `./mqtt-tier.ts` turns the answer into opens,
 * re-opens and releases, and `./broker-pool.ts` holds the clients.
 *
 * NEVER THROWS, for the same reason `syncProvisioning` and `seedMqttBroker` do
 * not: this runs on a boot that is still worth serving the dashboard, the
 * history and the settings pages from, and it also runs inside an HTTP write
 * whose row has already landed. A database that cannot be reached leaves the
 * clients exactly as they were, and the next pass picks it up.
 *
 * ONLY THE MQTT TIER IS SUPPLIED. Modbus is still the poll loop's
 * (`../inverter/runtime.ts`), so every gateway row comes back `unsupported` —
 * expected here, and logged at debug rather than warn precisely because it is
 * expected. When the poll tier lands (#204) it joins the list and that line
 * becomes a real warning again.
 */

import { readConnections, readDevices, readPlant } from "@SunReye/db/plant-repo";

import { plantClient } from "../shared/plant-client";
import { log } from "../shared/logging";
import { brokerPool } from "./broker-pool-instance";
import type { ConnectionStatus } from "./connection-tier";
import { openConnections } from "./connection-tier";
import { createMqttTier } from "./mqtt-tier";

const logger = log("connections");

/** The one MQTT tier this process has, holding one client per broker row. */
const mqttTier = createMqttTier(brokerPool);

/**
 * Open (or re-open, or release) every connection the plant now has.
 *
 * Idempotent: an unchanged row is not re-dialled, which is what lets this sit on
 * the reload chain of every device and integration write without flapping a
 * broker the operator never touched.
 */
export async function reloadConnections(): Promise<void> {
  try {
    const client = plantClient();
    const plant = await readPlant(client);
    // Onboarding-only boot: nothing for a connection to belong to yet, and the
    // boot after provisioning does this.
    if (!plant) return;
    const [connections, devices] = await Promise.all([
      readConnections(client, plant.id),
      readDevices(client, plant.id),
    ]);
    const events = await openConnections({ connections, devices, tiers: [mqttTier] });
    for (const slug of events.dangling) {
      logger.warn(
        "device {slug} names a connection that does not exist — it is reached by nothing",
        {
          slug,
        },
      );
    }
    for (const failure of events.failures) {
      logger.warn("connection {id} could not be opened: {error}", {
        id: failure.connectionId,
        error: failure.error,
      });
    }
    if (events.unsupported.length > 0) {
      logger.debug("{count} connection(s) are opened by the poll loop, not by a tier", {
        count: events.unsupported.length,
      });
    }
  } catch (error) {
    logger.warn(
      "could not re-read the plant's connections: {error} — the open clients stay as " +
        "they are, and the next write picks this up",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * What is OBSERVED of one connection, or null when this process holds no client
 * for it — a `modbus` row, or a broker row on a boot that has not read the plant
 * yet.
 *
 * NULL IS NOT "DOWN", and the settings page must render it as "not known": a
 * red dot on a gateway that is being polled perfectly well would be a worse lie
 * than the config-derived status this replaces.
 */
export function connectionStatus(connectionId: number | null): ConnectionStatus | null {
  return connectionId === null ? null : brokerPool.status(connectionId);
}

/** Release every client the tier holds (graceful shutdown). */
export async function stopConnections(): Promise<void> {
  await mqttTier.close();
}
