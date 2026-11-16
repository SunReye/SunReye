// Fold mode's figures (ADR 22): the periods a range folds by, one series' statistics per period as
// the table's rows, their order, and the chart's scale. Pure: the pane reads and renders.
import type { Period, Statistics } from "../api/core.ts";
import type { Chosen } from "./picker.ts";
import type { CatalogState } from "./explore.svelte.ts";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import { plantNow } from "../plant-day.ts";
import { scaleOf as bandScale, type Band, type Scale } from "../range/bands.ts";
import { dayOfIso, fmt, isoWeek, shortDay } from "../range/calendar.ts";
import { grainOf, t0Of, t1Of, type Range } from "../range/range.ts";

const PERIODS: readonly Period[] = ["hour", "day", "week", "month"];

/** The route's parameter the period is kept in; absent at the range's own. */
export const FOLD_PARAM = "by";

/** The hours one statistics read serves by the hour (ADR 9), less a margin. */
const HOURS = 1488;

/** The fewest days a range holds several of each longer period in. */
const DAYS: Readonly<Record<Exclude<Period, "hour">, number>> = { day: 2, week: 8, month: 32 };

/** The periods a range folds by, and the one it opens on. */
export function periodsOf(r: Range) {
  const grain = grainOf(r);
  const initial: Period = grain === "year" ? "month" : grain;
  const days = r.to - r.from;

  const fits = (p: Period) => (p === "hour" ? t1Of(r) - t0Of(r) <= HOURS : days >= DAYS[p]);

  return { offered: PERIODS.filter((p) => p === initial || fits(p)), initial };
}

/** The period the route names, while the range offers it; else the range's own. */
export function periodOf(r: Range, params: Readonly<URLSearchParams>): Period {
  const { offered, initial } = periodsOf(r);

  return offered.find((p) => p === params.get(FOLD_PARAM)) ?? initial;
}

/** One period's figures as the core serves them. */
export type Figures = Statistics["points"][number];

/** A row of the table, and a bar of the chart. */
export interface FoldRow {
  /** The period's start, RFC 3339. */
  readonly key: string;
  /** In ms since the epoch. */
  readonly start: number;
  readonly end: number;
  /** The plant-local day it begins on, since 1970-01-01. */
  readonly day: number;
  readonly mean: number | null;
  readonly min: number | null;
  readonly max: number | null;
  /** The statistics' integral, in the unit times hours (ADR 9): never summed here from a history. */
  readonly energy: number | null;
  /** A counter's rises. */
  readonly delta: number | null;
  /** The hours with a value. */
  readonly hours: number | null;
}

export type Figure = "mean" | "min" | "max" | "energy" | "delta" | "hours";

export type Column = "period" | Figure;

export function rowsOf(points: readonly Readonly<Figures>[]): FoldRow[] {
  return points.map((p) => ({
    key: p.start,
    start: Date.parse(p.start),
    end: Date.parse(p.end),
    day: dayOfIso(p.date),
    mean: p.mean ?? null,
    min: p.min ?? null,
    max: p.max ?? null,
    energy: p.integral ?? null,
    delta: p.delta ?? null,
    hours: p.hours ?? null,
  }));
}

/** A counter by its kind; an extra stored before kinds (ADR 22) by what its statistics hold. */
export function isCounter(kind: string | null, points: readonly Readonly<Figures>[]): boolean {
  return kind === null ? points.some((p) => (p.delta ?? null) !== null) : kind === "counter";
}

/** What a unit's integral over hours is written in, and how many of the integral make one. */
const ENERGY: ReadonlyMap<string, { unit: string; per: number }> = new Map([
  ["W", { unit: "kWh", per: 1000 }],
  ["kW", { unit: "kWh", per: 1 }],
  ["EUR/h", { unit: "EUR", per: 1 }],
]);

/** The unit a series' energy is written in; null where its integral has none. */
export function energyOf(unit: string | null): { unit: string; per: number } | null {
  return unit === null ? null : (ENERGY.get(unit) ?? null);
}

/** The table's columns: a counter's delta, or a measurement's figures. */
export function columnsOf(counter: boolean, unit: string | null): Column[] {
  if (counter) return ["period", "delta"];

  return ["period", "mean", "min", "max", ...(energyOf(unit) ? ["energy" as const] : []), "hours"];
}

/** The rows by one column; a period without that figure stands last either way. */
export function sorted(rows: readonly FoldRow[], column: Column, dir: "asc" | "desc"): FoldRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const of = (row: FoldRow) => (column === "period" ? row.start : row[column]);

  return rows.toSorted((a, b) => {
    const [x, y] = [of(a), of(b)];

    if (x === null || y === null) return Number(x === null) - Number(y === null);

    return sign * (x - y) || a.start - b.start;
  });
}

const sum = (xs: readonly number[]): number | null =>
  xs.length > 0 ? xs.reduce((a, b) => a + b, 0) : null;

const known = (rows: readonly FoldRow[], name: Figure): number[] =>
  rows.flatMap((row) => row[name] ?? []);

/** The whole range's figures, from its periods': what the legend shows while no bar is read. */
export function totalOf(rows: readonly FoldRow[]): Readonly<Record<Figure, number | null>> {
  const hours = sum(known(rows, "hours"));
  const weighted = sum(rows.flatMap((r) => (r.mean === null ? [] : r.mean * (r.hours ?? 0))));
  const [mins, maxes] = [known(rows, "min"), known(rows, "max")];

  return {
    mean: weighted !== null && hours !== null && hours > 0 ? weighted / hours : null,
    min: mins.length > 0 ? Math.min(...mins) : null,
    max: maxes.length > 0 ? Math.max(...maxes) : null,
    energy: sum(known(rows, "energy")),
    delta: sum(known(rows, "delta")),
    hours,
  };
}

/** What a row's bar stands on: a counter's delta, a measurement's mean. */
export const barOf = (row: FoldRow, counter: boolean): number | null =>
  counter ? row.delta : row.mean;

/** The chart's scale: both sides of zero, as far as the bars and their whiskers reach. */
export function foldScale(rows: readonly FoldRow[], counter: boolean): Scale {
  const reach = rows.flatMap((row) => [barOf(row, counter) ?? 0, row.min ?? 0, row.max ?? 0]);

  const below = Math.max(0, ...reach.map((v) => -v));

  const band: Band = {
    key: "reach",
    label: "",
    tick: false,
    title: "",
    state: "data",
    partial: false,
    up: [Math.max(0, ...reach)],
    down: [below],
    drillable: false,
  };

  return bandScale([band], below > 0);
}

/** A period's name, by the plant-local date it begins on. */
export function labelOf(row: FoldRow, period: Period, zone: string): string {
  if (period === "month") return fmt("monthYear", row.day);

  if (period === "week")
    return m.range_week_title({ week: isoWeek(row.day), date: shortDay(row.day) });

  if (period === "day") return fmt("dayLong", row.day);

  const { day, hour } = plantNow(zone, new Date(row.start));

  return `${shortDay(day)} · ${m.range_hours({ from: hour, to: hour + 1 })}`;
}

/** A period's short name under the chart. */
export function tickOf(row: FoldRow, period: Period, zone: string): string {
  if (period === "month") return fmt("monthShortYear", row.day);

  if (period !== "hour") return shortDay(row.day);

  return m.range_hour({ hour: plantNow(zone, new Date(row.start)).hour });
}

/** A figure as the table writes it: three significant places at most, none past the second decimal. */
export function figure(v: number | null): string {
  if (v === null) return "–";

  const size = Math.abs(v);
  const digits = size >= 100 ? 0 : size >= 10 ? 1 : 2;

  return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: digits }).format(v);
}

/**
 * Whether a series folds (ADR 22): `none` for a status or held value, `unstored` for one the
 * catalog does not list, `pending` until the catalog says. Without the catalog it is read anyway.
 */
export function foldOf(
  chosen: Pick<Chosen, "kind" | "first">,
  catalog: CatalogState,
): "pending" | "none" | "unstored" | "read" {
  if (catalog === "loading") return "pending";

  if (catalog === "failed") return "read";

  if (chosen.first === null) return "unstored";

  return chosen.kind === "status" || chosen.kind === "held" ? "none" : "read";
}
