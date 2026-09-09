/**
 * THE BUCKET REPLAY against a real TimescaleDB.
 *
 * `packages/db/src/replay.test.ts` proves the arithmetic — widths, bucket-start
 * timestamps, tier choice, chunking, what a re-run does. None of that proves the
 * statements in `packages/db/src/replay-run.ts` are accepted by Postgres, land
 * the rows they claim, or that the replayed series still answers the ONE question
 * the 2.0.0 schema exists for: how much energy a counter recorded on a day it
 * reset. So this file executes all of it, and asserts NUMBERS.
 *
 * Four properties are load-bearing here, and each has a way of failing silently:
 *
 *  1. ENERGY SURVIVES. A replayed series must give the same per-day energy as the
 *     original samples did. The ground truth is computed by `perDayEnergy` from
 *     `scripts/fixture-1-2-0.ts` — the same unit-tested function that wrote the
 *     committed fixture ground truth, never a second implementation.
 *  2. THE RESET HAZARD STAYS FIXED. The seeded lifetime counter loses its
 *     accumulated total MID-DAY, which is the case a midnight-aligned reset
 *     hides: with the cliff at midnight, a daily bucket's naive max-minus-min is
 *     accidentally right. Here it is wrong by ~1500x, and `counter_agg`/`delta`
 *     over the REPLAYED rows is right.
 *  3. CONFIG REGISTERS LEAVE THE HYPERTABLE. At 1.2.0 they were still in
 *     `metrics_raw` and therefore in the minute buckets. A day-chunked replay
 *     that compared each chunk only against itself would emit one row per config
 *     metric per day; the whole history here collapses to three rows.
 *  4. THE LOSS IS PINNED. Per-bucket min/max is destroyed for the replayed span.
 *     A test that asserts the loss is documentation that cannot rot.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { ensureMetricKeys } from "@SunReye/db/metric-keys";
import {
  type ReplayClient,
  type ReplayRequest,
  bunSqlClient,
  completedChunks,
  replayChunk,
  runReplay,
} from "@SunReye/db/replay-run";
import { SQL } from "bun";
import { type CounterReading, describeRestarts, perDayEnergy } from "@SunReye/db/counter-energy";
import { databaseReachable, resetTestDatabase } from "./harness";

const reachable = await databaseReachable();
const realDb = await import("@SunReye/db");
const realDbExports = { ...realDb };

if (!reachable) {
  const message = "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}

const suite = reachable ? describe : describe.skip;

/** Four days at one sample a minute — 1.2.0's cadence, so one bucket per sample. */
const SPAN_DAYS = 4;
const MINUTES_PER_DAY = 1440;
const START = "2026-05-01T00:00:00Z";
const END = "2026-05-05T00:00:00Z";

/**
 * The counter cliff sits MID-DAY on the third day, exactly as
 * the real fixture places it: `floor(spanDays/2)*1440 + 720`.
 */
const RESTART_AT_MINUTE = Math.floor(SPAN_DAYS / 2) * MINUTES_PER_DAY + 720;

const TOTAL = "replay.total_energy";
const DAY = "replay.day_energy";
const POWER = "replay.power";
const LIMIT = "replay.settings.limit";
const MODE = "replay.settings.mode";

/**
 * The series metrics, as SQL over the seed subquery — `s.m` float minutes since
 * the span start, `s.mi` the same as bigint (Postgres has `mod` and integer
 * division for one and the trigonometry for the other, with no overlap).
 *
 * Written here rather than borrowed from `scripts/fixture-1-2-0.ts` for a
 * mechanical reason — `apps/server` cannot import from `scripts/` under tsc's
 * `rootDir` — and it costs nothing, because this suite never needs a TypeScript
 * twin of these curves: the ground truth is read back out of the SEEDED SOURCE
 * BUCKETS, so what is compared is the source against the replay rather than
 * either against a model.
 */
const LIFETIME_OFFSET = 45_000;
const RATE_PER_DAY = 30;
/** What the lifetime counter reads the instant before it loses its total. */
const LOST_AT_CLIFF = LIFETIME_OFFSET + (RATE_PER_DAY * RESTART_AT_MINUTE) / MINUTES_PER_DAY;

const SERIES: { key: string; isCounter: boolean; expr: string }[] = [
  {
    // The lifetime register: monotonic, then a MID-DAY cliff to zero. Mid-day and
    // not midnight on purpose — a midnight-aligned reset leaves a daily bucket's
    // naive max-minus-min accidentally correct, which would hide the bug.
    key: TOTAL,
    isCounter: true,
    expr:
      `case when s.mi >= ${RESTART_AT_MINUTE}` +
      ` then (${LIFETIME_OFFSET} + ${RATE_PER_DAY} * s.m / ${MINUTES_PER_DAY}) - ${LOST_AT_CLIFF}` +
      ` else ${LIFETIME_OFFSET} + ${RATE_PER_DAY} * s.m / ${MINUTES_PER_DAY} end`,
  },
  {
    // A day register: back to zero at every midnight, i.e. ON a bucket boundary.
    key: DAY,
    isCounter: true,
    expr: `${RATE_PER_DAY} * mod(s.mi, ${MINUTES_PER_DAY})::double precision / ${MINUTES_PER_DAY}`,
  },
  {
    // A diurnal PV curve: zero overnight, so the replayed span contains real
    // zeros and a real intra-hour swing for the loss assertions.
    key: POWER,
    isCounter: false,
    expr: `greatest(0::double precision, 4000 * sin(pi() * ((mod(s.mi, ${MINUTES_PER_DAY})::double precision / 60) - 6) / 12))`,
  },
];

const CONFIG_KEYS = [LIMIT, MODE];

/**
 * The config registers, as SQL over the seed subquery.
 *
 * A STEP function rather than one of the fixture's shapes, and that is the point:
 * `LIMIT` changes exactly once, twelve hours into the third day, so the
 * change-log must end up with two rows for it — not one per chunk, and not one
 * per bucket. `MODE` never changes at all, so it must produce exactly one.
 */
const CONFIG_EXPR: Record<string, string> = {
  [LIMIT]: `case when s.mi >= ${RESTART_AT_MINUTE} then 60 else 40 end::double precision`,
  [MODE]: "2::double precision",
};

const MINUTE_SOURCE = "replay_legacy_minute";
const HOURLY_SOURCE = "replay_legacy_hourly";
const UNKNOWN_SOURCE = "replay_legacy_unknown";

const SOURCE_ID = "replay-profile-1.2.0";

const EPSILON = 1e-6;

suite("bucket replay against a real TimescaleDB", () => {
  /**
   * `max: 1`, and the replay's `begin`/`commit` is why: on a pool the two could
   * land on different backends and the chunk transaction — the whole of the
   * resumability guarantee — would silently not be one.
   */
  let pool: SQL;
  let client: ReplayClient;
  let raw: ReturnType<typeof realDbExports.createDbAt>;
  let deviceId: number;
  let hourlyDeviceId: number;
  let resumeDeviceId: number;
  /** Per-metric, per-UTC-day energy the ORIGINAL samples imply. */
  let truth: ReturnType<typeof perDayEnergy>;

  /**
   * The counter readings the SOURCE buckets hold, in the shape the differ wants.
   *
   * At 1.2.0's one-sample-a-minute cadence a minute bucket holds exactly one
   * sample, so `avg_value` at `bucket` IS that sample — which is what makes the
   * replay of this tier lossless for the mean and why the comparison below can be
   * exact rather than approximate.
   */
  const sourceReadings = async (metrics: readonly string[]): Promise<CounterReading[]> => {
    const rows = await raw.execute<{ bucket: Date; metric: string; avg_value: number }>(sql`
      select bucket, metric, avg_value from ${sql.raw(MINUTE_SOURCE)}
      where metric in (${sql.join(
        metrics.map((m) => sql`${m}`),
        sql`, `,
      )})
      order by metric, bucket`);
    return (rows.rows as { bucket: Date | string; metric: string; avg_value: number }[]).map(
      (row) => ({
        metric: row.metric,
        time: new Date(row.bucket).toISOString(),
        value: row.avg_value,
      }),
    );
  };

  const request = (over: Partial<ReplayRequest> = {}): ReplayRequest => ({
    source: "legacy-1.2.0",
    relations: { minute: MINUTE_SOURCE },
    identity: { sourceId: SOURCE_ID, deviceId },
    configKeys: CONFIG_KEYS,
    ...over,
  });

  beforeAll(async () => {
    const url = await resetTestDatabase();
    raw = realDbExports.createDbAt(url);
    pool = new SQL(url, { max: 1, idleTimeout: 0 });
    client = bunSqlClient(pool);

    await raw.execute(sql`
      insert into plants (name, slug, time_zone) values ('replay', 'replay', 'UTC')`);
    // Three devices, because three of the properties below must not share a
    // series: the resume test replays the same span a second time, and a device
    // holding two rows per minute would make every energy assertion below meet a
    // series no writer could ever produce.
    const addDevice = async (slug: string): Promise<number> => {
      const inserted = await raw.execute<{ id: number }>(sql`
        insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
        select id, null, 1, ${slug}, 'replay probe', ${SOURCE_ID}, 'inverter'
        from plants where slug = 'replay'
        returning id`);
      return Number((inserted.rows[0] as { id: number }).id);
    };
    deviceId = await addDevice("replay-minute");
    hourlyDeviceId = await addDevice("replay-hourly");
    resumeDeviceId = await addDevice("replay-resume");

    await ensureMetricKeys(raw, [
      ...SERIES.map((s) => ({ key: s.key, isCounter: s.isCounter })),
      ...CONFIG_KEYS.map((key) => ({ key, isCounter: false })),
    ]);

    // The 1.2.0 bucket shape, verbatim from
    // `git show addon-v1.2.0:packages/db/src/timescale/0000_bootstrap.sql`:
    // (bucket, inverter_id, metric, avg_value, max_value, min_value).
    for (const table of [MINUTE_SOURCE, HOURLY_SOURCE, UNKNOWN_SOURCE]) {
      await raw.execute(sql`
        create table if not exists ${sql.raw(table)} (
          bucket timestamptz not null,
          inverter_id text not null,
          metric text not null,
          avg_value double precision,
          max_value double precision,
          min_value double precision
        )`);
    }

    // One generate_series INSERT per metric — the same reason the fixture does
    // it that way: 23 040 buckets is not 23 040 round trips.
    const seed = (metric: string, expr: string) => sql`
      insert into ${sql.raw(MINUTE_SOURCE)} (bucket, inverter_id, metric, avg_value, max_value, min_value)
      select s.ts, ${SOURCE_ID}, ${metric}, v.value, v.value, v.value
      from (
        select ts,
               (extract(epoch from (ts - ${START}::timestamptz)) / 60)::double precision as m,
               (extract(epoch from (ts - ${START}::timestamptz)) / 60)::bigint as mi
        from generate_series(${START}::timestamptz, ${END}::timestamptz - interval '1 minute',
                             interval '1 minute') as ts
      ) s, lateral (select (${sql.raw(expr)}) as value) v`;

    for (const metric of SERIES) await raw.execute(seed(metric.key, metric.expr));
    for (const key of CONFIG_KEYS) await raw.execute(seed(key, CONFIG_EXPR[key] as string));

    // The hourly tier, rolled up from the minute buckets the same way 1.2.0's
    // own hourly aggregate was: an UNWEIGHTED avg over equal-duration samples,
    // with a real min/max SPREAD — which is what makes the loss visible.
    await raw.execute(sql`
      insert into ${sql.raw(HOURLY_SOURCE)} (bucket, inverter_id, metric, avg_value, max_value, min_value)
      select time_bucket('1 hour', bucket), inverter_id, metric,
             avg(avg_value), max(max_value), min(min_value)
      from ${sql.raw(MINUTE_SOURCE)}
      group by 1, 2, 3`);

    // THE GROUND TRUTH, read out of the source buckets themselves: what the
    // 1.2.0 aggregate holds is what the replay has to still be able to answer.
    truth = perDayEnergy(await sourceReadings(SERIES.filter((m) => m.isCounter).map((m) => m.key)));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  const countRaw = async (metric: string, device = deviceId): Promise<number> => {
    const result = await raw.execute<{ n: string }>(sql`
      select count(*) as n from metrics_raw r
      join metric_keys mk on mk.id = r.metric_id
      where r.device_id = ${device} and mk.key = ${metric}`);
    return Number((result.rows[0] as { n: string }).n);
  };

  const countConfig = async (metric: string): Promise<number> => {
    const result = await raw.execute<{ n: string }>(sql`
      select count(*) as n from metrics_config_log l
      join metric_keys mk on mk.id = l.metric_id
      where l.device_id = ${deviceId} and mk.key = ${metric}`);
    return Number((result.rows[0] as { n: string }).n);
  };

  describe("the run", () => {
    test("replays every bucket of the span as one interval row per bucket", async () => {
      const result = await runReplay(client, request());
      expect(result.gaps).toEqual([]);
      expect(result.chunks).toHaveLength(SPAN_DAYS);
      // Three series metrics x four days of minutes. The two config metrics are
      // NOT here — that is property 3.
      expect(result.seriesRows).toBe(SERIES.length * SPAN_DAYS * MINUTES_PER_DAY);
      for (const metric of SERIES) {
        expect(await countRaw(metric.key)).toBe(SPAN_DAYS * MINUTES_PER_DAY);
      }
      for (const key of CONFIG_KEYS) expect(await countRaw(key)).toBe(0);
    });

    test("stamps each row at BUCKET START with dur_ms = the tier width", async () => {
      const rows = await raw.execute<{ time: Date; dur_ms: number }>(sql`
        select r.time, r.dur_ms from metrics_raw r
        join metric_keys mk on mk.id = r.metric_id
        where r.device_id = ${deviceId} and mk.key = ${POWER}
        order by r.time limit 2`);
      expect(new Date((rows.rows[0] as { time: Date }).time).toISOString()).toBe(
        "2026-05-01T00:00:00.000Z",
      );
      expect(new Date((rows.rows[1] as { time: Date }).time).toISOString()).toBe(
        "2026-05-01T00:01:00.000Z",
      );
      expect((rows.rows[0] as { dur_ms: number }).dur_ms).toBe(60_000);
    });

    test("routes config registers to the change-log, one row per CHANGE", async () => {
      // Two rows for a register that changed once, and ONE for a register that
      // never changed — across four separately committed day chunks. Without the
      // cross-chunk `prior` lookup this would be four and four.
      expect(await countConfig(LIMIT)).toBe(2);
      expect(await countConfig(MODE)).toBe(1);
      const rows = await raw.execute<{ time: Date; value: number }>(sql`
        select l.time, l.value from metrics_config_log l
        join metric_keys mk on mk.id = l.metric_id
        where l.device_id = ${deviceId} and mk.key = ${LIMIT} order by l.time`);
      expect(rows.rows.map((r) => (r as { value: number }).value)).toEqual([40, 60]);
      expect(new Date((rows.rows[1] as { time: Date }).time).toISOString()).toBe(
        "2026-05-03T12:00:00.000Z",
      );
    });

    test("records a watermark row per completed chunk", async () => {
      const done = await completedChunks(client, request());
      expect([...done].sort()).toEqual([
        "2026-05-01T00:00:00.000Z",
        "2026-05-02T00:00:00.000Z",
        "2026-05-03T00:00:00.000Z",
        "2026-05-04T00:00:00.000Z",
      ]);
    });

    test("a re-run is a no-op: nothing planned, nothing written, nothing duplicated", async () => {
      const before = await countRaw(POWER);
      const again = await runReplay(client, request());
      expect(again.chunks).toEqual([]);
      expect(again.skipped).toBe(SPAN_DAYS);
      expect(again.seriesRows).toBe(0);
      expect(await countRaw(POWER)).toBe(before);
      expect(await countConfig(LIMIT)).toBe(2);
    });
  });

  describe("resumability", () => {
    test("a chunk that fails leaves NO watermark and NO rows — the transaction is the guarantee", async () => {
      // An unknown device id: the `metrics_raw` foreign key rejects the insert,
      // which is the cheapest faithful stand-in for a kill mid-chunk.
      const orphan = request({
        source: "legacy-rollback",
        identity: { sourceId: SOURCE_ID, deviceId: 32_000 },
      });
      const chunk = {
        tier: "minute" as const,
        start: new Date(START),
        end: new Date("2026-05-02T00:00:00Z"),
      };
      let failed: unknown;
      try {
        await replayChunk(client, orphan, chunk);
      } catch (error) {
        failed = error;
      }
      expect(failed).toBeInstanceOf(Error);
      expect(String((failed as Error & { cause?: unknown }).message)).toMatch(
        /foreign key|violates/,
      );
      expect(await completedChunks(client, orphan)).toEqual(new Set());
      expect(await countRaw(POWER, 32_000)).toBe(0);
    });

    test("a run interrupted after two days resumes at the third and duplicates nothing", async () => {
      const resumed = (over: Partial<ReplayRequest> = {}) =>
        request({
          source: "legacy-resumed",
          identity: { sourceId: SOURCE_ID, deviceId: resumeDeviceId },
          ...over,
        });
      const partial = resumed({ to: new Date("2026-05-03T00:00:00Z") });
      const first = await runReplay(client, partial);
      expect(first.chunks).toHaveLength(2);

      // The same source, now over the whole span: the two committed days are
      // skipped and only the rest is written.
      const rest = await runReplay(client, resumed());
      expect(rest.skipped).toBe(2);
      expect(rest.chunks.map((c) => c.start.toISOString())).toEqual([
        "2026-05-03T00:00:00.000Z",
        "2026-05-04T00:00:00.000Z",
      ]);
      expect(first.seriesRows + rest.seriesRows).toBe(SERIES.length * SPAN_DAYS * MINUTES_PER_DAY);
    });
  });

  describe("refusals", () => {
    test("refuses to run while a source metric is unregistered, and writes nothing", async () => {
      await raw.execute(sql`
        insert into ${sql.raw(UNKNOWN_SOURCE)} (bucket, inverter_id, metric, avg_value, max_value, min_value)
        values (${START}::timestamptz, ${SOURCE_ID}, 'replay.never.registered', 1, 1, 1)`);
      const unknown = request({ source: "legacy-unknown", relations: { minute: UNKNOWN_SOURCE } });
      await expect(runReplay(client, unknown)).rejects.toThrow(/replay\.never\.registered/);
      expect(await completedChunks(client, unknown)).toEqual(new Set());
    });

    test("refuses a relation name that is not a bare identifier", async () => {
      await expect(
        runReplay(client, request({ relations: { minute: 'x"; drop table metrics_raw; --' } })),
      ).rejects.toThrow(/identifier/);
    });
  });

  describe("the energy the replayed series still carries", () => {
    /** The tiers, PARENT BEFORE CHILD — daily reads hourly, never raw. */
    const TIERS = ["minute_rollups", "hourly_rollups", "daily_rollups"] as const;
    /** The day the lifetime counter loses its total, twelve hours in. */
    const CLIFF_DAY = "2026-05-03";
    /** One minute of the lifetime counter's 30 kWh/day: 0.0208333… kWh. */
    const ONE_STEP = 30 / MINUTES_PER_DAY;

    beforeAll(async () => {
      // BOUNDED, and one day either side of the span. `(NULL, NULL)` would
      // advance every watermark past everything and materialize whatever another
      // spec file left in the shared database — after which a real-time
      // aggregation bug could not fail a test here.
      for (const tier of TIERS) {
        await raw.execute(sql`call refresh_continuous_aggregate(
          ${sql.raw(`'${tier}'`)}, '2026-04-30Z'::timestamptz, '2026-05-06Z'::timestamptz)`);
      }
    }, 60_000);

    /** Every replayed reading of one counter, as the ground-truth reader sees it. */
    const replayedReadings = async (metric: string): Promise<CounterReading[]> => {
      const rows = await raw.execute<{ time: Date; value: number }>(sql`
        select r.time, r.value from metrics_raw r
        join metric_keys mk on mk.id = r.metric_id
        where r.device_id = ${deviceId} and mk.key = ${metric}
        order by r.time`);
      return (rows.rows as { time: Date | string; value: number }[]).map((row) => ({
        metric,
        time: new Date(row.time).toISOString(),
        value: row.value,
      }));
    };

    const truthFor = (metric: string, day: string): number => {
      const row = truth.find((r) => r.metric === metric && r.day === day);
      if (!row) throw new Error(`no ground truth for ${metric} on ${day}`);
      return row.energy;
    };

    test("per-metric per-day energy equals the ground truth, exactly, for every counter", async () => {
      // THE ACCEPTANCE BAR. `perDayEnergy` is the same function that recorded the
      // committed fixture ground truth, run over the REPLAYED rows.
      const replayed = perDayEnergy([
        ...(await replayedReadings(TOTAL)),
        ...(await replayedReadings(DAY)),
      ]);
      expect(replayed).toHaveLength(truth.length);
      for (const [index, row] of replayed.entries()) {
        const expected = truth[index] as (typeof truth)[number];
        expect(`${row.metric}|${row.day}`).toBe(`${expected.metric}|${expected.day}`);
        expect(Math.abs(row.energy - expected.energy)).toBeLessThan(EPSILON);
        expect(row.resets).toBe(expected.resets);
      }
    });

    test("every counter restart survives replay, at the same instant and the same values", async () => {
      // Not just the count: a replay that shifted a bucket by one width, or
      // carried max instead of the mean, would keep 1 restart and move it.
      const before = describeRestarts(await sourceReadings([TOTAL, DAY]));
      const after = describeRestarts([
        ...(await replayedReadings(TOTAL)),
        ...(await replayedReadings(DAY)),
      ]);
      expect(after).toEqual(before);
      // One lifetime cliff plus one midnight reset per day after the first.
      expect(after).toHaveLength(1 + (SPAN_DAYS - 1));
      const cliff = after.find((row) => row.metric === TOTAL);
      expect(cliff?.at).toBe(`${CLIFF_DAY}T12:00:00.000Z`);
      expect(cliff?.valueAfter).toBe(0);
    });

    test("the mid-day cliff: naive max-minus-min is >1000x wrong, and it is REPRODUCED", async () => {
      // The replay is faithful, so the daily bucket's max/min still show the
      // catastrophe. This is the assertion that would break if a future change
      // "helpfully" clamped or smoothed a replayed counter.
      const row = await raw.execute<{ naive: number; resets: number }>(sql`
        select d.max_value - d.min_value as naive, num_resets(d.ctr)::int as resets
        from daily_rollups d join metric_keys mk on mk.id = d.metric_id
        where d.device_id = ${deviceId} and mk.key = ${TOTAL}
          and d.bucket = ${`${CLIFF_DAY}T00:00:00Z`}::timestamptz`);
      const { naive, resets } = row.rows[0] as { naive: number; resets: number };
      const actual = truthFor(TOTAL, CLIFF_DAY);
      expect(resets).toBe(1);
      expect(naive / actual).toBeGreaterThan(1000);
    });

    test("delta(counter_agg) over the replayed rows recovers the true daily energy", async () => {
      const row = await raw.execute<{ delta: number }>(sql`
        select delta(d.ctr) as delta from daily_rollups d
        join metric_keys mk on mk.id = d.metric_id
        where d.device_id = ${deviceId} and mk.key = ${TOTAL}
          and d.bucket = ${`${CLIFF_DAY}T00:00:00Z`}::timestamptz`);
      const { delta } = row.rows[0] as { delta: number };
      const actual = truthFor(TOTAL, CLIFF_DAY);
      // Within ONE sample step, not within an epsilon, and the difference is
      // structural rather than a rounding error: `delta` over a day bucket sees
      // only that day's samples, so the increment earned between 23:59 and 00:00
      // is attributed to the earlier bucket, while the ground truth attributes a
      // step to the day of the LATER reading. It is conserved, not lost — which
      // is what the whole-span assertion below proves.
      expect(Math.abs(delta - actual)).toBeLessThanOrEqual(ONE_STEP * 1.000001);
      // And it is nowhere near the naive answer.
      expect(Math.abs(delta - actual) / actual).toBeLessThan(0.001);
    });

    test("nothing is lost at the boundaries: the whole-span delta is exact", async () => {
      // `rollup(ctr)` recombines the daily partials, so this is one counter_agg
      // over every replayed sample of the span — resets included.
      const row = await raw.execute<{ delta: number; resets: number }>(sql`
        select delta(rollup(d.ctr)) as delta, num_resets(rollup(d.ctr))::int as resets
        from daily_rollups d join metric_keys mk on mk.id = d.metric_id
        where d.device_id = ${deviceId} and mk.key = ${TOTAL}
          and d.bucket >= '2026-05-01Z'::timestamptz and d.bucket < '2026-05-05Z'::timestamptz`);
      const { delta, resets } = row.rows[0] as { delta: number; resets: number };
      const expected = truth
        .filter((r) => r.metric === TOTAL)
        .reduce((sum, r) => sum + r.energy, 0);
      expect(resets).toBe(1);
      expect(Math.abs(delta - expected)).toBeLessThan(1e-6 * Math.max(1, expected));
    });

    test("a counter that resets at every midnight is also exact over the whole span", async () => {
      // The day registers reset ON the bucket boundary, which is the case that
      // makes a naive max-minus-min accidentally right — and therefore the case
      // that must not be the only one tested.
      const row = await raw.execute<{ delta: number; resets: number }>(sql`
        select delta(rollup(d.ctr)) as delta, num_resets(rollup(d.ctr))::int as resets
        from daily_rollups d join metric_keys mk on mk.id = d.metric_id
        where d.device_id = ${deviceId} and mk.key = ${DAY}
          and d.bucket >= '2026-05-01Z'::timestamptz and d.bucket < '2026-05-05Z'::timestamptz`);
      const { delta, resets } = row.rows[0] as { delta: number; resets: number };
      const expected = truth.filter((r) => r.metric === DAY).reduce((sum, r) => sum + r.energy, 0);
      expect(resets).toBe(SPAN_DAYS - 1);
      expect(Math.abs(delta - expected)).toBeLessThan(1e-6 * Math.max(1, expected));
    });
  });

  describe("what replay LOSES", () => {
    /**
     * Per-bucket min and max, for the whole replayed span. A bucket cannot be
     * un-averaged: replaying one interval row at the bucket's mean leaves the new
     * tier's `max_value` and `min_value` both equal to that mean.
     *
     * Asserted rather than written down, because a caller who assumed replay was
     * lossless would build a "daily peak power" chart out of it and be wrong by
     * the whole diurnal swing — silently, and only for the pre-cutover span.
     */
    const NOON = "2026-05-02T12:00:00Z";

    beforeAll(async () => {
      await runReplay(
        client,
        request({
          source: "legacy-hourly",
          relations: { hourly: HOURLY_SOURCE },
          identity: { sourceId: SOURCE_ID, deviceId: hourlyDeviceId },
        }),
      );
      await raw.execute(sql`call refresh_continuous_aggregate(
        'hourly_rollups', '2026-04-30Z'::timestamptz, '2026-05-06Z'::timestamptz)`);
    }, 60_000);

    test("an hourly replay writes ONE row per hour, holding the hour's mean for an hour", async () => {
      const row = await raw.execute<{ n: string; value: number; dur_ms: number }>(sql`
        select count(*) as n, min(r.value) as value, min(r.dur_ms) as dur_ms
        from metrics_raw r join metric_keys mk on mk.id = r.metric_id
        where r.device_id = ${hourlyDeviceId} and mk.key = ${POWER}
          and r.time >= ${NOON}::timestamptz and r.time < ${NOON}::timestamptz + interval '1 hour'`);
      const seen = row.rows[0] as { n: string; value: number; dur_ms: number };
      expect(Number(seen.n)).toBe(1);
      expect(seen.dur_ms).toBe(3_600_000);
      const legacy = await raw.execute<{ avg_value: number }>(sql`
        select avg_value from ${sql.raw(HOURLY_SOURCE)}
        where metric = ${POWER} and bucket = ${NOON}::timestamptz`);
      expect(seen.value).toBe((legacy.rows[0] as { avg_value: number }).avg_value);
    });

    test("the source bucket's min/max SPREAD is destroyed — the new bucket is flat", async () => {
      const legacy = await raw.execute<{ avg_value: number; spread: number }>(sql`
        select avg_value, max_value - min_value as spread from ${sql.raw(HOURLY_SOURCE)}
        where metric = ${POWER} and bucket = ${NOON}::timestamptz`);
      const source = legacy.rows[0] as { avg_value: number; spread: number };
      // The real hour swings by hundreds of watts around its mean...
      expect(source.spread).toBeGreaterThan(100);

      const replayed = await raw.execute<{ avg_value: number; spread: number }>(sql`
        select h.max_value as avg_value, h.max_value - h.min_value as spread
        from hourly_rollups h join metric_keys mk on mk.id = h.metric_id
        where h.device_id = ${hourlyDeviceId} and mk.key = ${POWER}
          and h.bucket = ${NOON}::timestamptz`);
      const after = replayed.rows[0] as { avg_value: number; spread: number };
      // ...and after replay the bucket is exactly as wide as a point.
      expect(after.spread).toBe(0);
      // The mean is what survived, to the bit.
      expect(after.avg_value).toBe(source.avg_value);
    });
  });
});
