/**
 * Pure statistics arithmetic — no database, no inverter. Window math for the
 * period-comparison endpoint plus the hour×weekday heatmap fold and its
 * calendar occurrence counter. DB-free so every branch is unit-testable
 * (see statistics-calc.test.ts); the DB-bound orchestration lives in
 * {@link ./statistics}.
 */

import type { CounterDeltaRow, EnergyField } from "./cost";

/** How the comparison endpoint picks its reference window. */
export type CompareMode = "previous" | "yearAgo";

/**
 * The reference window to compare `[from, to)` against:
 * - `previous` — the adjacent window of the same millisecond length, ending
 *   exactly where the current one starts: `[from − len, from)`.
 * - `yearAgo` — the same calendar window one year earlier (`setFullYear(−1)`
 *   on both edges; Feb 29 normalizes to Mar 1 per Date semantics).
 */
export function previousWindow(from: Date, to: Date, mode: CompareMode): { from: Date; to: Date } {
  if (mode === "yearAgo") {
    const f = new Date(from);
    f.setFullYear(f.getFullYear() - 1);
    const t = new Date(to);
    t.setFullYear(t.getFullYear() - 1);
    return { from: f, to: t };
  }
  const len = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - len), to: new Date(from) };
}

/**
 * One hour×weekday heatmap cell: kWh per energy field summed over every
 * occurrence of this local (hour-of-day, ISO weekday) slot in the window.
 * The kWh keys are derived from {@link EnergyField} (`importKwh`,
 * `exportKwh`, …) so a new field in the cost engine's ENERGY_FIELDS flows
 * into the cell shape automatically.
 */
export type HeatmapCell = {
  /** Local hour-of-day 0–23. */
  hod: number;
  /** Local ISO weekday 1 (Mon) – 7 (Sun). */
  dow: number;
  /** How many times this (hod, dow) slot occurs in the window — the client
   *  divides the kWh sums by this to render averages. */
  occurrences: number;
} & { [F in EnergyField as `${F}Kwh`]: number };

const HOUR_MS = 3_600_000;

/** Local ISO weekday 1 (Mon) – 7 (Sun); mirrors the SQL `extract(isodow)`. */
const isoWeekday = (d: Date): number => ((d.getDay() + 6) % 7) + 1;

/** Map key for a (hod, dow) slot. */
const slotKey = (hod: number, dow: number): string => `${dow}:${hod}`;

/** Start of the first local hour at or after `d` (hour slots starting before
 *  `from` are outside the window, matching the SQL `bucket >= from` filter). */
function nextHourStart(d: Date): number {
  const t = new Date(d);
  t.setMinutes(0, 0, 0);
  return t.getTime() < d.getTime() ? t.getTime() + HOUR_MS : t.getTime();
}

/**
 * How many times each local (hour-of-day, ISO weekday) slot occurs in
 * `[from, to)`, keyed by {@link slotKey}. Steps real time hour by hour and
 * reads the LOCAL Date fields of each step, so it is DST-consistent with the
 * SQL side's `bucket at time zone`: the spring-forward day contributes no
 * 02:00 slot and the fall-back day contributes 02:00 twice.
 */
export function hodDowOccurrences(from: Date, to: Date): Map<string, number> {
  const out = new Map<string, number>();
  const end = to.getTime();
  for (let t = nextHourStart(from); t < end; t += HOUR_MS) {
    const d = new Date(t);
    const key = slotKey(d.getHours(), isoWeekday(d));
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** A {@link HeatmapCell} with every energy field zero-filled. The kWh keys are
 *  built from the runtime field list, so the cast to the mapped type is sound
 *  by construction. */
function emptyCell(
  hod: number,
  dow: number,
  occurrences: number,
  fields: readonly EnergyField[],
): HeatmapCell {
  const cell: Record<string, number> = { hod, dow, occurrences };
  for (const f of fields) cell[`${f}Kwh`] = 0;
  return cell as HeatmapCell;
}

/**
 * Fold counter-delta rows into ≤168 hour×weekday cells: one zero-filled cell
 * per (hod, dow) slot that occurs in the window (per `occurrences`, so a
 * short window yields fewer cells), each summing the kWh of every matching
 * row across all periods. Rows for unmapped metrics or slots outside the
 * window are ignored. Cells come back sorted by (dow, hod).
 */
export function heatmapCells(
  rows: readonly CounterDeltaRow[],
  fieldByKey: ReadonlyMap<string, EnergyField>,
  fields: readonly EnergyField[],
  occurrences: ReadonlyMap<string, number>,
): HeatmapCell[] {
  const cells = new Map<string, HeatmapCell>();
  for (const [key, count] of occurrences) {
    const sep = key.indexOf(":");
    const dow = Number(key.slice(0, sep));
    const hod = Number(key.slice(sep + 1));
    cells.set(key, emptyCell(hod, dow, count, fields));
  }
  for (const r of rows) {
    const field = fieldByKey.get(r.metric);
    const cell = field === undefined ? undefined : cells.get(slotKey(r.hod, r.dow));
    if (!field || !cell) continue;
    // Sound: emptyCell seeded every `${field}Kwh` key for the fields in play.
    const rec = cell as unknown as Record<string, number>;
    const key = `${field}Kwh`;
    rec[key] = (rec[key] ?? 0) + Number(r.kwh);
  }
  return [...cells.values()].sort((a, b) => a.dow - b.dow || a.hod - b.hod);
}
