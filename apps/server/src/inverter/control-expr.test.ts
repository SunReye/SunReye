import { describe, expect, test } from "bun:test";

import { control, metric } from "@SunReye/inverter-core";
import type { InverterProfile, InverterSample, MetricDef } from "@SunReye/inverter-core";

import {
  type ControlIO,
  type ControlStore,
  executeControl,
  injectControlValues,
} from "./control-expr";
import type { ProfileContext } from "./inverter";
import { WriteRejectedError } from "./write-rejected";

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

describe("executeControl — what it refuses to run", () => {
  test("a metric that owns a register is not a control", async () => {
    const h = harness();
    const plain = h.profile.metrics.find((m) => m.key === TARGET)!;
    await expect(executeControl(plain, 1, h.io)).rejects.toThrow(/not a control/);
    expect(h.writes).toEqual([]);
  });

  test("an action shape this build does not know is refused, not guessed at", async () => {
    // Profiles are fetched from the profile repo at runtime, so a newer profile
    // can name an action an older addon has never heard of. Dispatching nothing
    // is the only safe reading — the alternative is writing a register nobody
    // asked for.
    const h = harness();
    const future = {
      ...h.lockDef,
      controlExpr: { rampTo: { target: TARGET, value: 5 } },
    } as unknown as MetricDef;
    await expect(executeControl(future, 1, h.io)).rejects.toThrow(/unsupported controlExpr/);
    expect(h.writes).toEqual([]);
  });
});

describe("executeControl — writes the register rejects", () => {
  test("unlock refuses a captured value the register no longer accepts", async () => {
    // The profile can be updated under a lock that is already engaged: a
    // narrowed range makes yesterday's snapshot unwritable. Restoring must fail
    // loudly and keep the snapshot, never clear it and lose the user's value.
    const h = harness({ [TARGET]: 30 });
    await executeControl(h.lockDef, 1, h.io);
    h.io.ctx = {
      ...h.ctx,
      validateWrite: () => "Value 30 is above maximum 20",
    } as unknown as ProfileContext;
    await expect(executeControl(h.lockDef, 0, h.io)).rejects.toThrow(/cannot unlock/);
    expect(h.writes).toEqual([{ target: TARGET, value: 0 }]); // no restore attempted
    const kept = await h.store.get();
    expect(kept[`${PROFILE_ID}:${LOCK_KEY}`]).toMatchObject({ previousValue: 30 });
  });

  // Every refusal below comes from the profile's own metadata, so each must be a
  // WriteRejectedError — the type is what decides 400 vs 502 at the edge. A
  // plain Error here means an equivalent refusal answers 400 through the funnel
  // and 502 through a composite control, for the same caller mistake.
  test("a refused unlock is a WriteRejectedError, not a device failure", async () => {
    const h = harness({ [TARGET]: 30 });
    await executeControl(h.lockDef, 1, h.io);
    h.io.ctx = {
      ...h.ctx,
      validateWrite: () => "Value 30 is above maximum 20",
    } as unknown as ProfileContext;
    await expect(executeControl(h.lockDef, 0, h.io)).rejects.toBeInstanceOf(WriteRejectedError);
  });

  test("a snapshotToggle handed a non-boolean is a WriteRejectedError", async () => {
    const h = harness({ [TARGET]: 5 });
    await expect(executeControl(h.lockDef, 2, h.io)).rejects.toBeInstanceOf(WriteRejectedError);
    expect(h.writes).toEqual([]);
  });

  /** A preset that writes the given values to {@link TARGET}, in order. */
  const presetOf = (h: ReturnType<typeof harness>, values: number[]): MetricDef => ({
    ...h.lockDef,
    key: "settings.backup",
    controlExpr: { preset: { writes: values.map((value) => ({ target: TARGET, value })) } },
  });

  test("a preset refused by the profile is a WriteRejectedError", async () => {
    const h = harness({ [TARGET]: 5 });
    h.io.ctx = {
      ...h.ctx,
      validateWrite: (_k: string, v: number) => (v === 99 ? "Value 99 is above maximum 20" : null),
    } as unknown as ProfileContext;
    await expect(executeControl(presetOf(h, [1, 99]), 1, h.io)).rejects.toBeInstanceOf(
      WriteRejectedError,
    );
    expect(h.writes).toEqual([]);
  });

  test("a preset whose second target is out of range performs no write at all", async () => {
    // Validation is not a device concern, so nothing forces it to interleave
    // with the writes: a preset the profile already refuses must leave the
    // inverter in the state the operator last chose, not half of a new one.
    const h = harness();
    h.io.ctx = {
      ...h.ctx,
      validateWrite: (_key: string, value: number) =>
        value > 5 ? `Value ${value} is above maximum 5` : null,
    } as unknown as ProfileContext;

    await expect(executeControl(presetOf(h, [5, 7]), 1, h.io)).rejects.toThrow(/above maximum 5/);
    expect(h.writes).toEqual([]);
  });

  test("the last target is pre-flighted too, not only the ones before it", async () => {
    const h = harness();
    h.io.ctx = {
      ...h.ctx,
      validateWrite: (_key: string, value: number) => (value === 9 ? "nope" : null),
    } as unknown as ProfileContext;

    await expect(executeControl(presetOf(h, [1, 2, 9]), 1, h.io)).rejects.toThrow(/nope/);
    expect(h.writes).toEqual([]);
  });

  test("a preset every target passes is applied in order", async () => {
    const h = harness();

    await executeControl(presetOf(h, [1, 2, 3]), 1, h.io);

    expect(h.writes).toEqual([
      { target: TARGET, value: 1 },
      { target: TARGET, value: 2 },
      { target: TARGET, value: 3 },
    ]);
  });

  test("a device write that fails mid-preset names the targets that landed", async () => {
    // Modbus has no multi-register atomicity, so a half-applied preset is a real
    // state the operator must be told about rather than a rollback we can fake —
    // and the report has to say how far it got.
    const h = harness();
    const plain = h.io.write;
    h.io.write = async (target, value) => {
      if (value === 7) throw new Error("Modbus exception 4");
      await plain(target, value);
    };

    await expect(executeControl(presetOf(h, [5, 7, 9]), 1, h.io)).rejects.toThrow(
      /applied: settings\.max_discharge=5/,
    );
    expect(h.writes).toEqual([{ target: TARGET, value: 5 }]);
  });

  test("a preset whose very first write fails says nothing landed", async () => {
    const h = harness();
    h.io.write = async () => {
      throw new Error("Modbus exception 4");
    };

    await expect(executeControl(presetOf(h, [5, 7]), 1, h.io)).rejects.toThrow(
      /applied: nothing|nothing applied/,
    );
    expect(h.writes).toEqual([]);
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

describe("injectControlValues — profiles without lock state", () => {
  test("a profile with no controls never reads the store", async () => {
    // Every poll runs through here, so the common case must not cost a read.
    const h = harness();
    const bare = { ...h.profile, metrics: h.profile.metrics.filter((m) => !m.controlExpr) };
    const ctx = { ...h.ctx, profile: bare } as unknown as ProfileContext;
    const store: ControlStore = {
      get: async () => {
        throw new Error("state was read for a profile with no controls");
      },
      set: async () => {},
    };
    const sample: InverterSample = {
      time: new Date().toISOString(),
      inverterId: PROFILE_ID,
      metrics: { [TARGET]: 30 },
    };
    await injectControlValues(sample, ctx, store);
    expect(sample.metrics).toEqual({ [TARGET]: 30 });
  });

  test("a stateless control reports 0 even while another control is locked", async () => {
    // A preset is momentary: it owns no register and holds no state, so it can
    // never report the lock state of the snapshotToggle sitting next to it.
    const h = harness({ [TARGET]: 30 });
    const presetKey = "settings.backup";
    const withPreset = {
      ...h.profile,
      metrics: [
        ...h.profile.metrics,
        { ...h.lockDef, key: presetKey, controlExpr: { preset: { writes: [] } } },
      ],
    };
    await executeControl(h.lockDef, 1, h.io);
    const sample: InverterSample = {
      time: new Date().toISOString(),
      inverterId: PROFILE_ID,
      metrics: {},
    };
    await injectControlValues(sample, { ...h.ctx, profile: withPreset } as ProfileContext, h.store);
    expect(sample.metrics[LOCK_KEY]).toBe(1);
    expect(sample.metrics[presetKey]).toBe(0);
  });
});
