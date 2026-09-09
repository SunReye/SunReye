import { describe, expect, test } from "bun:test";
import type { DeviceInstance } from "@SunReye/inverter-core";
import type { PeakShavingStatus } from "@SunReye/contracts/automation";

import type { DeviceSample } from "../inverter/device-writer";
import { OPTIMIZER_DEVICE_ID } from "./optimizer-device";
import { type DeviceRowState, createOptimizerRegistrar } from "./optimizer-registrar";
import { initialStatus } from "./peak-shaving-engine";

const T0 = new Date("2026-04-01T09:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const instance = { id: OPTIMIZER_DEVICE_ID } as DeviceInstance;

function decided(overrides: Partial<PeakShavingStatus> = {}): PeakShavingStatus {
  return { ...initialStatus(), state: "active", targetA: 30, thresholdW: 5000, ...overrides };
}

/** A registrar over doubles, with knobs for every answer the table can give. */
function harness(
  options: {
    rowState?: () => DeviceRowState;
    ensureThrows?: () => boolean;
    resolves?: () => boolean;
  } = {},
) {
  const ensures: number[] = [];
  const commits: { device: DeviceInstance; sample: DeviceSample }[] = [];
  const warnings: string[] = [];
  let reloads = 0;
  let resolved = false;
  const registrar = createOptimizerRegistrar({
    async ensureDevice() {
      ensures.push(ensures.length);
      if (options.ensureThrows?.()) throw new Error("no plant table");
      const state = options.rowState?.() ?? "ready";
      if (state === "ready" && (options.resolves?.() ?? true)) resolved = true;
      return state;
    },
    reloadRegistry: async () => void (reloads += 1),
    device: () => (resolved ? instance : undefined),
    commit: (device, sample) => void commits.push({ device, sample }),
    logger: { warn: (template) => void warnings.push(template) },
  });
  return { registrar, ensures, commits, warnings, reloads: () => reloads };
}

describe("the optimizer's decisions reach the write seam", () => {
  test("the very first decision is stored — the row is ensured before the commit", async () => {
    const h = harness();
    await h.registrar.record(decided(), 1200, at(0));
    expect(h.ensures).toHaveLength(1);
    expect(h.reloads()).toBe(1);
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]?.device.id).toBe(OPTIMIZER_DEVICE_ID);
    expect(h.commits[0]?.sample.metrics["optimizer.target.current"]).toBe(30);
    expect(h.commits[0]?.sample.time).toEqual(at(0));
  });

  test("a registered optimizer never touches the device table again", async () => {
    const h = harness();
    for (let i = 0; i < 10; i++) await h.registrar.record(decided(), 0, at(i));
    // One ensure, one reload — for ten ticks. At 30 s that is 2 880 device-table
    // reads a day avoided, which is the whole reason the attempt is remembered.
    expect(h.ensures).toHaveLength(1);
    expect(h.reloads()).toBe(1);
    expect(h.commits).toHaveLength(10);
  });

  test("an onboarding-only boot has no plant: nothing is stored, and it retries later", async () => {
    let plant = false;
    const h = harness({ rowState: () => (plant ? "ready" : "absent") });
    await h.registrar.record(decided(), 0, at(0));
    expect(h.commits).toHaveLength(0);
    // Inside the retry interval nothing is asked again.
    await h.registrar.record(decided(), 0, at(1));
    expect(h.ensures).toHaveLength(1);
    // The operator finishes onboarding; the next retry picks the plant up.
    plant = true;
    await h.registrar.record(decided(), 0, at(10));
    expect(h.ensures).toHaveLength(2);
    expect(h.commits).toHaveLength(1);
  });

  test("a retired optimizer is said out loud once, and is not re-read for", async () => {
    const h = harness({ rowState: () => "retired" });
    for (let i = 0; i < 3; i++) await h.registrar.record(decided(), 0, at(i * 10));
    // Three ensures (one per retry interval) but never a reload: the roster read
    // excludes retired rows, so re-reading it could not change the answer.
    expect(h.reloads()).toBe(0);
    expect(h.commits).toHaveLength(0);
    expect(h.warnings).toHaveLength(1);
  });

  test("a row that exists but never resolves is reported once, not per tick", async () => {
    const h = harness({ resolves: () => false });
    for (let i = 0; i < 3; i++) await h.registrar.record(decided(), 0, at(i * 10));
    expect(h.commits).toHaveLength(0);
    expect(h.warnings).toHaveLength(1);
  });

  test("a failing device table never stops the loop, and is reported once", async () => {
    let broken = true;
    const h = harness({ ensureThrows: () => broken });
    await h.registrar.record(decided(), 0, at(0));
    await h.registrar.record(decided(), 0, at(10));
    expect(h.warnings).toHaveLength(1);
    expect(h.commits).toHaveLength(0);
    // A failure that heals must be re-reportable, so the latch clears on success.
    broken = false;
    await h.registrar.record(decided(), 0, at(20));
    expect(h.commits).toHaveLength(1);
  });

  test("a device table that THROWS waits out the retry interval like any other failure", async () => {
    // The retry gate is what this module exists for, and a THROW is the state it
    // was skipping: recording the attempt only when `ensureDevice` RESOLVED left
    // `attempt` null on the path where the database is unreachable, so the row
    // was ensured on every 30 s tick — 2 880 failing round trips a day against a
    // database already in trouble, which is the exact cadence the header says
    // this was born to prevent.
    let broken = true;
    const h = harness({ ensureThrows: () => broken });
    // Twenty ticks at the engine's real 30 s cadence: ten minutes of them.
    for (let i = 0; i < 20; i++) await h.registrar.record(decided(), 0, at(i * 0.5));
    expect(h.ensures).toHaveLength(1);
    expect(h.commits).toHaveLength(0);
    expect(h.warnings).toHaveLength(1);

    // Past the interval it is retried — a database that comes back must heal
    // without a restart.
    broken = false;
    await h.registrar.record(decided(), 0, at(10.5));
    expect(h.ensures).toHaveLength(2);
    expect(h.commits).toHaveLength(1);
  });

  test("suspend forgets the registration without retiring the device", async () => {
    const h = harness();
    await h.registrar.record(decided(), 0, at(0));
    h.registrar.suspend();
    await h.registrar.record(decided(), 0, at(1));
    // Re-ensured immediately: the retry cadence is for a device that FAILED, and
    // a stopped engine is not a failure.
    expect(h.ensures).toHaveLength(2);
    expect(h.commits).toHaveLength(2);
  });

  test("two overlapping records do not both register", async () => {
    const h = harness();
    await Promise.all([
      h.registrar.record(decided(), 0, at(0)),
      h.registrar.record(decided(), 0, at(0)),
    ]);
    expect(h.ensures).toHaveLength(1);
  });
});
