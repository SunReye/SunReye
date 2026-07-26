// Time-range model for the Costs page. A `CostRange` carries two windows: the
// `[from, to)` the headline tiles are priced over, and a `chart` spec — the
// "one level up" context the range-driven bar chart shows (e.g. picking a single
// month charts the trailing 12 months). Kept separate from the History page's
// `ranges.ts`, which models the live buffer / rollup granularity for entity
// charts — different concern, different shape.

const DAY = 86_400_000;

/** Bar granularity of the contextual cost chart. */
export type CostBucket = "hour" | "day" | "month";

/** A resolved cost window: tiles `[from, to)` plus the contextual chart spec —
 *  what the range-driven bar chart renders (may be wider than the tiles window). */
export interface CostRange {
  id: string;
  label: string;
  from: Date;
  to: Date;
  chart: {
    from: Date;
    to: Date;
    bucket: CostBucket;
    /** Caption tying the chart back to the picked range, e.g. "This month, by day". */
    caption: string;
  };
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

/** Trailing 12 calendar months → monthly bars. Matches monthlyEnergy's window. */
function trailing12Months(now: Date): CostRange["chart"] {
  return {
    from: new Date(now.getFullYear(), now.getMonth() - 11, 1),
    to: now,
    bucket: "month",
    caption: "Last 12 months",
  };
}

/** "month" (this month) — what an unknown preset id falls back to. */
function thisMonth(now: Date): CostRange {
  const from = startOfMonth(now);
  return {
    id: "month",
    label: "This month",
    from,
    to: now,
    chart: { from, to: now, bucket: "day", caption: "This month, by day" },
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
      chart: { from, to: now, bucket: "hour", caption: "Today, by hour" },
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
      chart: { from, to: now, bucket: "day", caption: "Last 7 days, by day" },
    };
  },
  lastMonth: (now) => ({
    id: "lastMonth",
    label: "Last month",
    from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
    to: startOfMonth(now), // exclusive: first of this month
    chart: trailing12Months(now),
  }),
  year: (now) => ({
    id: "year",
    label: "This year",
    from: new Date(now.getFullYear(), 0, 1),
    to: now,
    chart: trailing12Months(now),
  }),
  month: thisMonth,
};

/** Resolve a preset id into a concrete range anchored at `now`. */
export function resolveCostPreset(id: string, now: Date = new Date()): CostRange {
  return (PRESET_BUILDERS[id] ?? thisMonth)(now);
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * Build a custom range from two inclusive calendar days. The tiles window (and
 * the chart) extend `to` to the exclusive next-day boundary so the last picked
 * day is included; the chart shows daily bars across the picked span.
 */
export function customCostRange(from: Date, toInclusive: Date): CostRange {
  const to = new Date(toInclusive.getTime() + DAY);
  return {
    id: "custom",
    label: `${dateFmt.format(from)} – ${dateFmt.format(toInclusive)}`,
    from,
    to,
    chart: { from, to, bucket: "day", caption: "Custom range, by day" },
  };
}
