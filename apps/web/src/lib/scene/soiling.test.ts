import { expect, test } from "bun:test";
import type { Fitted, OpeningKind } from "../builder/pv.ts";
import { soiling } from "./soiling.ts";

/** An opening on a wall facing south at north 0, `east` metres along it; a window's sill is
 * `sill` metres up. */
function fitted(kind: OpeningKind, east: number, sill = 0.9): Fitted {
  const [low, high] = kind === "window" ? [sill, sill + 1.4] : [0, 2.1];

  return {
    kind,
    corners: [
      [east, 0, low],
      [east + 1.2, 0, low],
      [east + 1.2, 0, high],
      [east, 0, high],
    ],
    out: [0, -1, 0],
  };
}

test("soiling runs down the plaster under each window's sill, and under no door", () => {
  const [soil] = soiling([fitted("window", 0), fitted("frontDoor", 3), fitted("window", 6, 4)]);
  const position = soil?.geometry.getAttribute("position");
  const seep = soil?.geometry.getAttribute("seep");
  const heights = Array.from({ length: position?.count ?? 0 }, (_, i) => position?.getY(i) ?? 0);

  // Drawn only: the scene casts no shadow from what is named so.
  expect(soil?.name).toBe("soil");
  // Two windows, a patch of two triangles each.
  expect(heights).toHaveLength(12);
  // From each sill, 0.9 m and 4 m up, three quarters of a metre down.
  expect(Math.max(...heights.slice(0, 6))).toBeCloseTo(0.9, 5);
  expect(Math.min(...heights.slice(0, 6))).toBeCloseTo(0.15, 5);
  expect(Math.max(...heights.slice(6))).toBeCloseTo(4, 5);
  // Most under the sill, none at the foot of the run.
  expect(seep?.getY(2)).toBe(1);
  expect(seep?.getY(0)).toBe(0);
});

test("a house without windows is not soiled", () => {
  expect(soiling([fitted("frontDoor", 3)])).toEqual([]);
});
