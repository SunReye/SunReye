// What a sheet's head says about its range (ADR 21): its change against the range before, and the
// record's edges inside it. Pure, in the SPA's locale and on the plant's clock.
import { NEXT_TO_NOTHING } from "../history/breakdown.ts";
import { change, delta } from "../history/words.ts";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import { plantNow } from "../plant-day.ts";
import { shortDay } from "../range/calendar.ts";
import { rangeLabel, type Calendar, type Range } from "../range/range.ts";
import { LAG_MS } from "./measure.ts";

/** The plant-local day of instant `at`, as "1. Nov. 2026". */
const dayText = (zone: string, at: number) => shortDay(plantNow(zone, new Date(at)).day, true);

/** Instant `at` on the plant's clock, as "11. Nov., 11:00". */
function instantText(zone: string, at: number): string {
  return new Intl.DateTimeFormat(getLocale(), {
    timeZone: zone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** "−12 % vs gestern": empty without readings on both sides, or from next to nothing. */
export function versus(cal: Calendar, base: Range, now: number | null, was: number | null): string {
  if (now === null || was === null || Math.abs(was) < NEXT_TO_NOTHING) return "";

  const c = change(now, was);

  if (c === null) return "";

  const yesterday = base.kind === "day" && base.from === cal.today - 1;

  return m.detail_versus({
    delta: delta(c),
    base: yesterday ? m.detail_yesterday() : rangeLabel(cal, base),
  });
}

/** The one sentence for a range before the record. */
export const beforeText = (zone: string, first: number): string =>
  m.detail_before({ date: dayText(zone, first) });

/** What the record does inside [from, until): where it begins, and where its readings stop. */
export interface Edges {
  readonly zone: string;
  /** The series' first and last stored instant; null while unknown. */
  readonly first: number | null;
  readonly last: number | null;
  readonly from: number;
  readonly until: number;
  readonly stops: number | null;
}

export function notesOf(e: Edges): string[] {
  const notes: string[] = [];

  if (e.first !== null && e.first > e.from && e.first < e.until)
    notes.push(m.detail_begins({ date: dayText(e.zone, e.first) }));

  // Readings that resume later, such as a sleeping inverter's, have not stopped.
  if (e.stops !== null && e.last !== null && e.last < e.stops + LAG_MS)
    notes.push(m.detail_stops({ when: instantText(e.zone, e.stops) }));

  return notes;
}
