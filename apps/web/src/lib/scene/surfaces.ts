// Surfaces as the scene draws them (ADR 20 Look): faces' texture coordinates in metres, a module's
// on its cells, and a tree's crown of leaves. Pure: no DOM.
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  type MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import type { Face, Point } from "../builder/pv.ts";
import { cross, dot, normal, unit } from "../builder/vector.ts";
import { hedge, leaves, REPEAT } from "./materials.ts";

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

/** Lehmer's generator: the same leaves on every build. */
export function seeded(seed: number): () => number {
  let state = seed;

  return () => (state = (state * 16807) % 2147483647) / 2147483647;
}

/** One cluster of leaves: where it sits, how big it is, and its hue, saturation and lightness. */
export interface Cluster {
  readonly at: readonly [number, number, number];
  readonly size: number;
  readonly hsl: readonly [number, number, number];
}

/** Leaf clusters as one instanced mesh of the prototype's icosahedra, each turned at random. */
export function clusters(made: readonly Cluster[], random: () => number): InstancedMesh {
  const mesh = new InstancedMesh(new IcosahedronGeometry(0.5, 1), leaves(), made.length);

  const [matrix, turn, at, size, colour] = [
    new Matrix4(),
    new Quaternion(),
    new Vector3(),
    new Vector3(),
    new Color(),
  ];

  for (const [i, cluster] of made.entries()) {
    const k = cluster.size;

    at.set(...cluster.at);
    turn.setFromEuler(new Euler(random() * 3, random() * 3, random() * 3));
    size.set(k, k * (0.8 + random() * 0.3), k);
    mesh.setMatrixAt(i, matrix.compose(at, turn, size));
    colour.setHSL(...cluster.hsl, SRGBColorSpace);
    mesh.setColorAt(i, colour);
  }

  return mesh;
}

/** One cluster of a broadleaf crown of `radius`, about its centre: in a shell of the sphere,
 * lighter high and outside. */
export function leaf(radius: number, random: () => number): Cluster {
  // Points in a shell, denser outside so the crown reads as clusters.
  const [u, phi, shell] = [
    random() * 2 - 1,
    random() * Math.PI * 2,
    0.55 + 0.45 * Math.cbrt(random()),
  ];

  const ring = Math.sqrt(1 - u * u);

  return {
    at: [
      radius * shell * ring * Math.cos(phi),
      radius * shell * u,
      radius * shell * ring * Math.sin(phi),
    ],
    size: (0.6 + random() * 0.65) * Math.min(1, radius / 2.7 + 0.3),
    // Deep inside and low, where the crown shades itself; sunlit and yellower outside.
    hsl: [
      0.22 + random() * 0.08,
      0.4 + random() * 0.16,
      0.07 + shell * 0.08 + u * shell * 0.05 + random() * 0.07,
    ],
  };
}

/** How many clusters a broadleaf crown of `radius` holds. */
export const leafCount = (radius: number): number =>
  Math.max(12, Math.round(260 * (radius / 2.7) ** 2));

/** A tree's crown: clusters of leaves in a shell of the sphere, lighter high and outside. */
export function crown(radius: number, seed: number): InstancedMesh {
  const random = seeded(seed);
  const made = Array.from({ length: leafCount(radius) }, () => leaf(radius, random));

  return clusters(made, random);
}

/** Leaf clusters per square metre of a crown's surface: the broadleaf crown's density. */
const DENSITY = 2.8;

/** How many clusters a conifer's crown of `radius` and `height` holds. */
export const needleCount = (radius: number, height: number): number =>
  Math.min(
    1500,
    Math.max(24, Math.round(3 * DENSITY * Math.PI * radius * Math.hypot(radius, height))),
  );

/** One cluster of a conifer's crown, from its base up: in a shell of the cone, smaller and
 * darker blue-green than a broadleaf's, lighter toward the tip. */
export function needle(radius: number, height: number, random: () => number): Cluster {
  // Up the cone by area: more clusters low, where it is wide.
  const up = 1 - Math.sqrt(random());
  const [phi, shell] = [random() * Math.PI * 2, 0.6 + 0.4 * Math.cbrt(random())];
  const reach = radius * (1 - up) * shell;

  return {
    at: [reach * Math.cos(phi), height * up, reach * Math.sin(phi)],
    size: (0.45 + random() * 0.45) * Math.min(1, radius / 2 + 0.4) * (1 - up * 0.6),
    hsl: [0.3 + random() * 0.05, 0.3 + random() * 0.12, 0.12 + up * 0.05 + random() * 0.05],
  };
}

/** A conifer's crown: clusters in a shell of the cone from its base up `height`. */
export function conifer(radius: number, height: number, seed: number): InstancedMesh {
  const random = seeded(seed);

  const made = Array.from({ length: needleCount(radius, height) }, () =>
    needle(radius, height, random),
  );

  const mesh = clusters(made, random);
  // A dark body, so the gaps between the clusters read as depth, not sky.
  const body = new Mesh(new ConeGeometry(radius * 0.75, height * 0.95, 14), hedge());

  body.position.y = (height * 0.95) / 2;
  mesh.add(body);

  return mesh;
}

/** Leaf clusters per square metre of a clipped hedge. */
const HEDGE = 14;

/** A hedge's leaves: small clusters spread over its faces, in three.js's frame. */
function foliage(faces: readonly Face[], seed: number): InstancedMesh {
  const random = seeded(seed);

  const made = faces.flatMap(({ corners }) => {
    const points = fan(corners);

    return Array.from({ length: points.length / 3 }, (_, t) => {
      const [a, b, c] = [points[t * 3], points[t * 3 + 1], points[t * 3 + 2]];

      if (a === undefined || b === undefined || c === undefined) return [];

      const area = Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;

      return Array.from({ length: Math.round(area * HEDGE) }, (): Cluster => {
        // A uniform point of the triangle.
        let [u, v] = [random(), random()];

        if (u + v > 1) [u, v] = [1 - u, 1 - v];

        const on = (k: 0 | 1 | 2): number => a[k] + u * (b[k] - a[k]) + v * (c[k] - a[k]);

        return {
          at: [on(0), on(2), 0 - on(1)],
          size: 0.22 + random() * 0.22,
          hsl: [0.25 + random() * 0.05, 0.4 + random() * 0.12, 0.13 + random() * 0.07],
        };
      });
    }).flat();
  });

  return clusters(made.slice(0, 4000), random);
}

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** East, north, up to three.js: x east, y up, z south. */
const toThree = ([east, north, up]: Point): [number, number, number] => [east, up, 0 - north];

/** Each convex face as a fan of triangles. */
function triangles(faces: readonly Face[]): number[] {
  return faces.flatMap(({ corners }) => fan(corners).flatMap((point) => toThree(point)));
}

export function surface(
  name: Face["surface"] | "flat",
  faces: readonly Face[],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- set up, then drawn.
  material: MeshStandardMaterial,
  repeat: readonly [number, number],
): Mesh {
  const geometry = new BufferGeometry();

  geometry.setAttribute("position", new Float32BufferAttribute(triangles(faces), 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs(faces, repeat), 2));
  geometry.computeVertexNormals();

  // Double-sided: the crate does not promise a winding.
  material.side = DoubleSide;
  material.flatShading = true;

  const mesh = new Mesh(geometry, material);

  mesh.name = name;

  return mesh;
}

/** Hedges: a dark body under clusters of leaves. */
export function hedges(faces: readonly Face[]): Mesh[] {
  if (faces.length === 0) return [];

  const body = surface("hedge", faces, hedge(), REPEAT.render);

  body.add(foliage(faces, 13));

  return [body];
}
