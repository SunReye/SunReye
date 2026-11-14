// What hangs on a block's wall or sits in it (ADR 20): equipment markers, and windows and doors
// as the scene stores them and as the pv crate fits them.
import type { Point } from "./pv.ts";

/** A side of a block's footprint: the front along +z, the right along +x. */
export type Wall = "front" | "right" | "back" | "left";

/** A marker for an inverter or a battery, on a block's wall. */
export interface Equipment {
  readonly device: number;
  readonly kind: "inverter" | "battery";
  readonly block: number;
  readonly wall: Wall;
  /** Metres from the wall's left end, seen from outside. */
  readonly along: number;
  /** Behind the wall, in the building. */
  readonly inside: boolean;
}

export type OpeningKind = "window" | "frenchWindow" | "frontDoor" | "garageDoor";

/** A window or a door in a block's wall; drawn only, it never shades. */
export interface Opening {
  readonly kind: OpeningKind;
  readonly block: number;
  readonly wall: Wall;
  /** Metres from the wall's left end to the opening's left edge, seen from outside. */
  readonly along: number;
  readonly width: number;
  readonly height: number;
  /** Metres from the ground to its lower edge; a door's is 0. */
  readonly sill?: number;
}

/** An opening on its wall. */
export interface Fitted {
  readonly kind: OpeningKind;
  /** Seen from outside: low left, low right, high right, high left. */
  readonly corners: readonly [Point, Point, Point, Point];
  /** The wall's outward normal, level. */
  readonly out: Point;
}
