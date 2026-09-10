import { describe, expect, test } from "bun:test";
import type { MqttParams } from "@SunReye/db/connection-kinds";
import type { ConnectionRecord } from "@SunReye/db/plant-repo";

import { applyBrokerSeed, brokerFrom, envBrokerSeed } from "./mqtt-broker";

const broker = (id: number, brokerUrl = "mqtt://hass.lan:1883"): ConnectionRecord => ({
  id,
  name: `Broker ${id}`,
  kind: "mqtt",
  params: { brokerUrl },
});

const gateway = (id: number): ConnectionRecord => ({
  id,
  name: "Gateway",
  kind: "modbus",
  params: { host: "10.0.0.5", port: 502, transport: "tcp", timeoutMs: 2000, pollIntervalMs: 1000 },
});

describe("brokerFrom", () => {
  test("resolves the connection the id names", () => {
    expect(brokerFrom([gateway(1), broker(2)], 2)).toEqual({ brokerUrl: "mqtt://hass.lan:1883" });
  });

  test("a null id is off — the retired `enabled` flag, spelled as absence", () => {
    expect(brokerFrom([broker(2)], null)).toBeNull();
  });

  test("an id naming NO connection is off, not an error", () => {
    // `mqtt.connectionId` is a soft reference in a JSONB document, so an
    // operator deleting the connection leaves the id dangling. That has to turn
    // the export off — a throw here would take a boot down over a setting.
    expect(brokerFrom([gateway(1)], 99)).toBeNull();
  });

  test("an id naming a MODBUS connection is off, not a broker at 10.0.0.5:502", () => {
    // The mirror of the poll loop's rule: a connection of the wrong kind has
    // nothing to dial, and coercing a host into a broker URL would produce a
    // client that retries a Modbus gateway forever.
    expect(brokerFrom([gateway(7)], 7)).toBeNull();
  });

  test("carries the credentials and the client id through", () => {
    const withCreds: ConnectionRecord = {
      id: 3,
      name: "Broker",
      kind: "mqtt",
      params: {
        brokerUrl: "mqtt://hass.lan:1883",
        username: "mqtt",
        password: "secret",
        clientId: "sunreye-1",
      },
    };
    expect(brokerFrom([withCreds], 3)).toEqual(withCreds.params);
  });

  test("an empty roster is off", () => {
    expect(brokerFrom([], 1)).toBeNull();
  });
});

describe("envBrokerSeed", () => {
  const env = {
    MQTT_ENABLED: true,
    MQTT_BROKER_URL: "mqtt://from-env:1883",
    MQTT_USERNAME: "envuser",
    MQTT_PASSWORD: "envpass",
  } as const;

  test("creates a broker connection for an env-only install that has none", () => {
    // The env vars are documented "seed only", and the endpoint they seed is a
    // ROW now. Without this a docker install that has always set
    // MQTT_BROKER_URL would come up with the export silently off.
    expect(envBrokerSeed(env, [gateway(1)], { connectionId: null })).toEqual({
      create: {
        brokerUrl: "mqtt://from-env:1883",
        username: "envuser",
        password: "envpass",
      },
    });
  });

  test("omits credentials the env does not set", () => {
    expect(
      envBrokerSeed({ ...env, MQTT_USERNAME: undefined, MQTT_PASSWORD: undefined }, [], {
        connectionId: null,
      }),
    ).toEqual({ create: { brokerUrl: "mqtt://from-env:1883" } });
  });

  test("ADOPTS a broker the plant already has rather than adding a second", () => {
    // The rule every seed here follows: create rows this install has none of,
    // never edit one it has. A second row would leave the operator with two
    // brokers and no way to tell which one the export uses.
    expect(envBrokerSeed(env, [gateway(1), broker(4)], { connectionId: null })).toEqual({
      bind: 4,
    });
  });

  test("a setting that already names a broker is left completely alone", () => {
    expect(envBrokerSeed(env, [broker(4)], { connectionId: 4 })).toBeNull();
  });

  test("a DANGLING connectionId is re-bound to the plant's broker", () => {
    // The operator deleted the connection and made another. Leaving the id
    // dangling would report the export as configured while publishing nothing.
    expect(envBrokerSeed(env, [broker(9)], { connectionId: 4 })).toEqual({ bind: 9 });
  });

  test("MQTT_ENABLED=false seeds nothing — the deploy asked for no broker", () => {
    expect(envBrokerSeed({ ...env, MQTT_ENABLED: false }, [], { connectionId: null })).toBeNull();
  });

  test("a blank broker URL seeds nothing, enabled or not", () => {
    expect(
      envBrokerSeed({ ...env, MQTT_BROKER_URL: "   " }, [], { connectionId: null }),
    ).toBeNull();
  });

  test("with the bridge off, an EXISTING broker is still adopted", () => {
    // `MQTT_ENABLED` only ever governed whether to seed an endpoint. A plant
    // that has a broker row (the 0006 migration made one) must bind to it
    // whatever the env says, or the migration's work is undone on the next boot.
    expect(
      envBrokerSeed({ ...env, MQTT_ENABLED: false }, [broker(4)], { connectionId: null }),
    ).toEqual({ bind: 4 });
  });
});

describe("applyBrokerSeed", () => {
  function harness(seed: { connections?: ConnectionRecord[]; connectionId?: number | null } = {}) {
    const connections = seed.connections ?? [];
    const state = { connectionId: seed.connectionId ?? null };
    const created: MqttParams[] = [];
    const said: string[] = [];
    const deps = {
      readConnections: async () => connections,
      createBroker: async (params: MqttParams) => {
        created.push(params);
        return 42;
      },
      readConfig: async () => state,
      bind: async (connectionId: number) => {
        state.connectionId = connectionId;
      },
      logger: { info: (template: string) => said.push(template) },
    };
    return { deps, state, created, said };
  }

  const env = {
    MQTT_ENABLED: true,
    MQTT_BROKER_URL: "mqtt://from-env:1883",
  } satisfies Parameters<typeof applyBrokerSeed>[0];

  test("creates the connection, binds the setting to it and says so", async () => {
    const { deps, state, created, said } = harness();
    expect(await applyBrokerSeed(env, deps)).toBe(42);
    expect(created).toEqual([{ brokerUrl: "mqtt://from-env:1883" }]);
    expect(state.connectionId).toBe(42);
    expect(said.join(" ")).toContain("MQTT_BROKER_URL");
  });

  test("binds to an existing broker without creating one", async () => {
    const { deps, state, created } = harness({ connections: [broker(4)] });
    expect(await applyBrokerSeed(env, deps)).toBe(4);
    expect(created).toEqual([]);
    expect(state.connectionId).toBe(4);
  });

  test("a settled setting is not written at all", async () => {
    const { deps, created, said } = harness({ connections: [broker(4)], connectionId: 4 });
    expect(await applyBrokerSeed(env, deps)).toBe(4);
    expect(created).toEqual([]);
    expect(said).toEqual([]);
  });

  test("nothing to seed leaves the setting's own answer intact", async () => {
    const { deps, state } = harness();
    expect(await applyBrokerSeed({ ...env, MQTT_ENABLED: false }, deps)).toBeNull();
    expect(state.connectionId).toBeNull();
  });
});
