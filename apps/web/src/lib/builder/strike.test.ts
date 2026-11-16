/// <reference types="bun" />
import { expect, test } from "bun:test";
import { PerspectiveCamera } from "three";
import { buildAround } from "../scene/around.ts";
import type { Around, Standing } from "./imported.ts";
import type { Geometry, Point } from "./pv.ts";
import { buildScene, strike } from "./scene.ts";

/** A flat lid 6 m up over a 10 m square from `east`, `north`. */
function lid(id: number, east: number, north: number, hidden: boolean): Standing {
  const corners: Point[] = [
    [east, north, 6],
    [east + 10, north, 6],
    [east + 10, north + 10, 6],
    [east, north + 10, 6],
  ];

  return { id, hidden, faces: [{ surface: "roof", corners }] };
}

/** The house's flat roof 3 m up over the origin, under the hidden imported building 0. */
const house: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [-4, -4, 3],
        [4, -4, 3],
        [4, 4, 3],
        [-4, 4, 3],
      ],
    },
  ],
  solids: [],
};

const AROUND: Around = {
  buildings: [lid(0, -5, -5, true), lid(7, 30, -5, false)],
  hedges: [],
  trees: [],
  grounds: [],
  terrain: {
    origin: [-100, -100, 0],
    across: [100, 0, 0],
    along: [0, 100, 0],
    side: 3,
    heights: [2, 2, 2, 2, 2, 2, 2, 2, 2],
  },
  credits: [],
};

/** What a ray straight down at `east`, `north` strikes. */
function below(east: number, north: number, ghosts: boolean) {
  const camera = new PerspectiveCamera(40, 1, 0.1, 500);

  // Looking straight down, north up.
  camera.up.set(0, 0, -1);
  camera.position.set(east, 100, 0 - north);
  camera.lookAt(east, 0, 0 - north);
  camera.updateMatrixWorld();

  const { group } = buildAround(AROUND, "strike", ghosts);

  group.updateMatrixWorld(true);

  const hit = strike(buildScene(house), [], camera, [0, 0], group);

  // To the millimetre: the ray's arithmetic leaves float noise.
  return hit?.kind === "point"
    ? { ...hit, point: hit.point.map((value) => Math.round(value * 1000) / 1000 + 0) }
    : hit;
}

test("a strike on an imported building tells which one", () => {
  expect(below(35, 0, false)).toEqual({ kind: "imported", building: 7 });
});

test("a strike on the imported terrain is a point on it", () => {
  expect(below(20, 0, false)).toEqual({ kind: "point", point: [20, 0, 2] });
});

test("a hidden building drawn see-through is struck where the scene's own does not lie under it", () => {
  // Over the house the house is struck; beside it, the hidden building.
  expect(below(0, 0, true)).toEqual({ kind: "point", point: [0, 0, 3] });
  expect(below(-4.5, 0, true)).toEqual({ kind: "imported", building: 0 });
  // Not drawn, not struck: the terrain under it is.
  expect(below(-4.5, 0, false)).toEqual({ kind: "point", point: [-4.5, 0, 2] });
});
