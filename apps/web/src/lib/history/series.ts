/**
 * WHAT A DEVICE'S SERIES IS, and the two things every consumer does to one.
 *
 * The vocabulary half of `./device-series.ts`, kept apart from the fetching for
 * one reason: the fetcher reaches `$lib/api`, which reaches `$app/environment`,
 * which does not exist under `bun test`. A row builder that imported it could
 * not be unit-tested at all — so the types and the two pure operations live
 * here, and every builder imports this instead. See `apps/web/TESTING.md`.
 */

/** The rollup tiers the read path offers. */
export type SeriesBucket = "minute" | "hour" | "day";

export interface SeriesWindow {
  from: Date;
  to: Date;
  /** Defaults to the minute tier — the only one two devices can be joined on. */
  bucket?: SeriesBucket;
}

/** One series of one device: what the caller names, resolved by the server. */
export interface SeriesRef {
  metric: string;
  /**
   * `devices.slug`. Omitted, the server answers for the plant's default source —
   * which is what an inverter metric wants and what an `optimizer.*` metric must
   * never rely on.
   */
  inverterId?: string;
}

/**
 * A bucketed series as `epoch ms → value`.
 *
 * A Map rather than an array because every caller joins several of these by
 * timestamp, and a Map is the shape that makes the join a lookup rather than a
 * scan. An absent key is an absent reading — never a zero.
 */
export type MetricSeries = Map<number, number>;

/**
 * Every timestamp any of these series carries, oldest first.
 *
 * The union rather than one series' keys: a plant whose optimizer decided
 * through a night its inverter reported nothing for still has decisions to plot,
 * and anchoring on a chosen "primary" series would drop them.
 */
export function seriesTimestamps(...series: readonly MetricSeries[]): number[] {
  const all = new Set<number>();
  for (const one of series) for (const t of one.keys()) all.add(t);
  return [...all].sort((a, b) => a - b);
}

/**
 * Plot-point ceiling. Past roughly this many, extra path nodes are sub-pixel on
 * any real chart width and cost only render time.
 */
// fallow-ignore-next-line unused-export -- the cap is asserted by decision-series.test.ts; web test files aren't traced as consumers
export const MAX_PLOT_POINTS = 720;

/** Every n-th item so at most `max` remain; the newest is always kept. */
export function decimate<T>(items: readonly T[], max: number = MAX_PLOT_POINTS): T[] {
  const step = Math.ceil(items.length / max);
  if (step <= 1) return [...items];
  const kept = items.filter((_, i) => i % step === 0);
  const last = items.at(-1);
  if (last !== undefined && kept.at(-1) !== last) kept.push(last);
  return kept;
}
