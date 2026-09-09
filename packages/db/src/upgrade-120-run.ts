/**
 * THE IN-PLACE UPGRADE FROM ADDON 1.2.0 TO 2.0.0, the execution half.
 *
 * `./upgrade-120.ts` holds the *why* and every decision that can be made without
 * a database; this file is the part that must be proved by running it, and it is:
 * `apps/server/db-tests/upgrade.test.ts` executes every statement below against a
 * RESTORED addon-1.2.0 fixture, and `scripts/upgrade-rehearsal.ts` runs the whole
 * upgrade end to end against it.
 *
 * ## Two entry points, and why the boundary is where it is
 *
 *  * {@link runBlockingUpgrade} — CATALOG ONLY, inside the addon's boot chain
 *    (`sunreye/config.yaml` sets `timeout: 120` and `init-migrate` gates server
 *    start). Measured at 0.18 s against the real 512 MB fixture. It ends with the
 *    2.0.0 schema live, the 1.2.0 objects inert and policy-free, and a migration
 *    record saying what is still missing.
 *  * {@link carryLegacyRaw} and the backfill (`./backfill.ts`) — DATA, out of the
 *    boot chain, resumable. ~9.1 M rows and a refresh over the same span is
 *    ~133 s on a dev box, already over the Supervisor's timeout.
 *
 * ## Everything that moves rows goes through `./replay-run.ts`
 *
 * Including the retained raw window, which is why `ReplayRequest` grew one
 * optional `durMsOverride`. A second `INSERT … SELECT` here would be a second
 * answer to identity resolution, to config routing (#150) and to the
 * chunk-and-watermark-in-one-transaction rule that resumability rests on — three
 * things that are hard to get right once.
 */

import type { Client } from "pg";

import { jsonDocument } from "./json-value";

import {
  type CatalogState,
  type UpgradePhase,
  LEGACY_AGGREGATES,
  LEGACY_NAME,
  baselinePlan,
  cadenceMs,
  classifyUpgrade,
  detachPolicyStatements,
  renameStatements,
  replayEnd,
} from "./upgrade-120";
import { MIGRATION_KEY, type MigrationRecord, migrationRecordSchema } from "./upgrade-state";
import { type ReplayClient, type ReplayOptions, type ReplayResult, runReplay } from "./replay-run";

/**
 * The client shape this module needs: one statement, positional parameters, rows
 * back — structurally `pg.Client`'s `query`, which is what `./migrate.ts` already
 * holds open. A SINGLE connection, never a pool: the chunk transactions in
 * `./replay-run.ts` are `begin`/`commit` statements and on a pool they could land
 * on different backends.
 */
export type UpgradeClient = ReplayClient;

/** A logger narrow enough that `console` and the server's logger both fit. */
export interface UpgradeLogger {
  log(message: string): void;
}

const silent: UpgradeLogger = { log: () => {} };

const rowsOf = <T>(result: { rows: unknown[] }): T[] => result.rows as T[];

/**
 * Everything {@link CatalogState} needs, in four queries.
 *
 * Read ONCE per step and then decided against, rather than probed per decision:
 * a plan built from two reads of a catalog that is being changed underneath it is
 * a plan that can contradict itself, and this runs once on one instance.
 *
 * `pg_class`/`pg_index` rather than `information_schema`: a continuous
 * aggregate's user-facing view and a hypertable both have to be seen, and
 * `information_schema.tables` does not list a materialized view as a table.
 */
export async function readCatalog(client: UpgradeClient): Promise<CatalogState> {
  const relations = await client.query(
    `select c.relname as name from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')`,
  );
  const indexes = await client.query(
    `select c.relname as name from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'i'`,
  );
  const constraints = await client.query(
    `select conname as name from pg_constraint con
       join pg_namespace n on n.oid = con.connamespace
      where n.nspname = 'public'`,
  );
  const columns = await client.query(
    `select table_name as t, column_name as c from information_schema.columns
      where table_schema = 'public'`,
  );
  const byTable = new Map<string, Set<string>>();
  for (const row of rowsOf<{ t: string; c: string }>(columns)) {
    const set = byTable.get(row.t) ?? new Set<string>();
    set.add(row.c);
    byTable.set(row.t, set);
  }
  return {
    relations: new Set(rowsOf<{ name: string }>(relations).map((r) => r.name)),
    indexes: new Set(rowsOf<{ name: string }>(indexes).map((r) => r.name)),
    constraints: new Set(rowsOf<{ name: string }>(constraints).map((r) => r.name)),
    columns: byTable,
  };
}

/** The half-open window a relation's `time`/`bucket` column covers. */
export interface RelationWindow {
  from: Date | null;
  to: Date | null;
}

/**
 * The retained legacy raw window, and the one `inverter_id` in it.
 *
 * The source id is READ, never configured: 1.2.0 stamped
 * `inverterId = profile.id` (`packages/inverter-core/src/driver.ts`), so the value
 * is whatever that install's profile was called, and asking an operator to type
 * it is asking them to guess. More than one distinct value is a state 1.2.0 could
 * not produce (it polled one inverter) and is reported rather than silently
 * halved.
 */
// fallow-ignore-next-line unused-export -- the 1.2.0 raw window's bounds, read before the schema moves; runBlockingUpgrade below is its caller and scripts/upgrade-rehearsal.ts reads it too.
export async function readLegacyRaw(
  client: UpgradeClient,
): Promise<RelationWindow & { sourceIds: string[] }> {
  const window = await client.query(
    `select min(time) as "from", max(time) as "to" from ${LEGACY_NAME.metrics_raw}`,
  );
  const ids = await client.query(
    `select distinct inverter_id as id from ${LEGACY_NAME.metrics_raw}`,
  );
  const row = rowsOf<{ from: Date | string | null; to: Date | string | null }>(window)[0];
  return {
    from: row?.from ? new Date(row.from) : null,
    to: row?.to ? new Date(row.to) : null,
    sourceIds: rowsOf<{ id: string }>(ids)
      .map((r) => r.id)
      .sort(),
  };
}

/**
 * The `inverter_id`s the legacy MINUTE tier holds.
 *
 * Consulted only when the raw window is empty — retention can have dropped every
 * raw chunk on an addon that was stopped longer than a week — because the source
 * id is what every later step keys on and losing it would leave the whole history
 * unreplayable.
 */
async function readLegacyBucketSourceIds(client: UpgradeClient): Promise<string[]> {
  const ids = await client.query(
    `select distinct inverter_id as id from ${LEGACY_NAME.minute_rollups}`,
  );
  return rowsOf<{ id: string }>(ids)
    .map((r) => r.id)
    .sort();
}

/**
 * The median inter-sample gap in the retained legacy raw, in ms.
 *
 * `null` when there is nothing to measure — and an ABSENT legacy relation is one
 * of those cases, not an error. Two healthy databases have no legacy raw: a
 * fresh 2.0.0 install that never had one, and an upgraded install past
 * `verified`, where the upgrade DROPS the legacy hypertable on purpose. Both
 * used to make this throw `42P01`, which the caller reported as an ERROR against
 * a database behaving exactly as designed (#181).
 *
 * The existence check is a separate statement rather than a caught exception
 * because a failed query aborts a surrounding transaction — the caller runs
 * inside `withUpgradeClient`, and swallowing the error here would hand back a
 * connection whose next statement fails for reasons no log line explains.
 */
export async function readLegacyCadenceMs(client: UpgradeClient): Promise<number | null> {
  const present = await client.query(`select to_regclass($1) is not null as present`, [
    LEGACY_NAME.metrics_raw,
  ]);
  if (!rowsOf<{ present: boolean }>(present)[0]?.present) return null;
  // One metric, one day, ordered — enough to see the cadence and bounded enough
  // that it cannot become the expensive part of a step measured in milliseconds.
  const result = await client.query(
    `with sample as (
       select time, metric,
              lead(time) over (partition by metric order by time) as next_time
       from ${LEGACY_NAME.metrics_raw}
       where metric = (select metric from ${LEGACY_NAME.metrics_raw} order by time desc limit 1)
         and time >= (select max(time) - interval '1 day' from ${LEGACY_NAME.metrics_raw})
     )
     select (extract(epoch from (next_time - time)) * 1000)::double precision as gap
     from sample where next_time is not null limit 5000`,
  );
  return cadenceMs(rowsOf<{ gap: number | string }>(result).map((r) => Number(r.gap)));
}

/** What {@link runBlockingUpgrade} needs from its caller. */
export interface BlockingUpgradeInput {
  /** The 2.0.0 drizzle baseline, already split on the statement-breakpoint. */
  baselineStatements: readonly string[];
  /** Journal entry 0: its `when`, and the sha256 the migrator would record. */
  baseline: { when: number; hash: string };
  logger?: UpgradeLogger;
  /** The cutover instant. Injected so a test can pin it. */
  now?: Date;
}

export interface BlockingUpgradeResult {
  applied: string[];
  skipped: string[];
  record: MigrationRecord;
  elapsedMs: number;
}

/**
 * Refuse a database holding BOTH generations of `metrics_raw`.
 *
 * Its own function because it is a REFUSAL, not a branch: there is no correct way
 * to guess which of the two tables holds the history, and picking one would either
 * migrate the empty table (losing everything) or double-count. The only safe
 * output is a stop with an instruction.
 */
function assertUnambiguous(phase: UpgradePhase): void {
  if (phase !== "ambiguous") return;
  throw new Error(
    `Refusing to migrate: this database has BOTH a legacy-shaped metrics_raw and a ` +
      `${LEGACY_NAME.metrics_raw}, so the 1.2.0 -> 2.0.0 upgrade cannot tell which one holds ` +
      `the history. Restore the pre-upgrade backup and start again.`,
  );
}

/**
 * Policies off, then the rename — in that order, and the order is the point.
 *
 * A retention policy FOLLOWS a rename, so detaching afterwards would have to know
 * the legacy names; detaching at all is what stops the old minute tier's 90-day
 * retention from eating the history while the operator decides whether to
 * migrate. The catalog is re-read between the two because detaching changes it.
 */
async function detachAndRename(
  client: UpgradeClient,
  run: (statement: string) => Promise<void>,
  logger: UpgradeLogger,
): Promise<void> {
  logger.log("1.2.0 database detected: detaching its policies and renaming its relations");
  for (const statement of detachPolicyStatements()) await run(statement);
  for (const statement of renameStatements(await readCatalog(client))) await run(statement);
}

/**
 * The ONE `inverter_id` the 1.2.0 history carries, or `null` when it carries none.
 *
 * Falls back from the retained raw window to the BUCKETS, because raw is only
 * seven days on 1.2.0 and an instance whose inverter has been offline for a week
 * has an empty raw window and two months of buckets.
 *
 * More than one is a refusal rather than a choice. 1.2.0 could not produce it —
 * it had a single `inverter` setting — so a database that has it was assembled by
 * something this upgrade does not model, and each distinct id is a separate
 * physical device whose mapping to the new `devices` rows nothing here can guess.
 */
async function resolveSourceId(
  client: UpgradeClient,
  rawSourceIds: readonly string[],
): Promise<string | null> {
  const sourceIds =
    rawSourceIds.length > 0 ? rawSourceIds : await readLegacyBucketSourceIds(client);
  if (sourceIds.length > 1) {
    throw new Error(
      `Refusing to migrate: the 1.2.0 history carries ${sourceIds.length} distinct inverter_id ` +
        `values (${sourceIds.join(", ")}), which 1.2.0 could not produce. Each one is a separate ` +
        `device and mapping them is not something this upgrade can guess.`,
    );
  }
  return sourceIds[0] ?? null;
}

/**
 * THE BLOCKING STEP. Catalog only; no row of history moves.
 *
 * Returns `null` for a database that is not a 1.x one — a fresh install and an
 * already-2.0.0 install both fall straight through, which is what lets this sit
 * unconditionally in `./migrate.ts`'s chain instead of behind a flag somebody has
 * to remember to set.
 *
 * The order is the whole design and none of it is incidental:
 *
 *  1. POLICIES OFF, under their current names. A retention policy follows a
 *     rename, so doing this afterwards would need the legacy names; doing it at
 *     all is what stops the old minute tier's 90-day retention from eating the
 *     history while the operator decides.
 *  2. The legacy raw window, the source id and the cadence are read BEFORE the
 *     schema moves — they are facts about 1.2.0's data and the later steps need
 *     them after the shape has changed.
 *  3. RENAME. Verified on 2.28.2: the aggregates follow, keep every bucket, and
 *     the freed names are immediately reusable.
 *  4. The 2.0.0 baseline, SELECTIVELY. Refusals stop the upgrade before anything
 *     is stamped.
 *  5. The journal stamp — and only then, because a journal row is a claim that
 *     the schema is there.
 *  6. The migration record, which is what every read consults to know that
 *     pre-cutover history is withheld rather than absent.
 *
 * Killed anywhere in the middle, the next boot resumes: every statement is
 * guarded on the catalog, the renames on the ABSENCE of their target, and the
 * record is an upsert.
 */
export async function runBlockingUpgrade(
  client: UpgradeClient,
  input: BlockingUpgradeInput,
): Promise<BlockingUpgradeResult | null> {
  const began = Date.now();
  const logger = input.logger ?? silent;
  const phase = classifyUpgrade(await readCatalog(client));
  if (phase === "not-needed") return null;
  assertUnambiguous(phase);

  const applied: string[] = [];
  const run = async (statement: string): Promise<void> => {
    await client.query(statement);
    applied.push(statement);
  };

  if (phase === "rename-pending") await detachAndRename(client, run, logger);

  const raw = await readLegacyRaw(client);
  const sourceId = await resolveSourceId(client, raw.sourceIds);
  const now = input.now ?? new Date();

  const plan = baselinePlan(input.baselineStatements, await readCatalog(client));
  if (plan.refusals.length > 0) throw new Error(plan.refusals.join("\n"));
  for (const statement of plan.run) await run(statement);
  logger.log(
    `applied ${plan.run.length} of ${input.baselineStatements.length} baseline statements ` +
      `(${plan.skipped.length} already present)`,
  );

  await stampDrizzleBaseline(client, input.baseline);

  const record = migrationRecordSchema.parse({
    stage: "cutover",
    cutoverAt: now.toISOString(),
    sourceId,
    legacyRawFrom: raw.from?.toISOString() ?? null,
    legacyRawTo: raw.to?.toISOString() ?? null,
    replayTo: replayEnd(raw.from, now).toISOString(),
  });
  await writeMigrationRecord(client, record);
  const elapsedMs = Date.now() - began;
  logger.log(
    `blocking upgrade complete in ${elapsedMs} ms — new readings land in the 2.0.0 schema from ` +
      `${record.cutoverAt}; history before it is in ${LEGACY_NAME.metrics_raw} and its ` +
      `legacy_* aggregates until the backfill runs`,
  );
  return { applied, skipped: plan.skipped, record, elapsedMs };
}

/**
 * Record the 2.0.0 baseline as applied without executing it — the same row
 * drizzle's migrator would write.
 *
 * `where not exists` rather than a bare insert: the blocking step can be killed
 * after this and re-run, and a second row would leave two migrations claiming the
 * same hash. It is checked on `created_at`, which is the column drizzle's migrator
 * itself compares against.
 */
export async function stampDrizzleBaseline(
  client: UpgradeClient,
  baseline: { when: number; hash: string },
): Promise<void> {
  await client.query("create schema if not exists drizzle");
  await client.query(
    `create table if not exists drizzle.__drizzle_migrations (
       id serial primary key, hash text not null, created_at bigint)`,
  );
  await client.query(
    `insert into drizzle.__drizzle_migrations (hash, created_at)
     select $1, $2
     where not exists (select 1 from drizzle.__drizzle_migrations where created_at = $2)`,
    [baseline.hash, baseline.when],
  );
}

/**
 * Upsert the migration record.
 *
 * Written through `app_settings` rather than a table of its own because it has to
 * be writable BEFORE the 2.0.0 baseline has created anything — `app_settings` is
 * one of the eight relations both generations share.
 */
export async function writeMigrationRecord(
  client: UpgradeClient,
  record: MigrationRecord,
): Promise<void> {
  // `$2::text::jsonb`, and the redundant-looking `::text` is the whole point.
  // MEASURED against both drivers this module is handed: `pg` sends a JS string
  // as text, so `$2::jsonb` parses it into an object — but bun's `SQL` sees a
  // jsonb destination and JSON-ENCODES the string, storing the DOCUMENT AS A JSON
  // STRING (`jsonb_typeof` = 'string'). The record then reads back as `{}` and
  // the migration looks like it never happened, which on the resume path means
  // the whole backfill restarts with no source id. Forcing the parameter through
  // `text` first makes the statement mean the same thing on both.
  await client.query(
    `insert into app_settings (key, value) values ($1, $2::text::jsonb)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [MIGRATION_KEY, JSON.stringify(record)],
  );
}

/**
 * The migration record, or the "never migrated" default.
 *
 * The value is unwrapped through {@link jsonDocument} because a jsonb column can
 * legitimately hold the document AS A JSON STRING — see the note on
 * {@link writeMigrationRecord}, and note that every `app_settings` row in
 * `scripts/fixture-1-2-0.ts`'s database is in exactly that shape. Reading it as
 * `{}` would report "no migration happened here" on a database in the middle of
 * one.
 */
export async function readMigrationRecord(client: UpgradeClient): Promise<MigrationRecord> {
  const result = await client.query(`select value from app_settings where key = $1`, [
    MIGRATION_KEY,
  ]);
  const row = rowsOf<{ value: unknown }>(result)[0];
  const parsed = migrationRecordSchema.safeParse(jsonDocument(row?.value) ?? {});
  return parsed.success ? parsed.data : migrationRecordSchema.parse({});
}

/**
 * The watermark namespace the retained-raw carry records its days under.
 *
 * Distinct from the bucket replay's, because the two cover DIFFERENT SPANS of the
 * same device and `replay_progress` is keyed on `(source, device_id,
 * chunk_start)`. Sharing a namespace would let the carry's completed days mark the
 * replay's as done.
 */
// fallow-ignore-next-line unused-export -- the replay_progress key for the raw carry, asserted by apps/server/db-tests/upgrade.test.ts, which .fallowrc.json excludes from tracing.
export const RAW_CARRY_SOURCE = "legacy-1.2.0-raw";

/** The 1.2.0 raw columns, as `./replay-run.ts` addresses a bucket relation. */
const RAW_AS_BUCKETS = {
  bucket: "time",
  sourceId: "inverter_id",
  metric: "metric",
  value: "value",
} as const;

export interface CarryRawInput {
  sourceId: string;
  deviceId: number;
  /** Metric keys the profile stores as configuration. Never a prefix match. */
  configKeys?: readonly string[];
  /** The measured poll cadence. `null` writes no duration. */
  durMs: number | null;
}

/**
 * Move the retained legacy raw window into the new `metrics_raw`.
 *
 * This is the cheap half of the data movement and it recovers the week an
 * operator looks at first: 1.2.0's raw retention is seven days, so on the real
 * fixture it is ~1.06 M rows against the bucket replay's ~9.1 M.
 *
 * It goes through `runReplay` — the same statements, the same identity join, the
 * same config routing, the same one-transaction-per-day watermark — with two
 * things said differently: the relation is addressed through
 * {@link RAW_AS_BUCKETS} (a raw row's `time` IS its bucket start, and 1.2.0's
 * `value` is the reading rather than a mean), and `durMsOverride` carries the
 * measured cadence instead of a bucket width, because a poll sample's duration is
 * the poll interval.
 */
export async function carryLegacyRaw(
  client: UpgradeClient,
  input: CarryRawInput,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  return runReplay(
    client,
    {
      source: RAW_CARRY_SOURCE,
      relations: { minute: LEGACY_NAME.metrics_raw },
      columns: { ...RAW_AS_BUCKETS },
      identity: { sourceId: input.sourceId, deviceId: input.deviceId },
      configKeys: input.configKeys,
      durMsOverride: input.durMs,
    },
    options,
  );
}

/**
 * Drop the 1.2.0 objects. Reachable ONLY through a verified migration record —
 * see `mayDropLegacy` — because until verification they are not dead weight, they
 * are the rollback.
 *
 * The aggregates go first and the hypertable last: dropping the hypertable while
 * a continuous aggregate still depends on it would need `CASCADE`, and a
 * `DROP … CASCADE` on the one instance's only copy of its history is not a
 * statement worth having in the codebase.
 */
export function dropLegacyStatements(state: CatalogState): string[] {
  const statements: string[] = [];
  for (const view of LEGACY_AGGREGATES) {
    const legacy = LEGACY_NAME[view];
    if (state.relations.has(legacy)) statements.push(`drop materialized view ${legacy}`);
  }
  if (state.relations.has(LEGACY_NAME.metrics_raw)) {
    statements.push(`drop table ${LEGACY_NAME.metrics_raw}`);
  }
  return statements;
}

/** `pg.Client` presented as an {@link UpgradeClient}. */
export function pgUpgradeClient(client: Client): UpgradeClient {
  return { query: (text, values) => client.query(text, values ? [...values] : undefined) };
}
