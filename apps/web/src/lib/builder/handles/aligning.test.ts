/// <reference types="bun" />
import { expect, test } from "bun:test";
import { nextBlock } from "../draft.ts";
import type { Imported } from "../imported.ts";
import { loadPv, type Scene } from "../pv.ts";
import { rests, toggled } from "./aligning.ts";
import { drag, handles, type Ray, type Target } from "./grips.ts";

const wasm = new URL(
  "../../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm",
  import.meta.url,
);

const pv = await loadPv(await Bun.file(wasm).bytes());

const IMPORT: Target = { kind: "import", index: 0 };
const DIGEST = "ab".repeat(32);

/** The new 10 m by 8 m house, with surroundings lying 2 m east and 1 m south of its corner. */
const SCENE: Scene = {
  north: 0,
  blocks: [nextBlock([])],
  obstacles: [],
  imported: { document: DIGEST, x: 2, z: 1, turn: 0, hidden: [0] },
};

/** Straight down onto scene point `x`, `z`. */
const down = (x: number, z: number): Ray => ({ origin: [x, 50, z], direction: [0, -1, 0] });

test("imported surroundings have a knob on their centre to move them and a ring to turn them", () => {
  const found = handles(SCENE, IMPORT);

  expect(found.map(({ grip }) => grip)).toEqual(["point", "turn"]);
  expect(found[0]?.at).toEqual([2, 0, 1]);
  // Clear of the house's far corner, 10.6 m off.
  expect(found[1]?.radius).toBeGreaterThan(11);
  expect(handles({ ...SCENE, imported: null }, IMPORT)).toEqual([]);
});

test("the knob moves the surroundings with the pointer, snapped to 10 cm", () => {
  const moved = drag(
    SCENE,
    IMPORT,
    { grip: "point", ray: down(2, 1), height: 0 },
    down(5.23, -1.48),
  );

  expect(moved?.scene.imported).toEqual({
    document: DIGEST,
    x: 5.2,
    z: -1.5,
    turn: 0,
    hidden: [0],
  });
  expect(moved?.value).toEqual([5.2, -1.5]);
  expect(moved?.unit).toBe("m");
});

test("the ring turns the surroundings about their centre, snapped to 5°", () => {
  // From east of the centre to south-east of it: clockwise seen from above.
  const turned = drag(SCENE, IMPORT, { grip: "turn", ray: down(12, 1), height: 0 }, down(12, 9.4));

  expect(turned?.scene.imported?.turn).toBe(40);
  expect(turned?.scene.imported?.x).toBe(2);
  expect(turned?.value).toEqual([40]);
  expect(turned?.unit).toBe("°");
});

/** A document whose building under the house stands 8° off the compass. */
function skewed(): Imported {
  const [sin, cos] = [Math.sin((8 * Math.PI) / 180), Math.cos((8 * Math.PI) / 180)];

  const at = (east: number, north: number): number[] => [
    east * cos - north * sin,
    east * sin + north * cos,
  ];

  return {
    radius: 100,
    buildings: [
      {
        id: 0,
        outline: [at(0, -8), at(10, -8), at(10, 0), at(0, 0)],
        eave: 6,
        roof: { kind: "flat" },
      },
    ],
    trees: [],
    hedges: [],
    grounds: [],
    terrain: { step: 100, side: 3, heights: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
    credits: [],
  };
}

test("the ring snaps to the turn that lines a hidden building up with a block", () => {
  const document = skewed();
  const lined = rests(SCENE, document);

  const turned = drag(
    SCENE,
    IMPORT,
    { grip: "turn", ray: down(12, 1), height: 0 },
    // 6.5° clockwise: within 3° of the 8° that lines the building up.
    down(2 + 10 * Math.cos(0.1134), 1 + 10 * Math.sin(0.1134)),
    { rests: lined },
  );

  const turn = turned?.scene.imported?.turn ?? 0;

  expect(turn).toBeCloseTo(8, 5);

  // As the crate stands it then, every wall of the building runs along the compass.
  const around = pv.around({ ...SCENE, imported: { ...SCENE.imported!, turn } }, document);
  const walls = around?.buildings[0]?.faces.filter(({ surface }) => surface === "wall") ?? [];

  for (const { corners } of walls) {
    const [[ax, ay] = [0, 0], [bx, by] = [0, 0]] = corners;

    expect(Math.min(Math.abs(ax - bx), Math.abs(ay - by))).toBeCloseTo(0, 6);
  }
});

test("a tap hides a shown building and shows a hidden one", () => {
  expect(toggled(SCENE, 4).imported?.hidden).toEqual([0, 4]);
  expect(toggled(SCENE, 0).imported?.hidden).toEqual([]);
  expect(toggled({ ...SCENE, imported: null }, 0).imported).toBeNull();
});
