import { expect, test } from "bun:test";
import { Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Texture, Vector2 } from "three";
import { enrich } from "./gloss.ts";

function scene() {
  const cover = new MeshPhysicalMaterial({ specularIntensity: 0.12 });
  const panes = new MeshStandardMaterial();

  const wall = new MeshStandardMaterial({
    normalMap: new Texture(),
    normalScale: new Vector2(0.6, 0.6),
  });

  const group = new Group();

  for (const [name, material] of [
    ["module", cover],
    ["opening", panes],
    ["wall", wall],
  ] as const) {
    const mesh = new Mesh(undefined, material);

    mesh.name = name;
    group.add(mesh);
  }

  return { group, cover, panes, wall };
}

test("Hoch puts the sky in module covers and panes and raises every normal map", () => {
  const { group, cover, panes, wall } = scene();

  enrich(group, true);

  expect(cover.specularIntensity).toBeGreaterThan(0.12);
  expect(panes.envMapIntensity).toBeGreaterThan(1);
  expect(wall.normalScale.x).toBeCloseTo(0.9, 5);
});

test("below Hoch a build is drawn as it was built, however often it was enriched", () => {
  const { group, cover, panes, wall } = scene();

  enrich(group, true);
  enrich(group, true);
  enrich(group, false);

  // ADR 20's module: a specular strength of 0.12.
  expect(cover.specularIntensity).toBe(0.12);
  expect(panes.envMapIntensity).toBe(1);
  expect(wall.normalScale.x).toBeCloseTo(0.6, 5);
});
