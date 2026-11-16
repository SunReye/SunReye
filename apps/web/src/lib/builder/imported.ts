// Imported surroundings (ADR 20) as the browser holds them: the document the core fetched, the
// scene's import that names it, and what the pv crate stands around the blocks.
import type { components } from "../api/schema";
import type { Face, Point, Scene, Solid } from "./pv.ts";
import { isAround, isImport, unwrap, type Exported } from "./replies.ts";

/** A fetched document: everything in metres east and north of its centre. */
export type Imported = components["schemas"]["Imported"];

export type PatchFinish = components["schemas"]["PatchFinish"];

/** The scene's import: the document by its digest, where its centre lies in the scene's frame,
 * its turn in degrees clockwise from true north, and the ids of the buildings it hides. */
export interface Import {
  readonly document: string;
  readonly x: number;
  readonly z: number;
  readonly turn: number;
  readonly hidden?: readonly number[];
}

/** An imported building as it stands; a hidden one is told too, so it can be shown again. */
export interface Standing {
  readonly id: number;
  readonly hidden: boolean;
  readonly faces: readonly Face[];
}

/** A piece of ground on the terrain: an area inside `points`, or with a `width` a line. */
export interface Draped {
  readonly finish: PatchFinish;
  readonly width?: number | null;
  readonly points: readonly Point[];
}

/** Heights above the blocks' ground on a square grid of `side` nodes a side: row by row along
 * `along` from `origin`, each row along `across`. */
export interface Relief {
  readonly origin: Point;
  readonly across: Point;
  readonly along: Point;
  readonly side: number;
  readonly heights: readonly number[];
}

/** A scene's imported surroundings in the shading frame: east, north, up. */
export interface Around {
  readonly buildings: readonly Standing[];
  readonly hedges: readonly Face[];
  /** Each tree's trunk, then its crown. */
  readonly trees: readonly Solid[];
  /** Drawn in order, each over the last. */
  readonly grounds: readonly Draped[];
  readonly terrain: Relief;
  /** Who the data is owed to, shown wherever it is drawn. */
  readonly credits: readonly string[];
}

/** What the crate answers about imported surroundings. */
export interface Surrounding {
  /** The scene's imported surroundings from the `document` its import names, stood where the
   * scene lays it; null for a scene without an import. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the core's document, read only.
  readonly around: (scene: Scene, document: Imported) => Around | null;
  /** The import a scene starts with for the document `id`: its centre on the scene's origin and
   * the building under the blocks hidden. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the core's document, read only.
  readonly loadImport: (id: string, scene: Scene, document: Imported) => Import;
}

/** The crate's answers through `call`, the reply of one of its exports to its JSON input. */
export function surrounding(call: (name: Exported, input: string) => string): Surrounding {
  return {
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the core's document, read only.
    around: (scene, document) =>
      unwrap(call("around", JSON.stringify({ scene, document })), isAround),
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the core's document, read only.
    loadImport: (id, scene, document) =>
      unwrap(call("load_import", JSON.stringify({ id, scene, document })), isImport),
  };
}
