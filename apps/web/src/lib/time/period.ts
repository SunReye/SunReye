/**
 * Calendar periods — day, week, month, year — resolved from DATE PARTS in an
 * explicit IANA zone, never from millisecond arithmetic.
 *
 * A civil day is not 86_400_000 ms. Across a spring-forward it is 23 hours and
 * across a fall-back 25, so `new Date(day.getTime() + 86_400_000)` either
 * overshoots an hour into the next day or drops the last hour of this one. Every
 * boundary here is built by asking the zone what its midnight is.
 *
 * NOT A FIX FOR THE PLANT-VS-DISPLAY TIMEZONE SPLIT (issue #46). This module is
 * deliberately zone-agnostic: the caller passes `timeZone` in, and choosing
 * WHICH zone — the plant's, for anything bucketed alongside server data, or the
 * viewer's, for rendering — stays the caller's problem. A default zone here, or
 * a `getPlantTimeZone()` import, would hand every caller one silent answer and
 * re-conflate the two zones #46 exists to keep apart.
 */

/** Granularity of a calendar period. */
export type Grain = "day" | "week" | "month" | "year";

/** A resolved calendar period. `end` is EXCLUSIVE — it is the next period's start. */
export type Period = { grain: Grain; start: Date; end: Date };

export interface PeriodOptions {
  /** IANA zone the calendar is read in, e.g. "Europe/Berlin". Required — see the module note. */
  timeZone: string;
  /** ISO weekday a week starts on: 1 = Monday (default), 7 = Sunday. */
  weekStartsOn?: 1 | 7;
}

/** A wall-clock calendar date, month 1-12. */
interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

/** One `Intl.DateTimeFormat` per zone — constructing one is expensive. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/**
 * The wall clock at `ms` in `timeZone`, expressed as the UTC timestamp of those
 * same digits. The difference from `ms` is the zone's offset; equality with a
 * target says a wall clock resolves back to itself.
 */
function wallAsUtc(ms: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  // `h23` renders midnight as 00, but some engines have emitted 24 — normalise.
  return Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
}

/** Signed offset (ms) of `timeZone` from UTC at `ms` — positive east of Greenwich. */
function offsetAt(ms: number, timeZone: string): number {
  return wallAsUtc(ms, timeZone) - ms;
}

/** The calendar date `instant` falls on in `timeZone`. */
function dateIn(instant: Date, timeZone: string): CalendarDate {
  const wall = wallAsUtc(instant.getTime(), timeZone);
  const d = new Date(wall);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * The instant a skipped wall clock resolves to: the transition itself, i.e. the
 * first instant whose wall clock is past the gap. Found by bisecting to the
 * minute, since zone transitions land on whole minutes.
 */
function transitionBetween(before: number, after: number, timeZone: string): Date {
  const target = offsetAt(after, timeZone);
  let lo = before;
  let hi = after;
  while (hi - lo > MINUTE) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
    if (offsetAt(mid, timeZone) === target) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

/**
 * Midnight starting `date` in `timeZone`, as an instant.
 *
 * The two zones-are-not-lines cases are resolved deliberately:
 *  - REPEATED midnight (Havana falls back 01:00 → 00:00): the FIRST occurrence,
 *    so the hour that happens twice sits inside the day, not before it.
 *  - SKIPPED midnight (Santiago springs forward 00:00 → 01:00): the transition,
 *    so the day starts at the first instant it actually has (01:00).
 *
 * Offsets are probed a day either side rather than at the wall clock read as
 * UTC: east of Greenwich that provisional instant already sits past a nearby
 * transition, and the earlier of two identical wall clocks would never be
 * generated.
 */
function midnightOf(date: CalendarDate, timeZone: string): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day);
  const offsets = [offsetAt(wall - DAY, timeZone), offsetAt(wall + DAY, timeZone)];
  const candidates = [...new Set(offsets.map((o) => wall - o))];
  const resolves = candidates.filter((c) => wallAsUtc(c, timeZone) === wall);
  if (resolves.length > 0) return new Date(Math.min(...resolves));
  return transitionBetween(Math.min(...candidates), Math.max(...candidates), timeZone);
}

/** `date` shifted by whole calendar days, carrying month and year over. */
function shiftDays(date: CalendarDate, days: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The first of the month `months` away from `date`'s month. */
function shiftMonths(date: CalendarDate, months: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1 + months, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: 1 };
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
function isoWeekday(date: CalendarDate): number {
  const dow = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay(); // 0 = Sunday
  return ((dow + 6) % 7) + 1;
}

/** The calendar date each grain's period begins on. */
const PERIOD_START: Record<Grain, (date: CalendarDate, weekStartsOn: 1 | 7) => CalendarDate> = {
  day: (date) => date,
  week: (date, weekStartsOn) => shiftDays(date, -((isoWeekday(date) - weekStartsOn + 7) % 7)),
  month: (date) => ({ year: date.year, month: date.month, day: 1 }),
  year: (date) => ({ year: date.year, month: 1, day: 1 }),
};

/** The calendar date the period AFTER the one starting at `start` begins on. */
const NEXT_PERIOD_START: Record<Grain, (start: CalendarDate) => CalendarDate> = {
  day: (start) => shiftDays(start, 1),
  week: (start) => shiftDays(start, 7),
  month: (start) => shiftMonths(start, 1),
  year: (start) => ({ year: start.year + 1, month: 1, day: 1 }),
};

/** Start of the `grain` period containing `instant`, in `opts.timeZone`. */
export function startOfPeriod(instant: Date, grain: Grain, opts: PeriodOptions): Date {
  const date = dateIn(instant, opts.timeZone);
  return midnightOf(PERIOD_START[grain](date, opts.weekStartsOn ?? 1), opts.timeZone);
}

/**
 * The `grain` period containing `instant` as `[start, end)`, in `opts.timeZone`.
 * `end` is the next period's start, so consecutive windows tile without a gap or
 * an overlap even across a DST transition.
 */
export function periodWindow(instant: Date, grain: Grain, opts: PeriodOptions): Period {
  const startDate = PERIOD_START[grain](dateIn(instant, opts.timeZone), opts.weekStartsOn ?? 1);
  return {
    grain,
    start: midnightOf(startDate, opts.timeZone),
    end: midnightOf(NEXT_PERIOD_START[grain](startDate), opts.timeZone),
  };
}

/**
 * `date` shifted by whole calendar months, CLAMPED to the target month's last
 * day. `new Date(2026, 1, 31)` overflows to 3 March, so a naive month step from
 * an anchor on the 31st lands back in the month it started in and the arrow
 * reads as dead. February keeps its own length — the 28th, or the 29th in 2024.
 */
function shiftMonthsClamped(date: CalendarDate, months: number): CalendarDate {
  const target = new Date(Date.UTC(date.year, date.month - 1 + months, 1));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(date.day, lastDay) };
}

/** The calendar date `delta` periods of each grain away from a period's start. */
const STEP: Record<Grain, (start: CalendarDate, delta: number) => CalendarDate> = {
  day: (start, delta) => shiftDays(start, delta),
  week: (start, delta) => shiftDays(start, 7 * delta),
  month: (start, delta) => shiftMonthsClamped(start, delta),
  year: (start, delta) => shiftMonthsClamped(start, 12 * delta),
};

/**
 * The period `delta` steps away from `period`, at the same grain — the back and
 * forward arrows.
 *
 * Stepping moves the DATE and re-resolves the boundaries, so a day step across a
 * spring-forward lands on the next civil day rather than 23 hours later, and the
 * result is always a canonical window even when the anchor handed in was not.
 */
export function stepPeriod(period: Period, delta: number, opts: PeriodOptions): Period {
  const moved = STEP[period.grain](dateIn(period.start, opts.timeZone), delta);
  return periodWindow(midnightOf(moved, opts.timeZone), period.grain, opts);
}

/**
 * Is `now` inside `[start, end)`? False AT `end` — that instant is the next period.
 *
 * Takes the WINDOW rather than a whole `Period`, because the question is also
 * asked about ranges that are not calendar periods: a rolling seven days, an
 * arbitrary custom span (`$lib/statistics/live#includesNow`). Requiring a grain
 * would make every such caller invent one for a predicate that never reads it.
 */
export function containsNow(period: Pick<Period, "start" | "end">, now: Date): boolean {
  const t = now.getTime();
  return t >= period.start.getTime() && t < period.end.getTime();
}

/**
 * May the reader step forward from `period`?
 *
 * False for the period `now` falls in — at its first instant and at its last —
 * because standing on the current period IS live, and the disabled forward arrow
 * is how the reader is told so. A future period is also the end of the road:
 * there is nothing past live.
 */
export function canStepForward(period: Period, now: Date): boolean {
  return period.end.getTime() <= now.getTime();
}

/** Grains tried by {@link periodOf}, finest first. */
const GRAINS: readonly Grain[] = ["day", "week", "month", "year"];

/**
 * Which grain the window `[start, end)` exactly IS, or `"custom"` when it is not
 * a calendar period at all — a 17-day comparison window, a month nudged an hour
 * off midnight, an empty or inverted range. Weeks are read against
 * `opts.weekStartsOn`: a Sunday-start week is not a period on a Monday calendar.
 *
 * An empty or inverted range needs no guard of its own and had one: every
 * `periodWindow` has `end` strictly after `start`, so the equality below can
 * never hold for a window of zero or negative length and the loop falls through
 * to `"custom"` on its own. A guard that no input can reach is a branch nobody
 * can test — replacing it with `if (false)` changed no assertion — so it is
 * gone, and the case that pins the BEHAVIOUR stays ("calls an empty or inverted
 * window custom").
 */
// fallow-ignore-next-line unused-export -- which grain tab a restored range selects; lands with its test ahead of the page wiring that spends it
export function periodOf(start: Date, end: Date, opts: PeriodOptions): Grain | "custom" {
  for (const grain of GRAINS) {
    const w = periodWindow(start, grain, opts);
    if (w.start.getTime() === start.getTime() && w.end.getTime() === end.getTime()) return grain;
  }
  return "custom";
}

/** {@link periodLabel} options: the calendar, plus who is reading it and when. */
export interface PeriodLabelOptions extends PeriodOptions {
  /** BCP-47 tag the label is formatted in; absent = the host's. */
  locale?: string;
  /** The instant "Today" is measured against. Defaults to the wall clock. */
  now?: Date;
}

function format(
  opts: PeriodLabelOptions,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(opts.locale, { ...options, timeZone: opts.timeZone });
}

/** A calendar day, carrying its year only once that year is not the current one. */
function dateLabel(instant: Date, opts: PeriodLabelOptions, now: Date): string {
  const sameYear = dateIn(instant, opts.timeZone).year === dateIn(now, opts.timeZone).year;
  const year = sameYear ? {} : { year: "numeric" as const };
  return format(opts, { month: "short", day: "numeric", ...year }).format(instant);
}

/** How each grain names itself to the reader. */
const LABEL: Record<Grain, (p: Period, o: PeriodLabelOptions, now: Date) => string> = {
  day: (p, o, now) => (containsNow(p, now) ? "Today" : dateLabel(p.start, o, now)),
  week: (p, o, now) => `Week of ${dateLabel(p.start, o, now)}`,
  month: (p, o) => format(o, { month: "short", year: "numeric" }).format(p.start),
  // The year is read from the ZONE's calendar, not from the instant's UTC date:
  // 2027-01-01T02:00Z is still 2026 in New York, and a label that disagreed with
  // the window would show a year the reader did not select.
  year: (p, o) => String(dateIn(p.start, o.timeZone).year),
};

/** Human name for a period: "Today", "Week of Aug 17", "Aug 2026", "2026". */
export function periodLabel(period: Period, opts: PeriodLabelOptions): string {
  return LABEL[period.grain](period, opts, opts.now ?? new Date());
}

/** `Intl.Locale#getWeekInfo` — Stage 4, but absent in some engines and lib.d.ts. */
type WeekInfoLocale = { getWeekInfo?: () => { firstDay?: number } };

/**
 * The ISO weekday `locale` starts its week on: 7 (Sunday) for en-US, 1 (Monday)
 * for de-DE and most of Europe.
 *
 * Monday is the fallback for every engine that does not expose `getWeekInfo` and
 * for any tag `Intl` refuses — reading it unguarded throws on the first render
 * of the picker, which is a blank page rather than a week off by a day.
 */
export function weekStartFor(locale: string): 1 | 7 {
  try {
    const info = (new Intl.Locale(locale) as unknown as WeekInfoLocale).getWeekInfo?.();
    return info?.firstDay === 7 || info?.firstDay === 0 ? 7 : 1;
  } catch {
    return 1;
  }
}

/**
 * The period a grain tab lands on, from wherever the reader is standing.
 *
 * Two answers, and which one is right depends entirely on whether the reader is
 * LIVE. From the current period every tab keeps them there — Month -> Day on the
 * 14th means today, not the 1st — because standing on the current period is the
 * state the disabled forward arrow is announcing, and a tab must not silently
 * step out of it. From a period they navigated away from, the anchor is that
 * period's own start: they went looking for March, and the tab changes the
 * granularity of March rather than teleporting back to now.
 *
 * Resolved through `periodWindow`, so the result is canonical even when the
 * period handed in was not.
 */
export function switchGrain(period: Period, grain: Grain, now: Date, opts: PeriodOptions): Period {
  return periodWindow(containsNow(period, now) ? now : period.start, grain, opts);
}

/**
 * The two words {@link periodTitle} cannot know: they live in the message
 * catalogue, and this module deliberately imports nothing from it.
 */
export interface PeriodTitleMessages {
  /** The day period holding `now` — "Today", "Heute", "Aujourd'hui". */
  today: () => string;
  /** A week, named by the date it starts on — "Week of Aug 17". */
  weekOf: (args: { date: string }) => string;
}

/**
 * {@link periodLabel}, with the two English words handed in by the caller.
 *
 * `periodLabel` bakes "Today" and "Week of" the way `$lib/inverter/ranges` and
 * `$lib/cost/ranges` bake an English `label` into every range: the MODEL stays
 * free of the catalogue. The navigator is a localized surface, so it spends this
 * instead. Month and year need nothing injected — `Intl` already speaks the
 * locale, and delegating them keeps one implementation of "which year does this
 * instant fall in".
 */
export function periodTitle(
  period: Period,
  opts: PeriodLabelOptions,
  messages: PeriodTitleMessages,
): string {
  const now = opts.now ?? new Date();
  if (period.grain === "day") {
    return containsNow(period, now) ? messages.today() : dateLabel(period.start, opts, now);
  }
  if (period.grain === "week") {
    return messages.weekOf({ date: dateLabel(period.start, opts, now) });
  }
  return periodLabel(period, opts);
}
