/**
 * THE IN-PLACE UPGRADE FROM ADDON 1.2.0 TO 2.0.0, against a real TimescaleDB
 * holding a real 1.2.0 schema.
 *
 * There is ONE production instance, it holds ~2 months of history, and the
 * upgrade gets ONE attempt. `packages/db/src/upgrade-120.test.ts` proves the
 * decisions and `packages/db/src/migrate.test.ts` proves where in the chain they
 * happen; neither can tell you whether Postgres accepts a rename of a hypertable
 * that three continuous aggregates depend on, or whether the buckets survive it.
 * So this file builds a 1.2.0 database from the TAG, runs the SHIPPED code over
 * it, and asserts numbers.
 *
 * ## The five properties, and how each one fails silently without a test
 *
 *  1. THE BLOCKING STEP LEAVES A SERVING SCHEMA. A rename that half-happened
 *     leaves relations every query can address and no query can answer, and the
 *     addon's `/healthz` would still come up.
 *  2. NO 1.2.0 POLICY SURVIVES IT. The old minute tier's 90-day retention is the
 *     decisive one: left armed, it keeps deleting the oldest buckets while the
 *     operator decides whether to migrate, and nothing reports a dropped chunk.
 *  3. THE BUCKETS SURVIVE, EXACTLY. Counts and per-bucket values, before and
 *     after — a rename that silently re-materialized would look like success.
 *  4. THE BACKFILL IS RESUMABLE. Killed mid-run and re-run, the row counts and
 *     the energy must be UNCHANGED: not fewer (a gap) and not more (a double
 *     write, which looks like more data).
 *  5. VERIFICATION IS THE GATE ON THE ROLLBACK. The legacy objects are the only
 *     copy of the pre-cutover history until it passes, so an unverified drop must
 *     be refused.
 *
 * ## Why the 1.2.0 schema is recovered from the tag rather than transcribed
 *
 * `scripts/fixture-1-2-0.ts` already does exactly this and would be the natural
 * thing to call, but `apps/server` cannot import from `scripts/` — it is outside
 * tsc's `rootDir` and `tsc -b` silently emits `scripts/*.d.ts` when you try. So
 * the harness runs the same `git show addon-v1.2.0:…` and this file replays the
 * result. Nothing here spells a 1.2.0 column name that the tag does not.
 *
 * ## What this does NOT prove
 *
 * The SCALE. Four days of six metrics is not two months of 105, and the wall
 * clock is what decided the backfill cannot live in the addon's boot chain.
 * `scripts/upgrade-rehearsal.ts` runs the same code against the real fixture and
 * reports the real numbers.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { runMigrations } from "@SunReye/db/migrate";
import { type CounterReading, perDayEnergy } from "@SunReye/db/counter-energy";
import { runBackfill, verifyMigration } from "@SunReye/db/backfill-run";
import {
  dropLegacyStatements,
  readCatalog,
  readLegacyCadenceMs,
  readMigrationRecord,
  writeMigrationRecord,
} from "@SunReye/db/upgrade-120-run";
import { mayDropLegacy, migrationRecordSchema } from "@SunReye/db/upgrade-state";
import { ensureMetricKeys } from "@SunReye/db/metric-keys";
import { createDbAt } from "@SunReye/db";
import { dbProvisionStore, provisionDevice } from "../src/inverter/provision";
import { databaseReachable, resetLegacyDatabase, showAtLegacyTag } from "./harness";

const reachable = await databaseReachable();
if (!reachable) {
  const message = "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}
const suite = reachable ? describe : describe.skip;

/** The 1.2.0 files, in the order 1.2.0's own runner applied them. */
const LEGACY_FILES = [
  "packages/db/src/migrations/0000_brief_cammi.sql",
  "packages/db/src/migrations/0001_magenta_the_initiative.sql",
  "packages/db/src/timescale/0000_bootstrap.sql",
  "packages/db/src/timescale/policies.sql",
] as const;

/** Split on drizzle's breakpoint marker, dropping comment-only chunks. */
function statements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0 && !/^(--[^\n]*\n?)+$/.test(chunk));
}

const MINUTES_PER_DAY = 1440;
const SPAN_DAYS = 4;
const DAY_MS = 86_400_000;

/**
 * The span ends at the most recent UTC midnight, so it sits INSIDE 1.2.0's own
 * 7-day raw retention and 90-day minute retention.
 *
 * Deliberate: the tag's `policies.sql` is applied verbatim, which arms real
 * background jobs against this database. A span older than `drop_after` could be
 * deleted by one of them mid-test — the exact hazard the upgrade's first statement
 * exists to stop, and not something a test should race.
 */
const END_MS = Math.floor(Date.now() / DAY_MS) * DAY_MS;
const START_MS = END_MS - SPAN_DAYS * DAY_MS;
const START = new Date(START_MS).toISOString();
const END = new Date(END_MS).toISOString();
/** What 1.2.0's retention would have left: the last day of raw. */
const RAW_FROM = new Date(END_MS - DAY_MS).toISOString();

/** The cliff sits MID-DAY, where a daily bucket's naive max-minus-min is wrong. */
const RESTART_AT_MINUTE = Math.floor(SPAN_DAYS / 2) * MINUTES_PER_DAY + 720;
const LIFETIME_OFFSET = 45_000;
const RATE_PER_DAY = 30;
const LOST_AT_CLIFF = LIFETIME_OFFSET + (RATE_PER_DAY * RESTART_AT_MINUTE) / MINUTES_PER_DAY;

const TOTAL = "up.total_energy";
const DAY = "up.day_energy";
const POWER = "up.power";
const LIMIT = "up.settings.limit";
const MODE = "up.settings.mode";
const CONFIG_KEYS = [LIMIT, MODE];
const COUNTERS = [TOTAL, DAY];

/**
 * The seeded series, as SQL over the seed subquery.
 *
 * Written here rather than borrowed from the fixture for the same `rootDir`
 * reason as the schema, and it costs nothing: every ground truth below is read
 * back out of the SEEDED ROWS, so what is compared is the source against the
 * migration rather than either against a model.
 */
const SERIES: { key: string; isCounter: boolean; expr: string }[] = [
  {
    key: TOTAL,
    isCounter: true,
    expr:
      `case when s.mi >= ${RESTART_AT_MINUTE}` +
      ` then (${LIFETIME_OFFSET} + ${RATE_PER_DAY} * s.m / ${MINUTES_PER_DAY}) - ${LOST_AT_CLIFF}` +
      ` else ${LIFETIME_OFFSET} + ${RATE_PER_DAY} * s.m / ${MINUTES_PER_DAY} end`,
  },
  {
    key: DAY,
    isCounter: true,
    expr: `${RATE_PER_DAY} * mod(s.mi, ${MINUTES_PER_DAY})::double precision / ${MINUTES_PER_DAY}`,
  },
  {
    key: POWER,
    isCounter: false,
    expr: `greatest(0::double precision, 4000 * sin(pi() * ((mod(s.mi, ${MINUTES_PER_DAY})::double precision / 60) - 6) / 12))`,
  },
  {
    key: LIMIT,
    isCounter: false,
    expr: `case when s.mi >= ${RESTART_AT_MINUTE} then 60 else 40 end::double precision`,
  },
  { key: MODE, isCounter: false, expr: "2::double precision" },
];

const SOURCE_ID = "upgrade-profile-1.2.0";
const EPSILON = 1e-6;

suite("the in-place 1.2.0 -> 2.0.0 upgrade", () => {
  let url: string;
  let pool: SQL;
  let client: { query: (t: string, v?: readonly unknown[]) => Promise<{ rows: unknown[] }> };
  let deviceId: number;
  /** Per-metric per-UTC-day energy the ORIGINAL 1.2.0 samples imply. */
  let truth: ReturnType<typeof perDayEnergy>;
  /** The legacy tiers' bucket counts, read before the rename. */
  let legacyCounts: Record<string, number>;
  /** Every legacy minute bucket, as (metric, bucket, avg) — the integrity check. */
  let legacyDigest: string;

  const rows = async <T>(text: string, values: unknown[] = []): Promise<T[]> =>
    (await pool.unsafe(text, values)) as T[];
  const one = async (text: string, values: unknown[] = []): Promise<number> =>
    Number((await rows<{ n: string }>(text, values))[0]?.n ?? 0);

  beforeAll(async () => {
    url = await resetLegacyDatabase();
    pool = new SQL(url, { max: 1, idleTimeout: 0 });
    client = {
      query: async (text, values) => ({
        rows: (await pool.unsafe(text, values ? [...values] : [])) as unknown[],
      }),
    };

    // 1. The 1.2.0 schema, recovered from the tag and replayed statement by
    //    statement — including its POLICIES, because a step whose first job is
    //    detaching them must be run against a database that has them.
    for (const file of LEGACY_FILES) {
      for (const statement of statements(await showAtLegacyTag(file))) {
        await pool.unsafe(statement);
      }
    }

    // 2. The journals, stamped the way a real 1.2.0 instance has them. Without
    //    this the database looks like one that was never migrated, and the
    //    upgrade would take a different branch than it will in production.
    const journal = JSON.parse(
      await showAtLegacyTag("packages/db/src/migrations/meta/_journal.json"),
    ) as { entries: { tag: string; when: number }[] };
    await pool.unsafe("create schema if not exists drizzle");
    await pool.unsafe(
      `create table if not exists drizzle."__drizzle_migrations" (
         id serial primary key, hash text not null, created_at bigint)`,
    );
    for (const entry of journal.entries) {
      await pool.unsafe(
        `insert into drizzle."__drizzle_migrations" (hash, created_at) values ($1, $2)`,
        [`stamped-${entry.tag}`, entry.when],
      );
    }
    await pool.unsafe(
      `create table if not exists public.timescale_migrations (
         name text primary key, hash text not null, applied_at timestamptz not null default now())`,
    );
    await pool.unsafe(
      `insert into public.timescale_migrations (name, hash) values ('0000_bootstrap.sql', 'x')
       on conflict do nothing`,
    );

    // 3. The 1.x settings a real install carries, so provisioning has something
    //    to mine. `inverter` is the one the device is synthesised from.
    for (const [key, value] of [
      ["inverter", { host: "192.168.1.50", port: 502, unitId: 1 }],
      ["weather", { label: "Limburg-Weilburg", latitude: 50.4, longitude: 8.3 }],
      ["plant", { timeZone: "Europe/Berlin" }],
    ] as const) {
      await pool.unsafe(
        `insert into app_settings (key, value) values ($1, $2::text::jsonb)
         on conflict (key) do update set value = excluded.value`,
        [key, JSON.stringify(value)],
      );
    }
    await pool.unsafe(
      `insert into installed_profiles (id, source, version, data)
       values ($1, 'repo', '1.0.0', $2::text::jsonb)`,
      [SOURCE_ID, JSON.stringify({ id: SOURCE_ID, name: "Upgrade probe" })],
    );

    // 4. Four days of 1.2.0 readings, one INSERT per metric.
    for (const series of SERIES) {
      await pool.unsafe(
        `insert into metrics_raw (time, inverter_id, metric, value)
         select s.ts, $1, $2, ${series.expr}
         from (
           select ts,
                  (extract(epoch from (ts - $3::timestamptz)) / 60)::double precision as m,
                  (extract(epoch from (ts - $3::timestamptz)) / 60)::bigint as mi
           from generate_series($3::timestamptz, $4::timestamptz - interval '1 minute',
                                interval '1 minute') as ts
         ) s`,
        [SOURCE_ID, series.key, START, END],
      );
    }

    // 5. The ground truth, from the SEEDED SAMPLES, before retention takes them.
    // Placeholders rather than `= any($1::text[])`: bun's `SQL.unsafe` binds a JS
    // array as a SCALAR and Postgres answers `malformed array literal`.
    const readings = await rows<{ metric: string; time: Date | string; value: number }>(
      `select metric, time, value from metrics_raw
        where metric in (${COUNTERS.map((_, i) => `$${i + 1}`).join(", ")})
        order by metric, time`,
      [...COUNTERS],
    );
    truth = perDayEnergy(
      readings.map(
        (row): CounterReading => ({
          metric: row.metric,
          time: new Date(row.time).toISOString(),
          value: row.value,
        }),
      ),
    );

    // 6. Materialize all three 1.2.0 tiers over the whole span, then TRIM raw to
    //    the last day — the same order of events the real instance lived through,
    //    and the state that makes the minute tier the only full-span record.
    for (const tier of ["minute_rollups", "hourly_rollups", "daily_rollups"] as const) {
      await pool.unsafe(
        `call refresh_continuous_aggregate('${tier}', $1::timestamptz - interval '1 day',
                                            $2::timestamptz + interval '1 day')`,
        [START, END],
      );
    }
    await pool.unsafe(`delete from metrics_raw where time < $1::timestamptz`, [RAW_FROM]);

    legacyCounts = {};
    for (const tier of ["minute_rollups", "hourly_rollups", "daily_rollups"] as const) {
      legacyCounts[tier] = await one(`select count(*)::bigint as n from ${tier}`);
    }
    legacyDigest = String(
      (
        await rows<{ n: string }>(
          `select md5(string_agg(bucket::text || '|' || metric || '|' ||
                                 coalesce(avg_value::text, ''), ',' order by bucket, metric)) as n
             from minute_rollups`,
        )
      )[0]?.n,
    );
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  test("the seeded 1.2.0 database is the state the upgrade is FOR", async () => {
    // A green upgrade over an empty or raw-complete database would prove nothing:
    // the whole difficulty is that the full span exists only as buckets.
    expect(legacyCounts.minute_rollups).toBe(SPAN_DAYS * MINUTES_PER_DAY * SERIES.length);
    const raw = await one(`select count(*)::bigint as n from metrics_raw`);
    expect(raw).toBe(MINUTES_PER_DAY * SERIES.length);
    const policies = await one(
      `select count(*)::bigint as n from timescaledb_information.jobs where job_id >= 1000`,
    );
    // Counted from the tag's own policies.sql: 3 refresh policies, raw
    // compression, raw retention, minute compression, minute retention, hourly
    // retention. Every one of them has to be detached, and the minute retention
    // is the one that would otherwise eat the history.
    expect(policies).toBe(8);
    expect(truth.length).toBeGreaterThan(0);
  });

  describe("the blocking step", () => {
    let elapsedMs: number;

    beforeAll(async () => {
      const began = Date.now();
      await runMigrations(url);
      elapsedMs = Date.now() - began;
    }, 120_000);

    test("is CATALOG-ONLY, so it fits in the addon's 120 s boot chain", () => {
      // Measured at 0.2 s against the real 512 MB / 9.1 M bucket fixture. The
      // bound here is deliberately loose — what is being pinned is that it does
      // not move rows, and moving 9.1 M of them cannot be done in seconds.
      expect(elapsedMs).toBeLessThan(30_000);
    });

    test("leaves the NEW metrics_raw under the freed name", async () => {
      const columns = await rows<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'metrics_raw'`,
      );
      const names = columns.map((c) => c.column_name).sort();
      expect(names).toContain("device_id");
      expect(names).toContain("metric_id");
      expect(names).toContain("dur_ms");
      expect(names).not.toContain("inverter_id");
    });

    test("creates the 2.0.0 aggregate generation and keeps the 1.2.0 one", async () => {
      const views = (
        await rows<{ view_name: string }>(
          `select view_name from timescaledb_information.continuous_aggregates`,
        )
      ).map((r) => r.view_name);
      for (const tier of ["minute_rollups", "hourly_rollups", "daily_rollups"]) {
        expect(views).toContain(tier);
        expect(views).toContain(`legacy_${tier}`);
      }
    });

    test("DETACHES every 1.2.0 policy — the 90-day minute retention above all", async () => {
      // THE decisive statement. Left armed, that policy keeps dropping the oldest
      // buckets while the upgrade waits for the operator, and on a ~60-day
      // instance the oldest are ~30 days from deletion.
      const jobs = (
        await rows<{ label: string }>(
          `select proc_name || ':' || coalesce(hypertable_name, '-') as label
             from timescaledb_information.jobs where job_id >= 1000`,
        )
      ).map((r) => r.label);
      expect(jobs.filter((job) => /legacy_|metrics_raw_legacy/.test(job))).toEqual([]);
      // …and the NEW generation's policies are armed, because policies.sql is
      // re-applied on every run and now names the new relations.
      expect(jobs).toContain("policy_retention:metrics_raw");
      expect(jobs).toContain("policy_refresh_continuous_aggregate:minute_rollups");
    });

    test("preserves every legacy bucket, bit for bit", async () => {
      for (const tier of ["minute_rollups", "hourly_rollups", "daily_rollups"] as const) {
        expect(await one(`select count(*)::bigint as n from legacy_${tier}`)).toBe(
          legacyCounts[tier] as number,
        );
      }
      const digest = String(
        (
          await rows<{ n: string }>(
            `select md5(string_agg(bucket::text || '|' || metric || '|' ||
                                   coalesce(avg_value::text, ''), ',' order by bucket, metric)) as n
               from legacy_minute_rollups`,
          )
        )[0]?.n,
      );
      expect(digest).toBe(legacyDigest);
    });

    test("keeps the retained raw window in metrics_raw_legacy", async () => {
      expect(await one(`select count(*)::bigint as n from metrics_raw_legacy`)).toBe(
        MINUTES_PER_DAY * SERIES.length,
      );
    });

    test("records what is WITHHELD, so no read can answer a partial window silently", async () => {
      const record = await readMigrationRecord(client);
      expect(record.stage).toBe("cutover");
      expect(record.sourceId).toBe(SOURCE_ID);
      expect(record.legacyRawFrom).toBe(new Date(RAW_FROM).toISOString());
      // The bucket replay must stop where the carried raw begins.
      expect(record.replayTo).toBe(new Date(RAW_FROM).toISOString());
    });

    test("is IDEMPOTENT: a second run renames nothing and changes nothing", async () => {
      // The dangerous re-run. Renaming again would move the NEW metrics_raw out
      // from under the app and hand the freed name to nothing.
      const before = await one(`select count(*)::bigint as n from legacy_minute_rollups`);
      await runMigrations(url);
      expect(await one(`select count(*)::bigint as n from legacy_minute_rollups`)).toBe(before);
      const columns = await rows<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'metrics_raw'`,
      );
      expect(columns.map((c) => c.column_name)).toContain("device_id");
    }, 120_000);
  });

  describe("provisioning, then the backfill", () => {
    const logger = { info: () => {}, warn: () => {} };

    beforeAll(async () => {
      // The REAL provisioning path, mining the 1.x `app_settings` blobs — not a
      // raw insert. `devices.id` is written into every replayed row, so a
      // provisioning that re-inserted on the second boot would strand all of them.
      const db = createDbAt(url);
      const result = await provisionDevice({
        store: dbProvisionStore({ execute: (query) => db.execute(query) }),
        logger,
        profile: { id: SOURCE_ID, name: "Upgrade probe" },
        config: {
          host: "192.168.1.50",
          port: 502,
          transport: "tcp",
          unitId: 1,
          timeoutMs: 2000,
          pollIntervalMs: 1000,
        },
      });
      deviceId = result.deviceId;
      await ensureMetricKeys(
        db,
        SERIES.map((s) => ({ key: s.key, isCounter: s.isCounter })),
      );
    }, 60_000);

    test("names the plant from the 1.x weather label, not from the profile", async () => {
      // A plant is a place; an inverter model is not one. The label is the only
      // human-typed name a 1.x install has for its site.
      const plants = await rows<{ name: string; slug: string }>(`select name, slug from plants`);
      expect(plants).toHaveLength(1);
      expect(plants[0]?.name).toBe("Limburg-Weilburg");
      expect(plants[0]?.slug).toBe("limburg-weilburg");
    });

    test("the device slug is derived from its ROLE, so a profile swap cannot move it", async () => {
      const devices = await rows<{ slug: string; profile_id: string }>(
        `select slug, profile_id from devices`,
      );
      expect(devices).toHaveLength(1);
      expect(devices[0]?.slug).toBe("inverter");
      expect(devices[0]?.profile_id).toBe(SOURCE_ID);
    });

    test("measures the 1.2.0 poll cadence from its own data", async () => {
      expect(await readLegacyCadenceMs(client)).toBe(60_000);
    });

    test("REFUSES to run while a source metric is unregistered — the shared code path", async () => {
      // The carry and the bucket replay are the same statements in
      // `packages/db/src/replay-run.ts`, which is what the importer uses too. The
      // proof is behavioural: the carry inherits the replay's refusal, so a metric
      // whose history would be dropped by a `join metric_keys` that found no match
      // stops the run rather than vanishing.
      await pool.unsafe(`delete from metric_keys where key = $1`, [POWER]);
      const { carryLegacyRaw } = await import("@SunReye/db/upgrade-120-run");
      await expect(
        carryLegacyRaw(client, { sourceId: SOURCE_ID, deviceId, durMs: 60_000 }),
      ).rejects.toThrow(/not registered in metric_keys/);
      await ensureMetricKeys(createDbAt(url), [{ key: POWER, isCounter: false }]);
    });

    describe("resumability", () => {
      let afterKill: { raw: number; chunks: number };
      let final: { raw: number; chunks: number };

      beforeAll(async () => {
        const configKeys = CONFIG_KEYS;
        // A REAL kill: `onChunk` throws AFTER the chunk has committed, so the
        // process dies with some days written and the rest not — a Supervisor
        // timeout or a power cut, not a rollback.
        let written = 0;
        await expect(
          runBackfill(
            client,
            { deviceId, configKeys, rawDurMs: 60_000 },
            {
              onChunk: () => {
                written += 1;
                if (written === 2) throw new Error("killed mid-run");
              },
            },
          ),
        ).rejects.toThrow(/killed mid-run/);
        afterKill = {
          raw: await one(`select count(*)::bigint as n from metrics_raw`),
          chunks: await one(`select count(*)::bigint as n from replay_progress`),
        };
        expect(afterKill.chunks).toBeGreaterThan(0);

        const done = await runBackfill(client, { deviceId, configKeys, rawDurMs: 60_000 });
        expect(done).not.toBeNull();
        final = {
          raw: await one(`select count(*)::bigint as n from metrics_raw`),
          chunks: await one(`select count(*)::bigint as n from replay_progress`),
        };
      }, 300_000);

      test("the kill leaves committed work behind, not a rollback of everything", () => {
        expect(afterKill.raw).toBeGreaterThan(0);
        expect(final.raw).toBeGreaterThan(afterKill.raw);
      });

      test("every day of the span is present exactly ONCE — no gap, no double write", async () => {
        // One row per (metric, minute) across the whole span: the carried raw day
        // and the replayed bucket days, and nothing counted twice.
        const seriesMetrics = SERIES.filter((s) => !CONFIG_KEYS.includes(s.key)).length;
        expect(final.raw).toBe(SPAN_DAYS * MINUTES_PER_DAY * seriesMetrics);
        const duplicates = await one(
          `select count(*)::bigint as n from (
             select time, metric_id from metrics_raw group by 1, 2 having count(*) > 1) d`,
        );
        expect(duplicates).toBe(0);
      });

      test("a THIRD run writes nothing at all", async () => {
        const again = await runBackfill(client, {
          deviceId,
          configKeys: CONFIG_KEYS,
          rawDurMs: 60_000,
        });
        // `null` because the record already says `backfilled`: the cheapest
        // possible no-op, and the one an idle boot hook must take.
        expect(again).toBeNull();
        expect(await one(`select count(*)::bigint as n from metrics_raw`)).toBe(final.raw);
      }, 120_000);

      test("the carried raw rows claim the MEASURED cadence, not a bucket width", async () => {
        const durations = await rows<{ dur_ms: number; n: string }>(
          `select dur_ms, count(*)::bigint as n from metrics_raw
            where time >= $1::timestamptz group by 1 order by 2 desc`,
          [RAW_FROM],
        );
        expect(durations[0]?.dur_ms).toBe(60_000);
      });

      test("configuration registers are in the change-log, NOT in the hypertable", async () => {
        const inRaw = await one(
          `select count(*)::bigint as n from metrics_raw r
             join metric_keys mk on mk.id = r.metric_id
            where mk.key in (${CONFIG_KEYS.map((_, i) => `$${i + 1}`).join(", ")})`,
          [...CONFIG_KEYS],
        );
        expect(inRaw).toBe(0);
        // The information content is THREE rows for four days: LIMIT starts at 40
        // and changes once to 60, MODE never changes. Not one row per bucket
        // (11 520) and not one per day-chunk (8).
        //
        // The count is 3 + one per config metric, and the extra rows are a KNOWN,
        // BOUNDED consequence of running the raw carry BEFORE the bucket replay.
        // The carry covers the LAST day and the replay the earlier ones, so the
        // carry's `prior` lookup (`time < chunk start`) finds nothing and logs
        // each config metric's value once more even though it had not changed.
        // Carry-first is deliberate — it is the cheap half and it puts the week
        // the operator looks at first on the dashboard in seconds rather than
        // after the whole replay — and the cost is at most one redundant row per
        // config metric, once, in a table that is read `distinct on (metric_id)
        // order by time desc`. That read is unaffected, which the next assertion
        // is what proves.
        expect(await one(`select count(*)::bigint as n from metrics_config_log`)).toBe(
          3 + CONFIG_KEYS.length,
        );
        const latest = await rows<{ key: string; value: number }>(
          `select distinct on (l.metric_id) mk.key, l.value
             from metrics_config_log l join metric_keys mk on mk.id = l.metric_id
            order by l.metric_id, l.time desc`,
        );
        expect(latest.find((r) => r.key === LIMIT)?.value).toBe(60);
        expect(latest.find((r) => r.key === MODE)?.value).toBe(2);
      });

      test("the ENERGY the 1.2.0 samples recorded survives, reset day included", async () => {
        for (const metric of COUNTERS) {
          const measured = await rows<{ day: string; delta: number; resets: number }>(
            `select to_char(d.bucket, 'YYYY-MM-DD') as day, delta(d.ctr) as delta,
                    num_resets(d.ctr)::int as resets
               from daily_rollups d join metric_keys mk on mk.id = d.metric_id
              where d.device_id = $1 and mk.key = $2 order by d.bucket`,
            [deviceId, metric],
          );
          const expected = truth.filter((row) => row.metric === metric);
          expect(measured).toHaveLength(expected.length);

          // PER DAY, within ONE SAMPLE STEP. A day bucket's `delta` cannot see the
          // increment earned between 23:59 and 00:00, which the ground truth
          // attributes to the LATER day. That is an attribution difference at the
          // boundary, not a loss — do NOT "fix" the daily number.
          const stepFor = (energy: number) => Math.abs(energy) / MINUTES_PER_DAY;
          for (const [index, day] of expected.entries()) {
            const got = Number(measured[index]?.delta ?? 0);
            expect(Math.abs(got - day.energy)).toBeLessThan(stepFor(day.energy) * 1.5 + EPSILON);
          }

          // THE WHOLE SPAN, EXACTLY. `delta(rollup(ctr))` recombines every daily
          // partial into one `counter_agg` over every replayed sample, so the
          // boundary attribution cancels out. Summing the per-day deltas does NOT
          // — it loses one step per boundary — which is why the exact claim is
          // made here and only here. If this drifts, energy was lost or invented.
          const expectedTotal = expected.reduce((sum, row) => sum + row.energy, 0);
          const span = await rows<{ delta: number; resets: number }>(
            // `num_resets` is bigint and would arrive as a STRING, so the cast is
            // in the SQL rather than in the comparison.
            `select delta(rollup(d.ctr)) as delta, num_resets(rollup(d.ctr))::int as resets
               from daily_rollups d join metric_keys mk on mk.id = d.metric_id
              where d.device_id = $1 and mk.key = $2`,
            [deviceId, metric],
          );
          expect(Math.abs(Number(span[0]?.delta) - expectedTotal)).toBeLessThan(
            1e-6 * Math.max(1, expectedTotal),
          );

          // EVERY reset is still counted, and only the ROLLUP can see them all.
          // A midnight-aligned reset happens BETWEEN two daily buckets (23:59
          // reads 29.98, 00:00 reads 0), so `num_resets` inside either bucket is
          // 0 while the ground truth attributes one to the later day. `rollup`
          // compares the partials' boundary values and recovers it — the same
          // property that makes the mid-day cliff countable at day scale. The day
          // register resets at every midnight inside the span, so this is not a
          // one-off case: it is most of them.
          const expectedResets = expected.reduce((sum, row) => sum + row.resets, 0);
          expect(Number(span[0]?.resets)).toBe(expectedResets);
        }
      });

      test("the MID-DAY counter cliff is counted, where naive max-minus-min is not", async () => {
        const cliffDay = new Date(START_MS + Math.floor(SPAN_DAYS / 2) * DAY_MS)
          .toISOString()
          .slice(0, 10);
        const row = (
          await rows<{ naive: number; delta: number; resets: number }>(
            `select d.max_value - d.min_value as naive, delta(d.ctr) as delta,
                    num_resets(d.ctr)::int as resets
               from daily_rollups d join metric_keys mk on mk.id = d.metric_id
              where d.device_id = $1 and mk.key = $2 and d.bucket = $3::timestamptz`,
            [deviceId, TOTAL, `${cliffDay}T00:00:00Z`],
          )
        )[0];
        expect(row?.resets).toBe(1);
        const expected = truth.find((r) => r.metric === TOTAL && r.day === cliffDay);
        expect(expected).toBeDefined();
        // `delta` is right; the naive number is wrong by three orders of magnitude.
        expect(Math.abs(Number(row?.delta) - (expected?.energy ?? 0))).toBeLessThan(
          (expected?.energy ?? 0) * 0.05 + EPSILON,
        );
        expect(Number(row?.naive)).toBeGreaterThan((expected?.energy ?? 0) * 100);
      });
    });
  });

  describe("verification is the gate on the rollback", () => {
    test("an unverified migration may NOT drop the legacy objects", async () => {
      const record = await readMigrationRecord(client);
      expect(record.stage).toBe("backfilled");
      expect(mayDropLegacy(record)).toBe(false);
    });

    test("verification compares every metric-day and records `verified`", async () => {
      const result = await verifyMigration(client, deviceId, CONFIG_KEYS);
      expect(result.problems).toEqual([]);
      expect(result.compared).toBeGreaterThan(0);
      expect(result.record.stage).toBe("verified");
      expect(mayDropLegacy(result.record)).toBe(true);
    }, 120_000);

    test("a verification with nothing to compare is a FINDING, not a pass", async () => {
      // A comparison over nothing proves nothing, and this is the one place where
      // a vacuous green is permanent. Asked about a device that wrote no rows.
      const result = await verifyMigration(client, 32_000, CONFIG_KEYS);
      expect(result.problems.length).toBeGreaterThan(0);
    });

    test("a verification failure does not advance the stage", async () => {
      const record = await readMigrationRecord(client);
      expect(record.stage).toBe("verified");
    });

    test("the drop removes the 1.2.0 objects and leaves the new tiers answering", async () => {
      const statementsToRun = dropLegacyStatements(await readCatalog(client));
      expect(statementsToRun).toEqual([
        "drop materialized view legacy_minute_rollups",
        "drop materialized view legacy_hourly_rollups",
        "drop materialized view legacy_daily_rollups",
        "drop table metrics_raw_legacy",
      ]);
      for (const statement of statementsToRun) await pool.unsafe(statement);
      // The aggregates go before the hypertable: dropping it first would need
      // CASCADE, and a CASCADE over an instance's only copy of its history is not
      // a statement worth having.
      expect(await one(`select count(*)::bigint as n from daily_rollups`)).toBeGreaterThan(0);
      expect(await one(`select count(*)::bigint as n from metrics_raw`)).toBe(
        SPAN_DAYS * MINUTES_PER_DAY * SERIES.filter((s) => !CONFIG_KEYS.includes(s.key)).length,
      );
      expect(dropLegacyStatements(await readCatalog(client))).toEqual([]);
    }, 60_000);

    test("a re-run of the migration after the drop is a plain no-op", async () => {
      // Nothing legacy-shaped is left, so `classifyUpgrade` must say not-needed
      // rather than finding half a state to act on.
      await runMigrations(url);
      expect((await readMigrationRecord(client)).stage).toBe("verified");
    }, 120_000);

    test("a stage that is not `verified` refuses the drop even after one", async () => {
      await writeMigrationRecord(
        client,
        migrationRecordSchema.parse({ ...(await readMigrationRecord(client)), stage: "deferred" }),
      );
      expect(mayDropLegacy(await readMigrationRecord(client))).toBe(false);
    });
  });
});
