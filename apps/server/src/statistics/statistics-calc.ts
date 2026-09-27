/**
 * Pure statistics arithmetic — no database, no inverter. Window math for the
 * period-comparison endpoint plus the hour×weekday heatmap fold and its
 * calendar occurrence counter. DB-free so every branch is unit-testable
 * (see statistics-calc.test.ts); the DB-bound orchestration lives in
 * {@link ./statistics}.
 */

import type { EnergyField, PeriodEnergy } from "@SunReye/contracts/energy";
import type {
  CompareMode,
  DayRecord,
  EnergyRecords,
  HeatmapCell,
  MoneyRecords,
} from "@SunReye/contracts/statistics";
import type { CostSeriesPoint } from "../energy/cost";
import type { CounterDeltaRow } from "../energy/rollup-reader";
import { zoneParts } from "@SunReye/inverter-core/zone-parts";
import {
  calendarDate,
  dayStart,
  isoWeekday,
  shiftWindowYears,
  startOfDate,
} from "@SunReye/inverter-core/zoned-calendar";

/**
 * The reference window to compare `[from, to)` against:
 * - `previous` — the adjacent window ending exactly where the current one
 *   starts. When both edges are PLANT midnights (`timeZone`) it is the same
 *   number of calendar days before, so a day compares against the whole day
 *   before even across a DST night. Days, not months: February against
 *   January would move every total by three days of length alone, and the
 *   web's caption reads "the previous N days". Any other window keeps its
 *   millisecond length: `[from − len, from)`.
 * - `yearAgo` — the same calendar window one year earlier on the PLANT's wall
 *   clock (`timeZone`), never the host's; a Feb 29 day compares against Feb 28
 *   (rule in `shiftWindowYears`).
 */
export function previousWindow(
  from: Date,
  to: Date,
  mode: CompareMode,
  timeZone: string,
): { from: Date; to: Date } {
  if (mode === "yearAgo") return shiftWindowYears({ from, to }, -1, timeZone);
  const calendar = previousCalendarStart(from, to, timeZone);
  if (calendar) return { from: calendar, to: new Date(from) };
  const len = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - len), to: new Date(from) };
}

const DAY_MS = 86_400_000;

/** Start of the calendar-aligned `previous` window, or null when either edge
 *  is not a plant midnight. */
function previousCalendarStart(from: Date, to: Date, timeZone: string): Date | null {
  const isMidnight = (t: Date) => dayStart(t, timeZone).getTime() === t.getTime();
  if (!isMidnight(from) || !isMidnight(to)) return null;
  const f = calendarDate(from, timeZone);
  const t = calendarDate(to, timeZone);
  const days = Math.round(
    (Date.UTC(t.year, t.month - 1, t.day) - Date.UTC(f.year, f.month - 1, f.day)) / DAY_MS,
  );
  return startOfDate({ year: f.year, month: f.month, day: f.day - days }, timeZone);
}

const HOUR_MS = 3_600_000;

/** Map key for a (hod, dow) slot. */
const slotKey = (hod: number, dow: number): string => `${dow}:${hod}`;

/** First UTC hour at or after `d`: `hourly_rollups` is `time_bucket('1 hour')`,
 *  so its buckets start on UTC hours (on :30 or :45 of a wall clock in a
 *  half-hour zone), and a slot starting before `from` fails `bucket >= from`. */
function nextHourStart(d: Date): number {
  return Math.ceil(d.getTime() / HOUR_MS) * HOUR_MS;
}

/**
 * How many times each plant-local (hour-of-day, ISO weekday) slot occurs in
 * `[from, to)`, keyed by {@link slotKey}. Steps real time hour by hour and reads
 * each step's wall-clock fields in `tz`, so it is DST-consistent with the SQL
 * side's `bucket at time zone $tz`: the spring-forward day contributes no 02:00
 * slot and the fall-back day contributes 02:00 twice. `tz` is the plant zone
 * (issue #46).
 */
export function hodDowOccurrences(from: Date, to: Date, tz: string): Map<string, number> {
  const out = new Map<string, number>();
  const end = to.getTime();
  for (let t = nextHourStart(from); t < end; t += HOUR_MS) {
    const key = slotKey(zoneParts(tz, t).hour, isoWeekday(t, tz));
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

/** The record among date-ascending candidates under `better` (strict), so
 *  ties keep the EARLIEST day. Empty input → null. */
function pickDay(
  days: readonly DayRecord[],
  better: (candidate: number, best: number) => boolean,
): DayRecord | null {
  let best: DayRecord | null = null;
  for (const d of days) {
    if (!best || better(d.value, best.value)) best = { date: d.date, value: d.value };
  }
  return best;
}

/** Earliest day with the highest value; null when `days` is empty. */
const maxDay = (days: readonly DayRecord[]): DayRecord | null =>
  pickDay(days, (candidate, best) => candidate > best);

/** Earliest day with the lowest value; null when `days` is empty. */
const minDay = (days: readonly DayRecord[]): DayRecord | null =>
  pickDay(days, (candidate, best) => candidate < best);

/** Days below this load are noise (data gaps, commissioning days) — they are
 *  excluded from the self-sufficiency records, which are ratios and would
 *  otherwise be dominated by near-empty days. */
const SS_MIN_LOAD_KWH = 1;

/** Candidates with `value > 0`: the per-day series is zero-filled, so without
 *  the floor an all-zero metric would "record" its first calendar day. */
const positiveDays = (
  days: readonly PeriodEnergy[],
  value: (d: PeriodEnergy) => number,
): DayRecord[] => days.flatMap((d) => (value(d) > 0 ? [{ date: d.bucket, value: value(d) }] : []));

/**
 * Pick the all-time energy records from date-ascending per-day energy splits
 * (ties → earliest day). Max records consider only days with a positive
 * value; self-sufficiency records only days with load ≥ {@link SS_MIN_LOAD_KWH}.
 * A record is null when no day qualifies.
 */
export function pickEnergyRecords(days: readonly PeriodEnergy[]): Omit<EnergyRecords, "since"> {
  const ss = days.flatMap((d) =>
    d.selfSufficiency !== null && d.loadKwh >= SS_MIN_LOAD_KWH
      ? [{ date: d.bucket, value: d.selfSufficiency }]
      : [],
  );
  return {
    maxProductionDay: maxDay(positiveDays(days, (d) => d.productionKwh)),
    maxExportDay: maxDay(positiveDays(days, (d) => d.exportKwh)),
    maxLoadDay: maxDay(positiveDays(days, (d) => d.loadKwh)),
    maxImportDay: maxDay(positiveDays(days, (d) => d.importKwh)),
    bestSelfSufficiencyDay: maxDay(ss),
    worstSelfSufficiencyDay: minDay(ss),
  };
}

/**
 * Pick the all-time money records from date-ascending per-day cost points
 * (ties → earliest day). Net extremes consider every day (a zero-net day is a
 * legitimate cheapest day); best earnings requires a positive figure — an
 * all-zero export history has no earnings record.
 */
export function pickMoneyRecords(
  points: readonly CostSeriesPoint[],
): Pick<MoneyRecords, "cheapestDay" | "mostExpensiveDay" | "bestEarningsDay"> {
  const nets = points.map((p) => ({ date: p.bucket, value: p.net }));
  const earnings = points.flatMap((p) =>
    p.exportEarnings > 0 ? [{ date: p.bucket, value: p.exportEarnings }] : [],
  );
  return {
    cheapestDay: minDay(nets),
    mostExpensiveDay: maxDay(nets),
    bestEarningsDay: maxDay(earnings),
  };
}
