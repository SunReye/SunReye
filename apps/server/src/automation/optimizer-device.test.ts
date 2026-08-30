import { describe, expect, test } from "bun:test";
import { ROLE_CATALOG, resolveDeadband, resolveStorage } from "@SunReye/inverter-core";
import type { PeakShavingStatus } from "@SunReye/contracts/automation";

import {
  OPTIMIZER_DEVICE_ID,
  OPTIMIZER_INTEGRATION,
  OPTIMIZER_METRICS,
  OPTIMIZER_PRICE_REGIMES,
  OPTIMIZER_PROFILE,
  OPTIMIZER_RUN_STATES,
  optimizerDeviceSpec,
  optimizerSample,
} from "./optimizer-device";
import { initialStatus } from "./peak-shaving-engine";

const AT = new Date("2026-03-04T10:00:00.000Z");

/** A steering tick's status, with everything the optimizer can decide filled in. */
function decided(overrides: Partial<PeakShavingStatus> = {}): PeakShavingStatus {
  return {
    ...initialStatus(),
    enabled: true,
    mode: "grid-friendly",
    state: "active",
    targetA: 42,
    lastWrittenA: 40,
    liveA: 40,
    thresholdW: 6100,
    sellLimitW: 5900,
    gridChargeA: 12,
    liveExcessW: 2300,
    headroomKwh: 4.25,
    remainingAboveLimitKwh: 1.5,
    evDemandKwh: 7.5,
    externalOverride: false,
    ineffective: false,
    restorePending: true,
    priceRegime: "pre-shape",
    socEnvelopePct: 62,
    soakableKwh: 3.75,
    unavoidableZeroValueKwh: 0.5,
    ...overrides,
  };
}

describe("the optimizer's device declaration", () => {
  test("every metric names an optimizer role, and the key IS the role", () => {
    for (const metric of OPTIMIZER_METRICS) {
      expect(metric.role).toBe(metric.key as never);
      const spec = ROLE_CATALOG[metric.role as keyof typeof ROLE_CATALOG] as
        | { deviceClass?: string }
        | undefined;
      expect(spec).toBeDefined();
      expect(spec?.deviceClass).toBe("optimizer");
    }
  });

  test("nothing it declares is writable — the optimizer reports, it does not take orders", () => {
    expect(OPTIMIZER_METRICS.every((m) => m.access === "r")).toBe(true);
  });

  test("the operator's own settings are a change-log; the decisions are a series", () => {
    const config = OPTIMIZER_METRICS.filter((m) => resolveStorage(m) === "config").map(
      (m) => m.key,
    );
    expect(config).toEqual(["optimizer.enabled", "optimizer.mode", "optimizer.restore.pending"]);
    expect(OPTIMIZER_METRICS.some((m) => resolveStorage(m) === "none")).toBe(false);
  });

  test("an enum output carries no deadband — a transition may never be swallowed", () => {
    const statuses = OPTIMIZER_METRICS.filter((m) => m.kind === "status");
    expect(statuses.length).toBeGreaterThan(0);
    for (const metric of statuses) expect(resolveDeadband(metric)).toBeUndefined();
  });

  test("the continuous decisions carry a deadband, in their own unit", () => {
    const byKey = new Map(OPTIMIZER_METRICS.map((m) => [m.key, m]));
    expect(resolveDeadband(byKey.get("optimizer.target.current")!)).toBe(0.5);
    expect(resolveDeadband(byKey.get("optimizer.threshold.power")!)).toBe(25);
  });
});

describe("the optimizer's `devices` row", () => {
  test("is endpoint-less and classed as an optimizer", () => {
    expect(optimizerDeviceSpec(7)).toEqual({
      plantId: 7,
      connectionId: null,
      unitId: 0,
      slug: OPTIMIZER_DEVICE_ID,
      name: "Optimizer",
      profileId: OPTIMIZER_PROFILE,
      role: "optimizer",
    });
    expect(OPTIMIZER_INTEGRATION).toBe("optimizer");
  });
});

describe("one decision, as one sample", () => {
  test("the decision's numbers travel under the declared keys", () => {
    const sample = optimizerSample(decided(), 1800, AT);
    expect(sample.time).toBe(AT);
    expect(sample.metrics).toEqual({
      "optimizer.enabled": 1,
      "optimizer.mode": 1,
      "optimizer.state": OPTIMIZER_RUN_STATES.indexOf("active"),
      "optimizer.price.regime": OPTIMIZER_PRICE_REGIMES.indexOf("pre-shape"),
      "optimizer.target.current": 42,
      "optimizer.applied.current": 40,
      "optimizer.threshold.power": 6100,
      "optimizer.excess.power": 2300,
      "optimizer.local.sink.power": 1800,
      "optimizer.headroom.energy": 4.25,
      "optimizer.surplus.energy": 1.5,
      "optimizer.soc.envelope": 62,
      "optimizer.soakable.energy": 3.75,
      "optimizer.unavoidable.energy": 0.5,
      "optimizer.ev.demand.energy": 7.5,
      "optimizer.sell.limit.power": 5900,
      "optimizer.grid.charge.current": 12,
      "optimizer.override": 0,
      "optimizer.ineffective": 0,
      "optimizer.restore.pending": 1,
    });
  });

  test("every key it emits is one it declared", () => {
    const declared = new Set(OPTIMIZER_METRICS.map((m) => m.key));
    for (const key of Object.keys(optimizerSample(decided(), 0, AT).metrics)) {
      expect(declared.has(key)).toBe(true);
    }
  });

  test("absent is absent — a null envelope is omitted, and a measured zero is kept", () => {
    const sample = optimizerSample(
      decided({
        socEnvelopePct: null,
        soakableKwh: null,
        unavoidableZeroValueKwh: null,
        evDemandKwh: null,
        sellLimitW: null,
        gridChargeA: null,
        lastWrittenA: null,
        liveExcessW: 0,
        headroomKwh: 0,
      }),
      0,
      AT,
    );
    for (const absent of [
      "optimizer.soc.envelope",
      "optimizer.soakable.energy",
      "optimizer.unavoidable.energy",
      "optimizer.ev.demand.energy",
      "optimizer.sell.limit.power",
      "optimizer.grid.charge.current",
      "optimizer.applied.current",
    ]) {
      expect(sample.metrics[absent]).toBeUndefined();
    }
    // A zero the plant actually measured is a reading, not a gap.
    expect(sample.metrics["optimizer.excess.power"]).toBe(0);
    expect(sample.metrics["optimizer.headroom.energy"]).toBe(0);
    expect(sample.metrics["optimizer.local.sink.power"]).toBe(0);
  });

  test("a tick that decided nothing emits its state and nothing numeric", () => {
    const sample = optimizerSample(initialStatus(), 0, AT);
    expect(sample.metrics["optimizer.state"]).toBe(OPTIMIZER_RUN_STATES.indexOf("disabled"));
    expect(sample.metrics["optimizer.target.current"]).toBeUndefined();
    expect(sample.metrics["optimizer.threshold.power"]).toBeUndefined();
  });

  test("the two enum vocabularies are frozen — a reordering re-labels five years of rows", () => {
    expect([...OPTIMIZER_RUN_STATES]).toEqual([
      "disabled",
      "blocked",
      "idle",
      "active",
      "shadow",
      "simulating",
      "stale",
    ]);
    expect([...OPTIMIZER_PRICE_REGIMES]).toEqual([
      "none",
      "waiting",
      "pre-shape",
      "spend-down",
      "absorb",
    ]);
  });
});
