// The scene as the pv crate lays it out (ADR 20): the roof faces and the module grids' cells on
// them, and what the builder's handles stand on.
import type { Point, Wall } from "./pv.ts";
import type { Footing } from "./roofing.ts";
import type { WallFrame } from "./walls.ts";

/** A roof face as a module grid sees it. */
export interface RoofFace {
  readonly block: number;
  readonly face: number;
  readonly tilt: number;
  readonly azimuth: number;
  /** Metres across and up the slope from the lowest corner on the left, seen from the front. */
  readonly outline: readonly (readonly [number, number])[];
  /** The outline's frame: where it starts, and the unit directions across the slope and up it. */
  readonly origin: Point;
  readonly across: Point;
  readonly up: Point;
}

/** A cell whose module fits inside the setback. */
export interface CellPlace {
  readonly row: number;
  readonly column: number;
  /** Lower left and upper right corner in the face's outline. */
  readonly area: readonly [readonly [number, number], readonly [number, number]];
  readonly corners: readonly Point[];
}

/** Why the core would refuse to save the grids. */
export type Misplaced =
  | { readonly kind: "face" | "moduleType"; readonly grid: number }
  | {
      readonly kind: "setback" | "overlap";
      readonly grid: number;
      readonly row: number;
      readonly column: number;
      /** The module's cell on its face, as `CellPlace.area`; null without a module size. */
      readonly area: CellPlace["area"] | null;
    };

/** The roofs, each grid's cells (null for a missing face or module type) and the first misfit;
 * and what the builder's handles stand on. */
export interface Modules {
  readonly roofs: readonly RoofFace[];
  readonly grids: readonly (readonly CellPlace[] | null)[];
  readonly misplaced: Misplaced | null;
  /** By block, each of its walls. */
  readonly walls: readonly Readonly<Record<Wall, WallFrame>>[];
  /** By chimney; null for one that names no roof face. */
  readonly footings: readonly (Footing | null)[];
}
