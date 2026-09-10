/**
 * The PUSH tier's lifecycle, driven through `openConnections` exactly as the
 * runtime drives it — because the interesting cases are all about what a SECOND
 * pass does to the clients the first one opened.
 */

import { describe, expect, test } from "bun:test";
import type { MqttParams } from "@SunReye/db/connection-kinds";
import type { ConnectionRecord } from "@SunReye/db/plant-repo";

import type { BrokerLink, BrokerPool, BrokerWill } from "./broker-pool";
import { openConnections } from "./connection-tier";
import { createMqttTier } from "./mqtt-tier";

const broker = (id: number, brokerUrl = "mqtt://hass.test:1883"): ConnectionRecord => ({
  id,
  name: `Broker ${id}`,
  kind: "mqtt",
  params: { brokerUrl },
});

const gateway = (id: number): ConnectionRecord => ({
  id,
  name: `Gateway ${id}`,
  kind: "modbus",
  params: { host: "10.0.0.5", port: 502, transport: "tcp", timeoutMs: 2000, pollIntervalMs: 1000 },
});

/** A pool double: records every acquire and release, hands back inert links. */
function fakePool() {
  const acquired: { connectionId: number; params: MqttParams; will: BrokerWill | undefined }[] = [];
  const updated: { connectionId: number; params: MqttParams }[] = [];
  const released: number[] = [];
  const pool: BrokerPool = {
    acquire(connectionId, params, options) {
      acquired.push({ connectionId, params, will: options?.will });
      const link: BrokerLink = {
        connectionId,
        brokerUrl: params.brokerUrl,
        connected: false,
        status: () => ({
          connected: false,
          lastError: null,
          lastErrorAt: null,
          lastConnectedAt: null,
        }),
        subscribe: () => {},
        update: (nextParams) => void updated.push({ connectionId, params: nextParams }),
        publish: () => {},
        release: async () => void released.push(connectionId),
      };
      return link;
    },
    status: () => null,
    close: async () => {},
  };
  return { pool, acquired, updated, released };
}

const pass = (pool: BrokerPool, connections: ConnectionRecord[], tier = createMqttTier(pool)) =>
  openConnections({ connections, devices: [], tiers: [tier] });

describe("the MQTT tier", () => {
  test("opens a client for every broker row, and none for a gateway", async () => {
    const { pool, acquired } = fakePool();
    const tier = createMqttTier(pool);
    await pass(pool, [broker(3), gateway(4), broker(5, "mqtt://other.test:1883")], tier);
    expect(acquired.map((call) => call.connectionId)).toEqual([3, 5]);
  });

  test("a modbus row is REPORTED as unsupported, not silently skipped", async () => {
    const { pool } = fakePool();
    const events = await pass(pool, [gateway(4)]);
    // The poll loop still owns Modbus (#204). Saying so is what keeps the
    // difference between "another tier has it" and "nothing has it" visible.
    expect(events.unsupported).toEqual([{ connectionId: 4, kind: "modbus" }]);
  });

  test("a SECOND pass re-applies the row rather than taking a second holder", async () => {
    const { pool, acquired, updated, released } = fakePool();
    const tier = createMqttTier(pool);
    await pass(pool, [broker(3)], tier);
    await pass(pool, [broker(3, "mqtt://moved.test:1883")], tier);
    // The tier keeps exactly ONE holder per row — a save-per-minute settings
    // page would otherwise leak a handle a minute and the client could never
    // close — and hands the pool the current params, which decides the re-dial.
    expect(acquired).toHaveLength(1);
    expect(updated).toEqual([{ connectionId: 3, params: { brokerUrl: "mqtt://moved.test:1883" } }]);
    expect(released).toEqual([]);
  });

  test("a connection DELETED between passes has its client released", async () => {
    const { pool, released } = fakePool();
    const tier = createMqttTier(pool);
    await pass(pool, [broker(3), broker(5, "mqtt://other.test:1883")], tier);
    expect(released).toEqual([]);

    await pass(pool, [broker(3)], tier);
    // Without this the deleted broker keeps its socket, its subscriptions and
    // its retry loop for the life of the process.
    expect(released).toEqual([5]);
  });

  test("every row gone releases everything", async () => {
    const { pool, released } = fakePool();
    const tier = createMqttTier(pool);
    await pass(pool, [broker(3)], tier);
    await pass(pool, [], tier);
    expect(released).toEqual([3]);
  });

  test("close releases every client the tier holds", async () => {
    const { pool, released } = fakePool();
    const tier = createMqttTier(pool);
    const events = await pass(pool, [broker(3), broker(5, "mqtt://other.test:1883")], tier);
    await events.close();
    expect(released.toSorted()).toEqual([3, 5]);

    // Twice must not double-release: shutdown races the settings page.
    await tier.close();
    expect(released.toSorted()).toEqual([3, 5]);
  });

  test("a loadpoint bound to a broker is attached without a client of its own", async () => {
    const { pool, acquired } = fakePool();
    const tier = createMqttTier(pool);
    await openConnections({
      connections: [broker(3)],
      devices: [
        {
          id: 1,
          slug: "evcc-loadpoint-1",
          name: "Garage",
          profileId: "evcc-loadpoint",
          role: "ev-charger",
          unitId: 1,
          connectionId: 3,
          params: {},
          arrays: [],
          tempCoefficient: -0.4,
          systemLoss: 14,
          retiredAt: null,
        },
      ],
      tiers: [tier],
    });
    // One client for the broker, whatever it carries — the per-device client is
    // exactly the shape `./connection-tier.ts` exists to prevent.
    expect(acquired).toHaveLength(1);
  });
});
