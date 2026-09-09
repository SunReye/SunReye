import { describe, expect, test } from "bun:test";
import {
  PLANT,
  type SourcesResponse,
  acceptsMetricsFrame,
  offersChoice,
  resolveSaved,
  shownUnder,
  sourceOptions,
  sourceQuery,
} from "./source";

const two: SourcesResponse = {
  plant: { members: ["a", "b"] },
  devices: [
    { slug: "a", name: "East", role: "inverter", retired: false, member: true },
    { slug: "b", name: "West", role: "inverter", retired: false, member: true },
  ],
};
const one: SourcesResponse = { plant: { members: ["a"] }, devices: [two.devices[0]!] };
const retiredTwin: SourcesResponse = {
  plant: { members: ["a", "old"] },
  devices: [
    two.devices[0]!,
    { slug: "old", name: "Old", role: "inverter", retired: true, member: true },
  ],
};

describe("sourceQuery", () => {
  test("is the `source` parameter, verbatim", () => {
    expect(sourceQuery("plant")).toEqual({ source: "plant" });
    expect(sourceQuery("a")).toEqual({ source: "a" });
  });
});

describe("offersChoice", () => {
  test("only a plant of several devices IN SERVICE has a switcher", () => {
    expect(offersChoice(two)).toBe(true);
    expect(offersChoice(one)).toBe(false);
    expect(offersChoice(retiredTwin)).toBe(false);
    expect(offersChoice(null)).toBe(false);
  });
});

describe("resolveSaved", () => {
  test("a saved device that still exists is honoured", () => {
    expect(resolveSaved("b", two)).toBe("b");
  });
  test("a saved device that is gone or retired, or nothing saved, is the plant", () => {
    expect(resolveSaved("gone", two)).toBe(PLANT);
    expect(resolveSaved("old", retiredTwin)).toBe(PLANT);
    expect(resolveSaved(null, two)).toBe(PLANT);
    expect(resolveSaved("a", null)).toBe(PLANT);
  });
});

describe("shownUnder — which metrics a plant view can show", () => {
  test("under the plant of two, a per-device role leaves the catalog", () => {
    expect(shownUnder(PLANT, two, { role: "grid.phase.voltage" })).toBe(false);
    expect(shownUnder(PLANT, two, { role: "inverter.status" })).toBe(false);
    expect(shownUnder(PLANT, two, { role: "pv.total.power" })).toBe(true);
    expect(shownUnder(PLANT, two, { role: "battery.soc" })).toBe(true);
  });
  test("a metric with no role has no plant value", () => {
    expect(shownUnder(PLANT, two, {})).toBe(false);
  });
  test("one device, or a plant of one, shows everything", () => {
    expect(shownUnder("a", two, { role: "grid.phase.voltage" })).toBe(true);
    expect(shownUnder(PLANT, one, { role: "grid.phase.voltage" })).toBe(true);
    expect(shownUnder(PLANT, null, {})).toBe(true);
  });
});

describe("sourceOptions", () => {
  test("plant first, then the in-service devices by name", () => {
    expect(sourceOptions(retiredTwin, "Plant")).toEqual([
      { id: "plant", label: "Plant" },
      { id: "a", label: "East" },
    ]);
    expect(sourceOptions(two, "Plant")).toEqual([
      { id: "plant", label: "Plant" },
      { id: "a", label: "East" },
      { id: "b", label: "West" },
    ]);
  });
});

describe("acceptsMetricsFrame", () => {
  test("a device frame counts only for its own slug; the plant takes none", () => {
    expect(acceptsMetricsFrame("a", "a")).toBe(true);
    expect(acceptsMetricsFrame("a", "b")).toBe(false);
    expect(acceptsMetricsFrame(PLANT, "a")).toBe(false);
    expect(acceptsMetricsFrame("a", undefined)).toBe(false);
  });

  test("a frame stamped with the device's PROFILE id — what the driver sends — counts too", () => {
    const sources: SourcesResponse = {
      plant: { members: ["a"] },
      devices: [{ ...two.devices[0]!, profileId: "deye-sun" }],
    };
    expect(acceptsMetricsFrame("a", "deye-sun", sources)).toBe(true);
    expect(acceptsMetricsFrame("a", "other-profile", sources)).toBe(false);
    expect(acceptsMetricsFrame("a", "deye-sun", null)).toBe(false);
  });
});
