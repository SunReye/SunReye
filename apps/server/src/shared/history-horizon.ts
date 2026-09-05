/**
 * REFUSING A RANGE THAT CANNOT BE ANSWERED COMPLETELY.
 *
 * Issue #154 asks that "a dataset request beyond retention should fail loudly,
 * not silently downgrade resolution". The 1.2.0 -> 2.0.0 upgrade creates the same
 * defect from the other end: while its backfill is pending, everything before the
 * cutover lives only in the inert `legacy_*` relations, which no read path
 * touches by design (`packages/db/src/upgrade-120.ts` — there is no legacy read
 * arm, deliberately). One guard answers both.
 *
 * ## Why an empty answer is not the problem
 *
 * An empty chart is obvious. The hazard is the PARTIAL WINDOW: a month-to-date or
 * year-to-date figure whose window opens before the boundary is a real number
 * computed over a fraction of the range it claims, rendered exactly like a
 * complete one. It is worse than nothing, because nothing prompts a question.
 *
 * ## Why it is per TIER
 *
 * The tiers keep different horizons — raw 1825 days, `minute_rollups` 90,
 * `hourly_rollups` 3650, `daily_rollups` forever — so "beyond retention" is not
 * one number. A year-long window is complete at day resolution and truncated at
 * minute resolution, and the honest answer to the second is "ask for a wider
 * bucket", which the refusal can only say if it knows which tier was asked.
 *
 * ## Why absence is not the same as loss
 *
 * The horizon is NEVER `min(time)`. On a healthy install that is just when the
 * install started, and refusing a "this year" chart because the plant was
 * commissioned in March would be absurd. Only something that DESTROYED or
 * WITHHELD data sets a horizon: a retention policy, or a pending migration. See
 * `historyHorizon` in `packages/db/src/upgrade-120.ts`.
 */

import {
  type HistoryHorizon,
  type HorizonProblem,
  historyHorizon,
  horizonProblem,
} from "@SunReye/db/upgrade-120";

/** The resolutions a read can ask for, plus the raw hypertable. */
export type HistoryTier = "raw" | "minute" | "hour" | "day";

/**
 * Which relation answers each tier — and therefore whose retention applies.
 *
 * Getting this backwards would enforce somebody else's horizon: the minute tier
 * keeps 90 days and the hourly one 3650, so a swap either refuses valid reads or
 * lets partial ones through, which is the whole defect.
 */
// fallow-ignore-next-line unused-export -- the tier-to-relation map, proved by ./history-horizon.test.ts because getting it backwards enforces the wrong tier's retention; retentionDaysFor below is its in-file reader.
export const BUCKET_RELATION: Record<HistoryTier, string> = {
  raw: "metrics_raw",
  minute: "minute_rollups",
  hour: "hourly_rollups",
  day: "daily_rollups",
};

/** One retention policy, as `timescaledb_information.jobs` reports it. */
export interface RetentionRow {
  hypertableName: string;
  /** `drop_after` in days, or `null` for "kept forever". */
  dropAfterDays: number | null;
}

/**
 * The `drop_after` of the tier that answers `tier`, in days, or `null`.
 *
 * `null` means KEPT FOREVER, which is a real state — `daily_rollups` ships with
 * no retention policy at all — and is the opposite of `0`. Conflating them would
 * refuse every read of the one tier that holds the whole history.
 */
// fallow-ignore-next-line unused-export -- read by incompleteRangeProblem below; exported so ./history-horizon.test.ts can pin null (kept forever) against 0, which are opposites.
export function retentionDaysFor(rows: readonly RetentionRow[], tier: HistoryTier): number | null {
  const relation = BUCKET_RELATION[tier];
  const row = rows.find((r) => r.hypertableName === relation);
  return row?.dropAfterDays ?? null;
}

/** Everything the decision needs, so the decision itself is pure. */
export interface HistoryLimits {
  now: Date;
  retention: readonly RetentionRow[];
  /** The oldest instant the new schema holds while a migration is incomplete. */
  migrationFrom: Date | null;
}

/** A refused range, with the tier that was asked for. */
export interface TieredHorizonProblem extends HorizonProblem {
  tier: HistoryTier;
}

/**
 * The reason this range cannot be answered completely at this resolution, or
 * `null`.
 *
 * A REVERSED range returns `null`: it is empty by construction and the route's
 * own validation owns it. Turning it into a story about missing history would
 * send an operator looking for a migration button over a typo.
 */
export function incompleteRangeProblem(
  tier: HistoryTier,
  range: { from: Date; to: Date },
  limits: HistoryLimits,
): TieredHorizonProblem | null {
  if (range.to.getTime() <= range.from.getTime()) return null;
  const horizon: HistoryHorizon | null = historyHorizon({
    now: limits.now,
    retentionDays: retentionDaysFor(limits.retention, tier),
    migrationFrom: limits.migrationFrom,
  });
  const problem = horizonProblem(range, horizon);
  return problem === null ? null : { ...problem, tier };
}
