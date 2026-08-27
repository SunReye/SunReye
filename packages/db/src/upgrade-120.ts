/**
 * THE IN-PLACE UPGRADE FROM ADDON 1.2.0 TO 2.0.0, the decisions half.
 *
 * Read this before `./upgrade-120-run.ts`, which is the same split
 * `./replay.ts` / `./replay-run.ts` uses: everything decidable without a
 * database lives here and is unit-tested; the statements that must be proved by
 * running them live next door and are proved in `apps/server/db-tests`.
 *
 * ## Why a data movement is unavoidable
 *
 * 1.2.0's three continuous aggregates are `GROUP BY bucket, inverter_id,
 * metric`. 2.0.0 re-keys `metrics_raw` to `(device_id int2, metric_id int2)`,
 * which makes those definitions invalid — and a continuous aggregate's
 * definition CANNOT be altered while its materialization hypertable CANNOT be
 * inserted into. A new aggregate over the new `metrics_raw` can therefore only
 * materialize as far back as raw reaches, and 1.2.0's raw retention is SEVEN
 * DAYS. Everything older exists ONLY in the old materialized buckets
 * (minute 90 d, hourly 730 d, daily forever). So the old buckets have to be
 * replayed forward as raw interval rows, which is what `./replay.ts` does.
 *
 * ## The shape of the upgrade: one CHEAP step, then one LONG one
 *
 * `sunreye/config.yaml` sets `timeout: 120` with a watchdog on `/healthz`, and
 * `init-migrate` gates server start. Replaying ~2 months of minute buckets is
 * ~9.1 M rows plus a refresh over the same span for three tiers — measured at
 * ~133 s on a dev box, ALREADY over the timeout, and a Home Assistant box on
 * eMMC is materially slower. So the work is split:
 *
 *  1. THE BLOCKING STEP — catalog only, no data movement, inside the boot chain.
 *     Measured at 0.18 s against the real fixture (512 MB, 9.1 M buckets):
 *
 *       a. {@link detachPolicyStatements}: remove every 1.2.0 policy. This is
 *          the DECISIVE statement, not tidy-up — without it the old minute
 *          tier's 90-day retention keeps dropping buckets while the upgrade
 *          waits for the user to click, and on a ~60-day instance the oldest are
 *          ~30 days from deletion.
 *       b. {@link renameStatements}: `metrics_raw` -> `metrics_raw_legacy` and
 *          each aggregate to a `legacy_` name. VERIFIED on 2.28.2-pg17 (and
 *          pinned by `apps/server/db-tests/toolkit-constructs.test.ts`): the
 *          rename succeeds with dependent continuous aggregates AND compressed
 *          chunks, the aggregates follow automatically, keep every materialized
 *          bucket, stay readable, and the freed name is immediately reusable for
 *          a differently-shaped hypertable.
 *       c. {@link baselinePlan}: apply the 2.0.0 drizzle baseline SELECTIVELY —
 *          the eight relations 1.2.0 already has are skipped, everything else
 *          (the dimension spine, the new `metrics_raw`, `metrics_config_log`,
 *          `spot_prices`, the forecast and battery tables) is created — then the
 *          journal is stamped and the shipped TimescaleDB pipeline creates the
 *          new hypertable and the new aggregate generation under the freed
 *          names.
 *
 *     Afterwards NOTHING of the old schema is live: the legacy hypertable and
 *     its aggregates are inert and policy-free, new readings flow into the new
 *     shape immediately, and `/healthz` answers.
 *
 *  2. THE BACKFILL — long, out of the boot chain, resumable through
 *     `replay_progress`. See `./backfill.ts`.
 *
 * A STAGING COPY WAS CONSIDERED AND REJECTED. It reaches the same end state and
 * costs ~9.3 M row inserts and ~0.5-1 GB of transient uncompressed disk on a box
 * that may be on eMMC, where the rename costs microseconds. Staging stays the
 * documented fallback if a future TimescaleDB rejects the rename; the db-test
 * above is what would catch that.
 *
 * ## There is no legacy read arm
 *
 * Pre-cutover history is simply ABSENT until the backfill runs. A temporary
 * dual-source read path is exactly the machinery this reset exists to delete,
 * and missing history is its own reminder — a deferred migration that leaves the
 * app looking complete never gets run, and the legacy objects then sit on disk
 * forever.
 *
 * What "missing" means is narrower than it sounds: live monitoring is served
 * from memory over the socket, and new readings land in the new schema from the
 * moment the blocking step finishes. So from the first minute the dashboard is
 * live and history STARTS AT THE UPGRADE AND GROWS.
 *
 * THE HAZARD IS PARTIAL WINDOWS, NOT EMPTY ONES. A month-to-date figure whose
 * window opens before the cutover returns a real but INCOMPLETE number, which
 * reads as authoritative and is worse than nothing. {@link horizonProblem} is
 * the one place that decides it, for both causes — a pending backfill and plain
 * retention (issue #154, "a dataset request beyond retention should fail loudly,
 * not silently downgrade resolution").
 */

/**
 * What the catalog says exists, reduced to what the upgrade asks of it.
 *
 * A snapshot rather than a live client, so every decision below is a pure
 * function of it. `./upgrade-120-run.ts` reads it once per step; a decision that
 * needed a second read would be a decision made against a catalog that changed
 * underneath it.
 */
export interface CatalogState {
  /** Public relation names: tables, views and materialized views alike. */
  relations: ReadonlySet<string>;
  indexes: ReadonlySet<string>;
  constraints: ReadonlySet<string>;
  /** Column names per public table. Absent means "no such table". */
  columns: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Old name -> new name, for every relation and index the blocking step moves.
 *
 * Both index names are here because RENAMING A TABLE DOES NOT RENAME ITS
 * INDEXES: 1.2.0's `metrics_raw_time_idx` would survive the table rename under
 * its original name and collide with the identical `CREATE INDEX` in 2.0.0's
 * baseline. That collision is invisible until the baseline runs, which is after
 * the rename has already happened.
 */
export const LEGACY_NAME = {
  minute_rollups: "legacy_minute_rollups",
  hourly_rollups: "legacy_hourly_rollups",
  daily_rollups: "legacy_daily_rollups",
  metrics_raw: "metrics_raw_legacy",
  metrics_raw_time_idx: "metrics_raw_legacy_time_idx",
  metrics_raw_metric_time_idx: "metrics_raw_legacy_metric_time_idx",
} as const satisfies Record<string, string>;

/** 1.2.0's three aggregates, finest first. Order is the refresh order too. */
export const LEGACY_AGGREGATES = ["minute_rollups", "hourly_rollups", "daily_rollups"] as const;

/** The indexes 1.2.0 declared on `metrics_raw`. */
const LEGACY_RAW_INDEXES = ["metrics_raw_time_idx", "metrics_raw_metric_time_idx"] as const;

/** The column that says a `metrics_raw` is 1.x's rather than 2.0.0's. */
const LEGACY_RAW_COLUMN = "inverter_id";

/** Where the upgrade is, as far as the renames are concerned. */
export type UpgradePhase =
  /** Fresh, or already 2.0.0: the baseline and the journal run normally. */
  | "not-needed"
  /** A 1.x database with its original names. The blocking step has work to do. */
  | "rename-pending"
  /** The renames are done — a resumed run, or the step's own second half. */
  | "rename-done"
  /** Two legacy-shaped tables. Refused rather than guessed at. */
  | "ambiguous";

/** Whether `table` exists and carries `column`. */
function hasColumn(state: CatalogState, table: string, column: string): boolean {
  return state.columns.get(table)?.has(column) === true;
}

/**
 * Where this database is in the upgrade.
 *
 * The discriminator is `metrics_raw.inverter_id`, not the table's existence:
 * both 1.2.0 and 2.0.0 have a `metrics_raw`, and `./migrate.ts` learned the hard
 * way that the relations a database is recognised BY must be ones only one
 * generation has.
 *
 * `rename-done` is the case that makes the step safe to re-run at all. Re-running
 * the renames on a database that already has `metrics_raw_legacy` would rename
 * the NEW `metrics_raw` out from under 2.0.0 and hand the freed name to nothing —
 * on a migration that gets one attempt, with the process being killed mid-run
 * (a Supervisor timeout, a power loss) as the expected case rather than the
 * exotic one.
 */
export function classifyUpgrade(state: CatalogState): UpgradePhase {
  const legacyPresent = state.relations.has(LEGACY_NAME.metrics_raw);
  const currentIsLegacyShaped = hasColumn(state, "metrics_raw", LEGACY_RAW_COLUMN);
  if (legacyPresent) return currentIsLegacyShaped ? "ambiguous" : "rename-done";
  return currentIsLegacyShaped ? "rename-pending" : "not-needed";
}

/**
 * Detach every policy 1.2.0 armed, under the names it armed them on.
 *
 * Named BEFORE the rename and therefore under the ORIGINAL names, because a
 * retention or compression policy is keyed on the hypertable's id and FOLLOWS a
 * rename — a list written against the `legacy_` names would remove nothing at
 * all and leave the 90-day minute retention eating the history the upgrade is
 * about to replay.
 *
 * Every statement carries `if_exists`/`if_not_exists`, so the list is a no-op on
 * a database that has already had it applied. That matters because a mid-file
 * failure in the TimescaleDB runner RE-RUNS THE WHOLE FILE, and because the
 * blocking step itself may be killed and restarted.
 *
 * The four policies 1.2.0's `policies.sql` never armed (`daily_rollups`
 * retention, `daily_rollups`/`hourly_rollups` compression) are absent from this
 * list rather than removed defensively: the list is a statement of what 1.2.0
 * HAS, checkable against `git show addon-v1.2.0:packages/db/src/timescale/policies.sql`,
 * and a longer list would stop being that.
 */
export function detachPolicyStatements(): string[] {
  return [
    ...LEGACY_AGGREGATES.map(
      (view) => `select remove_continuous_aggregate_policy('${view}', if_not_exists => true)`,
    ),
    "select remove_retention_policy('minute_rollups', if_exists => true)",
    "select remove_retention_policy('hourly_rollups', if_exists => true)",
    "select remove_retention_policy('metrics_raw', if_exists => true)",
    "select remove_compression_policy('minute_rollups', if_exists => true)",
    "select remove_compression_policy('metrics_raw', if_exists => true)",
  ];
}

/**
 * Move 1.2.0's relations out of the names 2.0.0's baseline needs.
 *
 * Guarded by the catalog rather than by `IF EXISTS` (which `ALTER … RENAME` does
 * offer) because the guard has to be on the ABSENCE OF THE TARGET as well: the
 * dangerous re-run is not "the source is gone", it is "the source is now the new
 * table". So a rename is emitted only when the old name is present AND the new
 * name is free.
 *
 * `materialized_only = true` comes first, and it is not cosmetic. 1.2.0 leaves
 * all three aggregates with real-time aggregation on, so every read of a legacy
 * view — including the `min(bucket)`/`max(bucket)` the replay plans from — unions
 * a live scan of `metrics_raw_legacy` on top of the materialized buckets. After
 * the cutover nothing writes to that table ever again, so the live arm can only
 * cost time and blur the line between "what 1.2.0 materialized" (which the
 * replay carries) and "what is still in raw" (which the cutover carries across
 * directly). Turning it off makes the legacy view exactly the record it is.
 */
export function renameStatements(state: CatalogState): string[] {
  const statements: string[] = [];
  const pending = LEGACY_AGGREGATES.filter(
    (view) => state.relations.has(view) && !state.relations.has(LEGACY_NAME[view]),
  );
  for (const view of pending) {
    statements.push(`alter materialized view ${view} set (timescaledb.materialized_only = true)`);
  }
  for (const view of pending) {
    statements.push(`alter materialized view ${view} rename to ${LEGACY_NAME[view]}`);
  }
  if (state.relations.has("metrics_raw") && !state.relations.has(LEGACY_NAME.metrics_raw)) {
    statements.push(`alter table metrics_raw rename to ${LEGACY_NAME.metrics_raw}`);
  }
  for (const index of LEGACY_RAW_INDEXES) {
    if (state.indexes.has(index) && !state.indexes.has(LEGACY_NAME[index])) {
      statements.push(`alter index ${index} rename to ${LEGACY_NAME[index]}`);
    }
  }
  return statements;
}

/** One statement of the drizzle baseline, typed by what object it creates. */
export type BaselineStatement =
  | { kind: "table"; name: string; columns: string[]; text: string }
  | { kind: "index"; name: string; text: string }
  | { kind: "constraint"; name: string; table: string; text: string };

/** A quoted lower-case identifier, as drizzle emits them. */
const NAME = '"([a-z_][a-z0-9_]*)"';

const CREATE_TABLE = new RegExp(`^CREATE TABLE ${NAME}\\s*\\(`, "i");
const CREATE_INDEX = new RegExp(`^CREATE (?:UNIQUE )?INDEX ${NAME} ON `, "i");
const ADD_CONSTRAINT = new RegExp(`^ALTER TABLE ${NAME} ADD CONSTRAINT ${NAME}(?=\\s|$)`, "i");

/**
 * The column names a `CREATE TABLE` body declares.
 *
 * Line-oriented because that is what drizzle emits and because the alternative —
 * splitting the body on commas — would have to understand
 * `PRIMARY KEY("zone","slot_start")`. An inline `CONSTRAINT …` line is skipped:
 * treating `spot_prices_zone_slot_start_pk` as a column would make the existence
 * check below fail on a table that is perfectly correct.
 */
function declaredColumns(text: string): string[] {
  const columns: string[] = [];
  for (const line of text.split("\n").slice(1)) {
    const trimmed = line.trim();
    if (/^CONSTRAINT\b/i.test(trimmed)) continue;
    const match = /^"([a-z_][a-z0-9_]*)"\s+\S/.exec(trimmed);
    if (match?.[1]) columns.push(match[1]);
  }
  return columns;
}

/**
 * Type one baseline statement, or REFUSE it.
 *
 * The refusal is the whole safety of the selective apply. An unrecognised
 * statement has two possible silent treatments and both are wrong: running it
 * blindly may fail on an object 1.2.0 already has (leaving a half-applied
 * baseline with no journal row), and skipping it may leave out something the app
 * needs (leaving a journal row that records success). Neither is discoverable
 * afterwards, and this runs once, on one instance.
 *
 * So the shapes are enumerated, and `baselinePlan` turns anything else into a
 * refusal that names the statement. `baselinePlan`'s own test walks the SHIPPED
 * `0000_baseline.sql` and asserts every statement classifies, so a future
 * baseline that grows a new shape fails in `bun run test` rather than mid-upgrade.
 */
export function classifyBaselineStatement(text: string): BaselineStatement {
  const trimmed = text.trim();
  const table = CREATE_TABLE.exec(trimmed);
  if (table?.[1]) {
    return { kind: "table", name: table[1], columns: declaredColumns(trimmed), text };
  }
  const index = CREATE_INDEX.exec(trimmed);
  if (index?.[1]) return { kind: "index", name: index[1], text };
  const constraint = ADD_CONSTRAINT.exec(trimmed);
  if (constraint?.[1] && constraint[2]) {
    return { kind: "constraint", name: constraint[2], table: constraint[1], text };
  }
  throw new Error(
    `upgrade-120: cannot classify baseline statement, so it can be neither applied nor ` +
      `skipped safely: ${trimmed.slice(0, 120)}`,
  );
}

/** What to run, what is already there, and what must stop the upgrade. */
export interface BaselineApplyPlan {
  run: string[];
  /** Statements whose object already exists, with the reason, for the log. */
  skipped: string[];
  /** Anything that must NOT be silently resolved. Non-empty means refuse. */
  refusals: string[];
}

/**
 * Which of the baseline's statements a 1.2.0 database still needs.
 *
 * This is `CREATE … IF NOT EXISTS` applied from outside, and it exists because
 * the alternative is worse: hand-writing the DDL a 1.2.0 database is missing
 * duplicates ~200 lines of the baseline, and the copy drifts the first time the
 * baseline changes. Here the shipped file stays the single source, and
 * `apps/server/db-tests/upgrade.test.ts` compares the upgraded schema against a
 * freshly baselined one, so drift fails a test rather than a production upgrade.
 *
 * A SKIPPED TABLE IS CHECKED, not assumed. The eight relations 1.2.0 shares with
 * 2.0.0 are byte-identical in the two baselines today, but "identical today" is
 * not a property the upgrade can rest on, and a table that exists with the wrong
 * columns is exactly the failure that would look like success: the journal would
 * record the baseline as applied over a table the app's queries name columns on.
 * So every declared column must be present, and a missing one is a refusal that
 * names it. Extra columns are allowed — a 1.x database may carry more, and
 * nothing 2.0.0 does is harmed by one.
 */
export function baselinePlan(
  statements: readonly string[],
  state: CatalogState,
): BaselineApplyPlan {
  const plan: BaselineApplyPlan = { run: [], skipped: [], refusals: [] };
  for (const text of statements) {
    let parsed: BaselineStatement;
    try {
      parsed = classifyBaselineStatement(text);
    } catch (error) {
      plan.refusals.push((error as Error).message);
      continue;
    }
    if (parsed.kind === "table") {
      const live = state.columns.get(parsed.name);
      if (!live) {
        plan.run.push(text);
        continue;
      }
      const missing = parsed.columns.filter((column) => !live.has(column));
      if (missing.length > 0) {
        plan.refusals.push(
          `upgrade-120: table "${parsed.name}" already exists but is missing the column(s) ` +
            `${missing.join(", ")} that the 2.0.0 baseline declares. Stamping the baseline over ` +
            `it would record success for a schema the app cannot query. Restore the ` +
            `pre-upgrade backup.`,
        );
        continue;
      }
      plan.skipped.push(`table ${parsed.name} (already present)`);
      continue;
    }
    const present =
      parsed.kind === "index" ? state.indexes.has(parsed.name) : state.constraints.has(parsed.name);
    if (present) plan.skipped.push(`${parsed.kind} ${parsed.name} (already present)`);
    else plan.run.push(text);
  }
  return plan;
}

/**
 * Where the BUCKET replay must stop, so it cannot double-write the span the
 * retained legacy raw is carried across from.
 *
 * The two sources overlap by construction: 1.2.0's minute tier is refreshed to
 * within a minute of now, and its raw holds the last seven days, so the last
 * seven days exist in BOTH. Replaying a minute bucket over a span that also
 * receives its own raw samples would put an interval row and the samples inside
 * it on the same series — a double count, which `./replay.ts` calls the one error
 * a replay must never make.
 *
 * `rawFrom` of `null` is a real case rather than a defensive branch: an addon
 * stopped for longer than the retention window comes back with every raw chunk
 * dropped and only buckets left. Stopping the replay at "no raw" would silently
 * drop the most recent history, which is the part the operator looks at first.
 * The cutover instant is the answer then, and it is also the ceiling — raw
 * stamped past the cutover (a clock that moved) must not push the replay past
 * the point where the NEW table starts receiving.
 */
export function replayEnd(rawFrom: Date | null, cutover: Date): Date {
  if (rawFrom === null) return cutover;
  return rawFrom.getTime() < cutover.getTime() ? rawFrom : cutover;
}

/** The longest gap that can still be a poll cadence rather than an outage. */
const MAX_CADENCE_MS = 3_600_000;

/**
 * The `dur_ms` a carried 1.2.0 raw row gets: the MEDIAN inter-sample gap.
 *
 * 1.2.0's writer stored every sample at a fixed cadence — change-encoding arrived
 * after it, in #117 — so every raw row stands for one cadence step, and one
 * number is the honest answer for all of them. It is measured rather than
 * assumed because the cadence is an addon option (`poll_interval_ms`) and the
 * fixture's is 60 s while a live install's is 1 s.
 *
 * The MEDIAN, not the mean or the max: a restart, a compression window or a night
 * the addon was down leaves a multi-hour gap, and letting it stretch every row's
 * claimed hold would overstate the energy integral `battery/health.ts` and
 * `battery/capacity-estimate.ts` compute from `dur_ms`.
 *
 * `null` — meaning "write no duration" — for every answer that is not a cadence:
 * no samples, a non-positive gap (duplicate timestamps), or something longer than
 * an hour. `metrics_raw.dur_ms` is nullable and the readers already fall back, so
 * an absent duration is a supported state; a fabricated one is not.
 */
export function cadenceMs(gaps: readonly number[]): number | null {
  const positive = gaps.filter((gap) => gap > 0).sort((a, b) => a - b);
  if (positive.length === 0) return null;
  const median = positive[Math.floor((positive.length - 1) / 2)];
  if (median === undefined || median > MAX_CADENCE_MS) return null;
  return median;
}

/** Why the store cannot answer before {@link HistoryHorizon.from}. */
export type HistoryLimitReason = "migration-pending" | "retention";

/** The oldest instant the store can answer COMPLETELY, and why. */
export interface HistoryHorizon {
  from: Date;
  reason: HistoryLimitReason;
}

/** A refused range: what was asked, where the data starts, and why. */
export interface HorizonProblem {
  reason: HistoryLimitReason;
  /** The oldest instant that can be answered — the number to show the user. */
  boundary: Date;
  message: string;
}

const REASON_TEXT: Record<HistoryLimitReason, string> = {
  "migration-pending":
    "history from before the 2.0.0 upgrade has not been migrated yet — run the history " +
    "migration to bring it back",
  retention: "history that old has passed the retention horizon and no longer exists",
};

/**
 * Refuse a range that begins before the store's horizon.
 *
 * THE POINT IS THE PARTIAL WINDOW. An empty answer is obvious; a month-to-date
 * or year-to-date figure whose window opens before the horizon is a real number
 * computed over a fraction of the range it claims, and it reads as
 * authoritative. Both causes are the same defect — a request that cannot be
 * answered completely, answered anyway — so both are decided here: a pending
 * backfill (this upgrade) and plain retention (issue #154, "a dataset request
 * beyond retention should fail loudly, not silently downgrade resolution").
 *
 * The boundary is inclusive: a range that STARTS at the horizon is complete, and
 * that is what lets the UI offer "show me what there is" as a one-click
 * narrowing rather than a guess. A range entirely before the horizon is refused
 * too, on purpose — the honest-looking empty chart is the most misleading answer
 * of the three, because a flat zero line is indistinguishable from a plant that
 * produced nothing.
 */
export function horizonProblem(
  range: { from: Date; to: Date },
  horizon: HistoryHorizon | null,
): HorizonProblem | null {
  if (horizon === null) return null;
  if (range.from.getTime() >= horizon.from.getTime()) return null;
  return {
    reason: horizon.reason,
    boundary: horizon.from,
    message:
      `The requested range starts ${range.from.toISOString()} but this instance can only ` +
      `answer from ${horizon.from.toISOString()}: ${REASON_TEXT[horizon.reason]}. ` +
      `Answering it would return a real but incomplete number for the whole range.`,
  };
}

/** Milliseconds in a day. */
const DAY_MS = 86_400_000;

/**
 * The oldest instant a read can be answered COMPLETELY, or `null` for "nothing
 * is missing".
 *
 * TWO CAUSES, ONE ANSWER — and the third case, which is the one a naive
 * implementation gets wrong. It is tempting to make the horizon
 * `min(time) from metrics_raw`, since that IS the oldest row. But on a healthy
 * install that number is just when the install started, and refusing a
 * "this year" chart because the plant was commissioned in March would be absurd.
 * Data being ABSENT is not data being MISSING. So the horizon is only ever set by
 * something that DESTROYED or WITHHELD data that existed:
 *
 *  * `retentionDays` — a `drop_after` policy. Everything older than
 *    `now - drop_after` was deleted by a retention job, and asking for it gets a
 *    real number computed over the surviving fraction. This is issue #154, "a
 *    dataset request beyond retention should fail loudly, not silently downgrade
 *    resolution", and it is per-TIER: the minute aggregates keep 90 days and the
 *    hourly ones 3650, so the caller passes the retention of the tier that would
 *    answer rather than one global number.
 *  * `migrationFrom` — this upgrade. While the backfill has not finished, the
 *    pre-cutover span exists only in the inert `legacy_*` relations, which no
 *    read path touches by design.
 *
 * The MORE RESTRICTIVE wins, and the reason travels with it: telling an operator
 * "retention" when the real cause is a migration they can still run would send
 * them looking for a setting instead of a button.
 *
 * `retentionDays` distinguishes `0` from `null` deliberately — "drop everything
 * immediately" and "no policy at all" are opposite instructions, and a `||`
 * would read the first as the second. A negative value is not a policy (that is
 * how `dump.sh` and `timescaledb_information.jobs` spell "none") and is ignored.
 */
export function historyHorizon(input: {
  now: Date;
  retentionDays: number | null;
  migrationFrom: Date | null;
}): HistoryHorizon | null {
  const candidates: HistoryHorizon[] = [];
  if (input.retentionDays !== null && input.retentionDays >= 0) {
    candidates.push({
      from: new Date(input.now.getTime() - input.retentionDays * DAY_MS),
      reason: "retention",
    });
  }
  if (input.migrationFrom !== null) {
    candidates.push({ from: input.migrationFrom, reason: "migration-pending" });
  }
  return candidates.reduce<HistoryHorizon | null>(
    (best, candidate) =>
      best === null || candidate.from.getTime() > best.from.getTime() ? candidate : best,
    null,
  );
}
