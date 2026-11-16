// The scene as the pv crate lays it out (ADR 20): the roof faces and the module grids on them, and
// what the builder's handles stand on.
import type { Point, Spot, Wall } from "./pv.ts";
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

/** A lower left and an upper right corner in a face's outline. */
export type Area = readonly [readonly [number, number], readonly [number, number]];

/** A module on its face: its footprint in the outline and its corners in the scene. */
export interface Footprint {
  readonly area: Area;
  readonly corners: readonly Point[];
}

/** A grid on its face: each module's footprint, by its position in the grid, and the roof modules
 * may not lie on. */
export interface LaidGrid {
  readonly modules: readonly Footprint[];
  /** The face's outline in the scene, and that outline inside the setback, corner for corner; null
   * where the setback leaves no roof. */
  readonly outline: readonly Point[];
  readonly inset: readonly Point[] | null;
  /** The footprints of the face's chimneys and roof windows. */
  readonly blocked: readonly (readonly Point[])[];
}

/** A module that is not laid yet: where it would lie, whether it fits there, and its corners in
 * the scene. */
export interface Ghost extends Spot {
  readonly fits: boolean;
  readonly corners: readonly Point[];
}

/** Why the core would refuse to save the grids. */
export type Misplaced =
  | { readonly kind: "face" | "moduleType"; readonly grid: number }
  | {
      readonly kind: "setback" | "overlap" | "chimney" | "window";
      readonly grid: number;
      /** The module's position in its grid. */
      readonly module: number;
      /** Its footprint on its face; null without a module size. */
      readonly area: Area | null;
    };

/** The roofs, each grid on its face (null for a missing face or module type) and the first misfit;
 * and what the builder's handles stand on. */
export interface Modules {
  readonly roofs: readonly RoofFace[];
  readonly grids: readonly (LaidGrid | null)[];
  readonly misplaced: Misplaced | null;
  /** By block, each of its walls. */
  readonly walls: readonly Readonly<Record<Wall, WallFrame>>[];
  /** By chimney; null for one that names no roof face. */
  readonly footings: readonly (Footing | null)[];
  /** By roof window, its pane's corners from the lower left; null for one on no roof face. */
  readonly panes: readonly (readonly Point[] | null)[];
}
