// Ground surfaces and fences as the scene draws them (ADR 20 Surroundings): placed by the pv
// crate, drawn only, never shading. Pure: no DOM.
import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  type MeshStandardMaterial,
} from "three";
import type { Fencing, Ground, Point } from "../builder/pv.ts";
import { FENCE, GROUND, REPEAT } from "./materials.ts";
import { fan, uvs } from "./surfaces.ts";

/** Metres above the lawn of the first surface, and between each and the next. */
const LIFT = 0.005;
const STACK = 0.002;

/** East, north, up to three.js: x east, y up, z south. */
const toThree = ([east, north, up]: Point): [number, number, number] => [east, up, 0 - north];

const far = (p: Point | undefined, q: Point | undefined): number =>
  p === undefined || q === undefined ? 0 : Math.hypot(q[0] - p[0], q[1] - p[1]);

/**
 * Where each point of a four-cornered surface's triangles lies across its narrow side, -1 at
 * one long edge to 1 at the other, and 1 to say so: feet and wheels run along the long side
 * (ADR 20 Look). Any other outline says nothing, and nothing wears.
 */
function across(corners: readonly Point[]): number[] {
  if (corners.length !== 4) return fan(corners).flatMap(() => [0, 0]);

  const [a, b, c] = corners;
  // Whether the first side is the narrow one: then the first and last corners share a long edge.
  const narrow = far(a, b) < far(b, c);
  const side = narrow ? [-1, 1, 1, -1] : [-1, -1, 1, 1];

  return fan(corners.map((_, i) => [side[i] ?? 0, 0, 0] as const)).flatMap(([at]) => [at, 1]);
}

/** A ground surface, lifted over the lawn and over every earlier one. */
export function ground({ finish, corners }: Ground, index: number): Mesh {
  const geometry = new BufferGeometry();
  const face = { surface: "roof", corners } as const;

  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      fan(corners).flatMap((point) => toThree(point)),
      3,
    ),
  );
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs([face], REPEAT[finish]), 2));
  geometry.setAttribute("wear", new Float32BufferAttribute(across(corners), 2));
  geometry.computeVertexNormals();

  const material = GROUND[finish]();

  material.side = DoubleSide;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1 - index;
  material.polygonOffsetUnits = -1 - index;

  const mesh = new Mesh(geometry, material);

  mesh.position.y = LIFT + index * STACK;
  mesh.name = "ground";
  // What grows through it: blades stand on a lawn surface, and on no other (ADR 20).
  mesh.userData = { finish };

  return mesh;
}

/** Board, bar and wall sizes in metres. */
const BOARD = 0.04;
const WALL = 0.2;
const POST = 0.09;
const RAIL = 0.04;
const BAR = 0.02;
const BARS = 0.12;

/** A box from `from` to `to` on the ground, `thick` across and `high` tall, its UVs in metres. */
function run(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  [thick, high, low]: readonly [number, number, number],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
  material: MeshStandardMaterial,
): Mesh {
  const length = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const geometry = new BoxGeometry(length, high, thick);
  const uv = geometry.getAttribute("uv");
  const metres = REPEAT.wood[0];

  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, (uv.getX(i) * length) / metres, (uv.getY(i) * high) / metres);

  const mesh = new Mesh(geometry, material);

  mesh.position.set((from[0] + to[0]) / 2, low + high / 2, (from[2] + to[2]) / 2);
  mesh.rotation.y = Math.atan2(-(to[2] - from[2]), to[0] - from[0]);

  return mesh;
}

/** Upright bars of `size` between `from` and `to`, every `every` metres. */
function bars(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  [size, every, height]: readonly [number, number, number],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
  material: MeshStandardMaterial,
): InstancedMesh {
  const length = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const count = Math.max(2, Math.round(length / every) + 1);
  const mesh = new InstancedMesh(new BoxGeometry(size, height, size), material, count);
  const matrix = new Matrix4();

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);

    mesh.setMatrixAt(
      i,
      matrix.makeTranslation(
        from[0] + (to[0] - from[0]) * t,
        height / 2,
        from[2] + (to[2] - from[2]) * t,
      ),
    );
  }

  return mesh;
}

/** One stretch of fence between two points, in its finish. */
function stretch(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  { finish, height }: Fencing,
): (Mesh | InstancedMesh)[] {
  const material = FENCE[finish]();

  if (finish === "wall") return [run(from, to, [WALL, height, 0], material)];

  if (finish === "wood") {
    return [
      run(from, to, [BOARD, height - 0.05, 0.05], material),
      // A post at each end.
      bars(from, to, [POST, Infinity, height], material),
    ];
  }

  // Rails top and bottom, bars between, posts at the ends.
  return [
    run(from, to, [RAIL, RAIL, height - RAIL], material),
    run(from, to, [RAIL, RAIL, 0.08], material),
    bars(from, to, [BAR, BARS, height - RAIL], material),
    bars(from, to, [POST * 0.7, 2.5, height], material),
  ];
}

/** A fence along its points, every stretch in its finish. */
export function fence(fencing: Fencing): Group {
  const group = new Group();
  const points = fencing.points.map((point) => toThree(point));

  for (const [i, to] of points.entries()) {
    const from = points[i - 1];

    if (from !== undefined) group.add(...stretch(from, to, fencing));
  }

  group.name = "fence";

  return group;
}
