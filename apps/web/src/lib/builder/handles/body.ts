// The object the handles sit on (ADR 20): a block, a box, a hedge, a ground surface or a car place
// as a turned rectangle, a cylinder or a tree as a circle, each able to write a change back into the scene; a
// fence's handles sit on its points instead. Pure.
import type { Block, Obstacle, Scene } from "../pv.ts";
import { turn, world, type Triple } from "./frame.ts";

/** The object the handles sit on. */
export interface Target {
  readonly kind: "block" | "obstacle" | "surface" | "fence" | "place";
  readonly index: number;
}

export type RectChange = Partial<Pick<Block, "x" | "z" | "width" | "depth" | "rotation">>;

/** A block or a box: a rectangle turned about its corner. */
export interface Rect {
  readonly kind: "rect";
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly rotation: number;
  /** Its walls' height: where the arrows sit. */
  readonly height: number;
  /** Narrower than this, in metres, the inspector refuses it. */
  readonly shortest: number;
  readonly apply: (change: RectChange) => Scene;
}

/** A cylinder or a tree. */
export interface Round {
  readonly kind: "round";
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
  readonly apply: (change: Partial<Record<"x" | "z" | "radius", number>>) => Scene;
}

export type Body = Rect | Round;

function obstacleIn(scene: Scene, index: number, item: Obstacle): Body {
  const put = (next: Obstacle): Scene => ({
    ...scene,
    obstacles: scene.obstacles.with(index, next),
  });

  if (item.kind === "box") {
    return { ...item, kind: "rect", shortest: 0.1, apply: (change) => put({ ...item, ...change }) };
  }

  if (item.kind === "hedge") {
    // Its length is a rectangle's width.
    return {
      ...item,
      kind: "rect",
      width: item.length,
      shortest: 0.1,
      apply: ({ width = item.length, ...change }) => put({ ...item, ...change, length: width }),
    };
  }

  return { ...item, kind: "round", apply: (change) => put({ ...item, ...change }) };
}

/** A car place: its length is a rectangle's depth; it lies on the ground. */
function placeIn(scene: Scene, index: number): Body | undefined {
  const places = scene.carPlaces ?? [];
  const item = places[index];

  return (
    item && {
      ...item,
      kind: "rect",
      depth: item.length,
      height: 0,
      shortest: 1,
      apply: ({ depth = item.length, ...change }) => ({
        ...scene,
        carPlaces: places.with(index, { ...item, ...change, length: depth }),
      }),
    }
  );
}

export function bodyOf(scene: Scene, { kind, index }: Target): Body | undefined {
  if (kind === "fence") return undefined;

  if (kind === "place") return placeIn(scene, index);

  if (kind === "obstacle") {
    const item = scene.obstacles[index];

    return item && obstacleIn(scene, index, item);
  }

  if (kind === "surface") {
    const surfaces = scene.surfaces ?? [];
    const item = surfaces[index];

    return (
      item && {
        ...item,
        kind: "rect",
        height: 0,
        shortest: 0.1,
        apply: (change) => ({ ...scene, surfaces: surfaces.with(index, { ...item, ...change }) }),
      }
    );
  }

  const block = scene.blocks[index];

  return (
    block && {
      ...block,
      kind: "rect",
      height: block.eave,
      shortest: 1,
      apply: (change) => ({ ...scene, blocks: scene.blocks.with(index, { ...block, ...change }) }),
    }
  );
}

/** The scene-frame point at `u` across, `w` deep in a rectangle, at height `y`. */
export function on(
  rect: Pick<Rect, "x" | "z" | "rotation">,
  u: number,
  y: number,
  w: number,
): Triple {
  const [x, z] = turn(u, w, rect.rotation);

  return [rect.x + x, y, rect.z + z];
}

/** The same in three.js's frame. */
export const onWorld = (
  north: number,
  rect: Pick<Rect, "x" | "z" | "rotation">,
  u: number,
  y: number,
  w: number,
): Triple => world(north, on(rect, u, y, w));

/** Where a pitched roof's ridge (or high eave) stands in the block's own frame, and how far its
 * slope runs; null for a flat roof. */
export function ridge(block: Block): Readonly<Record<"u" | "w" | "run" | "top", number>> | null {
  const { roof, width, depth, eave } = block;

  if (roof.kind === "flat") return null;

  const runs = { monoPitch: depth, gable: depth / 2, hip: Math.min(width, depth) / 2 };
  const run = runs[roof.kind];

  return {
    u: width / 2,
    w: roof.kind === "monoPitch" ? 0 : depth / 2,
    run,
    top: eave + run * Math.tan((roof.pitch * Math.PI) / 180),
  };
}
