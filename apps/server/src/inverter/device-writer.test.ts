import { describe, expect, test } from "bun:test";

import { type DeviceInstance, type DeviceMetric, deviceInstance } from "@SunReye/inverter-core";

import { createDeviceWriter } from "./device-writer";
import { createHistoryBuffer } from "./history-buffer";
import type { MetricRow } from "./history-buffer";
import type { StorageRow } from "./storage-policy";
import { createIdentifiedCommit, createRowIdentifier } from "./storage-identity";

const silent = { warn: () => {}, error: () => {} };

/** A device metric with everything but the exercised fields defaulted. */
function dm(overrides: Partial<DeviceMetric> & { key: string }): DeviceMetric {
  return { unit: null, group: "misc", access: "r", ...overrides };
}

function device(id: string, metrics: DeviceMetric[], integration = "profile"): DeviceInstance {
  return deviceInstance({ id, deviceClass: "inverter", integration, metrics });
}

/** A buffer that records what was enqueued instead of committing it. */
function recorder() {
  const rows: StorageRow[] = [];
  return { rows, enqueue: (batch: StorageRow[]) => void rows.push(...batch) };
}

function writerOver(series = recorder(), config = recorder(), registered: unknown[] = []) {
  const writer = createDeviceWriter({
    series,
    config,
    registerMetrics: (specs) => void registered.push(specs),
  });
  return { writer, series, config, registered };
}

const T0 = new Date("2026-08-30T10:00:00Z");
const T1 = new Date("2026-08-30T10:00:01Z");

describe("the write seam is callable for any registered device", () => {
  test("a sample is keyed by the device id, not by anything in the sample", () => {
    const { writer, series } = writerOver();
    const evcc = device("wallbox-1", [dm({ key: "power" })], "evcc");

    // No poll loop, no Modbus endpoint, no profile: a caller with a sample and
    // an instance is all this path needs — which is exactly what #88 and #172
    // have.
    writer.commit(evcc, { time: T0, metrics: { power: 1400 } });
    writer.commit(evcc, { time: T1, metrics: { power: 2000 } });

    expect(series.rows).toEqual([
      { inverterId: "wallbox-1", metric: "power", time: T0, value: 1400, durMs: 1000 },
    ]);
  });

  test("a second device's rows carry its own id, alongside the first's", () => {
    const { writer, series } = writerOver();
    const one = device("inverter-1", [dm({ key: "pv" })]);
    const two = device("inverter-2", [dm({ key: "pv" })]);

    writer.commit(one, { time: T0, metrics: { pv: 100 } });
    writer.commit(two, { time: T0, metrics: { pv: 900 } });
    writer.close(T1);

    expect(series.rows.map((r) => [r.inverterId, r.value])).toEqual([
      ["inverter-1", 100],
      ["inverter-2", 900],
    ]);
  });

  test("storage classes come from the device's OWN declaration", () => {
    const { writer, series, config } = writerOver();
    // The same metric key, classified differently by two devices: one declares
    // it a writable setting (change-log), the other a plain measurement.
    const settingDevice = device("inverter-1", [dm({ key: "limit", access: "rw" })]);
    const seriesDevice = device("inverter-2", [dm({ key: "limit" })]);

    writer.commit(settingDevice, { time: T0, metrics: { limit: 50 } });
    writer.commit(seriesDevice, { time: T0, metrics: { limit: 50 } });
    writer.close(T1);

    expect(config.rows).toEqual([
      { inverterId: "inverter-1", metric: "limit", time: T0, value: 50 },
    ]);
    expect(series.rows.map((r) => r.inverterId)).toEqual(["inverter-2"]);
  });

  test("a metric declared as stored nowhere is stored nowhere", () => {
    const { writer, series, config } = writerOver();
    writer.commit(device("inverter-1", [dm({ key: "noise", storage: "none" })]), {
      time: T0,
      metrics: { noise: 7 },
    });
    writer.close(T1);
    expect(series.rows).toEqual([]);
    expect(config.rows).toEqual([]);
  });

  test("a device with no declarations at all still stores what it reports", () => {
    // Failing toward keeping data: an undeclared key shows the gap, a dropped
    // one hides it. The device whose profile is not installed is this case.
    const { writer, series } = writerOver();
    writer.commit(device("inverter-1", []), { time: T0, metrics: { surprise: 3 } });
    writer.close(T1);
    expect(series.rows.map((r) => r.metric)).toEqual(["surprise"]);
  });

  test("a string timestamp is a time, not a string", () => {
    const { writer, series } = writerOver();
    writer.commit(device("inverter-1", [dm({ key: "pv" })]), {
      time: T0.toISOString(),
      metrics: { pv: 1 },
    });
    writer.close(T1);
    expect(series.rows[0]?.time).toEqual(T0);
  });

  test("every device's metric keys are registered once, from its own list", () => {
    const registered: unknown[] = [];
    const { writer } = writerOver(recorder(), recorder(), registered);
    const one = device("inverter-1", [dm({ key: "pv", unit: "W" })]);
    const two = device("inverter-2", [dm({ key: "soc", unit: "%" })]);

    writer.commit(one, { time: T0, metrics: { pv: 1 } });
    writer.commit(one, { time: T1, metrics: { pv: 2 } });
    writer.commit(two, { time: T0, metrics: { soc: 50 } });

    expect(registered).toEqual([
      [{ key: "pv", isCounter: false, unit: "W" }],
      [{ key: "soc", isCounter: false, unit: "%" }],
    ]);
  });

  test("a re-registered device rebuilds its policy, closing what it held open", () => {
    const { writer, series } = writerOver();
    writer.commit(device("inverter-1", [dm({ key: "pv" })]), { time: T0, metrics: { pv: 100 } });
    // The profile changed under a running server: a NEW instance for the same
    // id. The open interval belongs to the outgoing declaration and is written
    // rather than dropped — on a restart loop, dropping it is every metric,
    // every time.
    writer.commit(device("inverter-1", [dm({ key: "pv", storage: "none" })]), {
      time: T1,
      metrics: { pv: 100 },
    });

    expect(series.rows).toEqual([
      { inverterId: "inverter-1", metric: "pv", time: T0, value: 100, durMs: 1000 },
    ]);
  });

  test("a re-registration that changes NOTHING keeps the policy's memory", () => {
    // The registry mints a brand-new `DeviceInstance` for every row on every
    // `reload()`, and `reload()` runs on every inverter-connection PUT. So an
    // ordinary settings save hands this writer a different OBJECT declaring the
    // identical thing — which must not be read as "the device changed".
    //
    // Two pieces of policy state are not reconstructible, and both are silent
    // when they are lost: the change-log's last-value memory (a first
    // observation is a change, so a rebuilt policy writes a phantom "changed"
    // row carrying an unchanged value into a five-year history the UI renders
    // as events) and the optional-hardware evidence set (a rebuilt policy has
    // seen no proof a generator exists, so its real readings are dropped until
    // a non-zero one arrives).
    const { writer, series, config } = writerOver();
    const declared = [
      dm({ key: "settings.limit", access: "rw" }),
      dm({ key: "generator.power", role: "generator.power" }),
    ];
    writer.commit(device("inverter-1", declared), {
      time: T0,
      metrics: { "settings.limit": 50, "generator.power": 300 },
    });
    // The same declarations, deep-copied: a settings save, not a profile swap.
    const again = device(
      "inverter-1",
      declared.map((m) => ({ ...m })),
    );
    writer.commit(again, {
      time: T1,
      metrics: { "settings.limit": 50, "generator.power": 0 },
    });
    writer.close(new Date("2026-08-30T10:00:02Z"));

    // The unchanged setting is not an event.
    expect(config.rows).toEqual([
      { inverterId: "inverter-1", metric: "settings.limit", time: T0, value: 50 },
    ]);
    // The generator proved it exists at T0; its 0 at T1 is a reading, not an
    // absence, and the interval it closes is history.
    expect(series.rows).toEqual([
      { inverterId: "inverter-1", metric: "generator.power", time: T0, value: 300, durMs: 1000 },
      { inverterId: "inverter-1", metric: "generator.power", time: T1, value: 0, durMs: 1000 },
    ]);
  });

  test("a re-registration that changes a declaration rebuilds the policy", () => {
    // The other direction: when the device genuinely re-declares a metric, the
    // policy MUST be rebuilt, and the outgoing declaration's open interval
    // written out under the policy that opened it.
    const { writer, series, config } = writerOver();
    writer.commit(device("inverter-1", [dm({ key: "pv" })]), { time: T0, metrics: { pv: 100 } });
    writer.commit(device("inverter-1", [dm({ key: "pv", access: "rw" })]), {
      time: T1,
      metrics: { pv: 100 },
    });

    expect(series.rows).toEqual([
      { inverterId: "inverter-1", metric: "pv", time: T0, value: 100, durMs: 1000 },
    ]);
    // The incoming declaration is in force: the same key is now a setting.
    expect(config.rows).toEqual([{ inverterId: "inverter-1", metric: "pv", time: T1, value: 100 }]);
  });

  test("forgetting a device closes its intervals and stops keying rows to it", () => {
    const { writer, series } = writerOver();
    const gone = device("inverter-2", [dm({ key: "pv" })]);
    writer.commit(gone, { time: T0, metrics: { pv: 5 } });
    writer.forget("inverter-2");
    expect(series.rows.map((r) => r.value)).toEqual([5]);
    // A second close must not re-emit the retired device's interval.
    writer.close(T1);
    expect(series.rows.length).toBe(1);
  });
});

describe("a committed sample reaches metrics_raw under the device's id", () => {
  test("the whole seam: instance -> policy -> identity -> insert", async () => {
    const inserted: MetricRow[] = [];
    // The real identity boundary, over a resolver that knows two devices.
    const identify = createRowIdentifier({
      resolver: {
        deviceId: async (source) => ({ "inverter-1": 1, optimizer: 7 })[source] ?? null,
        metricIds: async (keys) => new Map(keys.map((k, i) => [k, i + 1])),
      },
      logger: silent,
    });
    const commit = createIdentifiedCommit({
      identify: identify.identify,
      insert: async (rows) => void inserted.push(...rows),
    });
    const raw = createHistoryBuffer<StorageRow>({ commit, logger: silent });
    const configLog = createHistoryBuffer<StorageRow>({ commit: async () => {}, logger: silent });
    const writer = createDeviceWriter({ series: raw, config: configLog });

    // A registered device with no Modbus endpoint whatsoever — the optimizer's
    // shape (#172), and the case the poll loop can never serve.
    const optimizer = deviceInstance({
      id: "optimizer",
      deviceClass: "optimizer",
      integration: "optimizer",
      metrics: [dm({ key: "decision.target", unit: "A" })],
    });
    writer.commit(optimizer, { time: T0, metrics: { "decision.target": 16 } });
    writer.close(T1);
    await raw.flush();

    expect(inserted).toEqual([{ time: T0, deviceId: 7, metricId: 1, value: 16, durMs: 1000 }]);
  });
});
