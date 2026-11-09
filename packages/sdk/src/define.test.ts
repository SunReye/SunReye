import { expect, test } from "bun:test";
import { defineProfile, loadProfileWasm } from "./index.ts";

const wasm = await loadProfileWasm();

const header = {
  schema: 1,
  id: "case",
  name: "case",
  manufacturer: "test",
  version: "1.0.0",
  requires: ["modbus", "u16", "write"],
} as const;

test("a defined profile loads in the WASM without a warning", () => {
  const profile = defineProfile({
    ...header,
    quantities: [{ key: "soc", role: "battery.soc", register: 588, type: "u16" }],
    settings: [
      {
        key: "limit",
        type: "u16",
        range: { min: 0, max: 100 },
        minInterval: 60,
        recipe: [{ write: { register: 143 } }],
        readBack: { register: 143 },
      },
    ],
  });

  expect(wasm.lint(JSON.stringify(profile))).toEqual([]);
});

// The `@ts-expect-error` lines are the autocomplete proof: `tsc` in the gate fails if the generated
// types stop rejecting a misspelt field.
test("a misspelt field fails to compile and to load", () => {
  const top = defineProfile({
    ...header,
    quantities: [],
    // @ts-expect-error `manufactuer` is not a profile field
    manufactuer: "test",
  });

  const quantity = defineProfile({
    ...header,
    // @ts-expect-error `regster` is not a quantity field
    quantities: [{ key: "soc", role: "battery.soc", regster: 588, type: "u16" }],
  });

  const setting = defineProfile({
    ...header,
    quantities: [],
    settings: [
      {
        key: "limit",
        type: "u16",
        range: { min: 0, max: 100 },
        minInterval: 60,
        recipe: [{ write: { register: 143 } }],
        // @ts-expect-error `readback` is not a setting field
        readback: { register: 143 },
      },
    ],
  });

  expect(() => wasm.lint(JSON.stringify(top))).toThrow("unknown field `manufactuer`");
  expect(() => wasm.lint(JSON.stringify(quantity))).toThrow("unknown field `regster`");
  expect(() => wasm.lint(JSON.stringify(setting))).toThrow("unknown field `readback`");
});

test("a capability outside the table fails to compile", () => {
  const profile = defineProfile({
    ...header,
    // @ts-expect-error `http` is not in the capability table
    requires: ["modbus", "http"],
    quantities: [],
  });

  expect(() => wasm.lint(JSON.stringify(profile))).toThrow("lacks the required capability `http`");
});
