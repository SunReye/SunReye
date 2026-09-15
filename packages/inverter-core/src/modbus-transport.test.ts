import { describe, expect, test } from "bun:test";

import {
  gapToleranceFor,
  ModbusTransport,
  planReads,
  probeAddressOf,
  splitBlock,
} from "./modbus-transport";
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

// --- gap-tolerant planning -------------------------------------------------
//
// Splitting on every gap is right when a round trip is cheap and wrong when it
// is not. These tests pin the tolerance's boundaries; the number itself, and the
// measurements that argue for it, live in `GAP_TOLERANCE`'s doc comment.

/** Minimal readable single-word metric at `addr`. */
const at = (key: string, addr: number): MetricDef =>
  skewed(key, { via: "modbus", addr: [addr], type: "U_WORD" }, []);

/** Minimal computed metric over `inputs` — only `computeInputs` reaches the planner. */
const over = (key: string, inputs: string[]): MetricDef =>
  ({
    ...skewed(key, { via: "compute", expr: { sum: inputs } }, []),
    computeInputs: inputs,
  }) as MetricDef;

describe("planReads gap tolerance", () => {
  test("tolerance 0 is today's plan exactly — every gap still splits", () => {
    const metrics = [at("a", 10), at("b", 11), at("c", 13), at("d", 200)];

    // A one-register gap at 12 is the smallest there is, and it still splits.
    const today = [
      { start: 10, count: 2 },
      { start: 13, count: 1 },
      { start: 200, count: 1 },
    ];
    expect(planReads(metrics, 0)).toEqual(today);
    // …and the default argument is that same plan, so every existing caller is
    // unchanged by the parameter existing at all.
    expect(planReads(metrics)).toEqual(today);
  });

  test("merges a gap smaller than the tolerance", () => {
    const metrics = [at("a", 100), at("b", 104)];

    expect(planReads(metrics, 4)).toEqual([{ start: 100, count: 5, merged: true }]);
  });

  test("merges a gap exactly at the tolerance", () => {
    // 101..105 unmapped: a gap of five, tolerance five.
    const metrics = [at("a", 100), at("b", 106)];

    expect(planReads(metrics, 5)).toEqual([{ start: 100, count: 7, merged: true }]);
  });

  test("does NOT merge a gap one register past the tolerance", () => {
    // The same five-register gap, now one past a tolerance of four.
    const metrics = [at("a", 100), at("b", 106)];

    expect(planReads(metrics, 4)).toEqual([
      { start: 100, count: 1 },
      { start: 106, count: 1 },
    ]);
  });

  test("does NOT merge when the merged block would exceed the 120-register cap", () => {
    // Span 100..230 is 131 registers; its 129-register gap is exactly at the
    // tolerance offered, so only the cap can be what refuses this merge — while
    // the 230..260 pair beside it still merges, proving the refusal is local to
    // the pair rather than turning merging off for the rest of the plan.
    const metrics = [at("a", 100), at("lo", 230), at("hi", 260)];

    expect(planReads(metrics, 129)).toEqual([
      { start: 100, count: 1 },
      { start: 230, count: 31, merged: true },
    ]);
  });

  test("keeps an atomic group in one transaction when a neighbour merges into it", () => {
    // 586 sits three registers below a 590..600 compute span. A merge always
    // swallows a neighbouring block whole, so the group's registers still share
    // one transaction — a block covering only PART of the span would re-read
    // those registers in a second transaction and silently un-sync the group.
    const metrics = [at("edge", 586), at("a", 590), at("b", 600), over("x", ["a", "b"])];

    expect(planReads(metrics, 32)).toEqual([
      { start: 586, count: 15, grouped: true, merged: true },
    ]);
  });

  test("a profile with a single metric plans one block, tolerance or not", () => {
    expect(planReads([at("only", 42)], 32)).toEqual([{ start: 42, count: 1 }]);
  });

  test("a profile with no modbus-bound metrics plans nothing to merge", () => {
    expect(planReads([over("x", ["nothing"])], 32)).toEqual([]);
    expect(planReads([], 32)).toEqual([]);
  });

  test("splitBlock un-merges at tolerance 0 — the fallback must not re-merge", () => {
    const metrics = [at("a", 100), at("b", 104)];

    expect(splitBlock({ start: 100, count: 5, merged: true }, metrics)).toEqual([
      { start: 100, count: 1 },
      { start: 104, count: 1 },
    ]);
  });
});

describe("gap tolerance per framing", () => {
  test("only the Solarman framing tolerates gaps", () => {
    expect(gapToleranceFor("tcp")).toBe(0);
    expect(gapToleranceFor("rtu-over-tcp")).toBe(0);
    expect(gapToleranceFor("solarman-v5")).toBeGreaterThan(0);
  });

  test("the measured deye-sg05lp3 plan collapses from 15 blocks to 3 over a stick", () => {
    // The real plan, measured against the stick at 10.20.0.63: 15 blocks /
    // 153 registers when split on every gap, 3 blocks / 227 registers merged —
    // and the merged one is 1.8x to 3x faster despite reading MORE registers.
    const spans: [number, number][] = [
      [98, 1],
      [108, 2],
      [128, 1],
      [130, 1],
      [142, 2],
      [145, 2],
      [148, 30],
      [500, 1],
      [514, 16],
      [534, 3],
      [540, 2],
      [552, 1],
      [586, 3],
      [590, 84],
      [676, 4],
    ];
    const metrics = spans.flatMap(([start, count], b) =>
      Array.from({ length: count }, (_, i) => at(`m${b}_${i}`, start + i)),
    );

    expect(planReads(metrics, 0)).toHaveLength(15);
    expect(planReads(metrics, gapToleranceFor("solarman-v5"))).toEqual([
      { start: 98, count: 80, merged: true },
      { start: 500, count: 53, merged: true },
      { start: 586, count: 94, merged: true },
    ]);
  });
});

describe("the register a unit-id scan asks for", () => {
  test("is the first one the profile plans to read", () => {
    // Not a fixed address: a scan that asked for register 0 or 3 would time out
    // against a device that answers perfectly, because the inverter ignores a
    // request for a register it does not map. Measured on a Deye behind a
    // Solarman stick — register 3 timed out on the unit id that reads 107
    // metrics, and the profile's own first planned register (98) answered in
    // 171 ms.
    const metrics = [at("b", 300), at("a", 98)];

    expect(probeAddressOf(profileOf(metrics))).toBe(98);
  });

  test("is undefined for a profile that maps no register at all", () => {
    // A push-only profile has nothing to ask for, so a scan cannot run at all —
    // the caller says that rather than probing a made-up address.
    expect(probeAddressOf(profileOf([over("derived", ["a"])]))).toBeUndefined();
  });
});
