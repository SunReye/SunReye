// Auto-stringing (ADR 20): a roof face's modules in no string, run in a serpentine row by row from
// the lower left and cut into as few new strings as the inverter's limits allow. Pure.
import type { ModuleType } from "../api/core.ts";
import type { Checking } from "./checks.ts";
import { addString, type Draft } from "./modules.ts";
import type { GridModule } from "./pv.ts";
import { wiredInto, type Cell } from "./selecting.ts";

/** What the cut reads of the inverter the new strings go to. */
export interface Limit {
  /** The most modules in series, as the crate reckons it; null without the inverter's limits. */
  readonly longest: number | null;
  readonly device: number;
  /** How many MPPT inputs it has; 0 where its profile lists none. */
  readonly inputs: number;
}

/** Metres up the face within which modules share a row. */
const ROW = 0.4;

type Loose = readonly [module: number, laid: Readonly<GridModule>];

/** The modules in rows from the lowest, each row from the left. */
function rows(cells: readonly Loose[]): Loose[][] {
  const found: Loose[][] = [];

  for (const cell of cells.toSorted(([, a], [, b]) => a.up - b.up)) {
    const row = found.at(-1);
    const low = row?.[0]?.[1].up;

    if (row === undefined || low === undefined || cell[1].up - low > ROW) found.push([cell]);
    else row.push(cell);
  }

  return found.map((row: readonly Loose[]) => row.toSorted(([, a], [, b]) => a.across - b.across));
}

/** `count` cut into as few runs of at most `longest` as hold it, their lengths at most one apart,
 * the longer first. */
function cuts(count: number, longest: number | null): number[] {
  const most = longest === null || longest < 1 ? count : longest;
  const runs = Math.ceil(count / most);
  const [short, longer] = [Math.floor(count / runs), count % runs];

  return Array.from({ length: runs }, (_, i) => short + (i < longer ? 1 : 0));
}

/** The MPPT input of the `nth` new string: the inverter's inputs that carry no string, in order,
 * then its last; input 1 where it lists none. */
function inputFor(draft: Draft, { device, inputs }: Readonly<Limit>, nth: number): number {
  const taken = new Set(draft.strings.flatMap((s) => (s.device === device ? [s.input] : [])));
  const free = Array.from({ length: inputs }, (_, i) => i + 1).filter((input) => !taken.has(input));

  return free[nth] ?? Math.max(inputs, 1);
}

/** The draft with grid `grid`'s modules in no string wired into new strings named by `name` from
 * their number; null where it holds none. Wired modules stay as they are. */
export function autoStrung(
  draft: Draft,
  grid: number,
  limit: Readonly<Limit>,
  name: (number: number) => string,
): Draft | null {
  const laid = draft.scene.grids?.[grid];

  const loose = (laid?.modules ?? []).flatMap((module, at): Loose[] =>
    (module.string ?? undefined) === undefined ? [[at, module]] : [],
  );

  // A new string as the builder adds one: wired like the first.
  const like = laid && addString(draft, "", laid.moduleType).strings.at(-1);

  if (like === undefined || loose.length === 0) return null;

  const serpentine: Cell[] = rows(loose).flatMap((row: readonly Loose[], i) =>
    (i % 2 === 0 ? row : row.toReversed()).map(([module]) => ({ grid, module })),
  );

  const lengths = cuts(serpentine.length, limit.longest);
  const before = draft.strings.length;

  const made = lengths.map((_, nth) => ({
    ...like,
    name: name(before + nth + 1),
    device: limit.device,
    input: inputFor(draft, limit, nth),
  }));

  let strung: Draft | null = { ...draft, strings: [...draft.strings, ...made] };
  let from = 0;

  // Each new string takes its run of the serpentine, in turn.
  for (const [nth, length] of lengths.entries()) {
    strung = strung && wiredInto(strung, serpentine.slice(from, from + length), before + nth);
    from += length;
  }

  return strung;
}

/** What auto-stringing reads besides the draft: the crate, each inverter's limits and the module
 * types. */
export interface Stringing extends Checking {
  readonly moduleTypes: readonly Readonly<ModuleType>[];
}

/** Grid `grid`'s modules in no string as new strings on the first inverter that lists its inputs,
 * else the first string's; null where the grid holds none. */
export function strungOn(
  draft: Draft,
  grid: number,
  { pv, limits, inputs, moduleTypes }: Stringing,
  name: (number: number) => string,
): Draft | null {
  const device = Number(Object.keys(inputs)[0] ?? draft.strings[0]?.device ?? 1);
  const type = moduleTypes.find(({ id }) => id === draft.scene.grids?.[grid]?.moduleType);

  const longest =
    type === undefined
      ? null
      : pv.longest(type, limits[device] ?? null, inputs[device]?.[0] ?? null);

  return autoStrung(draft, grid, { longest, device, inputs: inputs[device]?.length ?? 0 }, name);
}
