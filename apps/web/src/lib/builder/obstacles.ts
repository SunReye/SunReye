// What stands around the blocks in the scene's schema (ADR 20): obstacles, which shade, and
// ground surfaces and fences, which are only drawn.
import type { Point } from "./pv.ts";

export type Obstacle =
  | {
      readonly kind: "box";
      readonly x: number;
      readonly z: number;
      readonly width: number;
      readonly depth: number;
      readonly height: number;
      readonly rotation: number;
    }
  | {
      readonly kind: "cylinder";
      readonly x: number;
      readonly z: number;
      readonly radius: number;
      readonly height: number;
    }
  | {
      readonly kind: "tree";
      readonly x: number;
      readonly z: number;
      readonly radius: number;
      readonly height: number;
      /** Broadleaf without one. */
      readonly crown?: Crown;
    }
  | {
      /** A straight row; its length runs along x, its depth along z. */
      readonly kind: "hedge";
      readonly x: number;
      readonly z: number;
      readonly length: number;
      readonly depth: number;
      readonly height: number;
      readonly rotation: number;
    };

/** A broadleaf's crown is a sphere, a conifer's a cone. */
export type Crown = "broadleaf" | "conifer";

export type GroundFinish = "lawn" | "paving" | "driveway" | "gravel" | "path";

/** A rectangle on the plot with a block's footprint; drawn only, it never shades. */
export interface GroundSurface {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly rotation: number;
  readonly finish: GroundFinish;
}

export type FenceFinish = "wood" | "metal" | "wall";

/** A point on the ground in the scene's frame. */
export interface FencePoint {
  readonly x: number;
  readonly z: number;
}

/** A polyline on the ground through its points; drawn only, it never shades. */
export interface Fence {
  readonly points: readonly FencePoint[];
  readonly height: number;
  readonly finish: FenceFinish;
}

/** A ground surface as the crate places it: its corners on the ground. */
export interface Ground {
  readonly finish: GroundFinish;
  readonly corners: readonly Point[];
}

/** A fence as the crate places it: its points on the ground. */
export interface Fencing {
  readonly finish: FenceFinish;
  readonly height: number;
  readonly points: readonly Point[];
}
