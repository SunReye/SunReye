// A range's bands: a band per hour, day, week, month or year, at most about 62, keyed by place.
import { m } from "../paraglide/messages.js";
import { civil, fmt, isoWeek, shortDay, yearOf } from "./calendar.ts";
import {
  customRange,
  grainOf,
  rangeFor,
  spanRange,
  step,
  t0Of,
  t1Of,
  type Calendar,
  type Grain,
  type Range,
} from "./range.ts";

/** One band of a range: its hours, its axis label, and the range a tap on it opens. */
export interface Edge {
  /** By place, so a new range moves the bands it has instead of replacing them. */
  readonly key: string;
  readonly t0: number;
  readonly t1: number;
  readonly label: string;
  readonly tick: boolean;
  readonly title: string;
  /** By the clock: `live` holds now. */
  readonly state: "past" | "live" | "future";
  readonly drill: Range | null;
}

type Raw = Omit<Edge, "key" | "tick" | "state">;

function hourEdges(r: Range): Raw[] {
  const out: Raw[] = [];

  for (let t = t0Of(r); t < t1Of(r); t++) {
    const hour = t % 24;
    const day = r.to - r.from > 1 ? `${shortDay(Math.floor(t / 24))} · ` : "";

    out.push({
      t0: t,
      t1: t + 1,
      label: String(hour),
      title: `${day}${m.range_hours({ from: hour, to: hour + 1 })}`,
      drill: null,
    });
  }

  return out;
}

function dayEdges(r: Range, drill: boolean): Raw[] {
  const out: Raw[] = [];

  for (let d = r.from; d < r.to; d++) {
    const label =
      r.to - r.from <= 7 ? fmt("weekday", d).replace(".", "") : String(civil(d).getUTCDate());

    out.push({
      t0: d * 24,
      t1: d * 24 + 24,
      label,
      title: fmt("dayLong", d),
      drill: drill ? rangeFor("day", d) : null,
    });
  }

  return out;
}

function weekEdges(r: Range): Raw[] {
  const out: Raw[] = [];

  for (let d = rangeFor("week", r.from).from; d < r.to; d += 7) {
    out.push({
      t0: Math.max(d, r.from) * 24,
      t1: Math.min(d + 7, r.to) * 24,
      label: shortDay(d),
      title: m.range_week_title({ week: isoWeek(d), date: shortDay(d) }),
      drill: rangeFor("week", d),
    });
  }

  return out;
}

function periodEdges(r: Range, kind: "month" | "year"): Raw[] {
  const out: Raw[] = [];
  const long = r.to - r.from > 370;
  const cal: Calendar = { today: r.from, hour: 0, last: Number.MAX_SAFE_INTEGER };

  for (let s = rangeFor(kind, r.from); s.from < r.to; s = step(cal, s, 1)) {
    const year = String(yearOf(s.from));
    const short = long ? fmt("monthShortYear", s.from) : fmt("monthShort", s.from).replace(".", "");

    out.push({
      t0: Math.max(s.from, r.from) * 24,
      t1: Math.min(s.to, r.to) * 24,
      label: kind === "year" ? year : short,
      title: kind === "year" ? year : fmt("monthYear", s.from),
      drill: s,
    });
  }

  return out;
}

const ORDER: readonly Grain[] = ["hour", "day", "week", "month", "year"];

/**
 * The range's bands, at most about 62.
 * @param finest the finest grain the screen's figures come in, such as days of costs
 */
export function edges(cal: Calendar, r: Range, finest: Grain = "hour"): Edge[] {
  const want = grainOf(r);
  const grain = ORDER.indexOf(want) < ORDER.indexOf(finest) ? finest : want;

  // A day at a daily grain is one band, with nothing finer to open.
  const raw =
    grain === "hour"
      ? hourEdges(r)
      : grain === "day"
        ? dayEdges(r, r.to - r.from > 1)
        : grain === "week"
          ? weekEdges(r)
          : periodEdges(r, grain);

  const stride = raw.length <= 12 ? 1 : Math.ceil(raw.length / 7);
  const now = cal.today * 24 + cal.hour;

  return raw.map((edge, i) => {
    // A range that starts or ends inside a day cuts its first and last band.
    const [t0, t1] = [Math.max(edge.t0, t0Of(r)), Math.min(edge.t1, t1Of(r))];
    const state: Edge["state"] = t0 > now ? "future" : t1 <= now ? "past" : "live";

    return Object.assign({}, edge, { t0, t1, key: `b${i}`, tick: i % stride === 0, state });
  });
}

/** The range a drag across bands `a` to `b` narrows to: their hours, or their whole days. */
export function brushRange(
  cal: Calendar,
  r: Range,
  bands: readonly Edge[],
  a: number,
  b: number,
): Range {
  const [first, last] = [bands[a]!, bands[b]!];

  if (grainOf(r) === "hour") return spanRange(cal, first.t0, last.t1);

  return customRange(cal, Math.floor(first.t0 / 24), Math.ceil(last.t1 / 24));
}
