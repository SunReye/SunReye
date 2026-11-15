import { expect, test } from "bun:test";
import type { Frozen, Profile, Quantity } from "./index.ts";
import { defineFamily, loadProfileWasm } from "./index.ts";

const wasm = await loadProfileWasm();

const MPPT = { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 };

/** A Deye-shaped profile reading `inputs` PV inputs, its battery current bounded by `current`. */
function model(name: string, inputs: number, current: number, rated?: number): Frozen<Profile> {
  const pv: Frozen<Quantity>[] = Array.from({ length: inputs }, (_, i) => ({
    key: `pv${i + 1}`,
    role: "pv.mppt.power",
    index: i + 1,
    register: 672 + i,
    type: "u16",
  }));

  const keys = pv.map((q) => q.key);

  return {
    schema: 1,
    id: "family",
    name,
    manufacturer: "test",
    version: "1.0.0",
    requires: ["modbus", "u16", "u32", "compute", "write", "identify", "ac-rating", "variants"],
    identify: [
      { register: 0, values: [0x0500] },
      rated === undefined
        ? { register: 20, type: "u32" }
        : { register: 20, type: "u32", values: [rated * 10] },
    ],
    inverter: { maxInputVoltage: 800, acRating: rated ?? 20_000, mppt: [MPPT] },
    quantities: [
      ...pv,
      { key: "total", role: "pv.power", compute: { sum: keys } },
      { key: "load", role: "load.power", register: 653, type: "u16" },
    ],
    settings: [
      {
        key: "current",
        type: "u16",
        range: { min: 0, max: current },
        minInterval: 60,
        recipe: [{ write: { register: 108 } }],
        readBack: { register: 108 },
      },
    ],
  };
}

test("a family holds each member as the base with only what differs", () => {
  const family = defineFamily(model("Family", 2, 350), [
    { id: "5k", profile: model("5K", 1, 120, 5000) },
    { id: "20k", profile: model("20K", 2, 350, 20_000) },
  ]);

  expect(family.variants).toEqual([
    {
      id: "5k",
      name: "5K",
      identify: [{ register: 20, values: [50_000] }],
      inverter: { maxInputVoltage: 800, acRating: 5000, mppt: [MPPT] },
      settings: { current: { min: 0, max: 120 } },
      drop: ["pv2", "total"],
      add: [{ key: "total", role: "pv.power", compute: { sum: ["pv1"] } }],
    },
    { id: "20k", name: "20K", identify: [{ register: 20, values: [200_000] }] },
  ]);
  expect(wasm.lint(JSON.stringify(family))).toEqual([]);
});

test("a member that differs in what a variant cannot override is refused", () => {
  const other = { ...model("5K", 2, 120, 5000), manufacturer: "other" };

  expect(() => defineFamily(model("Family", 2, 350), [{ id: "5k", profile: other }])).toThrow(
    "variant 5k differs from the base in manufacturer",
  );
});

test("what a member adds to the base's identify fields or settings is the loader's to refuse", () => {
  const base = model("Family", 2, 350);
  const small = model("5K", 2, 120, 5000);
  const [current] = small.settings ?? [];

  const probed = { ...small, identify: [...(small.identify ?? []), { register: 30, values: [1] }] };

  const set = {
    ...small,
    settings: current === undefined ? [] : [current, { ...current, key: "more" }],
  };

  const refused = (profile: Frozen<Profile>) => () =>
    wasm.lint(JSON.stringify(defineFamily(base, [{ id: "5k", profile }])));

  expect(refused(probed)).toThrow("identify register 30 is not a field of the base");
  expect(refused(set)).toThrow("setting `more` is not the base's");
});

test("a member that drops an identify field or a setting of the base is refused", () => {
  const base = model("Family", 2, 350);
  const small = model("5K", 2, 120, 5000);

  expect(() =>
    defineFamily(base, [
      { id: "5k", profile: { ...small, identify: (small.identify ?? []).slice(1) } },
    ]),
  ).toThrow("variant 5k differs from the base in an identify field other than its values");
  expect(() => defineFamily(base, [{ id: "5k", profile: { ...small, settings: [] } }])).toThrow(
    "variant 5k differs from the base in a setting other than its range",
  );
});

test("a member whose quantities a variant cannot order is refused", () => {
  const base = model("Family", 2, 350);
  const [first, second, ...rest] = base.quantities;
  const swapped = { ...base, quantities: [second, first, ...rest].filter((q) => q !== undefined) };

  expect(() => defineFamily(base, [{ id: "5k", profile: swapped }])).toThrow(
    "variant 5k orders its quantities apart from the base",
  );
});

test("a member's retired profile ids reach its variant, which the loader takes", () => {
  const family = defineFamily(model("Family", 2, 350), [
    { id: "5k", profile: model("5K", 1, 120, 5000), replaces: ["family-5k"] },
    { id: "20k", profile: model("20K", 2, 350, 20_000) },
  ]);

  expect(family.variants?.map((v) => v.replaces)).toEqual([["family-5k"], undefined]);
  expect(wasm.lint(JSON.stringify(family))).toEqual([]);
});
