import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * The correction grid's identity boundary.
 *
 * `packages/db/src/forecast-correction.ts` is keyed by `deviceId: number` — the
 * column's own type — while the job above it works in source ids, because that is
 * what a live sample carries and what the API exposes. This module is where the
 * two meet, so what is under test is the translation and what happens when it
 * cannot be made: a device that does not exist must not become a silent write of
 * nothing that still advances the learn cursor.
 *
 * `mock.module` is process-global and permanent, so both modules are spread and
 * both are handed back in `afterAll` — see AGENTS.md.
 */
const realDb = await import("@SunReye/db");
const realDbExports = { ...realDb };
const realStore = await import("@SunReye/db/forecast-correction");
const realStoreExports = { ...realStore };

/** Source id -> device id, as the fake database resolves it. */
let devices: Record<string, number> = {};
let cellRows: Array<{
  deviceId: number;
  month: number;
  hour: number;
  ratio: number;
  weight: number;
  updatedAt: Date;
}> = [];
let stateRows: Array<{
  deviceId: number;
  learnedThrough: string | null;
  maeRaw: number;
  maeCorrected: number;
  samples: number;
  updatedAt: Date;
}> = [];
let cellWrites: unknown[][] = [];
let stateWrites: unknown[] = [];

mock.module("@SunReye/db", () => ({
  ...realDb,
  db: {
    execute: async (query: unknown) => {
      const text = JSON.stringify(query);
      const hit = Object.keys(devices).find((slug) => text.includes(`"${slug}"`));
      return { rows: [{ id: hit === undefined ? null : devices[hit] }] };
    },
  },
}));
mock.module("@SunReye/db/forecast-correction", () => ({
  ...realStore,
  getCorrectionCells: async (deviceId: number) => cellRows.filter((r) => r.deviceId === deviceId),
  getCorrectionState: async (deviceId: number) =>
    stateRows.find((r) => r.deviceId === deviceId) ?? null,
  upsertCorrectionCells: async (rows: unknown[]) => {
    cellWrites.push(rows);
  },
  upsertCorrectionState: async (row: unknown) => {
    stateWrites.push(row);
  },
}));

afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
  mock.module("@SunReye/db/forecast-correction", () => ({ ...realStoreExports }));
});

const {
  loadCorrectionModel,
  readCorrectionCells,
  readCorrectionState,
  writeCorrectionCells,
  writeCorrectionState,
} = await import("./forecast-correction-store");

beforeEach(() => {
  devices = { "deye-1": 4 };
  cellRows = [];
  stateRows = [];
  cellWrites = [];
  stateWrites = [];
});

describe("reading", () => {
  test("reads the cells of the device the source id names", async () => {
    cellRows = [
      { deviceId: 4, month: 8, hour: 12, ratio: 1.2, weight: 3, updatedAt: new Date(0) },
      { deviceId: 9, month: 8, hour: 12, ratio: 0.5, weight: 3, updatedAt: new Date(0) },
    ];
    const rows = await readCorrectionCells("deye-1");
    expect(rows.map((r) => r.ratio)).toEqual([1.2]);
  });

  test("hands the SOURCE ID back on every row — the job's vocabulary is names", async () => {
    cellRows = [{ deviceId: 4, month: 1, hour: 0, ratio: 1, weight: 1, updatedAt: new Date(0) }];
    expect((await readCorrectionCells("deye-1"))[0]?.inverterId).toBe("deye-1");
  });

  test("a device that does not exist reads as an empty grid, not an error", async () => {
    // A fresh install learns nothing until onboarding creates the device; that is
    // "no grid yet", which is exactly what an unlearned plant looks like anyway.
    expect(await readCorrectionCells("ghost")).toEqual([]);
    expect(await readCorrectionState("ghost")).toBeNull();
    expect(await loadCorrectionModel("ghost")).toEqual(new Map());
  });

  test("the model is keyed by month:hour, carrying ratio and weight", async () => {
    cellRows = [{ deviceId: 4, month: 8, hour: 12, ratio: 1.4, weight: 7, updatedAt: new Date(0) }];
    expect(await loadCorrectionModel("deye-1")).toEqual(
      new Map([["8:12", { ratio: 1.4, weight: 7 }]]),
    );
  });

  test("state comes back under the source id it was asked for", async () => {
    stateRows = [
      {
        deviceId: 4,
        learnedThrough: "2026-08-20",
        maeRaw: 1,
        maeCorrected: 0.5,
        samples: 10,
        updatedAt: new Date(0),
      },
    ];
    const state = await readCorrectionState("deye-1");
    expect(state?.inverterId).toBe("deye-1");
    expect(state?.learnedThrough).toBe("2026-08-20");
  });
});

describe("writing", () => {
  test("writes cells under the resolved device id, with the name stripped", async () => {
    await writeCorrectionCells([
      { inverterId: "deye-1", month: 8, hour: 12, ratio: 1.1, weight: 2 },
    ]);
    expect(cellWrites).toEqual([[{ deviceId: 4, month: 8, hour: 12, ratio: 1.1, weight: 2 }]]);
  });

  test("an EMPTY batch writes nothing at all", async () => {
    await writeCorrectionCells([]);
    expect(cellWrites).toEqual([]);
  });

  test("a zero ratio and a zero weight are written, not treated as absent", async () => {
    await writeCorrectionCells([{ inverterId: "deye-1", month: 1, hour: 0, ratio: 0, weight: 0 }]);
    expect(cellWrites[0]).toEqual([{ deviceId: 4, month: 1, hour: 0, ratio: 0, weight: 0 }]);
  });

  test("writes the cursor under the resolved device id", async () => {
    await writeCorrectionState({
      inverterId: "deye-1",
      learnedThrough: "2026-08-20",
      maeRaw: 2,
      maeCorrected: 1,
      samples: 5,
    });
    expect(stateWrites).toEqual([
      { deviceId: 4, learnedThrough: "2026-08-20", maeRaw: 2, maeCorrected: 1, samples: 5 },
    ]);
  });

  test("an unresolvable device writes NOTHING — so the cursor cannot advance past a run that stored nothing", async () => {
    // The boundary that matters: if the cursor were written while the cells were
    // not, the next run would skip the days it never actually learned.
    await writeCorrectionCells([
      { inverterId: "ghost", month: 8, hour: 12, ratio: 1.1, weight: 2 },
    ]);
    await writeCorrectionState({
      inverterId: "ghost",
      learnedThrough: "2026-08-20",
      maeRaw: 2,
      maeCorrected: 1,
      samples: 5,
    });
    expect(cellWrites).toEqual([]);
    expect(stateWrites).toEqual([]);
  });

  test("a batch mixing a known and an unknown source writes only the known device's rows", async () => {
    devices = { "deye-1": 4 };
    await writeCorrectionCells([
      { inverterId: "deye-1", month: 8, hour: 12, ratio: 1.1, weight: 2 },
      { inverterId: "ghost", month: 8, hour: 13, ratio: 1.2, weight: 2 },
    ]);
    expect(cellWrites[0]).toEqual([{ deviceId: 4, month: 8, hour: 12, ratio: 1.1, weight: 2 }]);
  });
});
