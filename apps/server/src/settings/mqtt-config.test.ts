import { defaultMqtt, mqttConfigSchema, mqttExportConfigured } from "@SunReye/db/mqtt-config";
import { describe, expect, test } from "bun:test";

/**
 * THE EXPORT HALF ONLY.
 *
 * Before #217 this file tested a masked password and a write-only merge, because
 * the record held the broker. It does not: the endpoint is a `kind = 'mqtt'`
 * connection, and `packages/db/src/connection-kinds.test.ts` is where the
 * masking round trip lives now. What is left to prove here is that the record
 * carries no secret at all, and that a null connection is the only way to be
 * off.
 */
describe("mqttConfigSchema", () => {
  test("defaults to no broker, which IS off", () => {
    expect(defaultMqtt).toEqual({
      connectionId: null,
      topicPrefix: "sunreye",
      haDiscoveryEnabled: false,
      haDiscoveryPrefix: "homeassistant",
    });
  });

  test("carries no broker field at all — there is nothing left to mask", () => {
    const parsed = mqttConfigSchema.parse({
      connectionId: 3,
      brokerUrl: "mqtt://sneaky:1883",
      username: "u",
      password: "secret",
    });
    expect(parsed).toEqual({
      connectionId: 3,
      topicPrefix: "sunreye",
      haDiscoveryEnabled: false,
      haDiscoveryPrefix: "homeassistant",
    });
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });

  test("refuses a connection id that is not a row id", () => {
    expect(mqttConfigSchema.safeParse({ connectionId: 0 }).success).toBe(false);
    expect(mqttConfigSchema.safeParse({ connectionId: -1 }).success).toBe(false);
    expect(mqttConfigSchema.safeParse({ connectionId: 1.5 }).success).toBe(false);
  });

  test("refuses an empty prefix — every topic is built on it", () => {
    expect(mqttConfigSchema.safeParse({ topicPrefix: "" }).success).toBe(false);
    expect(mqttConfigSchema.safeParse({ haDiscoveryPrefix: "" }).success).toBe(false);
  });
});

describe("mqttExportConfigured", () => {
  test("a bound connection is on, a null one is off", () => {
    expect(mqttExportConfigured({ ...defaultMqtt, connectionId: 3 })).toBe(true);
    expect(mqttExportConfigured(defaultMqtt)).toBe(false);
  });

  test("HA discovery alone does NOT make the export configured", () => {
    // The pairing the retired `enabled` flag used to allow to disagree with
    // itself: discovery on with nothing to publish through announced entities
    // that never got a value.
    expect(mqttExportConfigured({ ...defaultMqtt, haDiscoveryEnabled: true })).toBe(false);
  });
});
