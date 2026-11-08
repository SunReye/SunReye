import { describe, expect, test } from "bun:test";
import { type Capabilities, hasCapability } from "./capabilities";

const NONE: Capabilities = {
  history: false,
  statistics: false,
  controls: false,
  automations: false,
  restart: false,
  profileSources: false,
  integrations: false,
  pvAndBattery: false,
  pricesAndCosts: false,
  statisticsHeatmap: false,
  evccCommands: false,
  customCharts: false,
};

describe("hasCapability", () => {
  test("an engine that has not answered serves every area", () => {
    for (const name of Object.keys(NONE) as (keyof Capabilities)[]) {
      expect(hasCapability(null, name)).toBe(true);
    }
  });

  test("an area the engine reports absent is absent, and only that one", () => {
    const caps = { ...NONE, history: true };
    expect(hasCapability(caps, "history")).toBe(true);
    expect(hasCapability(caps, "statistics")).toBe(false);
    expect(hasCapability(caps, "restart")).toBe(false);
  });
});
