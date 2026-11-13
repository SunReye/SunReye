// The builder inspector's levels and what a click in 3D drills it to (ADR 20). Pure.
import type { Block, FencePoint, Point, Scene } from "./pv.ts";
import type { Hit } from "./scene.ts";

/** The inspector's root groups. */
export type Section = "buildings" | "surroundings" | "equipment" | "modules" | "strings";

/** Where the inspector stands: the root, a group, one object, or a face's module-grid editor. */
export type Level =
  | { readonly kind: "root" }
  | { readonly kind: "section"; readonly section: Section }
  | {
      readonly kind:
        | "block"
        | "chimney"
        | "obstacle"
        | "surface"
        | "fence"
        | "marker"
        | "place"
        | "string";
      readonly index: number;
    }
  | { readonly kind: "face"; readonly block: number; readonly face: number };

const SECTIONS: Readonly<Record<Exclude<Level["kind"], "root" | "section">, Section>> = {
  block: "buildings",
  chimney: "buildings",
  obstacle: "surroundings",
  surface: "surroundings",
  fence: "surroundings",
  marker: "equipment",
  place: "equipment",
  face: "modules",
  string: "strings",
};

/** The level its back button returns to. */
export function parent(level: Level): Level {
  if (level.kind === "root" || level.kind === "section") return { kind: "root" };

  return { kind: "section", section: SECTIONS[level.kind] };
}

/** Lines drawn on a footprint's edge still count as on it, in metres. */
const EDGE = 0.05;

/** A click this close to a fence's line, in metres, strikes it. */
const NEAR = 0.3;

/** A car stands below this, in metres: a strike higher over its place lands on the roof above. */
const CAR = 2;

/** The pv crate's `turn`: clockwise seen from above, where forward is −z. */
function turn(x: number, z: number, degrees: number): readonly [number, number] {
  const radians = (degrees * Math.PI) / 180;
  const [sin, cos] = [Math.sin(radians), Math.cos(radians)];

  return [x * cos - z * sin, x * sin + z * cos];
}

/** A rectangle on the ground: a block's or a box's. */
type Footprint = Readonly<Record<"x" | "z" | "width" | "depth" | "rotation", number>>;

/** Whether scene point `x`, `z` lies on the footprint, grown by `across` and `deep` metres. */
function within(
  [x, z]: readonly [number, number],
  footprint: Footprint,
  [across, deep]: readonly [number, number] = [0, 0],
): boolean {
  const [u, w] = turn(x - footprint.x, z - footprint.z, -footprint.rotation);
  const [side, end] = [across + EDGE, deep + EDGE];

  return u >= -side && u <= footprint.width + side && w >= -end && w <= footprint.depth + end;
}

/** How far a block's roof reaches past its walls across and along its depth, as the crate
 * widens it: a flat or hip roof by its eave overhang all round. */
function reach({ overhang, roof }: Block): readonly [number, number] {
  const { eave, verge } = overhang ?? { eave: 0, verge: 0 };

  return [roof.kind === "flat" || roof.kind === "hip" ? eave : verge, eave];
}

/** How far scene point `p` lies from the segment from `a` to `b`. */
function distance(
  [px, pz]: readonly [number, number],
  { x: ax, z: az }: FencePoint,
  { x: bx, z: bz }: FencePoint,
): number {
  const [dx, dz] = [bx - ax, bz - az];
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));

  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

/** The index of the car place under scene point `x`, `z`; −1 for none. */
function placed(scene: Scene, point: readonly [number, number]): number {
  return (scene.carPlaces ?? []).findIndex((item) =>
    within(point, { ...item, depth: item.length }),
  );
}

/** The object at a point: what stands before the blocks it stands by, a car place before the
 * roof over it, the ground last, the latest surface first as it is drawn over the others. */
function at(scene: Scene, [east, north, up]: Point): Level | null {
  const point = turn(east, -north, -scene.north);

  const obstacle = scene.obstacles.findIndex((item) => {
    if (item.kind === "box") return within(point, item);

    if (item.kind === "hedge") return within(point, { ...item, width: item.length });

    return Math.hypot(point[0] - item.x, point[1] - item.z) <= item.radius + EDGE;
  });

  if (obstacle >= 0) return { kind: "obstacle", index: obstacle };

  const fence = (scene.fences ?? []).findIndex(({ points }) =>
    points.some((to, i) => i > 0 && distance(point, points[i - 1] ?? to, to) <= NEAR),
  );

  if (fence >= 0) return { kind: "fence", index: fence };

  const place = up < CAR ? placed(scene, point) : -1;

  if (place >= 0) return { kind: "place", index: place };

  const block = scene.blocks.findIndex((item) => within(point, item, reach(item)));

  if (block >= 0) return { kind: "block", index: block };

  const surface = (scene.surfaces ?? []).findLastIndex((item) => within(point, item));

  return surface >= 0 ? { kind: "surface", index: surface } : null;
}

/** The level a click in 3D drills the inspector to; null for open ground. */
export function picked(scene: Scene, hit: Hit): Level | null {
  if (hit.kind === "equipment") return { kind: "marker", index: hit.index };

  if (hit.kind === "point") return at(scene, hit.point);

  const grid = scene.grids?.[hit.grid];

  return grid === undefined ? null : { kind: "face", block: grid.block, face: grid.face };
}

/** How deep a level lies: the root 0, a group 1, an object or a face 2. */
export function depth(level: Level): number {
  if (level.kind === "root") return 0;

  return level.kind === "section" ? 1 : 2;
}
