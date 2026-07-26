// Time-range model shared by the history page and its date-range picker. A
// `HistoryRange` is either the realtime `live` buffer or a concrete `[from, to)`
// window; the rollup bucket is derived from the span so a 12-month chart stays
// cheap while an hour chart stays detailed.
import type { ManifestMetric } from "./types";

export type RollupBucket = "minute" | "hour" | "day";

/** A resolved window the charts render against. */
export type HistoryRange = {
  id: string;
  label: string;
  /** true = realtime live-buffer mode (no rollup fetch, gliding chart). */
  live: boolean;
  from: Date;
  to: Date;
  bucket: RollupBucket;
};

/** A selectable entry in {@link PRESETS}; `live` and `hours` are mutually exclusive. */
export type Preset = { id: string; label: string; live?: boolean; hours?: number };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Selectable presets, in display order. `live` is the default. */
export const PRESETS: readonly Preset[] = [
  { id: "live", label: "Live", live: true },
  { id: "1h", label: "1 hour", hours: 1 },
  { id: "6h", label: "6 hours", hours: 6 },
  { id: "24h", label: "24 hours", hours: 24 },
  { id: "7d", label: "Last week", hours: 24 * 7 },
  { id: "14d", label: "Last 14 days", hours: 24 * 14 },
  { id: "30d", label: "Last month", hours: 24 * 30 },
  { id: "6mo", label: "Last 6 months", hours: 24 * 182 },
  { id: "12mo", label: "Last 12 months", hours: 24 * 365 },
];

/**
 * Pick a rollup granularity. Minute resolution up to and including the
 * last-week (7-day) window; hourly beyond that. A 7-day minute series is
 * ~10k points, so callers must request a limit that covers it (see
 * entity-history-card).
 */
function bucketForSpan(ms: number): RollupBucket {
  if (ms <= 7 * DAY) return "minute";
  return "hour";
}

/** Trailing window the live sparkline buffer covers (matches the store). */
const LIVE_WINDOW_MS = 5 * 60 * 1000;

/** Resolve a preset id into a concrete range anchored at `now`. */
export function resolvePreset(id: string, now: Date = new Date()): HistoryRange {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  if (p.live) {
    return {
      id: p.id,
      label: p.label,
      live: true,
      from: new Date(now.getTime() - LIVE_WINDOW_MS),
      to: now,
      bucket: "minute",
    };
  }
  const from = new Date(now.getTime() - (p.hours ?? 24) * HOUR);
  return {
    id: p.id,
    label: p.label,
    live: false,
    from,
    to: now,
    bucket: bucketForSpan(now.getTime() - from.getTime()),
  };
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * Build a custom range from two inclusive calendar days. The label shows the
 * days the user picked, while the query window extends `to` to the exclusive
 * next-day boundary so the last day's data is included in `[from, to)`.
 */
export function customRange(from: Date, toInclusive: Date): HistoryRange {
  const to = new Date(toInclusive.getTime() + DAY);
  return {
    id: "custom",
    label: `${dateFmt.format(from)} – ${dateFmt.format(toInclusive)}`,
    live: false,
    from,
    to,
    bucket: bucketForSpan(to.getTime() - from.getTime()),
  };
}

/** Local midnight starting the calendar day `d` falls in. */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * A single local calendar day `[00:00, next 00:00)` for the day-stepper. Bounds
 * are computed from date parts (not `+DAY`) so DST-shortened/lengthened days
 * still cover exactly one civil day. Minute rollups: a day is well within the
 * ≤7-day minute window.
 */
export function dayRange(anchor: Date): HistoryRange {
  const from = startOfLocalDay(anchor);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
  return {
    id: "day",
    label: dateFmt.format(from),
    live: false,
    from,
    to,
    bucket: "minute",
  };
}

/** Only measurement/cumulative metrics carry a numeric time series worth charting. */
export function isChartable(metric: ManifestMetric): boolean {
  return metric.kind === "measurement" || metric.kind === "cumulative";
}

const ROLE_CATEGORY: Record<string, string> = {
  pv: "Solar",
  production: "Solar",
  battery: "Battery",
  grid: "Grid",
  load: "Backup / Load",
  consumption: "Consumption",
  generator: "Generator",
  inverter: "Inverter",
};

/** Human category a metric belongs to — by canonical role prefix, else its group. */
function categoryOf(metric: ManifestMetric): string {
  const prefix = metric.role?.split(".")[0];
  if (prefix && ROLE_CATEGORY[prefix]) return ROLE_CATEGORY[prefix];
  const g = metric.group || "Other";
  return g.charAt(0).toUpperCase() + g.slice(1);
}

/** Filter metrics by a free-text query over label and key (empty → unchanged). */
export function filterMetrics(metrics: ManifestMetric[], query: string): ManifestMetric[] {
  const q = query.trim().toLowerCase();
  if (!q) return metrics;
  return metrics.filter(
    (m) => m.label.toLowerCase().includes(q) || m.key.toLowerCase().includes(q),
  );
}

/** Group metrics by category, sorted alphabetically; metrics keep their order. */
export function groupByCategory(metrics: ManifestMetric[]): [string, ManifestMetric[]][] {
  const map = new Map<string, ManifestMetric[]>();
  for (const m of metrics) {
    const cat = categoryOf(m);
    const arr = map.get(cat) ?? [];
    arr.push(m);
    map.set(cat, arr);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
