import { describe, expect, test } from "bun:test";
import type { EntityConstraint } from "@SunReye/inverter-core";
import { Value } from "typebox/value";
import { rangeNote, valueSchema } from "./entity-schema";

const constraint = (over: Partial<EntityConstraint> = {}): EntityConstraint => ({
  writable: true,
  valueType: "number",
  ...over,
});

describe("valueSchema", () => {
  test("an unbounded number accepts any number and rejects non-numbers", () => {
    const schema = valueSchema(constraint());
    expect(Value.Check(schema, 12_345)).toBe(true);
    expect(Value.Check(schema, -7.5)).toBe(true);
    expect(Value.Check(schema, "12")).toBe(false);
  });

  test("declared bounds are enforced inclusively", () => {
    const schema = valueSchema(constraint({ min: 0, max: 185 }));
    expect(Value.Check(schema, 0)).toBe(true);
    expect(Value.Check(schema, 185)).toBe(true);
    expect(Value.Check(schema, -1)).toBe(false);
    expect(Value.Check(schema, 186)).toBe(false);
  });

  test("a one-sided bound leaves the other side open", () => {
    const schema = valueSchema(constraint({ min: 10 }));
    expect(Value.Check(schema, 1_000_000)).toBe(true);
    expect(Value.Check(schema, 9)).toBe(false);
  });

  test("an enum accepts only its declared raw values", () => {
    const schema = valueSchema(constraint({ valueType: "enum", enumValues: [0, 2, 3] }));
    expect(Value.Check(schema, 2)).toBe(true);
    expect(Value.Check(schema, 1)).toBe(false);
  });

  test("an enum with no values degrades to a plain number", () => {
    const schema = valueSchema(constraint({ valueType: "enum", enumValues: [] }));
    expect(Value.Check(schema, 42)).toBe(true);
  });
});

describe("rangeNote", () => {
  test("enum lists the accepted raw values", () => {
    expect(rangeNote(constraint({ valueType: "enum", enumValues: [0, 1] }), null)).toBe(
      "Allowed values: 0, 1.",
    );
  });

  test("bounded number reports the range and the unit", () => {
    expect(rangeNote(constraint({ min: 0, max: 185 }), "A")).toBe("Range: 0..185 A.");
  });

  test("a one-sided bound shows an infinity for the open side, unit omitted when absent", () => {
    expect(rangeNote(constraint({ min: 5 }), null)).toBe("Range: 5..∞.");
    expect(rangeNote(constraint({ max: 5 }), null)).toBe("Range: -∞..5.");
  });

  test("no bounds at all is called out as unbounded", () => {
    expect(rangeNote(constraint(), "W")).toBe("Unbounded numeric value.");
  });
});
