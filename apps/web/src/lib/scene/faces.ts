// The crate's faces as meshes (ADR 20 Look): one mesh of many faces in a finish, and hedges
// under their leaves. Pure: no DOM.
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  type MeshStandardMaterial,
} from "three";
import type { Face, Point } from "../builder/pv.ts";
import * as finish from "./materials.ts";
import { fan, foliage, uvs } from "./surfaces.ts";

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

  const body = surface("hedge", faces, finish.hedge(), finish.REPEAT.render);

  body.add(foliage(faces, 13));

  return [body];
}
