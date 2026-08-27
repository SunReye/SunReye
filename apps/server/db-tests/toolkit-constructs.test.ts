/**
 * Every TimescaleDB / timescaledb_toolkit construct the 2.0.0 baseline leans on,
 * pinned as a REAL query against a REAL database.
 *
 * Why this file exists: each result below was settled by hand on timescaledb
 * 2.28.2-pg17 with timescaledb_toolkit 1.25.0 while designing the new baseline.
 * Hand-verification does not survive an extension bump. Without these tests a
 * future image bump could silently change what a kWh figure MEANS — a rollup
 * that stops being exact, a counter delta that stops accounting for resets, a
 * rename that stops being catalog-only — and every gate in this repo would stay
 * green while the dashboard reported a wrong number.
 *
 * Nothing here asserts on SQL text. That is the rule this whole layer was built
 * for (see `harness.ts`): two production 500s shipped behind a fully green suite
 * because a text assertion cannot tell you whether Postgres accepts a statement,
 * let alone what it computes.
 *
 * These specs build their OWN small hypertables and aggregates inline, all named
 * with the `tkc_` prefix, and drop them again. They deliberately do NOT depend on
 * the shipped schema or on `packages/db/src/timescale/0000_baseline.sql` existing:
 * the point is to characterise the EXTENSION, not our use of it, so the test
 * still tells you the truth when the baseline is mid-rewrite.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { databaseReachable, resetTestDatabase } from "./harness";

const reachable = await databaseReachable();

if (!reachable) {
  const message =
    "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL. Start one with `bun run db:start`.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}

const suite = reachable ? describe : describe.skip;

suite("TimescaleDB + toolkit constructs the 2.0.0 baseline depends on", () => {
  let db: SQL;

  /** Run one statement. DDL here cannot be parameterised, and none of it takes input. */
  const run = (text: string) => db.unsafe(text);

  /** Run one statement and return its single row. */
  async function row<T = Record<string, unknown>>(text: string): Promise<T> {
    const rows = (await db.unsafe(text)) as unknown as T[];
    expect(rows.length).toBe(1);
    return rows[0] as T;
  }

  /** Run one statement and return the single value of its single row. */
  async function one<T>(text: string): Promise<T> {
    const r = await row<Record<string, T>>(text);
    const values = Object.values(r);
    expect(values.length).toBe(1);
    return values[0] as T;
  }

  /**
   * Did this statement raise the error class we expect?
   *
   * Used for the FK assertions: "the constraint is enforced" is only proven by a
   * statement that FAILS, and it has to fail for the right reason. A test that
   * merely swallowed any error would also pass if the table did not exist.
   */
  async function expectSqlError(text: string, sqlStatePrefix: string): Promise<void> {
    let caught: unknown;
    try {
      await db.unsafe(text);
    } catch (error) {
      caught = error;
    }
    expect(caught, `expected ${text} to fail with SQLSTATE ${sqlStatePrefix}*`).toBeDefined();
    const code = String((caught as { errno?: string; code?: string }).errno ?? "");
    const message = String((caught as Error).message ?? "");
    expect(
      code.startsWith(sqlStatePrefix) || message.includes(sqlStatePrefix),
      `expected SQLSTATE ${sqlStatePrefix}*, got code=${code} message=${message}`,
    ).toBe(true);
  }

  beforeAll(async () => {
    const url = await resetTestDatabase();
    db = new SQL(url);
    await run("create extension if not exists timescaledb");
    // Result 1. This is the statement the new container image exists to make
    // possible; if it throws, every other test in this file is meaningless.
    await run("create extension if not exists timescaledb_toolkit");
  });

  afterAll(async () => {
    // Reverse dependency order: aggregates before their hypertables.
    for (const name of [
      "tkc_ramp_hourly",
      "tkc_ramp_minute",
      "tkc_ramp",
      "tkc_ctr_hourly",
      "tkc_ctr",
      "tkc_comp_minute",
      "tkc_comp",
      "tkc_metrics",
      "tkc_dim",
      "tkc_rn_minute",
      "tkc_rn",
      "tkc_rn_old",
    ]) {
      await run(`drop materialized view if exists ${name} cascade`).catch(() => {});
      await run(`drop table if exists ${name} cascade`).catch(() => {});
    }
    await db.end();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Result 1 — the extension is there at all.
  // ───────────────────────────────────────────────────────────────────────────

  describe("timescaledb_toolkit availability", () => {
    test("the extension is installed and reports a version", async () => {
      const installed = await row<{ extversion: string }>(
        "select extversion from pg_extension where extname = 'timescaledb_toolkit'",
      );
      expect(installed.extversion).toMatch(/^\d+\.\d+/);
    });

    test("CREATE EXTENSION IF NOT EXISTS timescaledb_toolkit succeeds and is idempotent", async () => {
      // Already created in beforeAll; running it again must be a no-op, not an error.
      await run("create extension if not exists timescaledb_toolkit");
      expect(
        await one<number>(
          "select count(*)::int from pg_extension where extname = 'timescaledb_toolkit'",
        ),
      ).toBe(1);
    });

    /**
     * The negative half of this story, recorded here because it CANNOT be tested
     * from inside this suite — it is a statement about a DIFFERENT container image,
     * and faking it (e.g. by asserting on a version string) would prove nothing:
     *
     *   On `timescale/timescaledb:2.28.2-pg17`, `pg_available_extensions` has ZERO
     *   rows for `timescaledb_toolkit`. The extension is not merely uninstalled, it
     *   is not shippable — no amount of SQL can turn it on.
     *
     * That is why SunReye builds its own `ghcr.io/sunreye/timescaledb:pg17-ts2.28.2`
     * (timescaledb 2.28.2 + timescaledb_toolkit 1.25.0), and why the image work is a
     * hard prerequisite for the 2.0.0 baseline rather than a nice-to-have. Verified
     * by hand while writing this file: the assertions below were run against the
     * stock image first and the whole suite failed at `create extension`.
     *
     * What we CAN assert here is the positive half: on the image we ship, the
     * extension is offered by the server, not just already-created by some earlier
     * spec.
     */
    test("the server OFFERS timescaledb_toolkit (not merely already-created)", async () => {
      const available = await row<{ n: number; default_version: string }>(
        `select count(*)::int as n, min(default_version) as default_version
           from pg_available_extensions where name = 'timescaledb_toolkit'`,
      );
      expect(available.n).toBe(1);
      expect(available.default_version).toMatch(/^\d+\.\d+/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Results 2, 3, 4 and the sizing facts — the time_weight tier stack.
  // ───────────────────────────────────────────────────────────────────────────

  describe("time_weight('LOCF') in a continuous aggregate, and hierarchical rollup", () => {
    /**
     * A deliberately hand-computable series, so the assertions below are a
     * DERIVATION and not "is it a number".
     *
     * One hour of 15-second samples (240 points, 10:00:00 through 10:59:45) whose
     * values are a straight ramp centred on 531.5995:
     *
     *     value(i) = 531.5995 + (i - 119)      for i = 0 … 239
     *
     * Under LOCF weighting each sample is held for the 15 s until the next one, so
     * the time-weighted mean over the hour is the *unweighted* mean of the first 239
     * values — the 240th is the right-hand endpoint and carries zero duration:
     *
     *     mean = 531.5995 + (Σ_{i=0}^{238} (i - 119)) / 239
     *          = 531.5995 + 0 / 239                      (the offsets are antisymmetric)
     *          = 531.5995
     *
     * 531.5995 is the figure the original spike measured, so the number below is
     * both hand-derived and the historical result.
     */
    const RAMP_CENTRE = 531.5995;
    const RAMP_START = "2026-01-05 10:00:00+00";
    /** A second, unmaterialised hour used by the real-time-aggregation test. */
    const TAIL_START = "2026-01-05 12:00:00+00";

    /** First minute bucket of the ramp holds i = 0…3, so its LOCF mean is the mean of i = 0…2. */
    const FIRST_MINUTE_MEAN = RAMP_CENTRE + (-119 + -118 + -117) / 3;

    beforeAll(async () => {
      await run("drop materialized view if exists tkc_ramp_hourly cascade");
      await run("drop materialized view if exists tkc_ramp_minute cascade");
      await run("drop table if exists tkc_ramp cascade");
      await run(`create table tkc_ramp (
        time timestamptz not null,
        device_id smallint not null,
        value double precision not null
      )`);
      await run(
        "select create_hypertable('tkc_ramp', 'time', chunk_time_interval => interval '1 day')",
      );
      await run(`insert into tkc_ramp
        select timestamptz '${RAMP_START}' + (i * interval '15 seconds'), 1, ${RAMP_CENTRE} + (i - 119)
        from generate_series(0, 239) i`);

      // The minute tier: a time_weight PARTIAL per bucket, not a finished mean.
      // Storing the partial is what makes the hourly tier below possible.
      await run(`create materialized view tkc_ramp_minute
        with (timescaledb.continuous, timescaledb.materialized_only = false) as
        select time_bucket('1 minute', time) as bucket,
               device_id,
               time_weight('LOCF', time, value) as tw
          from tkc_ramp
         group by 1, 2
        with no data`);
      await run("call refresh_continuous_aggregate('tkc_ramp_minute', null, null)");

      // The hourly tier, built from the MINUTE AGGREGATE — never from raw.
      await run(`create materialized view tkc_ramp_hourly
        with (timescaledb.continuous, timescaledb.materialized_only = false) as
        select time_bucket('1 hour', bucket) as bucket,
               device_id,
               rollup(tw) as tw
          from tkc_ramp_minute
         group by 1, 2
        with no data`);
      await run("call refresh_continuous_aggregate('tkc_ramp_hourly', null, null)");
    });

    // Result 2.
    test("time_weight('LOCF') works inside a continuous aggregate and average() reads the mean back", async () => {
      expect(await one<number>("select count(*)::int from tkc_ramp_minute")).toBe(60);

      const first = await one<number>(
        `select average(tw) from tkc_ramp_minute
          where bucket = timestamptz '${RAMP_START}' and device_id = 1`,
      );
      expect(first).toBeCloseTo(FIRST_MINUTE_MEAN, 9);

      // Every minute bucket of a straight ramp must step by exactly 4 (four 15-second
      // samples per bucket), which proves the partials are per-bucket and correctly
      // ordered rather than all summarising the same range.
      const steps = (await db.unsafe(
        `select average(tw) as mean from tkc_ramp_minute where device_id = 1 order by bucket`,
      )) as unknown as Array<{ mean: number }>;
      expect(steps.length).toBe(60);
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i]!.mean - steps[i - 1]!.mean).toBeCloseTo(4, 9);
      }
    });

    test("the hand-computed time-weighted mean over the hour is 531.5995 from raw", async () => {
      const fromRaw = await one<number>(
        `select average(time_weight('LOCF', time, value))
           from tkc_ramp where device_id = 1
            and time >= timestamptz '${RAMP_START}'
            and time <  timestamptz '${RAMP_START}' + interval '1 hour'`,
      );
      expect(fromRaw).toBeCloseTo(RAMP_CENTRE, 9);
    });

    /**
     * Result 4 — THE identity the whole tier design rests on.
     *
     * If hourly-from-minute is exact, daily can be built from hourly from minute and
     * raw is scanned ONCE instead of three times. If it is not exact, the tiers have
     * to be independent scans of raw and the storage/CPU budget changes shape.
     *
     * Asserted as EXACT equality (`=` in the database, on float8) rather than within
     * an epsilon, because that is what was measured: on timescaledb 2.28.2 with
     * toolkit 1.25.0 the two paths agree BIT FOR BIT — the difference is literally
     * 0, not 1e-13. An exact assertion therefore costs nothing today and is the
     * strictest available signal. If a future version turns this red with a tiny
     * epsilon difference, that is a real change in the aggregate's accumulation
     * order and deserves a human look; loosen it to a tolerance only after
     * confirming the MAGNITUDE below is still right.
     */
    test("hierarchical rollup() is EXACT: hourly-from-minute equals time_weight-from-raw bit for bit", async () => {
      const result = await row<{
        from_minute: number;
        from_raw: number;
        exactly_equal: boolean;
        difference: number;
      }>(
        `with from_minute as (
             select average(tw) as mean from tkc_ramp_hourly
              where bucket = timestamptz '${RAMP_START}' and device_id = 1
           ),
           from_raw as (
             select average(time_weight('LOCF', time, value)) as mean
               from tkc_ramp where device_id = 1
                and time >= timestamptz '${RAMP_START}'
                and time <  timestamptz '${RAMP_START}' + interval '1 hour'
           )
         select from_minute.mean as from_minute,
                from_raw.mean    as from_raw,
                from_minute.mean = from_raw.mean as exactly_equal,
                from_minute.mean - from_raw.mean as difference
           from from_minute, from_raw`,
      );

      expect(result.exactly_equal).toBe(true);
      expect(result.difference).toBe(0);
      // …and both are the right number, not merely the same wrong number.
      expect(result.from_minute).toBeCloseTo(RAMP_CENTRE, 9);
      expect(result.from_raw).toBeCloseTo(RAMP_CENTRE, 9);
    });

    /**
     * Result 3 — `materialized_only = false`.
     *
     * The read path must see data that has arrived since the last refresh, or the
     * dashboard's newest hour is simply missing. Proven by toggling the setting
     * around an unrefreshed tail rather than by trusting the flag.
     */
    describe("materialized_only = false includes the not-yet-materialized tail", () => {
      beforeAll(async () => {
        // A second hour of raw, deliberately NOT refreshed into the aggregate.
        await run(`insert into tkc_ramp
          select timestamptz '${TAIL_START}' + (i * interval '15 seconds'), 1, 100 + i
          from generate_series(0, 239) i`);
      });

      test("real-time aggregation on sees the tail, off does not, and the count is otherwise identical", async () => {
        const withRealtime = await one<number>("select count(*)::int from tkc_ramp_minute");

        await run(
          "alter materialized view tkc_ramp_minute set (timescaledb.materialized_only = true)",
        );
        const materializedOnly = await one<number>("select count(*)::int from tkc_ramp_minute");

        await run(
          "alter materialized view tkc_ramp_minute set (timescaledb.materialized_only = false)",
        );
        const backOn = await one<number>("select count(*)::int from tkc_ramp_minute");

        // 60 materialized minute buckets, plus 60 in the unrefreshed tail.
        expect(materializedOnly).toBe(60);
        expect(withRealtime).toBe(120);
        expect(backOn).toBe(withRealtime);
      });

      test("the tail's values are correct, not merely present", async () => {
        // Tail bucket 0 holds values 100…103 sampled 15 s apart, so its LOCF mean is
        // the mean of 100, 101, 102 = 101.
        const tailMean = await one<number>(
          `select average(tw) from tkc_ramp_minute
            where bucket = timestamptz '${TAIL_START}' and device_id = 1`,
        );
        expect(tailMean).toBeCloseTo(101, 9);
      });

      test("the tail disappears from the aggregate when real-time aggregation is off", async () => {
        await run(
          "alter materialized view tkc_ramp_minute set (timescaledb.materialized_only = true)",
        );
        try {
          expect(
            await one<number>(
              `select count(*)::int from tkc_ramp_minute
                where bucket = timestamptz '${TAIL_START}'`,
            ),
          ).toBe(0);
        } finally {
          await run(
            "alter materialized view tkc_ramp_minute set (timescaledb.materialized_only = false)",
          );
        }
      });

      test("refreshing materializes the tail, and the hourly tier rolls it up", async () => {
        await run("call refresh_continuous_aggregate('tkc_ramp_minute', null, null)");
        await run("call refresh_continuous_aggregate('tkc_ramp_hourly', null, null)");
        expect(
          await one<number>(
            `select count(*)::int from tkc_ramp_hourly where bucket = timestamptz '${TAIL_START}'`,
          ),
        ).toBe(1);
        // Tail hour: values 100 … 339, LOCF mean = mean of 100 … 338 = 219.
        expect(
          await one<number>(
            `select average(tw) from tkc_ramp_hourly
              where bucket = timestamptz '${TAIL_START}' and device_id = 1`,
          ),
        ).toBeCloseTo(219, 9);
      });
    });

    /**
     * The sizing facts, asserted because they are what EXCLUDED counter_agg from the
     * minute tier.
     *
     * A counter_agg partial at 184 B × 1440 minute buckets × ~108 metrics is ~28 MB
     * per device-day uncompressed — unaffordable on an addon that may be running on
     * eMMC. A time_weight partial at 46 B replaces the two sums plus min/max it
     * displaces at roughly parity, so the minute tier costs essentially nothing
     * extra. If a future toolkit release changes the partial format, the minute tier
     * silently changes size; this test is the tripwire.
     *
     * Measured on the partials AS STORED in an aggregate, which is the number that
     * actually bills. (Measuring `pg_column_size(time_weight(...))` over a whole
     * unsorted hour instead reports 49 B — a different question with a different
     * answer, so do not "fix" this test by changing where it measures.)
     */
    describe("partial sizes justify excluding counter_agg from the minute tier", () => {
      test("a stored time_weight partial is ~46 B", async () => {
        const size = await row<{ min_bytes: number; max_bytes: number }>(
          `select min(pg_column_size(tw))::int as min_bytes,
                  max(pg_column_size(tw))::int as max_bytes
             from tkc_ramp_minute`,
        );
        expect(size.min_bytes).toBe(46);
        expect(size.max_bytes).toBe(46);
      });

      test("a plain float8 is 8 B — the baseline the partials are compared against", async () => {
        expect(await one<number>("select pg_column_size(1.0::float8)::int")).toBe(8);
      });

      test("a time_weight partial stays far below the counter_agg partial", async () => {
        const tw = await one<number>("select max(pg_column_size(tw))::int from tkc_ramp_minute");
        // No nesting: `max(pg_column_size(counter_agg(...)))` is an aggregate inside an
        // aggregate, which Postgres rejects outright (42803).
        const ca = await one<number>(
          `select pg_column_size(counter_agg(time, value))::int from tkc_ramp`,
        );
        expect(ca).toBe(184);
        // The ratio is the decision: a 4× swing here would rewrite the tier budget.
        expect(ca / tw).toBeGreaterThan(3);
        expect(ca / tw).toBeLessThan(5);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Result 5 — counter_agg, and the six-orders-of-magnitude bug it prevents.
  // ───────────────────────────────────────────────────────────────────────────

  describe("counter_agg with delta() in a continuous aggregate handles a counter reset", () => {
    /**
     * A real inverter failure mode, reproduced exactly.
     *
     * `value` is a lifetime Wh register sitting at ~17.88 MWh. Over half an hour it
     * climbs 100 Wh (21 samples, +5 each). Then the inverter restarts, the register
     * resets to 0, and it climbs another 2.70 Wh (4 samples, +0.9 each).
     *
     * Truth:                     100 + 2.70          = 102.70 Wh
     * Naive `max(value) - min(value)`: 17878458 - 0   = 17,878,458 Wh
     *
     * Both numbers are asserted, so this test documents the BUG as well as the fix:
     * the hand-rolled max-minus-min the old schema used reports a figure wrong by
     * six orders of magnitude — 17.9 MWh of energy that never existed — every time
     * an inverter reboots inside a bucket. `delta(counter_agg(...))` detects the
     * decrease as a reset and adds the pre-reset rise instead.
     */
    const CTR_HOUR = "2026-01-05 10:00:00+00";
    const TRUE_DELTA = 102.7;
    const NAIVE_DELTA = 17_878_458;

    beforeAll(async () => {
      await run("drop materialized view if exists tkc_ctr_hourly cascade");
      await run("drop table if exists tkc_ctr cascade");
      await run(`create table tkc_ctr (
        time timestamptz not null,
        device_id smallint not null,
        value double precision not null
      )`);
      await run(
        "select create_hypertable('tkc_ctr', 'time', chunk_time_interval => interval '1 day')",
      );
      // Before the restart: 17878358 → 17878458.
      await run(`insert into tkc_ctr
        select timestamptz '${CTR_HOUR}' + (i * interval '1 minute'), 1, 17878358 + i * 5
        from generate_series(0, 20) i`);
      // After the restart: 0 → 2.70.
      await run(`insert into tkc_ctr
        select timestamptz '${CTR_HOUR}' + interval '30 minutes' + (i * interval '1 minute'), 1, i * 0.9
        from generate_series(0, 3) i`);

      await run(`create materialized view tkc_ctr_hourly
        with (timescaledb.continuous, timescaledb.materialized_only = false) as
        select time_bucket('1 hour', time) as bucket,
               device_id,
               counter_agg(time, value) as ca,
               max(value) - min(value) as naive_delta
          from tkc_ctr
         group by 1, 2
        with no data`);
      await run("call refresh_continuous_aggregate('tkc_ctr_hourly', null, null)");
    });

    test("delta(counter_agg) reports the true 102.70, and naive max-minus-min reports 17,878,458", async () => {
      const result = await row<{ toolkit_delta: number; naive_delta: number }>(
        `select delta(ca) as toolkit_delta, naive_delta
           from tkc_ctr_hourly
          where bucket = timestamptz '${CTR_HOUR}' and device_id = 1`,
      );
      expect(result.toolkit_delta).toBeCloseTo(TRUE_DELTA, 6);
      expect(result.naive_delta).toBe(NAIVE_DELTA);
      // Spell the failure out, so a future reader cannot mistake this for a rounding
      // quibble: the naive answer is off by more than five orders of magnitude.
      expect(Math.log10(result.naive_delta / result.toolkit_delta)).toBeGreaterThan(5);
    });

    test("counter_agg agrees with max-minus-min when there is NO reset", async () => {
      // The boundary that matters in the other direction: counter_agg must not
      // invent resets. Restricted to the pre-restart samples, the two agree.
      const result = await row<{ toolkit_delta: number; naive_delta: number }>(
        `select delta(counter_agg(time, value)) as toolkit_delta,
                max(value) - min(value) as naive_delta
           from tkc_ctr
          where device_id = 1
            and time < timestamptz '${CTR_HOUR}' + interval '30 minutes'`,
      );
      expect(result.toolkit_delta).toBeCloseTo(100, 6);
      expect(result.naive_delta).toBeCloseTo(100, 6);
    });

    test("a single sample yields a zero delta rather than an error", async () => {
      // Boundary: a bucket with one reading has no measurable rise. This must be 0,
      // not null and not a throw, or the first bucket after a restart breaks a sum.
      const delta = await one<number>(
        `select delta(counter_agg(time, value)) from tkc_ctr
          where device_id = 1 and time = timestamptz '${CTR_HOUR}'`,
      );
      expect(delta).toBe(0);
    });

    test("an empty window yields no counter summary at all", async () => {
      // Boundary: absent data must not read as zero energy silently attributed to a
      // bucket. `counter_agg` over no rows is null.
      const delta = await one<number | null>(
        `select delta(counter_agg(time, value)) from tkc_ctr
          where device_id = 1 and time > timestamptz '${CTR_HOUR}' + interval '1 day'`,
      );
      expect(delta).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Result 6 — compressing an aggregate that holds partials.
  // ───────────────────────────────────────────────────────────────────────────

  describe("compression with compress_segmentby on an aggregate holding partials", () => {
    const COMP_START = "2026-01-05 10:00:00+00";

    beforeAll(async () => {
      await run("drop materialized view if exists tkc_comp_minute cascade");
      await run("drop table if exists tkc_comp cascade");
      await run(`create table tkc_comp (
        time timestamptz not null,
        device_id smallint not null,
        value double precision not null
      )`);
      await run(
        "select create_hypertable('tkc_comp', 'time', chunk_time_interval => interval '1 day')",
      );
      // Two devices, so compress_segmentby has something to segment BY.
      await run(`insert into tkc_comp
        select timestamptz '${COMP_START}' + (i * interval '15 seconds'), d, 531.5995 + (i - 119) + d
        from generate_series(0, 239) i, generate_series(1, 2) d`);
      await run(`create materialized view tkc_comp_minute
        with (timescaledb.continuous, timescaledb.materialized_only = false) as
        select time_bucket('1 minute', time) as bucket,
               device_id,
               time_weight('LOCF', time, value) as tw
          from tkc_comp
         group by 1, 2
        with no data`);
      await run("call refresh_continuous_aggregate('tkc_comp_minute', null, null)");
    });

    test("chunks actually compress, rows stay readable, and the mean is UNCHANGED", async () => {
      const meanQuery = `select average(tw) from tkc_comp_minute
                          where bucket = timestamptz '${COMP_START}' and device_id = 1`;
      const countQuery = "select count(*)::int from tkc_comp_minute";

      const meanBefore = await one<number>(meanQuery);
      const countBefore = await one<number>(countQuery);
      expect(countBefore).toBe(120); // 60 minute buckets × 2 devices

      await run(`alter materialized view tkc_comp_minute set (
        timescaledb.compress = true,
        timescaledb.compress_segmentby = 'device_id'
      )`);

      const materialization = await one<string>(
        `select materialization_hypertable_name
           from timescaledb_information.continuous_aggregates where view_name = 'tkc_comp_minute'`,
      );
      const compressed = await one<number>(
        `select count(*)::int from (select compress_chunk(c) from show_chunks('tkc_comp_minute') c) x`,
      );
      expect(compressed).toBeGreaterThan(0);

      // Not "we called compress_chunk" — the catalog must agree it is compressed.
      const chunkState = await row<{ compressed_chunks: number; total_chunks: number }>(
        `select count(*) filter (where is_compressed)::int as compressed_chunks,
                count(*)::int as total_chunks
           from timescaledb_information.chunks
          where hypertable_name = '${materialization}'`,
      );
      expect(chunkState.total_chunks).toBeGreaterThan(0);
      expect(chunkState.compressed_chunks).toBe(chunkState.total_chunks);

      expect(await one<number>(countQuery)).toBe(countBefore);
      expect(await one<number>(meanQuery)).toBe(meanBefore);

      // And the partials are still partials: rollup() over compressed buckets works.
      const rolled = await one<number>(
        `select average(rollup(tw)) from tkc_comp_minute where device_id = 1`,
      );
      expect(rolled).toBeCloseTo(531.5995 + 1, 9);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Results 7 and 8 — the hypertable → dimension foreign key, and TRUNCATE.
  // ───────────────────────────────────────────────────────────────────────────

  describe("hypertable -> dimension FOREIGN KEY with ON DELETE RESTRICT", () => {
    /**
     * Load-bearing: the new schema keeps this FK in the DESIGN rather than as a
     * comment-only convention, on the strength of this result. If a future extension
     * version stops enforcing it from inside a chunk, or stops accepting inserts once
     * a chunk is compressed, the schema has to fall back to application-level
     * checking — so this failing is a design decision, not a test to relax.
     */
    const FK_START = "2026-01-05 10:00:00+00";

    beforeAll(async () => {
      await run("drop table if exists tkc_metrics cascade");
      await run("drop table if exists tkc_dim cascade");
      await run(`create table tkc_dim (
        id smallint generated always as identity primary key,
        name text not null unique
      )`);
      await run("insert into tkc_dim (name) values ('pv_power'), ('battery_soc'), ('grid_power')");
      await run(`create table tkc_metrics (
        time timestamptz not null,
        metric_id smallint not null references tkc_dim(id) on delete restrict,
        value double precision not null
      )`);
      await run(
        "select create_hypertable('tkc_metrics', 'time', chunk_time_interval => interval '1 day')",
      );
      await run(`insert into tkc_metrics
        select timestamptz '${FK_START}' + (i * interval '1 minute'), 1, i
        from generate_series(0, 9) i`);
    });

    test("the FK is enforced on an insert INTO A CHUNK", async () => {
      // 23503 = foreign_key_violation.
      await expectSqlError(
        `insert into tkc_metrics values (timestamptz '${FK_START}' + interval '20 minutes', 99, 1)`,
        "23503",
      );
    });

    test("ON DELETE RESTRICT refuses to delete a referenced dimension row", async () => {
      await expectSqlError("delete from tkc_dim where id = 1", "23503");
      expect(await one<number>("select count(*)::int from tkc_dim where id = 1")).toBe(1);
    });

    test("an UNREFERENCED dimension row still deletes — RESTRICT is not a blanket lock", async () => {
      await run("delete from tkc_dim where name = 'grid_power'");
      expect(await one<number>("select count(*)::int from tkc_dim where name = 'grid_power'")).toBe(
        0,
      );
    });

    describe("once the chunk is compressed", () => {
      beforeAll(async () => {
        await run(`alter table tkc_metrics set (
          timescaledb.compress,
          timescaledb.compress_segmentby = 'metric_id'
        )`);
        const compressed = await one<number>(
          `select count(*)::int from (select compress_chunk(c) from show_chunks('tkc_metrics') c) x`,
        );
        expect(compressed).toBeGreaterThan(0);
      });

      test("the chunk really is compressed and its rows are still readable", async () => {
        expect(
          await one<number>(
            `select count(*) filter (where is_compressed)::int
               from timescaledb_information.chunks where hypertable_name = 'tkc_metrics'`,
          ),
        ).toBeGreaterThan(0);
        expect(await one<number>("select count(*)::int from tkc_metrics")).toBe(10);
      });

      test("RESTRICT still refuses the delete", async () => {
        await expectSqlError("delete from tkc_dim where id = 1", "23503");
      });

      test("inserts keep working", async () => {
        await run(
          `insert into tkc_metrics values (timestamptz '${FK_START}' + interval '30 minutes', 2, 42)`,
        );
        expect(await one<number>("select count(*)::int from tkc_metrics")).toBe(11);
      });

      test("and the FK is still enforced on those inserts", async () => {
        await expectSqlError(
          `insert into tkc_metrics values (timestamptz '${FK_START}' + interval '31 minutes', 99, 1)`,
          "23503",
        );
      });
    });

    /**
     * Result 8 — why TRUNCATE is safe.
     *
     * `apps/server/src/admin/maintenance.ts` (~line 47) runs `TRUNCATE TABLE
     * metrics_raw` as a USER-FACING reset. Once metric and device names live in
     * dimension tables keyed by an identity column, that reset is only safe if it
     * leaves those tables AND their identity counters alone. If TRUNCATE renumbered
     * dimension ids, ids in any surviving history — backups, exports, a replica —
     * would rebind to different names and every figure would silently change
     * meaning. That is a data-corruption bug with no error message.
     */
    describe("TRUNCATE on the hypertable", () => {
      let sequenceName: string;
      let lastValueBefore: number;
      let dimRowsBefore: number;

      const readSequence = () =>
        one<number>(
          `select last_value::int from pg_sequences
            where schemaname || '.' || sequencename = '${sequenceName}'`,
        );

      beforeAll(async () => {
        sequenceName = await one<string>("select pg_get_serial_sequence('tkc_dim', 'id')");
        lastValueBefore = await readSequence();
        dimRowsBefore = await one<number>("select count(*)::int from tkc_dim");
        expect(await one<number>("select count(*)::int from tkc_metrics")).toBeGreaterThan(0);
        await run("truncate table tkc_metrics");
      });

      test("empties the hypertable", async () => {
        expect(await one<number>("select count(*)::int from tkc_metrics")).toBe(0);
      });

      test("leaves the dimension table's rows untouched", async () => {
        expect(await one<number>("select count(*)::int from tkc_dim")).toBe(dimRowsBefore);
        expect(
          await one<number>("select count(*)::int from tkc_dim where name = 'pv_power' and id = 1"),
        ).toBe(1);
      });

      test("leaves the dimension table's identity COUNTER untouched", async () => {
        expect(await readSequence()).toBe(lastValueBefore);
      });

      test("so the next dimension row gets a FRESH id, never a reused one", async () => {
        const nextId = await one<number>(
          "insert into tkc_dim (name) values ('tkc_after_truncate') returning id",
        );
        expect(nextId).toBeGreaterThan(lastValueBefore);
        // The decisive assertion: id 1 still means what it meant before the reset.
        expect(
          await one<number>("select count(*)::int from tkc_dim where id = 1 and name = 'pv_power'"),
        ).toBe(1);
      });

      test("and the FK still works against those preserved ids after the reset", async () => {
        await run(`insert into tkc_metrics values (timestamptz '${FK_START}', 1, 7)`);
        expect(await one<number>("select count(*)::int from tkc_metrics")).toBe(1);
        await expectSqlError(
          `insert into tkc_metrics values (timestamptz '${FK_START}', 99, 7)`,
          "23503",
        );
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Result 9 — THE MOST IMPORTANT TEST IN THIS FILE.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * ALTER TABLE … RENAME TO on a hypertable that has a dependent continuous
   * aggregate AND compressed chunks.
   *
   * READ THIS BEFORE TOUCHING OR SKIPPING THIS TEST.
   *
   * The ENTIRE in-place production upgrade to the 2.0.0 schema is built on this
   * rename being catalog-only and microsecond-cheap: the old hypertable is renamed
   * aside, the new differently-shaped one takes the freed name, and the dependent
   * aggregates follow their parent automatically without losing a materialized
   * bucket.
   *
   * If a future extension version breaks it, the fallback is a STAGING COPY —
   * roughly 9.3 million row inserts and about 1 GB of transient disk on a box that
   * may be running on eMMC. That is the difference between an upgrade that takes a
   * moment and one that can fill the disk of a live installation mid-migration.
   *
   * So this failing must be UNMISSABLE. It is not a smoke test and it is not
   * optional: a red here invalidates the migration strategy, not the test.
   */
  describe("ALTER TABLE ... RENAME TO on a hypertable with a dependent CAgg and compressed chunks", () => {
    const RN_START = "2026-01-05 10:00:00+00";
    const RN_CENTRE = 531.5995;
    let bucketsBefore: number;
    let meanBefore: number;

    beforeAll(async () => {
      await run("drop materialized view if exists tkc_rn_minute cascade");
      await run("drop table if exists tkc_rn cascade");
      await run("drop table if exists tkc_rn_old cascade");
      await run(`create table tkc_rn (
        time timestamptz not null,
        device_id smallint not null,
        value double precision not null
      )`);
      await run(
        "select create_hypertable('tkc_rn', 'time', chunk_time_interval => interval '1 day')",
      );
      await run(`insert into tkc_rn
        select timestamptz '${RN_START}' + (i * interval '15 seconds'), 1, ${RN_CENTRE} + (i - 119)
        from generate_series(0, 239) i`);
      await run(`create materialized view tkc_rn_minute
        with (timescaledb.continuous, timescaledb.materialized_only = false) as
        select time_bucket('1 minute', time) as bucket,
               device_id,
               time_weight('LOCF', time, value) as tw
          from tkc_rn
         group by 1, 2
        with no data`);
      await run("call refresh_continuous_aggregate('tkc_rn_minute', null, null)");

      // Compressed chunks must be PRESENT when the rename happens — that is the
      // half of the claim that is not obvious.
      await run(`alter table tkc_rn set (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'device_id'
      )`);
      const compressed = await one<number>(
        `select count(*)::int from (select compress_chunk(c) from show_chunks('tkc_rn') c) x`,
      );
      expect(compressed).toBeGreaterThan(0);
      expect(
        await one<number>(
          `select count(*) filter (where is_compressed)::int
             from timescaledb_information.chunks where hypertable_name = 'tkc_rn'`,
        ),
      ).toBeGreaterThan(0);

      bucketsBefore = await one<number>("select count(*)::int from tkc_rn_minute");
      meanBefore = await one<number>(
        `select average(tw) from tkc_rn_minute
          where bucket = timestamptz '${RN_START}' and device_id = 1`,
      );
      expect(bucketsBefore).toBe(60);

      // The rename under test.
      await run("alter table tkc_rn rename to tkc_rn_old");
    });

    test("the rename succeeds and the aggregate FOLLOWS its parent automatically", async () => {
      const parent = await one<string>(
        `select hypertable_name from timescaledb_information.continuous_aggregates
          where view_name = 'tkc_rn_minute'`,
      );
      expect(parent).toBe("tkc_rn_old");
    });

    test("every materialized bucket survives and stays readable", async () => {
      expect(await one<number>("select count(*)::int from tkc_rn_minute")).toBe(bucketsBefore);
      expect(
        await one<number>(
          `select average(tw) from tkc_rn_minute
            where bucket = timestamptz '${RN_START}' and device_id = 1`,
        ),
      ).toBe(meanBefore);
      // And rollup() over the surviving partials still reproduces the hour exactly.
      expect(
        await one<number>("select average(rollup(tw)) from tkc_rn_minute where device_id = 1"),
      ).toBeCloseTo(RN_CENTRE, 9);
    });

    test("the renamed hypertable's compressed chunks are intact and readable", async () => {
      expect(await one<number>("select count(*)::int from tkc_rn_old")).toBe(240);
      expect(
        await one<number>(
          `select count(*) filter (where is_compressed)::int
             from timescaledb_information.chunks where hypertable_name = 'tkc_rn_old'`,
        ),
      ).toBeGreaterThan(0);
      // The old name is gone from the catalog, not aliased.
      expect(
        await one<number>(
          "select count(*)::int from timescaledb_information.hypertables where hypertable_name = 'tkc_rn'",
        ),
      ).toBe(0);
    });

    test("the aggregate still refreshes against its renamed parent", async () => {
      // Decompress is needed to insert into an already-compressed chunk region on
      // this version; the point of the assertion is that the CAgg pipeline still
      // functions end to end after the rename.
      await run("select decompress_chunk(c) from show_chunks('tkc_rn_old') c");
      await run(`insert into tkc_rn_old
        select timestamptz '${RN_START}' + interval '1 hour' + (i * interval '15 seconds'), 1, 7 + i
        from generate_series(0, 239) i`);
      await run("call refresh_continuous_aggregate('tkc_rn_minute', null, null)");
      expect(await one<number>("select count(*)::int from tkc_rn_minute")).toBe(120);
      // New hour: values 7 … 246, LOCF mean = mean of 7 … 245 = 126.
      expect(
        await one<number>(
          `select average(rollup(tw)) from tkc_rn_minute
            where device_id = 1 and bucket >= timestamptz '${RN_START}' + interval '1 hour'`,
        ),
      ).toBeCloseTo(126, 9);
    });

    test("the freed name is immediately reusable for a DIFFERENTLY-SHAPED hypertable", async () => {
      // Different column set, different types, an extra column — i.e. the actual
      // 2.0.0 shape taking over the 1.x name, which is the whole migration move.
      await run(`create table tkc_rn (
        time timestamptz not null,
        device_id smallint not null,
        metric_id smallint not null,
        value real not null,
        note text
      )`);
      await run(
        "select create_hypertable('tkc_rn', 'time', chunk_time_interval => interval '1 day')",
      );
      await run(`insert into tkc_rn values
        (timestamptz '2026-01-06 00:00:00+00', 1, 1, 1.5, 'new shape')`);
      expect(await one<number>("select count(*)::int from tkc_rn")).toBe(1);
      expect(await one<string>("select note from tkc_rn")).toBe("new shape");

      // Critically: the old aggregate is still attached to the OLD hypertable and
      // has not been silently rebound to the new same-named one.
      expect(
        await one<string>(
          `select hypertable_name from timescaledb_information.continuous_aggregates
            where view_name = 'tkc_rn_minute'`,
        ),
      ).toBe("tkc_rn_old");
      expect(await one<number>("select count(*)::int from tkc_rn_minute")).toBe(120);
    });
  });
});
