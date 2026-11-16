// The imported trees (ADR 20 Look) in a handful of draws, however many stand in the area: the
// trunks, a dark body in each crown and the leaves' clusters, fewer the further off. Pure.
import {
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import type { Solid } from "../builder/pv.ts";
import { toThree } from "./around-fade.ts";
import * as finish from "./materials.ts";
import {
  clusters,
  leaf,
  leafCount,
  needle,
  needleCount,
  seeded,
  type Cluster,
} from "./surfaces.ts";

/** Metres from the scene's origin within which a crown is drawn in full; further off it thins. */
const CLOSE = 40;

/** How many leaf clusters every imported crown may hold together. */
const BUDGET = 40_000;

/** How many of a crown's `full` clusters are drawn `away` metres from the plot. */
function thinned(full: number, away: number): number {
  return Math.max(6, Math.round(full * Math.min(1, (CLOSE / Math.max(away, 1)) ** 1.5)));
}

/** A trunk, or a conifer's crown. */
type Upright = Extract<Solid, { readonly height: number }>;

/** A sphere, or a cone on its base. */
type Crown = Solid;

/** A crown's full count of clusters, and where it stands in three.js's frame. */
function crownOf(crown: Crown): { readonly full: number; readonly foot: [number, number, number] } {
  return crown.kind === "sphere"
    ? { full: leafCount(crown.radius), foot: toThree(crown.centre) }
    : { full: needleCount(crown.radius, crown.height), foot: toThree(crown.base) };
}

/** How many clusters the crown is drawn with before the budget: thinned by its distance. */
function wanted(crown: Crown): number {
  const { full, foot } = crownOf(crown);

  return thinned(full, Math.hypot(foot[0], foot[2]));
}

/** A crown's clusters about its place, `share` of the thinned ones, grown to cover what the
 * missing ones would. */
function crownClusters(crown: Crown, share: number, random: () => number): Cluster[] {
  const { full, foot } = crownOf(crown);
  const count = Math.max(4, Math.round(wanted(crown) * share));
  const grown = Math.min(3, Math.sqrt(full / count));

  return Array.from({ length: count }, () => {
    const made =
      crown.kind === "sphere"
        ? leaf(crown.radius, random)
        : needle(crown.radius, crown.height, random);

    return {
      ...made,
      at: [foot[0] + made.at[0], foot[1] + made.at[1], foot[2] + made.at[2]],
      size: made.size * grown,
    };
  });
}

type Triple = readonly [number, number, number];

/** Many of one body, each placed and sized. */
function instanced(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  body: BufferGeometry,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  material: Material,
  placed: readonly (readonly [Triple, Triple])[],
): InstancedMesh[] {
  if (placed.length === 0) return [];

  const mesh = new InstancedMesh(body, material, placed.length);
  const [matrix, upright] = [new Matrix4(), new Quaternion()];

  for (const [i, [at, size]] of placed.entries()) {
    mesh.setMatrixAt(i, matrix.compose(new Vector3(...at), upright, new Vector3(...size)));
  }

  mesh.name = "solid";
  mesh.castShadow = mesh.receiveShadow = true;

  return [mesh];
}

/** The leaves of every crown as one mesh, within the budget. */
function leaves(crowns: readonly Crown[]): InstancedMesh[] {
  if (crowns.length === 0) return [];

  const total = crowns.reduce((sum, crown) => sum + wanted(crown), 0);
  const share = Math.min(1, BUDGET / Math.max(total, 1));
  const random = seeded(29);

  const mesh = clusters(
    crowns.flatMap((crown) => crownClusters(crown, share, random)),
    random,
  );

  mesh.name = "solid";
  mesh.castShadow = mesh.receiveShadow = true;

  return [mesh];
}

/** A dark body in each crown, so the gaps between the clusters read as depth, not sky. */
function bodies(crowns: readonly Crown[]): InstancedMesh[] {
  return [
    ...instanced(
      new IcosahedronGeometry(1, 1),
      finish.hedge(),
      crowns.flatMap((crown): (readonly [Triple, Triple])[] =>
        crown.kind === "sphere"
          ? [
              [
                toThree(crown.centre),
                [crown.radius * 0.72, crown.radius * 0.72, crown.radius * 0.72],
              ],
            ]
          : [],
      ),
    ),
    ...instanced(
      new ConeGeometry(1, 1, 10),
      finish.hedge(),
      crowns.flatMap((crown): (readonly [Triple, Triple])[] =>
        crown.kind === "sphere"
          ? []
          : [
              [
                toThree([crown.base[0], crown.base[1], crown.base[2] + (crown.height * 0.95) / 2]),
                [crown.radius * 0.75, crown.height * 0.95, crown.radius * 0.75],
              ],
            ],
      ),
    ),
  ];
}

/** Every imported tree in a handful of draws: the trunks, a dark body in each crown and the
 * leaves' clusters, fewer the further a tree stands from the plot. */
export function grove(solids: readonly Solid[]): InstancedMesh[] {
  const trunks = solids.filter((solid): solid is Upright => solid.kind === "cylinder");
  const crowns = solids.filter((solid) => solid.kind !== "cylinder");

  return [
    ...instanced(
      // A trunk tapers toward its crown.
      new CylinderGeometry(0.6, 1, 1, 8),
      finish.bark(),
      trunks.map(({ base, radius, height }) => [
        toThree([base[0], base[1], base[2] + height / 2]),
        [radius, height, radius],
      ]),
    ),
    ...bodies(crowns),
    ...leaves(crowns),
  ];
}
