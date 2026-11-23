// Tracing a roof (ADR 20): a scene in, the next scene out. No browser, no 3D library, so a
// consumer may run an edit wherever it keeps the scene.

import type { Scene } from "./schema.d.ts";

/** A place in the scene's metres, x, y and z, y up: the frame before the compass turns it. */
export type Spot = readonly [x: number, y: number, z: number];

/** A click seen from above, in the scene's metres. A click on a surface that carries heights
 * brings its height, which sets the point's; one on plain ground lands at 0 and leaves it unset. */
export interface Click {
  readonly x: number;
  readonly z: number;
  readonly height?: number;
}

/** A point of a traced block, by its place in the block's points. */
export interface PointRef {
  readonly block: number;
  readonly point: number;
}

/** Where a line starts or ends: a click, which snaps, or a point already traced. */
export type End = Click | PointRef;

/** What a click snaps to, named: a traced point, a place on a traced line, or nothing. */
export type Snap =
  | { readonly kind: "point"; readonly block: number; readonly point: number; readonly at: Spot }
  | { readonly kind: "line"; readonly block: number; readonly line: number; readonly at: Spot }
  | { readonly kind: "free"; readonly at: Spot };

/** Why an edit was not made: a line of no length, one joining two traced blocks, a move that
 * makes lines cross, or a block, line or point that is not there. */
export type Refusal = "short" | "joins" | "crosses" | "missing";

/** An edit's next scene and the traced block it changed, or why it was not made. */
export type Edited =
  | {
      readonly scene: Scene;
      /** The block the line is in now; -1 when its block went. */
      readonly block: number;
      /** The line's two points in the next scene's block; -1 when the line went. */
      readonly from: number;
      readonly to: number;
    }
  | { readonly refused: Refusal };

/** What `click` snaps to within `reach` metres seen from above: a traced point before a line. */
export declare function snap(scene: Scene, click: Click, reach: number): Snap;

/** The scene with a line from `from` to `to`, each click snapped within `reach` metres. The line
 * splits every line it crosses, and the one a click snaps onto; a line touching no traced block
 * starts a new one. The block's faces follow its loops. */
export declare function addLine(scene: Scene, from: End, to: End, reach: number): Edited;

/** The scene with line `line` of block `block` moved level by `by` metres, its points with it;
 * refused when it would cross a line. The block's faces follow. */
export declare function moveLine(
  scene: Scene,
  block: number,
  line: number,
  by: { readonly x: number; readonly z: number },
): Edited;

/** The scene without line `line` of block `block`, and without the points no line uses then. A
 * block left with no line goes, and everything named by a later block moves up. */
export declare function removeLine(scene: Scene, block: number, line: number): Edited;

/** The closed loops of `lines` between `points` seen from above, each as its points in order,
 * counter-clockwise seen from above: the faces they make. A line no loop closes makes none. */
export declare function loops(
  points: readonly (readonly number[])[],
  lines: readonly (readonly number[])[],
): number[][];
