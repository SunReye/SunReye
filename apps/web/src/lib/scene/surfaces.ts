// Surfaces as the scene draws them (ADR 20 Look): faces as triangles, a module's texture
// coordinates on its cells, and a tree's crown as one soft shape. Pure: no DOM.
import { ConeGeometry, IcosahedronGeometry, Mesh } from "three";
import type { Face, Point } from "../builder/pv.ts";
import { normal } from "../builder/vector.ts";
import { foliage } from "./materials.ts";

/** A convex polygon's corners as a fan of triangles, three corners each. */
export function fan([first, ...rest]: readonly Point[]): Point[] {
  return first === undefined
    ? []
    : rest.slice(1).flatMap((corner, i) => [first, rest[i] ?? first, corner]);
}

/** Whether a face lies level: a flat roof. */
export function level(face: Face): boolean {
  return normal(face.corners)[2] > 0.99;
}

function along(p: Point | undefined, q: Point | undefined): number {
  return p === undefined || q === undefined ? 0 : Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
}

/** A module's UVs: its corners on the texture, the cells' long side along its long side. */
export function moduleUvs([a, b, , d]: readonly Point[]): number[] {
  const corners: readonly (readonly [number, number])[] =
    along(a, b) > along(a, d)
      ? [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
        ]
      : [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ];

  return fan(corners.map(([u, v]) => [u, v, 0])).flatMap(([u, v]) => [u, v]);
}

/** A broadleaf's crown: a ball of its radius about its centre, as the crate shades it. */
export function crown(radius: number): Mesh {
  return new Mesh(new IcosahedronGeometry(radius, 4), foliage());
}

/** A conifer's crown: a cone from its base up `height`. */
export function conifer(radius: number, height: number): Mesh {
  const geometry = new ConeGeometry(radius, height, 32);

  // three.js centres a cone on its position.
  geometry.translate(0, height / 2, 0);

  return new Mesh(geometry, foliage());
}
