/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { StringDraft } from "../api/core.ts";
import { addGrid, type Draft } from "./modules.ts";
import { place } from "./placing.ts";
import type { Scene } from "./pv.ts";
import { without } from "./removal.ts";
import { wiredInto } from "./selecting.ts";

const block = {
  x: 0,
  z: 0,
  width: 10,
  depth: 8,
  eave: 3,
  rotation: 0,
  roof: { kind: "gable", pitch: 35 },
} as const;

const window = {
  kind: "window",
  block: 0,
  wall: "front",
  along: 2,
  width: 1.2,
  height: 1.4,
} as const;

const door = { ...window, kind: "frontDoor", along: 5 } as const;

const gridded = place(
  addGrid({ north: 0, blocks: [block, block], obstacles: [], grids: [] } satisfies Scene, 0, 1, 7),
  0,
  [
    { across: 0.3, up: 0.3, landscape: false },
    { across: 1.5, up: 0.3, landscape: false },
  ],
);

const string = (name: string): StringDraft => ({
  name,
  moduleType: 7,
  device: 1,
  input: 1,
  modules: 0,
  optimized: 0,
  tilt: 0,
  azimuth: 0,
  loss: 2,
});

const strings = [string("Süd"), string("Ost")];

const scene: Scene = {
  ...gridded,
  openings: [window, door],
  obstacles: [{ kind: "tree", x: 1, z: 1, radius: 1, height: 4 }],
};

/** The first module in Süd, the second in Ost. */
const draft: Draft = [0, 1].reduce<Draft>(
  (wired, at) => wiredInto(wired, [{ grid: 0, module: at }], at) ?? wired,
  { scene, strings },
);

test("an object is taken out of its list, the others keeping their order", () => {
  expect(without(draft, { kind: "opening", index: 0 })?.scene.openings).toEqual([door]);
  expect(without(draft, { kind: "obstacle", index: 0 })?.scene.obstacles).toEqual([]);
  expect(
    without(draft, { kind: "module", block: 0, face: 1, module: 0 })?.scene.grids?.[0]?.modules,
  ).toHaveLength(1);
});

test("a removed string takes its modules' wiring with it, and later strings move up", () => {
  const less = without(draft, { kind: "string", index: 0 });

  expect(less?.strings.map(({ name }) => name)).toEqual(["Ost"]);
  expect(less?.scene.grids?.[0]?.modules.map((module) => module.string ?? null)).toEqual([null, 0]);
});

test("a removed block takes what stands on it; the last block and what is no object stay", () => {
  expect(without(draft, { kind: "block", index: 0 })?.scene).toMatchObject({
    blocks: [block],
    openings: [],
    grids: [],
  });

  const single = { ...draft, scene: { ...draft.scene, blocks: [block] } };

  expect(without(single, { kind: "block", index: 0 })).toBeNull();
  expect(without(draft, { kind: "root" })).toBeNull();
  expect(without(draft, { kind: "face", block: 0, face: 1 })).toBeNull();
});
