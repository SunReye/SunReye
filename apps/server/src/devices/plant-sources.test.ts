import { describe, expect, test } from "bun:test";
import type { DeviceRecord } from "@SunReye/db/plant-repo";
import { type PlantSourcesStore, listSources, readPlantMembers } from "./plant-sources";

const device = (id: number, role: string, extra: Partial<DeviceRecord> = {}): DeviceRecord => ({
  id,
  slug: `dev-${id}`,
  name: `Device ${id}`,
  profileId: "p",
  role,
  unitId: id,
  connectionId: null,
  arrays: [],
  tempCoefficient: -0.004,
  systemLoss: 0.14,
  retiredAt: null,
  ...extra,
});

const store = (
  devices: DeviceRecord[],
  batteries: Array<{ deviceId: number; usableKwh: number }> = [],
): PlantSourcesStore => ({
  readPlant: async () => ({ id: 1 }) as never,
  readDevices: async () => devices,
  readPlantBatteries: async () =>
    batteries.map((b) => ({ ...b, maxChargeW: null, minSoc: 10, nominalV: null })),
});

describe("listSources", () => {
  test("lists physical devices with membership; the optimizer is not a source", async () => {
    const out = await listSources(
      store([
        device(1, "inverter"),
        device(2, "inverter"),
        device(3, "optimizer"),
        device(4, "meter"),
      ]),
    );
    expect(out.devices.map((d) => d.slug)).toEqual(["dev-1", "dev-2", "dev-4"]);
    expect(out.devices.map((d) => d.member)).toEqual([true, true, false]);
    expect(out.plant.members).toEqual(["dev-1", "dev-2"]);
  });

  test("a retired device is listed as retired and stays a plant member", async () => {
    const out = await listSources(
      store([device(1, "inverter"), device(2, "inverter", { retiredAt: new Date("2026-01-01Z") })]),
    );
    expect(out.devices[1]).toMatchObject({
      slug: "dev-2",
      profileId: "p",
      retired: true,
      member: true,
    });
  });

  test("no plant yet is an empty answer, never a throw", async () => {
    const empty: PlantSourcesStore = {
      readPlant: async () => null,
      readDevices: async () => [],
      readPlantBatteries: async () => [],
    };
    expect(await listSources(empty)).toEqual({ plant: { members: [] }, devices: [] });
  });
});

describe("readPlantMembers", () => {
  test("weights members by their battery's usable kWh", async () => {
    const members = await readPlantMembers(
      store([device(1, "inverter"), device(2, "inverter")], [{ deviceId: 1, usableKwh: 10 }]),
    );
    expect(members).toEqual([
      { id: 1, slug: "dev-1", profileId: "p", weight: 10 },
      { id: 2, slug: "dev-2", profileId: "p", weight: 1 },
    ]);
  });

  test("the live set drops a retired member", async () => {
    const rows = [device(1, "inverter"), device(2, "inverter", { retiredAt: new Date() })];
    expect((await readPlantMembers(store(rows), { live: true })).map((m) => m.id)).toEqual([1]);
    expect((await readPlantMembers(store(rows))).map((m) => m.id)).toEqual([1, 2]);
  });
});
