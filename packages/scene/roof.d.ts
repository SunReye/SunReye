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
      /** For each face the block had before, its place now, or -1 where it went with what stood
       * on it. An unchanged face keeps its place unless more faces went than came. */
      readonly faces: readonly number[];
      /** The block the line is in now; -1 when its block went, and the blocks after it moved up. */
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

/** What a traced point or line is, for pulling up: a pull of the eaves raises the eaves, a pull of
 * the ridges the ridges. A point neither eave, ridge nor set follows, keeping faces flat. */
export type Kind = "eave" | "ridge";

/** The scene with block `block`'s eave points raised to `height` metres, but those whose height
 * was set; the points that follow keep the faces flat. `from` and `to` are -1. */
export declare function pullEaves(scene: Scene, block: number, height: number): Edited;

/** The scene with block `block`'s ridge points raised to `height` metres, as `pullEaves`. */
export declare function pullRidges(scene: Scene, block: number, height: number): Edited;

/** The scene with line `line` of block `block` made an eave or a ridge, both its points with it,
 * by the person's word: the outline's corners are eaves and inner lines' ends ridges without it. */
export declare function markLine(scene: Scene, block: number, line: number, kind: Kind): Edited;

/** The scene with point `point` of block `block` at `height` metres, set: no pull changes it.
 * `from` and `to` are the point. */
export declare function setHeight(
  scene: Scene,
  block: number,
  point: number,
  height: number,
): Edited;

/** What line `line` of block `block` is: an eave or a ridge when both its points are; undefined
 * for any other line, as a hip, a valley or a verge. */
export declare function lineKind(scene: Scene, block: number, line: number): Kind | undefined;

/** Block `block`'s faces bent off their plane by more than 2 cm: drawn in the warning colour,
 * they carry no modules. */
export declare function bent(scene: Scene, block: number): number[];

/** A dormer (ADR 20): a closed loop traced inside a face, by the face it stands on and its own
 * faces, by their places in the block. */
export interface Dormer {
  readonly face: number;
  readonly faces: readonly number[];
}

/** Block `block`'s dormers, in the order of their first faces. */
export declare function dormers(scene: Scene, block: number): Dormer[];

/** The scene with the eaves, or ridges, of the dormer that face `face` of block `block` belongs to
 * at `height` metres, but where its face stands higher: there they stay on it and follow it. A
 * point pulled above its face is set. Refused (`"missing"`) for a face of no dormer. */
export declare function pullDormer(
  scene: Scene,
  block: number,
  face: number,
  kind: Kind,
  height: number,
): Edited;

/** A ready shape for a consumer's menu: its id and its name in German and English. Ready roofs
 * and ready dormers share it. */
export interface ReadyEntry {
  readonly id: string;
  readonly de: string;
  readonly en: string;
}

/** The ready roofs, in the order a menu lists them. */
export declare const readyRoofs: readonly ReadyEntry[];

/** A ready roof's size: `width` metres along x and `depth` along z from its corner, its eaves at
 * `eave` metres and its top, a ridge, a mono-pitch roof's high side or a parapet, at `ridge`. A
 * flat roof without a parapet has no top. */
export interface RoofSize {
  readonly width: number;
  readonly depth: number;
  readonly eave: number;
  readonly ridge: number;
}

/** The scene with ready roof `id` placed with its corner at `at`, as a new traced block: the
 * lines a person could have traced, pulled up to `size`'s heights, then edited as any traced roof.
 * Refused (`"joins"`) where it would touch a traced block, `"short"` without a positive size,
 * `"missing"` for an id that is no ready roof. `faces` is empty, `from` and `to` -1. */
export declare function placeRoof(
  scene: Scene,
  id: string,
  at: { readonly x: number; readonly z: number },
  size: RoofSize,
): Edited;

/** The ready dormers, in the order a menu lists them. */
export declare const readyDormers: readonly ReadyEntry[];

/** A ready dormer's size: `width` metres across its face's slope and `depth` up it, seen from
 * above, where its top meets the face; its front eave at `eave` metres, between the face and that
 * top, halfway without one. A Flachdachgaube is level at its top and a Zwerchhaus's eaves are the
 * house's: neither reads `eave`. A Zwerchhaus's `depth` runs from the face's eave. */
export interface DormerSize {
  readonly width: number;
  readonly depth: number;
  readonly eave?: number;
}

/** The scene with ready dormer `id` on face `face` of traced block `block`, its middle at `at`
 * seen from above and its front toward the face's low side: the lines a person could have traced,
 * pulled up by its own eaves and ridges. A Zwerchhaus stands on the face's eave under `at`, its
 * ridge's ends set; it touches the outline, so it is the house's, not a dormer. Refused
 * (`"missing"`) for an unknown id, block or face, `"short"` without a positive size, on a face
 * without slope or with its eave not between the face and its top, `"crosses"` where it is not
 * wholly on its face. `faces` says where the block's faces went; `from` and `to` are -1. */
export declare function placeDormer(
  scene: Scene,
  block: number,
  face: number,
  id: string,
  at: { readonly x: number; readonly z: number },
  size: DormerSize,
): Edited;
