import type { PlantDb, PlantPatch, PlantRecord } from "@SunReye/db/plant-repo";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * THE WIRING, not the cache.
 *
 * `./plant-facts.ts` owns the cache and is driven against an in-memory spine in
 * its own suite. What this module adds is one claim: the process instance is
 * bound to the CURRENT `db` of `@SunReye/db`, read per call and not captured at
 * import. That is what lets a suite that stubs the client reach it at all, and
 * what keeps a cost suite from dialling the developer's database.
 *
 * The repository functions are stubbed, not run: their SQL is proved against a
 * real Postgres in `apps/server/db-tests/plant-spine.test.ts`. What only this
 * file can prove is WHICH client they are handed.
 *
 * The spreads are load-bearing and the restores are too: `mock.module` is
 * process-global and permanent (see the root `AGENTS.md`).
 */
const realDb = await import("@SunReye/db");
const realDbExports = { ...realDb };
const realRepo = await import("@SunReye/db/plant-repo");
const realRepoExports = { ...realRepo };

/** The stand-in for the process client; its `execute` is swapped per test. */
const dbStub = {
  execute: async (_query: unknown): Promise<{ rows: unknown[] }> => ({
    rows: [],
  }),
};

/** Which client each repository stub was handed, in call order. */
const handedClients: PlantDb[] = [];
const patches: { id: number; patch: PlantPatch }[] = [];

const plantRow = { id: 7, name: "Home", slug: "home" } as PlantRecord;

mock.module("@SunReye/db", () => ({ ...realDb, db: dbStub }));
mock.module("@SunReye/db/plant-repo", () => ({
  ...realRepo,
  readRawSetting: async (client: PlantDb) => {
    handedClients.push(client);
    return null;
  },
  ensurePlant: async (client: PlantDb) => {
    handedClients.push(client);
    return plantRow;
  },
  readDevices: async (client: PlantDb) => {
    handedClients.push(client);
    return [];
  },
  readPlantBatteries: async (client: PlantDb) => {
    handedClients.push(client);
    return [];
  },
  updatePlant: async (client: PlantDb, id: number, patch: PlantPatch) => {
    handedClients.push(client);
    patches.push({ id, patch });
  },
}));

afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
  mock.module("@SunReye/db/plant-repo", () => ({ ...realRepoExports }));
});

const { plantFacts } = await import("./plant-facts-instance");

beforeEach(() => {
  handedClients.length = 0;
  patches.length = 0;
  plantFacts.invalidate();
});

describe("plantFacts", () => {
  test("provisions the plant row through the repository", async () => {
    expect(await plantFacts.plant()).toBe(plantRow);
    expect(handedClients.length).toBeGreaterThan(0);
  });

  test("is one cached instance: a second read does not touch the spine again", async () => {
    await plantFacts.plant();
    const reads = handedClients.length;
    expect(await plantFacts.plant()).toBe(plantRow);
    expect(handedClients).toHaveLength(reads);
  });

  test("the client handed to the spine calls db.execute when it runs, not the one bound at import", async () => {
    await plantFacts.plant();
    const [client] = handedClients;
    const reached: string[] = [];
    dbStub.execute = async () => {
      reached.push("later");
      return { rows: [] };
    };
    await client?.execute({} as never);
    expect(reached).toEqual(["later"]);
  });

  test("a patch writes the named columns to the plant row and drops the cache", async () => {
    await plantFacts.plant();
    await plantFacts.patch({ name: "Barn" } as PlantPatch);
    expect(patches).toEqual([{ id: 7, patch: { name: "Barn" } }]);
    const before = handedClients.length;
    await plantFacts.plant();
    expect(handedClients.length).toBeGreaterThan(before);
  });

  test("a plant with no packs has no battery and no stated pack voltage", async () => {
    expect(await plantFacts.battery()).toBeNull();
    expect(await plantFacts.packNominalV()).toBeNull();
    expect(await plantFacts.devices()).toEqual([]);
  });
});
