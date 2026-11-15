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

/** A face's normal, east, north, up, turned to the sky. */
export function normal([a, b, c]: readonly Point[]): Vector {
  if (a === undefined || b === undefined || c === undefined) return [0, 0, 1];

  const n = unit(
    cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]),
  );

  return n[2] < 0 || (n[2] === 0 && n[0] + n[1] < 0) ? [-n[0], -n[1], -n[2]] : n;
}
