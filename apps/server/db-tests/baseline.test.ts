/**
 * The 2.0.0 baseline schema, against a real TimescaleDB.
 *
 * This is the only proof that `packages/db/src/timescale/0000_baseline.sql`
 * works. Every claim it makes is a claim about what *Postgres and TimescaleDB
 * accept and compute*, and none of them can be checked by reading SQL text:
 *
 *  - `time_weight('LOCF', …)`, `counter_agg` and `rollup()` come from
 *    `timescaledb_toolkit`, an extension that is not in the stock image. A
 *    missing toolkit is a boot-time failure, not a type error.
 *  - a continuous aggregate built ON another continuous aggregate (the
 *    hierarchy) is accepted or rejected by TimescaleDB depending on the parent's
 *    settings, and the value it computes is either exactly the value a direct
 *    scan of raw would give, or it is a silent approximation.
 *  - `compress_segmentby`, `materialized_only`, the hypertable's chunk interval
 *    and the dimension foreign keys all live in TimescaleDB's own catalogs. A
 *    statement can succeed and leave the setting unset (the #134 class of bug:
 *    compression enabled with no segmentby), so the catalogs are what is
 *    asserted here, never the file that tried to set them.
 *
 * The two invariants from the plan's step C get a test each, at the bottom: ids
 * must survive a profile uninstall and a `TRUNCATE metrics_raw`, and metric keys
 * must be reused rather than renumbered on a profile reinstall.
 */
import { describe, expect, test } from "bun:test";
import { type SQL, sql } from "drizzle-orm";
import { databaseReachable, resetTestDatabase } from "./harness";

const reachable = await databaseReachable();
if (!reachable) {
  const message = "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}

const suite = reachable ? describe : describe.skip;

/** The one segmentby every timeseries relation must carry. */
const SEGMENTBY = "device_id, metric_id";

/** The three tiers of the single rollup generation. */
const TIERS = ["minute_rollups", "hourly_rollups", "daily_rollups"] as const;

suite("the 2.0.0 baseline schema", () => {
  let db: Awaited<ReturnType<typeof client>>;

  async function client() {
    const url = await resetTestDatabase();
    const { createDbAt } = await import("@SunReye/db");
    return createDbAt(url);
  }

  async function rows<T extends Record<string, unknown>>(query: SQL): Promise<T[]> {
    const result = await db.execute(query);
    return result.rows as T[];
  }

  async function one<T extends Record<string, unknown>>(query: SQL): Promise<T | undefined> {
    return (await rows<T>(query))[0];
  }

  /**
   * The error a statement raises, or "" when it succeeded.
   *
   * `expect(db.execute(…)).rejects` cannot be used: drizzle's execute returns a
   * lazily-executing query BUILDER that is merely thenable, and bun's `rejects`
   * reports the builder object rather than awaiting it — so the assertion passes
   * whatever the database does, which is worse than no test.
   */
  async function failure(query: SQL): Promise<string> {
    try {
      await db.execute(query);
      return "";
    } catch (error) {
      // drizzle wraps the driver error in a "Failed query:" Error and hangs the
      // real one off `cause`; only the cause carries the constraint name, which
      // is the whole point of asserting on the message.
      if (!(error instanceof Error)) return String(error);
      const cause = error.cause;
      return cause instanceof Error ? `${error.message} ${cause.message}` : error.message;
    }
  }

  test("bootstrap: the baseline applies cleanly to an empty database", async () => {
    db = await client();
    const ext = await rows<{ extname: string }>(
      sql`select extname from pg_extension where extname in ('timescaledb', 'timescaledb_toolkit') order by extname`,
    );
    expect(ext.map((e) => e.extname)).toEqual(["timescaledb", "timescaledb_toolkit"]);
  });

  test("exactly one baseline file is journaled, under a name that is not an edit of the old bootstrap", async () => {
    const applied = await rows<{ name: string }>(
      sql`select name from public.timescale_migrations order by name`,
    );
    // A new NAME, not an edited 0000_bootstrap.sql: `timescale_migrations`
    // records a hash and never verifies it, so editing an applied file is
    // silently ignored on every existing database.
    expect(applied.map((r) => r.name)).toEqual(["0000_baseline.sql"]);
  });

  describe("the timeseries relations", () => {
    test("metrics_raw is a hypertable with 1-day chunks", async () => {
      const ht = await one<{ num_dimensions: number }>(sql`
        select num_dimensions from timescaledb_information.hypertables
        where hypertable_name = 'metrics_raw'`);
      expect(ht?.num_dimensions).toBe(1);

      const dim = await one<{ time_interval: string }>(sql`
        select time_interval::text from timescaledb_information.dimensions
        where hypertable_name = 'metrics_raw'`);
      expect(dim?.time_interval).toBe("1 day");
    });

    test("metrics_raw compresses segmented by the int2 identity", async () => {
      // One row per column in this view, so the shape has to be reassembled in
      // index order — `segmentby_column_index` is what makes 'device_id,
      // metric_id' different from 'metric_id, device_id'.
      const segmentby = await rows<{ attname: string }>(sql`
        select attname from timescaledb_information.compression_settings
        where hypertable_name = 'metrics_raw' and segmentby_column_index is not null
        order by segmentby_column_index`);
      expect(segmentby.map((c) => c.attname).join(", ")).toBe(SEGMENTBY);

      const orderby = await one<{ attname: string; orderby_asc: boolean }>(sql`
        select attname, orderby_asc from timescaledb_information.compression_settings
        where hypertable_name = 'metrics_raw' and orderby_column_index = 1`);
      expect(orderby?.attname).toBe("time");
      // DESC: the newest rows of a chunk are the ones a read wants first.
      expect(orderby?.orderby_asc).toBe(false);
    });

    test("metrics_config_log is a plain table, not a hypertable", async () => {
      const ht = await one<{ n: number }>(sql`
        select count(*)::int as n from timescaledb_information.hypertables
        where hypertable_name = 'metrics_config_log'`);
      expect(ht?.n).toBe(0);
    });

    test("metrics_config_log carries no dur_ms", async () => {
      const cols = await rows<{ attname: string }>(sql`
        select attname from pg_attribute
        where attrelid = 'metrics_config_log'::regclass and attnum > 0 and not attisdropped`);
      expect(cols.map((c) => c.attname)).not.toContain("dur_ms");
    });
  });

  describe("the rollup generation", () => {
    test("there are exactly three continuous aggregates, all named *_rollups", async () => {
      const aggs = await rows<{ view_name: string }>(sql`
        select view_name from timescaledb_information.continuous_aggregates
        where view_schema = 'public' order by view_name`);
      expect(aggs.map((a) => a.view_name).sort()).toEqual([...TIERS].sort());
      // drizzle.config.ts's tablesFilter is ["!*_rollups"]; a name outside that
      // pattern makes drizzle emit DROP VIEW, which TimescaleDB rejects.
      for (const agg of aggs) expect(agg.view_name.endsWith("_rollups")).toBe(true);
    });

    test("every tier is a real-time aggregate", async () => {
      const aggs = await rows<{ view_name: string; materialized_only: boolean }>(sql`
        select view_name, materialized_only
        from timescaledb_information.continuous_aggregates where view_schema = 'public'`);
      for (const agg of aggs) expect(agg.materialized_only).toBe(false);
    });

    test("every tier compresses, segmented like metrics_raw, from birth", async () => {
      const found = await rows<{ view_name: string; segmentby: string }>(sql`
        select a.view_name,
               string_agg(s.attname, ', ' order by s.segmentby_column_index) as segmentby
        from timescaledb_information.continuous_aggregates a
        join timescaledb_information.compression_settings s
          on s.hypertable_name = a.materialization_hypertable_name
        where a.view_schema = 'public' and s.segmentby_column_index is not null
        group by a.view_name
        order by a.view_name`);
      expect(found.map((f) => f.view_name).sort()).toEqual([...TIERS].sort());
      for (const tier of found) expect(tier.segmentby).toBe(SEGMENTBY);
    });

    test("the hierarchy is real: daily reads hourly, not raw", async () => {
      // `hypertable_name` on a continuous aggregate is what it is defined OVER.
      // If daily_rollups pointed at metrics_raw the hierarchy would be three
      // independent scans of raw wearing a hierarchy's comments.
      const parents = await rows<{ view_name: string; hypertable_name: string }>(sql`
        select view_name, hypertable_name from timescaledb_information.continuous_aggregates
        where view_schema = 'public' order by view_name`);
      const parentOf = new Map(parents.map((p) => [p.view_name, p.hypertable_name]));
      expect(parentOf.get("minute_rollups")).toBe("metrics_raw");
      // Hourly reads raw and not minute, because `counter_agg` needs the
      // individual samples a continuous aggregate cannot hand it.
      expect(parentOf.get("hourly_rollups")).toBe("metrics_raw");
      // Daily reads HOURLY's materialization hypertable. Looked up rather than
      // written as `_materialized_hypertable_3`, which is an allocation order
      // that changes the moment a tier is added or reordered.
      const hourly = await one<{ materialization_hypertable_name: string }>(sql`
        select materialization_hypertable_name from timescaledb_information.continuous_aggregates
        where view_name = 'hourly_rollups'`);
      expect(parentOf.get("daily_rollups")).toBe(hourly?.materialization_hypertable_name);
    });

    test("counter_agg is on hourly and daily only — never on the minute tier", async () => {
      const cols = await rows<{ relname: string; attname: string; dt: string }>(sql`
        select c.relname, a.attname, format_type(a.atttypid, a.atttypmod) as dt
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid
        where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
          and c.relname in ('minute_rollups', 'hourly_rollups', 'daily_rollups')`);
      const byRelation = (name: string) =>
        cols.filter((c) => c.relname === name).map((c) => `${c.attname}:${c.dt}`);
      // A CounterSummary partial measures 184 B (proved below), so a minute
      // tier carrying one costs ~28 MB per device-day uncompressed.
      expect(byRelation("minute_rollups")).not.toContain("ctr:countersummary");
      expect(byRelation("hourly_rollups")).toContain("ctr:countersummary");
      expect(byRelation("daily_rollups")).toContain("ctr:countersummary");
      for (const tier of TIERS) expect(byRelation(tier)).toContain("tw:timeweightsummary");
    });

    test("a CounterSummary really is ~4x a TimeWeightSummary", async () => {
      // The measurement the tier layout rests on, taken here rather than
      // quoted, so a toolkit upgrade that changes the partial's size shows up.
      const size = await one<{ ctr: number; tw: number }>(sql`
        select pg_column_size(counter_agg(t, v)) as ctr,
               pg_column_size(time_weight('LOCF', t, v)) as tw
        from (values (now(), 1::float8), (now() + interval '1s', 2::float8)) as s(t, v)`);
      expect(size?.ctr).toBe(184);
      expect(size?.tw).toBe(49);
    });
  });

  describe("the dimension foreign keys", () => {
    test("every reading references its dimensions with ON DELETE RESTRICT", async () => {
      const fks = await rows<{ conrelid: string; confrelid: string; confdeltype: string }>(sql`
        select conrelid::regclass::text as conrelid,
               confrelid::regclass::text as confrelid,
               confdeltype
        from pg_constraint
        where contype = 'f' and conrelid in ('metrics_raw'::regclass, 'metrics_config_log'::regclass)
        order by conrelid::regclass::text, confrelid::regclass::text`);
      expect(fks).toEqual([
        { conrelid: "metrics_config_log", confrelid: "devices", confdeltype: "r" },
        { conrelid: "metrics_config_log", confrelid: "metric_keys", confdeltype: "r" },
        { conrelid: "metrics_raw", confrelid: "devices", confdeltype: "r" },
        { conrelid: "metrics_raw", confrelid: "metric_keys", confdeltype: "r" },
      ]);
    });

    test("no ON DELETE CASCADE anywhere near a dimension", async () => {
      // Invariant C1 as a schema-wide statement: a cascade from any table into
      // devices / metric_keys / plants would let one delete renumber history's
      // meaning. `c` is CASCADE, `n` is SET NULL, `d` is SET DEFAULT.
      const bad = await rows<{ conname: string; confdeltype: string }>(sql`
        select conname, confdeltype from pg_constraint
        where contype = 'f'
          and confrelid in ('devices'::regclass, 'metric_keys'::regclass, 'plants'::regclass)
          and confdeltype in ('c', 'n', 'd')`);
      expect(bad).toEqual([]);
    });

    test("the FK is enforced from inside a chunk", async () => {
      const message = await failure(sql`
        insert into metrics_raw (time, value, dur_ms, device_id, metric_id)
        values (now(), 1, 1000, 32000, 1)`);
      expect(message).toMatch(/foreign key/i);
      // The chunk, not the parent table: the constraint is enforced where the
      // row actually lands.
      expect(message).toMatch(/_hyper_\d+_\d+_chunk/);
    });
  });

  describe("the reading row's physical layout", () => {
    test("the column order packs without padding", async () => {
      // The plan claims the order (time, value, dur_ms, device_id, metric_id) is
      // chosen so the fixed-width fields pack. Proved against the alternatives
      // rather than asserted: pg_column_size includes the tuple header, so the
      // numbers are the real per-row cost.
      await db.execute(sql`
        create table if not exists packing_probe_naive
          ("time" timestamptz, dur_ms int4, device_id int2, value float8, metric_id int2)`);
      await db.execute(sql`
        create table if not exists packing_probe_worst
          ("time" timestamptz, device_id int2, value float8, metric_id int2, dur_ms int4)`);
      await db.execute(sql`insert into packing_probe_naive values (now(), 1000, 1, 1.5, 1)`);
      await db.execute(sql`insert into packing_probe_worst values (now(), 1, 1.5, 1, 1000)`);

      await db.execute(
        sql`insert into plants (name, slug, time_zone) values ('p', 'packing', 'UTC')`,
      );
      await db.execute(sql`
        insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
        select id, null, 1, 'packing-probe', 'probe', 'test-profile', 'inverter' from plants where slug = 'packing'`);
      await db.execute(
        sql`insert into metric_keys (key, is_counter) values ('packing.probe', false)`,
      );
      await db.execute(sql`
        insert into metrics_raw (time, value, dur_ms, device_id, metric_id)
        select now(), 1.5, 1000, d.id, m.id from devices d, metric_keys m
        where d.slug = 'packing-probe' and m.key = 'packing.probe'`);

      const chosen = await one<{ n: number }>(
        sql`select pg_column_size(r.*) as n from metrics_raw r limit 1`,
      );
      const naive = await one<{ n: number }>(
        sql`select pg_column_size(p.*) as n from packing_probe_naive p limit 1`,
      );
      const worst = await one<{ n: number }>(
        sql`select pg_column_size(p.*) as n from packing_probe_worst p limit 1`,
      );
      expect(chosen?.n).toBe(48);
      expect(naive?.n).toBe(50);
      expect(worst?.n).toBe(56);
    });
  });

  describe("the aggregates materialize and read back correctly", () => {
    /** Ids this block's rows are scoped to — the harness shares one database. */
    let deviceId = 0;
    let powerId = 0;
    let counterId = 0;

    test("seed and refresh every tier", async () => {
      await db.execute(
        sql`insert into plants (name, slug, time_zone) values ('agg', 'agg', 'UTC')`,
      );
      const device = await one<{ id: number }>(sql`
        insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
        select id, null, 1, 'agg-device', 'agg', 'test-profile', 'inverter' from plants where slug = 'agg'
        returning id`);
      deviceId = device?.id ?? 0;
      expect(deviceId).toBeGreaterThan(0);

      const power = await one<{ id: number }>(
        sql`insert into metric_keys (key, is_counter) values ('agg.power', false) returning id`,
      );
      const counter = await one<{ id: number }>(
        sql`insert into metric_keys (key, is_counter) values ('agg.energy', true) returning id`,
      );
      powerId = power?.id ?? 0;
      counterId = counter?.id ?? 0;

      // A value held ACROSS midnight — the case dur_ms weighting got wrong by
      // attributing the whole hold to the bucket the row is stamped in.
      await db.execute(sql`
        insert into metrics_raw (time, value, dur_ms, device_id, metric_id) values
          ('2026-01-01 23:50:00Z', 100, 1200000, ${deviceId}, ${powerId}),
          ('2026-01-02 00:10:00Z', 200, 3000000, ${deviceId}, ${powerId}),
          ('2026-01-02 01:00:00Z', 200,    1000, ${deviceId}, ${powerId})`);
      // A counter that resets between the two hours — the reset must survive
      // being rolled up from hourly into daily.
      await db.execute(sql`
        insert into metrics_raw (time, value, dur_ms, device_id, metric_id) values
          ('2026-01-02 00:00:00Z', 10, 1000, ${deviceId}, ${counterId}),
          ('2026-01-02 00:30:00Z', 40, 1000, ${deviceId}, ${counterId}),
          ('2026-01-02 01:00:00Z',  5, 1000, ${deviceId}, ${counterId}),
          ('2026-01-02 01:30:00Z', 25, 1000, ${deviceId}, ${counterId})`);

      // Parent before child: daily reads hourly, so refreshing daily first would
      // roll up buckets hourly has not materialized yet.
      //
      // BOUNDED, not `(NULL, NULL)`: a full refresh advances the watermark past
      // every existing row, and real-time aggregation only shows rows BEYOND the
      // watermark — so an unbounded refresh here would make the real-time test
      // below unable to fail. Bounding it to the seeded window also keeps this
      // block from materializing whatever another spec file left in the shared
      // database.
      for (const tier of TIERS) {
        await db.execute(sql`call refresh_continuous_aggregate(
          ${sql.raw(`'${tier}'`)}, '2026-01-01Z'::timestamptz, '2026-01-03Z'::timestamptz)`);
      }
    });

    test("time_weight attributes a midnight-spanning hold to both buckets", async () => {
      // 23:00 bucket: 100 held 23:50 -> 00:00.
      // 00:00 bucket: 100 for 10 min then 200 for 50 min = 183.33…
      // dur_ms weighting gave the 23:00 bucket the entire 20-minute hold and the
      // 00:00 bucket none of it. `interpolated_average` is what makes the
      // boundary right, and it needs the neighbouring partials — which is why the
      // aggregates materialize the partial and not a finished mean.
      const got = await rows<{ bucket: string; interpolated: number | null }>(sql`
        select bucket,
               interpolated_average(tw, bucket, '1 hour'::interval,
                 lag(tw) over w, lead(tw) over w) as interpolated
        from hourly_rollups
        where device_id = ${deviceId} and metric_id = ${powerId}
        window w as (order by bucket)
        order by bucket`);
      expect(got.map((r) => r.interpolated)).toEqual([100, 183.33333333333334, 200]);
    });

    test("a single-point bucket has no plain average, which is why reads interpolate", async () => {
      // Not a defect — a statement of what the read layer must do. A change-only
      // writer leaves most buckets holding one row, and `average()` of a
      // one-point TimeWeightSummary is NULL because a point has no duration.
      const plain = await rows<{ average: number | null }>(sql`
        select average(tw) as average from hourly_rollups
        where device_id = ${deviceId} and metric_id = ${powerId} order by bucket`);
      expect(plain.map((r) => r.average)).toEqual([null, null, null]);
    });

    test("daily rolled up from hourly is EXACTLY a direct scan of raw", async () => {
      const hierarchical = await one<{ value: number | null }>(sql`
        select average(tw) as value from daily_rollups
        where device_id = ${deviceId} and metric_id = ${powerId} and bucket = '2026-01-02Z'`);
      const direct = await one<{ value: number | null }>(sql`
        select average(time_weight('LOCF', time, value)) as value from metrics_raw
        where device_id = ${deviceId} and metric_id = ${powerId}
          and time >= '2026-01-02Z' and time < '2026-01-03Z'`);
      expect(hierarchical?.value).toBe(direct?.value);
      expect(hierarchical?.value).not.toBeNull();
    });

    test("counter deltas and resets survive the rollup into daily", async () => {
      // `num_resets` is a bigint, which arrives as a string through this
      // driver; cast rather than assert on the wire type.
      const hourly = await rows<{ delta: number; resets: number }>(sql`
        select delta(ctr) as delta, num_resets(ctr)::int as resets from hourly_rollups
        where device_id = ${deviceId} and metric_id = ${counterId} order by bucket`);
      expect(hourly).toEqual([
        { delta: 30, resets: 0 },
        { delta: 20, resets: 0 },
      ]);
      // 10->40 (30), reset, 5->25 (20), plus the 5 the counter carried at the
      // reset boundary: the reset is only visible once the hours are combined.
      const daily = await rows<{ delta: number; resets: number }>(sql`
        select delta(ctr) as delta, num_resets(ctr)::int as resets from daily_rollups
        where device_id = ${deviceId} and metric_id = ${counterId} order by bucket`);
      expect(daily).toEqual([{ delta: 55, resets: 1 }]);
    });

    test("real-time aggregation shows a row the refresh has not materialized", async () => {
      // Past the watermark the bounded refresh above left at 2026-01-03, so this
      // row can only be visible through the real-time union.
      const future = new Date("2026-06-01T12:00:00Z");
      await db.execute(sql`
        insert into metrics_raw (time, value, dur_ms, device_id, metric_id)
        values (${future}, 7, 1000, ${deviceId}, ${powerId})`);
      const seen = await one<{ n: number }>(sql`
        select count(*)::int as n from minute_rollups
        where device_id = ${deviceId} and metric_id = ${powerId} and bucket >= ${future}`);
      expect(seen?.n).toBe(1);
    });
  });

  describe("invariant: dimension rows outlive profiles and truncations", () => {
    test("uninstalling a profile leaves the devices and metric keys that name it", async () => {
      await db.execute(sql`
        insert into installed_profiles (id, source, version, data)
        values ('outlive-profile', 'https://example.invalid/p.git', '1.0.0', '{}'::jsonb)`);
      await db.execute(
        sql`insert into plants (name, slug, time_zone) values ('o', 'outlive', 'UTC')`,
      );
      await db.execute(sql`
        insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
        select id, null, 1, 'outlive-device', 'o', 'outlive-profile', 'inverter'
        from plants where slug = 'outlive'`);

      // There is deliberately no FK from devices.profile_id to
      // installed_profiles: a profile is removable, and history's meaning is not.
      await db.execute(sql`delete from installed_profiles where id = 'outlive-profile'`);
      const left = await one<{ n: number }>(
        sql`select count(*)::int as n from devices where slug = 'outlive-device'`,
      );
      expect(left?.n).toBe(1);
    });

    test("a device with readings cannot be deleted out from under them", async () => {
      const message = await failure(sql`delete from devices where slug = 'agg-device'`);
      expect(message).toMatch(/foreign key/i);
      // Named, so a future migration that quietly re-points this constraint at
      // something else fails here rather than in a support ticket.
      expect(message).toMatch(/metrics_raw_device_id_devices_id_fk/);
    });

    test("TRUNCATE metrics_raw clears readings, never dimensions or their ids", async () => {
      const before = await one<{ devices: number; keys: number; max_device: number }>(sql`
        select (select count(*)::int from devices) as devices,
               (select count(*)::int from metric_keys) as keys,
               (select max(id)::int from devices) as max_device`);
      // apps/server/src/admin/maintenance.ts does exactly this.
      await db.execute(sql`truncate table metrics_raw`);
      const after = await one<{ devices: number; keys: number; raw: number }>(sql`
        select (select count(*)::int from devices) as devices,
               (select count(*)::int from metric_keys) as keys,
               (select count(*)::int from metrics_raw) as raw`);
      expect(after?.devices).toBe(before?.devices ?? -1);
      expect(after?.keys).toBe(before?.keys ?? -1);
      expect(after?.raw).toBe(0);

      // The rest of the reset sequence, in the order maintenance.ts runs it: a
      // TRUNCATE of raw does NOT cascade into the aggregates, and the daily tier
      // is a hierarchical aggregate over the hourly one, so truncating them is
      // worth proving rather than assuming.
      for (const tier of TIERS) {
        expect(await failure(sql`truncate ${sql.raw(tier)}`)).toBe("");
      }
      const survived = await one<{ devices: number; keys: number }>(sql`
        select (select count(*)::int from devices) as devices,
               (select count(*)::int from metric_keys) as keys`);
      expect(survived?.devices).toBe(before?.devices ?? -1);
      expect(survived?.keys).toBe(before?.keys ?? -1);

      // And the identity sequence did not rewind: a reused id would rebind
      // every surviving rollup bucket to a different device.
      const next = await one<{ id: number }>(sql`
        insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
        select id, null, 2, 'post-truncate', 'pt', 'test-profile', 'inverter'
        from plants where slug = 'agg' returning id`);
      expect(next?.id).toBeGreaterThan(before?.max_device ?? 0);
    });
  });

  describe("invariant: metric keys are upserted on first sight, never renumbered", () => {
    test("first sight inserts, second sight reuses the same ids", async () => {
      const { ensureMetricKeys } = await import("@SunReye/db/metric-keys");
      const first = await ensureMetricKeys(db, [
        { key: "upsert.a", isCounter: false },
        { key: "upsert.b", isCounter: true },
      ]);
      expect([...first.keys()].sort()).toEqual(["upsert.a", "upsert.b"]);

      // A profile reinstall registers the same metric set again. int2's 32767
      // ceiling is only ample while that reuses rows.
      const second = await ensureMetricKeys(db, [
        { key: "upsert.a", isCounter: false },
        { key: "upsert.b", isCounter: true },
        { key: "upsert.c", isCounter: false },
      ]);
      expect(second.get("upsert.a")).toBe(first.get("upsert.a"));
      expect(second.get("upsert.b")).toBe(first.get("upsert.b"));
      expect(second.get("upsert.c")).toBeGreaterThan(first.get("upsert.b") ?? 0);

      const total = await one<{ n: number }>(
        sql`select count(*)::int as n from metric_keys where key like 'upsert.%'`,
      );
      expect(total?.n).toBe(3);
    });

    test("a metric's counter class can be corrected without moving its id", async () => {
      const { ensureMetricKeys } = await import("@SunReye/db/metric-keys");
      const before = await ensureMetricKeys(db, [{ key: "upsert.class", isCounter: false }]);
      const after = await ensureMetricKeys(db, [{ key: "upsert.class", isCounter: true }]);
      expect(after.get("upsert.class")).toBe(before.get("upsert.class"));
      const row = await one<{ is_counter: boolean }>(
        sql`select is_counter from metric_keys where key = 'upsert.class'`,
      );
      expect(row?.is_counter).toBe(true);
    });

    test("an empty registration is a no-op, not a malformed statement", async () => {
      const { ensureMetricKeys } = await import("@SunReye/db/metric-keys");
      expect((await ensureMetricKeys(db, [])).size).toBe(0);
    });
  });
});
