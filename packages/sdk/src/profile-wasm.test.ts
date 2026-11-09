import { expect, test } from "bun:test";
import cases from "../../../crates/profile/src/tests/plan-cases.json" with { type: "json" };
import { loadProfileWasm } from "./profile-wasm.ts";

const profile = await loadProfileWasm();

function document(quantities: readonly object[]): string {
  return JSON.stringify({
    schema: 1,
    id: "case",
    name: "case",
    manufacturer: "test",
    version: "1.0.0",
    requires: ["modbus"],
    quantities,
  });
}

/** One u16 per register of each `[start, count]` span. */
function fromSpans(spans: readonly (readonly number[])[]): object[] {
  return spans.flatMap(([start = 0, count = 0]) =>
    Array.from({ length: count }, (_, i) => ({
      key: `r${start + i}`,
      role: "extra.r",
      register: start + i,
      type: "u16",
    })),
  );
}

test("the profile WASM reports the current schema", () => {
  expect(profile.schema()).toBe(1);
});

test("the profile WASM reports the schemas and capabilities it loads", () => {
  expect(profile.capabilities()).toEqual({
    schema: { min: 1, max: 1 },
    capabilities: ["modbus", "u16", "i16", "u32", "compute"],
  });
});

test("v4's planner cases plan the recorded blocks in the WASM build", () => {
  expect(cases).toHaveLength(16);

  for (const c of cases) {
    const doc = document("spans" in c ? fromSpans(c.spans) : c.quantities);
    const got = "split" in c ? profile.split(doc, c.split) : profile.readPlan(doc, c.gap);

    expect(got, c.name).toEqual(c.plan);
  }
});

test("a refused profile throws the loader's reason", () => {
  expect(() => profile.readPlan(JSON.stringify({ schema: 2 }), 0)).toThrow(
    "schema 2 is not supported; this build loads schema 1",
  );
});
