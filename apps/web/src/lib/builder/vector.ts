// Vector arithmetic in the crate's frame (east, north, up), shared by the scene and the template
// thumbnails. Free of three.js, so the thumbnails never load it.
import type { Point } from "./pv.ts";

export type Vector = readonly [number, number, number];

export const dot = (a: Vector, b: Vector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Vector, b: Vector): Vector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function unit(v: Vector): Vector {
  const length = Math.hypot(...v) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
}

/** A flat polygon's normal by Newell's method, its length twice the area, the way its corners
 * turn: any three of them may lie in a line, and it need not be convex. */
export function newell(corners: readonly Point[]): Vector {
  return corners.reduce<Vector>(
    (sum, a, i) => {
      const b = corners[(i + 1) % corners.length] ?? a;

      return [
        sum[0] + (a[1] - b[1]) * (a[2] + b[2]),
        sum[1] + (a[2] - b[2]) * (a[0] + b[0]),
        sum[2] + (a[0] - b[0]) * (a[1] + b[1]),
      ];
    },
    [0, 0, 0],
  );
}

/** A face's normal, east, north, up, turned to the sky. */
export function normal(corners: readonly Point[]): Vector {
  if (corners.length < 3) return [0, 0, 1];

  const n = unit(newell(corners));

  return n[2] < 0 || (n[2] === 0 && n[0] + n[1] < 0) ? [-n[0], -n[1], -n[2]] : n;
}
