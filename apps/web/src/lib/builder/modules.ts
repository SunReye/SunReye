// Module placement on the roof faces' grids and string painting (ADR 20). Pure: each edit
// returns a new scene; the pv crate decides what fits.
import type { CatalogueSheet, Datasheet, ModuleType, Problem, StringDraft } from "../api/core.ts";
import type { Cell, CellPlace, ModuleGrid, Scene } from "./pv.ts";
import type { Panel } from "./scene.ts";

/** What the builder edits and saves: the scene and the strings its modules are painted into. */
export interface Draft {
  readonly scene: Scene;
  readonly strings: readonly Readonly<StringDraft>[];
}

/** No block and no strings: the builder then offers templates. */
export function emptyDraft(): Draft {
  return { scene: { north: 0, blocks: [], obstacles: [], grids: [] }, strings: [] };
}

/** A new string's wiring, soiling and mismatch loss, in %. */
const LOSS = 2;

/** Metres kept free along a new grid's edges. */
const SETBACK = 0.3;

/** What a click on a cell does. */
export type Tool =
  | { readonly kind: "place" }
  /** Into a string by its position in the layout, or unassigned without one. */
  | { readonly kind: "paint"; readonly string?: number }
  | { readonly kind: "optimizer" };

export interface At {
  readonly row: number;
  readonly column: number;
}

/** A grid of portrait modules of `moduleType` on a block's roof face. */
export function addGrid(scene: Scene, block: number, face: number, moduleType: number): Scene {
  const grid: ModuleGrid = {
    block,
    face,
    moduleType,
    landscape: false,
    setback: SETBACK,
    modules: [],
  };

  return { ...scene, grids: [...(scene.grids ?? []), grid] };
}

export function editGrid(
  scene: Scene,
  index: number,
  fields: Partial<Pick<ModuleGrid, "moduleType" | "landscape" | "setback">>,
): Scene {
  return withGrids(scene, (grids) =>
    grids.map((grid, i) => (i === index ? changed(grid, fields) : grid)),
  );
}

export function removeGrid(scene: Scene, index: number): Scene {
  return withGrids(scene, (grids) => grids.toSpliced(index, 1));
}

/** Where a drag's steps go: each shown at once, the drag recorded as one undo step once let go. */
/** Where a face's module types come from: the core, or a test's fake. */
export interface TypeSource {
  /** Adds a module type to the core. */
  addModuleType(datasheet: Readonly<Datasheet>): Promise<ModuleType | Problem>;
  /** The module catalogue's sheets. */
  moduleCatalogue(): Promise<readonly CatalogueSheet[] | Problem>;
}

export interface Strokes {
  readonly drag: (scene: Scene) => void;
  readonly drop: () => void;
}

/** What a drag does to every cell it crosses, as the cell it started on decides (ADR 20). */
export type Stroke =
  | { readonly kind: "place"; readonly erase: boolean }
  /** Into a string, or unassigned without one; erasing unassigns. */
  | { readonly kind: "paint"; readonly string?: number; readonly erase: boolean }
  | { readonly kind: "optimizer"; readonly on: boolean };

function cellAt(scene: Scene, index: number, { row, column }: At): Cell | undefined {
  return scene.grids?.[index]?.modules.find((cell) => cell.row === row && cell.column === column);
}

/** The stroke the tool starts on a cell of grid `index`: it toggles that cell. */
export function strokeOf(scene: Scene, index: number, at: At, tool: Tool): Stroke {
  const cell = cellAt(scene, index, at);

  if (tool.kind === "place") return { kind: "place", erase: cell !== undefined };

  if (tool.kind === "optimizer") return { kind: "optimizer", on: cell?.optimized !== true };

  const string = tool.string;
  const into = cell !== undefined && (cell.string ?? undefined) === string;

  return string === undefined
    ? { kind: "paint", erase: false }
    : { kind: "paint", string, erase: into };
}

/** The stroke's effect on one cell of grid `index`; crossing a cell twice changes nothing more. */
export function paint(scene: Scene, index: number, at: At, stroke: Stroke): Scene {
  return withGrids(scene, (grids) =>
    grids.map((grid, i) =>
      i === index ? changed(grid, { modules: edit(grid.modules, at, stroke) }) : grid,
    ),
  );
}

/** A tap: the tool's effect on one cell of grid `index`. */
export function apply(scene: Scene, index: number, at: At, tool: Tool): Scene {
  return paint(scene, index, at, strokeOf(scene, index, at, tool));
}

function edit(modules: readonly Cell[], at: At, stroke: Stroke): Cell[] {
  const index = modules.findIndex((cell) => cell.row === at.row && cell.column === at.column);
  const next = stroked(modules[index], at, stroke);

  if (index < 0) return next === undefined ? [...modules] : [...modules, next];

  return next === undefined ? modules.toSpliced(index, 1) : modules.with(index, next);
}

/** What a stroke leaves in the cell `at`: its module, or none. */
export function stroked(
  cell: Cell | undefined,
  { row, column }: At,
  stroke: Stroke,
): Cell | undefined {
  if (stroke.kind === "place")
    return stroke.erase ? undefined : (cell ?? { row, column, optimized: false });

  if (stroke.kind === "optimizer") return cell && { ...cell, optimized: stroke.on };

  if (cell === undefined && stroke.erase) return undefined;

  return assigned(cell ?? { row, column }, stroke.erase ? undefined : stroke.string);
}

function assigned({ row, column, optimized }: Cell, string?: number): Cell {
  const kept = optimized ?? false;

  return string === undefined
    ? { row, column, optimized: kept }
    : { row, column, string, optimized: kept };
}

/** Whether painting into grid `index` is refused: a string of another module type than the grid,
 * as the core refuses it on save (ADR 20). */
export function refuses(draft: Draft, index: number, stroke: Tool | Stroke): boolean {
  const grid = draft.scene.grids?.[index];
  const string = stroke.kind === "paint" ? stroke.string : undefined;

  if (grid === undefined || string === undefined) return false;

  return draft.strings[string]?.moduleType !== grid.moduleType;
}

/** A module in every cell of grid `index` the crate laid out; painted modules keep their string. */
export function fillGrid(scene: Scene, index: number, cells: readonly At[]): Scene {
  return cells.reduce(
    (filled, at) => paint(filled, index, at, { kind: "place", erase: false }),
    scene,
  );
}

/** The scene without block `index`: its grids, chimneys and equipment go, later blocks' follow it down. */
export function withoutBlock(scene: Scene, index: number): Scene {
  const equipment = scene.equipment
    ?.filter((marker) => marker.block !== index)
    .map((marker) => (marker.block > index ? onBlock(marker, marker.block - 1) : marker));

  const chimneys = scene.chimneys
    ?.filter((item) => item.block !== index)
    .map((item) => (item.block > index ? onBlock(item, item.block - 1) : item));

  const blocks = scene.blocks.toSpliced(index, 1);
  const kept = chimneys === undefined ? { ...scene, blocks } : { ...scene, blocks, chimneys };

  return withGrids(equipment === undefined ? kept : { ...kept, equipment }, (grids) =>
    grids
      .filter((grid) => grid.block !== index)
      .map((grid) => (grid.block > index ? changed(grid, { block: grid.block - 1 }) : grid)),
  );
}

/** The scene without string `index`: its modules stay unassigned, later strings follow it down. */
export function withoutString(scene: Scene, index: number): Scene {
  return withGrids(scene, (grids) =>
    grids.map((grid) =>
      changed(grid, {
        modules: grid.modules.map((cell) => {
          const string = cell.string ?? undefined;

          if (string === index) return assigned(cell);

          return string !== undefined && string > index ? assigned(cell, string - 1) : cell;
        }),
      }),
    ),
  );
}

/** What a string is made of in the scene. */
export interface Painted {
  readonly modules: number;
  readonly optimized: number;
}

/** How many modules are painted into string `index`, and how many of them are optimized. */
export function painted(scene: Scene, index: number): Painted {
  const cells = (scene.grids ?? []).flatMap((grid) =>
    grid.modules.filter((cell) => cell.string === index),
  );

  return {
    modules: cells.length,
    optimized: cells.filter((cell) => cell.optimized === true).length,
  };
}

function onBlock<T extends { readonly block: number }>(item: T, block: number): T {
  return { ...item, block };
}

function changed(grid: ModuleGrid, fields: Partial<ModuleGrid>): ModuleGrid {
  return { ...grid, ...fields };
}

function withGrids(
  scene: Scene,
  change: (grids: readonly ModuleGrid[]) => readonly ModuleGrid[],
): Scene {
  return { ...scene, grids: change(scene.grids ?? []) };
}

/** Each placed module whose cell the crate laid out, to draw, with the grid it lies in. */
export function panels(scene: Scene, cells: readonly (readonly CellPlace[] | null)[]): Panel[] {
  return (scene.grids ?? []).flatMap((grid, i) =>
    grid.modules.flatMap(({ row, column, string }) => {
      const cell = cells[i]?.find((place) => place.row === row && place.column === column);

      return cell === undefined
        ? []
        : [{ corners: cell.corners, string: string ?? null, grid: i, row, column }];
    }),
  );
}

/** A new string named `name` of `moduleType`, wired like the first string, else to device 1's
 * first input; the scene decides its modules and plane. */
export function addString(draft: Draft, name: string, moduleType: number): Draft {
  const first = draft.strings[0];

  const string: StringDraft = {
    name,
    moduleType,
    device: first === undefined ? 1 : first.device,
    input: 1,
    modules: 0,
    optimized: 0,
    tilt: 0,
    azimuth: 0,
    loss: first === undefined ? LOSS : first.loss,
  };

  return { ...draft, strings: [...draft.strings, string] };
}
