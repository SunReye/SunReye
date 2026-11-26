// What the builder's consumer supplies, as the scene draws it (ADR 20): the aerial image draped on
// the ground and on the roof faces, and the neighbours as bodies that cast the sun's shadow. In
// the browser: the image is a canvas the test paints, not a file fetched.
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, type Object3D } from "three";
import { expect, test } from "vitest";
import type { Face, Geometry } from "../../../../../../packages/builder/src/builder/pv.ts";
import { buildScene } from "../../../../../../packages/builder/src/builder/scene.ts";
import type { Aerial, Around } from "../../../../../../packages/builder/src/builder/supplied.ts";

/** A 10 m × 8 m house, its roof rising north from the eave along the scene's x axis. */
const house: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [0, 0, 3],
        [10, 0, 3],
        [10, 8, 5],
        [0, 8, 5],
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
  solids: [],
};

/** 20 m east to west and 40 m north to south round the house. */
function aerial(): Aerial {
  const image = document.createElement("canvas");

  image.width = 4;
  image.height = 8;

  return { image, extent: { west: -5, south: -16, east: 15, north: 24 } };
}

/** The one part drawn as `name`. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the image is the DOM's own.
function drawn(around: Around | undefined, name: string): Object3D {
  const found = buildScene(house, [], around).getObjectByName(name);

  if (found === undefined) throw new TypeError(`no ${name}`);

  return found;
}

/** How many parts are drawn as `name`. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the image is the DOM's own.
function counted(around: Around | undefined, name: string): number {
  return buildScene(house, [], around).getObjectsByProperty("name", name).length;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function finish(part: Object3D): MeshStandardMaterial {
  const material: unknown = part instanceof Mesh ? part.material : null;

  if (!(material instanceof MeshStandardMaterial)) throw new TypeError("no finish");

  return material;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function attribute(part: Object3D, name: string): BufferAttribute | undefined {
  const geometry: unknown = part instanceof Mesh ? part.geometry : null;
  const found: unknown = geometry instanceof BufferGeometry ? geometry.getAttribute(name) : null;

  return found instanceof BufferAttribute ? found : undefined;
}

/** Each vertex's position, three.js's x, y, z, beside its place on the image, if any. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function mapped(part: Object3D): [number[], number[]][] {
  const position = attribute(part, "position");
  const uv = attribute(part, "uv");

  return Array.from({ length: position?.count ?? 0 }, (_, i) => [
    [position?.getX(i) ?? 0, position?.getY(i) ?? 0, position?.getZ(i) ?? 0],
    uv === undefined ? [] : [uv.getX(i), uv.getY(i)],
  ]);
}

test("the image lies on the ground over its extent, north up, under every other surface", () => {
  const given = aerial();
  const around = { aerial: given, neighbours: [] };
  const ground = drawn(around, "aerial");

  expect(counted(around, "aerial")).toBe(1);
  expect(finish(ground).map?.image).toBe(given.image);
  expect(ground.castShadow).toBe(false);
  expect(ground.receiveShadow).toBe(true);
  // three.js's z runs south; the image's first row is its north edge.
  expect(mapped(ground)).toContainEqual([
    [-5, expect.closeTo(0.002, 6), -24],
    [0, 0],
  ]);
  expect(mapped(ground)).toContainEqual([
    [15, expect.closeTo(0.002, 6), 16],
    [1, 1],
  ]);
});

test("each roof face shows the part of the image straight above it; the walls keep their clay", () => {
  const given = aerial();
  const around = { aerial: given, neighbours: [] };
  const roof = drawn(around, "roof");

  expect(finish(roof).map?.image).toBe(given.image);
  expect(finish(roof).map?.flipY).toBe(false);
  // The eave's east end: 15 m of 20 east, 24 m of 40 south of the north edge.
  expect(mapped(roof)).toContainEqual([
    [10, 3, expect.closeTo(0, 6)],
    [0.75, expect.closeTo(0.6, 6)],
  ]);
  expect(finish(drawn(around, "wall")).map).toBeNull();
});

test("the neighbours stand as bodies that cast the sun's shadow", () => {
  const top: Face = {
    surface: "obstacle",
    corners: [
      [20, 0, 6],
      [24, 0, 6],
      [24, 3, 6],
    ],
  };

  const body = drawn({ neighbours: [top] }, "neighbour");

  expect(body.castShadow).toBe(true);
  expect(mapped(body)).toContainEqual([[24, 6, -3], []]);
});

test("with neither, the scene is drawn as before: no image, no neighbours, roofs in their finish", () => {
  expect(counted(undefined, "aerial")).toBe(0);
  expect(counted(undefined, "neighbour")).toBe(0);
  expect(finish(drawn(undefined, "roof")).map).toBeNull();
  expect(attribute(drawn(undefined, "roof"), "uv")).toBeUndefined();
});
