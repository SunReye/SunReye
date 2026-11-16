import { expect, test } from "bun:test";
import { BoxGeometry, Group, Mesh, PlaneGeometry } from "three";
import { blades, Cover, coverOf, MOST, reachOf, tufts } from "./grass.ts";

/** A flat mesh `width` × `depth` lying on the ground about `x`, `z`, named as the scene names it. */
function lying(name: string, [x, z]: readonly [number, number], width: number, depth: number) {
  const mesh = new Mesh(new PlaneGeometry(width, depth));

  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.01, z);
  mesh.name = name;

  return mesh;
}

const far = (x: number, z: number): number => Math.hypot(x, z);

const mean = (some: readonly Readonly<{ height: number }>[]): number =>
  some.reduce((sum, { height }) => sum + height, 0) / some.length;

test("a triangle covers the ground inside it and none outside", () => {
  const cover = new Cover([0, 0], 10);

  cover.add([0, 0], [4, 0], [0, 4]);

  expect(cover.covered(1, 1)).toBe(true);
  expect(cover.covered(3.5, 3.5)).toBe(false);
  expect(cover.covered(-1, 1)).toBe(false);
  // Off the grid nothing is known to lie there.
  expect(cover.covered(50, 50)).toBe(false);
});

test("roofs, obstacles and laid surfaces keep the lawn off; a lawn surface and a crown do not", () => {
  const group = new Group();
  const lawn = lying("ground", [-6, 6], 2, 2);
  const crown = new Mesh(new BoxGeometry(3, 3, 3));

  lawn.userData = { finish: "lawn" };
  crown.name = "solid";
  crown.position.set(6, 4, 6);
  group.add(lying("roof", [0, 0], 4, 4), lying("ground", [6, -6], 2, 2), lawn, crown);

  const cover = coverOf(group, [0, 0], 12);

  expect(cover.covered(0, 0)).toBe(true);
  expect(cover.covered(6, -6)).toBe(true);
  expect(cover.covered(-6, 6)).toBe(false);
  expect(cover.covered(6, 6)).toBe(false);
  expect(cover.covered(-6, -6)).toBe(false);
});

test("tufts root only on open lawn near the blocks, and shrink to nothing at their edge", () => {
  const cover = new Cover([0, 0], 12);

  cover.add([-3, -3], [3, -3], [3, 3]);
  cover.add([-3, -3], [3, 3], [-3, 3]);

  const rooted = tufts(cover, [0, 0], 12);

  expect(rooted.length).toBeGreaterThan(5000);
  expect(rooted.some(({ x, z }) => Math.abs(x) < 2.9 && Math.abs(z) < 2.9)).toBe(false);
  expect(rooted.every(({ x, z }) => far(x, z) < 12)).toBe(true);

  const near = rooted.filter(({ x, z }) => far(x, z) < 6);
  const edge = rooted.filter(({ x, z }) => far(x, z) > 11);

  expect(mean(near)).toBeGreaterThan(0.06);
  expect(mean(near)).toBeLessThan(0.13);
  expect(mean(edge)).toBeLessThan(mean(near) * 0.4);
});

test("a large plot draws no more tufts than a small one may", () => {
  expect(tufts(new Cover([0, 0], 28), [0, 0], reachOf(40)).length).toBeLessThanOrEqual(MOST);
});

test("blades are drawn only: they catch the sun's shadow and cast none", () => {
  const group = new Group();

  group.add(lying("roof", [0, 0], 4, 4));

  const grass = blades(group, [0, 0], 6);

  expect(grass?.count).toBeGreaterThan(1000);
  expect(grass?.castShadow).toBe(false);
  expect(grass?.receiveShadow).toBe(true);
});

test("a plot with no open lawn grows none", () => {
  const group = new Group();

  group.add(lying("ground", [0, 0], 80, 80));

  expect(blades(group, [0, 0], 6)).toBeNull();
});
