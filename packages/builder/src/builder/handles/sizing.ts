// A chimney's and a roof window's arrows (ADR 20): its width from its right edge, its depth or
// length from its upper edge, the opposite edge staying where it was. Pure and three.js-free; the
// outline is the crate's (east, north, up), from the object's own lower left, counter-clockwise.
import type { Chimney, Point, RoofWindow, Scene } from "../pv.ts";
import { cross, dot, unit } from "../vector.ts";
import type { Target } from "./body.ts";
import type { Crate, Dragged, Grab } from "./dragging.ts";
import { clamp, meet, tidy, type Ray, type Triple } from "./frame.ts";
import { onRoof } from "./on-roof.ts";

/** Metres an arrow stands off its edge. */
const ARROW = 0.3;

/** The sizes a drag keeps to, in metres. */
const SHORTEST = 0.1;
const LONGEST = 10;

/** East, north, up as three.js has it: x east, y up, z south. */
const three = ([east, north, up]: Point): Triple => [east, up, 0 - north];

const minus = (a: Triple, b: Triple): Triple => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** The outline's corners in three.js's frame, from its own lower left; none short of four. */
function cornersOf(outline: readonly Point[] | null | undefined) {
  const [a, b, c, d] = (outline ?? []).map((point) => three(point));

  return a && b && c && d ? ([a, b, c, d] as const) : undefined;
}

/** An arrow `grip` at the middle of the edge from `from` to `to`, pointing out along `way`. */
function arrow(grip: "width" | "depth", from: Triple, to: Triple, way: Triple) {
  const axis = unit(way);
  const mid = (i: 0 | 1 | 2) => (from[i] + to[i]) / 2 + axis[i] * ARROW;
  const at: Triple = [mid(0), mid(1), mid(2)];

  return { grip, at, axis };
}

/** An arrow at the middle of each of the outline's right and upper edges, pointing out. */
export function roofArrows(outline: readonly Point[]) {
  const corners = cornersOf(outline);

  if (corners === undefined) return [];

  const [a, b, c, d] = corners;

  return [arrow("width", b, c, minus(b, a)), arrow("depth", c, d, minus(d, a))];
}

/** Its size `key` and its centre on its face, as a drag changes them. */
interface Sized {
  readonly key: "width" | "depth" | "length";
  readonly size: number;
  readonly across: number;
  readonly up: number;
}

/** The size an arrow drags, and its length now: the width, or a chimney's depth or a roof
 * window's length. */
function sizeOf(item: Chimney | RoofWindow, wide: boolean): readonly [Sized["key"], number] {
  if (wide) return ["width", item.width];

  return "depth" in item ? ["depth", item.depth] : ["length", item.length];
}

/** `sized` set on roof object `index` of `kind`. */
function put(scene: Scene, { kind, index }: Target, { key, size, across, up }: Sized): Scene {
  if (kind === "chimney") {
    const items = scene.chimneys ?? [];
    const item = items[index];

    return item
      ? { ...scene, chimneys: items.with(index, { ...item, [key]: size, across, up }) }
      : scene;
  }

  const items = scene.roofWindows ?? [];
  const item = items[index];

  return item
    ? { ...scene, roofWindows: items.with(index, { ...item, [key]: size, across, up }) }
    : scene;
}

/** How far the pointer went from `grab` to `now` along the dragged edge, in the outline's plane,
 * and that edge's length; null where a ray misses the plane. */
function travelled(
  [a, b, , d]: readonly [Triple, Triple, Triple, Triple],
  wide: boolean,
  [grab, now]: readonly [Ray, Ray],
): { readonly along: number; readonly edge: number } | null {
  const edge = minus(wide ? b : d, a);
  const normal = cross(minus(b, a), minus(d, a));
  const [from, to] = [meet(grab, a, normal), meet(now, a, normal)];

  if (from === null || to === null) return null;

  return { along: dot(minus(to, from), unit(edge)), edge: Math.hypot(...edge) };
}

/** Roof object `target` in `scene`; none for anything else. */
const itemOf = (scene: Scene, { kind, index }: Target) =>
  kind === "chimney" ? scene.chimneys?.[index] : scene.roofWindows?.[index];

/** A chimney's or a roof window's drag: its move, or an arrow that sizes it, on the outline the
 * crate laid out for it. */
export function roofDragged(
  scene: Scene,
  target: Target,
  [grab, now]: readonly [Grab, Ray],
  crate: Crate,
): Dragged | null {
  if (grab.grip === "move") return onRoof(scene, target, [grab, now], crate);

  if (grab.grip !== "width" && grab.grip !== "depth") return null;

  const { footings = [], panes = [] } = crate.laid;
  const outline = target.kind === "chimney" ? footings[target.index]?.foot : panes[target.index];

  return roofSized(scene, target, [grab, now], {
    outline,
    stands: (next) => crate.pv.roofObjectsStand(next),
  });
}

/** Roof object `target` at size `size`, grown from `before` by the edge `wide` names: its
 * centre moves half as far as the edge, along its own turned side, `scale` its size a metre on its
 * face. */
function resized(
  scene: Scene,
  target: Target,
  item: Chimney | RoofWindow,
  { wide, scale }: { readonly wide: boolean; readonly scale: number },
) {
  const [key, before] = sizeOf(item, wide);
  const turn = ((item.turn ?? 0) * Math.PI) / 180;
  // Its own axes on the face, turned clockwise as the crate turns them.
  const [dx, dy] = wide ? [Math.cos(turn), -Math.sin(turn)] : [Math.sin(turn), Math.cos(turn)];

  return (size: number): Scene => {
    const half = (size - before) / scale / 2;

    return put(scene, target, {
      key,
      size,
      across: tidy(item.across + half * dx),
      up: tidy(item.up + half * dy),
    });
  };
}

/** The size nearest `wanted`, from `before` toward it in whole centimetres, at which `at` leaves
 * every roof object standing; `wanted` where it stood nowhere to begin with. */
function reachable(
  at: (size: number) => Scene,
  [before, wanted]: readonly [number, number],
  stands: (scene: Scene) => boolean,
): number {
  if (stands(at(wanted)) || !stands(at(before))) return wanted;

  const steps = Math.round(Math.abs(wanted - before) * 100);
  const way = Math.sign(wanted - before) / 100;
  let [low, high] = [0, steps];

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);

    if (stands(at(tidy(before + middle * way)))) low = middle;
    else high = middle;
  }

  return tidy(before + low * way);
}

/** A roof object's arrow dragged from `grab` to `now`, in the plane of its `outline`: its size to
 * whole centimetres, its centre moved half as far on its face, stopped where it would leave its
 * face or meet another. */
function roofSized(
  scene: Scene,
  target: Target,
  [grab, now]: readonly [Grab, Ray],
  {
    outline,
    stands,
  }: {
    readonly outline: readonly Point[] | null | undefined;
    readonly stands: (scene: Scene) => boolean;
  },
): Dragged | null {
  const corners = cornersOf(outline);
  const item = itemOf(scene, target);

  if (corners === undefined || item === undefined) return null;

  const wide = grab.grip === "width";
  const moved = travelled(corners, wide, [grab.ray, now]);

  if (moved === null) return null;

  const [, before] = sizeOf(item, wide);
  // Size per metre on the face: a chimney's depth is level, its edge runs up the slope.
  const scale = before / moved.edge;
  const wanted = clamp(Math.round((before + moved.along * scale) * 100) / 100, SHORTEST, LONGEST);
  const at = resized(scene, target, item, { wide, scale });
  const size = reachable(at, [before, wanted], stands);

  return { scene: at(size), value: [size], unit: "size", ...(size !== wanted && { edge: true }) };
}
