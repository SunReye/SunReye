// The export (ADR 22): the points a mode plotted as a CSV, from what the mode already read. A row
// per point's interval, a column per series or overlay period headed by series id and unit.
// Numbers are written as the core served them, never by the locale. Pure.
import type { Period } from "../api/core.ts";
import { iso } from "../range/calendar.ts";
import type { Range } from "../range/range.ts";
import type { Curve, Tier } from "./curve.ts";
import { barOf, type FoldRow } from "./fold.ts";
import type { Chosen } from "./picker.ts";

/** A plotted point: its value over [t0, t1) in epoch ms. */
export interface Cell {
  readonly t0: number;
  readonly t1: number;
  /** Null for a period without the figure. */
  readonly v: number | null;
  /** The plant-local date a fold's period begins on; null where the mode has none. */
  readonly date: string | null;
}

/** What a mode plotted, ready to write. */
export interface Table {
  /** `sunreye-2026-11-15-bucket60.csv`. */
  readonly file: string;
  readonly columns: readonly { readonly head: string; readonly cells: readonly Cell[] }[];
}

/** What a header needs of a chosen series. */
export type Named = Pick<Chosen, "ref" | "unit">;

/** `3:pv.power [W]`: two devices may store one series id, so the device leads as in the route. */
function headOf({ ref, unit }: Named, period?: string): string {
  const parts = [`${ref.device}:${ref.series}`, period, unit === null ? undefined : `[${unit}]`];

  return parts.filter((part) => part !== undefined).join(" ");
}

const TIERS: readonly Tier[] = ["raw", "bucket", "hour", "day"];

/** The tiers of the curves with points, finest first: `raw-bucket60`. */
function tiersOf(curves: readonly Curve[]): string {
  const drawn = curves.filter((c) => c.samples.length > 0);

  return TIERS.flatMap((tier) => {
    const curve = drawn.find((c) => c.tier === tier);

    return curve ? [`${tier}${curve.width ?? ""}`] : [];
  }).join("-");
}

/** A day by its date, a longer range by its first and last. */
function fileOf(range: Range, tier: string): string {
  const last = iso(range.to - 1);
  const days = range.to - range.from === 1 ? last : `${iso(range.from)}_${last}`;

  return `sunreye-${days}-${tier}.csv`;
}

/** Null with no point plotted. */
function tableOf(file: string, columns: Table["columns"]): Table | null {
  return columns.some((c) => c.cells.length > 0) ? { file, columns } : null;
}

function curvesTable(range: Range, drawn: readonly (readonly [string, Curve])[]): Table | null {
  return tableOf(
    fileOf(range, tiersOf(drawn.map(([, curve]) => curve))),
    drawn.map(([head, curve]) => ({
      head,
      cells: curve.samples.map(({ t0, t1, v }) => ({ t0, t1, v, date: null })),
    })),
  );
}

/** Series mode: each drawn series' samples. */
export function seriesTable(
  range: Range,
  drawn: readonly { readonly chosen: Named; readonly curve: Curve }[],
): Table | null {
  return curvesTable(
    range,
    drawn.map((d) => [headOf(d.chosen), d.curve]),
  );
}

/** Overlay mode: each period's samples on the range's clock, the period named by its first day. */
export function overlayTable(
  range: Range,
  chosen: Named,
  periods: readonly { readonly key: string; readonly curve: Curve }[],
): Table | null {
  return curvesTable(
    range,
    periods.map((p) => [headOf(chosen, p.key), p.curve]),
  );
}

/** Fold mode: each period's bar, a measurement's mean or a counter's delta. */
export function foldTable(
  range: Range,
  chosen: Named,
  period: Period,
  counter: boolean,
  rows: readonly FoldRow[],
): Table | null {
  const cells = rows.map((row) => ({
    t0: row.start,
    t1: row.end,
    v: barOf(row, counter),
    // An hour is a UTC hour (ADR 9): it has no plant-local date of its own.
    date: period === "hour" ? null : iso(row.day),
  }));

  return tableOf(fileOf(range, period), [{ head: headOf(chosen), cells }]);
}

/** RFC 3339 in UTC, to the second where the instant is whole. */
const instant = (t: number): string => new Date(t).toISOString().replace(".000Z", "Z");

/** A cell as RFC 4180 writes it. */
const quoted = (cell: string): string =>
  /[",\r\n]/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;

/** A row as RFC 4180 writes it. */
const written = (cells: readonly string[]): string =>
  `${cells.map((cell) => quoted(cell)).join(",")}\n`;

const keyOf = (cell: Cell): string => `${cell.t0}:${cell.t1}`;

/** The table as text: rows in time order, a column blank where it has no point of that interval. */
export function csvOf(table: Table): string {
  const cells = table.columns.flatMap((c) => c.cells);

  const rows = [...new Map(cells.map((cell) => [keyOf(cell), cell])).values()].toSorted(
    (a, b) => a.t0 - b.t0 || a.t1 - b.t1,
  );

  const values = table.columns.map((c) => new Map(c.cells.map((cell) => [keyOf(cell), cell.v])));
  const dated = rows.some((row) => row.date !== null);
  const date = (text: string): string[] => (dated ? [text] : []);

  const head = ["start", "end"].concat(
    date("date"),
    table.columns.map((c) => c.head),
  );

  const lines = rows.map((row) =>
    written(
      [instant(row.t0), instant(row.t1)].concat(
        date(row.date ?? ""),
        table.columns.map((_, i) => String(values[i]?.get(keyOf(row)) ?? "")),
      ),
    ),
  );

  return [written(head), ...lines].join("");
}
