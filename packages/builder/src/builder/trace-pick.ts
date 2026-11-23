// What a pointer picks on a traced roof by its pixels (ADR 20): once points have heights, a raised
// point stands over ground other than its own, so the click is matched to the points and lines as
// the canvas draws them, not to the ground under it. Pure.
import type { Scene, Snap, Spot } from "@sunreye/scene";

/** Where a scene spot lands on the canvas, in pixels; null behind the camera. */
export type Onscreen = (spot: Spot) => readonly [number, number] | null;

/** A traced point's spot. */
const spotOf = (p: readonly number[]): Spot => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];

/** The spot `t` of the way from `a` to `b`. */
const between = (a: Spot, b: Spot, t: number): Spot => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** The traced point drawn nearest `pointer` within `pixels`, if any. */
function nearPoint(
  scene: Scene,
  onscreen: Onscreen,
  [px, py]: readonly [number, number],
  pixels: number,
): Snap | undefined {
  let found: Snap | undefined;
  let closest = pixels;

  for (const [block, item] of scene.blocks.entries())
    for (const [point, p] of (item.freeForm?.traced?.points ?? []).entries()) {
      const [x, y] = onscreen(spotOf(p)) ?? [Infinity, Infinity];
      const apart = Math.hypot(x - px, y - py);

      if (apart <= closest) {
        closest = apart;
        found = { kind: "point", block, point, at: spotOf(p) };
      }
    }

  return found;
}

/** A place along a drawn segment: how far, from 0 to 1, and its pixels from the pointer. */
interface Along {
  readonly t: number;
  readonly apart: number;
}

/** How far along the drawn segment `a`–`b` the place nearest `pointer` lies, from 0 to 1, and its
 * pixels from the pointer. */
function nearest(
  [ax, ay]: readonly [number, number],
  [bx, by]: readonly [number, number],
  [px, py]: readonly [number, number],
): Along {
  const length = (bx - ax) ** 2 + (by - ay) ** 2;
  const along = length > 0 ? ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / length : 0;
  const t = Math.min(1, Math.max(0, along));

  return { t, apart: Math.hypot(ax + (bx - ax) * t - px, ay + (by - ay) * t - py) };
}

/** Every traced line, by its block and its place, with its two ends' spots. */
function segments(scene: Scene): { block: number; line: number; a: Spot; b: Spot }[] {
  return scene.blocks.flatMap((item, block) => {
    const { points = [], lines = [] } = item.freeForm?.traced ?? {};

    return lines.map(([i = 0, j = 0], line) => ({
      block,
      line,
      a: spotOf(points[i] ?? []),
      b: spotOf(points[j] ?? []),
    }));
  });
}

/** The place on a traced line drawn nearest `pointer` within `pixels`, if any. */
function nearLine(
  scene: Scene,
  onscreen: Onscreen,
  pointer: readonly [number, number],
  pixels: number,
): Snap | undefined {
  let found: Snap | undefined;
  let closest = pixels;

  for (const { block, line, a, b } of segments(scene)) {
    const [from, to] = [onscreen(a), onscreen(b)];
    const near = from && to && nearest(from, to, pointer);

    if (near && near.apart <= closest) {
      closest = near.apart;
      found = { kind: "line", block, line, at: between(a, b, near.t) };
    }
  }

  return found;
}

/** What `pointer`, in canvas pixels, picks within `pixels`: a traced point before a line, as drawn. */
export function pick(
  scene: Scene,
  onscreen: Onscreen,
  pointer: readonly [number, number],
  pixels: number,
): Snap | undefined {
  return nearPoint(scene, onscreen, pointer, pixels) ?? nearLine(scene, onscreen, pointer, pixels);
}
