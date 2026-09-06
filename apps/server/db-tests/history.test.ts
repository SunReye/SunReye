/**
 * `queryRecentBuckets` against a real TimescaleDB.
 *
 * Everything here asserts on ROWS, never on SQL text. Both bugs this layer was
 * built for were invisible to text assertions: `time_bucket(interval, unknown)`
 * is not unique (an uncast bound parameter), and an `ORDER BY` after the final
 * UNION arm binds to the union, where `time` is not in scope. Each was a 500 on
 * every dashboard load while the unit suite stayed green.
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

/**
 * Locally a missing database is a reason to skip — not everyone has one running,
 * and `bun run test` must stay database-free. In CI it is a broken workflow, and
 * skipping would make this whole layer silently absent: the exact failure mode
 * it was built to remove. So CI fails loudly instead.
 */
if (!reachable) {
  const message =
    "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL. Start one with `bun run db:start`.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}

const suite = reachable ? describe : describe.skip;

suite("queryRecentBuckets against a real TimescaleDB", () => {
  let queryRecentBuckets: typeof import("../src/shared/history").queryRecentBuckets;
  let raw: ReturnType<typeof realDbExports.createDbAt>;

  /**
   * The device SLUG the read layer is asked for — a name, which is the whole
   * point: `metrics_raw` is keyed by `device_id int2`, and the query layer
   * resolves the name to it (`../src/shared/identity-sql.ts`). These cases prove
   * that round trip against a real database, which is the one thing a SQL-text
   * assertion cannot do.
   *
   * The harness shares ONE database across spec files, so every row here is
   * scoped by this suite's own slugs rather than assuming an empty table.
   */
  const inverterId = "inv-db-test";
  /** The device's `metrics_raw.device_id`, resolved once the row exists. */
  let deviceId = 0;
  /** `metric key -> metric_keys.id`, so a seed can name a metric. */
  const metricIds = new Map<string, number>();

  beforeAll(async () => {
    const url = await resetTestDatabase();
    raw = realDbExports.createDbAt(url);
    mock.module("@SunReye/db", () => ({ ...realDbExports, db: raw }));
    ({ queryRecentBuckets } = await import("../src/shared/history"));

    // The dimension rows every reading now has a foreign key to. `id` is
    // GENERATED ALWAYS AS IDENTITY on all three, so none of them may be assigned
    // — the ids have to be read back.
    await raw.execute(sql`
      insert into plants (name, slug, time_zone) values ('hist', 'hist-db-test', 'UTC')`);
    const device = await raw.execute<{ id: number }>(sql`
      insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
      select id, null, 1, ${inverterId}, 'history probe', 'test-profile', 'inverter'
      from plants where slug = 'hist-db-test'
      returning id`);
    deviceId = Number((device.rows[0] as { id: number }).id);
  });

  afterAll(() => {
    mock.module("@SunReye/db", () => ({ ...realDbExports }));
  });

  /** Register a metric key on demand and remember its id. */
  async function metricId(key: string): Promise<number> {
    const known = metricIds.get(key);
    if (known !== undefined) return known;
    // `on conflict do update` rather than `do nothing`, so the statement returns
    // a row even when a previous case in this file already registered the key.
    const row = await raw.execute<{ id: number }>(sql`
      insert into metric_keys (key, is_counter) values (${key}, false)
      on conflict (key) do update set is_counter = excluded.is_counter
      returning id`);
    const id = Number((row.rows[0] as { id: number }).id);
    metricIds.set(key, id);
    return id;
  }

  /** Insert samples at explicit instants, so assertions are not clock-dependent. */
  async function seed(rows: Array<{ metric: string; at: Date; value: number }>) {
    const values = await Promise.all(
      rows.map(async (r) => ({ ...r, metricId: await metricId(r.metric) })),
    );
    await raw.execute(sql`
      insert into metrics_raw (time, value, dur_ms, device_id, metric_id)
      values ${sql.join(
        values.map((v) => sql`(${v.at}, ${v.value}, null, ${deviceId}, ${v.metricId})`),
        sql`, `,
      )}`);
  }

  /**
   * A window far from the wall clock, for the two cases below.
   *
   * The harness shares one database across this whole file, and the clock-relative
   * cases here assert an EXACT metric set inside "the last 300 s". So these two
   * seed a fixed historical window and pass `now` explicitly, rather than adding
   * their own metrics to everyone else's window.
   */
  const PAST = new Date("2026-01-01T12:00:00Z");
  const inPast = { inverterId, seconds: 300, stepSeconds: 1, now: PAST } as const;

  test("the device slug resolves to the int2 the readings were written under", async () => {
    // The boundary itself: a name in, an id in the table, and the name back out.
    // If `deviceIdOf` and the writer ever disagreed, every case below would read
    // as "no data" — which is indistinguishable from a working empty database.
    await seed([{ metric: "db.resolve", at: new Date(PAST.getTime() - 5_000), value: 42 }]);
    const out = await queryRecentBuckets(inPast);
    expect(out.metrics["db.resolve"]?.v).toEqual([42]);
    expect(deviceId).toBeGreaterThan(0);
  });

  test("the payload is keyed by metric NAME, never by metric_id", async () => {
    // `/api/history/recent`'s shape is an external contract: the client indexes
    // this map by the metric key it knows. An integer key would break every
    // sparkline and no type would notice.
    await seed([{ metric: "db.named", at: new Date(PAST.getTime() - 5_000), value: 1 }]);
    const out = await queryRecentBuckets(inPast);
    expect(Object.keys(out.metrics)).toContain("db.named");
    for (const key of Object.keys(out.metrics)) expect(Number.isNaN(Number(key))).toBe(true);
  });

  // The bug that shipped: an uncast bound parameter in `time_bucket`'s second
  // position. Postgres rejects the statement outright, so ANY result at all
  // proves the overload resolves.
  test("the statement is accepted by Postgres at all", async () => {
    const out = await queryRecentBuckets({ inverterId, seconds: 300, stepSeconds: 1 });
    expect(out).toBeDefined();
    expect(typeof out.t0).toBe("number");
    expect(out.step).toBe(1);
  });

  test("returns samples written inside the window", async () => {
    const now = Date.now();
    await seed([
      { metric: "db.pv", at: new Date(now - 30_000), value: 100 },
      { metric: "db.pv", at: new Date(now - 20_000), value: 200 },
      { metric: "db.load", at: new Date(now - 10_000), value: 50 },
    ]);
    const out = await queryRecentBuckets({ inverterId, seconds: 300, stepSeconds: 1 });
    expect(Object.keys(out.metrics).sort()).toEqual(["db.load", "db.pv"]);
    expect(out.metrics["db.pv"]?.v).toEqual([100, 200]);
    expect(out.metrics["db.load"]?.v).toEqual([50]);
  });

  // The second bug: the seed arm's own ordering has to bind to that arm. If it
  // escapes to the union the statement does not even parse; if it were dropped
  // instead, `distinct on (metric)` would return an ARBITRARY pre-window sample
  // rather than the most recent one — which no text assertion can distinguish.
  test("seeds a metric with the most recent value held before the window, not any older one", async () => {
    const now = Date.now();
    await seed([
      { metric: "db.held", at: new Date(now - 280_000), value: 11 },
      { metric: "db.held", at: new Date(now - 240_000), value: 22 },
      { metric: "db.held", at: new Date(now - 200_000), value: 33 },
    ]);
    // A 60 s window leaves all three samples in the past, so the metric can only
    // appear via the seed arm — and must carry 33, the newest of them.
    const out = await queryRecentBuckets({ inverterId, seconds: 60, stepSeconds: 1 });
    expect(out.metrics["db.held"]?.v).toEqual([33]);
  });

  // The seed occupies the bucket the window OPENS in, so a later in-window
  // sample sits in a different bucket and both legitimately survive
  // `distinct on (metric, bucket)`. What must never happen is a STALE value
  // outliving a newer one — that is the job of the seed arm's ordering and of
  // the `pref` tie-break together.
  //
  // The window end is passed EXPLICITLY, which is what makes this deterministic.
  // It used to blanket the boundary with 20 samples 100 ms apart and reason that
  // one must share the seed's bucket however the boundary fell. That is not true:
  // `time_bucket` is epoch-aligned, not `since`-aligned, so when `since` lands in
  // the last <50 ms of a second the opening bucket ENDS before the first sample,
  // the seed sits in it alone, and the stale 1 survives — a real failure of a
  // real assertion, caused by the clock rather than the code. It reproduced 1 run
  // in 12 on an idle machine and once in CI.
  test("a stale pre-window value never survives alongside newer samples", async () => {
    // A whole second, so `since` is exactly a 1 s bucket boundary and every
    // offset below is unambiguous.
    const now = new Date(Math.ceil(Date.now() / 1000) * 1000);
    const since = now.getTime() - 300_000;

    await seed([
      // The only row before the window: whatever the seed arm returns, it is this.
      { metric: "db.wins", at: new Date(since - 100_000), value: 1 },
      // In the bucket the window opens in, so it meets the seed head-on and the
      // `pref` tie-break has to prefer the real sample.
      { metric: "db.wins", at: new Date(since), value: 999 },
      // A later bucket, so the seed is not simply overwritten everywhere.
      { metric: "db.wins", at: new Date(since + 1500), value: 999 },
    ]);

    const out = await queryRecentBuckets({ inverterId, seconds: 300, stepSeconds: 1, now });
    expect(out.metrics["db.wins"]?.v).toContain(999);
    expect(out.metrics["db.wins"]?.v).not.toContain(1);
  });

  // `bucket` is `::bigint`, which Postgres renders as TEXT. Without the mapper
  // the offsets would be string-concatenated rather than added — arithmetic on a
  // value the compiler believes is a number.
  test("bucket offsets arrive as numbers, not concatenated strings", async () => {
    const now = Date.now();
    await seed([
      { metric: "db.num", at: new Date(now - 40_000), value: 7 },
      { metric: "db.num", at: new Date(now - 39_000), value: 8 },
    ]);
    const out = await queryRecentBuckets({ inverterId, seconds: 300, stepSeconds: 1 });
    for (const offset of out.metrics["db.num"]?.o ?? []) {
      expect(typeof offset).toBe("number");
      expect(offset).toBeLessThan(300);
    }
  });

  test("a source id that names no device at all is an empty metric map, never an error", async () => {
    // `deviceIdOf` resolves to NULL, and `device_id = NULL` is false — so an
    // unknown device reads as "no data", which is what it is. A stale dashboard
    // bookmark must not be a 500.
    const out = await queryRecentBuckets({
      inverterId: "inv-absent",
      seconds: 300,
      stepSeconds: 1,
    });
    expect(out.metrics).toEqual({});
    expect(Number.isFinite(out.t0)).toBe(true);
  });

  test("a profile id shared by two devices names NEITHER — never the lower id", async () => {
    // Before this pinned it, the transitional `profile_id` arm answered `min(id)`:
    // two Deye inverters on one profile read as whichever was provisioned first,
    // silently. A shared profile now resolves to nothing; the slug arm is the
    // only way to name one of them, and it still works.
    await seed([{ metric: "db.shared", at: new Date(PAST.getTime() - 5_000), value: 7 }]);
    await raw.execute(sql`
      insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
      select id, null, 2, 'inv-db-test-twin', 'twin', 'test-profile', 'inverter'
      from plants where slug = 'hist-db-test'`);
    try {
      const byProfile = await queryRecentBuckets({ ...inPast, inverterId: "test-profile" });
      expect(byProfile.metrics).toEqual({});
      const bySlug = await queryRecentBuckets(inPast);
      expect(bySlug.metrics["db.shared"]?.v).toEqual([7]);
    } finally {
      await raw.execute(sql`delete from devices where slug = 'inv-db-test-twin'`);
    }
  });

  test("a wider bucket width still resolves and groups", async () => {
    const now = Date.now();
    await seed([
      { metric: "db.wide", at: new Date(now - 50_000), value: 1 },
      { metric: "db.wide", at: new Date(now - 48_000), value: 2 },
    ]);
    const out = await queryRecentBuckets({ inverterId, seconds: 300, stepSeconds: 60 });
    expect(out.step).toBe(60);
    expect(out.metrics["db.wide"]?.v.length).toBeGreaterThan(0);
  });
});
