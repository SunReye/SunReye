/**
 * The rollup READ PATH against a real TimescaleDB — `queryRollup`, end to end.
 *
 * `apps/server/db-tests/baseline.test.ts` proves the aggregates compute the right
 * numbers; `apps/server/src/shared/rollup-sql.test.ts` proves the statement this
 * module composes. Neither proves that the statement, executed, yields those
 * numbers — and that gap is exactly where the bug this release exists to fix
 * would come back:
 *
 *  - `average(tw)` over a bucket holding a single sample is NULL, and a
 *    change-only writer leaves most buckets holding one sample. A read that used
 *    it would blank most of the chart, and a SQL-text assertion cannot tell the
 *    difference between `average` and `interpolated_average` mattering.
 *  - `interpolated_average` needs the NEIGHBOURING partials, which only exist in
 *    the result set if the query read one bucket beyond the window before the
 *    window function ran. Trim first and the first bucket of every chart is
 *    silently wrong — by 45 % on the reference series below.
 *  - `dur_ms` weighting, which this replaced, attributed a value held from 23:50
 *    to 00:10 ENTIRELY to the 23:00 bucket, because that is where the row is
 *    stamped. That is the headline arithmetic error of 1.x.
 *
 * So the assertion here is a NUMBER, 183.333…, read through the same function the
 * dashboard calls.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { sql } from "drizzle-orm";
import { databaseReachable, resetTestDatabase } from "./harness";

const reachable = await databaseReachable();

// The real module namespace is live, so the real exports have to be snapshotted
// BY VALUE before anything is installed over them — see AGENTS.md on
// `mock.module` being process-global and permanent.
const realDb = await import("@SunReye/db");
const realDbExports = { ...realDb };

if (!reachable) {
  const message =
    "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL. Start one with `bun run db:start`.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}

const suite = reachable ? describe : describe.skip;

/** The three tiers, parent before child — daily reads hourly. */
const TIERS = ["minute_rollups", "hourly_rollups", "daily_rollups"] as const;

suite("queryRollup against a real TimescaleDB", () => {
  let queryRollup: typeof import("../src/shared/history").queryRollup;
  let queryMedianHourlyAvg: typeof import("../src/shared/history").queryMedianHourlyAvg;
  let raw: ReturnType<typeof realDbExports.createDbAt>;

  /** This suite's own device slug — the harness shares one database. */
  const inverterId = "inv-rollup-read";
  const METRIC = "rollup.read.power";

  beforeAll(async () => {
    const url = await resetTestDatabase();
    raw = realDbExports.createDbAt(url);
    mock.module("@SunReye/db", () => ({ ...realDbExports, db: raw }));
    ({ queryRollup, queryMedianHourlyAvg } = await import("../src/shared/history"));

    await raw.execute(sql`
      insert into plants (name, slug, time_zone) values ('rollup', 'rollup-read', 'UTC')`);
    const device = await raw.execute<{ id: number }>(sql`
      insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
      select id, null, 1, ${inverterId}, 'rollup probe', 'test-profile', 'inverter'
      from plants where slug = 'rollup-read'
      returning id`);
    const deviceId = Number((device.rows[0] as { id: number }).id);
    const metric = await raw.execute<{ id: number }>(sql`
      insert into metric_keys (key, is_counter) values (${METRIC}, false)
      on conflict (key) do update set is_counter = excluded.is_counter
      returning id`);
    const metricId = Number((metric.rows[0] as { id: number }).id);

    // THE reference series: 100 held from 23:50, 200 from 00:10. Three rows, and
    // every bucket they produce holds exactly ONE of them — which is why a plain
    // average reads NULL for all three.
    await raw.execute(sql`
      insert into metrics_raw (time, value, dur_ms, device_id, metric_id) values
        ('2026-03-01 23:50:00Z', 100, 1200000, ${deviceId}, ${metricId}),
        ('2026-03-02 00:10:00Z', 200, 3000000, ${deviceId}, ${metricId}),
        ('2026-03-02 01:00:00Z', 200,    1000, ${deviceId}, ${metricId})`);

    // BOUNDED refreshes, parent before child. `(NULL, NULL)` would advance every
    // watermark past everything and materialize whatever another spec file left
    // in the shared database.
    for (const tier of TIERS) {
      await raw.execute(sql`call refresh_continuous_aggregate(
        ${sql.raw(`'${tier}'`)}, '2026-03-01Z'::timestamptz, '2026-03-03Z'::timestamptz)`);
    }
  });

  afterAll(() => {
    mock.module("@SunReye/db", () => ({ ...realDbExports }));
  });

  const hourly = (from: string, to: string) =>
    queryRollup({
      metric: METRIC,
      inverterId,
      bucket: "hour",
      limit: 100,
      from: new Date(from),
      to: new Date(to),
    });

  test("a value held across midnight is split between the two hours, in proportion", async () => {
    // 23:00 → 100 (held 23:50 to 00:00).
    // 00:00 → (100 × 10 min + 200 × 50 min) / 60 = 183.333…
    // `dur_ms` weighting billed the 23:00 bucket the whole 20-minute hold and the
    // 00:00 bucket none of it. THIS is the number that proves it no longer does.
    const rows = await hourly("2026-03-01T23:00:00Z", "2026-03-02T02:00:00Z");
    expect(rows.map((r) => r.time)).toEqual([
      "2026-03-01T23:00:00.000Z",
      "2026-03-02T00:00:00.000Z",
      "2026-03-02T01:00:00.000Z",
    ]);
    expect(rows[0]?.avg).toBe(100);
    expect(rows[1]?.avg).toBeCloseTo(183.33333333333334, 10);
  });

  test("a single-sample bucket still has an average — the whole reason reads interpolate", async () => {
    // Each of these buckets holds ONE row. `average(tw)` is NULL for all three (a
    // point has no duration), so a read that used it would return an empty series
    // here and the dashboard would be blank on a change-only series.
    const rows = await hourly("2026-03-01T23:00:00Z", "2026-03-02T02:00:00Z");
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.avg).not.toBeNull();
  });

  test("the FIRST bucket of a window is interpolated from outside it, not truncated", async () => {
    // A window starting AT the 00:00 bucket: its predecessor is outside the
    // window, and the value 183.333… depends on it. Trimming before the window
    // function runs would give 200 here — a 9 % error on the leftmost point of
    // every chart, with no gap or NULL to reveal it.
    const rows = await hourly("2026-03-02T00:00:00Z", "2026-03-02T01:00:00Z");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.avg).toBeCloseTo(183.33333333333334, 10);
  });

  test("max and min are the bucket's own extrema, untouched by the interpolation", async () => {
    const rows = await hourly("2026-03-02T00:00:00Z", "2026-03-02T01:00:00Z");
    expect(rows[0]?.max).toBe(200);
    expect(rows[0]?.min).toBe(200);
  });

  test("the minute tier answers the same window at its own width", async () => {
    // The minute aggregate carries no counter partial but the same `tw`, so the
    // interpolated read has to work identically at 1-minute resolution.
    const rows = await queryRollup({
      metric: METRIC,
      inverterId,
      bucket: "minute",
      limit: 200,
      from: new Date("2026-03-02T00:00:00Z"),
      to: new Date("2026-03-02T00:30:00Z"),
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.avg).toBeGreaterThanOrEqual(100);
  });

  test("the daily tier, rolled up from hourly, reads through the same path", async () => {
    const rows = await queryRollup({
      metric: METRIC,
      inverterId,
      bucket: "day",
      limit: 10,
      from: new Date("2026-03-01T00:00:00Z"),
      to: new Date("2026-03-04T00:00:00Z"),
    });
    expect(rows.map((r) => r.time)).toContain("2026-03-02T00:00:00.000Z");
  });

  test("a source id that names no device is an empty series, never an error", async () => {
    // `deviceIdOf` resolves to NULL and `device_id = NULL` is false. A stale
    // bookmark reads as no data, which is what it is.
    const rows = await queryRollup({
      metric: METRIC,
      inverterId: "inv-nonexistent",
      bucket: "hour",
      limit: 100,
      from: new Date("2026-03-01T00:00:00Z"),
      to: new Date("2026-03-04T00:00:00Z"),
    });
    expect(rows).toEqual([]);
  });

  test("a metric key that was never registered is an empty series, never an error", async () => {
    // Same shape on the other dimension: a profile downloaded at runtime can name
    // a key no poll has written yet.
    const rows = await queryRollup({
      metric: "rollup.read.never-registered",
      inverterId,
      bucket: "hour",
      limit: 100,
      from: new Date("2026-03-01T00:00:00Z"),
      to: new Date("2026-03-04T00:00:00Z"),
    });
    expect(rows).toEqual([]);
  });

  test("the median read runs against the same source and returns a number", async () => {
    // `percentile_cont` over the interpolated averages: the statement is an
    // ordered-set aggregate over a derived table with a WINDOW clause in it, which
    // is precisely the kind of nesting Postgres accepts or rejects outright.
    const median = await queryMedianHourlyAvg(METRIC, inverterId, 100_000);
    expect(median).not.toBeNull();
    expect(Number.isFinite(median)).toBe(true);
  });
});
