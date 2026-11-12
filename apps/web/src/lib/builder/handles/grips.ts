// The builder's 3D handles (ADR 20): where each sits on the selected object, and what a drag from
// one pointer ray to another makes of the scene, snapped. Pure and three.js-free: rays and points
// are in three.js's frame (x east, y up, z south, turned by the scene's north).
import type { Scene } from "../pv.ts";
import { bodyOf, onWorld, ridge, type Rect, type Round, type Target } from "./body.ts";
import { turn, world, type Triple } from "./frame.ts";

export type { Target } from "./body.ts";

export type { Ray, Triple } from "./frame.ts";

export { drag, type Dragged, type Grab } from "./dragging.ts";

/** What a handle drags: a wall arrow's width, depth or radius, the ridge's pitch, the ring's
 * turn, or the footprint's place. */
export type Grip = "width" | "depth" | "radius" | "pitch" | "turn" | "move";

export interface Handle {
  readonly grip: Grip;
  /** Where it is drawn, and where its live value shows. */
  readonly at: Triple;
  /** An arrow's direction, outward; the ring's radius about `at`; the footprint's outline. */
  readonly axis?: Triple;
  readonly radius?: number;
  readonly outline?: readonly Triple[];
}

/** Metres between a wall and its arrow; between the footprint's corners and the ring. */
export const ARROW = 0.4;
const RING = 1;

function rectHandles(north: number, rect: Rect, roof: ReturnType<typeof ridge>): Handle[] {
  const { width, depth, height } = rect;
  const at = (u: number, y: number, w: number): Triple => onWorld(north, rect, u, y, w);

  const outward = (u: number, w: number): Triple => {
    const [x, z] = turn(u, w, rect.rotation);

    return world(north, [x, 0, z]);
  };

  const sides: Handle[] = [
    { grip: "width", at: at(width + ARROW, height / 2, depth / 2), axis: outward(1, 0) },
    { grip: "depth", at: at(width / 2, height / 2, depth + ARROW), axis: outward(0, 1) },
  ];

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

/** The selected object's handles. */
export function handles(scene: Scene, target: Target): Handle[] {
  const body = bodyOf(scene, target);

  if (body === undefined) return [];

  if (body.kind === "round") return roundHandles(scene.north, body);

  const block = target.kind === "block" ? scene.blocks[target.index] : undefined;

  return rectHandles(scene.north, body, block === undefined ? null : ridge(block));
}
