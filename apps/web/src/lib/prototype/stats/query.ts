// PROTOTYPE: what the Statistics screen asks of the fake history: ranges, buckets, comparisons and
// the analyses. In the product these are queries to the core; nothing here would run in the SPA (ADR 12).
import { dateOf, dayIndex, type History } from "./history";

export type Kind = "day" | "week" | "month" | "year" | "custom";
export type Grain = "hour" | "day" | "week" | "month" | "year";
export type Compare = "prev" | "year";
export type Sum = Record<string, number>;

/** A range as a window of days, end exclusive. */
export interface Sel {
  kind: Kind;
  from: number;
  to: number;
  /** Custom only: the hour the first day starts at and the hour the last day ends at. */
  h0?: number;
  h1?: number;
}

/** The range as hours since the start of recording, [t0, t1). */
export const t0Of = (s: Sel) => s.from * 24 + (s.h0 ?? 0);
export const t1Of = (s: Sel) => (s.to - 1) * 24 + (s.h1 ?? 24);

export interface Bucket {
  key: string;
  t0: number;
  t1: number;
  /** Axis label, shown where `tick` is set. */
  label: string;
  tick: boolean;
  title: string;
  sum: Sum;
  /** `before` recording began, a `gap` without readings, the `live` running bucket, or the `future`. */
  state: "data" | "gap" | "live" | "future" | "before";
  /** The bucket holds some hours without readings. */
  partial: boolean;
  drill: Sel | null;
}

const de = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("de-DE", o);
const F = {
  dayLong: de({ weekday: "short", day: "numeric", month: "long" }),
  dayLongYear: de({ weekday: "short", day: "numeric", month: "long", year: "numeric" }),
  dayShort: de({ day: "numeric", month: "short" }),
  dayShortYear: de({ day: "numeric", month: "short", year: "numeric" }),
  weekday: de({ weekday: "short" }),
  month: de({ month: "long" }),
  monthShort: de({ month: "short" }),
  monthYear: de({ month: "long", year: "numeric" }),
  monthShortYear: de({ month: "short", year: "2-digit" }),
};
export const fmtDay = (h: History, day: number, year = false) => (year ? F.dayShortYear : F.dayShort).format(dateOf(h.start, day));

const idx = (h: History, y: number, m: number, d: number) => dayIndex(h.start, new Date(y, m, d));

export function selFor(h: History, kind: Exclude<Kind, "custom">, day: number): Sel {
  const d = dateOf(h.start, day);
  if (kind === "day") return { kind, from: day, to: day + 1 };
  if (kind === "week") {
    const from = day - ((d.getDay() + 6) % 7);
    return { kind, from, to: from + 7 };
  }
  if (kind === "month") return { kind, from: idx(h, d.getFullYear(), d.getMonth(), 1), to: idx(h, d.getFullYear(), d.getMonth() + 1, 1) };
  return { kind, from: idx(h, d.getFullYear(), 0, 1), to: idx(h, d.getFullYear() + 1, 0, 1) };
}

export function customSel(h: History, from: number, to: number): Sel {
  const a = Math.max(0, Math.min(from, to, h.today));
  const b = Math.min(h.today + 1, Math.max(from, to));
  return { kind: "custom", from: a, to: Math.max(a + 1, b) };
}

/** One range, as a key. */
export const selKey = (s: Sel) => `${s.kind}:${s.from}:${s.to}:${s.h0 ?? ""}:${s.h1 ?? ""}`;

/** A custom range between two hours; whole days carry no hours. */
export function spanSel(h: History, a: number, b: number): Sel {
  const end = (h.today + 1) * 24;
  const lo = Math.max(0, Math.min(a, b, end - 1));
  const hi = Math.max(lo + 1, Math.min(end, Math.max(a, b)));
  const sel: Sel = { kind: "custom", from: Math.floor(lo / 24), to: Math.ceil(hi / 24) };
  if (lo % 24) sel.h0 = lo % 24;
  if (hi % 24) sel.h1 = hi % 24;
  return sel;
}

export function step(h: History, sel: Sel, dir: -1 | 1): Sel {
  if (sel.kind === "custom") {
    const len = t1Of(sel) - t0Of(sel);
    return spanSel(h, t0Of(sel) + dir * len, t1Of(sel) + dir * len);
  }
  return selFor(h, sel.kind, dir < 0 ? sel.from - 1 : sel.to);
}

export function canStep(h: History, sel: Sel, dir: -1 | 1): boolean {
  return dir > 0 ? sel.to <= h.today : sel.from > 0;
}

export function isCurrent(h: History, sel: Sel): boolean {
  return sel.from <= h.today && h.today < sel.to;
}

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
}

/** The stepper's label. */
export function selLabel(h: History, sel: Sel): string {
  const a = dateOf(h.start, sel.from);
  const thisYear = dateOf(h.start, h.today).getFullYear();
  if (sel.kind === "day") {
    if (sel.from === h.today) return "Heute";
    if (sel.from === h.today - 1) return "Gestern";
    return (a.getFullYear() === thisYear ? F.dayLong : F.dayLongYear).format(a);
  }
  if (sel.kind === "week") return isCurrent(h, sel) ? "Diese Woche" : `KW ${isoWeek(a)} · ${F.dayShort.format(a)}–${fmtDay(h, sel.to - 1, a.getFullYear() !== thisYear)}`;
  if (sel.kind === "month") return F.monthYear.format(a);
  if (sel.kind === "year") return String(a.getFullYear());
  if (sel.h0 === undefined && sel.h1 === undefined) return `${fmtDay(h, sel.from, true)} – ${fmtDay(h, sel.to - 1, true)}`;
  const [u, v] = [sel.h0 ?? 0, sel.h1 ?? 24];
  if (sel.to - sel.from === 1) return `${fmtDay(h, sel.from, true)} · ${u}–${v} Uhr`;
  return `${fmtDay(h, sel.from)} ${u} Uhr – ${fmtDay(h, sel.to - 1)} ${v} Uhr`;
}

/** The range inside a sentence: "im Mai", "heute", "2025". */
export function selPhrase(h: History, sel: Sel): string {
  const a = dateOf(h.start, sel.from);
  const thisYear = dateOf(h.start, h.today).getFullYear();
  if (sel.kind === "day") return sel.from === h.today ? "heute" : sel.from === h.today - 1 ? "gestern" : `am ${fmtDay(h, sel.from, a.getFullYear() !== thisYear)}`;
  if (sel.kind === "week") return isCurrent(h, sel) ? "diese Woche" : `in KW ${isoWeek(a)}`;
  if (sel.kind === "month") return isCurrent(h, sel) ? "diesen Monat" : `im ${a.getFullYear() === thisYear ? F.month.format(a) : F.monthYear.format(a)}`;
  if (sel.kind === "year") return isCurrent(h, sel) ? "dieses Jahr" : String(a.getFullYear());
  return "im gewählten Zeitraum";
}

export function grainOf(sel: Sel): Grain {
  if (sel.kind === "day") return "hour";
  if (sel.kind === "week" || sel.kind === "month") return "day";
  if (sel.kind === "year") return "month";
  if (t1Of(sel) - t0Of(sel) <= 62) return "hour";
  const n = sel.to - sel.from;
  return n <= 62 ? "day" : n <= 182 ? "week" : n <= 1100 ? "month" : "year";
}

/** Sums every field over hours [t0, t1), whole days from the daily rollup. */
export function sumRange(h: History, t0: number, t1: number): Sum {
  const out: Sum = {};
  const fields = Object.keys(h.hour);
  for (const f of fields) out[f] = 0;
  let t = Math.max(0, t0);
  const end = Math.min(h.days * 24, t1);
  while (t < end) {
    if (t % 24 === 0 && t + 24 <= end) {
      const d = t / 24;
      for (const f of fields) out[f]! += h.day[f]![d]!;
      t += 24;
    } else {
      for (const f of fields) out[f]! += h.hour[f]![t]!;
      t++;
    }
  }
  return out;
}

/** What the live stream added to today since the history was read, as a sum to lay over the running bucket. */
export function liveSum(h: History, grown: { production: number; consumption: number; feedIn: number; purchase: number }): Sum {
  const p = h.tariff.at(-1)!;
  const out: Sum = { pv: grown.production, load: grown.consumption, feedIn: grown.feedIn, imp: grown.purchase };
  const net = out.pv! - out.feedIn! - (out.load! - out.imp!);
  if (h.batteryFrom === null) {
    // No battery to take the difference: it is fed in or bought.
    out.feedIn! += Math.max(0, net);
    out.imp! += Math.max(0, -net);
  }
  out.charge = h.batteryFrom === null ? 0 : Math.max(0, net);
  out.discharge = h.batteryFrom === null ? 0 : Math.max(0, -net);
  out.cost = (out.imp! * p.imp) / 100;
  out.revenue = (out.feedIn! * p.feedIn) / 100;
  out.saved = ((out.load! - out.imp!) * p.imp) / 100 + out.revenue;
  const kwp = h.strings.reduce((a, s) => a + s.kwp, 0);
  h.strings.forEach((s, i) => (out[`s${i}`] = (out.pv! * s.kwp) / kwp));
  return out;
}

function withLive(h: History, sum: Sum, t0: number, t1: number, live?: Sum): Sum {
  if (!live || t0 > h.nowT || t1 <= h.nowT) return sum;
  const out = { ...sum };
  for (const [f, v] of Object.entries(live)) out[f] = (out[f] ?? 0) + v;
  return out;
}

export function total(h: History, sel: Sel, live?: Sum): Sum {
  return withLive(h, sumRange(h, t0Of(sel), t1Of(sel)), t0Of(sel), t1Of(sel), live);
}

export function buckets(h: History, sel: Sel, live?: Sum): Bucket[] {
  const grain = grainOf(sel);
  const edges: { t0: number; t1: number; label: string; title: string; drill: Sel | null; key: string }[] = [];
  if (grain === "hour") {
    for (let t = t0Of(sel); t < t1Of(sel); t++) {
      const hr = t % 24;
      const dayPart = sel.to - sel.from > 1 ? `${fmtDay(h, Math.floor(t / 24))} · ` : "";
      edges.push({ t0: t, t1: t + 1, label: String(hr), title: `${dayPart}${hr}–${hr + 1} Uhr`, drill: null, key: `h${t}` });
    }
  } else if (grain === "day") {
    for (let d = sel.from; d < sel.to; d++) {
      const date = dateOf(h.start, d);
      const label = sel.to - sel.from <= 7 ? F.weekday.format(date).replace(".", "") : String(date.getDate());
      edges.push({ t0: d * 24, t1: d * 24 + 24, label, title: F.dayLong.format(date), drill: selFor(h, "day", d), key: `d${d}` });
    }
  } else if (grain === "week") {
    for (let d = selFor(h, "week", sel.from).from; d < sel.to; d += 7) {
      const date = dateOf(h.start, d);
      edges.push({ t0: Math.max(d, sel.from) * 24, t1: Math.min(d + 7, sel.to) * 24, label: F.dayShort.format(date), title: `KW ${isoWeek(date)} · ab ${F.dayShort.format(date)}`, drill: selFor(h, "week", d), key: `w${d}` });
    }
  } else {
    const kind = grain === "month" ? "month" : "year";
    for (let s = selFor(h, kind, sel.from); s.from < sel.to; s = step(h, s, 1)) {
      const date = dateOf(h.start, s.from);
      const long = sel.to - sel.from > 370;
      const label = kind === "year" ? String(date.getFullYear()) : long ? F.monthShortYear.format(date) : F.monthShort.format(date).replace(".", "");
      edges.push({ t0: Math.max(s.from, sel.from) * 24, t1: Math.min(s.to, sel.to) * 24, label, title: kind === "year" ? String(date.getFullYear()) : F.monthYear.format(date), drill: s, key: `${kind[0]}${s.from}` });
    }
  }
  const stride = edges.length <= 12 ? 1 : Math.ceil(edges.length / 7);
  return edges.map((edge, i) => {
    // A range that starts or ends inside a day cuts its first and last band.
    const e = { ...edge, t0: Math.max(edge.t0, t0Of(sel)), t1: Math.min(edge.t1, t1Of(sel)) };
    const sum = withLive(h, sumRange(h, e.t0, e.t1), e.t0, e.t1, live);
    const liveNow = e.t0 <= h.nowT && h.nowT < e.t1;
    const state = e.t1 <= 0 ? "before" : e.t0 > h.nowT ? "future" : liveNow ? "live" : sum.hours === 0 ? "gap" : "data";
    // Keyed by place, so a new range moves the bars it has to their new values instead of replacing them.
    return { ...e, key: `b${i}`, tick: i % stride === 0, sum, state, partial: sum.gap! > 0 && sum.hours! > 0 };
  });
}

/** The same span one period or one year earlier, cut to as much of it as has elapsed now. */
export interface Baseline {
  sum: Sum;
  label: string;
  /** "im Vormonat", for a sentence. */
  within: string;
  /** "zum Vormonat", beside a change. */
  against: string;
}
const BASE: Record<string, [string, string]> = {
  Vortag: ["am Vortag", "zum Vortag"],
  Vorwoche: ["in der Vorwoche", "zur Vorwoche"],
  Vormonat: ["im Vormonat", "zum Vormonat"],
  Vorjahr: ["im Vorjahr", "zum Vorjahr"],
  "Zeitraum davor": ["im Zeitraum davor", "zum Zeitraum davor"],
};

/** Where the span the range is compared with begins, in hours, and what it is called. */
function baseStart(h: History, sel: Sel, mode: Compare): { from: number; label: string } {
  if (mode === "year" || sel.kind === "year") {
    const a = dateOf(h.start, sel.from);
    return { from: idx(h, a.getFullYear() - 1, a.getMonth(), a.getDate()) * 24 + (sel.h0 ?? 0), label: "Vorjahr" };
  }
  return {
    from: sel.kind === "custom" ? 2 * t0Of(sel) - t1Of(sel) : step(h, sel, -1).from * 24,
    label: { day: "Vortag", week: "Vorwoche", month: "Vormonat", custom: "Zeitraum davor" }[sel.kind],
  };
}

export function baseline(h: History, sel: Sel, mode: Compare): Baseline | null {
  const elapsed = Math.min(t1Of(sel), h.nowT) - t0Of(sel);
  if (elapsed <= 0) return null;
  const { from, label } = baseStart(h, sel, mode);
  if (from < 0) return null;
  const sum = sumRange(h, from, from + elapsed);
  return sum.hours! > 0 ? { sum, label, within: BASE[label]![0], against: BASE[label]![1] } : null;
}

/** The same band of the compared span, for a mark beside each bar; null where there is nothing to compare. */
export function baselineBands(h: History, sel: Sel, bs: Bucket[], mode: Compare): (Sum | null)[] {
  const shift = t0Of(sel) - baseStart(h, sel, mode).from;
  return bs.map((b) => {
    if (b.state !== "data" && b.state !== "live") return null;
    const from = b.t0 - shift;
    if (from < 0) return null;
    const sum = sumRange(h, from, from + Math.min(b.t1, h.nowT) - b.t0);
    return sum.hours! > 0 ? sum : null;
  });
}

export const autarky = (s: Sum) => (s.load! > 0 ? (s.load! - s.imp!) / s.load! : null);
export const selfUse = (s: Sum) => (s.pv! > 0 ? (s.pv! - s.feedIn!) / s.pv! : null);

/** Relative change, or null when the base holds nothing to compare with. */
export const change = (now: number, base: number | undefined) => (base && base > 0 ? now / base - 1 : null);

// ── Years ────────────────────────────────────────────────────────────────────────────────────────

export interface YearRow {
  year: number;
  sum: Sum;
  /** The same days of the year before, when recorded. */
  before: Sum | null;
  sel: Sel;
  running: boolean;
}

export function years(h: History, live?: Sum): YearRow[] {
  const rows: YearRow[] = [];
  for (let s = selFor(h, "year", h.today); s.to > 0; s = step(h, s, -1)) {
    const base = baseline(h, s, "year");
    rows.push({ year: dateOf(h.start, s.from).getFullYear(), sum: total(h, s, live), before: base?.sum ?? null, sel: s, running: isCurrent(h, s) });
  }
  return rows;
}

export interface RecordRow {
  label: string;
  value: number;
  unit: "kWh" | "€";
  when: string;
  sel: Sel;
}

export function records(h: History): RecordRow[] {
  const best = (f: string) => {
    let at = 0;
    for (let d = 0; d < h.today; d++) if (h.day[f]![d]! > h.day[f]![at]!) at = d;
    return at;
  };
  const out: RecordRow[] = [];
  const pv = best("pv");
  out.push({ label: "Bester Tag", value: h.day.pv![pv]!, unit: "kWh", when: fmtDay(h, pv, true), sel: selFor(h, "day", pv) });
  let top: Sel | null = null;
  let topV = 0;
  for (let s = step(h, selFor(h, "month", h.today), -1); s.from >= 0; s = step(h, s, -1)) {
    const v = sumRange(h, s.from * 24, s.to * 24).pv!;
    if (v > topV) [top, topV] = [s, v];
  }
  if (top) out.push({ label: "Bester Monat", value: topV, unit: "kWh", when: F.monthYear.format(dateOf(h.start, top.from)), sel: top });
  const saved = best("saved");
  out.push({ label: "Größte Ersparnis an einem Tag", value: h.day.saved![saved]!, unit: "€", when: fmtDay(h, saved, true), sel: selFor(h, "day", saved) });
  return out;
}

// ── Pattern: hour of day against day or month ───────────────────────────────────────────────────

export interface Heat {
  cols: { label: string; tick: boolean; title: string; drill: Sel | null }[];
  /** [col][hour], mean kWh in that hour; null for a gap, NaN where nothing could be recorded (the future, before recording). */
  cells: (number | null)[][];
  max: number;
  by: "day" | "month";
}

export function heat(h: History, sel: Sel, field: string): Heat {
  const span = sel.to - sel.from;
  const by = span > 62 ? "month" : "day";
  const win = sel.kind === "day" ? selFor(h, "week", sel.from) : sel;
  const cols: Heat["cols"] = [];
  const cells: (number | null)[][] = [];
  let max = 0;
  const push = (d0: number, d1: number, col: Heat["cols"][number]) => {
    const row: (number | null)[] = [];
    for (let hr = 0; hr < 24; hr++) {
      let v = 0;
      let n = 0;
      let gap = false;
      for (let d = Math.max(0, d0); d < Math.min(d1, h.today + 1); d++) {
        const t = d * 24 + hr;
        if (h.hour.hours![t]) {
          v += h.hour[field]![t]!;
          n++;
        } else if (h.hour.gap![t]) gap = true;
      }
      row.push(n ? v / n : gap ? null : NaN);
      if (n && v / n > max) max = v / n;
    }
    cols.push(col);
    cells.push(row);
  };
  if (by === "day") {
    const stride = win.to - win.from <= 7 ? 1 : 5;
    for (let d = win.from; d < win.to; d++) {
      const date = dateOf(h.start, d);
      push(d, d + 1, { label: win.to - win.from <= 7 ? F.weekday.format(date).replace(".", "") : String(date.getDate()), tick: (d - win.from) % stride === 0, title: F.dayLong.format(date), drill: selFor(h, "day", d) });
    }
  } else {
    const months: Sel[] = [];
    for (let s = selFor(h, "month", win.from); s.from < win.to; s = step(h, s, 1)) months.push(s);
    const shown = months.slice(-36);
    const stride = shown.length <= 12 ? 1 : Math.ceil(shown.length / 6);
    shown.forEach((s, i) => {
      const date = dateOf(h.start, s.from);
      push(s.from, s.to, { label: shown.length <= 12 ? F.monthShort.format(date).replace(".", "") : F.monthShortYear.format(date), tick: i % stride === 0, title: F.monthYear.format(date), drill: s });
    });
  }
  return { cols, cells, max, by };
}

// ── MPPT inputs and strings (ADR 17) ────────────────────────────────────────────────────────────

export interface StringRow {
  id: string;
  name: string;
  mppt: number;
  face: string;
  kwp: number;
  kwh: number;
  /** Specific yield, the fair comparison between strings of different size. */
  perKwp: number;
  /** Measured over modelled on past weather, in the range; null without sun. */
  ratio: number | null;
  /** The same per month, oldest first, for the trend. */
  trend: (number | null)[];
  /** A string sharing its MPPT input is split by modelled current, not measured. */
  estimated: boolean;
  /** `weak`: clearly under its model lately; `face`: its day is skewed against the layout's azimuth. */
  flag: "weak" | "face" | null;
  note: string;
}

export function stringRows(h: History, sel: Sel, live?: Sum): StringRow[] {
  const sum = total(h, sel, live);
  const months: Sel[] = [];
  for (let s = selFor(h, "month", h.today), i = 0; s.to > 0 && i < 18; s = step(h, s, -1), i++) months.unshift(s);
  const monthly = months.map((s) => sumRange(h, s.from * 24, s.to * 24));
  const recent = sumRange(h, Math.max(0, h.today - 60) * 24, h.today * 24);
  return h.strings.map((s, i) => {
    const kwh = sum[`s${i}`] ?? 0;
    const model = sumRange(h, t0Of(sel), t1Of(sel))[`m${i}`]!;
    const measured = sumRange(h, t0Of(sel), t1Of(sel))[`s${i}`]!;
    const lately = recent[`m${i}`]! > 0 ? recent[`s${i}`]! / recent[`m${i}`]! : null;
    const skew = faceSkew(h, i);
    // A month of learning before anything is called out.
    const flag = h.today < 30 ? null : lately !== null && lately < 0.92 ? "weak" : Math.abs(skew) > 0.06 ? "face" : null;
    const note =
      flag === "weak"
        ? `${pct(lately! - 1)} zum Modell seit ${F.monthYear.format(dateOf(h.start, h.weakFrom))}. Verschattung, Verschmutzung oder ein defektes Modul prüfen.`
        : flag === "face"
          ? `Vormittags ${pct(skew)} über, nachmittags unter dem Modell: die Module stehen wohl weiter östlich als im PV-Layout eingetragen.`
          : "";
    return {
      id: s.id,
      name: s.name,
      mppt: s.mppt,
      face: s.face,
      kwp: s.kwp,
      kwh,
      perKwp: kwh / s.kwp,
      ratio: model > 0 ? measured / model : null,
      trend: monthly.map((m) => (m[`m${i}`]! > 0 ? m[`s${i}`]! / m[`m${i}`]! : null)),
      estimated: h.strings.filter((o) => o.mppt === s.mppt).length > 1,
      flag,
      note,
    };
  });
}

const pct = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))} %`;

/** Morning correction minus afternoon correction over the last year: far from zero means a wrong azimuth. */
// A year of hours per string: learned once per history, not on every live tick.
const skews = new WeakMap<History, number[]>();
function faceSkew(h: History, i: number): number {
  let known = skews.get(h);
  if (!known) skews.set(h, (known = []));
  return (known[i] ??= skewOf(h, i));
}
function skewOf(h: History, i: number): number {
  const g = correction(h, i);
  let am = 0, amN = 0, pm = 0, pmN = 0;
  for (const col of g.cells) {
    for (let hr = 8; hr < 12; hr++) if (col[hr] != null) (am += col[hr]!), amN++;
    for (let hr = 14; hr < 18; hr++) if (col[hr] != null) (pm += col[hr]!), pmN++;
  }
  return amN && pmN ? (am / amN - pm / pmN) / 2 : 0;
}

export interface CorrectionGrid {
  cols: string[];
  /** [month][hour]: measured ÷ modelled; null where the model expects under 3 % of the string's kWp. */
  cells: (number | null)[][];
}

const gridCache = new WeakMap<History, Map<number, CorrectionGrid>>();

/** The correction the plant learns per MPPT input, plant-local month and hour (ADR 17), over the last year. */
export function correction(h: History, i: number): CorrectionGrid {
  let per = gridCache.get(h);
  if (!per) gridCache.set(h, (per = new Map()));
  const hit = per.get(i);
  if (hit) return hit;
  const meas = Array.from({ length: 12 }, () => new Float64Array(24));
  const model = Array.from({ length: 12 }, () => new Float64Array(24));
  const hours = Array.from({ length: 12 }, () => new Float64Array(24));
  for (let d = Math.max(0, h.today - 365); d < h.today; d++) {
    const m = dateOf(h.start, d).getMonth();
    for (let hr = 0; hr < 24; hr++) {
      const t = d * 24 + hr;
      if (!h.hour.hours![t]) continue;
      meas[m]![hr]! += h.hour[`s${i}`]![t]!;
      model[m]![hr]! += h.hour[`m${i}`]![t]!;
      hours[m]![hr]!++;
    }
  }
  const floor = h.strings[i]!.kwp * 0.03;
  const grid: CorrectionGrid = {
    cols: Array.from({ length: 12 }, (_, m) => F.monthShort.format(new Date(2025, m, 1)).replace(".", "")),
    cells: meas.map((col, m) => Array.from(col, (v, hr) => (hours[m]![hr]! > 0 && model[m]![hr]! / hours[m]![hr]! > floor ? v / model[m]![hr]! : null))),
  };
  per.set(i, grid);
  return grid;
}

// ── Forecast accuracy ───────────────────────────────────────────────────────────────────────────

export interface Accuracy {
  /** Mean absolute daily deviation, as a share of the forecast. */
  error: number | null;
  /** Measured over forecast, minus one: above zero means the forecast was too low. */
  bias: number | null;
  days: number;
}

export function accuracy(h: History, sel: Sel): Accuracy {
  let abs = 0, fc = 0, pv = 0, days = 0;
  for (let d = Math.max(0, sel.from); d < Math.min(sel.to, h.today); d++) {
    if (h.day.hours![d]! < 24) continue;
    abs += Math.abs(h.day.pv![d]! - h.day.fcx![d]!);
    fc += h.day.fcx![d]!;
    pv += h.day.pv![d]!;
    days++;
  }
  return { error: fc > 0 ? abs / fc : null, bias: fc > 0 ? pv / fc - 1 : null, days };
}

// ── Battery ─────────────────────────────────────────────────────────────────────────────────────

export interface BatteryHealth {
  points: { date: Date; kwh: number }[];
  /** Median of the latest measurements, so one odd night does not move it. */
  nowKwh: number | null;
  firstKwh: number | null;
  cycles: number;
  perYear: number | null;
}

export function batteryHealth(h: History): BatteryHealth {
  const points = h.capacity.map((p) => ({ date: dateOf(h.start, p.day), kwh: p.kwh }));
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : null);
  const nowKwh = median(h.capacity.slice(-5).map((p) => p.kwh));
  const firstKwh = median(h.capacity.slice(0, 5).map((p) => p.kwh));
  const span = h.capacity.length > 5 ? (h.capacity.at(-1)!.day - h.capacity[0]!.day) / 365 : 0;
  return {
    points,
    nowKwh,
    firstKwh,
    cycles: h.day.discharge!.reduce((a, b) => a + b, 0) / h.nameplateKwh,
    perYear: nowKwh !== null && firstKwh !== null && span > 0.5 ? (nowKwh - firstKwh) / firstKwh / span : null,
  };
}

// ── Payback and tariff ──────────────────────────────────────────────────────────────────────────

export interface Payback {
  /** Savings summed since the first, per month end; `projected` continues at the last twelve months' pace. */
  points: { date: Date; saved: number; projected: boolean }[];
  saved: number;
  share: number;
  perYear: number | null;
  /** When the savings reach the investment at that pace. */
  reached: Date | null;
}

export function payback(h: History, live?: Sum): Payback {
  const points: Payback["points"] = [];
  let run = 0;
  for (let s = selFor(h, "month", 0); s.from <= h.today; s = step(h, s, 1)) {
    run += total(h, s, live).saved!;
    points.push({ date: dateOf(h.start, Math.min(s.to, h.today + 1)), saved: run, projected: false });
  }
  const recorded = h.today / 365;
  const lastYear = sumRange(h, Math.max(0, h.today - 365) * 24, h.today * 24).saved!;
  const perYear = recorded >= 0.25 ? lastYear / Math.min(1, recorded) : null;
  let reached: Date | null = null;
  if (perYear && perYear > 0) {
    const yearsLeft = (h.investment - run) / perYear;
    reached = dateOf(h.start, h.today + Math.round(yearsLeft * 365));
    const steps = Math.min(40, Math.ceil(yearsLeft * 2));
    for (let i = 1; i <= steps; i++) {
      const y = (yearsLeft * i) / steps;
      points.push({ date: dateOf(h.start, h.today + Math.round(y * 365)), saved: run + perYear * y, projected: true });
    }
  }
  return { points, saved: run, share: run / h.investment, perYear, reached };
}

export interface PricePoint {
  date: Date;
  imp: number;
  feedIn: number;
  spot: number | null;
}

/** The tariff's prices per bucket, with the bidding zone's mean spot price as context. */
export function prices(h: History, bs: Bucket[]): PricePoint[] {
  return bs
    .filter((b) => b.state !== "before" && b.state !== "future")
    .map((b) => {
      const day = Math.floor(b.t0 / 24);
      const v = h.tariff.findLast((x) => x.from <= day)!;
      const n = Math.min(b.t1, h.nowT) - b.t0;
      return { date: new Date(dateOf(h.start, day).getTime() + (b.t0 % 24) * 3_600_000), imp: v.imp, feedIn: v.feedIn, spot: n > 0 ? sumRange(h, b.t0, b.t0 + n).spot! / n : null };
    });
}

// ── Gaps and notes ──────────────────────────────────────────────────────────────────────────────

export interface GapRow {
  from: string;
  hours: number;
  sel: Sel;
  inRange: boolean;
}

export function gapRows(h: History, sel: Sel): GapRow[] {
  const tf = de({ day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return h.gaps
    .map((g) => {
      const day = Math.floor(g.t0 / 24);
      const at = new Date(dateOf(h.start, day).getTime() + (g.t0 % 24) * 3_600_000);
      return { from: tf.format(at), hours: g.t1 - g.t0, sel: g.t1 - g.t0 > 24 ? customSel(h, day, Math.floor((g.t1 - 1) / 24) + 1) : selFor(h, "day", day), inRange: g.t0 < sel.to * 24 && g.t1 > sel.from * 24 };
    })
    .reverse();
}

export interface Note {
  tone: "warn" | "info";
  text: string;
  action: string;
  /** Where the note leads: a range to drill into, or a view of the screen. */
  sel?: Sel;
  view?: { metric: string; tab: string };
}

/** At most three things about this range worth a look, the exceptional first. */
export function notes(h: History, sel: Sel, bs: Bucket[], rows: StringRow[]): Note[] {
  const out: Note[] = [];
  const weak = rows.find((r) => r.flag === "weak");
  if (weak && sel.to > h.weakFrom) out.push({ tone: "warn", text: `MPPT-Eingang ${weak.mppt} liefert ${pct((weak.trend.at(-1) ?? 1) - 1)} zum Modell.`, action: "Strings ansehen", view: { metric: "plant", tab: "strings" } });
  const gap = gapRows(h, sel).find((g) => g.inRange);
  if (gap) out.push({ tone: "warn", text: `${gap.hours} h ohne Daten ab ${gap.from}: Summen und Vergleiche sind unvollständig.`, action: "Lücke ansehen", sel: gap.sel });
  const dayBuckets = bs.filter((b) => b.state === "data" && b.drill);
  if (dayBuckets.length > 3) {
    const top = dayBuckets.reduce((a, b) => (b.sum.pv! > a.sum.pv! ? b : a));
    out.push({ tone: "info", text: `Stärkster Abschnitt: ${top.title} mit ${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(top.sum.pv!)} kWh.`, action: "Öffnen", sel: top.drill! });
  }
  const face = rows.find((r) => r.flag === "face");
  if (face && out.length < 3) out.push({ tone: "info", text: `${face.name}: Ausrichtung weicht vom PV-Layout ab.`, action: "Korrektur ansehen", view: { metric: "plant", tab: "strings" } });
  return out.slice(0, 3);
}
