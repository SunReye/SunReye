// The modules on the roof faces in the scene's schema (ADR 20 Modules).
import type { Scene } from "./pv.ts";

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
