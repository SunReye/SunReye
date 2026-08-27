/**
 * READING THE LIVE HORIZONS, and refusing a range against them.
 *
 * The database-touching half of `./history-horizon.ts`, which holds the decision.
 * Separated for the reason the decision is worth having on its own: whether a
 * month-to-date figure is allowed to be answered from a fraction of its window is
 * a rule, and a rule deserves a test that does not need a Postgres and a
 * two-month migration to run. `./history-horizon.test.ts` drives that rule; this
 * module is the two catalog queries and a memo around it.
 *
 * ## Why it is memoized, and why `now` is not
 *
 * A read per request would put two catalog queries on every chart load for numbers
 * that change when a retention policy is edited or a migration finishes — minutes
 * apart at the fastest. But the horizon SLIDES WITH THE CLOCK, so `now` is re-read
 * even on a cache hit: a 30-second-old `now` would let a range through 30 seconds
 * after it stopped being complete.
 */
import { db } from "@SunReye/db";
import { jsonDocument } from "@SunReye/db/json-value";
import { migrationHorizonFrom, migrationRecordSchema } from "@SunReye/db/upgrade-state";
import { sql } from "drizzle-orm";

import type { HorizonProblem } from "@SunReye/db/upgrade-120";

import { type HistoryLimits, type HistoryTier, incompleteRangeProblem } from "./history-horizon";

/**
 * The live limits, memoized with a short TTL.
 *
 * A read per request would put two catalog queries on every chart load for
 * numbers that change when a policy is edited (a migrate run) or a migration
 * finishes — minutes apart at the fastest. The TTL is short enough that a
 * finished backfill stops being reported as pending on its own, and
 * {@link invalidateHistoryLimits} makes it immediate for the code that knows.
 */
const TTL_MS = 30_000;
let cached: { at: number; limits: HistoryLimits } | null = null;

/** Forget the memo — called by whatever advances the migration's stage. */
export function invalidateHistoryLimits(): void {
  cached = null;
}

/** The retention policies and the migration record, from the database. */
// fallow-ignore-next-line unused-export -- the uncached read behind historyLimits below; exported so a test can bypass the memo.
export async function readHistoryLimits(): Promise<HistoryLimits> {
  const retention = await db.execute<{ hypertable_name: string; days: string | null }>(sql`
    select hypertable_name,
           (extract(epoch from (config->>'drop_after')::interval) / 86400)::text as days
      from timescaledb_information.jobs
     where proc_name = 'policy_retention'`);
  const record = await db.execute<{ value: unknown }>(
    sql`select value from app_settings where key = 'migration.v2'`,
  );
  const parsed = migrationRecordSchema.safeParse(
    jsonDocument((record.rows[0] as { value?: unknown } | undefined)?.value) ?? {},
  );
  return {
    now: new Date(),
    retention: (retention.rows as { hypertable_name: string; days: string | null }[]).map(
      (row) => ({
        hypertableName: row.hypertable_name,
        dropAfterDays: row.days === null ? null : Number(row.days),
      }),
    ),
    migrationFrom: parsed.success ? migrationHorizonFrom(parsed.data) : null,
  };
}

/** The limits, from the memo when it is fresh. */
// fallow-ignore-next-line unused-export -- the memoized read refuseIncompleteRange below uses; exported for the same reason.
export async function historyLimits(): Promise<HistoryLimits> {
  if (cached !== null && Date.now() - cached.at < TTL_MS) {
    // `now` is re-read even on a cache hit: the retention HORIZON slides with the
    // clock, and a 30-second-old `now` would let a range through 30 seconds after
    // it stopped being complete.
    return { ...cached.limits, now: new Date() };
  }
  const limits = await readHistoryLimits();
  cached = { at: Date.now(), limits };
  return limits;
}

/** The body a refused range answers with. `422`, not `404`: the range is wrong. */
export interface IncompleteRangeBody {
  error: "history_incomplete";
  reason: HorizonProblem["reason"];
  /** The oldest instant that CAN be answered — what the UI offers to clamp to. */
  from: string;
  tier: HistoryTier;
  message: string;
}

/**
 * Refuse a range this instance cannot answer completely, or return `null`.
 *
 * The one call every range-taking route makes. It returns a BODY rather than
 * throwing so each route keeps its own status helper and its own shape, which is
 * how the guard could be added to six endpoints without changing any of their
 * contracts.
 */
export async function refuseIncompleteRange(
  tier: HistoryTier,
  range: { from: Date; to: Date },
): Promise<IncompleteRangeBody | null> {
  const problem = incompleteRangeProblem(tier, range, await historyLimits());
  if (problem === null) return null;
  return {
    error: "history_incomplete",
    reason: problem.reason,
    from: problem.boundary.toISOString(),
    tier: problem.tier,
    message: problem.message,
  };
}
