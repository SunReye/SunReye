/// <reference types="bun" />
// What the realism pass adds to the drawn scene (ADR 20 Look): which parts cast a shadow, a
// module's body and a pitched roof's trim.
import { expect, test } from "bun:test";
import { Box3, BufferAttribute, BufferGeometry, InstancedMesh, Mesh } from "three";
import type { Geometry } from "../../../../../../packages/builder/src/builder/pv.ts";
import { buildScene } from "../../../../../../packages/builder/src/builder/scene.ts";

const house: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [0, 0, 3],
        [10, 0, 3],
        [10, -8, 5],
        [0, -8, 5],
      ],
    },
    {
      surface: "wall",
      corners: [
        [0, 0, 0],
        [10, 0, 0],
        [10, 0, 3],
        [0, 0, 3],
      ],
    },
  ],
  solids: [
    { kind: "sphere", centre: [-4, 0, 8], radius: 2 },
    { kind: "cylinder", base: [3, -2, 0], radius: 0.3, height: 9 },
  ],
};

/** A module lying level at 3 m. */
const corners = [
  [0, -1, 3],
  [1, -1, 3],
  [1, -2, 3],
  [0, -2, 3],
] as const;

test("all of it casts and catches shadows, but what lies flat casts none: a module, the ground", () => {
  const drawn = buildScene(
    {
      ...house,
      ground: [
        {
          finish: "paving",
          corners: [
            [0, 0, 0],
            [4, 0, 0],
            [4, -2, 0],
            [0, -2, 0],
          ],
        },
      ],
    },
    [{ corners, string: 0 }],
  );

  const casts = (name: string): boolean[] =>
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
    drawn.getObjectsByProperty("name", name).map((object) => object.castShadow);

  expect(casts("wall")).toEqual([true]);
  expect(casts("roof")).toEqual([true]);
  expect(casts("solid")).toEqual([true, true]);
  expect(casts("module")).toEqual([false]);
  expect(casts("ground")).toEqual([false]);

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  drawn.traverse((object) => {
    if (object instanceof Mesh) expect(object.receiveShadow).toBe(true);
  });
});

test("a module is a framed body standing 3.5 cm proud of its roof, its cells on top", () => {
  const module = buildScene(house, [{ corners, string: 0 }]).getObjectByName("module");

  const body: unknown = module instanceof InstancedMesh ? module.geometry : null;

  if (module === undefined || !(body instanceof BufferGeometry)) throw new TypeError("no module");

  const { min, max } = new Box3().setFromObject(module);

  // The fixture's module lies level at 3 m.
  expect(min.y).toBeCloseTo(3);
  expect(max.y).toBeCloseTo(3.035);
  // Its top and four sides: no face of it lies in the roof, to show on the roof's underside.
  const points: unknown = body.getAttribute("position");

  expect(points instanceof BufferAttribute ? points.count : 0).toBe(30);
});

test("a pitched roof is trimmed with ridge caps and gutters, which cast no shadow of their own", () => {
  const gable: Geometry = {
    faces: [
      {
        surface: "roof",
        corners: [
          [0, 0, 3],
          [10, 0, 3],
          [10, 4, 5],
          [0, 4, 5],
        ],
      },
      {
        surface: "roof",
        corners: [
          [10, 8, 3],
          [0, 8, 3],
          [0, 4, 5],
          [10, 4, 5],
        ],
      },
    ],
    solids: [],
  };

  const trims = buildScene(gable).getObjectsByProperty("name", "trim");

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  expect(trims.map((made) => (made instanceof InstancedMesh ? made.count : 0))).toEqual([5, 2]);
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  expect(trims.every((made) => !made.castShadow)).toBe(true);
  // A mono-pitch roof: its verges, and its one gutter.
  expect(buildScene(house).getObjectsByProperty("name", "trim")).toHaveLength(2);
});
