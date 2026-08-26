import { describe, expect, test } from "bun:test";

import { metric, type MetricDataDef, hydrateProfile } from "@SunReye/inverter-core";
import type { MetricDef } from "@SunReye/inverter-core";

import { createStoragePolicy, type RoutedSample } from "./storage-policy";

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

/**
 * Route every sample, then close — the *completed* picture of what one poll
 * window persisted.
 *
 * Closing is not test scaffolding: a series row is an interval, so it is written
 * when the interval ends, and the runtime closes the open ones before a source
 * swap and at shutdown for exactly this reason. A test that only routes sees the
 * config rows and none of the series ones, which is the same view a reader has
 * mid-window and not the one that describes stored history.
 */
function routed(
  policy: ReturnType<typeof createStoragePolicy>,
  samples: ReturnType<typeof sample>[],
  closeAtMs = 60_000,
): RoutedSample {
  const series: RoutedSample["series"] = [];
  const config: RoutedSample["config"] = [];
  for (const s of samples) {
    const r = policy.route(s);
    series.push(...r.series);
    config.push(...r.config);
  }
  series.push(...policy.close(new Date(at(closeAtMs))));
  return { series, config };
}

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
    const r = routed(policy, [sample({ "ac.l1.voltage": 230, "timeofuse.1.power": 3000 })]);
    expect(keysOf(r.series)).toEqual(["ac.l1.voltage"]);
    expect(keysOf(r.config)).toEqual(["timeofuse.1.power"]);
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

  test("a config row carries no duration — the next row is when it changed again", () => {
    const policy = createStoragePolicy({ metrics: defs([workmode]) });
    const [row] = policy.route(sample({ "settings.workmode": 0 })).config;
    expect(row).not.toHaveProperty("durMs");
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
    const r = routed(policy, [sample({ "settings.workmode": 0 })]);
    expect(keysOf(r.series)).toEqual(["settings.workmode"]);
    expect(r.config).toEqual([]);
  });

  test("storage: none is persisted nowhere at all", () => {
    const ephemeral = { ...voltage, storage: "none" as const };
    const policy = createStoragePolicy({ metrics: defs([ephemeral]) });
    const r = routed(policy, [sample({ "ac.l1.voltage": 230 })]);
    expect(r.series).toEqual([]);
    expect(r.config).toEqual([]);
  });

  test("a metric the profile does not describe is stored as a series", () => {
    // Fail toward keeping data: an unknown key is a gap in the profile, and
    // silently dropping its history would hide that gap instead of showing it.
    const policy = createStoragePolicy({ metrics: defs([voltage]) });
    const r = routed(policy, [sample({ "ac.l1.voltage": 1, mystery: 7 })]);
    expect(keysOf(r.series).sort()).toEqual(["ac.l1.voltage", "mystery"]);
  });

  test("a non-finite reading is routed nowhere — absent is not a value", () => {
    const policy = createStoragePolicy({ metrics: defs([voltage, workmode]) });
    const r = routed(policy, [
      sample({ "ac.l1.voltage": Number.NaN, "settings.workmode": Number.NaN }),
    ]);
    expect(r.series).toEqual([]);
    expect(r.config).toEqual([]);
  });

  test("exact zero and a negative value are routed, and are not confused with absent", () => {
    const policy = createStoragePolicy({ metrics: defs([voltage]) });
    const r = routed(policy, [
      sample({ "ac.l1.voltage": 0 }),
      sample({ "ac.l1.voltage": -5 }, at(3)),
    ]);
    expect(r.series.map((row) => row.value)).toEqual([0, -5]);
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

// --- change-only series (#117) ---------------------------------------------

describe("the storage policy — change-encoded series", () => {
  const noisy = { ...voltage, deadband: 1 };

  test("an unchanged reading writes no row, however many times it is polled", () => {
    // 69.8 % of every row written was a byte-identical repeat of its
    // predecessor. This is that 69.8 %.
    const policy = createStoragePolicy({ metrics: defs([voltage]) });
    const r = routed(
      policy,
      Array.from({ length: 20 }, (_, i) => sample({ "ac.l1.voltage": 230 }, at(i * 3000))),
    );
    expect(r.series).toHaveLength(1);
    // One interval for the whole minute: 20 polls in, one row out. The duration
    // is the full bucket because the close lands on its boundary.
    expect(r.series[0]).toMatchObject({ value: 230, durMs: 60_000 });
  });

  test("a series row carries the duration its value was held", () => {
    const policy = createStoragePolicy({ metrics: defs([voltage]) });
    const r = routed(policy, [
      sample({ "ac.l1.voltage": 230 }),
      sample({ "ac.l1.voltage": 231 }, at(6000)),
    ]);
    expect(r.series[0]).toEqual({
      time: new Date(at(0)),
      inverterId: "plant-1",
      metric: "ac.l1.voltage",
      value: 230,
      durMs: 6000,
    });
  });

  test("an authored deadband filters a smaller change and keeps one at the threshold", () => {
    const policy = createStoragePolicy({ metrics: defs([noisy]) });
    const r = routed(policy, [
      sample({ "ac.l1.voltage": 230 }),
      sample({ "ac.l1.voltage": 230.5 }, at(3000)), // inside the band
      sample({ "ac.l1.voltage": 231 }, at(6000)), // exactly the threshold
    ]);
    expect(r.series.map((row) => row.value)).toEqual([230, 231]);
  });

  test("a counter is never deadbanded, so a restart is stored", () => {
    // The deadband resolver refuses one on a cumulative metric; this proves the
    // policy asks it rather than applying a global rule.
    const counter = metric("ac/total_energy", {
      label: "Total",
      unit: "kWh",
      group: "grid",
      addr: 100,
      scale: 0.1,
    });
    const policy = createStoragePolicy({ metrics: defs([counter]) });
    const r = routed(policy, [
      sample({ "ac.total_energy": 11_000 }),
      sample({ "ac.total_energy": 0 }, at(3000)),
    ]);
    expect(r.series.map((row) => row.value)).toEqual([11_000, 0]);
  });

  test("closing twice does not write the same interval twice", () => {
    const policy = createStoragePolicy({ metrics: defs([voltage]) });
    policy.route(sample({ "ac.l1.voltage": 230 }));
    expect(policy.close(new Date(at(3000)))).toHaveLength(1);
    expect(policy.close(new Date(at(6000)))).toEqual([]);
  });

  test("a suppressed absent-hardware metric opens no interval to flush later", () => {
    const policy = createStoragePolicy({ metrics: generatorMetrics() });
    routed(policy, [sample({ "ac.generator.total_power": 0 })]);
    expect(policy.close(new Date(at(90_000)))).toEqual([]);
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

const generatorMetrics = () => defs([voltage, genPower, genTotal]);

describe("the storage policy — absent hardware", () => {
  test("a profile with generator roles and a device answering constant 0 persists no generator rows", () => {
    const policy = createStoragePolicy({ metrics: generatorMetrics() });
    const r = routed(
      policy,
      Array.from({ length: 5 }, (_, i) =>
        sample(
          { "ac.l1.voltage": 230, "ac.generator.a.power": 0, "ac.generator.total_power": 0 },
          at(i * 3000),
        ),
      ),
    );
    expect(keysOf(r.series)).toEqual(["ac.l1.voltage"]);
  });

  test("a generator that starts producing is persisted from the first non-zero sample", () => {
    const policy = createStoragePolicy({ metrics: generatorMetrics() });
    const r = routed(policy, [
      sample({ "ac.generator.a.power": 0, "ac.generator.total_power": 0 }),
      sample({ "ac.generator.a.power": 1200, "ac.generator.total_power": 1200 }, at(3000)),
    ]);
    // The sample that proves the hardware exists is itself the start of the
    // stored interval — not the one after it.
    expect(r.series.map((row) => [row.metric, row.value, row.time.toISOString()])).toEqual([
      ["ac.generator.a.power", 1200, at(3000)],
      ["ac.generator.total_power", 1200, at(3000)],
    ]);
  });

  test("once the hardware has answered, a genuine zero is still stored", () => {
    // The boundary that separates "absent" from "idle". Getting it wrong is the
    // failure mode: an idle generator's zeros are data.
    const policy = createStoragePolicy({ metrics: generatorMetrics() });
    const r = routed(policy, [
      sample({ "ac.generator.total_power": 4000 }),
      sample({ "ac.generator.total_power": 0 }, at(3000)),
    ]);
    expect(r.series.map((row) => row.value)).toEqual([4000, 0]);
  });

  test("evidence from one metric of the subsystem admits the whole subsystem", () => {
    // The energy counter moves while the phase power reads 0 between bursts;
    // that is still proof the generator is wired up.
    const policy = createStoragePolicy({ metrics: generatorMetrics() });
    const r = routed(policy, [
      sample({ "ac.generator.a.power": 0, "ac.generator.total_power": 900 }),
    ]);
    expect(keysOf(r.series).sort()).toEqual(["ac.generator.a.power", "ac.generator.total_power"]);
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
    expect(keysOf(routed(policy, [sample({ "dc.pv1.power": 0 })]).series)).toEqual([
      "dc.pv1.power",
    ]);
  });

  test("a metric with no role is never suppressed as absent hardware", () => {
    const policy = createStoragePolicy({ metrics: defs([voltage]) });
    expect(keysOf(routed(policy, [sample({ "ac.l1.voltage": 0 })]).series)).toEqual([
      "ac.l1.voltage",
    ]);
  });

  test("the optional subsystems are injectable, so a second device class needs no edit here", () => {
    const policy = createStoragePolicy({ metrics: generatorMetrics(), optionalRoles: [] });
    expect(keysOf(routed(policy, [sample({ "ac.generator.total_power": 0 })]).series)).toEqual([
      "ac.generator.total_power",
    ]);
  });
});
