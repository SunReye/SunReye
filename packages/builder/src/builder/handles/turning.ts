// An editor's ring and typed turns (ADR 20): a traced block turns about its footprint's centroid,
// a rectangle about its centre; a dragged turn settles lightly into the compass and other blocks'
// walls, or turns free. Pure and three.js-free.
import { centroidOf, turnBlock } from "@sunreye/scene";
import type { Scene } from "../pv.ts";
import { detent } from "../view-turn.ts";
import { bodyOf, on, type Rect, type Target } from "./body.ts";
import { tidy, toDegrees, turn, world, type Triple } from "./frame.ts";

/** How a dragged turn settles: into nearby stops on whole degrees, or free to a tenth. */
export type Settle = "light" | "free";

/** Metres between a footprint's farthest corner and its ring. */
const RING = 1;

/** Degrees off a stop a light turn still settles into. */
const WITHIN = 3;

const normalised = (angle: number): number => tidy(((angle % 360) + 360) % 360);

/** The footprint of traced block `index`; none for any other block. */
const tracedOf = (scene: Scene, index: number) => scene.blocks[index]?.freeForm?.footprint;

/** Where a traced footprint's walls run: its longest edge's bearing, clockwise from x. */
function wallsOf(footprint: readonly (readonly number[])[]): number {
  let [best, bearing] = [-1, 0];

  for (const [index, [x1 = 0, z1 = 0]] of footprint.entries()) {
    const [x2 = 0, z2 = 0] = footprint[(index + 1) % footprint.length] ?? [];
    const length = Math.hypot(x2 - x1, z2 - z1);

    if (length > best + 1e-6) [best, bearing] = [length, toDegrees(Math.atan2(z2 - z1, x2 - x1))];
  }

  return bearing;
}

/** The ring about traced block `target`, in three.js's frame; none for anything else. */
export function tracedRing(scene: Scene, target: Target) {
  const footprint = target.kind === "block" ? tracedOf(scene, target.index) : undefined;

  if (footprint === undefined) return [];

  const [cx, cz] = centroidOf(footprint);
  const reach = Math.max(...footprint.map(([x = 0, z = 0]) => Math.hypot(x - cx, z - cz)));

  return [
    {
      grip: "turn" as const,
      at: world(scene.north, [cx, 0, cz]),
      radius: reach + RING,
    },
  ];
}

/** The turn `target` stands at, in degrees, as its inspector shows it: a traced block its turn so
 * far; none for what does not turn. */
export function angleOf(scene: Scene, target: Target): number | undefined {
  if (target.kind === "block" && tracedOf(scene, target.index) !== undefined) {
    return scene.blocks[target.index]?.rotation;
  }

  const body = bodyOf(scene, target);

  return body?.kind === "rect" ? body.rotation : undefined;
}

/** `rect` turned `by` degrees about its centre. */
function rectTurned(rect: Rect, by: number): Scene {
  const centre = on(rect, rect.width / 2, 0, rect.depth / 2);
  const rotation = normalised(rect.rotation + by);
  const [cx, cz] = turn(rect.width / 2, rect.depth / 2, rotation);

  return rect.apply({
    rotation,
    x: tidy(centre[0] - cx),
    z: tidy(centre[2] - cz),
  });
}

/** `scene` with `target` turned exactly `by` degrees clockwise seen from above, about its middle;
 * null for what does not turn. */
export function turnedBy(scene: Scene, target: Target, by: number): Scene | null {
  if (target.kind === "block" && tracedOf(scene, target.index) !== undefined) {
    return turnBlock(scene, target.index, by);
  }

  const body = bodyOf(scene, target);

  return body?.kind === "rect" ? rectTurned(body, by) : null;
}

/** Which way a block's walls run, in degrees clockwise from x: its turn, or a traced one's
 * longest edge. */
function wallsAt(scene: Scene, index: number): number | undefined {
  const footprint = tracedOf(scene, index);

  return footprint === undefined ? scene.blocks[index]?.rotation : wallsOf(footprint);
}

/** The middle `target` turns about, in the scene's frame. */
function middleOf(scene: Scene, target: Target): readonly [number, number] | undefined {
  const footprint = target.kind === "block" ? tracedOf(scene, target.index) : undefined;

  if (footprint !== undefined) return centroidOf(footprint);

  const body = bodyOf(scene, target);

  if (body?.kind !== "rect") return undefined;

  const [x, , z] = on(body, body.width / 2, 0, body.depth / 2);

  return [x, z];
}

/** Where a light turn settles: the compass every 45°, and other blocks' walls every 90°. */
function stops(scene: Scene, target: Target): number[] {
  const others = scene.blocks.flatMap((_, index) =>
    target.kind === "block" && index === target.index ? [] : [wallsAt(scene, index) ?? 0],
  );

  return [
    ...Array.from({ length: 8 }, (_, k) => -scene.north + k * 45),
    ...others.flatMap((walls) => [0, 90, 180, 270].map((k) => walls + k)),
  ];
}

/** `target` turned by the pointer going round its middle from `from` to `to` (scene frame),
 * settled; null for what does not turn. */
export function ringTurned(
  scene: Scene,
  target: Target,
  [from, to]: readonly [Triple, Triple],
  settle: Settle,
): { scene: Scene; value: number[]; unit: "°" } | null {
  const [middle, angle] = [middleOf(scene, target), angleOf(scene, target)];

  if (middle === undefined || angle === undefined) return null;

  const bearing = (point: Triple): number =>
    toDegrees(Math.atan2(point[2] - middle[1], point[0] - middle[0]));

  const by = bearing(to) - bearing(from);

  // Its walls settle into a stop; its own turn moves as far.
  const walls = (target.kind === "block" ? wallsAt(scene, target.index) : undefined) ?? angle;
  const stop = detent(walls + by, stops(scene, target), WITHIN);
  const held = settle === "light" && Math.abs(normalised(stop - walls - by + 180) - 180) > 1e-9;
  const step = settle === "free" ? 10 : 1;

  const turned = held ? stop - walls : Math.round((angle + by) * step) / step - angle;

  const next = turnedBy(scene, target, turned);

  return next && { scene: next, value: [angleOf(next, target) ?? 0], unit: "°" };
}

/** `grab` as an editor's `ring` turns it: lightly, or free while Shift is held; else as it is. */
export function settled<T extends { readonly grip: string; readonly settle?: Settle | undefined }>(
  grab: T,
  ring: boolean | undefined,
  free: boolean,
): T {
  if (grab.grip !== "turn" || ring !== true) return grab;

  return { ...grab, settle: free ? "free" : "light" };
}
