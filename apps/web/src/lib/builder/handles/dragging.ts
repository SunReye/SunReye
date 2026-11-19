// What a handle drag makes of the scene (ADR 20): from the ray that grabbed it to the pointer's
// ray now, snapped. Pure; the drag slides in a level plane, the pitch in an upright one.
import type { Modules, Pv, Scene } from "../pv.ts";
import { slide as slideOpening, type Fitter } from "../wall-openings.ts";
import { bodyOf, on, ridge, type Body, type Rect, type Round, type Target } from "./body.ts";
import {
  clamp,
  inScene,
  meet,
  snap,
  tidy,
  toDegrees,
  turn,
  world,
  type Ray,
  type Triple,
} from "./frame.ts";
import type { Grip } from "./grips.ts";
import { onRoof } from "./on-roof.ts";
import { onLevel } from "./shallow.ts";
import { along, edges, pull, snapTurn } from "./snapping.ts";

/** Where a drag began: its grip, its ray, and the height of the plane it slides in. */
export interface Grab {
  readonly grip: Grip;
  /** Which of a fence's points a point grip drags. */
  readonly point?: number | undefined;
  readonly ray: Ray;
  readonly height: number;
  /** The point grabbed, in three.js's frame: what a shallow view's drag moves. */
  readonly at?: Triple | undefined;
}

export interface Dragged {
  readonly scene: Scene;
  /** What the handle shows while dragging: one length or angle, or x and z for a move. */
  readonly value: readonly number[];
  readonly unit: "m" | "°";
}

const LENGTH = 0.1;
const ANGLE = 5;

/** The inspector's bounds (BlockFieldset, ObstacleFieldset). */
const LONGEST = 60;
const WIDEST = 20;
const STEEPEST = 60;

/** A drag in a level plane, in the scene's frame. */
interface Slide {
  readonly scene: Scene;
  readonly target: Target;
  readonly from: Triple;
  readonly to: Triple;
}

/** A wall arrow: width or depth, its far edge snapped to a parallel block's. */
function stretch({ scene, target, from, to }: Slide, rect: Rect, key: "width" | "depth"): Dragged {
  const axis = key === "depth" ? 1 : 0;

  const shift =
    along(rect.rotation, to[0], to[2])[axis] - along(rect.rotation, from[0], from[2])[axis];

  const start = along(rect.rotation, rect.x, rect.z)[axis];
  const grid = snap(rect[key] + shift, LENGTH);
  const edge = pull([start + grid], edges(scene, target, rect.rotation)[axis]);
  const length = clamp(tidy(grid + edge), rect.shortest, LONGEST);

  return { scene: rect.apply({ [key]: length }), value: [length], unit: "m" };
}

function grow({ from, to }: Slide, round: Round): Dragged {
  const reach = (point: Triple): number => Math.hypot(point[0] - round.x, point[2] - round.z);
  const radius = clamp(snap(round.radius + reach(to) - reach(from), LENGTH), LENGTH, WIDEST);

  return { scene: round.apply({ radius }), value: [radius], unit: "m" };
}

/** The footprint follows the pointer; a rectangle's edges snap to parallel blocks'. */
function place({ scene, target, from, to }: Slide, body: Body): Dragged {
  const x = snap(body.x + to[0] - from[0], LENGTH);
  const z = snap(body.z + to[2] - from[2], LENGTH);

  if (body.kind === "round") return { scene: body.apply({ x, z }), value: [x, z], unit: "m" };

  const [across, deep] = edges(scene, target, body.rotation);
  const [u, w] = along(body.rotation, x, z);

  const [dx, dz] = turn(
    pull([u, u + body.width], across),
    pull([w, w + body.depth], deep),
    body.rotation,
  );

  const [px, pz] = [tidy(x + dx), tidy(z + dz)];

  return { scene: body.apply({ x: px, z: pz }), value: [px, pz], unit: "m" };
}

/** A fence's point follows the pointer; it snaps onto a block's compass-aligned edges. */
function repoint({ scene, target, from, to }: Slide, point: number): Dragged | null {
  const fences = scene.fences ?? [];
  const fence = fences[target.index];
  const at = fence?.points[point];

  if (fence === undefined || at === undefined) return null;

  const x = snap(at.x + to[0] - from[0], LENGTH);
  const z = snap(at.z + to[2] - from[2], LENGTH);
  const [across, deep] = edges(scene, target, 0);
  const [px, pz] = [tidy(x + pull([x], across)), tidy(z + pull([z], deep))];
  const points = fence.points.with(point, { x: px, z: pz });

  return {
    scene: { ...scene, fences: fences.with(target.index, { ...fence, points }) },
    value: [px, pz],
    unit: "m",
  };
}

const normalised = (angle: number): number => tidy(((angle % 360) + 360) % 360);

/** The ring: a turn about the footprint's centre. */
function spin({ scene, target, from, to }: Slide, rect: Rect): Dragged {
  const centre = on(rect, rect.width / 2, 0, rect.depth / 2);

  const bearing = (point: Triple): number =>
    toDegrees(Math.atan2(point[2] - centre[2], point[0] - centre[0]));

  return about(scene, target, rect, bearing(to) - bearing(from));
}

/** `rect` turned `by` degrees about its footprint's centre, snapped. */
function about(scene: Scene, target: Target, rect: Rect, by: number): Dragged {
  const centre = on(rect, rect.width / 2, 0, rect.depth / 2);
  const rotation = normalised(snapTurn(scene, target, rect.rotation + by));
  const [cx, cz] = turn(rect.width / 2, rect.depth / 2, rotation);

  return {
    scene: rect.apply({ rotation, x: tidy(centre[0] - cx), z: tidy(centre[2] - cz) }),
    value: [rotation],
    unit: "°",
  };
}

/** The turn mode's dial: `target` turned `by` degrees, clockwise seen from above, about its
 * centre and snapped as the ring's turn is; null for what has no turn. */
export function turned(scene: Scene, target: Target, by: number): Dragged | null {
  const body = bodyOf(scene, target);

  return body?.kind === "rect" ? about(scene, target, body, by) : null;
}

/** The upright plane a ridge handle slides in: facing the camera, or seen from straight above,
 * standing across the slope. */
function upright({ direction: [dx, , dz] }: Ray, rotation: number): Triple {
  const flat = Math.hypot(dx, dz);
  const [ax, az] = turn(0, 1, rotation);

  return flat < 1e-6 ? [ax, 0, az] : [-dx / flat, 0, -dz / flat];
}

/** The ridge handle slides up and down; the pitch follows its height. */
function tilt(scene: Scene, index: number, grab: Ray, now: Ray): Dragged | null {
  const block = scene.blocks[index];

  if (block === undefined) return null;

  const { roof } = block;
  const top = ridge(block);

  if (top === null || roof.kind === "flat") return null;

  const at = on(block, top.u, top.top, top.w);
  const normal = upright(grab, block.rotation);
  const [from, to] = [meet(grab, at, normal), meet(now, at, normal)];

  if (from === null || to === null) return null;

  const height = top.top + to[1] - from[1];
  const steep = toDegrees(Math.atan2(height - block.eave, top.run));
  const pitch = clamp(snap(steep, ANGLE), 0, STEEPEST);
  const blocks = scene.blocks.with(index, { ...block, roof: { ...roof, pitch } });

  return { scene: { ...scene, blocks }, value: [pitch], unit: "°" };
}

function slid(grip: Grip, slide: Slide, body: Body): Dragged | null {
  if (grip === "move") return place(slide, body);

  if (body.kind === "round") return grip === "radius" ? grow(slide, body) : null;

  if (grip === "width" || grip === "depth") return stretch(slide, body, grip);

  return grip === "turn" ? spin(slide, body) : null;
}

/** What a chimney's or an opening's drag asks the crate: where it may be, and the walls it laid
 * out. */
export interface Crate extends Fitter {
  readonly pv: Pick<Pv, "refit" | "glide" | "glideWindow">;
  readonly laid: Pick<Modules, "walls" | "roofs">;
}

/** A drag in a level plane: a fence's point, or a body. */
function levelled(slide: Slide, grab: Grab): Dragged | null {
  if (grab.grip === "point") return repoint(slide, grab.point ?? -1);

  const body = bodyOf(slide.scene, slide.target);

  return body === undefined ? null : slid(grab.grip, slide, body);
}

/** A drag the crate keeps in its place: an opening slides in its wall's plane, a chimney and a roof
 * window in their roof face's. */
function fitted(
  scene: Scene,
  target: Target,
  [grab, now]: readonly [Grab, Ray],
  crate: Crate,
): Dragged | null {
  if (target.kind !== "opening") {
    return grab.grip === "move" ? onRoof(scene, target, [grab, now], crate) : null;
  }

  return grab.grip === "move" || grab.grip === "width" || grab.grip === "height"
    ? slideOpening(scene, target.index, grab.grip, [grab.ray, now], crate)
    : null;
}

/** What dragging `grab` to the pointer's ray `now` makes of the scene; null where the ray misses
 * the drag's plane or the grip has nothing to drag. A chimney and an opening go where the `crate`
 * lets them, and nowhere without it. */
export function drag(
  scene: Scene,
  target: Target,
  grab: Grab,
  now: Ray,
  crate?: Crate,
): Dragged | null {
  if (target.kind === "opening" || target.kind === "chimney" || target.kind === "roofWindow") {
    return crate === undefined ? null : fitted(scene, target, [grab, now], crate);
  }

  const [start, end] = [inScene(scene.north, grab.ray), inScene(scene.north, now)];

  if (grab.grip === "pitch") {
    return target.kind === "block" ? tilt(scene, target.index, start, end) : null;
  }

  const held = grab.at && world(-scene.north, grab.at);
  const ends = onLevel([start, end], grab.height, held);

  if (ends === null) return null;

  const [from, to] = ends;

  return levelled({ scene, target, from, to }, grab);
}
