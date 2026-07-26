import { describe, expect, test } from "bun:test";

import { deriveCapabilities } from "./capabilities";
import { control, defineFamily, defineProfile, defineVariant, metric, sumOf } from "./define";
import { hydrateProfile, type MetricDataDef, type ProfileData } from "./profile-data";
import { safeParseProfileData } from "./schema";

/** A base with 2 PV strings, a ranged writable setting, and a computed PV total. */
function base(): ProfileData {
  return defineProfile({
    id: "acme-hybrid",
    name: "Acme Hybrid",
    manufacturer: "Acme",
    version: "1.0.0",
    metrics: [
      metric("dc/pv1/power", {
        label: "PV1 Power",
        unit: "W",
        group: "solar",
        addr: 672,
        role: "pv.string.power",
        index: 1,
      }),
      metric("dc/pv2/power", {
        label: "PV2 Power",
        unit: "W",
        group: "solar",
        addr: 673,
        role: "pv.string.power",
        index: 2,
      }),
      metric("dc/pv2/voltage", {
        label: "PV2 Voltage",
        unit: "V",
        group: "solar",
        addr: 678,
        scale: 0.1,
        role: "pv.string.voltage",
        index: 2,
      }),
      metric("settings/battery/maximum_discharge_current", {
        label: "Max battery discharge current",
        unit: "A",
        group: "settings",
        addr: 109,
        access: "rw",
        role: "setting.battery.max_discharge_current",
        range: { min: 0, max: 300 },
      }),
      metric("dc/total_power", {
        label: "PV Total",
        unit: "W",
        group: "solar",
        role: "pv.total.power",
        computeExpr: { sum: ["dc.pv1.power", "dc.pv2.power"] },
      }),
    ],
  });
}

const byKey = (p: ProfileData, key: string) => p.metrics.find((m) => m.key === key);

describe("defineVariant — patch", () => {
  test("max/min shorthand writes a range, merging over an existing one", () => {
    const v = defineVariant(base(), {
      id: "acme-15k",
      metrics: { "settings.battery.maximum_discharge_current": { max: 280 } },
    });
    expect(byKey(v, "settings.battery.maximum_discharge_current")?.range).toEqual({
      min: 0,
      max: 280,
    });
  });

  test("min alone keeps the existing max", () => {
    const v = defineVariant(base(), {
      id: "acme-x",
      metrics: { "settings.battery.maximum_discharge_current": { min: 20 } },
    });
    expect(byKey(v, "settings.battery.maximum_discharge_current")?.range).toEqual({
      min: 20,
      max: 300,
    });
  });

  test("max on a metric with no range creates one (min defaults to 0)", () => {
    const v = defineVariant(base(), {
      id: "acme-x",
      metrics: { "dc.pv1.power": { max: 6000 } },
    });
    expect(byKey(v, "dc.pv1.power")?.range).toEqual({ min: 0, max: 6000 });
  });

  test("addr / scale patch updates addresses and scale, keeping other fields", () => {
    const v = defineVariant(base(), {
      id: "acme-x",
      metrics: { "dc.pv1.power": { addr: 680, scale: 0.01 } },
    });
    const m = byKey(v, "dc.pv1.power");
    expect(m?.addresses).toEqual([680]);
    expect(m?.scale).toBe(0.01);
    expect(m?.label).toBe("PV1 Power"); // untouched
    expect(m?.role).toBe("pv.string.power");
  });
});

describe("defineVariant — remove", () => {
  test("null removes an exact key", () => {
    const v = defineVariant(base(), {
      id: "acme-x",
      metrics: { "dc.pv2.voltage": null },
    });
    expect(byKey(v, "dc.pv2.voltage")).toBeUndefined();
    expect(byKey(v, "dc.pv2.power")).toBeDefined();
  });

  test("trailing .* wildcard removes every metric under the prefix", () => {
    const v = defineVariant(base(), {
      id: "acme-5k",
      metrics: {
        "dc.pv2.*": null,
        "dc.total_power": { computeExpr: { sum: ["dc.pv1.power"] } },
      },
    });
    expect(byKey(v, "dc.pv2.power")).toBeUndefined();
    expect(byKey(v, "dc.pv2.voltage")).toBeUndefined();
    expect(byKey(v, "dc.pv1.power")).toBeDefined();
    // Removing a PV string drops it from derived capabilities.
    expect(deriveCapabilities(hydrateProfile(v)).pvStrings).toBe(1);
  });
});

describe("defineVariant — add", () => {
  test("unknown key + full definition adds a metric with topic derived from the key", () => {
    const v = defineVariant(base(), {
      id: "acme-20k",
      metrics: {
        "dc.pv3.power": {
          label: "PV3 Power",
          unit: "W",
          group: "solar",
          addr: 674,
          role: "pv.string.power",
          index: 3,
        },
      },
    });
    const m = byKey(v, "dc.pv3.power");
    expect(m).toBeDefined();
    expect(m?.topic).toBe("dc/pv3/power"); // dots → slashes
    expect(m?.addresses).toEqual([674]);
    // Added last, after the kept base metrics.
    expect(v.metrics.at(-1)?.key).toBe("dc.pv3.power");
    expect(deriveCapabilities(hydrateProfile(v)).pvStrings).toBe(3);
  });
});

describe("defineVariant — guards", () => {
  test("patching a key absent from the base throws", () => {
    expect(() =>
      defineVariant(base(), { id: "x", metrics: { "no.such.key": { scale: 2 } } }),
    ).toThrow(/no such metric/);
  });

  test("a wildcard matching zero metrics throws", () => {
    expect(() => defineVariant(base(), { id: "x", metrics: { "nope.*": null } })).toThrow(
      /matched no metrics/,
    );
  });

  test("an incomplete add (partial object on an unknown key) throws", () => {
    expect(() =>
      defineVariant(base(), { id: "x", metrics: { "dc.pv9.power": { unit: "W" } } }),
    ).toThrow(/full definition/);
  });

  test("does not mutate the base across derivations", () => {
    const b = base();
    const before = structuredClone(b);
    defineVariant(b, { id: "a", metrics: { "dc.pv2.*": null } });
    defineVariant(b, {
      id: "b",
      metrics: { "settings.battery.maximum_discharge_current": { max: 100 } },
    });
    expect(b).toEqual(before);
  });
});

describe("defineFamily", () => {
  const family = defineFamily({
    id: "acme-hybrid",
    name: "Acme Hybrid",
    manufacturer: "Acme",
    version: "1.0.0",
    metrics: base().metrics,
    models: {
      "acme-5k": {
        name: "Acme 5K",
        metrics: {
          "dc.pv2.*": null,
          "dc.total_power": { computeExpr: { sum: ["dc.pv1.power"] } },
          "settings.battery.maximum_discharge_current": { max: 120 },
        },
      },
      "acme-15k": {
        name: "Acme 15K",
        metrics: { "settings.battery.maximum_discharge_current": { max: 280 } },
      },
    },
  });

  test("returns the generic base first, then one profile per model keyed by id", () => {
    expect(family.map((p) => p.id)).toEqual(["acme-hybrid", "acme-5k", "acme-15k"]);
    expect(family[0]?.name).toBe("Acme Hybrid");
    expect(family[1]?.name).toBe("Acme 5K");
  });

  test("models inherit version + manufacturer from the base", () => {
    for (const p of family) {
      expect(p.version).toBe("1.0.0");
      expect(p.manufacturer).toBe("Acme");
    }
  });

  test("every emitted profile is a valid downloadable profile", () => {
    for (const p of family) {
      const r = safeParseProfileData(p);
      if (!r.success) console.error(p.id, r.error.issues);
      expect(r.success).toBe(true);
    }
  });

  test("per-model limits land on the setting range", () => {
    const disMax = (id: string) =>
      byKey(family.find((p) => p.id === id)!, "settings.battery.maximum_discharge_current")?.range
        ?.max;
    expect(disMax("acme-hybrid")).toBe(300);
    expect(disMax("acme-5k")).toBe(120);
    expect(disMax("acme-15k")).toBe(280);
  });
});

const total = (p: ProfileData) => byKey(p, "dc.total_power");

describe("sumOf — deferred aggregates", () => {
  test("defineProfile resolves an aggregate to a concrete sum, stripping the token", () => {
    const p = defineProfile({
      id: "acme-agg",
      name: "Acme Agg",
      manufacturer: "Acme",
      version: "1.0.0",
      metrics: [
        metric("dc/pv1/power", {
          label: "PV1",
          unit: "W",
          group: "solar",
          addr: 672,
          role: "pv.string.power",
          index: 1,
        }),
        metric("dc/pv2/power", {
          label: "PV2",
          unit: "W",
          group: "solar",
          addr: 673,
          role: "pv.string.power",
          index: 2,
        }),
        metric("dc/total_power", {
          label: "PV Total",
          unit: "W",
          group: "solar",
          role: "pv.total.power",
          computeExpr: sumOf({ role: "pv.string.power" }),
        }),
      ],
    });
    expect(total(p)?.computeExpr).toEqual({ sum: ["dc.pv1.power", "dc.pv2.power"] });
    expect(total(p)?.computeAggregate).toBeUndefined();
    expect(safeParseProfileData(p).success).toBe(true);
  });

  test("keyPrefix match sums the subtree, excluding the carrier itself", () => {
    const p = defineProfile({
      id: "acme-prefix",
      name: "Acme Prefix",
      manufacturer: "Acme",
      version: "1.0.0",
      metrics: [
        metric("bank/1/current", { label: "B1", unit: "A", group: "battery", addr: 591 }),
        metric("bank/2/current", { label: "B2", unit: "A", group: "battery", addr: 594 }),
        metric("bank/current", {
          label: "Total Current",
          unit: "A",
          group: "battery",
          computeExpr: sumOf({ keyPrefix: "bank" }),
        }),
      ],
    });
    expect(byKey(p, "bank.current")?.computeExpr).toEqual({
      sum: ["bank.1.current", "bank.2.current"],
    });
  });

  test("an aggregate matching nothing throws (never a silent empty sum)", () => {
    expect(() =>
      defineProfile({
        id: "acme-empty",
        name: "x",
        manufacturer: "x",
        version: "1.0.0",
        metrics: [
          metric("dc/total_power", {
            label: "PV Total",
            unit: "W",
            group: "solar",
            role: "pv.total.power",
            computeExpr: sumOf({ role: "pv.string.power" }),
          }),
        ],
      }),
    ).toThrow(/matched no metrics/);
  });

  test("a family self-heals: dropping a string re-derives each model's sum", () => {
    const family = defineFamily({
      id: "acme-solar",
      name: "Acme Solar",
      manufacturer: "Acme",
      version: "1.0.0",
      metrics: [
        metric("dc/pv1/power", {
          label: "PV1",
          unit: "W",
          group: "solar",
          addr: 672,
          role: "pv.string.power",
          index: 1,
        }),
        metric("dc/pv2/power", {
          label: "PV2",
          unit: "W",
          group: "solar",
          addr: 673,
          role: "pv.string.power",
          index: 2,
        }),
        metric("dc/total_power", {
          label: "PV Total",
          unit: "W",
          group: "solar",
          role: "pv.total.power",
          // No per-model patch anywhere — the aggregate tracks the survivors.
          computeExpr: sumOf({ role: "pv.string.power" }),
        }),
      ],
      models: {
        // 1-string SKU: drop the whole pv2 string.
        "acme-1s": { name: "Acme 1S", metrics: { "dc.pv2.*": null } },
        // 3-string SKU: add pv3.
        "acme-3s": {
          name: "Acme 3S",
          metrics: {
            "dc.pv3.power": {
              label: "PV3",
              unit: "W",
              group: "solar",
              addr: 674,
              role: "pv.string.power",
              index: 3,
            },
          },
        },
      },
    });
    const at = (id: string) => total(family.find((p) => p.id === id)!)?.computeExpr;
    expect(at("acme-solar")).toEqual({ sum: ["dc.pv1.power", "dc.pv2.power"] });
    expect(at("acme-1s")).toEqual({ sum: ["dc.pv1.power"] });
    expect(at("acme-3s")).toEqual({ sum: ["dc.pv1.power", "dc.pv2.power", "dc.pv3.power"] });
    for (const p of family) expect(safeParseProfileData(p).success).toBe(true);
  });
});

describe("defineVariant — dependency-aware removal", () => {
  test("removing a string prunes an explicit sum survivor (no manual patch)", () => {
    const v = defineVariant(base(), { id: "acme-1s", metrics: { "dc.pv2.*": null } });
    expect(total(v)?.computeExpr).toEqual({ sum: ["dc.pv1.power"] });
  });

  test("removing every summed key throws rather than shipping an empty sum", () => {
    expect(() =>
      defineVariant(base(), { id: "x", metrics: { "dc.pv1.*": null, "dc.pv2.*": null } }),
    ).toThrow(/empties a sum/);
  });

  function fixedArityBase(): ProfileData {
    return defineProfile({
      id: "acme-fixed",
      name: "x",
      manufacturer: "x",
      version: "1.0.0",
      metrics: [
        metric("a/x", { label: "A", unit: "W", group: "g", addr: 1 }),
        metric("b/y", { label: "B", unit: "W", group: "g", addr: 2 }),
        metric("delta", {
          label: "Delta",
          unit: "W",
          group: "g",
          computeExpr: { diff: ["a.x", "b.y"] },
        }),
      ],
    });
  }

  test("removing a key a fixed-arity diff needs throws", () => {
    expect(() => defineVariant(fixedArityBase(), { id: "x", metrics: { "b.y": null } })).toThrow(
      /fixed-arity diff/,
    );
  });

  /** A base whose computed metrics cover every remaining `ComputeExpr` kind. */
  function exprBase(computed: MetricDataDef[]): ProfileData {
    return defineProfile({
      id: "acme-expr",
      name: "x",
      manufacturer: "x",
      version: "1.0.0",
      metrics: [
        metric("a/x", { label: "A", unit: "W", group: "g", addr: 1 }),
        metric("b/y", { label: "B", unit: "W", group: "g", addr: 2 }),
        metric("c/z", { label: "C", unit: "W", group: "g", addr: 3 }),
        ...computed,
      ],
    });
  }

  const derived = (key: string, computeExpr: MetricDataDef["computeExpr"]) =>
    metric(key, { label: key, unit: "W", group: "g", computeExpr });

  test("removing a scale's operand throws", () => {
    const p = exprBase([derived("scaled", { scale: ["a.x", 0.1] })]);
    expect(() => defineVariant(p, { id: "x", metrics: { "a.x": null } })).toThrow(
      /fixed-arity scale/,
    );
  });

  test("removing a clamp's key throws", () => {
    const p = exprBase([derived("clamped", { clamp: { key: "a.x", min: 0 } })]);
    expect(() => defineVariant(p, { id: "x", metrics: { "a.x": null } })).toThrow(
      /single-key clamp/,
    );
  });

  test("combine prunes both add and sub, dropping an emptied sub", () => {
    const p = exprBase([derived("net", { combine: { add: ["a.x", "b.y"], sub: ["c.z"] } })]);
    const v = defineVariant(p, { id: "x", metrics: { "b.y": null, "c.z": null } });
    expect(byKey(v, "net")?.computeExpr).toEqual({ combine: { add: ["a.x"] } });
  });

  test("combine keeps a surviving sub operand", () => {
    const p = exprBase([derived("net", { combine: { add: ["a.x", "b.y"], sub: ["c.z"] } })]);
    const v = defineVariant(p, { id: "x", metrics: { "b.y": null } });
    expect(byKey(v, "net")?.computeExpr).toEqual({ combine: { add: ["a.x"], sub: ["c.z"] } });
  });

  test("emptying combine.add throws", () => {
    const p = exprBase([derived("net", { combine: { add: ["a.x"], sub: ["c.z"] } })]);
    expect(() => defineVariant(p, { id: "x", metrics: { "a.x": null } })).toThrow(
      /empties combine\.add/,
    );
  });

  test("ratio prunes num and den, preserving an explicit scale", () => {
    const p = exprBase([
      derived("eff", { ratio: { num: ["a.x", "b.y"], den: ["b.y", "c.z"], scale: 100 } }),
    ]);
    const v = defineVariant(p, { id: "x", metrics: { "b.y": null } });
    expect(byKey(v, "eff")?.computeExpr).toEqual({
      ratio: { num: ["a.x"], den: ["c.z"], scale: 100 },
    });
  });

  test("ratio without a scale prunes to a bare num/den", () => {
    const p = exprBase([derived("eff", { ratio: { num: ["a.x", "b.y"], den: ["c.z"] } })]);
    const v = defineVariant(p, { id: "x", metrics: { "b.y": null } });
    expect(byKey(v, "eff")?.computeExpr).toEqual({ ratio: { num: ["a.x"], den: ["c.z"] } });
  });

  test("emptying ratio.den throws", () => {
    const p = exprBase([derived("eff", { ratio: { num: ["a.x"], den: ["c.z"] } })]);
    expect(() => defineVariant(p, { id: "x", metrics: { "c.z": null } })).toThrow(
      /empties ratio\.den/,
    );
  });

  test("an expr untouched by the removal keeps its original operands", () => {
    const p = exprBase([derived("net", { combine: { add: ["a.x"], sub: ["b.y"] } })]);
    const v = defineVariant(p, { id: "x", metrics: { "c.z": null } });
    expect(byKey(v, "net")?.computeExpr).toEqual({ combine: { add: ["a.x"], sub: ["b.y"] } });
  });

  test("removing a control's target throws", () => {
    const withControl = defineProfile({
      id: "acme-ctl",
      name: "x",
      manufacturer: "x",
      version: "1.0.0",
      metrics: [
        metric("settings/battery/maximum_discharge_current", {
          label: "Max discharge",
          unit: "A",
          group: "settings",
          addr: 109,
          access: "rw",
          role: "setting.battery.max_discharge_current",
          range: { min: 0, max: 300 },
        }),
        control("settings/battery/lock", {
          label: "Lock",
          group: "settings",
          enumLabels: { 0: "Unlocked", 1: "Locked" },
          controlExpr: {
            snapshotToggle: {
              target: "settings.battery.maximum_discharge_current",
              lockedValue: 0,
            },
          },
        }),
      ],
    });
    expect(() =>
      defineVariant(withControl, {
        id: "x",
        metrics: { "settings.battery.maximum_discharge_current": null },
      }),
    ).toThrow(/control .* targets it/);
  });

  test("does not mutate the base's aggregate tokens across a family", () => {
    const metrics = [
      metric("dc/pv1/power", {
        label: "PV1",
        unit: "W",
        group: "solar",
        addr: 672,
        role: "pv.string.power",
        index: 1,
      }),
      metric("dc/total_power", {
        label: "PV Total",
        unit: "W",
        group: "solar",
        role: "pv.total.power",
        computeExpr: sumOf({ role: "pv.string.power" }),
      }),
    ];
    const before = structuredClone(metrics);
    defineFamily({
      id: "acme-x",
      name: "x",
      manufacturer: "x",
      version: "1.0.0",
      metrics,
      models: { "acme-y": { metrics: {} } },
    });
    expect(metrics).toEqual(before);
  });
});
