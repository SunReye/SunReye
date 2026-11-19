// Windows and doors on a block's walls, as the builder edits them (ADR 20 Openings): a new one's
// place, a change kept on its wall, and a handle's drag along it. The pv crate fits them and
// decides what is refused; here are each kind's usual size, the handles' steps and the
// pointer's travel.
import type { Dragged } from "./handles/dragging.ts";
import { meet, snap, type Ray, type Triple } from "./handles/frame.ts";
import type { Modules, Opening, OpeningKind, Point, Pv, Scene, Unfit, WallFrame } from "./pv.ts";

/** Each kind's usual size in metres. */
export const USUAL: Readonly<
  Record<OpeningKind, Required<Pick<Opening, "width" | "height" | "sill">>>
> = {
  window: { width: 1.2, height: 1.4, sill: 0.9 },
  frenchWindow: { width: 1.8, height: 2.2, sill: 0 },
  frontDoor: { width: 1, height: 2.1, sill: 0 },
  garageDoor: { width: 2.5, height: 2.1, sill: 0 },
};

/** Metres: the handles' step. */
const STEP = 0.1;

/** Metres: the longest wall the inspector lets a block have. */
const LONGEST = 60;

/** The scene with opening `index` changed, kept on its wall, or why the change cannot be. */
export function refit(
  pv: Pick<Pv, "refit">,
  scene: Scene,
  index: number,
  change: Partial<Opening>,
): Scene | { readonly unfit: Unfit } {
  const openings = scene.openings ?? [];
  const before = openings[index];

  if (before === undefined) return { unfit: "room" };

  const fitted = pv.refit(scene, index, { ...before, ...change });

  return "unfit" in fitted ? fitted : { ...scene, openings: openings.with(index, fitted.opening) };
}

/** A new opening of `kind` in its usual size, in the first free place on a walled block; null
 * when none takes it. */
export function fresh(pv: Pick<Pv, "place">, scene: Scene, kind: OpeningKind): Opening | null {
  return pv.place(scene, kind, USUAL[kind]);
}

/** Metres between an opening and its duplicate. */
const BESIDE = 0.2;

/** The first of `alongs` at which `copy`, the scene's last opening, fits its wall as it is. */
function placed(pv: Pick<Pv, "refit">, scene: Scene, alongs: readonly number[]): Scene | null {
  const index = (scene.openings?.length ?? 0) - 1;

  for (const along of alongs) {
    const next = refit(pv, scene, index, { along });

    // Kept where it was asked: the crate moved it nowhere to keep it on the wall.
    if (!("unfit" in next) && next.openings?.[index]?.along === along) return next;
  }

  return null;
}

/** The scene with a copy of `original` last: in the first free place to the right of where it
 * stands on its wall, else the wall's first free place, in 10 cm steps; null where the wall has no
 * room, or its block is gone. */
export function pasted(pv: Pick<Pv, "refit">, scene: Scene, original: Opening): Scene | null {
  if (scene.blocks[original.block] === undefined) return null;

  const from = snap(original.along + original.width + BESIDE, STEP);
  // A wall is no longer than a block may be.
  const steps = Array.from({ length: LONGEST / STEP }, (_, i) => snap(i * STEP, STEP));
  const copied = { ...scene, openings: [...(scene.openings ?? []), original] };

  return placed(pv, copied, [
    ...steps.filter((at) => at >= from),
    ...steps.filter((at) => at < from),
  ]);
}

/** The scene with a copy of opening `index` last, placed as a pasted one; null without room. */
export function duplicate(pv: Pick<Pv, "refit">, scene: Scene, index: number): Scene | null {
  const original = scene.openings?.[index];

  return original === undefined ? null : pasted(pv, scene, original);
}

const lowered = (opening: Opening): Opening => ({ ...opening, block: opening.block - 1 });

/** The scene without block `index`'s openings, later blocks' following it down. */
export function withOpenings(scene: Scene, index: number): Scene {
  if (scene.openings === undefined) return scene;

  return {
    ...scene,
    openings: scene.openings
      .filter((opening) => opening.block !== index)
      .map((opening) => (opening.block > index ? lowered(opening) : opening)),
  };
}

/** A wall in three.js's frame. */
export interface OnWall {
  /** The point `along` it at `height`, `off` metres out. */
  readonly at: (along: number, height: number, off?: number) => Triple;
  /** A metre along it to the right, seen from outside, and its outward normal. */
  readonly right: Triple;
  readonly out: Triple;
}

/** The crate's east, north, up in three.js's frame. */
const three = ([east, north, up]: Point): Triple => [east, up, 0 - north];

/** A wall the crate laid out, as three.js draws on it. */
function onWall(frame: WallFrame): OnWall {
  const [left, right, out] = [three(frame.left), three(frame.right), three(frame.out)];

  return {
    at: (along, height, off = 0) => [
      left[0] + right[0] * along + out[0] * off,
      height,
      left[2] + right[2] * along + out[2] * off,
    ],
    right,
    out,
  };
}

/** The laid-out wall opening `index` is in. */
export function wallOf(
  scene: Scene,
  { walls }: Pick<Modules, "walls">,
  index: number,
): OnWall | undefined {
  const opening = scene.openings?.[index];
  const frame = opening && walls[opening.block]?.[opening.wall];

  return frame && onWall(frame);
}

const dot = (a: Triple, b: Triple): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** How far the pointer went from `grab` to `now` in the plane of `wall` through `opening`: metres
 * along the wall and up; null where either ray misses it. */
function travel(
  wall: OnWall,
  opening: Opening,
  [grab, now]: readonly [Ray, Ray],
): readonly [number, number] | null {
  const origin = wall.at(opening.along, opening.sill ?? 0);
  const [from, to] = [meet(grab, origin, wall.out), meet(now, origin, wall.out)];

  if (from === null || to === null) return null;

  return [dot([to[0] - from[0], 0, to[2] - from[2]], wall.right), to[1] - from[1]];
}

/** A window's sill `up` metres higher, the window whole between the ground and the `eave`; any
 * other opening stays on the ground (ADR 20). */
function lifted(opening: Opening, up: number, eave: number): Partial<Opening> {
  if (opening.kind !== "window") return {};

  const sill = snap((opening.sill ?? 0) + up, STEP);

  return { sill: Math.max(0, Math.min(sill, snap(eave - opening.height, 0.01))) };
}

/** What a grip changes by a drag of `across` metres along the wall and `up` metres, under a wall
 * `eave` metres high. */
const GRIPS = {
  move: (opening: Opening, across: number, up: number, eave: number) => ({
    along: snap(opening.along + across, STEP),
    ...lifted(opening, up, eave),
  }),
  width: (opening: Opening, across: number) => ({ width: snap(opening.width + across, STEP) }),
  height: (opening: Opening, _: number, up: number) => ({
    height: snap(opening.height + up, STEP),
  }),
} as const;

export type OpeningGrip = keyof typeof GRIPS;

/** The dragged scene and what the grip's handle shows of opening `index`: a moved window its place
 * along the wall and its sill. */
function reading(scene: Scene, index: number, grip: OpeningGrip): Dragged | null {
  const opening = scene.openings?.[index];

  if (opening === undefined) return null;

  if (grip !== "move") return { scene, value: [opening[grip]], unit: "m" };

  const value = opening.kind === "window" ? [opening.along, opening.sill ?? 0] : [opening.along];

  return { scene, value, unit: "m" };
}

/** What an opening's drag asks the crate: its fit, and the walls it laid out. */
export interface Fitter {
  readonly pv: Pick<Pv, "refit">;
  readonly laid: Pick<Modules, "walls">;
}

/**
 * What dragging opening `index` by `grip` from the ray that grabbed it to the pointer's ray now
 * makes of the scene, both in three.js's frame: it slides in its wall's plane, snapped to 10 cm.
 * Null where a ray misses the wall or the crate refuses the change.
 */
export function slide(
  scene: Scene,
  index: number,
  grip: OpeningGrip,
  rays: readonly [Ray, Ray],
  { pv, laid }: Fitter,
): Dragged | null {
  const opening = scene.openings?.[index];
  const wall = wallOf(scene, laid, index);

  if (opening === undefined || wall === undefined) return null;

  const moved = travel(wall, opening, rays);

  if (moved === null) return null;

  const eave = scene.blocks[opening.block]?.eave ?? 0;
  const next = refit(pv, scene, index, GRIPS[grip](opening, ...moved, eave));

  return "unfit" in next ? null : reading(next, index, grip);
}
