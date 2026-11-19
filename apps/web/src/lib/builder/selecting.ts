// The wiring mode's selection (ADR 20): the modules picked on the roofs in the order they were
// crossed, and what wiring or unwiring them makes of the draft. Pure.
import { addString, inNoString, refuses, wire, type Draft } from "./modules.ts";
import type { Scene } from "./pv.ts";

/** A module by its grid's position in the scene and its own in the grid. */
export interface Cell {
  readonly grid: number;
  readonly module: number;
}

export const sameCell = (a: Cell, b: Cell): boolean => a.grid === b.grid && a.module === b.module;

/** The selection with `cell` last, or without it where it held it. */
export function toggled(selection: readonly Cell[], cell: Cell): Cell[] {
  return selection.some((held) => sameCell(held, cell))
    ? selection.filter((held) => !sameCell(held, cell))
    : [...selection, cell];
}

/** The draft with `cells` wired into string `string` in their order, after the modules it holds;
 * null where one lies in a grid of another module type, as the core refuses it on save. */
export function wiredInto(draft: Draft, cells: readonly Cell[], string: number): Draft | null {
  if (cells.some(({ grid }) => refuses(draft, grid, string))) return null;

  const scene = cells.reduce(
    (wired: Scene, { grid, module }) => wire(wired, grid, module, string),
    draft.scene,
  );

  return { ...draft, scene };
}

/** The draft with `cells` wired into a new string named `name`, of their grids' module type; null
 * where they hold none or more than one. */
export function wiredNew(draft: Draft, cells: readonly Cell[], name: string): Draft | null {
  const types = new Set(cells.map(({ grid }) => draft.scene.grids?.[grid]?.moduleType));
  const [type] = types;

  if (types.size !== 1 || type === undefined) return null;

  return wiredInto(addString(draft, name, type), cells, draft.strings.length);
}

/** The draft with `cells` in no string. */
export function unwired(draft: Draft, cells: readonly Cell[]): Draft {
  const scene = cells.reduce(
    (loose: Scene, { grid, module }) => wire(loose, grid, module),
    draft.scene,
  );

  return { ...draft, scene };
}

/** The roof face whose grid holds the most modules in no string, the first of equals; none
 * without a grid. */
export function mostUnwired(
  scene: Scene,
): { readonly block: number; readonly face: number } | undefined {
  const loose = (scene.grids ?? []).map(
    ({ modules }) => modules.filter((module) => inNoString(module)).length,
  );

  const most = scene.grids?.[loose.indexOf(Math.max(...loose))];

  return most && { block: most.block, face: most.face };
}
