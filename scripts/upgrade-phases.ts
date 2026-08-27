/**
 * THE UPGRADE REHEARSAL'S RUNTIME: everything that talks to Docker or Postgres.
 *
 * Split out of `./upgrade-rehearsal.ts` so the half that CAN be tested is not
 * dragged down by the half that cannot. The functions here restore an 80 MB dump,
 * shell out to `docker exec`, and replay five million rows; nothing about them is
 * assertable without a container. The decisions AROUND them — which ports may be
 * dropped, which phases run in which order, what makes a post-rename schema
 * "serving" — are pure, and they are the ones that decide whether a live
 * inverter's database gets dropped by a copy-pasted URL. Those stay next door with
 * `./upgrade-rehearsal.test.ts` on them.
 *
 * This module is loaded LAZILY, by the phase table in `./upgrade-rehearsal.ts`.
 * That is deliberate: a test of the pure half must not import a module whose job
 * is to dial Docker, and the coverage report should measure the half that has
 * tests rather than reporting a driver as uncovered code.
 */
import { $, SQL } from "bun";

import { type GroundTruth, compareEnergy, compareRestarts, readTier } from "./fixture-1-2-0";
import {
  classifyProfile,
  hazardProblems,
  // The SAME per-counter energy read the replay rehearsal uses, imported rather
  // than copied: it is the measurement both scripts are judged by, and two copies
  // could disagree about the join or the ordering, which is exactly the class of
  // difference that would make one script pass and the other fail on identical
  // data.
  replayedEnergy,
  spanProblems,
  throughput,
  worstNaiveError,
} from "./replay-rehearsal";
import {
  type Options,
  type ServingState,
  assertUpgradeTarget,
  log,
  renamePreservedProblems,
  servingProblems,
} from "./upgrade-plan";

const urlFor = (o: Options, database: string) =>
  `postgres://postgres:${o.password}@localhost:${o.port}/${database}`;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * bun's `SQL` as the `{ query }` client every `packages/db` entry point takes.
 *
 * One adapter, because the shape is a CONTRACT with those modules: two copies
 * would be two chances to get the `values` spread wrong, and a missing spread
 * silently sends no parameters rather than failing.
 */
function sqlClient(db: SQL) {
  return {
    query: async (text: string, values?: readonly unknown[]) => ({
      rows: (await db.unsafe(text, values ? [...values] : [])) as unknown[],
    }),
  };
}

/** The 1.2.0 dump, restored into a database this script is allowed to drop. */
export async function restore(o: Options): Promise<void> {
  const url = urlFor(o, o.database);
  assertUpgradeTarget(url);
  const began = Date.now();
  const psql = (db: string, statement: string) =>
    $`docker exec ${o.container} psql -X -q -v ON_ERROR_STOP=1 -U postgres -p ${o.port} -d ${db} -c ${statement}`.quiet();
  await psql("postgres", `DROP DATABASE IF EXISTS ${o.database} WITH (FORCE)`);
  await psql("postgres", `CREATE DATABASE ${o.database}`);
  // The dump carries TimescaleDB objects, so the extension has to be there and
  // the catalog has to be unlocked around the restore — the documented sequence.
  await psql(o.database, "CREATE EXTENSION IF NOT EXISTS timescaledb");
  await psql(o.database, "SELECT timescaledb_pre_restore()");
  const restored =
    await $`docker exec ${o.container} pg_restore -U postgres -p ${o.port} -d ${o.database} --no-owner ${o.dump}`.nothrow();
  if (restored.exitCode !== 0) {
    throw new Error(`pg_restore failed with exit code ${restored.exitCode}`);
  }
  await psql(o.database, "SELECT timescaledb_post_restore()");
  log(`restored the addon-1.2.0 fixture into ${o.database} in ${seconds(Date.now() - began)}`);
}

/** The catalog, as {@link servingProblems} needs it. */
async function readServingState(db: SQL): Promise<ServingState> {
  const rows = async <T>(query: string): Promise<T[]> => (await db.unsafe(query)) as T[];
  const columns = await rows<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'metrics_raw'`,
  );
  const aggregates = await rows<{ view_name: string }>(
    `select view_name from timescaledb_information.continuous_aggregates`,
  );
  const jobs = await rows<{ label: string }>(
    `select proc_name || ':' || coalesce(hypertable_name, '-') as label
       from timescaledb_information.jobs where job_id >= 1000`,
  );
  const relations = await rows<{ name: string }>(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'm', 'v') and c.relname like '%legacy%'`,
  );
  return {
    rawColumns: columns.map((r) => r.column_name),
    aggregates: aggregates.map((r) => r.view_name),
    jobs: jobs.map((r) => r.label),
    legacyRelations: relations.map((r) => r.name),
  };
}

/** THE BLOCKING STEP, through the shipped migration runner, timed. */
export async function blocking(o: Options, truth: GroundTruth): Promise<string[]> {
  const url = urlFor(o, o.database);
  assertUpgradeTarget(url);
  const { runMigrations } = await import("../packages/db/src/migrate");
  const began = Date.now();
  await runMigrations(url);
  const elapsed = Date.now() - began;
  log(`BLOCKING STEP: the whole migration runner took ${seconds(elapsed)}`);
  if (elapsed > 120_000) {
    log(`WARNING: that is over the addon's 120 s Supervisor timeout`);
  }

  const db = new SQL(url, { max: 1, idleTimeout: 0 });
  try {
    const problems = servingProblems(await readServingState(db));
    for (const tier of ["minute_rollups", "hourly_rollups", "daily_rollups"] as const) {
      const after = await readTier(db, tier, `legacy_${tier}`);
      problems.push(...renamePreservedProblems(tier, truth.tiers[tier], after));
      log(`legacy_${tier}: ${after.count.toLocaleString("en-US")} buckets, digest ${after.digest}`);
    }
    const record = await db.unsafe(`select value from app_settings where key = 'migration.v2'`);
    log(`migration record: ${JSON.stringify((record as { value: unknown }[])[0]?.value)}`);
    return problems;
  } finally {
    await db.end();
  }
}

/**
 * The dimension spine an operator supplies per install.
 *
 * Through the shipped `ensurePlant` / `ensureDevice` / `ensureMetricKeys` rather
 * than raw inserts: their upserts are the only thing that guarantees a second
 * boot ADOPTS rather than re-inserting, and `devices.id` is written into every one
 * of five years of readings. The app-layer policy on top of them
 * (`apps/server/src/inverter/provision.ts`, which mines the 1.x `app_settings`
 * blobs for the plant's name, coordinates and battery) cannot be imported from
 * `scripts/` — `scripts` is not a workspace — and is covered by
 * `apps/server/db-tests/upgrade.test.ts`.
 */
export async function provision(o: Options): Promise<string[]> {
  const url = urlFor(o, o.database);
  assertUpgradeTarget(url);
  const { createDbAt } = await import("../packages/db/src/index");
  const { ensureDevice, ensurePlant } = await import("../packages/db/src/plant-repo");
  const { ensureMetricKeys } = await import("../packages/db/src/metric-keys");
  const { readMigrationRecord } = await import("../packages/db/src/upgrade-120-run");

  const db = createDbAt(url);
  const store = { execute: (query: Parameters<typeof db.execute>[0]) => db.execute(query) };
  const raw = new SQL(url, { max: 1, idleTimeout: 0 });
  try {
    const record = await readMigrationRecord({
      query: async (text, values) => ({
        rows: (await raw.unsafe(text, values ? [...values] : [])) as unknown[],
      }),
    });
    if (record.sourceId === null) return ["the migration record carries no source id"];

    const { metrics, configKeys } = await classifyProfile();
    const plant = await ensurePlant(store, {
      name: "Rehearsal plant",
      slug: "rehearsal-plant",
      timeZone: "Europe/Berlin",
    });
    const device = await ensureDevice(store, {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      // Derived from the ROLE, not the profile id: a profile-derived slug would
      // move the whole MQTT namespace on a profile swap.
      slug: "inverter",
      name: "Rehearsal inverter",
      profileId: record.sourceId,
      role: "inverter",
    });
    const ids = await ensureMetricKeys(store, metrics);
    log(
      `provisioned plant ${plant.id}, device ${device.id} (profile_id ${record.sourceId}), ` +
        `${ids.size} metric keys, ${configKeys.length} of them configuration`,
    );
    return [];
  } finally {
    await raw.end();
  }
}

/** The device the legacy history belongs to, and the profile's classification. */
async function backfillInputs(o: Options, db: SQL) {
  const { readLegacyCadenceMs, readMigrationRecord } =
    await import("../packages/db/src/upgrade-120-run");
  const client = sqlClient(db);
  const record = await readMigrationRecord(client);
  const rows = (await db.unsafe(
    `select id from devices where profile_id = $1 order by id limit 1`,
    [record.sourceId],
  )) as { id: number }[];
  const deviceId = Number(rows[0]?.id);
  if (!Number.isInteger(deviceId)) {
    throw new Error(`no device names profile ${record.sourceId} — run --phase=provision first`);
  }
  const { configKeys } = await classifyProfile();
  const cadence = await readLegacyCadenceMs(client);
  log(`device ${deviceId}, measured legacy poll cadence ${cadence ?? "unknown"} ms`);
  return { client, record, deviceId, configKeys, cadence };
}

/** What `runBackfill` reports back, as much of it as the log line needs. */
type BackfillOutcome = {
  carried?: { seriesRows: number } | null;
  replayed?: { seriesRows: number; elapsedMs: number } | null;
  refreshed: number;
};

/**
 * The per-chunk progress line, and the KILL SWITCH.
 *
 * `--stop-after=N` calls `process.exit` from inside the callback, mid-run, with
 * the connection open and the next chunk unstarted — which is what a Supervisor
 * timeout or a power cut actually leaves behind. Nothing is flushed and nothing is
 * tidied, deliberately: a "simulated" kill that unwound cleanly would prove the
 * opposite of what this is for.
 */
function progressReporter(
  o: Options,
  chunkLine: (chunk: unknown, index: number, total: number) => string,
): (chunk: unknown, index: number, total: number) => void {
  let written = 0;
  // fallow-ignore-next-line complexity -- CRAP only, not complexity: cyclomatic 5 and cognitive 4 are both well inside the repo's limits of 10. CRAP squares the complexity when unit coverage is zero, and this function's coverage is zero BY DESIGN — it reports per-chunk progress and calls process.exit for the kill-and-resume proof, which no unit test can stand in for. It is exercised by running the rehearsal end to end against the restored addon-1.2.0 fixture, which is the only proof that means anything here.
  return (chunk, index, total) => {
    written += 1;
    if (written % 5 === 0 || written === total) log(chunkLine(chunk, index, total));
    if (o.stopAfter > 0 && written >= o.stopAfter) {
      log(`--stop-after=${o.stopAfter} reached: exiting mid-run, code 9`);
      process.exit(9);
    }
  };
}

/** The one line that carries the numbers this whole rehearsal exists to measure. */
// fallow-ignore-next-line complexity -- CRAP only, not complexity: cyclomatic 7 and cognitive 3 are both well inside the repo's limits of 10. CRAP squares the complexity when unit coverage is zero, and this function's coverage is zero BY DESIGN — it formats the measured throughput of a five-million-row replay, which no unit test can stand in for. It is exercised by running the rehearsal end to end against the restored addon-1.2.0 fixture, which is the only proof that means anything here.
function logBackfillResult(result: BackfillOutcome, elapsedMs: number): void {
  const total = result.replayed?.seriesRows ?? 0;
  log(
    `BACKFILL DONE in ${seconds(elapsedMs)}: ` +
      `${(result.carried?.seriesRows ?? 0).toLocaleString("en-US")} carried raw rows + ` +
      `${total.toLocaleString("en-US")} replayed bucket rows ` +
      `(${throughput(total, result.replayed?.elapsedMs ?? 0)?.toLocaleString("en-US")} rows/s) ` +
      `+ ${result.refreshed} refresh window(s)`,
  );
}

/** THE BACKFILL, resumable, with a real mid-run exit when `--stop-after` says so. */
export async function backfill(o: Options): Promise<string[]> {
  const url = urlFor(o, o.database);
  assertUpgradeTarget(url);
  const { chunkLine } = await import("../packages/db/src/backfill");
  const { runBackfill } = await import("../packages/db/src/backfill-run");
  const db = new SQL(url, { max: 1, idleTimeout: 0 });
  try {
    const { client, deviceId, configKeys, cadence } = await backfillInputs(o, db);
    const began = Date.now();
    const result = await runBackfill(
      client,
      {
        deviceId,
        configKeys,
        rawDurMs: cadence,
        refreshChunkDays: o.refreshChunkDays,
        logger: { log },
      },
      { onChunk: progressReporter(o, chunkLine) },
    );
    if (result === null) {
      log("nothing to backfill: the migration record says it is already done");
      return [];
    }
    logBackfillResult(result, Date.now() - began);
    return result.replayed && result.replayed.gaps.length > 0
      ? [`${result.replayed.gaps.length} day(s) no legacy tier could answer`]
      : [];
  } finally {
    await db.end();
  }
}

/** VERIFICATION: the in-database gate, then the committed ground truth. */
// fallow-ignore-next-line complexity -- CRAP only, not complexity: cyclomatic 5 and cognitive 3 are both well inside the repo's limits of 10. CRAP squares the complexity when unit coverage is zero, and this function's coverage is zero BY DESIGN — it runs the in-database verification gate over 3,498 metric-days, which no unit test can stand in for. It is exercised by running the rehearsal end to end against the restored addon-1.2.0 fixture, which is the only proof that means anything here.
export async function verify(o: Options, truth: GroundTruth): Promise<string[]> {
  const url = urlFor(o, o.database);
  assertUpgradeTarget(url);
  const { verifyMigration } = await import("../packages/db/src/backfill-run");
  const db = new SQL(url, { max: 1, idleTimeout: 0 });
  try {
    const { client, deviceId, configKeys } = await backfillInputs(o, db);
    const problems: string[] = [];

    // 1. The gate the runtime uses: every legacy bucket has a new bucket with the
    //    same mean. This is what lets the rollback be deleted.
    const began = Date.now();
    const gate = await verifyMigration(client, deviceId, configKeys, { log });
    log(
      `in-database verification compared ${gate.compared} metric-days in ${seconds(Date.now() - began)}`,
    );
    problems.push(...gate.problems);

    // 2. The change-log is not EMPTY. `verifyMigration` already asserts that no
    //    configuration register leaked into the hypertable; the complement —
    //    that they went somewhere — is only checkable where the profile is known.
    const logged = (await db.unsafe(`select count(*)::bigint as n from metrics_config_log`)) as {
      n: string;
    }[];
    const changes = Number(logged[0]?.n ?? 0);
    log(`config: ${changes.toLocaleString("en-US")} change-log rows for ${configKeys.length} keys`);
    if (configKeys.length > 0 && changes === 0) {
      problems.push("no config change-log rows at all — the config arm wrote nothing");
    }

    // 3. THE ACCEPTANCE BAR: the fixture's own energy differ over the whole span.
    const counters = [...new Set(truth.perMetricPerDayEnergy.map((r) => r.metric))].sort();
    const energyBegan = Date.now();
    const measured = await replayedEnergy(db, deviceId, counters);
    log(
      `energy: ${measured.energy.length} metric-days, ${measured.restarts.length} restarts, ` +
        `read in ${seconds(Date.now() - energyBegan)}`,
    );
    problems.push(...compareEnergy(truth.perMetricPerDayEnergy, measured.energy));
    problems.push(...compareRestarts(truth.restarts, measured.restarts));

    // 4. THE READ PATH reproduces the legacy mean, on a sample.
    problems.push(...(await checkInterpolatedMean(db, deviceId)));

    // 5. The mid-day counter cliff, through the NEW tiers. Naive max-minus-min is
    //    1532x wrong on this day; `delta(counter_agg)` is not.
    problems.push(...(await checkCliff(db, truth, deviceId)));
    return problems;
  } finally {
    await db.end();
  }
}

/**
 * Does the TIME-WEIGHTED read reproduce the legacy bucket's mean?
 *
 * This is the claim `packages/db/src/replay.ts` actually makes — that
 * `time_weight('LOCF', …)` over a replayed interval row reproduces the bucket's
 * mean to the bit — and it is NOT what the in-database gate checks. The gate
 * compares `max_value`, because `average(tw)` over a bucket holding one sample is
 * NULL (a point has no duration) and a replayed bucket holds exactly one row by
 * construction, so a gate built on it would report the mean as missing on a
 * perfectly correct migration. The read path therefore has to use
 * `interpolated_average`, which needs the NEIGHBOURING partials — a window
 * function, which over 5.7 M buckets is a sort nobody wants inside a verification
 * an operator is waiting on.
 *
 * So it is sampled, and it is sampled HERE rather than in the gate: this script
 * has the whole fixture and no time budget.
 */
async function checkInterpolatedMean(db: SQL, deviceId: number): Promise<string[]> {
  const rows = (await db.unsafe(
    `with sample as (
       select m.bucket, m.metric_id, m.max_value,
              interpolated_average(m.tw, m.bucket, interval '1 minute',
                lag(m.tw) over w, lead(m.tw) over w) as interpolated,
              mk.key as metric, b.avg_value as legacy
       from minute_rollups m
       join metric_keys mk on mk.id = m.metric_id
       join legacy_minute_rollups b
         on b.metric = mk.key and b.bucket = m.bucket and b.inverter_id = $2
       where m.device_id = $1
         and m.bucket >= $3::timestamptz and m.bucket < $3::timestamptz + interval '2 hours'
       window w as (partition by m.device_id, m.metric_id order by m.bucket)
     )
     select metric, bucket::text as bucket, interpolated, legacy from sample
     where interpolated is null
        or abs(interpolated - legacy) > 1e-9 * greatest(1, abs(legacy))
     limit 20`,
    [deviceId, "deye-sg05lp3", "2026-07-15T00:00:00Z"],
  )) as { metric: string; bucket: string; interpolated: number | null; legacy: number }[];
  const counted = (await db.unsafe(
    `select count(*)::bigint as n from minute_rollups
      where device_id = $1 and bucket >= $2::timestamptz
        and bucket < $2::timestamptz + interval '2 hours'`,
    [deviceId, "2026-07-15T00:00:00Z"],
  )) as { n: string }[];
  const sampled = Number(counted[0]?.n ?? 0);
  log(
    `interpolated_average reproduced the legacy mean on ${sampled.toLocaleString("en-US")} ` +
      `sampled buckets with ${rows.length} disagreement(s)`,
  );
  if (sampled === 0) return ["the interpolated-mean sample covered no buckets at all"];
  return rows.map(
    (row) =>
      `${row.metric} ${row.bucket}: interpolated_average ${row.interpolated}, ` +
      `legacy mean ${row.legacy}`,
  );
}

/** The reset day and the whole-span rollup, read from the new daily tier. */
// fallow-ignore-next-line complexity -- CRAP only, not complexity: cyclomatic 5 and cognitive 3 are both well inside the repo's limits of 10. CRAP squares the complexity when unit coverage is zero, and this function's coverage is zero BY DESIGN — it queries the daily tier for the mid-day counter cliff, which no unit test can stand in for. It is exercised by running the rehearsal end to end against the restored addon-1.2.0 fixture, which is the only proof that means anything here.
async function checkCliff(db: SQL, truth: GroundTruth, deviceId: number): Promise<string[]> {
  const worst = worstNaiveError(truth.perMetricPerDayEnergy);
  // fallow-ignore-next-line code-duplication -- dup:19dcf568 — the mid-day counter-cliff query, shared with replay-rehearsal.ts's checkAggregates, which does not export it. Both scripts must ask the daily tier the same question, so the duplication is the safer of the two current options. The real fix is a shared scripts/ module, deliberately deferred: scripts/replay-rehearsal.ts is owned by a concurrent agent this wave and editing it would conflict. Extract once both scripts are settled.
  if (!worst) return ["the ground truth records no counter reset — the headline case is unseeded"];
  const rows = (await db.unsafe(
    `select d.max_value - d.min_value as naive, delta(d.ctr) as ctr_delta,
            num_resets(d.ctr)::int as resets
       from daily_rollups d join metric_keys mk on mk.id = d.metric_id
      where d.device_id = $1 and mk.key = $2 and d.bucket = $3::timestamptz`,
    [deviceId, worst.metric, `${worst.day}T00:00:00Z`],
  )) as { naive: number; ctr_delta: number; resets: number }[];
  const row = rows[0];
  if (!row) return [`no daily bucket for ${worst.metric} on ${worst.day} after the upgrade`];
  log(
    `${worst.metric} ${worst.day}: truth ${worst.energy.toFixed(3)} kWh, ` +
      `delta(counter_agg) ${row.ctr_delta.toFixed(3)} kWh, naive max-min ${row.naive.toFixed(3)} kWh ` +
      `(${(row.naive / worst.energy).toFixed(0)}x wrong), ${row.resets} reset(s)`,
  );
  const problems = hazardProblems(worst, {
    naive: row.naive,
    ctrDelta: row.ctr_delta,
    resets: row.resets,
  });
  const span = (await db.unsafe(
    `select delta(rollup(d.ctr)) as ctr_delta from daily_rollups d
       join metric_keys mk on mk.id = d.metric_id
      where d.device_id = $1 and mk.key = $2`,
    [deviceId, worst.metric],
  )) as { ctr_delta: number }[];
  // fallow-ignore-next-line code-duplication -- dup:c0dd07fa — the whole-span rollup comparison, shared with replay-rehearsal.ts's checkAggregates, which does not export it. The real fix is a shared scripts/ module, deliberately deferred: scripts/replay-rehearsal.ts is owned by a concurrent agent this wave and editing it would conflict. Extract once both scripts are settled.
  const expected = truth.perMetricPerDayEnergy
    .filter((r) => r.metric === worst.metric)
    .reduce((sum, r) => sum + r.energy, 0);
  const measured = span[0]?.ctr_delta ?? 0;
  log(
    `${worst.metric} whole span: delta(rollup(ctr)) ${measured.toFixed(3)} kWh against truth ` +
      `${expected.toFixed(3)} kWh`,
  );
  return [...problems, ...spanProblems(worst.metric, measured, expected)];
}

/** THE DROP: only through a verified record, and the new tiers must still answer. */
// fallow-ignore-next-line complexity -- CRAP only, not complexity: cyclomatic 8 and cognitive 5 are both well inside the repo's limits of 10. CRAP squares the complexity when unit coverage is zero, and this function's coverage is zero BY DESIGN — it drops the 1.2.0 hypertable and its three continuous aggregates, then re-reads the catalog, which no unit test can stand in for. It is exercised by running the rehearsal end to end against the restored addon-1.2.0 fixture, which is the only proof that means anything here.
export async function drop(o: Options): Promise<string[]> {
  const url = urlFor(o, o.database);
  assertUpgradeTarget(url);
  const { mayDropLegacy } = await import("../packages/db/src/upgrade-state");
  const { dropLegacyStatements, readCatalog, readMigrationRecord, writeMigrationRecord } =
    await import("../packages/db/src/upgrade-120-run");
  const { migrationRecordSchema } = await import("../packages/db/src/upgrade-state");
  const db = new SQL(url, { max: 1, idleTimeout: 0 });
  try {
    const client = sqlClient(db);
    const record = await readMigrationRecord(client);
    if (!mayDropLegacy(record)) {
      return [`refusing to drop the legacy objects at stage "${record.stage}" — verify first`];
    }
    const sizeBefore = await totalSize(db);
    const began = Date.now();
    for (const statement of dropLegacyStatements(await readCatalog(client))) {
      await db.unsafe(statement);
      log(statement);
    }
    await writeMigrationRecord(
      client,
      migrationRecordSchema.parse({ ...record, stage: "dropped" }),
    );
    const sizeAfter = await totalSize(db);
    log(
      `dropped the 1.2.0 objects in ${seconds(Date.now() - began)}: ` +
        `${sizeBefore} -> ${sizeAfter}`,
    );

    // The tiers must still answer AFTER the drop: a hierarchical aggregate over a
    // dropped parent, or a cascade that took more than it was asked to, would
    // show up nowhere else.
    const answered = (await db.unsafe(
      `select count(*)::bigint as n from daily_rollups where ctr is not null`,
    )) as { n: string }[];
    log(`daily_rollups still answers ${Number(answered[0]?.n ?? 0)} buckets after the drop`);
    return Number(answered[0]?.n ?? 0) > 0
      ? []
      : ["daily_rollups answers nothing after the drop — the drop took the new tiers with it"];
  } finally {
    await db.end();
  }
}

const totalSize = async (db: SQL): Promise<string> => {
  const rows = (await db.unsafe(
    `select pg_size_pretty(pg_database_size(current_database())) as size`,
  )) as { size: string }[];
  return rows[0]?.size ?? "?";
};
