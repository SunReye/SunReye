// The scene as three.js objects, built from the pv crate's geometry (ADR 20). Pure: the drawing
// component only adds the group to its renderer.
import {
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";
import type { Face, Geometry, Point, Solid } from "./pv.ts";

const colours: Readonly<Record<Face["surface"], number>> = {
  wall: 0xe7e2d8,
  roof: 0x9a4b3c,
  obstacle: 0x8a8f98,
};

const SOLID = 0x5d7a4a;

/** Strings by position, then again; distinct from roofs and the sky. */
const STRINGS = [0x1f5fbf, 0xe08a00, 0x2a9d5c, 0xb8336a, 0x6a4fb5, 0x0f8b8d] as const;
const UNASSIGNED = 0x6b6f76;

/** A placed module: its corners on the roof, and its string by position in the layout. */
export interface Panel {
  readonly corners: readonly Point[];
  readonly string?: number | null;
}

/** `stringColour` as CSS. */
export function stringCss(string: number | null | undefined): string {
  return `#${stringColour(string).toString(16).padStart(6, "0")}`;
}

/** The colour a string is drawn in, in the scene and in the builder's grid. */
export function stringColour(string: number | null | undefined): number {
  return string === null || string === undefined
    ? UNASSIGNED
    : (STRINGS[string % STRINGS.length] ?? UNASSIGNED);
}

/** A point in three.js's frame. */
export type Triple = readonly [number, number, number];

/** East, north, up to three.js: x east, y up, z south. */
export function toThree([east, north, up]: Point): [number, number, number] {
  // Never −0.
  return [east, up, 0 - north];
}

/** Each convex face as a fan of triangles. */
function triangles(faces: readonly Face[]): number[] {
  return faces.flatMap(({ corners: [first, ...rest] }) =>
    first === undefined
      ? []
      : rest
          .slice(1)
          .flatMap((corner, i) =>
            [first, rest[i] ?? first, corner].flatMap((point) => toThree(point)),
          ),
  );
}

function surface(name: Face["surface"], faces: readonly Face[]): Mesh {
  const geometry = new BufferGeometry();

  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(triangles(faces.filter((face) => face.surface === name)), 3),
  );
  geometry.computeVertexNormals();

  const mesh = new Mesh(
    geometry,
    // Double-sided: the crate does not promise a winding.
    new MeshStandardMaterial({ color: colours[name], side: DoubleSide, flatShading: true }),
  );

  mesh.name = name;

  return mesh;
}

/** A crown or a trunk, a chimney or a pole. */
function solid(obstacle: Solid): Mesh {
  const material = new MeshStandardMaterial({ color: SOLID, flatShading: true });

  if (obstacle.kind === "sphere") {
    const crown = new Mesh(new SphereGeometry(obstacle.radius, 16, 12), material);

    crown.position.set(...toThree(obstacle.centre));
    crown.name = "solid";

    return crown;
  }

  const { base, radius, height } = obstacle;
  const upright = new Mesh(new CylinderGeometry(radius, radius, height, 16), material);

  // three.js centres a cylinder on its position.
  upright.position.set(...toThree([base[0], base[1], base[2] + height / 2]));
  upright.name = "solid";

  return upright;
}

function panel({ corners, string }: Panel): Mesh {
  const geometry = new BufferGeometry();

  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(triangles([{ surface: "roof", corners }]), 3),
  );
  geometry.computeVertexNormals();

  const mesh = new Mesh(
    geometry,
    // Pulled toward the camera, so a module on its roof never flickers through it.
    new MeshStandardMaterial({
      color: stringColour(string),
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );

  mesh.name = "module";

  return mesh;
}

/** The scene's meshes: one per surface kind, one per solid, one per placed module. */
export function buildScene(geometry: Geometry, panels: readonly Panel[] = []): Group {
  const group = new Group();

  group.add(
    surface("wall", geometry.faces),
    surface("roof", geometry.faces),
    surface("obstacle", geometry.faces),
    ...geometry.solids.map((obstacle) => solid(obstacle)),
    ...panels.map((item) => panel(item)),
  );

  return group;
}
