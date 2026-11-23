// The scene's and the layout's types, as the core's API and the `pv` crate read and write them
// (ADRs 17, 20), and the one key a roof face is selected by.

export type * from "./schema.d.ts";

import type { ModuleGrid } from "./schema.d.ts";

/** A roof face, named as a module grid, a roof chimney and a roof window name it (ADR 20). */
export type RoofFaceId = Pick<ModuleGrid, "block" | "face">;

/** The roof face's key: equal for the same face wherever it was picked, as from above or in 3D. */
export declare function roofFaceKey(face: RoofFaceId): string;

export * from "./roof.js";
