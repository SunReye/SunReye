/**
 * The connection tier as the process runs it: what a reload reports and survives, and the two
 * pass-throughs (status, stop). The tier itself is `./connection-tier.ts`; nothing here dials.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const realRepo = await import("@SunReye/db/plant-repo");
const realRepoExports = { ...realRepo };
const realClient = await import("../shared/plant-client");
const realClientExports = { ...realClient };
const realTier = await import("./connection-tier");
const realTierExports = { ...realTier };
const realMqttTier = await import("./mqtt-tier");
const realMqttTierExports = { ...realMqttTier };
const realPool = await import("./broker-pool-instance");
const realPoolExports = { ...realPool };
const realLogging = await import("../shared/logging");
const realLoggingExports = { ...realLogging };

type Plant = { id: number } | null;
let plant: Plant = { id: 7 };
let readFails: Error | string | null = null;
mock.module("@SunReye/db/plant-repo", () => ({
  ...realRepo,
  readPlant: async () => {
    if (readFails) throw readFails;
    return plant;
  },
  readConnections: async (_c: unknown, plantId: number) => [{ id: plantId * 100 }],
  readDevices: async (_c: unknown, plantId: number) => [{ id: plantId }],
}));
mock.module("../shared/plant-client", () => ({ ...realClient, plantClient: () => ({}) }));

type Events = { unsupported: unknown[]; dangling: string[]; failures: unknown[] };
const opened: unknown[] = [];
let events: Events = { unsupported: [], dangling: [], failures: [] };
mock.module("./connection-tier", () => ({
  ...realTier,
  openConnections: async (input: unknown) => {
    opened.push(input);
    return events;
  },
}));

let closed = 0;
const tier = {
  close: async () => {
    closed++;
  },
};
mock.module("./mqtt-tier", () => ({ ...realMqttTier, createMqttTier: () => tier }));

const statusAsked: number[] = [];
mock.module("./broker-pool-instance", () => ({
  ...realPool,
  brokerPool: {
    status: (id: number) => {
      statusAsked.push(id);
      return { state: "connected" };
    },
  },
}));

const logged: Array<[string, string, Record<string, unknown> | undefined]> = [];
const recorder = {
  warn: (message: string, props?: Record<string, unknown>) => logged.push(["warn", message, props]),
  debug: (message: string, props?: Record<string, unknown>) =>
    logged.push(["debug", message, props]),
};
mock.module("../shared/logging", () => ({ ...realLogging, log: () => recorder }));

afterAll(() => {
  mock.module("@SunReye/db/plant-repo", () => ({ ...realRepoExports }));
  mock.module("../shared/plant-client", () => ({ ...realClientExports }));
  mock.module("./connection-tier", () => ({ ...realTierExports }));
  mock.module("./mqtt-tier", () => ({ ...realMqttTierExports }));
  mock.module("./broker-pool-instance", () => ({ ...realPoolExports }));
  mock.module("../shared/logging", () => ({ ...realLoggingExports }));
});

const { connectionStatus, reloadConnections, stopConnections } =
  await import("./connection-runtime");

beforeEach(() => {
  plant = { id: 7 };
  readFails = null;
  events = { unsupported: [], dangling: [], failures: [] };
  opened.length = 0;
  logged.length = 0;
  statusAsked.length = 0;
  closed = 0;
});

describe("reloadConnections", () => {
  test("opens the plant's connections and devices through the MQTT tier", async () => {
    await reloadConnections();
    expect(opened).toEqual([{ connections: [{ id: 700 }], devices: [{ id: 7 }], tiers: [tier] }]);
    expect(logged).toEqual([]);
  });

  test("no plant yet (onboarding-only boot) opens nothing", async () => {
    plant = null;
    await reloadConnections();
    expect(opened).toEqual([]);
  });

  test("names each device whose connection does not exist", async () => {
    events.dangling = ["meter-1", "meter-2"];
    await reloadConnections();
    expect(logged.map(([level, , props]) => [level, props])).toEqual([
      ["warn", { slug: "meter-1" }],
      ["warn", { slug: "meter-2" }],
    ]);
  });

  test("names each connection that could not be opened, with why", async () => {
    events.failures = [{ connectionId: 3, error: "ECONNREFUSED" }];
    await reloadConnections();
    expect(logged).toEqual([
      ["warn", "connection {id} could not be opened: {error}", { id: 3, error: "ECONNREFUSED" }],
    ]);
  });

  test("connections the poll loop opens are a debug count, not a warning", async () => {
    events.unsupported = [
      { connectionId: 1, kind: "modbus" },
      { connectionId: 2, kind: "modbus" },
    ];
    await reloadConnections();
    expect(logged.map(([level, , props]) => [level, props])).toEqual([["debug", { count: 2 }]]);
  });

  test("a read that throws is a warning, never a throw: boot must go on", async () => {
    readFails = new Error("relation plants does not exist");
    await expect(reloadConnections()).resolves.toBeUndefined();
    expect(logged).toHaveLength(1);
    expect(logged[0]![0]).toBe("warn");
    expect(logged[0]![2]).toEqual({ error: "relation plants does not exist" });
  });

  test("a thrown non-Error is reported as its string", async () => {
    readFails = "boom";
    await reloadConnections();
    expect(logged[0]![2]).toEqual({ error: "boom" });
  });
});

describe("connectionStatus", () => {
  test("a device with no connection has no status and asks the pool nothing", () => {
    expect(connectionStatus(null)).toBeNull();
    expect(statusAsked).toEqual([]);
  });

  test("a connection id, zero included, is the pool's answer", () => {
    expect(connectionStatus(0)).toEqual({ state: "connected" } as never);
    expect(statusAsked).toEqual([0]);
  });
});

describe("stopConnections", () => {
  test("closes the MQTT tier", async () => {
    await stopConnections();
    expect(closed).toBe(1);
  });
});
