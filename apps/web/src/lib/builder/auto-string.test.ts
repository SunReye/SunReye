/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { StringDraft } from "../api/core.ts";
import { loadPv, type InputLimits } from "@sunreye/pv-wasm";
import type { ModuleType } from "@sunreye/scene";
import { strungOn } from "../../../../../packages/builder/src/builder/auto-string.ts";
import { addGrid, type Draft } from "../../../../../packages/builder/src/builder/modules.ts";
import { place } from "../../../../../packages/builder/src/builder/placing.ts";
import type { Scene } from "../../../../../packages/builder/src/builder/pv.ts";
import { wiredInto } from "../../../../../packages/builder/src/builder/selecting.ts";

const block = {
  x: 0,
  z: 0,
  width: 10,
  depth: 8,
  eave: 3,
  rotation: 0,
  roof: { kind: "gable", pitch: 35 },
} as const;

const bare: Scene = { north: 0, blocks: [block], obstacles: [], grids: [] };

/** Two rows of eight portrait modules from the setback's corner: 0–7 below, 8–15 above. */
const spots = Array.from({ length: 16 }, (_, i) => ({
  across: 0.3 + (i % 8) * 1.154,
  up: 0.3 + Math.floor(i / 8) * 1.742,
  landscape: false,
}));

const scene = place(addGrid(bare, 0, 1, 7), 0, spots);

const first: StringDraft = {
  name: "Garage",
  moduleType: 7,
  device: 1,
  input: 1,
  modules: 0,
  optimized: 0,
  tilt: 0,
  azimuth: 0,
  loss: 3,
};

const draft: Draft = { scene, strings: [first] };
const name = (number: number) => `String ${String(number)}`;

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

/** Its cold peak is 37.21 V and its short-circuit current 12.5 A: a window of 230 V takes 6 in
 * series, 270 V 7 and 380 V 10, and 30 A carries two strings in parallel, 15 A one. */
const MODULE: ModuleType = {
  id: 7,
  name: "Owner 400",
  pmax: 400,
  vmp: 34,
  imp: 11.76,
  voc: 41,
  isc: 12.5,
  powerCoefficient: -0.35,
  voltageCoefficient: -0.27,
  currentCoefficient: 0.05,
  width: 1.134,
  height: 1.722,
  bypassDiodes: 3,
};

/** An input whose window takes up to `volts` and whose current carries `amperes`. */
const input = (volts: number, amperes: number): InputLimits => ({
  maxCurrent: amperes,
  minVoltage: 0,
  maxVoltage: volts,
  startVoltage: 0,
});

/** `count` inputs alike. */
const alike = (count: number, volts: number, amperes: number) =>
  Array.from({ length: count }, () => input(volts, amperes));

/** The modules of string `string` in their wiring order, by their position in the grid. */
function run(of: Draft | null, string: number): number[] {
  const modules = of?.scene.grids?.[0]?.modules ?? [];

  return modules
    .flatMap((module, at) => (module.string === string ? [[module.order ?? -1, at] as const] : []))
    .toSorted((a, b) => a[0] - b[0])
    .map(([, at]) => at);
}

/** Each new string's input and its modules in wiring order. */
const made = (of: Draft | undefined) =>
  (of?.strings ?? []).slice(1).map((string, i) => [string.input, run(of ?? null, i + 1)]);

/** Grid 0 auto-strung on inverter 1 with `inputs`, input 1 carrying the first string; none listed
 * where null. */
const auto = (inputs: readonly InputLimits[] | null, from: Draft = draft) =>
  strungOn(
    from,
    0,
    { pv, limits: {}, inputs: inputs === null ? {} : { 1: inputs }, moduleTypes: [MODULE] },
    name,
  );

const strung = (inputs: readonly InputLimits[] | null, from: Draft = draft) => {
  const result = auto(inputs, from);

  return result !== null && "draft" in result ? result : undefined;
};

test("with an input free for each, a face's modules run in a serpentine into as few even strings as the limit allows", () => {
  const result = strung(alike(4, 230, 30));

  // 16 modules at most 6 long: three strings of 6, 5 and 5, each alone on its input.
  expect(made(result?.draft)).toEqual([
    [2, [0, 1, 2, 3, 4, 5]],
    [3, [6, 7, 15, 14, 13]],
    [4, [12, 11, 10, 9, 8]],
  ]);
  expect(result?.left).toBe(0);
  expect(result?.draft.strings[1]).toEqual({ ...first, name: "String 2", input: 2 });
});

test("strings that share an input are all one length: the fewest that leave no module over", () => {
  const result = strung(alike(3, 230, 30));

  // Three strings would be 6, 5 and 5 with two in parallel: four of four share the two inputs.
  expect(made(result?.draft)).toEqual([
    [2, [0, 1, 2, 3]],
    [2, [4, 5, 6, 7]],
    [3, [15, 14, 13, 12]],
    [3, [11, 10, 9, 8]],
  ]);
  expect(result?.left).toBe(0);
});

test("where no equal cut holds every module the rest stays unwired, and is counted", () => {
  const partly = wiredInto(draft, [{ grid: 0, module: 3 }], 0) ?? draft;
  // 15 modules at most 7 long on one input that carries two strings: two of seven, one over.
  const result = strung(alike(2, 270, 30), partly);

  expect(made(result?.draft)).toEqual([
    [2, [0, 1, 2, 4, 5, 6, 7]],
    [2, [15, 14, 13, 12, 11, 10, 9]],
  ]);
  expect(result?.left).toBe(1);
  // The wired module stays as it is, the very one.
  expect(run(result?.draft ?? null, 0)).toEqual([3]);
  expect(result?.draft.scene.grids?.[0]?.modules[3]).toBe(partly.scene.grids?.[0]?.modules[3]);
});

test("without a limit the face is one string; no free input, no proposal; none unwired, nothing", () => {
  const whole = strung(null);

  expect(made(whole?.draft)).toEqual([[2, [0, 1, 2, 3, 4, 5, 6, 7, 15, 14, 13, 12, 11, 10, 9, 8]]]);
  expect(auto(alike(1, 230, 30))).toEqual({
    refused: "input",
  });
  expect(whole && auto(alike(3, 230, 30), whole.draft)).toBeNull();
});

test("each free input is sized by its own limits: a short window takes a shorter string", () => {
  const result = strung([input(230, 30), input(230, 15), input(380, 15)]);

  expect(made(result?.draft)).toEqual([
    [2, [0, 1, 2, 3, 4, 5]],
    [3, [6, 7, 15, 14, 13, 12, 11, 10, 9, 8]],
  ]);
  expect(result?.left).toBe(0);
});

test("an input carries no more strings in parallel than its own current allows", () => {
  const result = strung([input(230, 30), input(230, 30), input(230, 15)]);

  // Four of four would put two on input 3: three of five fit, and one module stays over.
  expect(result?.draft.strings.slice(1).map((string) => string.input)).toEqual([2, 2, 3]);
  expect([1, 2, 3].map((string) => run(result?.draft ?? null, string).length)).toEqual([5, 5, 5]);
  expect(result?.left).toBe(1);
});
