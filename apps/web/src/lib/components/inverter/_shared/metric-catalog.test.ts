import { describe, expect, it } from "bun:test";
import type { ManifestMetric } from "$lib/inverter/types";
import { chartableMetrics, searchedGroups } from "./metric-catalog";

const metric = (over: Partial<ManifestMetric> = {}): ManifestMetric => ({
  key: "pv1_power",
  topic: "pv1/power",
  label: "PV1 power",
  unit: "W",
  group: "solar",
  kind: "measurement",
  storage: "series",
  writable: false,
  ...over,
});

describe("chartableMetrics", () => {
  it("drops config-stored and enum metrics, keeps curves", () => {
    const curve = metric();
    const config = metric({ key: "mode", storage: "config" });
    const state = metric({ key: "status", kind: "status" });
    expect(chartableMetrics([config, curve, state])).toEqual([curve]);
  });

  it("is empty for an empty manifest", () => {
    expect(chartableMetrics([])).toEqual([]);
  });
});

describe("searchedGroups", () => {
  const solar = metric({
    key: "pv1_power",
    label: "PV1 power",
    group: "solar",
  });
  const battery = metric({
    key: "soc",
    label: "Battery SOC",
    group: "battery",
  });

  it("groups by category in alphabetical order", () => {
    expect(searchedGroups([solar, battery], "")).toEqual([
      ["Battery", [battery]],
      ["Solar", [solar]],
    ]);
  });

  it("narrows to the search before grouping", () => {
    expect(searchedGroups([solar, battery], "soc")).toEqual([["Battery", [battery]]]);
  });

  it("returns no groups when nothing matches", () => {
    expect(searchedGroups([solar], "zzz")).toEqual([]);
  });
});
