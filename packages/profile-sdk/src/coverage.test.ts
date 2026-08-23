import { describe, expect, test } from "bun:test";

import { defineProfile, metric, ROLE_NAMES, type MetricDataDef } from "@SunReye/inverter-core";

import {
  coverage,
  groupByPrefix,
  isIndexedRole,
  missingRequiredRoles,
  parseRequiredRoles,
  suggestAggregates,
} from "./coverage";

const pv = (n: number): MetricDataDef =>
  metric(`dc/pv${n}/power`, {
    label: `PV${n} Power`,
    group: "solar",
    unit: "W",
    role: "pv.string.power",
    index: n,
    addr: 670 + n,
  });

const total = (sum: string[]): MetricDataDef =>
  metric("dc/total_power", {
    label: "PV Total",
    group: "solar",
    unit: "W",
    role: "pv.total.power",
    computeExpr: { sum },
  });

const pvVoltage = (n: number): MetricDataDef =>
  metric(`dc/pv${n}/voltage`, {
    label: `PV${n} Voltage`,
    group: "solar",
    unit: "V",
    role: "pv.string.voltage",
    index: n,
    addr: 680 + n,
  });

const unmapped = metric("misc/firmware", { label: "Firmware", group: "inverter", addr: 19 });

const profile = (metrics: MetricDataDef[]) =>
  defineProfile({ id: "acme", name: "Acme", manufacturer: "Acme", version: "1.0.0", metrics });

describe("coverage", () => {
  test("a profile that maps no role leaves every renderable area empty", () => {
    const report = coverage(profile([unmapped]));
    expect(report.mapped).toEqual([]);
    expect(report.mappedCount).toBe(0);
    expect(report.total).toBe(ROLE_NAMES.length);
    expect(report.missing).toEqual([...ROLE_NAMES]);
  });

  test("a role is mapped once however many metrics carry it", () => {
    // Three PV strings are one renderable concept, not three.
    const report = coverage(profile([pv(1), pv(2), pv(3)]));
    expect(report.mapped).toEqual(["pv.string.power"]);
    expect(report.mappedCount).toBe(1);
    expect(report.missing).not.toContain("pv.string.power");
    expect(report.mapped.length + report.missing.length).toBe(report.total);
  });

  test("roles are reported in catalog order, not in the order the profile lists them", () => {
    const soc = metric("battery/soc", {
      label: "SOC",
      group: "battery",
      unit: "%",
      role: "battery.soc",
      addr: 588,
    });
    // Listed battery-first; the report follows ROLE_CATALOG (solar before battery).
    expect(coverage(profile([soc, pv(1)])).mapped).toEqual(["pv.string.power", "battery.soc"]);
  });
});

describe("groupByPrefix", () => {
  test("groups roles under their leading segment, keeping the order given", () => {
    const groups = groupByPrefix([
      "pv.string.power",
      "battery.soc",
      "pv.total.power",
      "setting.work_mode",
      "setting.battery.max_charge_current",
    ]);
    expect([...groups]).toEqual([
      ["pv", ["pv.string.power", "pv.total.power"]],
      ["battery", ["battery.soc"]],
      ["setting", ["setting.work_mode", "setting.battery.max_charge_current"]],
    ]);
  });

  test("a two-segment role groups under its first segment", () => {
    expect([...groupByPrefix(["production.today", "production.total"])]).toEqual([
      ["production", ["production.today", "production.total"]],
    ]);
  });

  test("no roles means no groups (a fully mapped profile prints nothing)", () => {
    expect(groupByPrefix([]).size).toBe(0);
  });
});

describe("isIndexedRole", () => {
  test("per-string and per-phase roles are indexed", () => {
    expect(isIndexedRole("pv.string.power")).toBe(true);
    expect(isIndexedRole("grid.phase.current")).toBe(true);
    expect(isIndexedRole("load.phase.power")).toBe(true);
  });

  test("whole-system roles are not indexed", () => {
    expect(isIndexedRole("pv.total.power")).toBe(false);
    expect(isIndexedRole("battery.soc")).toBe(false);
    expect(isIndexedRole("setting.work_mode")).toBe(false);
  });
});

describe("suggestAggregates", () => {
  test("suggests sumOf when a sum covers exactly an indexed role group", () => {
    const data = profile([pv(1), pv(2), total(["dc.pv1.power", "dc.pv2.power"])]);
    expect(suggestAggregates(data)).toEqual([
      { key: "dc.total_power", role: "pv.string.power", count: 2 },
    ]);
  });

  test("no suggestion when the sum is only a subset of the role group", () => {
    const data = profile([pv(1), pv(2), pv(3), total(["dc.pv1.power", "dc.pv2.power"])]);
    expect(suggestAggregates(data)).toEqual([]);
  });

  test("no suggestion for a single-key sum (not worth an aggregate)", () => {
    const data = profile([pv(1), total(["dc.pv1.power"])]);
    expect(suggestAggregates(data)).toEqual([]);
  });

  test("no suggestion when the sum is the right size but lists a key outside the group", () => {
    // Same length as the pv.string.power group, but one member is a stale key.
    const data = profile([
      pv(1),
      pv(2),
      pvVoltage(1),
      pvVoltage(2),
      total(["dc.pv1.power", "dc.pv3.power"]),
    ]);
    expect(suggestAggregates(data)).toEqual([]);
  });

  test("suggests sumOf regardless of the order the sum lists its members", () => {
    const data = profile([
      pv(1),
      pv(2),
      pv(3),
      total(["dc.pv3.power", "dc.pv1.power", "dc.pv2.power"]),
    ]);
    expect(suggestAggregates(data)).toEqual([
      { key: "dc.total_power", role: "pv.string.power", count: 3 },
    ]);
  });

  test("a summing metric inside the group does not disqualify its own group", () => {
    // The total also carries pv.string.power; it must not count itself as a member.
    const selfInGroup = metric("dc/total_power", {
      label: "PV Total",
      group: "solar",
      unit: "W",
      role: "pv.string.power",
      index: 9,
      computeExpr: { sum: ["dc.pv1.power", "dc.pv2.power"] },
    });
    expect(suggestAggregates(profile([pv(1), pv(2), selfInGroup]))).toEqual([
      { key: "dc.total_power", role: "pv.string.power", count: 2 },
    ]);
  });

  test("ignores a computed metric whose expression is not a sum", () => {
    const data = profile([
      pv(1),
      pv(2),
      metric("dc/delta", {
        label: "Delta",
        group: "solar",
        unit: "W",
        computeExpr: { diff: ["dc.pv1.power", "dc.pv2.power"] },
      }),
    ]);
    expect(suggestAggregates(data)).toEqual([]);
  });

  test("ignores sums over a non-indexed role (not a per-SKU varying group)", () => {
    const today = metric("ac/daily_bought", {
      label: "Bought today",
      group: "grid",
      unit: "kWh",
      role: "grid.energy.imported.today",
      addr: 520,
    });
    // A contrived sum over a non-indexed role: still no suggestion.
    const data = profile([
      today,
      metric("derived/x", { label: "X", group: "grid", computeExpr: { sum: ["ac.daily_bought"] } }),
    ]);
    expect(suggestAggregates(data)).toEqual([]);
  });
});

describe("parseRequiredRoles", () => {
  test("splits a comma-separated --require list, trimming and dropping blanks", () => {
    expect(parseRequiredRoles(" battery.soc , grid.power ,")).toEqual({
      roles: ["battery.soc", "grid.power"],
      unknown: [],
    });
  });

  test("an absent or empty flag requires nothing explicitly", () => {
    expect(parseRequiredRoles(undefined)).toEqual({ roles: [], unknown: [] });
    expect(parseRequiredRoles("")).toEqual({ roles: [], unknown: [] });
  });

  test("reports a name that is not a canonical role instead of silently ignoring it", () => {
    // A typo must not quietly weaken the gate.
    expect(parseRequiredRoles("battery.soc,battery.sock")).toEqual({
      roles: ["battery.soc"],
      unknown: ["battery.sock"],
    });
  });

  test("dedupes a role listed twice", () => {
    expect(parseRequiredRoles("grid.power,grid.power").roles).toEqual(["grid.power"]);
  });
});

const socMetric = metric("battery/soc", {
  label: "SOC",
  group: "battery",
  unit: "%",
  role: "battery.soc",
  addr: 588,
  range: { min: 0, max: 100 },
});

describe("missingRequiredRoles — explicit floor", () => {
  test("names the required role the profile does not map", () => {
    expect(missingRequiredRoles(profile([socMetric]), ["battery.soc", "grid.power"])).toEqual([
      "grid.power",
    ]);
  });

  test("nothing is missing when every required role is mapped", () => {
    expect(missingRequiredRoles(profile([socMetric]), ["battery.soc"])).toEqual([]);
  });

  test("an explicit floor replaces the family defaults rather than adding to them", () => {
    // Asking only for pv.string.power must not also demand pv.total.power.
    expect(missingRequiredRoles(profile([pv(1), socMetric]), ["pv.string.power"])).toEqual([]);
  });
});

describe("missingRequiredRoles — per-family default", () => {
  const batteryPower = metric("battery/power", {
    label: "Battery Power",
    group: "battery",
    unit: "W",
    type: "S_WORD",
    role: "battery.power",
    addr: 590,
    flow: { positive: "Charging", negative: "Discharging" },
  });

  test("a profile with battery metrics but no soc is refused, naming battery.soc", () => {
    // The exact bug: the whole battery section renders empty.
    expect(missingRequiredRoles(profile([batteryPower]))).toContain("battery.soc");
  });

  test("a profile with no battery at all is not asked for battery.soc", () => {
    expect(missingRequiredRoles(profile([unmapped]))).toEqual([]);
  });

  test("a pv profile must expose the whole-array total, not only per-string power", () => {
    expect(missingRequiredRoles(profile([pv(1), pv(2)]))).toEqual(["pv.total.power"]);
  });

  test("the anchor being present satisfies its family", () => {
    expect(missingRequiredRoles(profile([batteryPower, socMetric]))).toEqual([]);
  });
});
