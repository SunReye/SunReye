// A wall spot (ADR 20): where a tap struck a block's wall, and what is added there. The crate keeps
// an opening on its wall and says where a marker hangs; nothing here knows a wall's length. Pure.
import type { Equipment, Modules, OpeningKind, Point, Pv, Scene, Unfit, Wall } from "./pv.ts";
import { snap, tidy } from "./handles/frame.ts";
import { refit, USUAL } from "./wall-openings.ts";

export interface WallSpot {
  readonly block: number;
  readonly wall: Wall;
  /** Metres from the wall's left end, seen from outside, and up from the ground. */
  readonly along: number;
  readonly height: number;
  /** The point struck: east, north, up. */
  readonly at: Point;
}

interface Found {
  readonly wall: Wall;
  readonly off: number;
  readonly along: number;
}

/** Metres a struck point may stand off a wall's plane and still be on it. */
const ON = 0.05;

/** A struck point to the millimetre: a ray's hit carries noise far below it. */
const milli = (value: number): number => tidy(Math.round(value * 1000) / 1000);

/** Metres: the handles' step. */
const STEP = 0.1;

/** The spot `point` (east, north, up) is on a wall of block `block`; none off its walls, as on
 * its roof. */
export function spotAt(walls: Modules["walls"], block: number, point: Point): WallSpot | undefined {
  const frames: Partial<Record<Wall, Modules["walls"][number][Wall]>> = walls[block] ?? {};

  const found = (["front", "right", "back", "left"] as const).flatMap((wall): Found[] => {
    const frame = frames[wall];

    if (frame === undefined) return [];

    const [east, north] = [point[0] - frame.left[0], point[1] - frame.left[1]];
    const off = Math.abs(east * frame.out[0] + north * frame.out[1]);
    const along = east * frame.right[0] + north * frame.right[1];

    return off <= ON && along >= 0 ? [{ wall, off, along }] : [];
  });

  const [nearest] = found.toSorted((a: Readonly<Found>, b: Readonly<Found>) => a.off - b.off);

  return (
    nearest && {
      block,
      wall: nearest.wall,
      along: milli(nearest.along),
      height: milli(point[2]),
      at: point,
    }
  );
}

/** The scene with a new opening of `kind`, in its usual size, its middle at `spot` along the wall:
 * a window's middle at the spot's height too where the wall takes it there, else at its usual
 * sill. The crate keeps it on its wall; why not, where it lies over another or the wall has no
 * room. */
export function openingAt(
  pv: Pick<Pv, "refit">,
  scene: Scene,
  spot: WallSpot,
  kind: OpeningKind,
): Scene | { readonly unfit: Unfit } {
  const usual = USUAL[kind];
  const openings = scene.openings ?? [];
  const along = tidy(Math.max(0, snap(spot.along - usual.width / 2, STEP)));
  const raised = tidy(Math.max(0, snap(spot.height - usual.height / 2, STEP)));
  const made = { kind, block: spot.block, wall: spot.wall, along, ...usual };
  const added = { ...scene, openings: [...openings, made] };

  const count = openings.length;

  // A door stands on the ground.
  if (kind !== "window") return refit(pv, added, count, {});

  const lifted = refit(pv, added, count, { sill: raised });

  // Over another opening there: said, not mended by moving it elsewhere.
  if ("unfit" in lifted) return lifted;

  const kept = lifted.openings?.[count];

  // As tall as usual at the height asked, the crate cut nothing off it under the eave; cut, it
  // goes at its usual sill instead.
  return kept?.sill === raised && kept.height === usual.height
    ? lifted
    : refit(pv, added, count, {});
}

/** The scene with a marker of `kind` for `device` at `spot` along its wall, outside; why not,
 * where the crate finds it no place there. */
export function markerAt(
  pv: Pick<Pv, "geometry">,
  scene: Scene,
  spot: WallSpot,
  { kind, device }: Pick<Equipment, "kind" | "device">,
): Scene | { readonly unfit: Unfit } {
  const marker: Equipment = {
    device,
    kind,
    block: spot.block,
    wall: spot.wall,
    along: snap(spot.along, STEP),
    inside: false,
  };

  // Judged alone: the crate answers for all markers at once, and another off its wall is not
  // this one's fault, nor its excuse.
  const alone = pv.geometry({ ...scene, equipment: [marker] }).mounts ?? null;

  return alone === null
    ? { unfit: "room" }
    : { ...scene, equipment: [...(scene.equipment ?? []), marker] };
}
