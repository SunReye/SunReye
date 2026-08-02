// Time-range model for the statistics page. A `CostRange` carries the
// `[from, to)` the headline tiles are priced over plus TWO chart specs, because
// one picked range answers two different questions:
//
//   detail  — bucket INSIDE the picked window (today → by hour, a month → by day)
//   context — zoom one level out (a day → its month, a month → the trailing 12
//             months, a year → the trailing 24 months)
//
// Every chart-bearing section header carries a switcher between the two; pick
// one with {@link chartSpecFor}. `chart` stays an alias of the context spec so
// callers written before the switcher keep working unchanged.
//
// Kept separate from the History page's `ranges.ts`, which models the live
// buffer / rollup granularity for entity charts — different concern, different
// shape.

const DAY = 86_400_000;

/** Bar granularity of a statistics chart. */
export type CostBucket = "hour" | "day" | "month";

/**
 * Which window a chart plots for the picked range: buckets inside it
 * (`detail`) or one level out around it (`context`).
 */
export type ChartScope = "detail" | "context";

/** Window + granularity one chart renders, with the caption tying it back to
 *  the picked range. */
export interface ChartSpec {
  from: Date;
  to: Date;
  bucket: CostBucket;
  /** Caption tying the chart back to the picked range, e.g. "This month, by day". */
  caption: string;
}

/** A resolved cost window: tiles `[from, to)` plus both chart specs. */
export interface CostRange {
  id: string;
  label: string;
  from: Date;
  to: Date;
  /** The `context` spec — kept under its original name for the callers that
   *  predate the per-chart scope switcher. */
  chart: ChartSpec;
  /** Buckets inside the picked window. */
  detail: ChartSpec;
}

/** The window one chart should plot for `range` at the requested scope. */
export function chartSpecFor(range: CostRange, scope: ChartScope): ChartSpec {
  return scope === "detail" ? range.detail : range.chart;
}

/** Selectable presets, in display order. `month` (this month) is the default. */
export const COST_PRESETS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "month", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "year", label: "This year" },
] as const;

/**
 * Compact x-axis label for a server period key at the given bucket granularity.
 * Keys are local wall-clock: `YYYY-MM-DDTHH` (hour) | `YYYY-MM-DD` (day) |
 * `YYYY-MM` (month). Shared by the net-cost and energy-split charts.
 */
/**
 * Max x-axis tick labels for a bucket, sized so labels don't collide on a
 * ~350px mobile chart (layerchart thins a band domain to every Nth entry).
 * Hover/tooltip still exposes every period; the axis only needs anchors.
 */
export const COST_X_TICKS: Record<CostBucket, number> = { hour: 6, day: 8, month: 6 };

export function periodLabel(key: string, bucket: CostBucket): string {
  if (bucket === "hour") return `${key.slice(11, 13)}:00`;
  if (bucket === "day") {
    return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  }
  return new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, { month: "short" });
}

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);

/** Trailing N calendar months → monthly bars. The 12-month form matches
 *  monthlyEnergy's window. */
function trailingMonths(now: Date, months: number): ChartSpec {
  return {
    from: new Date(now.getFullYear(), now.getMonth() - (months - 1), 1),
    to: now,
    bucket: "month",
    caption: `Last ${months} months`,
  };
}

/** The calendar month `now` falls in, by day — the context one level out from a
 *  single day or a week. */
function thisMonthByDay(now: Date): ChartSpec {
  return { from: startOfMonth(now), to: now, bucket: "day", caption: "This month, by day" };
}

/** "month" (this month) — what an unknown preset id falls back to. */
function thisMonth(now: Date): CostRange {
  const from = startOfMonth(now);
  return {
    id: "month",
    label: "This month",
    from,
    to: now,
    detail: { from, to: now, bucket: "day", caption: "This month, by day" },
    chart: trailingMonths(now, 12),
  };
}

/** Selectable presets: id → concrete range anchored at `now`. */
const PRESET_BUILDERS: Record<string, (now: Date) => CostRange> = {
  today: (now) => {
    const from = startOfDay(now);
    return {
      id: "today",
      label: "Today",
      from,
      to: now,
      detail: { from, to: now, bucket: "hour", caption: "Today, by hour" },
      chart: thisMonthByDay(now),
    };
  },
  // Today plus the six prior days = a rolling 7-day window.
  "7d": (now) => {
    const from = startOfDay(new Date(now.getTime() - 6 * DAY));
    return {
      id: "7d",
      label: "Last 7 days",
      from,
      to: now,
      detail: { from, to: now, bucket: "day", caption: "Last 7 days, by day" },
      chart: thisMonthByDay(now),
    };
  },
  lastMonth: (now) => {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = startOfMonth(now); // exclusive: first of this month
    return {
      id: "lastMonth",
      label: "Last month",
      from,
      to,
      detail: { from, to, bucket: "day", caption: "Last month, by day" },
      chart: trailingMonths(now, 12),
    };
  },
  year: (now) => {
    const from = new Date(now.getFullYear(), 0, 1);
    return {
      id: "year",
      label: "This year",
      from,
      to: now,
      detail: { from, to: now, bucket: "month", caption: "This year, by month" },
      // Two years of bars so this year reads against the whole of the last one.
      chart: trailingMonths(now, 24),
    };
  },
  month: thisMonth,
};

/** Resolve a preset id into a concrete range anchored at `now`. */
export function resolveCostPreset(id: string, now: Date = new Date()): CostRange {
  return (PRESET_BUILDERS[id] ?? thisMonth)(now);
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * Build a custom range from two inclusive calendar days. The tiles window (and
 * the detail chart) extend `to` to the exclusive next-day boundary so the last
 * picked day is included; the detail chart shows daily bars across the picked
 * span, the context chart the trailing 12 months around it.
 */
export function customCostRange(
  from: Date,
  toInclusive: Date,
  now: Date = new Date(),
): CostRange {
  const to = new Date(toInclusive.getTime() + DAY);
  return {
    id: "custom",
    label: `${dateFmt.format(from)} – ${dateFmt.format(toInclusive)}`,
    from,
    to,
    detail: { from, to, bucket: "day", caption: "Custom range, by day" },
    chart: trailingMonths(now, 12),
  };
}
