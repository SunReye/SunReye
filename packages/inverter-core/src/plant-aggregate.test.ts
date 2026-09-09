import { describe, expect, test } from "bun:test";
import { PLANT_AGGREGATES, type PlantAggregate, plantAggregateOf } from "./plant-aggregate";
import { ROLE_CATALOG, ROLE_NAMES } from "./roles";

describe("plantAggregateOf — how a role folds across a plant's devices", () => {
  test("every canonical role resolves to exactly one aggregate", () => {
    // Exhaustiveness: a new role cannot land without a plant-level answer.
    for (const role of ROLE_NAMES) {
      expect(PLANT_AGGREGATES).toContain(plantAggregateOf(role));
    }
  });

  const cases: Array<[string, PlantAggregate]> = [
    // Power and energy add up.
    ["pv.total.power", "sum"],
    ["battery.power", "sum"],
    ["grid.power", "sum"],
    ["load.power", "sum"],
    ["production.today", "sum"],
    ["production.total", "sum"],
    ["grid.energy.imported.total", "sum"],
    // A fraction or a temperature is a capacity-weighted mean.
    ["battery.soc", "weighted-mean"],
    ["battery.temperature", "weighted-mean"],
    // Electrical state of one machine has no plant reading.
    ["battery.voltage", "per-device"],
    ["grid.frequency", "per-device"],
    ["battery.current", "per-device"],
    // Indexed roles (phases, strings) are the device's own geometry.
    ["pv.string.power", "per-device"],
    ["grid.phase.current", "per-device"],
    ["pv.string.energy.total", "per-device"],
    // Status and settings never fold.
    ["inverter.status", "per-device"],
    ["setting.work_mode", "per-device"],
    ["battery.mode", "per-device"],
  ];
  for (const [role, expected] of cases) {
    test(`${role} → ${expected}`, () => {
      expect(role in ROLE_CATALOG).toBe(true);
      expect(plantAggregateOf(role)).toBe(expected);
    });
  }

  test("a role of another device class is never summed into the plant", () => {
    // A charger's or the optimizer's readings are their own device's; the plant
    // set (`plantMembers`) excludes those classes, and this agrees with it.
    expect(plantAggregateOf("ev.charge.power")).toBe("per-device");
    expect(plantAggregateOf("optimizer.threshold.power")).toBe("per-device");
  });

  test("an unknown role is per-device — the answer that cannot invent a total", () => {
    expect(plantAggregateOf("vendor.mystery")).toBe("per-device");
    expect(plantAggregateOf(undefined)).toBe("per-device");
  });

  test("an explicit `aggregate` on the spec wins over the derivation", () => {
    expect(plantAggregateOf("x", { kind: "measurement", unitHint: "V", aggregate: "sum" })).toBe(
      "sum",
    );
  });
});
