// Modules on the roof faces and their wiring into strings (ADR 20). Pure: each edit returns a new scene; the
// pv crate decides where a module lies and what fits.
import type { CatalogueSheet, Datasheet, ModuleType, Problem, StringDraft } from "../api/core.ts";
import type { GridModule, LaidGrid, ModuleGrid, Scene } from "./pv.ts";
import { following, ordered } from "./wiring.ts";
import { withOpenings } from "./wall-openings.ts";
import type { Panel } from "./scene.ts";

/** What the builder edits and saves: the scene and the strings its modules are wired into. */
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

/** Grid `index` without its modules. */
export function clearGrid(scene: Scene, index: number): Scene {
  return withGrids(scene, (grids) =>
    grids.map((grid, i) => (i === index ? changed(grid, { modules: [] }) : grid)),
  );
}

export function removeGrid(scene: Scene, index: number): Scene {
  return withGrids(scene, (grids) => grids.toSpliced(index, 1));
}

/** Where a face's module types come from: the core, or a test's fake. */
export interface TypeSource {
  /** Adds a module type to the core. */
  addModuleType(datasheet: Readonly<Datasheet>): Promise<ModuleType | Problem>;
  /** The module catalogue's sheets. */
  moduleCatalogue(): Promise<readonly CatalogueSheet[] | Problem>;
}

/** Whether a module is in no string: it produces nothing. */
export const inNoString = (module: Pick<GridModule, "string">): boolean =>
  (module.string ?? undefined) === undefined;

/** Module `module` of grid `index` wired into string `string`, after the modules it holds; in no
 * string without one. Wiring it into its own string again changes nothing. */
export function wire(scene: Scene, index: number, module: number, string?: number): Scene {
  const next = following(scene, string);

  return withModules(scene, index, (modules) => {
    const before = modules[module];

    return before === undefined
      ? modules
      : modules.with(module, ordered(before, assigned(before, string), next));
  });
}

/** Module `module` of grid `index` with or without an optimizer. */
export function optimize(scene: Scene, index: number, module: number, on: boolean): Scene {
  return withModules(scene, index, (modules) => {
    const before = modules[module];

    return before === undefined ? modules : modules.with(module, { ...before, optimized: on });
  });
}

function assigned({ across, up, landscape, optimized }: GridModule, string?: number): GridModule {
  const kept = { across, up, landscape, optimized: optimized ?? false };

  return string === undefined ? kept : { ...kept, string };
}

/** Whether wiring into grid `index` is refused: a string of another module type than the grid,
 * as the core refuses it on save (ADR 20). */
export function refuses(draft: Draft, index: number, string: number): boolean {
  const grid = draft.scene.grids?.[index];

  return grid !== undefined && draft.strings[string]?.moduleType !== grid.moduleType;
}

/** Grid `index` filled: a module in the grid's orientation at each place the crate found free. */
export function fillGrid(
  scene: Scene,
  index: number,
  places: readonly (readonly [number, number])[],
): Scene {
  const landscape = scene.grids?.[index]?.landscape ?? false;

  return withModules(scene, index, (modules) => [
    ...modules,
    ...places.map(([across, up]) => ({ across, up, landscape, optimized: false })),
  ]);
}

/** The scene without block `index`: its grids, chimneys, roof windows and equipment go, later
 * blocks' follow it down. */
export function withoutBlock(scene: Scene, index: number): Scene {
  const equipment = scene.equipment
    ?.filter((marker) => marker.block !== index)
    .map((marker) => (marker.block > index ? onBlock(marker, marker.block - 1) : marker));

  const chimneys = scene.chimneys
    ?.filter((item) => item.block !== index)
    .map((item) => (item.block > index ? onBlock(item, item.block - 1) : item));

  const windows = scene.roofWindows
    ?.filter((item) => item.block !== index)
    .map((item) => (item.block > index ? onBlock(item, item.block - 1) : item));

  const blocks = scene.blocks.toSpliced(index, 1);
  const walled = withOpenings(scene, index);
  const glazed = windows === undefined ? walled : { ...walled, roofWindows: windows };
  const kept = chimneys === undefined ? { ...glazed, blocks } : { ...glazed, blocks, chimneys };

  return withGrids(equipment === undefined ? kept : { ...kept, equipment }, (grids) =>
    grids
      .filter((grid) => grid.block !== index)
      .map((grid) => (grid.block > index ? changed(grid, { block: grid.block - 1 }) : grid)),
  );
}

/** The scene without the modules a roof chimney or roof window covers, as the crate names them: each its
 * grid's index and its own in it. The same scene where it stands on none. */
export function uncovered(scene: Scene, covered: readonly (readonly [number, number])[]): Scene {
  if (covered.length === 0) return scene;

  return withGrids(scene, (grids) =>
    grids.map((grid, i) =>
      changed(grid, {
        modules: grid.modules.filter(
          (_, module) => !covered.some(([g, at]) => g === i && at === module),
        ),
      }),
    ),
  );
}

/** The scene without string `index`: its modules stay unassigned, later strings follow it down. */
export function withoutString(scene: Scene, index: number): Scene {
  return withGrids(scene, (grids) =>
    grids.map((grid) =>
      changed(grid, {
        modules: grid.modules.map((module) => {
          const string = module.string ?? undefined;

          if (string === index) return assigned(module);

          return string !== undefined && string > index
            ? { ...module, string: string - 1 }
            : module;
        }),
      }),
    ),
  );
}

/** What a string is made of in the scene. */
export interface WiredIn {
  readonly modules: number;
  readonly optimized: number;
}

/** How many modules are wired into string `index`, and how many of them are optimized. */
export function wiredIn(scene: Scene, index: number): WiredIn {
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

export function withModules(
  scene: Scene,
  index: number,
  change: (modules: readonly GridModule[]) => readonly GridModule[],
): Scene {
  return withGrids(scene, (grids) =>
    grids.map((grid, i) => (i === index ? changed(grid, { modules: change(grid.modules) }) : grid)),
  );
}

/** Each module the crate laid out, to draw, with the grid it lies in and its position there. */
export function panels(scene: Scene, laid: readonly (LaidGrid | null)[]): Panel[] {
  return (scene.grids ?? []).flatMap((grid, i) =>
    grid.modules.flatMap(({ string }, module) => {
      const footprint = laid[i]?.modules[module];

      return footprint === undefined
        ? []
        : [{ corners: footprint.corners, string: string ?? null, grid: i, module }];
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
