// The years tab's list and records (ADR 11), from the core's rollups of every recorded day. Pure.
import type { Core } from "../api/core.ts";
import type { Best, Figures, Records } from "../api/records.ts";
import { m } from "../paraglide/messages.js";
import { dayOf, dayOfIso, fmt, shortDay } from "../range/calendar.ts";
import { kwh, money, num } from "../range/format.ts";
import { rangeFor, type Range } from "../range/range.ts";
import type { Metric } from "./view.ts";
import { change, delta } from "./words.ts";

/** What the years list reads. */
export type YearsCore = Readonly<Pick<Core, "records">>;

const day = (b: NonNullable<Best>) => dayOfIso(b.date);

export interface YearRow {
  readonly year: number;
  readonly running: boolean;
  readonly value: string;
  /** Against the same dates a year before. */
  readonly change: string;
  readonly range: Range;
}

export interface RecordRow {
  readonly label: string;
  readonly when: string;
  readonly value: string;
  readonly range: Range;
}

/** The question's figure: production, savings, or autarky in percent. */
function figure(metric: Metric, f: Figures): number | null {
  if (metric === "money") return f.saved ?? null;

  if (metric === "autarky") return f.consumption > 0 ? (f.selfSupply / f.consumption) * 100 : null;

  return f.production;
}

function written(metric: Metric, v: number | null): string {
  if (v === null) return "–";

  if (metric === "money") return money(v);

  return metric === "autarky" ? `${num(v)} %` : kwh(v);
}

function changeOf(metric: Metric, now: number | null, was: number | null): string {
  if (now === null || was === null) return delta(null);

  return metric === "autarky" ? delta((now - was) / 100, true) : delta(change(now, was));
}

/** Every recorded year, newest first, for the question. */
export function yearRows(metric: Metric, r: Records): YearRow[] {
  return r.years.map((y) => {
    const now = figure(metric, y.figures);

    return {
      year: y.year,
      running: y.running,
      value: written(metric, now),
      change: y.before ? changeOf(metric, now, figure(metric, y.before)) : m.stats_years_first(),
      range: rangeFor("year", dayOf(y.year, 0, 1)),
    };
  });
}

/** The best day and month of production and the best day of savings, each opening its range. */
export function recordRows(r: Records): RecordRow[] {
  const rows: RecordRow[] = [];

  if (r.bestDay)
    rows.push({
      label: m.stats_best_day(),
      when: shortDay(day(r.bestDay), true),
      value: kwh(r.bestDay.value),
      range: rangeFor("day", day(r.bestDay)),
    });

  if (r.bestMonth)
    rows.push({
      label: m.stats_best_month(),
      when: fmt("monthYear", day(r.bestMonth)),
      value: kwh(r.bestMonth.value),
      range: rangeFor("month", day(r.bestMonth)),
    });

  if (r.bestSaving)
    rows.push({
      label: m.stats_best_saving(),
      when: shortDay(day(r.bestSaving), true),
      value: money(r.bestSaving.value),
      range: rangeFor("day", day(r.bestSaving)),
    });

  return rows;
}
