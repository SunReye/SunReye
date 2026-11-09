// Module placement on the roof faces' grids and string painting (ADR 20). Pure: each edit
// returns a new scene; the pv crate decides what fits.
import type { StringDraft } from "../api/core.ts";
import type { Cell, CellPlace, Equipment, ModuleGrid, Scene } from "./pv.ts";
import { nextBlock } from "./draft.ts";
import type { Panel } from "./scene.ts";

/** What the builder edits and saves: the scene and the strings its modules are painted into. */
export interface Draft {
  readonly scene: Scene;
  readonly strings: readonly Readonly<StringDraft>[];
}

/** One gable house and no strings. */
export function emptyDraft(): Draft {
  return { scene: { north: 0, blocks: [nextBlock([])], obstacles: [], grids: [] }, strings: [] };
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

/** The tool's effect on one cell of grid `index`. */
export function apply(scene: Scene, index: number, at: At, tool: Tool): Scene {
  return withGrids(scene, (grids) =>
    grids.map((grid, i) =>
      i === index ? changed(grid, { modules: edit(grid.modules, at, tool) }) : grid,
    ),
  );
}

function edit(modules: readonly Cell[], { row, column }: At, tool: Tool): Cell[] {
  const at = modules.findIndex((cell) => cell.row === row && cell.column === column);
  const cell = modules[at];

  if (cell === undefined) {
    if (tool.kind === "optimizer") return [...modules];

    return [...modules, assigned({ row, column, optimized: false }, tool)];
  }

  if (tool.kind === "place") return modules.toSpliced(at, 1);

  return modules.with(
    at,
    tool.kind === "paint"
      ? assigned(cell, tool)
      : { ...cell, optimized: !(cell.optimized ?? false) },
  );
}

function assigned({ row, column, optimized }: Cell, tool: Tool): Cell {
  const string = tool.kind === "paint" ? tool.string : undefined;

  const kept = optimized ?? false;

  return string === undefined
    ? { row, column, optimized: kept }
    : { row, column, string, optimized: kept };
}

/** The scene without block `index`: its grids and equipment go, later blocks' follow it down. */
export function withoutBlock(scene: Scene, index: number): Scene {
  const equipment = scene.equipment
    ?.filter((marker) => marker.block !== index)
    .map((marker) => (marker.block > index ? onBlock(marker, marker.block - 1) : marker));

  const blocks = scene.blocks.toSpliced(index, 1);

  return withGrids(
    equipment === undefined ? { ...scene, blocks } : { ...scene, blocks, equipment },
    (grids) =>
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

          if (string === index) return assigned(cell, { kind: "place" });

          return string !== undefined && string > index
            ? assigned(cell, { kind: "paint", string: string - 1 })
            : cell;
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

function onBlock(marker: Equipment, block: number): Equipment {
  return { ...marker, block };
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

/** Each placed module whose cell the crate laid out, to draw. */
export function panels(scene: Scene, cells: readonly (readonly CellPlace[] | null)[]): Panel[] {
  return (scene.grids ?? []).flatMap((grid, i) =>
    grid.modules.flatMap(({ row, column, string }) => {
      const cell = cells[i]?.find((place) => place.row === row && place.column === column);

      return cell === undefined ? [] : [{ corners: cell.corners, string: string ?? null }];
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
