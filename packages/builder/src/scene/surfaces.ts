// Surfaces as the scene draws them (ADR 20 Look): faces as triangles and a tree's crown as one
// soft shape. Pure: no DOM.
import { ConeGeometry, IcosahedronGeometry, Mesh } from "three";
import { Earcut } from "three/src/extras/Earcut.js";
import type { Face, Point } from "../builder/pv.ts";
import { newell, normal } from "../builder/vector.ts";
import { foliage } from "./materials.ts";

/** A convex polygon's corners as a fan of triangles, three corners each. */
export function fan([first, ...rest]: readonly Point[]): Point[] {
  return first === undefined
    ? []
    : rest.slice(1).flatMap((corner, i) => [first, rest[i] ?? first, corner]);
}

/** A flat polygon's corners as triangles, three corners each, convex or not: a free-form roof
 * face or the wall under it (ADR 20). */
export function triangles(corners: readonly Point[]): Point[] {
  const [x = 0, y = 0, z = 0] = newell(corners).map((v) => Math.abs(v));

  // Seen along the normal's largest part, the polygon keeps its shape.
  const [u, v]: readonly [0 | 1 | 2, 0 | 1 | 2] =
    x >= Math.max(y, z) ? [1, 2] : y >= z ? [2, 0] : [0, 1];

  const plan = corners.flatMap((corner) => [corner[u], corner[v]]);

  return Earcut.triangulate(plan, [], 2).flatMap((i) => {
    const corner = corners[i];

    return corner === undefined ? [] : [corner];
  });
}

/** Whether a face lies level: a flat roof. */
export function level(face: Face): boolean {
  return normal(face.corners)[2] > 0.99;
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
