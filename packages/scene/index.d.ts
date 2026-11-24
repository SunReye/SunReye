// The scene's and the layout's types, as the core's API and the `pv` crate read and write them
// (ADRs 17, 20), and the one key a roof face is selected by.

export type * from "./schema.d.ts";

import type { ModuleGrid, Scene } from "./schema.d.ts";

/** A roof face, named as a module grid, a roof chimney and a roof window name it (ADR 20). */
export type RoofFaceId = Pick<ModuleGrid, "block" | "face">;

/** The roof face's key: equal for the same face wherever it was picked, as from above or in 3D. */
export declare function roofFaceKey(face: RoofFaceId): string;

export * from "./roof.js";

/** How many roof faces block `block` has, as the `pv` crate lists them: a traced or free-form
 * block its faces, a dormer's too; flat and mono-pitch one, gable two, hip four. 0 for no block.
 * A face index below it names a face of the block. */
export declare function faceCount(scene: Scene, block: number): number;

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
