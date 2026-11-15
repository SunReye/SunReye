// Which cell of which module grid a point on a roof lies in (ADR 20): what a strike on a roof
// face's grid lands on. Pure.
import type { Modules, Point, Scene } from "./pv.ts";

/** A point this far off a face's plane, in metres, still lies on it. */
const ON_FACE = 0.1;

/** A cell of grid `grid`, by its position in the scene. */
export interface CellHit {
  readonly grid: number;
  readonly row: number;
  readonly column: number;
}

const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The laid-out cell scene point `point` lies in, on its grid's face; null for none. */
export function cellAt(
  scene: Readonly<Scene>,
  { roofs, grids }: Readonly<Pick<Modules, "roofs" | "grids">>,
  point: Point,
): CellHit | null {
  for (const [grid, { block, face }] of (scene.grids ?? []).entries()) {
    const roof = roofs.find((item) => item.block === block && item.face === face);
    const cells = grids[grid];

    if (roof !== undefined && cells !== undefined && cells !== null) {
      const { origin, across, up } = roof;
      const off: Point = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
      const [u, v] = [dot(off, across), dot(off, up)];

      // What the frame does not reach lies off the plane.
      const rest = Math.hypot(
        off[0] - u * across[0] - v * up[0],
        off[1] - u * across[1] - v * up[1],
        off[2] - u * across[2] - v * up[2],
      );

      const cell = cells.find(({ area: [[l, b], [r, t]] }) => u >= l && u <= r && v >= b && v <= t);

      if (rest <= ON_FACE && cell !== undefined)
        return { grid, row: cell.row, column: cell.column };
    }
  }

  return null;
}
