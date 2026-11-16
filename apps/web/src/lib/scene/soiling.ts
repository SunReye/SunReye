// Soiling below window sills (ADR 20 Look): where rain runs off a sill it carries dirt down the
// plaster. One drawn decal for every window, streaked in its shader; it casts and shades nothing.
import { BufferGeometry, Float32BufferAttribute, Mesh, type MeshStandardMaterial } from "three";
import type { Fitted, Point } from "../builder/pv.ts";
import { soiled } from "./decals.ts";

/** Metres the soiling runs down from the sill, reaches past the window each side, and lies
 * off the wall. */
const RUN = 0.75;
const PAST = 0.04;
const OFF = 0.006;

/** East, north, up to three.js: x east, y up, z south. */
const toThree = ([east, north, up]: Point): [number, number, number] => [east, up, 0 - north];

/** A patch's corners, and at each how far along the wall it lies in metres and how much runs
 * there, 1 under the sill to 0 at the foot of the run. */
interface Patch {
  readonly position: readonly number[];
  readonly seep: readonly number[];
}

/** One window's patch. */
function patch({ corners: [low, right], out }: Fitted): Patch {
  const width = Math.hypot(right[0] - low[0], right[1] - low[1]) || 1;
  const along: Point = [(right[0] - low[0]) / width, (right[1] - low[1]) / width, 0];
  // Where the wall's line passes the origin's side: streaks differ from window to window.
  const from = low[0] * along[0] + low[1] * along[1];
  // Never under the ground.
  const run = Math.min(RUN, low[2]);

  const at = (across: number, down: number): Point => [
    low[0] + along[0] * across + out[0] * OFF,
    low[1] + along[1] * across + out[1] * OFF,
    low[2] - down,
  ];

  const corners = [
    [-PAST, run, 0],
    [width + PAST, run, 0],
    [width + PAST, 0, 1],
    [-PAST, 0, 1],
  ] as const;

  const order = [0, 1, 2, 0, 2, 3].map((i) => corners[i] ?? corners[0]);

  return {
    position: order.flatMap(([across, down]) => toThree(at(across, down))),
    seep: order.flatMap(([across, , runs]) => [from + across, runs]),
  };
}

/** The soiling under the windows among `fitted`, as one mesh named "soil"; none without any. */
export function soiling(fitted: readonly Fitted[]): Mesh<BufferGeometry, MeshStandardMaterial>[] {
  const patches = fitted.flatMap((opening) =>
    opening.kind === "window" && opening.corners[0][2] > 0.2 ? [patch(opening)] : [],
  );

  if (patches.length === 0) return [];

  const geometry = new BufferGeometry();

  const gathered = (key: keyof Patch): number[] => patches.flatMap((made) => made[key]);

  geometry.setAttribute("position", new Float32BufferAttribute(gathered("position"), 3));
  geometry.setAttribute("seep", new Float32BufferAttribute(gathered("seep"), 2));
  geometry.computeVertexNormals();

  const mesh = new Mesh(geometry, soiled());

  mesh.name = "soil";

  return [mesh];
}
