import { CONTROL_STATE_KEY, type ControlState, controlStateKey } from "@SunReye/db/control-state";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ZodType } from "zod";

import type { ControlStore } from "./control-expr";

/**
 * The store's entire job is to sit between the poll loop and one `app_settings`
 * row, so the row is what gets stood in for — there is no database in the test
 * process. The fake keeps the real read semantics (validate the stored value,
 * fall back to the default when it is missing or unreadable) and counts reads
 * and writes, because "did this touch the database?" is itself behaviour here:
 * the loop asks for lock state on every tick.
 *
 * The spread is load-bearing, not tidiness: `mock.module` is process-global and
 * permanent, so a factory returning only the exports THIS suite needs deletes
 * the rest for every test file that runs afterwards, breaking them at import in
 * whatever order the runner happened to walk.
 */
const rows = new Map<string, unknown>();
let reads = 0;
let writes = 0;
/** Armed to make the next write fail once — a database that went away mid-lock. */
let writeFailure: Error | null = null;

async function readSetting<T>(key: string, schema: ZodType<T>, fallback: T): Promise<T> {
  reads++;
  const stored = rows.get(key);
  const parsed = stored === undefined ? null : schema.safeParse(stored);
  return parsed?.success ? parsed.data : fallback;
}

async function writeSetting<T>(key: string, value: T): Promise<void> {
  writes++;
  if (writeFailure) {
    const failure = writeFailure;
    writeFailure = null;
    throw failure;
  }
  rows.set(key, structuredClone(value));
}

const realAppSettings = await import("../settings/app-settings");
// Snapshot BY VALUE, before the mock: a module namespace is live, so once the
// stub is installed `realAppSettings.readSetting` IS the fake above and
// `() => realAppSettings` would restore the fake rather than the module.
const realAppSettingsExports = { ...realAppSettings };
mock.module("../settings/app-settings", () => ({ ...realAppSettings, readSetting, writeSetting }));

// The spread keeps the module's other exports alive, but the two stubs are
// permanent: they would stay installed for every file that loads after this one,
// and `app-settings.test.ts` — the suite that tests that very module — would
// assert against this in-memory map instead of the real reader. Hand it back
// once this file's own tests, which all need the fake, are done.
afterAll(() => {
  mock.module("../settings/app-settings", () => ({ ...realAppSettingsExports }));
});

// Imported after the mock is registered, as the house style requires: the
// module resolves `readSetting`/`writeSetting` through the registry, and a
// static import would have been hoisted above the stub.
const { createControlStore, dbControlStore } = await import("./control-store");

/**
 * A store with a cold cache. The shipped `dbControlStore` is a process
 * singleton whose cache outlives any single test (and this file), and the cache
 * is half the contract, so each case gets its own store over the same row.
 */
const coldStore = (): ControlStore => createControlStore();

const lock = (previousValue: number) => ({
  previousValue,
  lockedAt: "2026-07-25T11:30:00.000Z",
});

/** What the `app_settings` row currently holds, as the next boot would read it. */
const stored = () => rows.get(CONTROL_STATE_KEY);

beforeEach(() => {
  rows.clear();
  reads = 0;
  writes = 0;
  writeFailure = null;
});

describe("control state persistence", () => {
  test("reports no engaged locks before any control has been used", async () => {
    const store = coldStore();

    expect(await store.get()).toEqual({});
  });

  test("reads back the locks a previous boot left engaged", async () => {
    rows.set(CONTROL_STATE_KEY, { "deye-sg05lp3:setting.time_of_use": lock(40) });
    const store = coldStore();

    expect(await store.get()).toEqual({ "deye-sg05lp3:setting.time_of_use": lock(40) });
  });

  test("keeps each profile's locks apart under its own namespaced key", async () => {
    // The same metric key exists on two profiles; a lock engaged on one must
    // never restore the other profile's register.
    const store = coldStore();
    await store.set({
      [controlStateKey("deye-sg05lp3", "setting.grid_charge")]: lock(1),
      [controlStateKey("acme-test", "setting.grid_charge")]: lock(0),
    });

    const state = await coldStore().get();
    expect(state[controlStateKey("deye-sg05lp3", "setting.grid_charge")]?.previousValue).toBe(1);
    expect(state[controlStateKey("acme-test", "setting.grid_charge")]?.previousValue).toBe(0);
  });

  test("carries a captured value of zero through, rather than treating it as absent", async () => {
    // 0 A / 0 % is a real captured setpoint. Losing it to a falsy check would
    // restore the wrong value on unlock.
    rows.set(CONTROL_STATE_KEY, { "p:setting.max_charge_current": lock(0) });

    expect(await coldStore().get()).toEqual({
      "p:setting.max_charge_current": lock(0),
    });
  });

  test("carries a negative captured value through", async () => {
    // Export/discharge setpoints are signed; -3000 W is a value, not corruption.
    rows.set(CONTROL_STATE_KEY, { "p:setting.export_limit": lock(-3000) });

    expect(await coldStore().get()).toEqual({
      "p:setting.export_limit": lock(-3000),
    });
  });

  test("falls back to no engaged locks when the stored row no longer fits the schema", async () => {
    // A schema change (or a hand-edited row) must degrade to "nothing locked"
    // rather than throwing on every poll tick.
    rows.set(CONTROL_STATE_KEY, { "p:setting.grid_charge": { previousValue: "forty" } });

    expect(await coldStore().get()).toEqual({});
  });
});

describe("control state caching", () => {
  test("serves the poll loop from memory after the first read", async () => {
    // The loop reads lock state every tick; only the first may reach the row.
    const store = coldStore();
    await store.get();
    await store.get();
    await store.get();

    expect(reads).toBe(1);
  });

  test("reads the row again for a store that has not read it yet", async () => {
    await coldStore().get();
    await coldStore().get();

    expect(reads).toBe(2);
  });

  test("overlapping first reads agree on the state they hand back", async () => {
    rows.set(CONTROL_STATE_KEY, { "p:setting.grid_charge": lock(1) });
    const store = coldStore();

    const [first, second] = await Promise.all([store.get(), store.get()]);

    expect(first).toEqual({ "p:setting.grid_charge": lock(1) });
    expect(second).toEqual(first);
    const before = reads;
    await store.get();
    expect(reads).toBe(before); // settled: no further row read
  });

  test("a lock engaged in this process is visible without going back to the row", async () => {
    const store = coldStore();
    await store.set({ "p:setting.grid_charge": lock(1) });

    expect(await store.get()).toEqual({ "p:setting.grid_charge": lock(1) });
    expect(reads).toBe(0);
  });

  test("an engaged lock survives a restart", async () => {
    await coldStore().set({ "p:setting.grid_charge": lock(1) });

    expect(await coldStore().get()).toEqual({ "p:setting.grid_charge": lock(1) });
  });
});

describe("releasing a control", () => {
  test("removes the released lock from the stored row, not just from memory", async () => {
    // Presence is the contract: a key left behind would make the next boot
    // think the control is still engaged and restore a stale value.
    const store = coldStore();
    await store.set({ "p:setting.grid_charge": lock(1) });
    await store.set({});

    expect(stored()).toEqual({});
    expect(await coldStore().get()).toEqual({});
  });

  test("releasing one control leaves the others engaged", async () => {
    const store = coldStore();
    await store.set({ "p:setting.grid_charge": lock(1), "p:setting.time_of_use": lock(40) });
    await store.set({ "p:setting.time_of_use": lock(40) });

    expect(await coldStore().get()).toEqual({ "p:setting.time_of_use": lock(40) });
  });
});

describe("a persistence failure while engaging a control", () => {
  test("leaves the cache reporting the state that was actually stored", async () => {
    // The snapshot is persisted before the device write precisely so it cannot
    // be lost; a cache that accepted the unpersisted state would report a lock
    // the next boot knows nothing about.
    const store = coldStore();
    expect(await store.get()).toEqual({});
    writeFailure = new Error("connection terminated");

    await expect(store.set({ "p:setting.grid_charge": lock(1) })).rejects.toThrow(
      "connection terminated",
    );

    expect(await store.get()).toEqual({});
    expect(stored()).toBeUndefined();
  });

  test("does not poison the store — the retry persists and caches", async () => {
    const store = coldStore();
    writeFailure = new Error("connection terminated");
    await expect(store.set({ "p:setting.grid_charge": lock(1) })).rejects.toThrow();

    await store.set({ "p:setting.grid_charge": lock(1) });

    expect(writes).toBe(2);
    expect(stored()).toEqual({ "p:setting.grid_charge": lock(1) });
    expect(await coldStore().get()).toEqual({ "p:setting.grid_charge": lock(1) });
  });
});

describe("the store's slot in app_settings", () => {
  test("writes under the shared control-state key so the next boot finds it", async () => {
    const state: ControlState = { "p:setting.grid_charge": lock(1) };
    await coldStore().set(state);

    expect([...rows.keys()]).toEqual([CONTROL_STATE_KEY]);
    expect(writes).toBe(1);
  });

  test("the store the runtime is wired to reads that same row", async () => {
    // `dbControlStore` is what runtime.ts hands the control interpreter; it must
    // be a real store over the shared key, not a fresh empty map per caller.
    rows.set(CONTROL_STATE_KEY, { "p:setting.grid_charge": lock(1) });

    expect(await dbControlStore.get()).toEqual({ "p:setting.grid_charge": lock(1) });
  });
});
