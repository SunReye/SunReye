import { describe, expect, test } from "bun:test";

import { jsonDocument } from "./json-value";

describe("jsonDocument", () => {
  test("an object comes back as itself", () => {
    expect(jsonDocument({ a: 1 })).toEqual({ a: 1 });
  });

  test("a JSON-STRING-wrapped document is unwrapped", () => {
    // Not hypothetical: bun's `SQL` stores a JS string bound to a jsonb column
    // this way, which is why every app_settings row in the 1.2.0 fixture is
    // double-encoded. Measured, not assumed — see writeMigrationRecord.
    expect(jsonDocument('{"stage":"carried","sourceId":"deye-sg05lp3"}')).toEqual({
      stage: "carried",
      sourceId: "deye-sg05lp3",
    });
  });

  test("a plain string that is not JSON comes back as itself", () => {
    // A legitimate setting value: a time zone, a bidding zone, a tariff key.
    expect(jsonDocument("Europe/Berlin")).toBe("Europe/Berlin");
  });

  test("only ONE level is unwrapped — a twice-nested document is a bug, not a shape", () => {
    expect(jsonDocument(JSON.stringify(JSON.stringify({ a: 1 })))).toBe('{"a":1}');
  });

  test("null, undefined and a number are left alone", () => {
    expect(jsonDocument(null)).toBeNull();
    expect(jsonDocument(undefined)).toBeUndefined();
    expect(jsonDocument(7)).toBe(7);
  });

  test("a JSON string holding a scalar unwraps to that scalar", () => {
    // 1.2.0 stored `inverter.profile` as `"\"deye-sg05lp3\""`.
    expect(jsonDocument('"deye-sg05lp3"')).toBe("deye-sg05lp3");
  });
});
