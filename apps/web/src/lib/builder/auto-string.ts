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
  /** Its MPPT inputs that carry no string, in order. */
  readonly free: readonly number[];
  /** How many strings an input's maximum current carries in parallel; null where unknown. */
  readonly parallel: number | null;
}

/** A proposal: the draft with the new strings, and how many modules no equal cut could hold. */
export interface Strung {
  readonly draft: Draft;
  readonly left: number;
}

/** Why nothing is proposed: the inverter has no MPPT input without a string. */
export interface Unstrung {
  readonly refused: "input";
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

/** Each new string's length and input, in turn. */
type Cut = readonly (readonly [length: number, input: number])[];

/** `count` modules cut into strings no longer than the limit, never unequal in parallel (ADR 20):
 * one on each free input and at most one apart where the inputs suffice; else all of one length,
 * the fewest that leave none over, shared out over the inputs; else the fewest of the longest
 * equal length, the rest left over. */
function cut(count: number, { longest, free, parallel }: Readonly<Limit>): Cut {
  const most = longest === null || longest < 1 ? count : longest;
  const fewest = Math.ceil(count / most);

  if (fewest <= free.length) {
    const [short, longer] = [Math.floor(count / fewest), count % fewest];

    return free.slice(0, fewest).map((input, i) => [short + (i < longer ? 1 : 0), input]);
  }

  const carried = parallel === null ? Infinity : free.length * parallel;
  const runs = Array.from({ length: fewest + 1 }, (_, i) => fewest + i);
  const even = runs.find((strings) => strings <= carried && count % strings === 0);
  const strings = even ?? Math.min(fewest, carried);
  const length = Math.min(most, Math.floor(count / Math.max(strings, 1)));

  return Array.from({ length: strings }, (_, i) => [
    length,
    free[Math.floor((i * free.length) / strings)] ?? 0,
  ]);
}

/** The modules of a grid that are in no string, each with its place in the grid. */
function unwiredOf(modules: readonly Readonly<GridModule>[]): Loose[] {
  return modules.flatMap((module, at): Loose[] =>
    (module.string ?? undefined) === undefined ? [[at, module]] : [],
  );
}

/** Each of the `strings` from `first` takes its run of the serpentine, in turn. */
function run(
  draft: Draft,
  serpentine: readonly Cell[],
  strings: Cut,
  first: number,
): Strung | null {
  let strung: Draft | null = draft;
  let from = 0;

  for (const [nth, [length]] of strings.entries()) {
    strung = strung && wiredInto(strung, serpentine.slice(from, from + length), first + nth);
    from += length;
  }

  return strung && { draft: strung, left: serpentine.length - from };
}

/** Grid `grid`'s modules in no string wired into new strings named by `name` from their number:
 * the proposal, why there is none, or null where the grid holds no such module. Wired modules stay
 * as they are. */
export function autoStrung(
  draft: Draft,
  grid: number,
  limit: Readonly<Limit>,
  name: (number: number) => string,
): Strung | Unstrung | null {
  const laid = draft.scene.grids?.[grid];
  const loose = unwiredOf(laid?.modules ?? []);

  // A new string as the builder adds one: wired like the first.
  const like = laid && addString(draft, "", laid.moduleType).strings.at(-1);

  if (like === undefined || loose.length === 0) return null;

  if (limit.free.length === 0) return { refused: "input" };

  const serpentine: Cell[] = rows(loose).flatMap((row: readonly Loose[], i) =>
    (i % 2 === 0 ? row : row.toReversed()).map(([module]) => ({ grid, module })),
  );

  const strings = cut(serpentine.length, limit);
  const before = draft.strings.length;

  const made = strings.map(([, input], nth) => ({
    ...like,
    name: name(before + nth + 1),
    device: limit.device,
    input,
  }));

  return run({ ...draft, strings: [...draft.strings, ...made] }, serpentine, strings, before);
}

/** The inputs of `device` that carry no string, of the `listed` many it has. */
function freeOn(draft: Draft, device: number, listed: number | undefined): number[] {
  const taken = new Set(draft.strings.flatMap((s) => (s.device === device ? [s.input] : [])));
  // An inverter that lists no inputs has as many as its strings name, and one more.
  const count = listed ?? Math.max(0, ...taken) + 1;

  return Array.from({ length: count }, (_, i) => i + 1).filter((at) => !taken.has(at));
}

/** What auto-stringing reads besides the draft: the crate, each inverter's limits and the module
 * types. */
export interface Stringing extends Checking {
  readonly moduleTypes: readonly Readonly<ModuleType>[];
}

/** Grid `grid`'s modules in no string as new strings on the first inverter that lists its inputs,
 * else the first string's: on its inputs that carry no string, no more in parallel than an input's
 * current carries. */
export function strungOn(
  draft: Draft,
  grid: number,
  { pv, limits, inputs, moduleTypes }: Stringing,
  name: (number: number) => string,
): Strung | Unstrung | null {
  const device = Number(Object.keys(inputs)[0] ?? draft.strings[0]?.device ?? 1);
  const type = moduleTypes.find(({ id }) => id === draft.scene.grids?.[grid]?.moduleType);
  const listed = inputs[device];
  const free = freeOn(draft, device, listed?.length);

  if (type === undefined)
    return autoStrung(draft, grid, { longest: null, device, free, parallel: null }, name);

  const input = listed?.[0];
  const longest = pv.longest(type, limits[device] ?? null, input ?? null);
  const parallel = input ? Math.max(1, Math.floor(input.maxCurrent / type.isc)) : null;

  return autoStrung(draft, grid, { longest, device, free, parallel }, name);
}
