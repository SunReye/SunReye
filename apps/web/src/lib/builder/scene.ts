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

/** The scene's meshes: one per surface kind, one per solid. */
export function buildScene(geometry: Geometry): Group {
  const group = new Group();

  group.add(
    surface("wall", geometry.faces),
    surface("roof", geometry.faces),
    surface("obstacle", geometry.faces),
    ...geometry.solids.map((obstacle) => solid(obstacle)),
  );

  return group;
}
