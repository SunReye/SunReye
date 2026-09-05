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
const savedBroker = {
  enabled: true,
  brokerUrl: "mqtt://hass.lan:1883",
  username: "sunreye",
  password: "secret",
  topicPrefix: "sunreye",
  haDiscoveryEnabled: true,
  haDiscoveryPrefix: "homeassistant",
};

beforeEach(() => {
  table.clear();
  queries.length = 0;
  for (const key of ENV_KEYS) envOverrides[key] = undefined;
});

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

describe("saving the inverter connection", () => {
  test("a port outside the addressable range is refused and the poller keeps its target", async () => {
    table.set(INVERTER_KEY, { host: "192.168.1.50" });
    const { getInverterConfig, setInverterConfig } = await freshInstance();
    await getInverterConfig();
    await expect(setInverterConfig({ host: "192.168.1.51", port: 70000 })).rejects.toThrow();
    await expect(setInverterConfig({ host: "192.168.1.51", port: 0 })).rejects.toThrow();
    expect(writes()).toHaveLength(0);
    expect((await getInverterConfig()).host).toBe("192.168.1.50");
  });

  test("a unit id must fit in a byte, and 0 is a legitimate one", async () => {
    const { setInverterConfig } = await freshInstance();
    await expect(setInverterConfig({ host: "192.168.1.50", unitId: 256 })).rejects.toThrow();
    expect((await setInverterConfig({ host: "192.168.1.50", unitId: 0 })).unitId).toBe(0);
  });

  test("a poll interval below the one-second floor is refused; exactly one second is not", async () => {
    const { setInverterConfig } = await freshInstance();
    await expect(
      setInverterConfig({ host: "192.168.1.50", pollIntervalMs: 999 }),
    ).rejects.toThrow();
    expect(
      (await setInverterConfig({ host: "192.168.1.50", pollIntervalMs: 1000 })).pollIntervalMs,
    ).toBe(1000);
  });

  test("a per-request timeout under 100 ms is refused", async () => {
    const { setInverterConfig } = await freshInstance();
    await expect(setInverterConfig({ host: "192.168.1.50", timeoutMs: 50 })).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });

  test("the saved row is the parsed connection: defaults filled, unknown fields dropped", async () => {
    const { setInverterConfig } = await freshInstance();
    await setInverterConfig({ host: "192.168.1.50", simulate: true });
    expect(table.get(INVERTER_KEY)).toEqual({
      host: "192.168.1.50",
      port: 502,
      unitId: 0,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
  });
});

describe("the MQTT bridge before anything is saved", () => {
  test("no broker is dialled until one is configured", async () => {
    const { getMqttConfig } = await freshInstance();
    expect(await getMqttConfig()).toEqual({
      enabled: false,
      brokerUrl: "mqtt://localhost:1883",
      username: undefined,
      password: undefined,
      topicPrefix: "sunreye",
      haDiscoveryEnabled: false,
      haDiscoveryPrefix: "homeassistant",
    });
  });

  test("a broker configured through env is bridged before anything is saved", async () => {
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
    expect(await getMqttConfig()).toEqual({
      enabled: true,
      brokerUrl: "mqtt://hass.lan:1883",
      username: "sunreye",
      password: "secret",
      topicPrefix: "solar",
      haDiscoveryEnabled: true,
      haDiscoveryPrefix: "ha",
    });
    expect(writes()).toHaveLength(0);
  });
});

describe("the saved MQTT bridge", () => {
  test("a saved broker wins over env, and the bridge itself still sees the password", async () => {
    envOverrides.MQTT_BROKER_URL = "mqtt://from-env:1883";
    table.set(MQTT_KEY, savedBroker);
    const { getMqttConfig } = await freshInstance();
    const config = await getMqttConfig();
    expect(config.brokerUrl).toBe("mqtt://hass.lan:1883");
    expect(config.password).toBe("secret"); // masking happens at the API edge
  });

  test("the broker config is read once and then served from memory", async () => {
    table.set(MQTT_KEY, savedBroker);
    const { getMqttConfig } = await freshInstance();
    await getMqttConfig();
    await getMqttConfig();
    expect(selects()).toHaveLength(1);
  });

  test("a saved broker the schema rejects falls back to the env bridge", async () => {
    envOverrides.MQTT_BROKER_URL = "mqtt://from-env:1883";
    table.set(MQTT_KEY, { ...savedBroker, topicPrefix: "" });
    const { getMqttConfig } = await freshInstance();
    expect((await getMqttConfig()).brokerUrl).toBe("mqtt://from-env:1883");
  });
});

describe("merging an MQTT edit", () => {
  test("an edit that omits the password keeps the stored one, and saves nothing", async () => {
    table.set(MQTT_KEY, savedBroker);
    const { mergeMqttConfig } = await freshInstance();
    const merged = await mergeMqttConfig({ enabled: true, brokerUrl: "mqtt://new:1883" });
    expect(merged.password).toBe("secret");
    expect(merged.brokerUrl).toBe("mqtt://new:1883");
    expect(writes()).toHaveLength(0); // the connection test must not persist
  });

  test("an empty password field means leave it alone, not clear it", async () => {
    table.set(MQTT_KEY, savedBroker);
    const { mergeMqttConfig } = await freshInstance();
    expect((await mergeMqttConfig({ ...savedBroker, password: "" })).password).toBe("secret");
  });

  test("a password that is actually supplied replaces the stored one", async () => {
    table.set(MQTT_KEY, savedBroker);
    const { mergeMqttConfig } = await freshInstance();
    expect((await mergeMqttConfig({ ...savedBroker, password: "rotated" })).password).toBe(
      "rotated",
    );
  });

  test("an edit the schema rejects is refused before any broker is dialled", async () => {
    table.set(MQTT_KEY, savedBroker);
    const { mergeMqttConfig } = await freshInstance();
    await expect(mergeMqttConfig({ brokerUrl: "" })).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });
});

describe("saving the MQTT bridge", () => {
  test("a broker-only edit is persisted with the password it never sent back", async () => {
    table.set(MQTT_KEY, savedBroker);
    const { getMqttConfig, setMqttConfig } = await freshInstance();
    await setMqttConfig({ enabled: true, brokerUrl: "mqtt://new:1883", username: "sunreye" });
    expect(table.get(MQTT_KEY)).toMatchObject({
      brokerUrl: "mqtt://new:1883",
      password: "secret",
    });
    queries.length = 0;
    expect((await getMqttConfig()).brokerUrl).toBe("mqtt://new:1883");
    expect(selects()).toHaveLength(0); // served from the cache the save refreshed
  });

  test("a rejected edit changes neither the stored broker nor the live one", async () => {
    table.set(MQTT_KEY, savedBroker);
    const { getMqttConfig, setMqttConfig } = await freshInstance();
    await expect(setMqttConfig({ brokerUrl: "" })).rejects.toThrow();
    expect(writes()).toHaveLength(0);
    expect((await getMqttConfig()).brokerUrl).toBe("mqtt://hass.lan:1883");
  });

  test("turning the bridge off is a save, not the absence of one", async () => {
    table.set(MQTT_KEY, savedBroker);
    const { getMqttConfig, setMqttConfig } = await freshInstance();
    await setMqttConfig({ ...savedBroker, enabled: false, haDiscoveryEnabled: false });
    expect(table.get(MQTT_KEY)).toMatchObject({ enabled: false, haDiscoveryEnabled: false });
    expect((await getMqttConfig()).enabled).toBe(false);
  });

  // Deliberately the last test in the file: bun attributes a file's coverage to
  // the last instance of it loaded in the process, so the final instance loaded
  // here is the one that has to exercise the whole module.
  test("the two configs are saved and cached independently of each other", async () => {
    envOverrides.INVERTER_HOST = "10.0.0.7";
    const config = await freshInstance();

    expect((await config.getInverterConfig()).host).toBe("10.0.0.7");
    expect((await config.getMqttConfig()).enabled).toBe(false);

    const inverter = await config.setInverterConfig({ host: "192.168.1.50", unitId: 1 });
    expect(inverter.host).toBe("192.168.1.50");
    const mqtt = await config.setMqttConfig({ enabled: true, brokerUrl: "mqtt://hass.lan:1883" });
    expect(mqtt.enabled).toBe(true);
    expect(new Set(writes().map((w) => w.params[0]))).toEqual(new Set([INVERTER_KEY, MQTT_KEY]));

    queries.length = 0;
    expect((await config.getInverterConfig()).host).toBe("192.168.1.50");
    expect((await config.getMqttConfig()).brokerUrl).toBe("mqtt://hass.lan:1883");
    expect(selects()).toHaveLength(0);
  });
});
