// The builder inspector's levels and what a click in 3D drills it to (ADR 20). Pure.
import type { Point, Scene } from "./pv.ts";
import type { Hit } from "./scene.ts";

/** The inspector's root groups. */
export type Section = "buildings" | "surroundings" | "equipment" | "modules" | "strings";

/** Where the inspector stands: the root, a group, one object, or a face's module-grid editor. */
export type Level =
  | { readonly kind: "root" }
  | { readonly kind: "section"; readonly section: Section }
  | {
      readonly kind: "block" | "obstacle" | "marker" | "place" | "string";
      readonly index: number;
    }
  | { readonly kind: "face"; readonly block: number; readonly face: number };

const SECTIONS: Readonly<Record<Exclude<Level["kind"], "root" | "section">, Section>> = {
  block: "buildings",
  obstacle: "surroundings",
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

/** The pv crate's `turn`: clockwise seen from above, where forward is −z. */
function turn(x: number, z: number, degrees: number): readonly [number, number] {
  const radians = (degrees * Math.PI) / 180;
  const [sin, cos] = [Math.sin(radians), Math.cos(radians)];

  return [x * cos - z * sin, x * sin + z * cos];
}

/** A rectangle on the ground: a block's or a box's. */
type Footprint = Readonly<Record<"x" | "z" | "width" | "depth" | "rotation", number>>;

/** Whether scene point `x`, `z` lies on the footprint. */
function within([x, z]: readonly [number, number], footprint: Footprint): boolean {
  const [u, w] = turn(x - footprint.x, z - footprint.z, -footprint.rotation);

  return u >= -EDGE && u <= footprint.width + EDGE && w >= -EDGE && w <= footprint.depth + EDGE;
}

/** The object at a point of the scene's surfaces, obstacles before the blocks they stand by. */
function at(scene: Scene, [east, north]: Point): Level | null {
  const point = turn(east, -north, -scene.north);

  const obstacle = scene.obstacles.findIndex((item) =>
    item.kind === "box"
      ? within(point, item)
      : Math.hypot(point[0] - item.x, point[1] - item.z) <= item.radius + EDGE,
  );

  if (obstacle >= 0) return { kind: "obstacle", index: obstacle };

  const block = scene.blocks.findIndex((item) => within(point, item));

  return block >= 0 ? { kind: "block", index: block } : null;
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
