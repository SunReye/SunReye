import { expect, test } from "bun:test";
import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from "three";
import { eaves } from "./eaves.ts";

/** Two slopes of a gable as triangles: the south one from an eave at 3 m, the north from 5 m,
 * both to a ridge at 7 m. */
function gable(): Mesh {
  const geometry = new BufferGeometry();

  const south = [
    [0, 3, 4],
    [10, 3, 4],
    [10, 7, 0],
    [0, 3, 4],
    [10, 7, 0],
    [0, 7, 0],
  ];

  const north = [
    [0, 5, -2],
    [10, 7, 0],
    [10, 5, -2],
    [0, 5, -2],
    [0, 7, 0],
    [10, 7, 0],
  ];

  geometry.setAttribute("position", new Float32BufferAttribute([...south, ...north].flat(), 3));

  const mesh = new Mesh(geometry);

  mesh.name = "roof";

  return mesh;
}

test("each point of a roof knows its height above its own face's eave", () => {
  const roof = gable();
  const group = new Group();

  group.add(roof);
  eaves(group);

  const fall = roof.geometry.getAttribute("fall");
  const heights = Array.from({ length: fall.count }, (_, i) => fall.getX(i));

  // The south slope rises 4 m from its eave, the north one 2 m from its own.
  expect(heights.slice(0, 6)).toEqual([0, 0, 4, 0, 4, 4]);
  expect(heights.slice(6)).toEqual([0, 2, 0, 0, 2, 2]);
  // Known, every one.
  expect(Array.from({ length: fall.count }, (_, i) => fall.getY(i))).toEqual(
    Array.from({ length: 12 }, () => 1),
  );
});

test("what is not a roof gathers nothing at an eave", () => {
  const wall = gable();
  const group = new Group();

  wall.name = "wall";
  group.add(wall);
  eaves(group);

  expect(wall.geometry.hasAttribute("fall")).toBe(false);
});
