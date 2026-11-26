/// <reference types="bun" />
import { expect, test } from "bun:test";
import { Box3, Color, InstancedMesh, Mesh, MeshStandardMaterial, type Object3D } from "three";
import type { Geometry, GroundFinish } from "../../../../../../packages/builder/src/builder/pv.ts";
import { buildScene } from "../../../../../../packages/builder/src/builder/scene.ts";
import { TONE } from "../../../../../../packages/builder/src/scene/materials.ts";

// Conifers, hedges, ground surfaces and fences as the scene draws them (ADR 20 Surroundings).

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function standard(found: Object3D | undefined): MeshStandardMaterial {
  if (!(found instanceof Mesh) || !(found.material instanceof MeshStandardMaterial)) {
    throw new TypeError("no material");
  }

  return found.material;
}

/** A drawn part's material colour, as `#rrggbb`. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
const tone = (found: Object3D | undefined): string => `#${standard(found).color.getHexString()}`;

test("a conifer's crown is one plain cone on its trunk, both in pale clay tones, no leaves", () => {
  const tree: Geometry = {
    faces: [],
    solids: [
      { kind: "cylinder", base: [0, 0, 0], radius: 0.2, height: 2 },
      { kind: "cone", base: [0, 0, 2], radius: 2, height: 8 },
      { kind: "cylinder", base: [6, 0, 0], radius: 0.2, height: 2 },
    ],
  };

  const [trunk, crown, pole] = buildScene(tree).getObjectsByProperty("name", "solid");
  const bounds = new Box3().setFromObject(crown ?? new Mesh());

  expect(crown).not.toBeInstanceOf(InstancedMesh);
  expect(crown?.children).toEqual([]);
  expect(crown?.position.toArray()).toEqual([0, 2, 0]);
  expect([bounds.min.y, bounds.max.y, bounds.max.x]).toEqual([2, 10, 2]);
  expect(standard(crown).map).toBeNull();
  // Each its own tone: a crown, a trunk, a lone pole in the walls' clay.
  expect(new Set([tone(trunk), tone(crown), tone(pole)]).size).toBe(3);
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

test("a hedge is a plain body in the crowns' tone, apart from an obstacle's clay", () => {
  const drawn = buildScene({
    faces: [box("hedge"), box("obstacle")],
    solids: [{ kind: "sphere", centre: [9, 0, 4], radius: 2 }],
  });

  const hedge = drawn.getObjectByName("hedge");

  expect(hedge?.children).toEqual([]);
  expect(tone(hedge)).toBe(tone(drawn.getObjectByName("solid")));
  expect(tone(hedge)).not.toBe(tone(drawn.getObjectByName("obstacle")));
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

test("ground surfaces lie flat on the plot, each later one over the last, in flat greys a step apart", () => {
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
  expect(surfaces.every((surface) => standard(surface).map === null)).toBe(true);
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  expect(new Set(surfaces.map((surface) => tone(surface))).size).toBe(5);

  // Greys: no channel a tenth off another, and none far from the studio floor's.
  for (const surface of surfaces) {
    const { r, g, b } = standard(surface).color;

    expect(Math.max(r, g, b) / Math.min(r, g, b)).toBeLessThan(1.1);
    expect(Math.abs(g - new Color(TONE.floor).g)).toBeLessThan(0.25);
  }
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
      ? first.material.color.getHex()
      : -1;
  });

  expect(new Set(looks).size).toBe(3);
});
