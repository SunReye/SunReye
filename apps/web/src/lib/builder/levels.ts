// The builder inspector's levels and what a click in 3D drills it to (ADR 20). Pure.
import { cellAt } from "./cells.ts";
import { chimneyAt } from "./chimneys.ts";
import type { At } from "./modules.ts";
import type { Block, Cell, CellPlace, FencePoint, Modules, Point, RoofFace, Scene } from "./pv.ts";
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
  /** One module on a face, by its cell. */
  | {
      readonly kind: "module";
      readonly block: number;
      readonly face: number;
      readonly row: number;
      readonly column: number;
    };

const SECTIONS: Readonly<Record<Exclude<Level["kind"], "root" | "section">, Section>> = {
  block: "buildings",
  chimney: "buildings",
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

/** The face whose grid holds a cell at `point`, when the cells are known. */
function faceAt(
  scene: Scene,
  roofs: readonly RoofFace[],
  cells: Modules["grids"] | undefined,
  point: Point,
): Level | null {
  const hit = cells && cellAt(scene, { roofs, grids: cells }, point);
  const grid = hit && scene.grids?.[hit.grid];

  return grid ? { kind: "face", block: grid.block, face: grid.face } : null;
}

/** The object at a point: a chimney on its roof, a grid's cell on its face, what stands before the
 * blocks it stands by, a car place before the roof over it, the ground last, the latest surface
 * first as it is drawn over the others. */
function at(
  scene: Scene,
  roofs: readonly RoofFace[],
  cells: Modules["grids"] | undefined,
  [east, north, up]: Point,
): Level | null {
  const point = turn(east, -north, -scene.north);

  // The first finder that finds wins.
  const finders: readonly (() => Level | null)[] = [
    () => indexed("chimney", chimneyAt(scene, roofs, [east, north, up])),
    () => faceAt(scene, roofs, cells, [east, north, up]),
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

/** The level a click in 3D drills the inspector to; null for open ground. A chimney is found on
 * the laid-out `roofs`, a grid's face on its laid-out `cells`. */
export function picked(
  scene: Scene,
  hit: Hit,
  roofs: readonly RoofFace[] = [],
  cells?: Modules["grids"],
): Level | null {
  if (hit.kind === "equipment") return { kind: "marker", index: hit.index };

  if (hit.kind === "opening") return { kind: "opening", index: hit.index };

  if (hit.kind === "point") return at(scene, roofs, cells, hit.point);

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
  { block, face, row, column }: Extract<Level, { kind: "module" }>,
): { readonly grid: number; readonly cell: Cell } | undefined {
  const grid = (scene.grids ?? []).findIndex((item) => item.block === block && item.face === face);

  const cell = scene.grids?.[grid]?.modules.find(
    (item) => item.row === row && item.column === column,
  );

  return cell === undefined ? undefined : { grid, cell };
}

/** Whether two cells are the same. */
function same(a: Readonly<At>, b: Readonly<At>): boolean {
  return a.row === b.row && a.column === b.column;
}

/** A selected face's or module's grid: its position in the scene, the cells free to place a module
 * in, and the selected module's cell; null for a face without a grid. */
export function faceCells(
  scene: Readonly<Scene>,
  { grids }: Readonly<Pick<Modules, "grids">>,
  level: Extract<Level, { kind: "face" | "module" }>,
): {
  readonly grid: number;
  readonly free: readonly CellPlace[];
  readonly selected: CellPlace | undefined;
} | null {
  const grid = (scene.grids ?? []).findIndex(
    (item) => item.block === level.block && item.face === level.face,
  );

  if (grid < 0) return null;

  const modules = scene.grids?.[grid]?.modules ?? [];
  const cells = grids[grid] ?? [];

  return {
    grid,
    free: cells.filter((cell) => !modules.some((module) => same(module, cell))),
    selected: level.kind === "module" ? cells.find((cell) => same(level, cell)) : undefined,
  };
}

/** The roof face whose modules `level` lays, if it is a face's or a module's level. */
export function laying(roofs: readonly RoofFace[], level: Level): RoofFace | undefined {
  return level.kind === "face" || level.kind === "module"
    ? roofs.find((roof) => roof.block === level.block && roof.face === level.face)
    : undefined;
}
