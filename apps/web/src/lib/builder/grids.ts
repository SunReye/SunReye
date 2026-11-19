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

/** A module on a roof face. */
export interface GridModule extends Spot {
  /** The string it is wired into; in none, it produces nothing. */
  readonly string?: number | null;
  readonly optimized?: boolean;
  /** Its place along its string's wiring, from the lowest; one without follows them. */
  readonly order?: number | null;
}

/** The modules on one roof face, all of one module type. */
export interface ModuleGrid {
  readonly block: number;
  /** The roof face's index in its block, as `roofs` lists them. */
  readonly face: number;
  readonly moduleType: number;
  /** The orientation a new module takes: its long side across the slope. */
  readonly landscape: boolean;
  /** Metres kept free along every edge. */
  readonly setback: number;
  readonly modules: readonly GridModule[];
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
