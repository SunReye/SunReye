import { describe, expect, test } from "bun:test";

import {
  CONNECTION_KINDS,
  type ConnectionParams,
  connectionParamsSchema,
  connectionSettingsSchema,
  isConnectionKind,
  maskConnectionParams,
  mergeConnectionParams,
  modbusParamsSchema,
  mqttParamsSchema,
  parseConnectionParams,
} from "./connection-kinds";

const modbus = { host: "10.20.0.62", port: 502 };
const broker = { brokerUrl: "mqtt://hass.ee.lan:1883", username: "mqtt", password: "secret" };

describe("CONNECTION_KINDS", () => {
  test("names exactly the two kinds the CHECK constraint admits", () => {
    expect([...CONNECTION_KINDS]).toEqual(["modbus", "mqtt"]);
  });

  test("isConnectionKind admits the two and refuses a future one", () => {
    expect(isConnectionKind("modbus")).toBe(true);
    expect(isConnectionKind("mqtt")).toBe(true);
    // `http` is the next kind the seam is left open for (#217) — until its
    // migration lands, a row claiming it must not parse.
    expect(isConnectionKind("http")).toBe(false);
    expect(isConnectionKind("")).toBe(false);
  });
});

describe("the modbus arm", () => {
  test("defaults every field the endpoint form leaves out", () => {
    expect(modbusParamsSchema.parse({ host: "10.20.0.62" })).toEqual({
      host: "10.20.0.62",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
  });

  test("refuses a transport the Modbus client has no branch for", () => {
    // The value the dropped CHECK used to refuse: the client simply never polls
    // an endpoint it cannot frame, so the plant goes quiet with no error.
    expect(modbusParamsSchema.safeParse({ host: "h", transport: "carrier-pigeon" }).success).toBe(
      false,
    );
  });

  test("refuses an empty host and an out-of-range port", () => {
    expect(modbusParamsSchema.safeParse({ host: "  " }).success).toBe(false);
    expect(modbusParamsSchema.safeParse({ host: "h", port: 0 }).success).toBe(false);
    expect(modbusParamsSchema.safeParse({ host: "h", port: 70_000 }).success).toBe(false);
  });

  test("floors the poll cadence at a second, as the runtime does", () => {
    expect(modbusParamsSchema.safeParse({ host: "h", pollIntervalMs: 999 }).success).toBe(false);
  });
});

describe("the mqtt arm", () => {
  test("keeps the broker URL and the optional credentials", () => {
    expect(mqttParamsSchema.parse(broker)).toEqual(broker);
  });

  test("a broker with no credentials is legal — an open broker is common", () => {
    expect(mqttParamsSchema.parse({ brokerUrl: "mqtt://localhost:1883" })).toEqual({
      brokerUrl: "mqtt://localhost:1883",
    });
  });

  test("carries an optional clientId", () => {
    expect(mqttParamsSchema.parse({ ...broker, clientId: "sunreye-1" }).clientId).toBe("sunreye-1");
  });

  test("refuses an empty broker URL — there is nothing to dial", () => {
    expect(mqttParamsSchema.safeParse({ brokerUrl: "" }).success).toBe(false);
    expect(mqttParamsSchema.safeParse({}).success).toBe(false);
  });
});

describe("connectionParamsSchema", () => {
  test("parses the modbus arm", () => {
    const parsed = connectionParamsSchema.parse({ kind: "modbus", params: modbus });
    expect(parsed).toEqual({
      kind: "modbus",
      params: { ...modbus, transport: "tcp", timeoutMs: 2000, pollIntervalMs: 1000 },
    });
  });

  test("parses the mqtt arm", () => {
    expect(connectionParamsSchema.parse({ kind: "mqtt", params: broker })).toEqual({
      kind: "mqtt",
      params: broker,
    });
  });

  test("rejects an unknown kind", () => {
    expect(connectionParamsSchema.safeParse({ kind: "http", params: modbus }).success).toBe(false);
    expect(connectionParamsSchema.safeParse({ params: modbus }).success).toBe(false);
  });

  test("rejects the OTHER arm's params under a kind", () => {
    // The whole point of the discriminant: a modbus row may not hold a broker
    // URL, and an mqtt row may not hold a host.
    expect(connectionParamsSchema.safeParse({ kind: "modbus", params: broker }).success).toBe(
      false,
    );
    expect(connectionParamsSchema.safeParse({ kind: "mqtt", params: modbus }).success).toBe(false);
  });
});

describe("connectionSettingsSchema", () => {
  test("carries the label alongside the discriminated params", () => {
    const parsed = connectionSettingsSchema.parse({
      name: "GX gateway",
      kind: "modbus",
      params: modbus,
    });
    expect(parsed.name).toBe("GX gateway");
    expect(parsed.kind).toBe("modbus");
  });

  test("refuses a nameless connection", () => {
    expect(
      connectionSettingsSchema.safeParse({ name: "  ", kind: "mqtt", params: broker }).success,
    ).toBe(false);
  });
});

describe("parseConnectionParams", () => {
  test("pairs a row's kind column with its params jsonb", () => {
    expect(parseConnectionParams("mqtt", broker)).toEqual({ kind: "mqtt", params: broker });
  });

  test("a kind this build does not know is a refusal, not a silent default", () => {
    // The silent-reset trap (settings-schema-silent-reset): a row migrated
    // ahead of this build must be loud, never coerced to modbus.
    expect(() => parseConnectionParams("http", { host: "h" })).toThrow();
  });
});

describe("maskConnectionParams", () => {
  test("strips the mqtt password and says only whether one is set", () => {
    const masked = maskConnectionParams({ kind: "mqtt", params: broker });
    expect(masked).toEqual({
      kind: "mqtt",
      params: { brokerUrl: broker.brokerUrl, username: "mqtt", hasPassword: true },
    });
    expect(JSON.stringify(masked)).not.toContain("secret");
  });

  test("reports a credential-less broker as having no password", () => {
    const masked = maskConnectionParams({
      kind: "mqtt",
      params: { brokerUrl: "mqtt://localhost:1883" },
    });
    expect(masked.kind === "mqtt" && masked.params.hasPassword).toBe(false);
  });

  test("leaves the modbus arm alone — it holds no secret", () => {
    const params: ConnectionParams = {
      kind: "modbus",
      params: { ...modbus, transport: "tcp", timeoutMs: 2000, pollIntervalMs: 1000 },
    };
    expect(maskConnectionParams(params)).toEqual(params);
  });
});

describe("mergeConnectionParams", () => {
  const stored: ConnectionParams = { kind: "mqtt", params: broker };

  test("an absent password means leave the stored one alone — the masking round trip", () => {
    // The exact round trip the UI performs: read the masked shape, edit a field,
    // send it back with no password. The broker must not lose its credential.
    const masked = maskConnectionParams(stored);
    const sentBack = { kind: "mqtt", params: { brokerUrl: "mqtt://moved:1883", username: "mqtt" } };
    expect(masked.kind === "mqtt" && masked.params.hasPassword).toBe(true);
    const merged = mergeConnectionParams(stored, connectionParamsSchema.parse(sentBack));
    expect(merged).toEqual({
      kind: "mqtt",
      params: { brokerUrl: "mqtt://moved:1883", username: "mqtt", password: "secret" },
    });
  });

  test("an empty password is also 'leave it alone', not 'clear it'", () => {
    const merged = mergeConnectionParams(
      stored,
      connectionParamsSchema.parse({ kind: "mqtt", params: { ...broker, password: "" } }),
    );
    expect(merged.kind === "mqtt" && merged.params.password).toBe("secret");
  });

  test("a password that was sent replaces the stored one", () => {
    const merged = mergeConnectionParams(
      stored,
      connectionParamsSchema.parse({ kind: "mqtt", params: { ...broker, password: "rotated" } }),
    );
    expect(merged.kind === "mqtt" && merged.params.password).toBe("rotated");
  });

  test("a kind change carries nothing over — the two arms share no field", () => {
    const merged = mergeConnectionParams(
      stored,
      connectionParamsSchema.parse({ kind: "modbus", params: modbus }),
    );
    expect(merged.kind).toBe("modbus");
    expect(JSON.stringify(merged)).not.toContain("secret");
  });

  test("the modbus arm merges as a plain replacement", () => {
    const modbusStored = connectionParamsSchema.parse({ kind: "modbus", params: modbus });
    const next = connectionParamsSchema.parse({
      kind: "modbus",
      params: { host: "10.20.0.9", port: 1502 },
    });
    expect(mergeConnectionParams(modbusStored, next)).toEqual(next);
  });
});
