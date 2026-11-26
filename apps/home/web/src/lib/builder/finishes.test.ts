/// <reference types="bun" />
import { expect, test } from "bun:test";
import { Color, Mesh, MeshStandardMaterial, type Object3D } from "three";
import type { Face, Geometry } from "../../../../../../packages/builder/src/builder/pv.ts";
import { buildScene } from "../../../../../../packages/builder/src/builder/scene.ts";

// A block's colours and its roof chimneys as the scene draws them (ADR 20 Colours, Roof chimneys).

const square = (height: number) =>
  [
    [0, 0, height],
    [10, 0, height],
    [10, -8, height + 2],
    [0, -8, height + 2],
  ] as const;

const house: readonly Face[] = [
  { surface: "roof", corners: square(3) },
  { surface: "wall", corners: square(0) },
];

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function standard(found: Object3D | undefined): MeshStandardMaterial {
  if (!(found instanceof Mesh) || !(found.material instanceof MeshStandardMaterial)) {
    throw new TypeError("no material");
  }

  return found.material;
}

/** The material's flat colour, as sRGB; a map would lay a pattern over it. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's material, read only.
function albedo(found: MeshStandardMaterial): string {
  if (found.map !== null || found.normalMap !== null) throw new TypeError("a patterned finish");

  return `#${found.color.getHexString()}`;
}

test("a block's colours are flat matte tints on its walls and roofs; without one a wall is off-white clay and a roof a cooler grey", () => {
  const painted: Geometry = {
    faces: [
      ...house.map(({ surface, corners }) => ({
        surface,
        corners,
        colour: surface === "roof" ? "#9c4a32" : "#e8dcc0",
      })),
      ...house,
    ],
    solids: [],
  };

  const group = buildScene(painted);
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  const drawn = (name: string) => group.getObjectsByProperty("name", name).map((o) => standard(o));
  const [plainRoof, roof] = drawn("roof");
  const [plainWall, wall] = drawn("wall");

  expect(roof === undefined ? "" : albedo(roof)).toBe("#9c4a32");
  expect(wall === undefined ? "" : albedo(wall)).toBe("#e8dcc0");
  expect([roof?.roughness, wall?.roughness].every((rough) => (rough ?? 0) > 0.85)).toBe(true);

  const [clay, grey] = [plainWall?.color ?? new Color(0), plainRoof?.color ?? new Color(0)];

  // Off-white, a little warm; the roof darker and cooler.
  expect(clay.g).toBeGreaterThan(0.7);
  expect(clay.g).toBeLessThan(0.9);
  expect(clay.r).toBeGreaterThan(clay.b);
  expect(grey.g).toBeLessThan(clay.g - 0.1);
  expect(grey.b).toBeGreaterThan(grey.r);
});

test("a roof chimney is drawn in the walls' clay from its faces", () => {
  const side = {
    surface: "chimney",
    corners: [
      [3, -2, 4],
      [3.6, -2, 4],
      [3.6, -2, 6],
      [3, -2, 6],
    ],
  } as const;

  const drawn = buildScene({ faces: [side], solids: [] }).getObjectByName("chimney");

  const obstacle = buildScene({ faces: [], solids: [] }).getObjectByName("obstacle");

  const wall = buildScene({ faces: house, solids: [] }).getObjectByName("wall");

  expect(albedo(standard(drawn))).toBe(albedo(standard(wall)));
  expect(albedo(standard(obstacle))).toBe(albedo(standard(wall)));
});
