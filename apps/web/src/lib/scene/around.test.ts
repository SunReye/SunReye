/// <reference types="bun" />
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js's own objects, read only. */
import { expect, test } from "bun:test";
import {
  BufferAttribute,
  BufferGeometry,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Object3D,
} from "three";
import type { Around, Standing } from "../builder/imported.ts";
import { buildAround, buildingAt, masks, settle } from "./around.ts";

type Corner = readonly [number, number];

const wall = (from: Corner, to: Corner) => ({
  surface: "wall" as const,
  corners: [
    [...from, 0],
    [...to, 0],
    [...to, 6],
    [...from, 6],
  ] as const,
});

const lid = (corners: readonly Corner[]) => ({
  surface: "roof" as const,
  corners: corners.map(([e, n]) => [e, n, 6] as const),
});

/** A flat-roofed box 10 m square from `east`, `north`: four walls and a lid of two. */
function box(id: number, east: number, north: number, hidden = false): Standing {
  const [a, b, c, d] = [
    [east, north],
    [east + 10, north],
    [east + 10, north + 10],
    [east, north + 10],
  ] as const;

  return {
    id,
    hidden,
    faces: [wall(a, b), wall(b, c), wall(c, d), wall(d, a), lid([a, b, c]), lid([a, c, d])],
  };
}

/** 200 m of terrain on a 3 by 3 grid about the origin, rising to 4 m in the north-east corner. */
const AROUND: Around = {
  buildings: [box(0, -5, -5, true), box(1, 30, 0), box(2, 400, 400)],
  hedges: [],
  trees: [
    { kind: "cylinder", base: [-20, 0, 0], radius: 0.2, height: 6 },
    { kind: "sphere", centre: [-20, 0, 6], radius: 2.4 },
    { kind: "cylinder", base: [-90, 0, 0], radius: 0.2, height: 2 },
    { kind: "cone", base: [-90, 0, 2], radius: 2.4, height: 6 },
  ],
  grounds: [
    {
      finish: "road",
      width: 5,
      points: [
        [-100, 50, 0],
        [100, 50, 0],
      ],
    },
    {
      finish: "water",
      points: [
        [-100, -100, 0],
        [0, -100, 0],
        [0, -50, 0],
        [-100, -50, 0],
      ],
    },
  ],
  terrain: {
    origin: [-100, -100, 0],
    across: [100, 0, 0],
    along: [0, 100, 0],
    side: 3,
    heights: [0, 0, 0, 0, 0, 0, 0, 0, 4],
  },
  credits: ["© OpenStreetMap contributors"],
};

function named(group: Object3D, name: string): Object3D[] {
  const found: Object3D[] = [];

  group.traverse((part) => {
    if (part instanceof Mesh && part.name === name) found.push(part);
  });

  return found;
}

/** A mesh's corners: east, up, south. */
function nodes(mesh: Object3D | undefined): number[][] {
  const geometry: unknown = mesh instanceof Mesh ? mesh.geometry : null;

  const position: unknown =
    geometry instanceof BufferGeometry ? geometry.getAttribute("position") : null;

  if (!(position instanceof BufferAttribute)) throw new TypeError("no corners");

  return Array.from({ length: position.count }, (_, i) => [
    position.getX(i),
    position.getY(i),
    position.getZ(i),
  ]);
}

function standard(mesh: Object3D | undefined): MeshStandardMaterial {
  const material: unknown = mesh instanceof Mesh ? mesh.material : null;

  if (!(material instanceof MeshStandardMaterial)) throw new TypeError("no standard material");

  return material;
}

/** The buildings a merged mesh's triangles belong to. */
function idsOf(mesh: Object3D): number[] {
  const count = nodes(mesh).length / 3;

  return [...new Set(Array.from({ length: count }, (_, face) => buildingAt(mesh, face) ?? -1))];
}

test("the terrain is drawn at the crate's heights in the lawn's finish, each finish over it", () => {
  const { group } = buildAround(AROUND, "a");
  const [terrain] = named(group, "terrain");
  const position = nodes(terrain);

  expect(position).toHaveLength(9);
  // The north-east corner: 100 m east, 4 m up, 100 m north.
  expect(position[8]).toEqual([100, 4, -100]);
  // Water under the road, as the document orders them.
  expect(named(group, "ground")).toHaveLength(2);
  expect(named(group, "ground").map(({ renderOrder }) => renderOrder)).toEqual([-3, -1]);
});

test("a ground finish's mask is painted where it lies on the terrain's grid", () => {
  const painted = masks(AROUND.terrain, AROUND.grounds);
  const road = painted.get("road");
  const water = painted.get("water");
  const side = road?.side ?? 0;

  const at = (mask: typeof road, east: number, north: number): number | undefined =>
    mask?.data[
      Math.floor(((north + 100) / 200) * side) * side + Math.floor(((east + 100) / 200) * side)
    ];

  expect(side).toBe(1024);
  expect([at(road, 0, 50), at(road, 0, 53), at(road, 0, 0)]).toEqual([255, 0, 0]);
  expect([at(water, -50, -75), at(water, 50, -75)]).toEqual([255, 0]);
  expect(painted.has("grass")).toBe(false);
});

test("a hidden building is not drawn, and one past the radius neither", () => {
  const { group } = buildAround(AROUND, "a");
  const drawn = named(group, "neighbour");

  // The walls, then the flat roof: the one building shown within reach.
  expect(drawn.map((mesh) => idsOf(mesh))).toEqual([[1], [1]]);
  expect(buildingAt(drawn[0]!, 0)).toBe(1);
  expect(buildingAt(named(group, "terrain")[0]!, 0)).toBeNull();
});

test("the builder draws a hidden building see-through, so a tap can show it again", () => {
  const { group } = buildAround(AROUND, "a", true);
  const ghost = named(group, "neighbour").find((mesh) => buildingAt(mesh, 0) === 0);

  expect(standard(ghost).opacity).toBeLessThan(0.5);
  expect(ghost?.castShadow).toBe(false);
});

test("the trees are a handful of draws: trunks, crown bodies and leaves, thinner far off", () => {
  const { group } = buildAround(AROUND, "a");

  const counts = named(group, "solid").flatMap((part) =>
    part instanceof InstancedMesh ? [part.count] : [],
  );

  // Two trunks, one round body, one pointed one, then the leaves of both crowns.
  expect(counts.slice(0, 3)).toEqual([2, 1, 1]);

  // The crown 20 m off in full; the conifer 90 m off thinned.
  expect(counts[3]).toBeGreaterThan(205);
  expect(counts[3]).toBeLessThan(205 + 170);
});

test("everything fades out over the last fifth of the radius about the import's middle", () => {
  const { fade } = buildAround(AROUND, "a");

  expect(fade.value.toArray()).toEqual([0, 0, 100, 20]);
});

test("a dragged import moves and turns whole about its new place", () => {
  const drawn = buildAround(AROUND, "a");

  // 10 m east and a quarter turn clockwise, seen from above: what lay 30 m east lies 30 m south.
  settle(drawn, 0, { x: 0, z: 0, turn: 0 }, { x: 10, z: 0, turn: 90 });

  const moved = new Vector3(30, 0, 0).applyMatrix4(drawn.group.matrixWorld);

  expect(moved.x).toBeCloseTo(10);
  expect(moved.z).toBeCloseTo(30);
  expect([drawn.fade.value.x, drawn.fade.value.y]).toEqual([10, 0]);
});
