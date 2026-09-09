import { describe, expect, test } from "bun:test";
import {
  type PlantMember,
  isPlantTarget,
  parseSeriesSource,
  plantMembers,
  targetKey,
} from "./plant-source";

const inverter = (id: number, extra: Partial<PlantMember> & { role?: string } = {}) => ({
  id,
  slug: `inv-${id}`,
  name: `Inverter ${id}`,
  profileId: "deye-sun",
  role: extra.role ?? "inverter",
  retiredAt: null,
  batteryKwh: extra.weight ?? null,
});

describe("parseSeriesSource", () => {
  test("`plant` names the whole plant", () => {
    expect(parseSeriesSource({ source: "plant" })).toEqual({ kind: "plant" });
  });

  test("any other `source` is a device slug", () => {
    expect(parseSeriesSource({ source: "deye-1" })).toEqual({ kind: "device", slug: "deye-1" });
  });

  test("`inverterId` is the one-release alias for a device source", () => {
    expect(parseSeriesSource({ inverterId: "deye-1" })).toEqual({ kind: "device", slug: "deye-1" });
  });

  test("`source` wins over the alias when both are sent", () => {
    expect(parseSeriesSource({ source: "plant", inverterId: "deye-1" })).toEqual({ kind: "plant" });
  });

  test("neither present is null — the caller decides the default, not this parser", () => {
    expect(parseSeriesSource({})).toBeNull();
    expect(parseSeriesSource({ source: "" })).toBeNull();
  });
});

describe("plantMembers — the device set a plant value is read from", () => {
  test("only inverters are summed when no controller reports the total", () => {
    const rows = [
      inverter(1),
      inverter(2),
      inverter(3, { role: "meter" }),
      inverter(4, { role: "optimizer" }),
    ];
    expect(plantMembers(rows).map((m) => m.id)).toEqual([1, 2]);
  });

  test("a controller REPLACES the inverter sum — it already reports the total", () => {
    const rows = [inverter(1), inverter(2), inverter(9, { role: "controller" })];
    expect(plantMembers(rows).map((m) => m.id)).toEqual([9]);
  });

  test("a retired device stays in the set — its history still belongs to the plant", () => {
    const rows = [inverter(1), { ...inverter(2), retiredAt: new Date("2026-01-01Z") }];
    expect(plantMembers(rows).map((m) => m.id)).toEqual([1, 2]);
  });

  test("a retired device leaves the LIVE set", () => {
    const rows = [inverter(1), { ...inverter(2), retiredAt: new Date("2026-01-01Z") }];
    expect(plantMembers(rows, { live: true }).map((m) => m.id)).toEqual([1]);
  });

  test("a member carries its profile id — the name a live sample is stamped with", () => {
    expect(plantMembers([inverter(1)])[0]?.profileId).toBe("deye-sun");
  });

  test("a member's weight is its battery capacity, 1 when it has none", () => {
    const rows = [inverter(1, { weight: 10 }), inverter(2)];
    expect(plantMembers(rows).map((m) => m.weight)).toEqual([10, 1]);
  });

  test("a virtual optimizer alone is an EMPTY set, never a plant of one", () => {
    expect(plantMembers([inverter(4, { role: "optimizer" })])).toEqual([]);
  });
});

describe("SeriesTarget helpers", () => {
  test("a slug is a device target; a member set is a plant target", () => {
    expect(isPlantTarget("inv-1")).toBe(false);
    expect(isPlantTarget({ plant: [] })).toBe(true);
  });

  test("the cache key of a plant names its member ids, in order", () => {
    expect(targetKey("inv-1")).toBe("inv-1");
    expect(
      targetKey({
        plant: [
          { id: 2, slug: "b", weight: 1 },
          { id: 5, slug: "e", weight: 1 },
        ],
      }),
    ).toBe("plant:2,5");
  });
});
