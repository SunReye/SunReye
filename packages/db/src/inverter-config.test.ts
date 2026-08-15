import { describe, expect, test } from "bun:test";

import { INVERTER_KEY, inverterConfigSchema } from "./inverter-config";

/** The issue paths a rejected config reports, in order. */
const issuePaths = (input: unknown): string[] => {
  const result = inverterConfigSchema.safeParse(input);
  if (result.success) throw new Error("expected the config to be rejected");
  return result.error.issues.map((i) => i.path.join("."));
};

const messageFor = (input: unknown, path: string): string | undefined => {
  const result = inverterConfigSchema.safeParse(input);
  if (result.success) throw new Error("expected the config to be rejected");
  return result.error.issues.find((i) => i.path.join(".") === path)?.message;
};

describe("schema totality", () => {
  // `readSetting` safeParses and falls back to the default *silently*, so a row
  // this schema rejects wipes a working inverter connection with no warning.
  test("an unconfigured instance parses to the Modbus TCP defaults", () => {
    expect(inverterConfigSchema.parse({})).toEqual({
      port: 502,
      transport: "tcp",
      unitId: 0,
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
  });

  test("a row stored before transport/timeout existed keeps its host and port", () => {
    const stored = { host: "192.168.1.40", port: 8899, unitId: 1 };

    expect(inverterConfigSchema.parse(stored)).toEqual({
      host: "192.168.1.40",
      port: 8899,
      unitId: 1,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
  });

  test("the settings key is stable — changing it orphans every saved connection", () => {
    expect(INVERTER_KEY).toBe("inverter");
  });
});

describe("the Modbus port", () => {
  test("accepts the whole legal TCP range", () => {
    expect(inverterConfigSchema.parse({ port: 1 }).port).toBe(1);
    expect(inverterConfigSchema.parse({ port: 65535 }).port).toBe(65535);
  });

  test("rejects 0 and anything above 65535, naming the field", () => {
    expect(issuePaths({ port: 0 })).toEqual(["port"]);
    expect(issuePaths({ port: 65536 })).toEqual(["port"]);
    expect(messageFor({ port: 0 }, "port")).toBe("Port must be 1–65535");
  });

  test("rejects a negative port", () => {
    expect(issuePaths({ port: -502 })).toEqual(["port"]);
  });

  test("rejects a fractional port before the range check ever runs", () => {
    const result = inverterConfigSchema.safeParse({ port: 502.5 });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join("."))).toEqual(["port"]);
  });
});

describe("the Modbus unit id", () => {
  test("accepts 0 — a real slave id, not an unset value", () => {
    expect(inverterConfigSchema.parse({ unitId: 0 }).unitId).toBe(0);
  });

  test("accepts the top of the range", () => {
    expect(inverterConfigSchema.parse({ unitId: 255 }).unitId).toBe(255);
  });

  test("rejects a negative id and one past 255", () => {
    expect(issuePaths({ unitId: -1 })).toEqual(["unitId"]);
    expect(issuePaths({ unitId: 256 })).toEqual(["unitId"]);
    expect(messageFor({ unitId: 256 }, "unitId")).toBe("Unit id must be 0–255");
  });
});

describe("the per-request timeout", () => {
  test("accepts both ends of the supported window", () => {
    expect(inverterConfigSchema.parse({ timeoutMs: 100 }).timeoutMs).toBe(100);
    expect(inverterConfigSchema.parse({ timeoutMs: 60_000 }).timeoutMs).toBe(60_000);
  });

  test("rejects a timeout too short to survive a slow RS485 gateway", () => {
    expect(issuePaths({ timeoutMs: 99 })).toEqual(["timeoutMs"]);
    expect(messageFor({ timeoutMs: 99 }, "timeoutMs")).toBe("Timeout must be 100–60000 ms");
  });

  test("rejects a timeout past a minute, and zero", () => {
    expect(issuePaths({ timeoutMs: 60_001 })).toEqual(["timeoutMs"]);
    expect(issuePaths({ timeoutMs: 0 })).toEqual(["timeoutMs"]);
  });
});

describe("the poll cadence", () => {
  test("is floored at one second — faster ticks are dropped by the in-flight guard anyway", () => {
    expect(inverterConfigSchema.parse({ pollIntervalMs: 1000 }).pollIntervalMs).toBe(1000);
    expect(inverterConfigSchema.safeParse({ pollIntervalMs: 999 }).success).toBe(false);
    expect(inverterConfigSchema.safeParse({ pollIntervalMs: 0 }).success).toBe(false);
  });

  test("is capped at an hour", () => {
    expect(inverterConfigSchema.parse({ pollIntervalMs: 3_600_000 }).pollIntervalMs).toBe(
      3_600_000,
    );
    expect(inverterConfigSchema.safeParse({ pollIntervalMs: 3_600_001 }).success).toBe(false);
  });
});

describe("reporting several bad fields at once", () => {
  test("every failing connection check is reported, not just the first", () => {
    // The settings form highlights per-field; stopping at the first issue would
    // make the user fix one number per save.
    expect(issuePaths({ port: 0, unitId: 900, timeoutMs: 5 })).toEqual([
      "port",
      "unitId",
      "timeoutMs",
    ]);
  });
});

describe("the transport framing", () => {
  test("accepts RTU tunnelled over TCP", () => {
    expect(inverterConfigSchema.parse({ transport: "rtu-over-tcp" }).transport).toBe(
      "rtu-over-tcp",
    );
  });

  test("rejects an unknown framing rather than guessing one", () => {
    expect(issuePaths({ transport: "serial" })).toEqual(["transport"]);
  });
});
