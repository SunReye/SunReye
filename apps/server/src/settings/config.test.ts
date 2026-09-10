import { INVERTER_KEY } from "@SunReye/db/inverter-config";
import { MQTT_KEY } from "@SunReye/db/mqtt-config";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";

// This module decides which box on the LAN gets Modbus writes and which broker
// the bridge dials, so the tests run the real accessors against a real drizzle
// instance on the pg-proxy driver: the callback below stands in for the
// `app_settings` table (primary key on `key`, jsonb value) and records every
// statement, so seeding, fallbacks, caching and the write path are all asserted
// as behaviour.
//
// The spread is load-bearing: `mock.module` is process-global and permanent, so
// a factory returning only `db` would delete every other `@SunReye/db` export
// for each test file that runs after this one.
const realDb = await import("@SunReye/db");
// Snapshotted BY VALUE, before the mock below is installed: a module namespace is
// live, so afterwards `realDb.db` IS the proxy and handing `realDb` back would
// restore the stub.
const realDbExports = { ...realDb };

const table = new Map<string, unknown>();
const queries: { sql: string; params: unknown[] }[] = [];

const proxy = drizzle(async (sql: string, params: unknown[]) => {
  queries.push({ sql, params });
  if (sql.startsWith("select")) {
    const key = String(params[0]);
    return {
      rows: table.has(key) ? [[key, table.get(key), new Date("2026-01-01T00:00:00Z")]] : [],
    };
  }
  table.set(String(params[0]), JSON.parse(String(params[1])));
  return { rows: [] };
});
mock.module("@SunReye/db", () => ({ ...realDb, db: proxy }));

// The env seed is what an existing env-only deployment still runs on, so it has
// to be settable per scenario with the types the validated env really produces
// (numbers and booleans, not the strings `process.env` holds). The stub proxies
// every key it is not asked about straight through to the real env, so the
// permanent module mock stays harmless for every other test file.
const realEnvModule = await import("@SunReye/env/server");
const realEnvExports = { ...realEnvModule };
const envOverrides: Record<string, unknown> = {};
const envStub = new Proxy(realEnvModule.env, {
  get: (target, prop) =>
    typeof prop === "string" && prop in envOverrides
      ? envOverrides[prop]
      : Reflect.get(target, prop),
});
mock.module("@SunReye/env/server", () => ({ ...realEnvModule, env: envStub }));

// Both mocks are permanent and keyed by the resolved specifier, so without this
// the pg-proxy handle would stand in for the real `db`, and the env stub — which
// keeps whatever overrides the last scenario left in it — would stand in for the
// validated env, for every test file that loads after this one.
afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
  mock.module("@SunReye/env/server", () => ({ ...realEnvExports }));
});

/** Every env var the config seeds from — blanked per test, never inherited. */
const ENV_KEYS = [
  "INVERTER_HOST",
  "INVERTER_PORT",
  "INVERTER_UNIT_ID",
  "INVERTER_TRANSPORT",
  "POLL_INTERVAL_MS",
  "MQTT_ENABLED",
  "MQTT_BROKER_URL",
  "MQTT_USERNAME",
  "MQTT_PASSWORD",
  "MQTT_TOPIC_PREFIX",
  "HA_DISCOVERY_ENABLED",
  "HA_DISCOVERY_PREFIX",
] as const;

const selects = () => queries.filter((q) => q.sql.startsWith("select"));
const writes = () => queries.filter((q) => q.sql.startsWith("insert"));

type Config = typeof import("./config");

// Both configs are cached for the lifetime of the process, so a scenario that
// needs an unread instance takes a fresh copy of the module: the query suffix
// resolves to a new instance of the same file. Loading the plain instance —
// the one the rest of the server imports — first keeps those copies last, which
// is what the coverage report follows.
await import("./config");

let instances = 0;
const freshInstance = async () => (await import(`./config?${++instances}`)) as Config;

/** A saved broker config, complete with the write-only password. */
/** A saved EXPORT config — no broker fields, which is the point of #217. */
const savedBroker = {
  connectionId: 3,
  topicPrefix: "solar",
  haDiscoveryEnabled: true,
  haDiscoveryPrefix: "homeassistant",
};

beforeEach(() => {
  table.clear();
  queries.length = 0;
  for (const key of ENV_KEYS) envOverrides[key] = undefined;
});

/**
 * These describe a LEGACY READER, not the poll loop's source.
 *
 * `app_settings.inverter` stopped being the authority when 2.0.0's
 * dual-authority defect was removed: the endpoint lives in `connections` +
 * `devices.unit_id` and is written only through
 * `../inverter/endpoint.ts`'s `saveConnectionSettings`. There is no setter here
 * any more, and its validation tests moved with it — the bounds themselves are
 * `packages/db/src/inverter-config.test.ts`'s subject, and the route parses with
 * that same schema.
 *
 * What is still tested here is what this reader must keep doing: answer for a
 * 1.2.0 install whose endpoint lives nowhere else, so the first boot after the
 * in-place upgrade can seed the spine from it.
 */
describe("the inverter connection before anything is saved", () => {
  test("an env-only deployment keeps running on the settings it booted with", async () => {
    Object.assign(envOverrides, {
      INVERTER_HOST: "10.0.0.7",
      INVERTER_PORT: 8899,
      INVERTER_UNIT_ID: 3,
      INVERTER_TRANSPORT: "rtu-over-tcp",
      POLL_INTERVAL_MS: 2000,
    });
    const { getInverterConfig } = await freshInstance();
    expect(await getInverterConfig()).toEqual({
      host: "10.0.0.7",
      port: 8899,
      unitId: 3,
      transport: "rtu-over-tcp",
      timeoutMs: 2000,
      pollIntervalMs: 2000,
    });
    // Seeding is a read, not a migration: nothing is written until a save.
    expect(writes()).toHaveLength(0);
  });

  test("with nothing in env either, the connection is the unconfigured default", async () => {
    const { getInverterConfig } = await freshInstance();
    expect(await getInverterConfig()).toEqual({
      host: undefined,
      port: 502,
      unitId: 0,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
  });

  test("unit id 0 from env is an address, not an unset field", async () => {
    Object.assign(envOverrides, { INVERTER_HOST: "10.0.0.7", INVERTER_UNIT_ID: 0 });
    const { getInverterConfig } = await freshInstance();
    expect((await getInverterConfig()).unitId).toBe(0);
  });
});

describe("the saved inverter connection", () => {
  test("a saved connection wins over the env it was seeded from", async () => {
    envOverrides.INVERTER_HOST = "10.0.0.7";
    table.set(INVERTER_KEY, { host: "192.168.1.50", port: 502, unitId: 1 });
    const { getInverterConfig } = await freshInstance();
    expect((await getInverterConfig()).host).toBe("192.168.1.50");
  });

  test("the connection is read once and then served from memory", async () => {
    table.set(INVERTER_KEY, { host: "192.168.1.50" });
    const { getInverterConfig } = await freshInstance();
    await getInverterConfig();
    await getInverterConfig();
    expect(selects()).toHaveLength(1);
  });

  test("a saved connection the schema rejects reverts to the env target", async () => {
    // The read falls back silently, so a row an older build wrote — here with a
    // port no Modbus stack would accept — moves the poller back to whatever env
    // says, on a different box, with nothing logged.
    envOverrides.INVERTER_HOST = "10.0.0.7";
    table.set(INVERTER_KEY, { host: "192.168.1.50", port: 70000 });
    const { getInverterConfig } = await freshInstance();
    expect((await getInverterConfig()).host).toBe("10.0.0.7");
    expect(table.get(INVERTER_KEY)).toMatchObject({ host: "192.168.1.50" }); // row intact
  });

  // Hazard: the env seed is built on every cache miss, before the saved row is
  // even looked at. `INVERTER_PORT` passes env validation for any positive
  // integer, so a deployment with a typo'd port cannot read its own perfectly
  // valid saved connection — it throws instead. Pinned, not endorsed.
  test("an out-of-range env port breaks the read even when the saved connection is fine", async () => {
    envOverrides.INVERTER_PORT = 70000;
    table.set(INVERTER_KEY, { host: "192.168.1.50", port: 502 });
    const { getInverterConfig } = await freshInstance();
    await expect(getInverterConfig()).rejects.toThrow();
  });
});

describe("the MQTT export before anything is saved", () => {
  test("no broker is bound until one is picked", async () => {
    const { getMqttConfig } = await freshInstance();
    expect(await getMqttConfig()).toEqual({
      connectionId: null,
      topicPrefix: "sunreye",
      haDiscoveryEnabled: false,
      haDiscoveryPrefix: "homeassistant",
    });
  });

  test("the env seeds the EXPORT half only — the broker half seeds a connection", async () => {
    // `MQTT_BROKER_URL` / `MQTT_USERNAME` / `MQTT_PASSWORD` are carried into a
    // `connections` row instead (#217): the endpoint is a row now, and there is
    // no field here left to put it in. `./mqtt-broker.test.ts` owns that seed.
    Object.assign(envOverrides, {
      MQTT_ENABLED: true,
      MQTT_BROKER_URL: "mqtt://hass.lan:1883",
      MQTT_USERNAME: "sunreye",
      MQTT_PASSWORD: "secret",
      MQTT_TOPIC_PREFIX: "solar",
      HA_DISCOVERY_ENABLED: true,
      HA_DISCOVERY_PREFIX: "ha",
    });
    const { getMqttConfig } = await freshInstance();
    const config = await getMqttConfig();
    expect(config).toEqual({
      connectionId: null,
      topicPrefix: "solar",
      haDiscoveryEnabled: true,
      haDiscoveryPrefix: "ha",
    });
    expect(JSON.stringify(config)).not.toContain("secret");
    expect(writes()).toHaveLength(0);
  });
});

describe("the saved MQTT export", () => {
  test("a saved export wins over env", async () => {
    envOverrides.MQTT_TOPIC_PREFIX = "from-env";
    table.set(MQTT_KEY, savedBroker);
    const { getMqttConfig } = await freshInstance();
    expect((await getMqttConfig()).topicPrefix).toBe("solar");
  });

  test("the export config is read once and then served from memory", async () => {
    table.set(MQTT_KEY, savedBroker);
    const { getMqttConfig } = await freshInstance();
    await getMqttConfig();
    await getMqttConfig();
    expect(selects()).toHaveLength(1);
  });

  test("a saved export the schema rejects falls back to the env one", async () => {
    envOverrides.MQTT_TOPIC_PREFIX = "from-env";
    table.set(MQTT_KEY, { ...savedBroker, topicPrefix: "" });
    const { getMqttConfig } = await freshInstance();
    expect((await getMqttConfig()).topicPrefix).toBe("from-env");
  });
});

describe("an MQTT write that does not mention the connection", () => {
  test("keeps the bound broker — the pre-#217 form must not turn the export off", async () => {
    // `connectionId` defaults to null and null means OFF, so a body that omits
    // the field (the old settings form, which sends a broker URL and an
    // `enabled` flag that no longer exist) would unbind the broker on every save
    // with nothing in the log.
    table.set(MQTT_KEY, savedBroker);
    const { setMqttConfig } = await freshInstance();
    const saved = await setMqttConfig({
      enabled: true,
      brokerUrl: "mqtt://legacy:1883",
      username: "u",
      password: "p",
      topicPrefix: "roof",
      haDiscoveryEnabled: false,
      haDiscoveryPrefix: "homeassistant",
    });
    expect(saved.connectionId).toBe(3);
    expect(saved.topicPrefix).toBe("roof");
    expect(JSON.stringify(saved)).not.toContain("legacy");
  });

  test("turning it off EXPLICITLY still works — a present null wins", async () => {
    table.set(MQTT_KEY, savedBroker);
    const { setMqttConfig } = await freshInstance();
    expect((await setMqttConfig({ connectionId: null })).connectionId).toBeNull();
  });

  test("a non-object body is merged as though it named nothing", async () => {
    table.set(MQTT_KEY, savedBroker);
    const { setMqttConfig } = await freshInstance();
    expect(await setMqttConfig("nope")).toEqual(savedBroker);
  });
});

describe("binding the export to a connection", () => {
  test("bindMqttConnection keeps every other field", async () => {
    // The one write the boot-time seed makes. Replacing the whole document with
    // defaults would silently undo a customised topic prefix.
    table.set(MQTT_KEY, savedBroker);
    const { bindMqttConnection, getMqttConfig } = await freshInstance();
    const bound = await bindMqttConnection(9);
    expect(bound).toEqual({ ...savedBroker, connectionId: 9 });
    expect((await getMqttConfig()).connectionId).toBe(9);
  });

  test("an edit the schema rejects is refused before anything is written", async () => {
    table.set(MQTT_KEY, savedBroker);
    const { setMqttConfig } = await freshInstance();
    await expect(setMqttConfig({ topicPrefix: "" })).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });
});

describe("saving the MQTT export", () => {
  test("an edit is persisted and then served from the cache the save refreshed", async () => {
    table.set(MQTT_KEY, savedBroker);
    const { getMqttConfig, setMqttConfig } = await freshInstance();
    await setMqttConfig({ connectionId: 4, topicPrefix: "roof" });
    expect(table.get(MQTT_KEY)).toMatchObject({ connectionId: 4, topicPrefix: "roof" });
    queries.length = 0;
    expect((await getMqttConfig()).topicPrefix).toBe("roof");
    expect(selects()).toHaveLength(0);
  });

  test("a rejected edit changes neither the stored export nor the live one", async () => {
    table.set(MQTT_KEY, savedBroker);
    const { getMqttConfig, setMqttConfig } = await freshInstance();
    await expect(setMqttConfig({ topicPrefix: "" })).rejects.toThrow();
    expect(writes()).toHaveLength(0);
    expect((await getMqttConfig()).topicPrefix).toBe("solar");
  });

  test("turning the export off is a save, not the absence of one", async () => {
    // And it is ONE field: a null connection is the only way to be off, so the
    // two-field disagreement the retired `enabled` flag allowed is gone.
    table.set(MQTT_KEY, savedBroker);
    const { getMqttConfig, setMqttConfig } = await freshInstance();
    await setMqttConfig({ ...savedBroker, connectionId: null, haDiscoveryEnabled: false });
    expect(table.get(MQTT_KEY)).toMatchObject({ connectionId: null, haDiscoveryEnabled: false });
    expect((await getMqttConfig()).connectionId).toBeNull();
  });

  // Deliberately the last test in the file: bun attributes a file's coverage to
  // the last instance of it loaded in the process, so the final instance loaded
  // here is the one that has to exercise the whole module.
  test("the two configs are cached independently, and only MQTT is written", async () => {
    // The asymmetry is the point: saving the broker must not touch the legacy
    // inverter row, and there is no path here that could — the endpoint is
    // written into the spine by `../inverter/endpoint.ts` instead.
    envOverrides.INVERTER_HOST = "10.0.0.7";
    table.set(INVERTER_KEY, { host: "192.168.1.50", unitId: 1 });
    const config = await freshInstance();

    expect((await config.getInverterConfig()).host).toBe("192.168.1.50");
    expect((await config.getMqttConfig()).connectionId).toBeNull();

    const mqtt = await config.setMqttConfig({ connectionId: 3 });
    expect(mqtt.connectionId).toBe(3);
    expect(new Set(writes().map((w) => w.params[0]))).toEqual(new Set([MQTT_KEY]));

    queries.length = 0;
    expect((await config.getInverterConfig()).host).toBe("192.168.1.50");
    expect((await config.getMqttConfig()).connectionId).toBe(3);
    expect(selects()).toHaveLength(0);
  });
});
