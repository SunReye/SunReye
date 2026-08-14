import { describe, expect, test } from "bun:test";

import { control, metric } from "@SunReye/inverter-core";
import type { InverterProfile, InverterSample } from "@SunReye/inverter-core";

import {
  type ControlIO,
  type ControlStore,
  executeControl,
  injectControlValues,
} from "./control-expr";
import type { ProfileContext } from "./inverter";

const PROFILE_ID = "test-inv";
const LOCK_KEY = "settings.lock";
const TARGET = "settings.max_discharge";

/** Profile with a writable target register and a snapshotToggle lock over it. */
function profile(): InverterProfile {
  return {
    id: PROFILE_ID,
    name: "Test",
    manufacturer: "ACME",
    metrics: [
      metric("settings/max_discharge", {
        label: "Max discharge",
        unit: "A",
        group: "settings",
        addr: 109,
        access: "rw",
      }),
      control<"settings.max_discharge">("settings/lock", {
        label: "Lock",
        group: "settings",
        enumLabels: { 0: "Unlocked", 1: "Locked" },
        controlExpr: { snapshotToggle: { target: TARGET, lockedValue: 0 } },
      }),
    ],
  };
}

/** In-memory control store. */
function memStore(): ControlStore {
  let state: Record<string, { previousValue: number; lockedAt: string }> = {};
  return {
    get: async () => state,
    set: async (next) => {
      state = next;
    },
  };
}

/** Test harness: fake source (records writes), live values, and a state store. */
function harness(live: Record<string, number> = { [TARGET]: 30 }) {
  const p = profile();
  const writes: { target: string; value: number }[] = [];
  const store = memStore();
  const ctx = {
    profile: p,
    validateWrite: (_key: string, _value: number) => null,
  } as unknown as ProfileContext;
  const io: ControlIO = {
    ctx,
    store,
    write: async (target, value) => {
      writes.push({ target, value });
      live[target] = value;
    },
    readLive: (target) => live[target],
  };
  const lockDef = p.metrics.find((m) => m.key === LOCK_KEY)!;
  return { io, store, writes, lockDef, live, ctx, profile: p };
}

describe("executeControl — snapshotToggle", () => {
  test("lock snapshots the current value and writes the locked value", async () => {
    const h = harness({ [TARGET]: 30 });
    await executeControl(h.lockDef, 1, h.io);
    expect(h.writes).toEqual([{ target: TARGET, value: 0 }]);
    const state = await h.store.get();
    expect(state[`${PROFILE_ID}:${LOCK_KEY}`]).toMatchObject({ previousValue: 30 });
  });

  test("unlock restores the captured value and clears state", async () => {
    const h = harness({ [TARGET]: 30 });
    await executeControl(h.lockDef, 1, h.io); // lock -> writes 0
    await executeControl(h.lockDef, 0, h.io); // unlock -> restores 30
    expect(h.writes).toEqual([
      { target: TARGET, value: 0 },
      { target: TARGET, value: 30 },
    ]);
    expect(await h.store.get()).toEqual({});
  });

  test("re-locking is a no-op — the original snapshot is preserved", async () => {
    const h = harness({ [TARGET]: 30 });
    await executeControl(h.lockDef, 1, h.io); // capture 30, write 0
    await executeControl(h.lockDef, 1, h.io); // already locked -> no-op
    expect(h.writes).toEqual([{ target: TARGET, value: 0 }]);
    const state = await h.store.get();
    expect(state[`${PROFILE_ID}:${LOCK_KEY}`]).toMatchObject({ previousValue: 30 });
  });

  test("unlock when not locked is a no-op", async () => {
    const h = harness();
    await executeControl(h.lockDef, 0, h.io);
    expect(h.writes).toEqual([]);
  });

  test("locking with no known live value throws and persists nothing", async () => {
    const h = harness({}); // TARGET has no live value
    await expect(executeControl(h.lockDef, 1, h.io)).rejects.toThrow(/unknown/);
    expect(h.writes).toEqual([]);
    expect(await h.store.get()).toEqual({});
  });

  test("a failed device write rolls back the snapshot", async () => {
    const h = harness({ [TARGET]: 30 });
    h.io.write = async () => {
      throw new Error("modbus timeout");
    };
    await expect(executeControl(h.lockDef, 1, h.io)).rejects.toThrow(/modbus timeout/);
    expect(await h.store.get()).toEqual({}); // rolled back
  });

  test("rejects a value other than 0 or 1", async () => {
    const h = harness();
    await expect(executeControl(h.lockDef, 5, h.io)).rejects.toThrow(/expects 0 or 1/);
  });
});

describe("executeControl — preset", () => {
  test("applies every write on a truthy value, no-ops on 0", async () => {
    const h = harness();
    const presetDef = {
      ...h.lockDef,
      key: "settings.backup",
      controlExpr: {
        preset: {
          writes: [
            { target: TARGET, value: 5 },
            { target: TARGET, value: 7 },
          ],
        },
      },
    };
    await executeControl(presetDef, 0, h.io);
    expect(h.writes).toEqual([]);
    await executeControl(presetDef, 1, h.io);
    expect(h.writes).toEqual([
      { target: TARGET, value: 5 },
      { target: TARGET, value: 7 },
    ]);
  });
});

describe("injectControlValues", () => {
  test("reports 1 when locked, 0 when unlocked", async () => {
    const h = harness({ [TARGET]: 30 });
    const sample: InverterSample = {
      time: new Date().toISOString(),
      inverterId: PROFILE_ID,
      metrics: { [TARGET]: 30 },
    };
    await injectControlValues(sample, h.ctx, h.store);
    expect(sample.metrics[LOCK_KEY]).toBe(0);

    await executeControl(h.lockDef, 1, h.io);
    await injectControlValues(sample, h.ctx, h.store);
    expect(sample.metrics[LOCK_KEY]).toBe(1);
  });
});
