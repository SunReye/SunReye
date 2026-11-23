/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { Face } from "../../../../../packages/builder/src/builder/pv.ts";
import { thumbnail } from "../../../../../packages/builder/src/builder/thumbnail.ts";

const roof = (north: number): Face => ({
  surface: "roof",
  corners: [
    [0, north, 3],
    [10, north, 3],
    [10, -4, 6],
    [0, -4, 6],
  ],
});

test("a thumbnail paints far faces first, seen from the south-east above", () => {
  const front = roof(-8);
  const back = roof(0);
  const { polygons } = thumbnail([front, back]);

  expect(polygons.map(({ surface }) => surface)).toEqual(["roof", "roof"]);
  // The back face (north, 0) lies farther from a south-east camera than the front (−8).
  expect(polygons[0]?.points).toBe(thumbnail([back]).polygons[0]?.points);
});

test("its view box holds every corner with a margin", () => {
  const { box, polygons } = thumbnail([roof(-8)]);
  const [x, y, width, height] = box;

  const corners = polygons.flatMap(({ points }) =>
    points.split(" ").map((pair) => pair.split(",").map(Number)),
  );

  for (const [px = Number.NaN, py = Number.NaN] of corners) {
    expect(px).toBeGreaterThan(x);
    expect(px).toBeLessThan(x + width);
    expect(py).toBeGreaterThan(y);
    expect(py).toBeLessThan(y + height);
  }
});

test("a face turned toward the light is brighter than one turned away", () => {
  const south: Face = {
    surface: "wall",
    corners: [
      [0, -8, 0],
      [10, -8, 0],
      [10, -8, 3],
    ],
  };

  const east: Face = {
    surface: "wall",
    corners: [
      [10, -8, 0],
      [10, 0, 0],
      [10, 0, 3],
    ],
  };

  const [lit, shaded] = [thumbnail([south]), thumbnail([east])].map(
    ({ polygons }) => polygons[0]?.light ?? 0,
  );

  expect(lit).toBeGreaterThan(shaded ?? 1);
});
