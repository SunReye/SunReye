// Surfaces as the scene draws them (ADR 20 Look): faces' texture coordinates in metres, a module's
// on its cells, and a tree's crown of leaves. Pure: no DOM.
import {
  Color,
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import type { Face, Point } from "../builder/pv.ts";
import { leaves } from "./materials.ts";

/** A convex polygon's corners as a fan of triangles, three corners each. */
export function fan([first, ...rest]: readonly Point[]): Point[] {
  return first === undefined
    ? []
    : rest.slice(1).flatMap((corner, i) => [first, rest[i] ?? first, corner]);
}

type Vector = readonly [number, number, number];

const dot = (a: Vector, b: Vector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross = (a: Vector, b: Vector): Vector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function unit(v: Vector): Vector {
  const length = Math.hypot(...v) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
}

/** A face's normal, east, north, up, turned to the sky. */
function normal([a, b, c]: readonly Point[]): Vector {
  if (a === undefined || b === undefined || c === undefined) return [0, 0, 1];

  const n = unit(
    cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]),
  );

  return n[2] < 0 || (n[2] === 0 && n[0] + n[1] < 0) ? [-n[0], -n[1], -n[2]] : n;
}

/** Whether a face lies level: a flat roof. */
export function level(face: Face): boolean {
  return normal(face.corners)[2] > 0.99;
}

/**
 * Each face's UVs in repeats of `[across, up]` metres: across runs level along the face, up runs
 * up its slope, so a roof's tiles hang down it.
 */
export function uvs(faces: readonly Face[], [across, up]: readonly [number, number]): number[] {
  return faces.flatMap(({ corners }) => {
    const n = normal(corners);
    const t = Math.abs(n[2]) > 0.99 ? ([1, 0, 0] as const) : unit(cross([0, 0, 1], n));
    const b = cross(n, t);

    return fan(corners).flatMap((point) => [dot(point, t) / across, -dot(point, b) / up]);
  });
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

/** A tree's crown: clusters of leaves in a shell of the sphere, lighter high and outside. */
export function crown(radius: number, seed: number): InstancedMesh {
  const count = Math.max(12, Math.round(260 * (radius / 2.7) ** 2));
  let state = seed;
  const random = (): number => (state = (state * 16807) % 2147483647) / 2147483647;

  const mesh = new InstancedMesh(new IcosahedronGeometry(0.5, 1), leaves(), count);

  const [matrix, turn, at, size, colour] = [
    new Matrix4(),
    new Quaternion(),
    new Vector3(),
    new Vector3(),
    new Color(),
  ];

  for (let i = 0; i < count; i++) {
    // Points in a shell, denser outside so the crown reads as clusters.
    const [u, phi, shell] = [
      random() * 2 - 1,
      random() * Math.PI * 2,
      0.55 + 0.45 * Math.cbrt(random()),
    ];

    const ring = Math.sqrt(1 - u * u);

    at.set(
      radius * shell * ring * Math.cos(phi),
      radius * shell * u,
      radius * shell * ring * Math.sin(phi),
    );
    turn.setFromEuler(new Euler(random() * 3, random() * 3, random() * 3));

    const k = (0.6 + random() * 0.65) * Math.min(1, radius / 2.7 + 0.3);

    size.set(k, k * (0.8 + random() * 0.3), k);
    mesh.setMatrixAt(i, matrix.compose(at, turn, size));
    colour.setHSL(
      0.24 + random() * 0.05,
      0.38 + random() * 0.14,
      0.17 + u * shell * 0.05 + random() * 0.07,
      SRGBColorSpace,
    );
    mesh.setColorAt(i, colour);
  }

  return mesh;
}
