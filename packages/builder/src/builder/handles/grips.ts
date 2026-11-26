// The builder's 3D handles (ADR 20): where each sits on the selected object, and what a drag from
// one pointer ray to another makes of the scene, snapped. Pure and three.js-free: rays and points
// are in three.js's frame (x east, y up, z south, turned by the scene's north).
import type { Footing, Modules, Point, Scene } from "../pv.ts";
import { bodyOf, onWorld, ridge, type Rect, type Round, type Target } from "./body.ts";
import { wallOf } from "../wall-openings.ts";
import { turn, world, type Triple } from "./frame.ts";
import { roofArrows } from "./sizing.ts";
import { tracedArrows } from "./traced.ts";
import { roofRing, tracedRing } from "./turning.ts";

export type { Target } from "./body.ts";

export type { Ray, Triple } from "./frame.ts";

export { drag, turned, type Dragged, type Engine, type Grab } from "./dragging.ts";

export { settled } from "./turning.ts";

/** What a handle drags: a wall arrow's width, depth or radius, an opening's height, the ridge's
 * pitch, the ring's turn, the footprint's place, a block's knob that carries it, or a fence's
 * point. */
export type Grip =
  | "width"
  | "depth"
  | "height"
  | "radius"
  | "pitch"
  | "turn"
  | "move"
  | "carry"
  | "point";

export interface Handle {
  readonly grip: Grip;
  /** Where it is drawn, and where its live value shows. */
  readonly at: Triple;
  /** An arrow's direction, outward; the ring's radius about `at`; the footprint's outline. */
  readonly axis?: Triple;
  readonly radius?: number;
  readonly outline?: readonly Triple[];
  /** Which of a fence's points it drags. */
  readonly point?: number;
  /** A ring's object's reach from its middle, in metres: the ring stands clear of it. */
  readonly inner?: number;
  /** Where an arrow's side of its object is, and how far the object reaches along the arrow:
   * the arrow stands clear of that side, and hides with an object too small to see. */
  readonly edge?: Triple;
  readonly span?: number;
}

/** Metres between a wall and its arrow; between the footprint's corners and the ring. */
const ARROW = 0.4;
const RING = 1;

/** Metres a rectangle's arrows stand off its walls, and at most above the ground: at a wall's
 * foot, so its face stays free for a tap and a drag (ADR 20, mistaken drags). */
const OFF = 0.8;
const LOW = 0.3;

/** A rectangle's width and depth arrows, off its walls by their feet. */
function rectArrows(
  at: (u: number, y: number, w: number) => Triple,
  outward: (u: number, w: number) => Triple,
  { width, depth, height }: Rect,
): Handle[] {
  const low = Math.min(height / 2, LOW);

  return [
    {
      grip: "width",
      at: at(width + OFF, low, depth / 2),
      axis: outward(1, 0),
      edge: at(width, low, depth / 2),
      span: width,
    },
    {
      grip: "depth",
      at: at(width / 2, low, depth + OFF),
      axis: outward(0, 1),
      edge: at(width / 2, low, depth),
      span: depth,
    },
  ];
}

function rectHandles(north: number, rect: Rect, roof: ReturnType<typeof ridge>): Handle[] {
  const { width, depth, height } = rect;
  const at = (u: number, y: number, w: number): Triple => onWorld(north, rect, u, y, w);

  const outward = (u: number, w: number): Triple => {
    const [x, z] = turn(u, w, rect.rotation);

    return world(north, [x, 0, z]);
  };

  const sides = rectArrows(at, outward, rect);

  const pitch: Handle[] =
    roof === null ? [] : [{ grip: "pitch", at: at(roof.u, roof.top, roof.w) }];

  const corners = [
    [0, 0],
    [width, 0],
    [width, depth],
    [0, depth],
  ] as const;

  return [
    ...sides,
    ...pitch,
    {
      grip: "turn",
      at: at(width / 2, 0, depth / 2),
      radius: Math.hypot(width, depth) / 2 + RING,
      inner: Math.hypot(width, depth) / 2,
    },
    {
      grip: "move",
      at: at(width / 2, height, depth / 2),
      outline: corners.map(([u, w]) => at(u, 0, w)),
    },
  ];
}

function roundHandles(north: number, { x, z, radius, height }: Round): Handle[] {
  const around = Array.from({ length: 32 }, (_, i): Triple => {
    const angle = (i / 32) * 2 * Math.PI;

    return world(north, [x + radius * Math.cos(angle), 0, z + radius * Math.sin(angle)]);
  });

  return [
    {
      grip: "radius",
      at: world(north, [x + radius + ARROW, height / 2, z]),
      axis: world(north, [1, 0, 0]),
    },
    { grip: "move", at: world(north, [x, height, z]), outline: around },
  ];
}

/** A knob on each of a fence's points, at its top. */
function fenceHandles({ north, fences = [] }: Scene, index: number): Handle[] {
  const fence = fences[index];

  return (fence?.points ?? []).map(({ x, z }, point) => ({
    grip: "point",
    at: world(north, [x, fence?.height ?? 0, z]),
    point,
  }));
}

/** What a chimney's, a roof window's and an opening's handles stand on, as the crate laid the scene
 * out. */
export type Laid = Pick<Modules, "walls" | "footings" | "panes" | "roofs">;

/** A chimney's foot outlined on its roof face; its top, where the live value shows. The chimney
 * itself is dragged. */
function chimneyHandles(footing: Footing | null | undefined): Handle[] {
  if (footing === undefined || footing === null) return [];

  const { foot, top } = footing;
  // The crate's east, north, up in three.js's frame.
  const outline = foot.map(([east, north, up]): Triple => [east, up, 0 - north]);
  const [east, north] = [0, 1].map((i) => foot.reduce((sum, p) => sum + (p[i] ?? 0), 0) / 4);
  const handle: Handle = { grip: "move", at: [east ?? 0, top, 0 - (north ?? 0)], outline };

  return [handle, ...roofArrows(foot), ...roofRing(foot)];
}

/** A roof window's pane outlined in its roof face; its upper edge's middle, where the live value
 * shows. The window itself is dragged. */
function windowHandles(pane: readonly Point[] | null | undefined): Handle[] {
  const [, , right, left] = pane ?? [];

  if (pane === undefined || pane === null || right === undefined || left === undefined) return [];

  // The crate's east, north, up in three.js's frame.
  const outline = pane.map(([east, north, up]): Triple => [east, up, 0 - north]);
  const mid = (i: 0 | 1 | 2): number => (right[i] + left[i]) / 2;

  return [
    { grip: "move", at: [mid(0), mid(2), 0 - mid(1)], outline },
    ...roofArrows(pane),
    ...roofRing(pane),
  ];
}

/** Metres an opening's outline stands off its wall, clear of its frame. */
const OFF_WALL = 0.08;

/** An opening outlined on its wall, which a drag slides it along; an arrow at its right edge for
 * its width and one over it for its height. */
function openingHandles(scene: Scene, index: number, laid: Laid): Handle[] {
  const opening = scene.openings?.[index];
  const wall = wallOf(scene, laid, index);

  if (opening === undefined || wall === undefined) return [];

  const { along, width, height, sill = 0 } = opening;
  const at = (across: number, up: number): Triple => wall.at(across, up, OFF_WALL);

  return [
    {
      grip: "width",
      at: at(along + width + ARROW, sill + height / 2),
      axis: wall.right,
    },
    { grip: "height", at: at(along + width / 2, sill + height + ARROW), axis: [0, 1, 0] },
    {
      grip: "move",
      at: at(along + width / 2, sill + height),
      outline: [
        at(along, sill),
        at(along + width, sill),
        at(along + width, sill + height),
        at(along, sill + height),
      ],
    },
  ];
}

const NONE: Laid = { walls: [], footings: [], panes: [], roofs: [] };

/** The selected object's handles; a chimney's, a roof window's and an opening's stand on what the
 * crate `laid` out for this `scene`, and without it they have none. */
export function handles(scene: Scene, target: Target, laid: Laid = NONE): Handle[] {
  if (target.kind === "fence") return fenceHandles(scene, target.index);

  if (target.kind === "chimney") return chimneyHandles(laid.footings[target.index]);

  if (target.kind === "roofWindow") return windowHandles(laid.panes[target.index]);

  if (target.kind === "opening") return openingHandles(scene, target.index, laid);

  const body = bodyOf(scene, target);

  if (body === undefined) return [...tracedRing(scene, target), ...tracedArrows(scene, target)];

  if (body.kind === "round") return roundHandles(scene.north, body);

  const block = target.kind === "block" ? scene.blocks[target.index] : undefined;
  const found = rectHandles(scene.north, body, block === undefined ? null : ridge(block));

  // A car place keeps its size: it only moves and turns.
  return target.kind === "place"
    ? found.filter(({ grip }) => grip === "turn" || grip === "move")
    : found;
}
