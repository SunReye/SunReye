// A device's latest values as detail-sheet rows and tables (ADR 21). Pure.
import { roleLabel } from "../roles.ts";
import type { ByDevice } from "../api/frames.ts";

export interface Row {
  readonly key: string;
  readonly label: string;
  /** In the unit shown; absent for a status row, which carries `text`. */
  readonly value?: number;
  readonly text?: string;
  readonly unit: string;
  readonly digits: number;
  /** An estimate (ADR 17): written with "≈". */
  readonly est?: boolean;
  /** Seconds since it was read, set only once it is stale. */
  readonly age?: number;
  /** The detail this row opens. */
  readonly to?: string;
  /** Explore on its series, when it has stored history (ADR 22). */
  readonly href?: string;
}

/** Indexed readings side by side: one line per MPPT input or phase, one column per role. */
export interface Table {
  readonly cols: readonly { readonly label: string; readonly unit: string }[];
  readonly rows: readonly {
    readonly key: string;
    readonly label: string;
    readonly cells: readonly (Row | null)[];
  }[];
}

export interface Group {
  readonly title: string;
  /** One quiet sentence under the title, where a figure needs its reason. */
  readonly note?: string;
  readonly rows: readonly Row[];
  readonly table?: Table;
}

/** How a number reads: its label, unit and digits, scaled from the role's unit. */
export interface Format {
  /** The role's own label (ADR 4) where absent. */
  readonly label?: string;
  readonly unit: string;
  readonly digits: number;
  /** From the role's unit to the shown one; 1 when absent. */
  readonly scale?: number;
  /** The detail the row opens. */
  readonly to?: string;
}

/** One device's values, read as rows. */
export interface Reader {
  readonly device: number;
  /** The `role[i]` indices the device publishes for any of `roles`, ascending. */
  readonly indices: (roles: readonly string[]) => number[];
  readonly raw: (key: string) => number | undefined;
  readonly num: (key: string, format: Format) => Row | null;
  readonly text: (key: string, say: (v: number) => string) => Row | null;
}

/** What a reader reads from. */
export interface Readings {
  readonly values: ByDevice;
  /** When each stale value was last read, epoch ms. */
  readonly stale: ByDevice;
  /** Per device, the series that are estimates (ADR 17). */
  readonly estimated: Readonly<Record<string, readonly string[]>>;
  /** The clock ages are counted against, epoch ms. */
  readonly now: number;
  /** The Explore route of a device's series; null without stored history (ADR 22). */
  readonly link: (device: number, series: string) => string | null;
}

const INDEXED = /^(?<role>.+)\[(?<index>\d+)\]$/u;

/** A series' role, its index left out. */
const roleOf = (key: string) => INDEXED.exec(key)?.groups?.["role"] ?? key;

/** The `role[i]` indices among `keys` for any of `roles`, ascending. */
function indices(keys: readonly string[], roles: readonly string[]): number[] {
  const found = new Set<number>();

  for (const key of keys) {
    const groups = INDEXED.exec(key)?.groups;

    if (groups?.role !== undefined && roles.includes(groups.role)) found.add(Number(groups.index));
  }

  return [...found].toSorted((a, b) => a - b);
}

function linked(source: Readings, device: number, key: string): { href?: string } {
  const href = source.link(device, key);

  return href === null ? {} : { href };
}

/** Reads `device`'s values; `quiet` leaves ages to the one notice above the list. */
export function reader(source: Readings, device: number, quiet: boolean): Reader {
  const values = source.values[device] ?? {};
  const stale = source.stale[device] ?? {};
  const estimated = new Set(source.estimated[device] ?? []);

  const age = (key: string) => {
    const at = stale[key];

    return quiet || at === undefined ? {} : { age: Math.round((source.now - at) / 1000) };
  };

  return {
    device,
    indices: (roles) => indices(Object.keys(values), roles),
    raw: (key) => values[key],
    num: (key, { label, unit, digits, scale = 1, to }) => {
      const v = values[key];

      if (v === undefined) return null;

      return {
        key,
        label: label ?? roleLabel(roleOf(key)),
        value: Math.abs(v) * scale,
        unit,
        digits,
        ...(estimated.has(key) && { est: true }),
        ...age(key),
        ...(to !== undefined && { to }),
        ...linked(source, device, key),
      };
    },
    text: (key, say) => {
      const v = values[key];

      if (v === undefined) return null;

      return {
        key,
        label: roleLabel(key),
        text: say(v),
        unit: "",
        digits: 0,
        ...age(key),
        ...linked(source, device, key),
      };
    },
  };
}

export const kept = (rows: readonly (Row | null)[]): Row[] =>
  rows.filter((r): r is Row => r !== null);

/** A table column: the role read at each line's index. */
export interface Column extends Format {
  readonly role: string;
}

/** One line per index of `cols`' roles; a column no line has a reading for is dropped. */
export function table(
  read: Reader,
  label: (index: number) => string,
  cols: readonly Column[],
): Table | undefined {
  const lines = read.indices(cols.map((c) => c.role));
  const used = cols.filter((c) => lines.some((i) => read.raw(`${c.role}[${i}]`) !== undefined));

  if (used.length === 0) return undefined;

  return {
    cols: used.map((c) => ({ label: c.label ?? roleLabel(c.role), unit: c.unit })),
    rows: lines.map((index) => ({
      key: String(index),
      label: label(index),
      cells: used.map((c) => read.num(`${c.role}[${index}]`, c)),
    })),
  };
}

export const tabled = (title: string, t: Table | undefined): Group =>
  t === undefined ? { title, rows: [] } : { title, rows: [], table: t };
