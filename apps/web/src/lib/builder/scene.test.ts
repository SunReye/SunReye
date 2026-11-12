/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  InstancedMesh,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import type { Geometry } from "./pv.ts";
import { buildScene, stringColour, tint } from "./scene.ts";

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

const corners = [
  [0, -1, 3],
  [1, -1, 3],
  [1, -2, 3],
  [0, -2, 3],
] as const;

function part(name: string): Object3D {
  const found = buildScene(house).getObjectByName(name);

  if (found === undefined) throw new Error(`no ${name}`);

  return found;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function standard(found: Object3D | undefined): MeshStandardMaterial {
  if (!(found instanceof Mesh) || !(found.material instanceof MeshStandardMaterial)) {
    throw new TypeError("no material");
  }

  return found.material;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function glass(mesh: Object3D | undefined): MeshPhysicalMaterial {
  if (!(mesh instanceof Mesh) || !(mesh.material instanceof MeshPhysicalMaterial)) {
    throw new TypeError("no module glass");
  }

  return mesh.material;
}

function material(name: string): MeshStandardMaterial {
  return standard(part(name));
}

function vertices(name: string): number[][] {
  const found = part(name);

  if (!(found instanceof Mesh) || !(found.geometry instanceof BufferGeometry)) {
    throw new TypeError(`${name} has no geometry`);
  }

  const position: unknown = found.geometry.getAttribute("position");

  if (!(position instanceof BufferAttribute)) throw new TypeError(`${name} has no positions`);

  return Array.from({ length: position.count }, (_, i) => [
    position.getX(i),
    position.getY(i),
    position.getZ(i),
  ]);
}

test("a roof is drawn as triangles with up as y and north as −z", () => {
  const roof = vertices("roof");

  expect(roof).toHaveLength(6);
  expect(roof).toContainEqual([10, 5, 8]);
  expect(roof).toContainEqual([0, 3, 0]);
});

test("walls and roofs are drawn apart, each in its own finish", () => {
  expect(vertices("wall")).toContainEqual([10, 3, 0]);
  expect(material("wall").map).not.toBeNull();
  expect(material("wall").map).not.toBe(material("roof").map);
});

test("a flat roof is rendered, a pitched one tiled", () => {
  const flat: Geometry = {
    faces: [
      {
        surface: "roof",
        corners: [
          [0, 0, 3],
          [10, 0, 3],
          [10, -8, 3],
        ],
      },
    ],
    solids: [],
  };

  const drawn = buildScene(flat).getObjectByName("flat");
  const triangles: unknown = drawn instanceof Mesh ? drawn.geometry : null;

  const position: unknown =
    triangles instanceof BufferGeometry ? triangles.getAttribute("position") : null;

  expect(standard(drawn).map).not.toBe(material("roof").map);
  expect(position instanceof BufferAttribute ? position.count : 0).toBe(3);
});

test("every map is generated in code: no texture is loaded", () => {
  const maps = ["map", "normalMap", "roughnessMap", "emissiveMap"] as const;
  const found: unknown[] = [];

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  buildScene(house, [{ corners, string: 0 }]).traverse((object) => {
    if (object instanceof Mesh && object.material instanceof MeshStandardMaterial) {
      const used = object.material;

      found.push(...maps.flatMap((key) => (used[key] === null ? [] : [used[key]])));
    }
  });

  expect(found.length).toBeGreaterThan(0);
  expect(found.every((map) => map instanceof DataTexture)).toBe(true);
});

test("a crown is drawn at its centre and a chimney stands on its base", () => {
  const [crown, chimney] = buildScene(house).getObjectsByProperty("name", "solid");

  expect(crown?.position.toArray()).toEqual([-4, 8, 0]);
  expect(chimney?.position.toArray()).toEqual([3, 4.5, 2]);
});

test("a crown is leaves and the trunk beneath it bark; a lone pole is neither", () => {
  const tree: Geometry = {
    faces: [],
    solids: [
      { kind: "cylinder", base: [0, 0, 0], radius: 0.3, height: 4 },
      { kind: "sphere", centre: [0, 0, 5], radius: 2 },
      { kind: "cylinder", base: [6, 0, 0], radius: 0.1, height: 6 },
    ],
  };

  const [trunk, crown, pole] = buildScene(tree).getObjectsByProperty("name", "solid");

  expect(crown).toBeInstanceOf(InstancedMesh);
  expect(standard(trunk).map).not.toBe(standard(pole).map);
});

test("modules are full black under anti-reflective glass; the builder tells strings by glow", () => {
  const [painted, unassigned] = buildScene(house, [
    { corners, string: 0 },
    { corners },
  ]).getObjectsByProperty("name", "module");

  // Plain glass reflects at a specular intensity of 1.
  expect(glass(painted).specularIntensity).toBeLessThanOrEqual(0.5);
  expect(glass(painted).color.getHex()).toBe(0xffffff);
  expect(glass(painted).emissive.getHex()).toBe(new Color(stringColour(0)).getHex());
  expect(glass(unassigned).emissive.getHex()).toBe(new Color(stringColour(null)).getHex());
  expect(stringColour(null)).not.toBe(stringColour(0));
});

test("each equipment marker is drawn where the crate hung it", () => {
  const marked: Geometry = { ...house, mounts: [{ at: [2, -8.1, 1.5], above: [2, -8.1, 8] }] };

  const [marker] = buildScene(marked).getObjectsByProperty("name", "equipment");

  expect(marker?.position.toArray()).toEqual([2, 1.5, 8.1]);
});

test("live, each module's cells glow in the solar colour by its string's share of peak", () => {
  const group = buildScene(house, [{ corners, string: 0 }, { corners, string: 1 }, { corners }]);
  const solar = 0xffa63a;

  tint(group, [1, 0.5, null], { colour: solar, daylight: 1 });

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  const glows = group.getObjectsByProperty("name", "module").map((mesh) => glass(mesh));

  expect(glows[0]?.emissive.getHex()).toBe(new Color(solar).getHex());
  expect(glows[0]?.emissiveIntensity).toBeGreaterThan(glows[1]?.emissiveIntensity ?? 1);
  expect(glows[1]?.emissiveIntensity).toBeGreaterThan(0);
  expect(glows[2]?.emissiveIntensity).toBe(0);

  tint(group, [1, 0.5, null], { colour: solar, daylight: 0 });

  expect(glows[0]?.emissiveIntensity).toBe(0);
});
