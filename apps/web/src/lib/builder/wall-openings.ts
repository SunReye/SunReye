// Windows and doors on a block's walls, as the builder edits them (ADR 20 Openings): a new one's
// place, a change kept on its wall, and a handle's drag along it. Pure; the pv crate decides
// what is refused.
import type { Dragged } from "./handles/dragging.ts";
import { clamp, inScene, meet, snap, turn, type Ray, type Triple } from "./handles/frame.ts";
import type { Block, Opening, OpeningKind, Scene, Wall } from "./pv.ts";

/** Each kind's usual size in metres. */
export const USUAL: Readonly<Record<OpeningKind, Pick<Opening, "width" | "height" | "sill">>> = {
  window: { width: 1.2, height: 1.4, sill: 0.9 },
  frenchWindow: { width: 1.8, height: 2.2, sill: 0 },
  frontDoor: { width: 1, height: 2.1, sill: 0 },
  garageDoor: { width: 2.5, height: 2.1, sill: 0 },
};

export const WALLS: readonly Wall[] = ["front", "right", "back", "left"];

/** Metres: the handles' step, the smallest opening, and a new one's distance from a corner or
 * from its neighbour. */
const STEP = 0.1;
const SMALLEST = 0.4;
const CLEAR = 0.5;

/** A wall in its block's own frame, as the pv crate's `Wall::run`. */
interface Run {
  readonly left: readonly [number, number];
  readonly along: readonly [number, number];
  readonly out: readonly [number, number];
  readonly length: number;
}

export function run({ width, depth }: Pick<Block, "width" | "depth">, wall: Wall): Run {
  const runs: Readonly<Record<Wall, Run>> = {
    front: { left: [0, depth], along: [1, 0], out: [0, 1], length: width },
    right: { left: [width, depth], along: [0, -1], out: [1, 0], length: depth },
    back: { left: [width, 0], along: [-1, 0], out: [0, -1], length: width },
    left: { left: [0, 0], along: [0, 1], out: [-1, 0], length: depth },
  };

  return runs[wall];
}

const door = (kind: OpeningKind): boolean => kind === "frontDoor" || kind === "garageDoor";

const sillOf = (opening: Opening): number => opening.sill ?? 0;

function overlaps(a: Opening, b: Opening): boolean {
  return (
    a.block === b.block &&
    a.wall === b.wall &&
    a.along < b.along + b.width &&
    b.along < a.along + a.width &&
    sillOf(a) < sillOf(b) + b.height &&
    sillOf(b) < sillOf(a) + a.height
  );
}

/** Whether `opening` is clear of every other one in the scene but the one at `index`. */
function clear(scene: Scene, opening: Opening, index: number): boolean {
  return (scene.openings ?? []).every((other, at) => at === index || !overlaps(opening, other));
}

/** `opening` kept on its wall and under its eave, a door on the ground; null where its wall is
 * too short or too low for it, or it names no walled block. */
function kept(scene: Scene, opening: Opening): Opening | null {
  const block = scene.blocks[opening.block];

  if (block === undefined || block.open === true) return null;

  const { length } = run(block, opening.wall);
  const sill = door(opening.kind) ? 0 : clamp(sillOf(opening), 0, block.eave - SMALLEST);
  const [width, height] = [Math.max(opening.width, SMALLEST), Math.max(opening.height, SMALLEST)];

  if (width > length || sill < 0) return null;

  return {
    ...opening,
    sill,
    width: snap(width, 0.01),
    height: snap(Math.min(height, block.eave - sill), 0.01),
    along: snap(clamp(opening.along, 0, length - width), 0.01),
  };
}

/** The scene with opening `index` changed, kept on its wall; null where the change cannot be:
 * over another opening, or on a wall too short. */
export function refit(scene: Scene, index: number, change: Partial<Opening>): Scene | null {
  const openings = scene.openings ?? [];
  const before = openings[index];
  const after = before && kept(scene, { ...before, ...change });

  if (after === undefined || after === null || !clear(scene, after, index)) return null;

  return { ...scene, openings: openings.with(index, after) };
}

/** `sized` in the first place from its wall's left end that is clear of every other opening,
 * with a hand's breadth to spare. */
function placed(scene: Scene, sized: Opening, length: number): Opening | undefined {
  const places = Math.floor((length - CLEAR * 2 - sized.width) / STEP + 1e-9) + 1;

  return Array.from({ length: Math.max(0, places) }, (_, i) => snap(CLEAR + i * STEP, STEP))
    .map((along): Opening => Object.assign({}, sized, { along }))
    .find((at) =>
      clear(scene, { ...at, along: at.along - STEP * 2, width: sized.width + STEP * 4 }, -1),
    );
}

/** A new opening of `kind` in its usual size, in the first free place on a walled block: a wall
 * at a time from the front, each from its left end; null when none takes it. */
export function fresh(scene: Scene, kind: OpeningKind): Opening | null {
  const walls = scene.blocks.flatMap((block, index) =>
    block.open === true ? [] : WALLS.map((wall) => ({ block, index, wall })),
  );

  for (const { block, index, wall } of walls) {
    const sized = kept(scene, { kind, block: index, wall, along: 0, ...USUAL[kind] });
    const found = sized === null ? undefined : placed(scene, sized, run(block, wall).length);

    if (found !== undefined) return found;
  }

  return null;
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

/** A wall in the scene's frame. */
export interface OnWall {
  /** The point `along` it at `height`, `off` metres out. */
  readonly at: (along: number, height: number, off?: number) => Triple;
  /** A metre along it to the right, seen from outside, and its outward normal. */
  readonly right: Triple;
  readonly out: Triple;
}

/** Where an opening's wall stands in the scene's frame: a point `along` it at `height`, a metre
 * along it to the right, and its outward normal. */
export function onWall(block: Block, wall: Wall): OnWall {
  const {
    left,
    along: [du, dw],
    out: [nu, nw],
  } = run(block, wall);

  const turned = (u: number, w: number): [number, number] => turn(u, w, block.rotation);
  const [rx, rz] = turned(du, dw);
  const [ox, oz] = turned(nu, nw);

  return {
    at: (along, height, off = 0) => {
      const [x, z] = turned(left[0] + du * along + nu * off, left[1] + dw * along + nw * off);

      return [block.x + x, height, block.z + z];
    },
    right: [rx, 0, rz],
    out: [ox, 0, oz],
  };
}

const dot = (a: Triple, b: Triple): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** What a grip changes by a drag of `across` metres along the wall and `up` metres. */
const GRIPS = {
  move: (opening: Opening, across: number) => ({ along: snap(opening.along + across, STEP) }),
  width: (opening: Opening, across: number) => ({ width: snap(opening.width + across, STEP) }),
  height: (opening: Opening, _: number, up: number) => ({
    height: snap(opening.height + up, STEP),
  }),
} as const;

export type OpeningGrip = keyof typeof GRIPS;

/**
 * What dragging opening `index` by `grip` from the ray that grabbed it to the pointer's ray now
 * makes of the scene, both in three.js's frame: it slides in its wall's plane, snapped to 10 cm.
 * Null where a ray misses the wall or the opening would lie over another.
 */
export function slide(
  scene: Scene,
  index: number,
  grip: OpeningGrip,
  grab: Ray,
  now: Ray,
): Dragged | null {
  const opening = scene.openings?.[index];
  const block = opening && scene.blocks[opening.block];

  if (opening === undefined || block === undefined) return null;

  const wall = onWall(block, opening.wall);
  const origin = wall.at(opening.along, sillOf(opening));
  const [from, to] = [grab, now].map((ray) => meet(inScene(scene.north, ray), origin, wall.out));

  if (from === undefined || to === undefined || from === null || to === null) return null;

  const moved: Triple = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const change = GRIPS[grip](opening, dot(moved, wall.right), moved[1]);
  const next = refit(scene, index, change);
  const value = next?.openings?.[index]?.[grip === "move" ? "along" : grip];

  return next === null || value === undefined ? null : { scene: next, value: [value], unit: "m" };
}
