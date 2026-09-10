import { describe, expect, test } from "bun:test";
import {
  PLANT,
  type SourcesResponse,
  acceptsMetricsFrame,
  offersChoice,
  resolveSaved,
  shownUnder,
  sourceMenu,
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

describe("sourceMenu — what the sidebar's source menu renders", () => {
  // The menu is a rendering of `sourceOptions`. The regression this guards is a
  // second list: a menu that builds its own options (and so quietly keeps a
  // retired device, or loses the plant row) while `sourceOptions` stays right.
  test("the option list is sourceOptions, unchanged", () => {
    expect(sourceMenu(two, "Plant", PLANT).options).toEqual(sourceOptions(two, "Plant"));
    expect(sourceMenu(retiredTwin, "Plant", "a").options).toEqual(
      sourceOptions(retiredTwin, "Plant"),
    );
  });

  test("the mark and the trigger's second line follow the current source", () => {
    const menu = sourceMenu(two, "Plant", "b");
    expect(menu.activeId).toBe("b");
    expect(menu.currentLabel).toBe("West");
    expect(menu.options.map((o) => o.id === menu.activeId)).toEqual([false, false, true]);
  });

  test("the plant is marked when the plant is current", () => {
    const menu = sourceMenu(two, "Anlage", PLANT);
    expect(menu.activeId).toBe(PLANT);
    expect(menu.currentLabel).toBe("Anlage");
  });

  // Boundary: the source list has not landed yet. The button still renders — it
  // is the sidebar's brand row — so it needs a label and a mark that resolve
  // without an option to point at, and an empty list rather than a crash.
  test("before the source list lands there are no options and the plant is named", () => {
    const menu = sourceMenu(null, "Plant", PLANT);
    expect(menu.options).toEqual([]);
    expect(menu.activeId).toBe(PLANT);
    expect(menu.currentLabel).toBe("Plant");
  });

  // Boundary: a device retired or renamed between the saved choice and this
  // render. `resolveSaved` normally prevents it, but a device retired in
  // settings while the page is open reaches exactly this state — the menu must
  // fall back to the plant rather than name a source nothing answers.
  test("a current source no longer in the list falls back to the plant", () => {
    const menu = sourceMenu(retiredTwin, "Plant", "old");
    expect(menu.activeId).toBe(PLANT);
    expect(menu.currentLabel).toBe("Plant");
    expect(menu.options.map((o) => o.id)).toEqual(["plant", "a"]);
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
