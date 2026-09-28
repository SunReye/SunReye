import { inverterConfigSchema } from "@SunReye/db/inverter-config";
import { describe, expect, test } from "bun:test";

import type { DeviceRegistry } from "../devices/registry";
import { getMqttConfig, getSimulate } from "../settings/config";
import { getSpotPriceConfig } from "../settings/spot-price-settings";
import { getWeatherConfig } from "../settings/weather-settings";
import { runForecastCorrectionLearn } from "../forecast/forecast-correction-job";
import { runSpotPriceSync } from "../prices/spot-price-job";
import { dbControlStore } from "./control-store";
import { loadPollEndpoint } from "./endpoint";
import { buildSource } from "./inverter";
import { startMqttBridge } from "./mqtt";
import { readMqttNamespace } from "./mqtt-namespace";
import { productionConnectionProbes, productionRuntimeDeps } from "./runtime-wiring";

/**
 * The production wiring. Built, never run: every collaborator it binds is
 * proved in its own suite, and `./runtime.test.ts` drives the runtime over
 * doubles of each. What is left to prove HERE is that the real ones are the
 * ones bound — a wiring that handed the runtime a stale or wrong reader would
 * pass every other suite.
 */

const registry = { primaryProfile: () => null } as unknown as DeviceRegistry;

describe("productionRuntimeDeps", () => {
  test("binds the real settings readers, not copies of them", () => {
    const deps = productionRuntimeDeps({ devices: registry, onLoadSample: () => {} });
    expect(deps.settings).toEqual({
      getMqttConfig,
      getSimulate,
      getWeatherConfig,
      getSpotPriceConfig,
    });
    expect(deps.buildSource).toBe(buildSource);
    expect(deps.startMqttBridge).toBe(startMqttBridge);
    expect(deps.controlStore).toBe(dbControlStore);
    expect(deps.loadPollEndpoint).toBe(loadPollEndpoint);
    expect(deps.mqttNamespace).toBe(readMqttNamespace);
    expect(deps.learnCorrection).toBe(runForecastCorrectionLearn);
    expect(deps.syncSpotPrices).toBe(runSpotPriceSync);
  });

  test("hands the runtime the roster and the load hook it was given", () => {
    const onLoadSample = () => {};
    const deps = productionRuntimeDeps({ devices: registry, onLoadSample });
    expect(deps.devices).toBe(registry);
    expect(deps.onLoadSample).toBe(onLoadSample);
  });

  test("reads the flush cadence when asked, not when wired", () => {
    // `env` is `process.env` itself under SKIP_ENV_VALIDATION; the cadence has
    // to follow it, which a value captured at wiring time would not.
    const deps = productionRuntimeDeps({ devices: registry, onLoadSample: () => {} });
    const before = process.env.HISTORY_FLUSH_INTERVAL_MS;
    try {
      process.env.HISTORY_FLUSH_INTERVAL_MS = "1234";
      expect(Number(deps.flushIntervalMs())).toBe(1234);
    } finally {
      if (before === undefined) delete process.env.HISTORY_FLUSH_INTERVAL_MS;
      else process.env.HISTORY_FLUSH_INTERVAL_MS = before;
    }
  });

  test("two wirings share no buffer", () => {
    // Each runtime owns its buffers; one shared between two instances would
    // flush one runtime's readings under the other's schedule.
    const a = productionRuntimeDeps({ devices: registry, onLoadSample: () => {} });
    const b = productionRuntimeDeps({ devices: registry, onLoadSample: () => {} });
    expect(a.history).not.toBe(b.history);
    expect(a.configLog).not.toBe(b.configLog);
    expect(a.identity).not.toBe(b.identity);
  });
});

describe("productionConnectionProbes", () => {
  test("a bare re-test asks the registry for its primary profile", async () => {
    const probes = productionConnectionProbes(registry);
    await expect(
      probes.testInverter(null, inverterConfigSchema.parse({ host: "10.0.0.1" })),
    ).resolves.toEqual({ ok: false, error: "No profile selected" });
  });
});
