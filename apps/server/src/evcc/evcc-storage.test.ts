/**
 * The loadpoint-to-device path `createPlantEvccIngest` wires: which row state the registrar is
 * told, and that each seam forwards to the registry and the runtime's writer. The ingest
 * (`./evcc.ts`) is captured, not run.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createStreams } from "../shared/streams";

const realRepo = await import("@SunReye/db/plant-repo");
const realRepoExports = { ...realRepo };
const realIngest = await import("./evcc");
const realIngestExports = { ...realIngest };
const realSettings = await import("../settings/evcc-settings");
const realSettingsExports = { ...realSettings };
const realClient = await import("../shared/plant-client");
const realClientExports = { ...realClient };

const CLIENT = { execute: async () => ({ rows: [] }) };
let plant: { id: number } | null = { id: 7 };
let row: { retiredAt: Date | null } = { retiredAt: null };
const specs: unknown[] = [];
mock.module("@SunReye/db/plant-repo", () => ({
  ...realRepo,
  readPlant: async () => plant,
  ensureDevice: async (_db: unknown, spec: unknown) => {
    specs.push(spec);
    return row;
  },
}));
mock.module("../shared/plant-client", () => ({ ...realClient, plantClient: () => CLIENT }));
let config = { connectionId: 3, topicRoot: "evcc/home" };
mock.module("../settings/evcc-settings", () => ({
  ...realSettings,
  getEvccConfig: async () => config,
}));

type IngestDeps = Parameters<typeof realIngest.createEvccIngest>[0];
let handed: IngestDeps | null = null;
mock.module("./evcc", () => ({
  ...realIngest,
  createEvccIngest: (deps: IngestDeps) => {
    handed = deps;
    return { snapshot: () => null } as never;
  },
}));

afterAll(() => {
  mock.module("@SunReye/db/plant-repo", () => ({ ...realRepoExports }));
  mock.module("../shared/plant-client", () => ({ ...realClientExports }));
  mock.module("../settings/evcc-settings", () => ({ ...realSettingsExports }));
  mock.module("./evcc", () => ({ ...realIngestExports }));
});

const { createPlantEvccIngest } = await import("./evcc-storage");

function wire(overrides: { registry?: object; writer?: object } = {}) {
  const calls: string[] = [];
  const device = { id: "evcc-loadpoint-1" };
  const registry = {
    reload: async () => {
      calls.push("reload");
      return [];
    },
    get: (id: string) => (id === "evcc-loadpoint-1" ? device : undefined),
    ...overrides.registry,
  };
  const writer = {
    commit: (...args: unknown[]) => void calls.push(`commit:${args.length}`),
    forgetDevice: (id: string) => void calls.push(`forget:${id}`),
    ...overrides.writer,
  };
  createPlantEvccIngest({
    streams: createStreams(),
    registry: registry as never,
    writer: writer as never,
  });
  if (!handed) throw new Error("createEvccIngest was not called");
  const storage = handed.storage;
  if (!storage) throw new Error("the ingest was given no storage");
  return { storage, deps: handed, calls, device };
}

beforeEach(() => {
  handed = null;
  plant = { id: 7 };
  row = { retiredAt: null };
  config = { connectionId: 3, topicRoot: "evcc/home" };
  specs.length = 0;
});

describe("ensureDevice for a loadpoint", () => {
  test("a live row is ready, created against EVCC's own connection and topic root", async () => {
    const { storage } = wire();
    expect(await storage.ensureDevice("evcc-loadpoint-2", 2, "Garage")).toBe("ready");
    expect(specs).toEqual([
      expect.objectContaining({
        plantId: 7,
        connectionId: 3,
        unitId: 2,
        slug: "evcc-loadpoint-2",
        name: "Garage",
        params: { topicRoot: "evcc/home" },
      }),
    ]);
  });

  test("a row the operator retired is retired, not ready", async () => {
    row = { retiredAt: new Date("2026-08-01T00:00:00Z") };
    expect(await wire().storage.ensureDevice("evcc-loadpoint-1", 1, null)).toBe("retired");
  });

  test("no plant yet (onboarding-only boot) is absent and writes no row", async () => {
    plant = null;
    expect(await wire().storage.ensureDevice("evcc-loadpoint-1", 1, null)).toBe("absent");
    expect(specs).toEqual([]);
  });

  test("the config is read per call: a re-pointed broker reaches the next row", async () => {
    const { storage } = wire();
    await storage.ensureDevice("evcc-loadpoint-1", 1, null);
    config = { connectionId: 9, topicRoot: "evcc/other" };
    await storage.ensureDevice("evcc-loadpoint-2", 2, null);
    expect(specs).toEqual([
      expect.objectContaining({ connectionId: 3, params: { topicRoot: "evcc/home" } }),
      expect.objectContaining({ connectionId: 9, params: { topicRoot: "evcc/other" } }),
    ]);
  });
});

describe("the ingest's other seams", () => {
  test("reloadRegistry reloads the registry and answers nothing", async () => {
    const { storage, calls } = wire();
    expect(await storage.reloadRegistry()).toBeUndefined();
    expect(calls).toEqual(["reload"]);
  });

  test("device reads the registry by id", () => {
    const { storage, device } = wire();
    expect(storage.device("evcc-loadpoint-1")).toBe(device as never);
    expect(storage.device("evcc-loadpoint-9")).toBeUndefined();
  });

  test("commit and forgetDevice go to the runtime's writer", () => {
    const { storage, calls, device } = wire();
    storage.commit(device as never, {} as never);
    storage.forgetDevice("evcc-loadpoint-1");
    expect(calls).toEqual(["commit:2", "forget:evcc-loadpoint-1"]);
  });
});
