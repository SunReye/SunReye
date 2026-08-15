/**
 * The register-write funnel in isolation: no runtime, no poll loop, no MQTT
 * bridge. The live source, the active context and the composite-control store
 * are injected in-memory doubles, so every assertion is about the funnel's own
 * decisions — where a plain write lands, how a `controlExpr` control is
 * dispatched through the interpreter, that it always targets the *current*
 * source across a swap, and that a write into a not-yet-started runtime is
 * refused before the context is ever consulted.
 *
 * There is no `mock.module` here on purpose: the writer imports only the
 * db/env-free control interpreter, so a plain fake is all it takes to drive it.
 */

import { beforeEach, describe, expect, test } from "bun:test";

import { control, metric } from "@SunReye/inverter-core";
import type { InverterProfile, InverterSample, InverterSource } from "@SunReye/inverter-core";
import type { ControlState } from "@SunReye/db/control-state";
import { controlStateKey } from "@SunReye/db/control-state";

import type { ControlStore } from "./control-expr";
import { createControlWriter } from "./control-writer";
import { buildProfileContext, type ProfileContext } from "./inverter";

const PROFILE_ID = "test-inv";
const LOCK = "settings.lock";
const TARGET = "settings.max_discharge";

/** A plant with a writable target register and a snapshotToggle lock over it. */
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
      control<typeof TARGET>("settings/lock", {
        label: "Lock",
        group: "settings",
        enumLabels: { 0: "Unlocked", 1: "Locked" },
        controlExpr: { snapshotToggle: { target: TARGET, lockedValue: 0 } },
      }),
    ],
  };
}

/** A plant that maps no composite controls at all. */
function plainProfile(): InverterProfile {
  return {
    id: "plain",
    name: "Plain",
    manufacturer: "ACME",
    metrics: [
      metric("battery/soc", {
        label: "Battery SOC",
        unit: "%",
        group: "battery",
        addr: 11,
        role: "battery.soc",
      }),
    ],
  };
}

/** Records every write and close; a fresh instance stands in for a swapped source. */
class FakeSource implements InverterSource {
  writes: { key: string; value: number }[] = [];
  closed = 0;
  constructor(
    readonly profile: InverterProfile,
    private readonly onWrite?: (key: string, value: number) => void,
  ) {}
  async read(): Promise<InverterSample> {
    return { time: "2026-08-15T10:00:00.000Z", inverterId: "plant-1", metrics: {} };
  }
  async write(key: string, value: number): Promise<void> {
    this.onWrite?.(key, value);
    this.writes.push({ key, value });
  }
  async close(): Promise<void> {
    this.closed++;
  }
}

/** In-memory {@link ControlStore}, standing in for the `app_settings`-backed one. */
function memStore(): { store: ControlStore; state: () => ControlState } {
  let state: ControlState = {};
  return {
    store: {
      get: async () => state,
      set: async (next) => {
        state = next;
      },
    },
    state: () => state,
  };
}

// --- harness ---------------------------------------------------------------

let source: InverterSource | null;
let ctx: ProfileContext;
let live: Record<string, number>;
/** Set to a message to make the current source's write reject. */
let writeError: string | null;
/** How many times the context accessor was consulted — proves ordering. */
let contextReads: number;

function make(deps?: { store?: ControlStore }) {
  const store = deps?.store ?? memStore().store;
  return createControlWriter({
    getSource: () => source,
    getContext: () => {
      contextReads++;
      return ctx;
    },
    store,
    readLive: (target) => live[target],
  });
}

function newSource(p: InverterProfile = profile()): FakeSource {
  return new FakeSource(p, () => {
    if (writeError) throw new Error(writeError);
  });
}

beforeEach(() => {
  const first = newSource();
  source = first;
  ctx = buildProfileContext(profile());
  live = { [TARGET]: 30 };
  writeError = null;
  contextReads = 0;
});

describe("the register-write funnel", () => {
  test("a plain register write reaches the live source unchanged", async () => {
    const writer = make();

    await writer.write(TARGET, 60);

    expect((source as FakeSource).writes).toEqual([{ key: TARGET, value: 60 }]);
  });

  test("a write to a key the profile does not define is still handed to the source", async () => {
    const writer = make();

    await writer.write("vendor.undocumented", 3);

    expect((source as FakeSource).writes).toEqual([{ key: "vendor.undocumented", value: 3 }]);
  });

  test("a transport failure on write is surfaced, not swallowed", async () => {
    const writer = make();
    writeError = "Modbus exception 4: slave device failure";

    await expect(writer.write(TARGET, 60)).rejects.toThrow("Modbus exception 4");
  });

  test("a write before a source exists is refused before the context is consulted", async () => {
    const writer = make();
    source = null;

    await expect(writer.write(TARGET, 20)).rejects.toThrow("inverter not started");
    // The null-source guard runs first: the context is never read, so a write
    // into a not-yet-started runtime never trips over an unbuilt context.
    expect(contextReads).toBe(0);
  });

  test("every write targets the current source, even after a swap closed the old one", async () => {
    const writer = make();
    const first = source as FakeSource;

    await writer.write(TARGET, 10);

    // The runtime swaps the source out from under the writer; the funnel must
    // pick up the new one on the very next call rather than the captured old.
    const second = newSource();
    source = second;
    await writer.write(TARGET, 20);

    expect(first.writes).toEqual([{ key: TARGET, value: 10 }]);
    expect(second.writes).toEqual([{ key: TARGET, value: 20 }]);
  });

  describe("a composite (controlExpr) control", () => {
    test("locking snapshots the live value and writes the locked one", async () => {
      const { store, state } = memStore();
      const writer = make({ store });

      await writer.write(LOCK, 1);

      expect((source as FakeSource).writes).toEqual([{ key: TARGET, value: 0 }]);
      expect(state()[controlStateKey(PROFILE_ID, LOCK)]).toMatchObject({ previousValue: 30 });
    });

    test("unlocking restores the captured value and clears the snapshot", async () => {
      const { store, state } = memStore();
      const writer = make({ store });
      await writer.write(LOCK, 1); // captures 30, writes 0
      live[TARGET] = 0;

      await writer.write(LOCK, 0);

      expect((source as FakeSource).writes).toEqual([
        { key: TARGET, value: 0 },
        { key: TARGET, value: 30 },
      ]);
      expect(state()).toEqual({});
    });

    test("locking is refused while the current register value is unknown", async () => {
      const writer = make();
      live = {}; // no live value for the target

      await expect(writer.write(LOCK, 1)).rejects.toThrow(
        /current value of "settings.max_discharge"/,
      );
      expect((source as FakeSource).writes).toEqual([]);
    });

    test("the composite dispatch reaches whichever source is current at call time", async () => {
      const writer = make();
      const swapped = newSource();
      source = swapped;

      await writer.write(LOCK, 1);

      expect(swapped.writes).toEqual([{ key: TARGET, value: 0 }]);
    });
  });

  describe("injecting composite-control state into a sample", () => {
    const sample = (metrics: Record<string, number> = {}): InverterSample => ({
      time: "2026-08-15T10:00:00.000Z",
      inverterId: "plant-1",
      metrics: { ...metrics },
    });

    test("an unlocked control reads 0 into the sample", async () => {
      const writer = make();
      const s = sample();

      await writer.injectState(s);

      expect(s.metrics[LOCK]).toBe(0);
    });

    test("a locked control reads 1 into the sample", async () => {
      const { store, state } = memStore();
      const writer = make({ store });
      await writer.write(LOCK, 1);
      expect(state()[controlStateKey(PROFILE_ID, LOCK)]).toBeDefined();
      const s = sample();

      await writer.injectState(s);

      expect(s.metrics[LOCK]).toBe(1);
    });

    test("a profile with no composite controls leaves the sample untouched", async () => {
      ctx = buildProfileContext(plainProfile());
      const writer = make();
      const s = sample({ "battery.soc": 55 });

      await writer.injectState(s);

      expect(s.metrics).toEqual({ "battery.soc": 55 });
    });
  });
});
