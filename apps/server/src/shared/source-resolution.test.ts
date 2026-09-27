import { describe, expect, test } from "bun:test";
import type { ManifestMetric } from "@SunReye/inverter-core";
import type { PlantMember } from "./plant-source";
import { createSourceResolution } from "./source-resolution";

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
  meta("grid_v", "grid.phase.voltage"),
]);
const two: PlantMember[] = [
  { id: 1, slug: "inv-1", weight: 1 },
  { id: 2, slug: "inv-2", weight: 1 },
];

/** A resolution over injected collaborators, counting member reads. */
function resolution(primary: string | null, members: PlantMember[] = two) {
  const calls = { members: 0 };
  const sources = createSourceResolution({
    primarySlug: () => primary,
    members: async () => {
      calls.members++;
      return members;
    },
    metaByKey,
  });
  return { sources, calls };
}

describe("createSourceResolution — defaultSourceId", () => {
  test("is the primary device's slug", () => {
    expect(resolution("inv-1").sources.defaultSourceId()).toBe("inv-1");
  });

  test("is null when the plant has no primary device yet", () => {
    expect(resolution(null).sources.defaultSourceId()).toBeNull();
  });

  test("re-reads the primary per call, so a roster change is seen without a rebuild", () => {
    let primary: string | null = null;
    const sources = createSourceResolution({
      primarySlug: () => primary,
      members: async () => two,
      metaByKey,
    });
    expect(sources.defaultSourceId()).toBeNull();
    primary = "inv-2";
    expect(sources.defaultSourceId()).toBe("inv-2");
  });
});

describe("createSourceResolution — sourceRequest", () => {
  test("source=plant is the plant", () => {
    expect(resolution("inv-1").sources.sourceRequest({ source: "plant" })).toEqual({
      kind: "plant",
    });
  });

  test("a device slug is that device, over the primary", () => {
    expect(resolution("inv-1").sources.sourceRequest({ source: "inv-2" })).toEqual({
      kind: "device",
      slug: "inv-2",
    });
  });

  test("the inverterId alias still names a device", () => {
    expect(resolution("inv-1").sources.sourceRequest({ inverterId: "inv-2" })).toEqual({
      kind: "device",
      slug: "inv-2",
    });
  });

  test("an unknown slug is passed through, not refused — the reader answers it empty", () => {
    // Pinned as-is: resolution does not check the roster. A refusal would be a
    // behaviour change, decided elsewhere.
    expect(resolution("inv-1").sources.sourceRequest({ source: "no-such-device" })).toEqual({
      kind: "device",
      slug: "no-such-device",
    });
  });

  test("nothing named, and an empty source, fall back to the primary device", () => {
    const { sources } = resolution("inv-1");
    expect(sources.sourceRequest({})).toEqual({ kind: "device", slug: "inv-1" });
    expect(sources.sourceRequest({ source: "" })).toEqual({ kind: "device", slug: "inv-1" });
  });

  test("nothing named and no primary device is null — the route's onboarding 503", () => {
    expect(resolution(null).sources.sourceRequest({})).toBeNull();
  });
});

describe("createSourceResolution — energyTarget", () => {
  test("a device slug targets that slug and never reads the members", async () => {
    const { sources, calls } = resolution("inv-1");
    expect(await sources.energyTarget({ source: "inv-2" })).toBe("inv-2");
    expect(calls.members).toBe(0);
  });

  test("the plant targets its member set", async () => {
    expect(await resolution("inv-1").sources.energyTarget({ source: "plant" })).toEqual({
      plant: two,
    });
  });

  test("nothing named targets the primary device by slug", async () => {
    expect(await resolution("inv-1").sources.energyTarget({})).toBe("inv-1");
  });

  test("no primary device and nothing named is undefined — the readers' own default", async () => {
    expect(await resolution(null).sources.energyTarget({})).toBeUndefined();
  });
});

describe("createSourceResolution — metricReadArgs and aggregateOf", () => {
  test("a device reads its slug, a per-device metric included", async () => {
    expect(
      await resolution("inv-1").sources.metricReadArgs({ kind: "device", slug: "inv-2" }, "grid_v"),
    ).toEqual({ inverterId: "inv-2" });
  });

  test("the plant folds a summable metric over its members", async () => {
    expect(await resolution("inv-1").sources.metricReadArgs({ kind: "plant" }, "pv_power")).toEqual(
      {
        inverterId: "plant",
        plant: { members: two, aggregate: "sum" },
      },
    );
  });

  test("the plant refuses a per-device metric", async () => {
    const args = await resolution("inv-1").sources.metricReadArgs({ kind: "plant" }, "grid_v");
    expect(args).toHaveProperty("error");
  });

  test("a plant of one member reads as that device", async () => {
    const sole = [{ id: 1, slug: "inv-1", weight: 1 }];
    expect(
      await resolution("inv-1", sole).sources.metricReadArgs({ kind: "plant" }, "grid_v"),
    ).toEqual({ inverterId: "inv-1" });
  });

  test("aggregateOf goes through the injected manifest; an unknown key is per-device", () => {
    const { aggregateOf } = resolution("inv-1").sources;
    expect(aggregateOf("pv_power")).toBe("sum");
    expect(aggregateOf("never-seen")).toBe("per-device");
  });
});
