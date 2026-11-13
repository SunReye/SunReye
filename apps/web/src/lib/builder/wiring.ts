// A string's wiring (ADR 20): each module's place along it, and the line drawn through their centres
// in that order.
import type { Cell, CellPlace, Point, Scene } from "./pv.ts";

/** The place in string `string`'s wiring after its last module's. */
export function following(scene: Readonly<Scene>, string: number | undefined): number {
  const orders = (scene.grids ?? []).flatMap((grid) =>
    grid.modules.flatMap((cell) => (cell.string === string ? [cell.order ?? -1] : [])),
  );

  return Math.max(-1, ...orders) + 1;
}

/** `after`, wired: in its place along its string, kept while it stays in the string `before` was;
 * else at `order`. */
export function ordered(
  before: Readonly<Cell> | undefined,
  after: Readonly<Cell> | undefined,
  order: number,
): Cell | undefined {
  const string = after?.string ?? undefined;

  if (after === undefined || string === undefined) return after;

  const kept = (before?.string ?? undefined) === string ? before?.order : order;

  return kept === undefined || kept === null ? after : { ...after, order: kept };
}

/** The mean of a cell's corners. */
function centre(corners: readonly Point[]): Point {
  const sum = corners.reduce<readonly [number, number, number]>(
    (total, [x, y, z]) => [total[0] + x, total[1] + y, total[2] + z],
    [0, 0, 0],
  );

  const count = Math.max(corners.length, 1);

  return [sum[0] / count, sum[1] / count, sum[2] / count];
}

/** Sorts by the first key that differs. */
function byKey(a: readonly number[], b: readonly number[]): number {
  const differs = a.findIndex((value, k) => value !== b[k]);

  return differs < 0 ? 0 : (a[differs] ?? 0) - (b[differs] ?? 0);
}

/** The centres of string `string`'s laid-out modules along its wiring: by their place in it, those
 * without one last, by grid, row and column. */
export function wiring(
  scene: Readonly<Scene>,
  cells: readonly (readonly Readonly<CellPlace>[] | null)[],
  string: number,
): Point[] {
  const wired: readonly { readonly key: readonly number[]; readonly at: Point }[] = (
    scene.grids ?? []
  ).flatMap((grid, i) =>
    grid.modules.flatMap(({ row, column, string: into, order }) => {
      const cell = cells[i]?.find((place) => place.row === row && place.column === column);

      return into === string && cell !== undefined
        ? [{ key: [order ?? Infinity, i, row, column], at: centre(cell.corners) }]
        : [];
    }),
  );

  return wired.toSorted((a, b) => byKey(a.key, b.key)).map(({ at }) => at);
}
