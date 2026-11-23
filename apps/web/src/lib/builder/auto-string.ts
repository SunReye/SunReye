// Auto-stringing (ADR 20): a roof face's modules in no string, run in a serpentine row by row from
// the lower left and cut into as few new strings as the inverter's limits allow. Pure.
import type { ModuleType } from "../api/core.ts";
import type { Checking } from "./checks.ts";
import { addString, inNoString, type Draft } from "@sunreye/builder/builder/modules.ts";
import type { GridModule } from "@sunreye/builder/builder/pv.ts";
import { wiredInto, type Cell } from "@sunreye/builder/builder/selecting.ts";

/** An MPPT input that carries no string, and what it takes. */
export interface Free {
  readonly input: number;
  /** The most modules in series on it, as the crate reckons it; null without its limits. */
  readonly longest: number | null;
  /** How many strings its maximum current carries in parallel; null where unknown. */
  readonly parallel: number | null;
}

/** What the cut reads of the inverter the new strings go to: its free inputs, in order. */
export interface Limit {
  readonly device: number;
  readonly free: readonly Free[];
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

const most = ({ longest }: Free): number => (longest === null || longest < 1 ? Infinity : longest);

const sum = (numbers: readonly number[]): number => numbers.reduce((a, b) => a + b, 0);

/** One string on each of the fewest inputs that hold `count` between them, each no longer than
 * its own input takes and as even as that allows; null where the inputs do not hold them. */
function alone(count: number, free: readonly Free[]): Cut | null {
  // The roomiest inputs first: the fewest strings.
  const roomy = free.toSorted((a, b) => most(b) - most(a));

  const enough = roomy.findIndex(
    (_, i) => sum(roomy.slice(0, i + 1).map((input) => most(input))) >= count,
  );

  if (enough < 0) return null;

  const used = new Set(roomy.slice(0, enough + 1));
  const lengths = new Map<Free, number>();
  let rest = count;

  // The tightest input first: what it cannot take, the roomier ones share.
  const tightest = free.filter((input) => used.has(input)).toSorted((a, b) => most(a) - most(b));

  for (const [i, input] of tightest.entries()) {
    const length = Math.min(most(input), Math.ceil(rest / (used.size - i)));

    lengths.set(input, length);
    rest -= length;
  }

  return free.flatMap((input): Cut =>
    used.has(input) ? [[lengths.get(input) ?? 0, input.input]] : [],
  );
}

/** `strings` strings of `length` shared out over the inputs that take that length, none carrying
 * more than its current allows; null where they do not carry that many. */
function shared(strings: number, length: number, free: readonly Free[]): Cut | null {
  const fit = free.filter((input) => most(input) >= length);
  const carried = new Map(fit.map((input) => [input, 0]));
  let left = strings;

  // In turn, an input at a time, until each is full.
  while (left > 0) {
    const open = fit.filter((input) => (carried.get(input) ?? 0) < (input.parallel ?? Infinity));

    if (open.length === 0) return null;

    for (const input of open.slice(0, left)) carried.set(input, (carried.get(input) ?? 0) + 1);

    left -= Math.min(left, open.length);
  }

  return fit.flatMap((input): Cut =>
    Array.from({ length: carried.get(input) ?? 0 }, () => [length, input.input]),
  );
}

/** `count` modules cut into strings no longer than each input takes, never unequal in parallel
 * (ADR 20): one on each free input where the inputs suffice; else all of one length, the fewest
 * that leave none over, shared out over the inputs; else the fewest of the longest equal length,
 * the rest left over. */
function cut(count: number, free: readonly Free[]): Cut {
  const single = alone(count, free);

  if (single !== null) return single;

  const fewest = Math.ceil(count / Math.max(...free.map((input) => most(input))));
  const runs = Array.from({ length: fewest + 1 }, (_, i) => fewest + i);

  const even = runs
    .filter((strings) => count % strings === 0)
    .map((strings) => shared(strings, count / strings, free))
    .find((made) => made !== null);

  if (even !== undefined) return even;

  // No longer than the tightest input takes, on as many strings as the inputs carry.
  const carried = sum(free.map((input) => input.parallel ?? Infinity));
  const strings = Math.min(fewest, carried);
  const length = Math.min(...free.map((input) => most(input)), Math.floor(count / strings));

  return shared(strings, length, free) ?? [];
}

/** The modules of a grid that are in no string, each with its place in the grid. */
function unwiredOf(modules: readonly Readonly<GridModule>[]): Loose[] {
  return modules.flatMap((module, at): Loose[] => (inNoString(module) ? [[at, module]] : []));
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

  const strings = cut(serpentine.length, limit.free);
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

  const free = freeOn(draft, device, listed?.length).map((input): Free => {
    const own = listed?.[input - 1];

    if (type === undefined) return { input, longest: null, parallel: null };

    return {
      input,
      longest: pv.longest(type, limits[device] ?? null, own ?? null),
      parallel: own ? Math.max(1, Math.floor(own.maxCurrent / type.isc)) : null,
    };
  });

  return autoStrung(draft, grid, { device, free }, name);
}
