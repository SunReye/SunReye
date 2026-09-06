import { describe, expect, test } from "bun:test";
import type { ManifestMetric } from "@SunReye/inverter-core";
import { aggregateOfMetric, isRefusal, plantFoldFor, targetOf } from "./plant-read";

const meta = (key: string, role: ManifestMetric["role"]): [string, ManifestMetric] => [
  key,
  {
    key,
    role,
    topic: key,
    label: key,
    unit: null,
    group: "g",
    kind: "measurement",
    storage: "series",
    writable: false,
  },
];
const metaByKey = new Map([
  meta("pv_power", "pv.total.power"),
  meta("soc", "battery.soc"),
  meta("grid_v", "grid.phase.voltage"),
  meta("vendor_x", undefined),
]);
const aggregateOf = aggregateOfMetric(metaByKey);
const members = [{ id: 1, slug: "inv-1", weight: 1 }];

describe("aggregateOfMetric", () => {
  test("goes through the manifest's role, never the key's spelling", () => {
    expect(aggregateOf("pv_power")).toBe("sum");
    expect(aggregateOf("soc")).toBe("weighted-mean");
    expect(aggregateOf("grid_v")).toBe("per-device");
  });

  test("a key with no role, or no manifest entry, is per-device", () => {
    expect(aggregateOf("vendor_x")).toBe("per-device");
    expect(aggregateOf("never-seen")).toBe("per-device");
  });
});

describe("plantFoldFor", () => {
  test("a device request reads the slug, with no fold", () => {
    expect(plantFoldFor({ kind: "device", slug: "inv-1" }, members, "grid_v", aggregateOf)).toEqual(
      {
        inverterId: "inv-1",
      },
    );
  });

  test("a plant request for a summable metric carries the members and the aggregate", () => {
    expect(plantFoldFor({ kind: "plant" }, members, "pv_power", aggregateOf)).toEqual({
      inverterId: "plant",
      plant: { members, aggregate: "sum" },
    });
  });

  test("a plant request for a per-device metric is REFUSED, not an empty series", () => {
    const args = plantFoldFor({ kind: "plant" }, members, "grid_v", aggregateOf);
    expect(isRefusal(args)).toBe(true);
    expect(args).toMatchObject({ error: expect.stringContaining("no plant-level value") });
    expect(isRefusal({ inverterId: "inv-1" })).toBe(false);
  });
});

describe("targetOf", () => {
  test("a device is its slug; the plant is its member set", () => {
    expect(targetOf({ kind: "device", slug: "inv-1" }, members)).toBe("inv-1");
    expect(targetOf({ kind: "plant" }, members)).toEqual({ plant: members });
  });
});
