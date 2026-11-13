/// <reference types="bun" />
import { expect, test } from "bun:test";
import { Color, DataTexture, Mesh, MeshStandardMaterial, type Object3D } from "three";
import type { Face, Geometry } from "./pv.ts";
import { buildScene } from "./scene.ts";

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

/** The material's drawn albedo, as sRGB: its map's mean in linear light times its colour. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own material, read only.
function albedo(found: MeshStandardMaterial): string {
  const { map } = found;

  if (!(map instanceof DataTexture)) throw new TypeError("no generated map");

  const data = map.image.data;

  if (data === null) throw new TypeError("no pixels");

  const mean = [0, 1, 2].map((channel) => {
    let sum = 0;

    for (let i = channel; i < data.length; i += 4) {
      sum += new Color().setRGB((data[i] ?? 0) / 255, 0, 0).convertSRGBToLinear().r;
    }

    return sum / (data.length / 4);
  });

  return `#${new Color()
    .setRGB(
      (mean[0] ?? 0) * found.color.r,
      (mean[1] ?? 0) * found.color.g,
      (mean[2] ?? 0) * found.color.b,
    )
    .getHexString()}`;
}

test("a block's colours paint its walls and roofs; without one a face keeps its finish's own", () => {
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
  expect(plainRoof?.color.getHex()).toBe(0xffffff);
  expect(plainWall?.color.getHex()).toBe(0xffffff);
});

test("a roof chimney is drawn in render from its faces", () => {
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

  expect(standard(drawn).map).toBe(standard(obstacle).map);
});
