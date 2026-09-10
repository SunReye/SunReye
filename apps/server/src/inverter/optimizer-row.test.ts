import type { DeviceRecord, DeviceSpec, PlantDb, PlantRecord } from "@SunReye/db/plant-repo";
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { type SQL, sql } from "drizzle-orm";

/**
 * `ensureOptimizerRow` — the production default behind
 * `RuntimeDeps.ensureOptimizerDevice`.
 *
 * `./runtime.test.ts` injects a stub for it precisely so that suite needs no
 * database client, which left the real one — the three-state answer the
 * optimizer registrar arms itself from — with no cover at all. Its own file
 * rather than a case in that suite, because a `@SunReye/db` mock installed there
 * would stand in for the client every OTHER spec in it deliberately avoids
 * needing.
 *
 * The distinction under test is the one its header names: `ensureDevice` is
 * `ON CONFLICT DO NOTHING` + SELECT, so it answers "the row is there" for a row
 * the operator RETIRED — while the roster read excludes exactly that row. A
 * registrar told "ready" about a retired device waits for an instance that is
 * never coming.
 */

// The spread is load-bearing: `mock.module` is process-global and permanent, so
// a factory returning only the stubbed names would delete every other export of
// these modules for each test file that runs after this one — including
// `isRetired`, which the module under test reads from the same namespace.
const realDb = await import("@SunReye/db");
const realDbExports = { ...realDb };
const realRepo = await import("@SunReye/db/plant-repo");
const realRepoExports = { ...realRepo };

/** Statements the client handed to the spine actually ran. */
const executed: string[] = [];
const dbStub = {
  execute: (query: SQL) => {
    executed.push(String(query.queryChunks.length));
    return Promise.resolve({ rows: [] });
  },
};

let plant: PlantRecord | null = null;
let retiredAt: Date | null = null;
const ensured: DeviceSpec[] = [];

function plantRow(id: number): PlantRecord {
  return {
    id,
    name: "Home",
    slug: "home",
    timeZone: "Europe/Berlin",
    biddingZone: null,
    tariffKey: null,
    latitude: null,
    longitude: null,
    label: "",
    arrays: [],
    tempCoefficient: -0.004,
    systemLoss: 0.14,
    maxOutputW: null,
    houseLoadW: null,
    smartMeterSince: null,
  };
}

mock.module("@SunReye/db", () => ({ ...realDb, db: dbStub }));
mock.module("@SunReye/db/plant-repo", () => ({
  ...realRepo,
  readPlant: async (client: PlantDb) => {
    // The real read runs a statement, so the stub does too: that is the only way
    // to observe WHICH client the module bound to the spine.
    await client.execute(sql`select 1 from plants`);
    return plant;
  },
  ensureDevice: async (client: PlantDb, spec: DeviceSpec) => {
    await client.execute(sql`insert into devices`);
    ensured.push(spec);
    return { id: 9, slug: spec.slug, retiredAt } as DeviceRecord;
  },
}));

// Both mocks are permanent and keyed by the resolved specifier, so without this
// the stubs would stand in for the real modules for every test file that loads
// after this one — and `./runtime.test.ts`, which shares this directory, would
// then be driving a spine it never asked for.
afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
  mock.module("@SunReye/db/plant-repo", () => ({ ...realRepoExports }));
});

const { ensureOptimizerRow } = await import("./runtime");
const { OPTIMIZER_DEVICE_ID, OPTIMIZER_PROFILE } = await import("../automation/optimizer-device");

beforeEach(() => {
  plant = plantRow(3);
  retiredAt = null;
  ensured.length = 0;
  executed.length = 0;
});

test("a boot with no plant answers absent, and writes no device row", async () => {
  // Legal, not exceptional: the automation loop can be armed on an
  // onboarding-only boot, and taking it down over a missing row would be worse
  // than storing nothing until the next tick.
  plant = null;
  expect(await ensureOptimizerRow()).toBe("absent");
  expect(ensured).toEqual([]);
});

test("an in-service row is ready, upserted under the plant it belongs to", async () => {
  expect(await ensureOptimizerRow()).toBe("ready");
  expect(ensured).toEqual([
    {
      plantId: 3,
      connectionId: null,
      unitId: 0,
      slug: OPTIMIZER_DEVICE_ID,
      name: "Optimizer",
      profileId: OPTIMIZER_PROFILE,
      role: "optimizer",
    },
  ]);
});

test("a row the operator RETIRED is retired, not ready", async () => {
  // `ensureDevice` answers the row either way — it is `ON CONFLICT DO NOTHING`
  // plus a SELECT — while the roster read excludes a retired device. Reporting
  // "ready" here leaves the registrar waiting for an instance that is never
  // coming, and every decision it holds unstored.
  retiredAt = new Date("2026-09-01T00:00:00Z");
  expect(await ensureOptimizerRow()).toBe("retired");
});

test("the spine is reached through the client this process holds", async () => {
  // `db` is read PER CALL inside the function, never captured at module
  // evaluation — which is the only reason a suite can stand in for it at all.
  await ensureOptimizerRow();
  expect(executed).toHaveLength(2);
});
