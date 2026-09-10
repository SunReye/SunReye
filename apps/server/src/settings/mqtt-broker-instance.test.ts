import type { MqttParams } from "@SunReye/db/connection-kinds";
import type {
  ConnectionRecord,
  ConnectionSettings,
  PlantDb,
  PlantRecord,
} from "@SunReye/db/plant-repo";
import { type SQL, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mock } from "bun:test";

/**
 * THE COMPOSITION, not the decision.
 *
 * `./mqtt-broker.ts` owns the decision and is unit-tested branch by branch. What
 * is left here is the wiring — one client bound to the plant, four dependencies
 * bound to it, and a `try` around the lot — and every claim its header makes is
 * a claim about that wiring:
 *
 *  - a null id, and a boot with no plant, answer WITHOUT touching the spine;
 *  - `db` is read PER CALL, so the client the spine is handed is the one this
 *    process holds when the call runs, not the one it held at import;
 *  - NEITHER function throws, whatever the database does — the boot-time bridge
 *    rebuild and the EVCC ingest both run where an exception costs a dashboard.
 *
 * The spine is stubbed rather than driven over a fake engine: `readPlant`,
 * `readConnections` and `createConnection` are SQL, and their SQL is proved
 * against a real Postgres in `apps/server/db-tests/plant-spine.test.ts`. What
 * cannot be proved there is that THIS module reaches them with the right client,
 * plant and arguments.
 */

// The spread is load-bearing: `mock.module` is process-global and permanent, so
// a factory returning only the stubbed names would delete every other export of
// these modules for each test file that runs after this one.
const realDb = await import("@SunReye/db");
const realDbExports = { ...realDb };
const realRepo = await import("@SunReye/db/plant-repo");
const realRepoExports = { ...realRepo };
const realConfig = await import("./config");
const realConfigExports = { ...realConfig };
const realEnvModule = await import("@SunReye/env/server");
const realEnvExports = { ...realEnvModule };

/** Every statement the client handed to the spine actually ran. */
const executed: string[] = [];
/** The stand-in for the process client. Recorded, never dialled. */
const dbStub = {
  execute: (query: SQL) => {
    executed.push(String(query.queryChunks.length));
    return Promise.resolve({ rows: [] });
  },
};

/** The spine's answers, per scenario. */
let plant: PlantRecord | null = null;
let connections: ConnectionRecord[] = [];
let failure: Error | null = null;
/** Which client each stub was called with, so the per-call `db` read is provable. */
const clients: PlantDb[] = [];
const created: { plantId: number; settings: ConnectionSettings }[] = [];

function plantRow(id: number): PlantRecord {
  return {
    id,
    name: "Home",
    slug: "home",
    timeZone: "Europe/Berlin",
    biddingZone: null,
    tariffKey: null,
    latitude: null,
    longitude: null,
    label: "",
    arrays: [],
    tempCoefficient: -0.004,
    systemLoss: 0.14,
    maxOutputW: null,
    houseLoadW: null,
    smartMeterSince: null,
  };
}

mock.module("@SunReye/db", () => ({ ...realDb, db: dbStub }));
mock.module("@SunReye/db/plant-repo", () => ({
  ...realRepo,
  readPlant: async (client: PlantDb) => {
    clients.push(client);
    // The real read runs a statement, so the stub does too: that is the only way
    // to observe WHICH client the module bound to the spine.
    await client.execute(sql`select 1 from plants`);
    if (failure) throw failure;
    return plant;
  },
  readConnections: async (client: PlantDb, plantId: number) => {
    clients.push(client);
    if (failure) throw failure;
    return connections.filter(() => plantId === plant?.id);
  },
  createConnection: async (client: PlantDb, plantId: number, settings: ConnectionSettings) => {
    clients.push(client);
    created.push({ plantId, settings });
    const record = { id: 42, ...settings } as ConnectionRecord;
    connections = [...connections, record];
    return record;
  },
}));

/** The export config, so the seed's writes are observable without a database. */
let storedConnectionId: number | null = null;
const bound: number[] = [];
let bindFails = false;
mock.module("./config", () => ({
  ...realConfig,
  getMqttConfig: async () => ({
    connectionId: storedConnectionId,
    topicPrefix: "sunreye",
    haDiscoveryEnabled: true,
    haDiscoveryPrefix: "homeassistant",
  }),
  bindMqttConnection: async (connectionId: number) => {
    if (bindFails) throw new Error("app_settings is unreachable");
    bound.push(connectionId);
    storedConnectionId = connectionId;
    return {
      connectionId,
      topicPrefix: "sunreye",
      haDiscoveryEnabled: true,
      haDiscoveryPrefix: "homeassistant",
    };
  },
}));

/** The seed-only env vars, settable per scenario with the validated types. */
const envOverrides: Record<string, unknown> = {};
const envStub = new Proxy(realEnvModule.env, {
  get: (target, prop) =>
    typeof prop === "string" && prop in envOverrides
      ? envOverrides[prop]
      : Reflect.get(target, prop),
});
mock.module("@SunReye/env/server", () => ({ ...realEnvModule, env: envStub }));

// All four mocks are permanent and keyed by the resolved specifier, so without
// this the stubs would stand in for the real modules — and `./config`'s own
// suite would then assert against this file's double — for every test file that
// loads after this one.
afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
  mock.module("@SunReye/db/plant-repo", () => ({ ...realRepoExports }));
  mock.module("./config", () => ({ ...realConfigExports }));
  mock.module("@SunReye/env/server", () => ({ ...realEnvExports }));
});

const { readBroker, seedMqttBroker } = await import("./mqtt-broker-instance");

const { log } = await import("../shared/logging");
/**
 * The warnings a run emitted.
 *
 * `log("mqtt")` answers the shared instance the module holds, so the capture
 * goes on that instance: an own property shadows the prototype method, forwards
 * to LogTape, and is deleted again afterwards.
 */
async function warningsDuring(run: () => Promise<unknown>): Promise<string[]> {
  const logger = log("mqtt") as unknown as Record<string, unknown>;
  const captured: string[] = [];
  const emit = (logger.warn as (t: string, v?: Record<string, unknown>) => void).bind(logger);
  logger.warn = (template: string, values: Record<string, unknown> = {}) => {
    captured.push(template);
    emit(template, values);
  };
  try {
    await run();
  } finally {
    delete logger.warn;
  }
  return captured;
}

const broker = (brokerUrl: string, id: number, name = "MQTT broker"): ConnectionRecord => ({
  id,
  name,
  kind: "mqtt",
  params: { brokerUrl } satisfies MqttParams,
});

const gateway = (id: number): ConnectionRecord => ({
  id,
  name: "Gateway",
  kind: "modbus",
  params: {
    host: "10.0.0.5",
    port: 502,
    transport: "tcp",
    timeoutMs: 2000,
    pollIntervalMs: 1000,
  },
});

beforeEach(() => {
  plant = plantRow(1);
  connections = [];
  failure = null;
  clients.length = 0;
  created.length = 0;
  executed.length = 0;
  bound.length = 0;
  bindFails = false;
  storedConnectionId = null;
  envOverrides.MQTT_ENABLED = false;
  envOverrides.MQTT_BROKER_URL = "";
  envOverrides.MQTT_USERNAME = undefined;
  envOverrides.MQTT_PASSWORD = undefined;
});

describe("readBroker", () => {
  test("a null connection id answers null without reading the spine", async () => {
    // "The export is off" is a value, not a question for the database: the
    // rebuild path calls this on every settings save.
    expect(await readBroker(null)).toBeNull();
    expect(clients).toEqual([]);
  });

  test("resolves the params of the connection the id names", async () => {
    connections = [gateway(3), broker("mqtt://hass.lan:1883", 7)];
    expect(await readBroker(7)).toEqual({ brokerUrl: "mqtt://hass.lan:1883" });
  });

  test("an id naming a row of another kind is no broker, not a coerced one", async () => {
    connections = [gateway(3)];
    expect(await readBroker(3)).toBeNull();
  });

  test("a dangling id — the row was deleted — is no broker", async () => {
    connections = [broker("mqtt://hass.lan:1883", 7)];
    expect(await readBroker(9)).toBeNull();
  });

  test("a boot with no plant answers null and never reads connections", async () => {
    plant = null;
    expect(await readBroker(7)).toBeNull();
    // Only `readPlant` was reached: there is nothing for a connection to belong to.
    expect(clients).toHaveLength(1);
  });

  test("an unreachable database is no broker, and says so", async () => {
    failure = new Error("connection refused");
    const warnings = await warningsDuring(async () => {
      expect(await readBroker(7)).toBeNull();
    });
    expect(warnings).toEqual([
      "could not resolve MQTT connection {id}: {error} — treating it as no broker",
    ]);
  });

  test("a thrown non-Error is still reported rather than escaping", async () => {
    failure = "nope" as unknown as Error;
    const warnings = await warningsDuring(async () => {
      expect(await readBroker(7)).toBeNull();
    });
    expect(warnings).toHaveLength(1);
  });

  test("the spine is handed a client bound to the CURRENT process db", async () => {
    // `db` is read per call, never captured at module evaluation — the whole
    // reason `mock.module("@SunReye/db")` reaches this module at all.
    connections = [broker("mqtt://hass.lan:1883", 7)];
    await readBroker(7);
    expect(executed).toHaveLength(1);
    expect(clients[0]).not.toBe(dbStub);
  });
});

describe("seedMqttBroker", () => {
  test("a boot with no plant writes nothing", async () => {
    // Onboarding: there is nothing for a connection to belong to, and the boot
    // after provisioning does this.
    plant = null;
    envOverrides.MQTT_ENABLED = true;
    envOverrides.MQTT_BROKER_URL = "mqtt://hass.lan:1883";
    await seedMqttBroker();
    expect(created).toEqual([]);
    expect(bound).toEqual([]);
  });

  test("carries MQTT_BROKER_URL into a connections row and binds the export to it", async () => {
    envOverrides.MQTT_ENABLED = true;
    envOverrides.MQTT_BROKER_URL = "  mqtt://hass.lan:1883  ";
    envOverrides.MQTT_USERNAME = "mqtt";
    envOverrides.MQTT_PASSWORD = "secret";
    await seedMqttBroker();
    expect(created).toEqual([
      {
        plantId: 1,
        settings: {
          name: "MQTT broker",
          kind: "mqtt",
          params: { brokerUrl: "mqtt://hass.lan:1883", username: "mqtt", password: "secret" },
        },
      },
    ]);
    expect(bound).toEqual([42]);
  });

  test("a plant that already has a broker is adopted, never given a second one", async () => {
    connections = [broker("mqtt://existing.lan:1883", 7, "Existing")];
    envOverrides.MQTT_ENABLED = true;
    envOverrides.MQTT_BROKER_URL = "mqtt://hass.lan:1883";
    await seedMqttBroker();
    expect(created).toEqual([]);
    expect(bound).toEqual([7]);
  });

  test("an export already pointing at a resolvable broker is left alone", async () => {
    connections = [broker("mqtt://hass.lan:1883", 7)];
    storedConnectionId = 7;
    envOverrides.MQTT_ENABLED = true;
    envOverrides.MQTT_BROKER_URL = "mqtt://other.lan:1883";
    await seedMqttBroker();
    expect(created).toEqual([]);
    expect(bound).toEqual([]);
  });

  test("no env broker and no row is nothing to do", async () => {
    await seedMqttBroker();
    expect(created).toEqual([]);
    expect(bound).toEqual([]);
  });

  test("a spine that throws leaves the boot standing, and says the export stays off", async () => {
    failure = new Error("connection refused");
    envOverrides.MQTT_ENABLED = true;
    envOverrides.MQTT_BROKER_URL = "mqtt://hass.lan:1883";
    const warnings = await warningsDuring(() => seedMqttBroker());
    expect(warnings).toEqual([
      "could not seed the MQTT broker connection: {error} — the export stays off",
    ]);
    expect(created).toEqual([]);
  });

  test("a write that fails halfway is swallowed too — the row is there, the bind is not", async () => {
    // The seed is not a transaction: a `bind` that fails after the insert must
    // still not take the boot down. The next boot adopts the row it left.
    envOverrides.MQTT_ENABLED = true;
    envOverrides.MQTT_BROKER_URL = "mqtt://hass.lan:1883";
    bindFails = true;
    const warnings = await warningsDuring(() => seedMqttBroker());
    expect(created).toHaveLength(1);
    expect(bound).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});
