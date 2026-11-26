// The scene's and the layout's types, as the core's API and the `pv` crate read and write them
// (ADRs 17, 20), and the one key a roof face is selected by.

export type * from "./schema.d.ts";

import type { Block, ModuleGrid, Scene } from "./schema.d.ts";

/** A roof face, named as a module grid, a roof chimney and a roof window name it (ADR 20). */
export type RoofFaceId = Pick<ModuleGrid, "block" | "face">;

/** The roof face's key: equal for the same face wherever it was picked, as from above or in 3D. */
export declare function roofFaceKey(face: RoofFaceId): string;

export * from "./roof.js";

/** How many roof faces block `block` has, as the `pv` crate lists them: a traced or free-form
 * block its faces, a dormer's too; flat and mono-pitch one, gable two, hip four. 0 for no block.
 * A face index below it names a face of the block. */
export declare function faceCount(scene: Scene, block: number): number;

/** The scene with block `index` moved `by` metres east (x) and south (z), what stands on it
 * carried; the same scene for no such block. */
export declare function moveBlock(scene: Scene, index: number, by: readonly number[]): Scene;

/** A footprint's centroid, x and z, as a block turns about it; its corners' mean where it
 * encloses nothing. */
export declare function centroidOf(footprint: readonly (readonly number[])[]): [number, number];

/** The scene with block `index` turned `by` degrees clockwise seen from above about the middle of
 * its footprint, what stands on its roof turning with it; a traced block keeps its turn so far as
 * its rotation. The same scene for no such block. */
export declare function turnBlock(scene: Scene, index: number, by: number): Scene;
/** Traced block `block`'s footprint as a rectangle: its first corner, the way its first and second
 * sides run and their lengths; null unless it has four square corners. */
export declare function rectangleOf(block: Block | undefined): {
  corner: [number, number];
  axes: [[number, number], [number, number]];
  lengths: [number, number];
} | null;
/** The scene with traced block `index`'s side `side` set to `length` metres, the side across from
 * it staying, every point moved in step along it, heights kept. */
export declare function stretchBlock(
  scene: Scene,
  index: number,
  side: 0 | 1,
  length: number,
): Scene;

/** The scene without block `index` and what stands on it; later blocks' follow them down. The last
 * block may go. The same scene for no such block. */
export declare function removeBlock(scene: Scene, index: number): Scene;

/** The scene's JSON Schema (2020-12), as the core reads a stored scene: every field it knows and
 * no other. Generated from the crates. */
export declare const SCENE_SCHEMA: Json;

/** A JSON value, as a JSON Schema is one. */
export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json };

/** The version of @sunreye/scene the schema was generated at; the scene carries none (ADR 25). */
export declare const SCENE_SCHEMA_VERSION: string;
