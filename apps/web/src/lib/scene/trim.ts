// A pitched roof's trim (ADR 20 Look): caps along its ridges and hips, gutters along its eaves.
// Found on the faces the pv crate laid out; drawn only, never shading.
import {
  Color,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import type { Face, Point } from "../builder/pv.ts";
import { level } from "./surfaces.ts";

/** An edge of a roof face, in the crate's frame, with its face's colour. */
export interface Edge {
  readonly from: Point;
  readonly to: Point;
  readonly colour?: string;
}

export interface Trim {
  /** Where two pitched faces meet: a ridge or a hip. */
  readonly ridges: readonly Edge[];
  /** A pitched face's level, lowest edge. */
  readonly eaves: readonly Edge[];
  /** A pitched face's sloping outer edge. */
  readonly verges: readonly Edge[];
}

/** A point to the millimetre: the crate gives a shared corner twice, a rounding apart. */
const key = (point: Point): string => point.map((v) => Math.round(v * 1000)).join(",");

/** An edge's key, whichever way it runs. */
const span = (from: Point, to: Point): string => [key(from), key(to)].toSorted().join("|");

/** An edge with its face's lowest height. */
type Side = Edge & { readonly low: number };

/** Each pitched roof face's edges. */
function sides(faces: readonly Face[]): Side[] {
  return faces
    .filter((face) => face.surface === "roof" && !level(face))
    .flatMap(({ corners, colour }) => {
      const low = Math.min(...corners.map((corner) => corner[2]));

      return corners.flatMap((from, i) => {
        const to = corners[(i + 1) % corners.length];

        if (to === undefined) return [];

        return [colour === undefined ? { from, to, low } : { from, to, low, colour }];
      });
    });
}

/** Metres an eave may lie over its face's lowest corner. */
const LEVEL = 0.001;

const bare = ({ from, to, colour }: Side): Edge =>
  colour === undefined ? { from, to } : { from, to, colour };

/** The ridges, hips and eaves of the pitched roofs among `faces`. */
export function edges(faces: readonly Face[]): Trim {
  const all = sides(faces);
  const met = new Map<string, number>();

  for (const { from, to } of all) met.set(span(from, to), (met.get(span(from, to)) ?? 0) + 1);

  const shared = new Set<string>();

  return {
    ridges: all
      .filter(({ from, to }) => {
        const at = span(from, to);
        const first = met.get(at) === 2 && !shared.has(at);

        shared.add(at);

        return first;
      })
      .map((side) => bare(side)),
    eaves: all
      .filter(
        ({ from, to, low }) =>
          met.get(span(from, to)) === 1 &&
          Math.abs(from[2] - to[2]) < LEVEL &&
          from[2] - low < LEVEL,
      )
      .map((side) => bare(side)),
    verges: all
      .filter(({ from, to }) => met.get(span(from, to)) === 1 && Math.abs(from[2] - to[2]) >= LEVEL)
      .map((side) => bare(side)),
  };
}

/** A roof tile's own colour, for a roof without one: the tile map's mean. */
const TILE = "#2c2c2e";

/** Metres: a ridge cap's radius, a verge tile's, a gutter's, and how far a gutter hangs under
 * its eave. */
const CAP = 0.09;
const VERGE = 0.05;
const GUTTER = 0.06;
const HUNG = 0.05;

/** East, north, up to three.js: x east, y up, z south. */
const toThree = ([east, north, up]: Point): Vector3 => new Vector3(east, up, 0 - north);

/** An edge with its round's radius and how far the round hangs under it. */
type Round = Edge & { readonly radius: number; readonly drop: number };

/** Rounds laid along `run` in one instanced mesh. */
function rounds(
  run: readonly Round[],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
  material: MeshStandardMaterial,
): InstancedMesh {
  const mesh = new InstancedMesh(new CylinderGeometry(1, 1, 1, 8, 1, true), material, run.length);
  const [matrix, turn, up] = [new Matrix4(), new Quaternion(), new Vector3(0, 1, 0)];

  for (const [i, { from, to, colour, radius, drop }] of run.entries()) {
    const [a, b] = [toThree(from), toThree(to)];
    const along = new Vector3().subVectors(b, a);
    const length = along.length();

    turn.setFromUnitVectors(up, along.normalize());
    a.add(b).multiplyScalar(0.5).y -= drop;
    mesh.setMatrixAt(i, matrix.compose(a, turn, new Vector3(radius, length, radius)));
    mesh.setColorAt(i, new Color(colour ?? TILE));
  }

  mesh.name = "trim";

  return mesh;
}

const round = (edge: Edge, radius: number): Round => Object.assign({ radius, drop: 0 }, edge);

/** The trim of the pitched roofs among `faces`: tile caps and verges in the roof's colour, and
 * zinc gutters; nothing without any. */
export function trim(faces: readonly Face[]): InstancedMesh[] {
  const { ridges, eaves, verges } = edges(faces);

  const tiles: Round[] = [
    ...ridges.map((edge) => round(edge, CAP)),
    ...verges.map((edge) => round(edge, VERGE)),
  ];

  const gutters = eaves.map(({ from, to }) => ({
    from,
    to,
    colour: "#8d9499",
    radius: GUTTER,
    drop: HUNG,
  }));

  return [
    ...(tiles.length === 0 ? [] : [rounds(tiles, new MeshStandardMaterial({ roughness: 0.85 }))]),
    ...(gutters.length === 0
      ? []
      : [rounds(gutters, new MeshStandardMaterial({ roughness: 0.4, metalness: 0.7 }))]),
  ];
}
