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
 *
 * ## The io seam
 *
 * The two catalog reads and the clock go through {@link HorizonIo}, defaulted to
 * the production wiring as a parameter so no route changes. What it buys is
 * that the SHAPE READING (text `drop_after` to days, `null` as "kept forever", a
 * record stored as a JSON string) and the MEMO's own rules are provable without a
 * Postgres and a two-month migration — and each of those is a way to get the rule
 * in `./history-horizon.ts` right and still ship #154. The statements themselves
 * are proved by executing them, in `apps/server/db-tests`.
 */
import { db } from "@SunReye/db";
import { jsonDocument } from "@SunReye/db/json-value";
import { migrationHorizonFrom, migrationRecordSchema } from "@SunReye/db/upgrade-state";
import { type SQL, sql } from "drizzle-orm";

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

/** One `timescaledb_information.jobs` row, as both drivers report it. */
export interface RetentionJobRow {
  hypertable_name: string;
  /** `drop_after` in days. TEXT through both drivers, or absent entirely. */
  days: string | null;
}

/** Everything this module touches that is not a decision. */
export interface HorizonIo {
  retentionJobs(): Promise<readonly RetentionJobRow[]>;
  /** The raw `app_settings.value`, which may be the document AS A JSON STRING. */
  migrationDocument(): Promise<unknown>;
  now(): Date;
}

/** The subset of a drizzle client this module needs — `PlantDb`'s shape. */
export interface HorizonDb {
  execute: (query: SQL) => Promise<{ rows: unknown[] }>;
}

/**
 * The real wiring, over a client that is a parameter.
 *
 * A factory rather than a literal so the UNWRAPPING is provable: the migration
 * document is `rows[0].value`, and handing the ROW itself to the parser instead
 * would report "no migration here" on every instance in the middle of one.
 */
// fallow-ignore-next-line unused-export -- the production seam, built below and never named again; exported so ./history-horizon-live.test.ts can build the same two reads over a double and prove the document is the row's `value`.
export function horizonIo(database: HorizonDb = db): HorizonIo {
  return {
    retentionJobs: async () => {
      const result = await database.execute(sql`
        select hypertable_name,
               (extract(epoch from (config->>'drop_after')::interval) / 86400)::text as days
          from timescaledb_information.jobs
         where proc_name = 'policy_retention'`);
      return result.rows as RetentionJobRow[];
    },
    migrationDocument: async () => {
      const result = await database.execute(
        sql`select value from app_settings where key = 'migration.v2'`,
      );
      return (result.rows[0] as { value?: unknown } | undefined)?.value;
    },
    now: () => new Date(),
  };
}

/** The seam every caller gets when it passes none. */
const productionHorizonIo: HorizonIo = horizonIo();

/** Forget the memo — called by whatever advances the migration's stage. */
export function invalidateHistoryLimits(): void {
  cached = null;
}

/** The retention policies and the migration record, from the database. */
// fallow-ignore-next-line unused-export -- the uncached read behind historyLimits below; exported so a test can bypass the memo.
export async function readHistoryLimits(
  io: HorizonIo = productionHorizonIo,
): Promise<HistoryLimits> {
  const jobs = await io.retentionJobs();
  const parsed = migrationRecordSchema.safeParse(jsonDocument(await io.migrationDocument()) ?? {});
  return {
    now: io.now(),
    retention: jobs.map((row) => ({
      hypertableName: row.hypertable_name,
      // TEXT through both drivers. A string here makes every comparison
      // downstream silently false, so the refusal simply stops happening.
      dropAfterDays: row.days === null ? null : Number(row.days),
    })),
    migrationFrom: parsed.success ? migrationHorizonFrom(parsed.data) : null,
  };
}

/** The limits, from the memo when it is fresh. */
// fallow-ignore-next-line unused-export -- the memoized read refuseIncompleteRange below uses; exported for the same reason.
export async function historyLimits(io: HorizonIo = productionHorizonIo): Promise<HistoryLimits> {
  const now = io.now();
  if (cached !== null && now.getTime() - cached.at < TTL_MS) {
    // `now` is re-read even on a cache hit: the retention HORIZON slides with the
    // clock, and a 30-second-old `now` would let a range through 30 seconds after
    // it stopped being complete.
    return { ...cached.limits, now };
  }
  const limits = await readHistoryLimits(io);
  cached = { at: limits.now.getTime(), limits };
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
  io: HorizonIo = productionHorizonIo,
): Promise<IncompleteRangeBody | null> {
  const problem = incompleteRangeProblem(tier, range, await historyLimits(io));
  if (problem === null) return null;
  return {
    error: "history_incomplete",
    reason: problem.reason,
    from: problem.boundary.toISOString(),
    tier: problem.tier,
    message: problem.message,
  };
}
