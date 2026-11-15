/// <reference types="bun" />
import { expect, test } from "bun:test";
import { Box3, InstancedMesh, Mesh, MeshStandardMaterial, type Object3D } from "three";
import type { Geometry, GroundFinish } from "../builder/pv.ts";
import { buildScene } from "../builder/scene.ts";

// Conifers, hedges, ground surfaces and fences as the scene draws them (ADR 20 Surroundings).

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function standard(found: Object3D | undefined): MeshStandardMaterial {
  if (!(found instanceof Mesh) || !(found.material instanceof MeshStandardMaterial)) {
    throw new TypeError("no material");
  }

  return found.material;
}

test("a conifer's crown is a cone of leaves on its trunk of bark", () => {
  const tree: Geometry = {
    faces: [],
    solids: [
      { kind: "cylinder", base: [0, 0, 0], radius: 0.2, height: 2 },
      { kind: "cone", base: [0, 0, 2], radius: 2, height: 8 },
      { kind: "cylinder", base: [6, 0, 0], radius: 0.2, height: 2 },
    ],
  };

  const [trunk, crown, pole] = buildScene(tree).getObjectsByProperty("name", "solid");

  expect(crown).toBeInstanceOf(InstancedMesh);
  expect(crown?.position.toArray()).toEqual([0, 2, 0]);
  expect(standard(trunk).map).not.toBe(standard(pole).map);
});

const box = (surface: "hedge" | "obstacle") => ({
  surface,
  corners: [
    [0, 0, 1.8],
    [6, 0, 1.8],
    [6, -0.8, 1.8],
    [0, -0.8, 1.8],
  ] as const,
});

test("a hedge is a body of leaves, not a rendered box", () => {
  const drawn = buildScene({ faces: [box("hedge"), box("obstacle")], solids: [] });
  const hedge = drawn.getObjectByName("hedge");
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  const leaves = hedge?.children.find((child) => child instanceof InstancedMesh);

  expect(leaves).toBeDefined();
  expect(standard(hedge).map).not.toBe(standard(drawn.getObjectByName("obstacle")).map);
});

const patch = (finish: GroundFinish, east: number) => ({
  finish,
  corners: [
    [east, 0, 0],
    [east + 4, 0, 0],
    [east + 4, -2, 0],
    [east, -2, 0],
  ] as const,
});

test("ground surfaces lie flat on the plot in their finishes, each later one over the last", () => {
  const finishes: GroundFinish[] = ["lawn", "paving", "driveway", "gravel", "path"];

  const surfaces = buildScene({
    faces: [],
    solids: [],
    ground: finishes.map((finish, i) => patch(finish, i)),
  }).getObjectsByProperty("name", "ground");

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  const heights = surfaces.map((surface) => surface.position.y);

  expect(surfaces).toHaveLength(5);
  expect(
    heights.every((height, i) => height > 0 && height < 0.05 && height > (heights[i - 1] ?? 0)),
  ).toBe(true);
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  expect(new Set(surfaces.map((surface) => standard(surface).map)).size).toBe(5);
});

test("a fence stands along its points to its height, in a finish of its own", () => {
  const along = [
    [0, 0, 0],
    [4, 0, 0],
    [4, -3, 0],
  ] as const;

  const fences = buildScene({
    faces: [],
    solids: [],
    fences: (["wood", "metal", "wall"] as const).map((finish) => ({
      finish,
      height: 1.2,
      points: along,
    })),
  }).getObjectsByProperty("name", "fence");

  expect(fences).toHaveLength(3);

  for (const fence of fences) {
    const bounds = new Box3().setFromObject(fence);

    expect(bounds.max.y).toBeCloseTo(1.2, 2);
    expect(bounds.min.x).toBeLessThan(0.3);
    expect(bounds.max.x).toBeGreaterThan(3.7);
    expect(bounds.max.z).toBeGreaterThan(2.7);
  }

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  const looks = fences.map((fence) => {
    const first = fence.children[0];

    return first instanceof Mesh && first.material instanceof MeshStandardMaterial
      ? first.material.color.getHex() + (first.material.map?.uuid ?? "")
      : "";
  });

  expect(new Set(looks).size).toBe(3);
});
