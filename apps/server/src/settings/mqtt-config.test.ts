import { maskMqttConfig, mergeMqttWrite, mqttConfigSchema } from "@SunReye/db/mqtt-config";
import { describe, expect, test } from "bun:test";

const base = mqttConfigSchema.parse({
  enabled: true,
  brokerUrl: "mqtt://broker:1883",
  username: "user",
  password: "secret",
  topicPrefix: "sunreye",
});

describe("maskMqttConfig", () => {
  test("strips the password and reports whether one is set", () => {
    const masked = maskMqttConfig(base);
    expect("password" in masked).toBe(false);
    expect(masked.hasPassword).toBe(true);
    expect(masked.brokerUrl).toBe("mqtt://broker:1883");
  });

  test("hasPassword is false when unset", () => {
    expect(maskMqttConfig(mqttConfigSchema.parse({})).hasPassword).toBe(false);
  });
});

describe("mergeMqttWrite", () => {
  test("keeps the stored password when the write omits it", () => {
    const input = mqttConfigSchema.parse({ enabled: false, brokerUrl: "mqtt://new:1883" });
    const merged = mergeMqttWrite(base, input);
    expect(merged.password).toBe("secret"); // preserved
    expect(merged.brokerUrl).toBe("mqtt://new:1883"); // updated
    expect(merged.enabled).toBe(false);
  });

  test("replaces the password when the write provides one", () => {
    const input = mqttConfigSchema.parse({ password: "rotated" });
    expect(mergeMqttWrite(base, input).password).toBe("rotated");
  });
});
