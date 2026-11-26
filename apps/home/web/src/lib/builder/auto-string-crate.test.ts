/// <reference types="bun" />
// The pv crate's auto-stringing over a whole roof (ADR 20, 25) does what the builder does a face
// at a time: on the same scenes and inverters, the builder's run, the face with the most modules in
// no string first, and the crate's run over the roof wire the same modules into the same strings.
import { expect, test } from "bun:test";
import { loadPv, type InputLimits, type Strand } from "@sunreye/pv-wasm";
import type { ModuleType } from "@sunreye/scene";
import type { StringDraft } from "../api/core.ts";
import {
  strungOn,
  type Stringing,
} from "../../../../../../packages/builder/src/builder/auto-string.ts";
import {
  addGrid,
  wiredIn,
  type Draft,
} from "../../../../../../packages/builder/src/builder/modules.ts";
import { place } from "../../../../../../packages/builder/src/builder/placing.ts";
import type { Scene } from "../../../../../../packages/builder/src/builder/pv.ts";
import { wiredInto } from "../../../../../../packages/builder/src/builder/selecting.ts";

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));
const pv = await loadPv(await Bun.file(wasm).bytes());

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

/** A smaller module of another type, which the crate is told nothing of on one face. */
const SMALL: ModuleType = {
  ...MODULE,
  id: 8,
  name: "Small 340",
  pmax: 340,
  vmp: 31,
  voc: 37.5,
  isc: 9.8,
};

const gable = {
  x: 0,
  z: 0,
  width: 10,
  depth: 8,
  eave: 3,
  rotation: 0,
  roof: { kind: "gable", pitch: 35 },
} as const;

const bare: Scene = { north: 0, blocks: [gable], obstacles: [], grids: [] };

/** Modules by their place on a face. */
type Laid = readonly {
  readonly across: number;
  readonly up: number;
  readonly landscape: boolean;
}[];

/** `count` modules in rows of `across`, each row a little off the last's height, as hands lay them. */
function laid(count: number, across: number, landscape = false): Laid {
  return Array.from({ length: count }, (_, i) => ({
    across: 0.3 + (i % across) * 1.154 + (i % 3) * 0.01,
    up: 0.3 + Math.floor(i / across) * 1.742 + ((i * 7) % 5) * 0.05,
    landscape,
  }));
}

/** The scene with a grid of `type` on face `face` of block 0 holding `modules`. */
const withGrid = (scene: Scene, face: number, type: number, modules: Laid): Scene =>
  place(addGrid(scene, 0, face, type), scene.grids?.length ?? 0, modules);

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

const input = (maxVoltage: number, maxCurrent: number): InputLimits => ({
  maxCurrent,
  minVoltage: 0,
  maxVoltage,
  startVoltage: 0,
});

/** An inverter, device 1: its maximum DC input voltage and its inputs, each where known. */
interface Inverter {
  readonly max: number | null;
  readonly inputs: readonly InputLimits[] | null;
}

const south16 = withGrid(bare, 1, 7, laid(16, 8));

const twoFaces = withGrid(withGrid(bare, 0, 7, laid(5, 5)), 1, 7, laid(16, 8));

const mixed = withGrid(withGrid(bare, 0, 8, laid(9, 4, true)), 1, 7, laid(21, 7));

const partly = (
  wiredInto({ scene: south16, strings: [first] }, [{ grid: 0, module: 3 }], 0) ?? {
    scene: south16,
  }
).scene;

const SCENES: readonly (readonly [string, Scene])[] = [
  ["one face", south16],
  ["one face with a module wired", partly],
  ["two faces", twoFaces],
  ["two module types", mixed],
];

const INVERTERS: readonly (readonly [string, Inverter])[] = [
  [
    "an input free for each",
    { max: null, inputs: Array.from({ length: 4 }, () => input(230, 30)) },
  ],
  ["inputs shared", { max: null, inputs: Array.from({ length: 3 }, () => input(230, 30)) }],
  ["no equal cut", { max: null, inputs: [input(270, 30), input(270, 30)] }],
  ["inputs of their own", { max: null, inputs: [input(230, 30), input(230, 15), input(380, 15)] }],
  [
    "currents of their own",
    { max: null, inputs: [input(230, 30), input(230, 30), input(230, 15)] },
  ],
  ["a maximum DC voltage", { max: 230, inputs: Array.from({ length: 5 }, () => input(1000, 60)) }],
  ["no limits", { max: null, inputs: null }],
  ["a maximum without inputs", { max: 400, inputs: null }],
  ["one input free", { max: 1000, inputs: [input(900, 40), input(900, 40)] }],
];

/** Each grid's modules as wired: their string and place along it. */
const wiring = (scene: Scene) =>
  (scene.grids ?? []).map((grid) =>
    grid.modules.map(({ string, order }) => [
      string ?? null,
      (string ?? undefined) === undefined ? null : order,
    ]),
  );

/** How many of grid `grid`'s modules are in no string. */
const loose = (draft: Readonly<Draft>, grid: number): number =>
  draft.scene.grids?.[grid]?.modules.filter(({ string }) => (string ?? undefined) === undefined)
    .length ?? 0;

/** What a run over the roof made: each module's wiring, the new strings and the modules over. */
interface Made {
  readonly wiring: readonly (readonly (readonly (number | null | undefined)[])[])[];
  readonly strings: readonly Strand[];
  readonly left: number;
}

/** The builder's auto-stringing of grid `grid`: the draft after it, and the modules it left in no
 * string, all of the face's where no input was free. */
function builderFace(draft: Draft, grid: number, stringing: Stringing) {
  const strung = strungOn(draft, grid, stringing, (n) => `String ${String(n)}`);

  if (strung === null) return { draft, left: 0 };

  return "refused" in strung ? { draft, left: loose(draft, grid) } : strung;
}

/** The builder's auto-stringing over the roof, a face at a time, the most modules in none first. */
function builders(scene: Scene, inverter: Inverter, types: readonly ModuleType[]): Made {
  const stringing: Stringing = {
    pv,
    limits: inverter.max === null ? {} : { 1: inverter.max },
    inputs: inverter.inputs === null ? {} : { 1: inverter.inputs },
    moduleTypes: types,
  };

  const faces = (scene.grids ?? []).map((_, grid) => grid);
  let draft: Draft = { scene, strings: [first] };
  let left = 0;

  for (const grid of faces.toSorted((a, b) => loose(draft, b) - loose(draft, a))) {
    const face = builderFace(draft, grid, stringing);

    draft = face.draft;
    left += face.left;
  }

  const strings: Strand[] = draft.strings.slice(1).map(({ moduleType, device, input: on }, i) => ({
    moduleType,
    device,
    input: on,
    modules: wiredIn(draft.scene, i + 1).modules,
  }));

  return { wiring: wiring(draft.scene), strings, left };
}

for (const [scenery, scene] of SCENES)
  for (const [kind, inverter] of INVERTERS)
    test(`the crate strings ${scenery} on ${kind} as the builder does`, () => {
      // The crate knows the small module's type only where the builder does: on the mixed roof
      // once with and once without it.
      for (const types of [[MODULE, SMALL], [MODULE]]) {
        const crate = pv.autoString({
          scene,
          moduleTypes: types,
          device: 1,
          inverter: { maxInputVoltage: inverter.max, inputs: inverter.inputs },
          taken: [first],
        });

        const made: Made = {
          wiring: wiring(crate.scene),
          strings: crate.strings,
          left: crate.left,
        };

        expect(made).toEqual(builders(scene, inverter, types));
      }
    });

test("the cases above make several strings, share an input and leave modules over", () => {
  const all = SCENES.flatMap(([, scene]) =>
    INVERTERS.map(([, inverter]) => builders(scene, inverter, [MODULE, SMALL])),
  );

  expect(all.some(({ strings }) => strings.length >= 3)).toBe(true);

  expect(all.some(({ left }) => left > 0)).toBe(true);

  expect(
    all.some(({ strings }) => new Set(strings.map(({ input: on }) => on)).size < strings.length),
  ).toBe(true);
});
