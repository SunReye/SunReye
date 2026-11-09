import { expect, test } from "bun:test";
import cases from "../../../crates/profile/src/tests/plan-cases.json" with { type: "json" };
import v4Cases from "../../../crates/profile/src/tests/deye-sg05lp3-v4-cases.json" with { type: "json" };
import { loadProfileWasm } from "./index.ts";

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
    capabilities: [
      "modbus",
      "mqtt",
      "u16",
      "i16",
      "u32",
      "scale-factor",
      "compute",
      "write",
      "write-block",
      "rmw",
      "activate",
      "precondition",
      "unlock",
      "delay",
      "snapshot-toggle",
      "publish",
    ],
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

test("the profile WASM's warnings are the loader's text", () => {
  const doc = document([{ key: "a", role: "extra.a", register: 1, type: "u32" }]);

  expect(profile.lint(doc)).toEqual(["`requires` lacks `u32`, which the profile uses"]);
});

test("a dump of v4's recorded Deye cases decodes to v4's readings", async () => {
  const deye = await Bun.file(
    new URL("../../../profiles/deye-sg05lp3.json", import.meta.url),
  ).text();

  expect(v4Cases).toHaveLength(6);

  for (const c of v4Cases) {
    expect(profile.decode(deye, JSON.stringify(c.runs)), c.name).toEqual(c.readings);
  }
});

test("a dump that lacks one register of a planned block decodes nothing from that block", () => {
  const doc = document([
    { key: "a", role: "extra.a", register: 1, type: "u16" },
    { key: "b", role: "extra.b", register: 2, type: "u16" },
    { key: "c", role: "extra.c", register: 9, type: "u16" },
  ]);

  const dump = JSON.stringify([
    { start: 1, words: [7] },
    { start: 9, words: [3] },
  ]);

  expect(profile.decode(doc, dump)).toEqual({
    a: null,
    b: null,
    c: 3,
  });
});
