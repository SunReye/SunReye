/// <reference types="bun" />
import { expect, test } from "bun:test";
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, type Object3D } from "three";
import type { Geometry } from "./pv.ts";
import { buildScene } from "./scene.ts";

const house: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [0, 0, 3],
        [10, 0, 3],
        [10, -8, 3],
        [0, -8, 3],
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

function part(name: string): Object3D {
  const found = buildScene(house).getObjectByName(name);

  if (found === undefined) throw new Error(`no ${name}`);

  return found;
}

function colour(name: string): number {
  const found = part(name);

  if (!(found instanceof Mesh) || !(found.material instanceof MeshStandardMaterial)) {
    throw new TypeError(`${name} has no colour`);
  }

  return found.material.color.getHex();
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
  expect(roof).toContainEqual([10, 3, 8]);
  expect(roof).toContainEqual([0, 3, 0]);
});

test("walls and roofs are drawn apart, so each has its own colour", () => {
  expect(vertices("wall")).toContainEqual([10, 3, 0]);
  expect(colour("wall")).not.toBe(colour("roof"));
});

test("a crown is drawn at its centre and a chimney stands on its base", () => {
  const [crown, chimney] = buildScene(house).getObjectsByProperty("name", "solid");

  expect(crown?.position.toArray()).toEqual([-4, 8, 0]);
  expect(chimney?.position.toArray()).toEqual([3, 4.5, 2]);
});
