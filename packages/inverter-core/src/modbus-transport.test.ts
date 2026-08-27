import { describe, expect, test } from "bun:test";

import { ModbusTransport, planReads, splitBlock } from "./modbus-transport";
import type { DeviceTransport, InverterConnection, InverterProfile, MetricDef } from "./types";

const connection: InverterConnection = { host: "10.0.0.5", port: 502, unitId: 1 };

const profileOf = (metrics: MetricDef[]): InverterProfile => ({
  id: "test-inverter",
  name: "Test Inverter",
  manufacturer: "Test",
  metrics,
});

/**
 * A metric whose deprecated `type`/`addresses` mirror deliberately DISAGREES
 * with its binding. Nothing hydrated ever looks like this — it exists so a test
 * can tell which of the two the planner actually reads.
 */
const skewed = (key: string, binding: MetricDef["binding"], mirror: number[]): MetricDef =>
  ({
    key,
    topic: key,
    label: key,
    unit: null,
    group: "test",
    binding,
    type: "U_WORD",
    addresses: mirror,
    scale: 1,
    access: "r",
  }) as MetricDef;

describe("ModbusTransport as a DeviceTransport", () => {
  test("names itself and declares a pollable, writable device", () => {
    const t: DeviceTransport = new ModbusTransport(profileOf([]), connection);

    expect(t.kind).toBe("modbus");
    expect(t.caps).toEqual({ canWrite: true, pushBased: false });
  });
});

describe("read planning addresses through the binding", () => {
  test("plans the binding's addresses, not the deprecated mirror's", () => {
    const metrics = [skewed("a", { via: "modbus", addr: [100], type: "U_WORD" }, [999])];

    expect(planReads(metrics)).toEqual([{ start: 100, count: 1 }]);
  });

  test("a U_DWORD binding contributes both of its words", () => {
    const metrics = [skewed("wide", { via: "modbus", addr: [500, 501], type: "U_DWORD" }, [])];

    expect(planReads(metrics)).toEqual([{ start: 500, count: 2 }]);
  });

  test("a RAW binding is never put on the wire", () => {
    const metrics = [
      skewed("system.time", { via: "modbus", addr: [100, 101, 102], type: "RAW" }, [100]),
      skewed("b", { via: "modbus", addr: [200], type: "U_WORD" }, [200]),
    ];

    expect(planReads(metrics)).toEqual([{ start: 200, count: 1 }]);
  });

  test("compute and control bindings own no register at all", () => {
    const metrics = [
      skewed("derived", { via: "compute", expr: { sum: ["a"] } }, [700]),
      skewed(
        "hold",
        { via: "control", expr: { snapshotToggle: { target: "a", lockedValue: 50 } } },
        [800],
      ),
      skewed("a", { via: "modbus", addr: [100], type: "U_WORD" }, [100]),
    ];

    expect(planReads(metrics)).toEqual([{ start: 100, count: 1 }]);
  });

  test("splitBlock re-plans a span from the bindings it covers", () => {
    const metrics = [
      skewed("a", { via: "modbus", addr: [590], type: "U_WORD" }, [999]),
      skewed("b", { via: "modbus", addr: [592], type: "U_WORD" }, [999]),
    ];

    expect(splitBlock({ start: 590, count: 11, grouped: true }, metrics)).toEqual([
      { start: 590, count: 1 },
      { start: 592, count: 1 },
    ]);
  });
});
