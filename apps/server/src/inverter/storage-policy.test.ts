import { describe, expect, test } from "bun:test";

import { metric, type MetricDataDef, hydrateProfile } from "@SunReye/inverter-core";
import type { MetricDef } from "@SunReye/inverter-core";

import { createStoragePolicy } from "./storage-policy";

/** Runtime metric defs from authoring-SDK builders, via the real hydration path. */
function defs(metrics: MetricDataDef[]): MetricDef[] {
  return hydrateProfile({
    schemaVersion: 2,
    id: "test",
    name: "Test",
    manufacturer: "ACME",
    version: "1.0.0",
    metrics,
  }).metrics;
}

const at = (ms: number) => new Date(Date.UTC(2026, 7, 26, 12, 0, 0, ms)).toISOString();

/** One sample: the shape the poll loop hands the policy. */
const sample = (metrics: Record<string, number>, time = at(0)) => ({
  time,
  inverterId: "plant-1",
  metrics,
});

const voltage = metric("ac/l1/voltage", {
  label: "L1",
  unit: "V",
  group: "grid",
  addr: 598,
  scale: 0.1,
});

const workmode = metric("settings/workmode", {
  label: "Work mode",
  group: "settings",
  addr: 142,
  access: "rw",
  role: "setting.work_mode",
  enumLabels: { 0: "Selling First", 1: "Zero Export" },
});

const tou = metric("timeofuse/1/power", {
  label: "TOU 1 power",
  unit: "W",
  group: "timeofuse",
  addr: 250,
  access: "rw",
});

const keysOf = (rows: { metric: string }[]) => rows.map((r) => r.metric);

describe("the storage policy — config registers out of the hypertable", () => {
  test("a timeofuse key writes no row to metrics_raw", () => {
    // 30 timeofuse keys and 7 settings keys were 34% of every row written, in
    // the table whose retention and compression policies exist for timeseries.
    const policy = createStoragePolicy({ metrics: defs([voltage, tou]) });
    const routed = policy.route(sample({ "ac.l1.voltage": 230, "timeofuse.1.power": 3000 }));
    expect(keysOf(routed.series)).toEqual(["ac.l1.voltage"]);
    expect(keysOf(routed.config)).toEqual(["timeofuse.1.power"]);
  });

  test("changing a settings value writes exactly one change-log row; polling it unchanged writes none", () => {
    const policy = createStoragePolicy({ metrics: defs([workmode]) });
    // The first observation is a change: nothing was known before it.
    expect(keysOf(policy.route(sample({ "settings.workmode": 0 })).config)).toEqual([
      "settings.workmode",
    ]);
    expect(policy.route(sample({ "settings.workmode": 0 }, at(3))).config).toEqual([]);
    expect(policy.route(sample({ "settings.workmode": 0 }, at(6))).config).toEqual([]);
    const changed = policy.route(sample({ "settings.workmode": 1 }, at(9)));
    expect(changed.config).toEqual([
      { time: new Date(at(9)), inverterId: "plant-1", metric: "settings.workmode", value: 1 },
    ]);
  });

  test("a change back to a previously seen value is logged — the log is a history, not a set", () => {
    const policy = createStoragePolicy({ metrics: defs([workmode]) });
    policy.route(sample({ "settings.workmode": 0 }));
    policy.route(sample({ "settings.workmode": 1 }, at(3)));
    expect(keysOf(policy.route(sample({ "settings.workmode": 0 }, at(6))).config)).toEqual([
      "settings.workmode",
    ]);
  });

  test("the last logged value is tracked per inverter, not globally", () => {
    // Two devices sharing a metric key must not silence each other's changes.
    const policy = createStoragePolicy({ metrics: defs([workmode]) });
    policy.route(sample({ "settings.workmode": 0 }));
    const other = { time: at(3), inverterId: "plant-2", metrics: { "settings.workmode": 0 } };
    expect(keysOf(policy.route(other).config)).toEqual(["settings.workmode"]);
  });

  test("an explicit storage: series on a setting keeps it in the hypertable", () => {
    // `settings.battery.maximum_charge_current` is written by the automation
    // engine; the profile author says it is worth charting.
    const charted = { ...workmode, storage: "series" as const };
    const policy = createStoragePolicy({ metrics: defs([charted]) });
    const routed = policy.route(sample({ "settings.workmode": 0 }));
    expect(keysOf(routed.series)).toEqual(["settings.workmode"]);
    expect(routed.config).toEqual([]);
  });

  test("storage: none is persisted nowhere at all", () => {
    const ephemeral = { ...voltage, storage: "none" as const };
    const policy = createStoragePolicy({ metrics: defs([ephemeral]) });
    const routed = policy.route(sample({ "ac.l1.voltage": 230 }));
    expect(routed.series).toEqual([]);
    expect(routed.config).toEqual([]);
  });

  test("a metric the profile does not describe is stored as a series", () => {
    // Fail toward keeping data: an unknown key is a gap in the profile, and
    // silently dropping its history would hide that gap instead of showing it.
    const policy = createStoragePolicy({ metrics: defs([voltage]) });
    expect(keysOf(policy.route(sample({ "ac.l1.voltage": 1, mystery: 7 })).series)).toEqual([
      "ac.l1.voltage",
      "mystery",
    ]);
  });

  test("a non-finite reading is routed nowhere — absent is not a value", () => {
    const policy = createStoragePolicy({ metrics: defs([voltage, workmode]) });
    const routed = policy.route(
      sample({ "ac.l1.voltage": Number.NaN, "settings.workmode": Number.NaN }),
    );
    expect(routed.series).toEqual([]);
    expect(routed.config).toEqual([]);
  });

  test("exact zero and a negative value are routed, and are not confused with absent", () => {
    const policy = createStoragePolicy({ metrics: defs([voltage]) });
    expect(policy.route(sample({ "ac.l1.voltage": 0 })).series[0]?.value).toBe(0);
    expect(policy.route(sample({ "ac.l1.voltage": -5 }, at(3))).series[0]?.value).toBe(-5);
  });

  test("routing never drops a key from the live sample — only its persistence moves", () => {
    // The no-regression proof for the live WebSocket frame: the policy is a pure
    // function of the sample and returns rows; it must not mutate it.
    const policy = createStoragePolicy({ metrics: defs([voltage, workmode]) });
    const s = sample({ "ac.l1.voltage": 230, "settings.workmode": 1 });
    policy.route(s);
    expect(Object.keys(s.metrics)).toEqual(["ac.l1.voltage", "settings.workmode"]);
  });
});

// --- absent hardware (#114) -------------------------------------------------

const genPower = metric("ac/generator/a/power", {
  label: "Gen A",
  unit: "W",
  group: "generator",
  addr: 661,
  role: "generator.phase.power",
  index: 1,
});
const genTotal = metric("ac/generator/total_power", {
  label: "Gen total",
  unit: "W",
  group: "generator",
  addr: 667,
  role: "generator.power",
});

describe("the storage policy — absent hardware", () => {
  const generatorMetrics = () => defs([voltage, genPower, genTotal]);

  test("a profile with generator roles and a device answering constant 0 persists no generator rows", () => {
    const policy = createStoragePolicy({ metrics: generatorMetrics() });
    for (let i = 0; i < 5; i++) {
      const routed = policy.route(
        sample(
          { "ac.l1.voltage": 230, "ac.generator.a.power": 0, "ac.generator.total_power": 0 },
          at(i * 3),
        ),
      );
      expect(keysOf(routed.series)).toEqual(["ac.l1.voltage"]);
    }
  });

  test("a generator that starts producing is persisted from the first non-zero sample", () => {
    const policy = createStoragePolicy({ metrics: generatorMetrics() });
    policy.route(sample({ "ac.generator.a.power": 0, "ac.generator.total_power": 0 }));
    const first = policy.route(
      sample({ "ac.generator.a.power": 1200, "ac.generator.total_power": 1200 }, at(3)),
    );
    // The sample that proves the hardware exists is itself stored — not the one
    // after it.
    expect(keysOf(first.series)).toEqual(["ac.generator.a.power", "ac.generator.total_power"]);
  });

  test("once the hardware has answered, a genuine zero is still stored", () => {
    // The boundary that separates "absent" from "idle". Getting it wrong is the
    // failure mode: an idle generator's zeros are data.
    const policy = createStoragePolicy({ metrics: generatorMetrics() });
    policy.route(sample({ "ac.generator.total_power": 4000 }));
    const idle = policy.route(sample({ "ac.generator.total_power": 0 }, at(3)));
    expect(keysOf(idle.series)).toEqual(["ac.generator.total_power"]);
  });

  test("evidence from one metric of the subsystem admits the whole subsystem", () => {
    // The energy counter moves while the phase power reads 0 between bursts;
    // that is still proof the generator is wired up.
    const policy = createStoragePolicy({ metrics: generatorMetrics() });
    const routed = policy.route(
      sample({ "ac.generator.a.power": 0, "ac.generator.total_power": 900 }),
    );
    expect(keysOf(routed.series)).toEqual(["ac.generator.a.power", "ac.generator.total_power"]);
  });

  test("a subsystem that is not optional hardware is never suppressed", () => {
    // A PV string reads 0 every night. Suppressing it would make "0 W" and "we
    // were not running" indistinguishable in the history — the same conflation
    // the decode layer refuses one level down.
    const pv = metric("dc/pv1/power", {
      label: "PV1",
      unit: "W",
      group: "inverter",
      addr: 672,
      role: "pv.string.power",
      index: 1,
    });
    const policy = createStoragePolicy({ metrics: defs([pv]) });
    expect(keysOf(policy.route(sample({ "dc.pv1.power": 0 })).series)).toEqual(["dc.pv1.power"]);
  });

  test("a metric with no role is never suppressed as absent hardware", () => {
    const policy = createStoragePolicy({ metrics: defs([voltage]) });
    expect(keysOf(policy.route(sample({ "ac.l1.voltage": 0 })).series)).toEqual(["ac.l1.voltage"]);
  });

  test("the optional subsystems are injectable, so a second device class needs no edit here", () => {
    const policy = createStoragePolicy({ metrics: generatorMetrics(), optionalRoles: [] });
    expect(keysOf(policy.route(sample({ "ac.generator.total_power": 0 })).series)).toEqual([
      "ac.generator.total_power",
    ]);
  });
});
