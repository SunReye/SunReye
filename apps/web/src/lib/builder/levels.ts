// The builder inspector's levels and what a click in 3D drills it to (ADR 20). Pure.
import { roofFaceKey, type RoofFaceId } from "@sunreye/scene";
import type {
  Block,
  FencePoint,
  GridModule,
  LaidGrid,
  Modules,
  Point,
  Pv,
  RoofFace,
  Scene,
} from "./pv.ts";
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
        | "roofWindow"
        | "opening"
        | "obstacle"
        | "surface"
        | "fence"
        | "marker"
        | "place"
        | "string";
      readonly index: number;
    }
  | { readonly kind: "face"; readonly block: number; readonly face: number }
  /** One module on a face, by its position in the face's grid. */
  | {
      readonly kind: "module";
      readonly block: number;
      readonly face: number;
      readonly module: number;
    };

const SECTIONS: Readonly<Record<Exclude<Level["kind"], "root" | "section">, Section>> = {
  block: "buildings",
  chimney: "buildings",
  roofWindow: "buildings",
  opening: "buildings",
  obstacle: "surroundings",
  surface: "surroundings",
  fence: "surroundings",
  marker: "equipment",
  place: "equipment",
  face: "modules",
  module: "modules",
  string: "strings",
};

/** An object that shows handles in 3D (ADR 20). */
export type Handled = Extract<Level, { index: number }> & {
  readonly kind: Exclude<Extract<Level, { index: number }>["kind"], "marker" | "string">;
};

const UNHANDLED = new Set<Level["kind"]>(["root", "section", "face", "module", "marker", "string"]);

/** Whether `level` is an object with handles to drag. */
export function handled(level: Level): level is Handled {
  return !UNHANDLED.has(level.kind);
}

/** The level its back button returns to. */
export function parent(level: Level): Level {
  if (level.kind === "root" || level.kind === "section") return { kind: "root" };

  if (level.kind === "module") return { kind: "face", block: level.block, face: level.face };

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

/** The index of the obstacle under scene point `x`, `z`; −1 for none. */
function obstacleAt(scene: Scene, point: readonly [number, number]): number {
  return scene.obstacles.findIndex((item) => {
    if (item.kind === "box") return within(point, item);

    if (item.kind === "hedge") return within(point, { ...item, width: item.length });

    return Math.hypot(point[0] - item.x, point[1] - item.z) <= item.radius + EDGE;
  });
}

/** The object of kind `kind` at `index`; null for −1, none. */
function indexed(kind: Extract<Level, { index: number }>["kind"], index: number): Level | null {
  return index >= 0 ? { kind, index } : null;
}

/** The crate, which finds what a strike lands on: a chimney, a roof window or a grid's face. */
type Finder = Pick<Pv, "chimneyAt" | "roofWindowAt" | "gridAt"> | undefined;

/** The face whose grid a strike at `point` lands on, inside its setback. */
function faceAt(scene: Scene, pv: Finder, point: Point): Level | null {
  // No grid, no question to the crate.
  const index = (scene.grids?.length ?? 0) > 0 ? (pv?.gridAt(scene, point) ?? null) : null;
  const grid = index === null ? undefined : scene.grids?.[index];

  return grid ? { kind: "face", block: grid.block, face: grid.face } : null;
}

/** The object at a point: a chimney on its roof, a roof window, a grid's face inside its setback, what stands before the
 * blocks it stands by, a car place before the roof over it, the ground last, the latest surface
 * first as it is drawn over the others. */
function at(scene: Scene, pv: Finder, [east, north, up]: Point): Level | null {
  const point = turn(east, -north, -scene.north);

  // The first finder that finds wins.
  const finders: readonly (() => Level | null)[] = [
    () =>
      indexed(
        "chimney",
        // No chimney, no question to the crate.
        (scene.chimneys?.length ?? 0) > 0 ? (pv?.chimneyAt(scene, [east, north, up]) ?? -1) : -1,
      ),
    () =>
      indexed(
        "roofWindow",
        (scene.roofWindows?.length ?? 0) > 0
          ? (pv?.roofWindowAt(scene, [east, north, up]) ?? -1)
          : -1,
      ),
    () => faceAt(scene, pv, [east, north, up]),
    () => indexed("obstacle", obstacleAt(scene, point)),
    () =>
      indexed(
        "fence",
        (scene.fences ?? []).findIndex(({ points }) =>
          points.some((to, i) => i > 0 && distance(point, points[i - 1] ?? to, to) <= NEAR),
        ),
      ),
    () => indexed("place", up < CAR ? placed(scene, point) : -1),
    () =>
      indexed(
        "block",
        scene.blocks.findIndex((item) => within(point, item, reach(item))),
      ),
    () =>
      indexed(
        "surface",
        (scene.surfaces ?? []).findLastIndex((item) => within(point, item)),
      ),
  ];

  for (const find of finders) {
    const level = find();

    if (level !== null) return level;
  }

  return null;
}

/** The level a click in 3D drills the inspector to; null for open ground. The crate `pv` finds a
 * chimney and a grid's face. */
export function picked(
  scene: Scene,
  hit: Hit,
  pv?: Pick<Pv, "chimneyAt" | "roofWindowAt" | "gridAt">,
): Level | null {
  if (hit.kind === "equipment") return { kind: "marker", index: hit.index };

  if (hit.kind === "opening") return { kind: "opening", index: hit.index };

  if (hit.kind === "point") return at(scene, pv, hit.point);

  const grid = scene.grids?.[hit.grid];

  return grid === undefined ? null : { kind: "face", block: grid.block, face: grid.face };
}

/** How deep a level lies: the root 0, a group 1, an object or a face 2, a face's module 3. */
export function depth(level: Level): number {
  if (level.kind === "root") return 0;

  if (level.kind === "module") return 3;

  return level.kind === "section" ? 1 : 2;
}

/** The module a module level names, and its grid's position in the scene. */
export function moduleOf(
  scene: Scene,
  { block, face, module }: Extract<Level, { kind: "module" }>,
): { readonly grid: number; readonly module: number; readonly laid: GridModule } | undefined {
  const grid = (scene.grids ?? []).findIndex((item) => item.block === block && item.face === face);
  const laid = scene.grids?.[grid]?.modules[module];

  return laid === undefined ? undefined : { grid, module, laid };
}

/** The position in the scene of the grid on `face`; −1 for none. */
export function gridOn(scene: Readonly<Scene>, face: RoofFaceId): number {
  return (scene.grids ?? []).findIndex((grid) => roofFaceKey(grid) === roofFaceKey(face));
}

/** A selected face's or module's grid: its position in the scene, how the crate laid it out, and
 * the selected module's footprint; null for a face without a grid or its module type. */
export function faceGrid(
  scene: Readonly<Scene>,
  { grids }: Readonly<Pick<Modules, "grids">>,
  level: Extract<Level, { kind: "face" | "module" }>,
): {
  readonly grid: number;
  readonly shade: LaidGrid;
  readonly selected: LaidGrid["modules"][number] | undefined;
} | null {
  const grid = gridOn(scene, level);

  const shade = grids[grid];

  if (shade === undefined || shade === null) return null;

  return {
    grid,
    shade,
    selected: level.kind === "module" ? shade.modules[level.module] : undefined,
  };
}

/** The roof face whose modules `level` lays, if it is a face's or a module's level. */
export function laying(roofs: readonly RoofFace[], level: Level): RoofFace | undefined {
  return level.kind === "face" || level.kind === "module"
    ? roofs.find((roof) => roofFaceKey(roof) === roofFaceKey(level))
    : undefined;
}
