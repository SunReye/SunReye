// The scene's module grids as the `pv` crate lays them out on the roof faces (ADR 20 Modules), and
// what the builder's handles stand on.

import type { Scene, Wall } from "@sunreye/scene";
import type { Point, WallFrame } from "./geometry.d.ts";

/** Where a module lies on its face, and which way. */
export interface Spot {
  /** Its lower left corner: metres across the slope and up it from the face's lowest corner on
   * the left, seen from the front. */
  readonly across: number;
  readonly up: number;
  /** Long side across the slope. */
  readonly landscape: boolean;
}

/** A module's outline in metres; `height` is its long side. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Each module type's size, by its id. */
export type Sizes = Readonly<Record<number, Size>>;

/** A grid of a scene, by its position, with the sizes of the scene's module types. */
export interface OnGrid {
  readonly scene: Scene;
  readonly sizes: Sizes;
  readonly grid: number;
}

/** How "Fill face" lays the free roof (ADR 20 Modules); each left out is the builder's own. */
export interface FillRules {
  /** Metres between two modules: 0.02 without; under 0.02 it is 0.02. */
  readonly gap?: number;
  /** Rows and columns from the setback's lower left, as without, or the spare roof shared out on
   * both sides. */
  readonly alignment?: "lowerLeft" | "centred";
  /** Metres kept free round each roof chimney, roof window, existing PV and dormer: 0 without. */
  readonly keepOut?: number;
}

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
      readonly kind: "setback" | "overlap" | "chimney" | "window" | "existing";
      readonly grid: number;
      /** The module's position in its grid. */
      readonly module: number;
      /** Its footprint on its face; null without a module size. */
      readonly area: Area | null;
    };

/** A chimney's foot on its roof face as the crate lays it out: its corners from the lower left,
 * east, north, up, and the height of its level top. */
export interface Footing {
  readonly foot: readonly Point[];
  readonly top: number;
}

/** The roofs, each grid on its face (null for a missing face or module type) and the first misfit;
 * and what the builder's handles stand on. */
export interface Modules {
  readonly roofs: readonly RoofFace[];
  readonly grids: readonly (LaidGrid | null)[];
  readonly misplaced: Misplaced | null;
  /** By block, each of its walls. */
  readonly walls: readonly Readonly<Record<Wall, WallFrame>>[];
  /** By block, each side of a free-form block's footprint in its order, null for one without length; none for a block of four walls. */
  readonly sides: readonly (readonly (WallFrame | null)[])[];
  /** By chimney; null for one that names no roof face. */
  readonly footings: readonly (Footing | null)[];
  /** By roof window, its pane's corners from the lower left; null for one on no roof face. */
  readonly panes: readonly (readonly Point[] | null)[];
}
