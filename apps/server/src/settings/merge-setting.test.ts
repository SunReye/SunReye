import { describe, expect, test } from "bun:test";
import { mergeSetting } from "./merge-setting";

/**
 * The point of this is that two forms can own different halves of one settings
 * record without either undoing the other, so the tests are mostly about what a
 * partial update must NOT touch.
 */
describe("mergeSetting", () => {
  test("keeps the fields the update does not mention", () => {
    const stored = { enabled: true, label: "Roof", forecast: { provider: "dwd", arrays: [1] } };
    expect(mergeSetting(stored, { label: "Garage" })).toEqual({
      enabled: true,
      label: "Garage",
      forecast: { provider: "dwd", arrays: [1] },
    });
  });

  test("merges nested records rather than replacing them", () => {
    // The case that forced this: the plant form owns `forecast.arrays`, the
    // weather form owns `forecast.provider`. Replacing the nested object would
    // make each save delete the other's field.
    const stored = { forecast: { provider: "dwd", correction: { enabled: true }, tilt: 30 } };
    expect(mergeSetting(stored, { forecast: { tilt: 35 } })).toEqual({
      forecast: { provider: "dwd", correction: { enabled: true }, tilt: 35 },
    });
  });

  test("replaces an array wholesale — a list is a value, not a structure", () => {
    // Index-wise merging turns "delete the second of three" into "keep the third
    // under the second's index".
    const stored = { arrays: [{ kwp: 5 }, { kwp: 3 }, { kwp: 2 }] };
    expect(mergeSetting(stored, { arrays: [{ kwp: 5 }, { kwp: 2 }] })).toEqual({
      arrays: [{ kwp: 5 }, { kwp: 2 }],
    });
  });

  test("treats null as a value, so a field can be cleared", () => {
    // The smart-meter date: "no gateway" is an answer, and it has to be
    // expressible. Collapsing null into "absent" would make the field one-way.
    const stored = { forecast: { smartMeterSince: "2026-01-01", maxOutputW: 7000 } };
    expect(mergeSetting(stored, { forecast: { smartMeterSince: null } })).toEqual({
      forecast: { smartMeterSince: null, maxOutputW: 7000 },
    });
  });

  test("treats undefined as absent, so an omitted key is left alone", () => {
    const stored = { a: 1, b: 2 };
    expect(mergeSetting(stored, { a: undefined, b: 3 })).toEqual({ a: 1, b: 3 });
  });

  test("adds a key the stored record has never held", () => {
    expect(mergeSetting({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  test("mutates neither input — a cached record is shared with its readers", () => {
    const stored = { forecast: { provider: "dwd" } };
    const patch = { forecast: { provider: "meteo" } };
    const merged = mergeSetting(stored, patch);
    expect(stored).toEqual({ forecast: { provider: "dwd" } });
    expect(patch).toEqual({ forecast: { provider: "meteo" } });
    expect(merged).not.toBe(stored);
  });

  test("a non-object update replaces outright", () => {
    // A scalar setting, or a caller replacing a nested record with a primitive.
    expect(mergeSetting({ a: 1 }, 5)).toBe(5);
    expect(mergeSetting({ a: 1 }, null)).toBeNull();
    expect(mergeSetting(3, { a: 1 })).toEqual({ a: 1 });
  });
});
