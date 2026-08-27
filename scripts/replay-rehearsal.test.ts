/**
 * The rehearsal script's pure half: argument parsing, the throughput number the
 * next wave sizes its chunking from, and — the reason this file matters most —
 * the target pinning.
 *
 * The script DROPs its target databases, and two of this host's ports must never
 * be dropped: 5432 is the developer's dev database, SHARED WITH A LIVE GRID-TIED
 * INVERTER, and 5433 is the addon-1.2.0 fixture, 221 s to rebuild and read-only.
 * Nothing else in the repo would stop a copy-pasted URL from reaching either.
 */
import { describe, expect, test } from "bun:test";
import {
  ALLOWED_PORTS,
  DEFAULT_OPTIONS,
  DEV_DB_PORT,
  FIXTURE_PORT,
  LEGACY_RELATION,
  TIER_OF,
  assertRehearsalTarget,
  type Replayed,
  type UnsafeSql,
  DEFAULT_OPTIONS as OPTS,
  checkAggregates,
  classifyProfile,
  configProblems,
  hazardProblems,
  noOpProblems,
  parseArgs,
  main,
  replay,
  replayedEnergy,
  report,
  sampleProblems,
  seedDimensions,
  spanProblems,
  verifyConfigRouting,
  verifyEnergy,
  verifySampledRows,
  verifySource,
  throughput,
  worstNaiveError,
} from "./replay-rehearsal";

const url = (port: number, database = "sunreye_replay_200") =>
  `postgres://postgres:pw@localhost:${port}/${database}`;

describe("assertRehearsalTarget", () => {
  test("refuses the dev database by name, because that mistake is unrecoverable", () => {
    expect(() => assertRehearsalTarget(url(DEV_DB_PORT))).toThrow(/live\s+inverter/);
  });

  test("refuses the fixture container: it is READ-ONLY here", () => {
    expect(() => assertRehearsalTarget(url(FIXTURE_PORT))).toThrow(/READ-ONLY/);
  });

  test("refuses any port that is not a rehearsal port, so no ambient URL can be the target", () => {
    for (const port of [5000, 5431, 5438, 15432]) {
      expect(() => assertRehearsalTarget(url(port))).toThrow(/Refusing to touch port/);
    }
  });

  test("refuses a database whose name is not a rehearsal database", () => {
    for (const name of ["", "postgres", "sunreye", "sunreye_dbtest", "sunreye_fixture_120"]) {
      expect(() => assertRehearsalTarget(url(ALLOWED_PORTS[0], name))).toThrow(
        /only builds databases/,
      );
    }
  });

  test("accepts every allowed port with a rehearsal database name", () => {
    for (const port of ALLOWED_PORTS) {
      expect(() => assertRehearsalTarget(url(port))).not.toThrow();
      expect(() => assertRehearsalTarget(url(port, "sunreye_replay_120"))).not.toThrow();
    }
  });

  test("the default target is one the guard accepts — the script cannot ship pointing at 5432", () => {
    expect(() =>
      assertRehearsalTarget(
        `postgres://postgres:pw@localhost:${DEFAULT_OPTIONS.port}/${DEFAULT_OPTIONS.targetDb}`,
      ),
    ).not.toThrow();
  });
});

describe("parseArgs", () => {
  test("defaults to the full fixture replayed from the minute tier", () => {
    expect(parseArgs([])).toEqual(DEFAULT_OPTIONS);
  });

  test("reads the value flags", () => {
    const options = parseArgs([
      "--port=5437",
      "--container=other",
      "--source-db=sunreye_replay_a",
      "--target-db=sunreye_replay_b",
      "--tier=hourly",
    ]);
    expect(options.port).toBe(5437);
    expect(options.container).toBe("other");
    expect(options.sourceDb).toBe("sunreye_replay_a");
    expect(options.targetDb).toBe("sunreye_replay_b");
    expect(options.tier).toBe("hourly");
  });

  test("reads the boolean flags", () => {
    expect(parseArgs(["--fast"]).mode).toBe("fast");
    expect(parseArgs(["--skip-aggregates"]).skipAggregates).toBe(true);
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("rejects an unknown argument rather than silently defaulting", () => {
    expect(() => parseArgs(["--fas"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--tier=weekly"])).toThrow(/not one of/);
    expect(() => parseArgs(["--port=abc"])).toThrow(/not an integer/);
  });
});

describe("throughput", () => {
  test("is rows per second, rounded", () => {
    expect(throughput(155_520, 1000)).toBe(155_520);
    expect(throughput(9_072_000, 60_000)).toBe(151_200);
  });

  test("is null rather than Infinity when no time passed", () => {
    expect(throughput(100, 0)).toBeNull();
    expect(throughput(100, -1)).toBeNull();
  });

  test("a run that wrote nothing has a rate of zero, not a crash", () => {
    expect(throughput(0, 5000)).toBe(0);
  });
});

describe("the tier tables", () => {
  test("every source tier names a legacy relation and the aggregate it came from", () => {
    for (const tier of ["minute", "hourly", "daily"] as const) {
      expect(LEGACY_RELATION[tier]).toBe(`legacy_${tier}_rollups`);
      expect(TIER_OF[tier]).toBe(`${tier}_rollups`);
    }
  });
});

/** The fixture's own worst case, from scripts/fixtures/ground-truth-1-2-0.full.json. */
const CLIFF = {
  metric: "total_energy",
  day: "2026-07-28",
  energy: 41.97083333333285,
  naive: 64_280.970833333326,
  resets: 1,
};

describe("worstNaiveError", () => {
  test("picks the metric-day whose naive answer is furthest out, not the largest total", () => {
    const rows = [
      { metric: "day_energy", day: "2026-07-01", energy: 30, naive: 30, resets: 0 },
      { metric: "ac.total", day: "2026-07-02", energy: 100, naive: 400, resets: 1 },
      CLIFF,
    ];
    expect(worstNaiveError(rows)?.metric).toBe("total_energy");
  });

  test("ignores days with no reset — a clean day's naive answer is right", () => {
    expect(
      worstNaiveError([{ metric: "a", day: "d", energy: 5, naive: 5, resets: 0 }]),
    ).toBeUndefined();
  });

  test("ignores a reset day that recorded no energy, which cannot be scored", () => {
    expect(
      worstNaiveError([{ metric: "a", day: "d", energy: 0, naive: 900, resets: 1 }]),
    ).toBeUndefined();
  });

  test("no rows at all yields nothing rather than throwing", () => {
    expect(worstNaiveError([])).toBeUndefined();
  });
});

describe("hazardProblems", () => {
  const measured = { naive: CLIFF.naive, ctrDelta: 41.942, resets: 1 };

  test("the fixture's real numbers pass: naive reproduced, delta within one sample", () => {
    expect(hazardProblems(CLIFF, measured)).toEqual([]);
  });

  test("a naive answer that no longer matches means the replayed series is not the source's", () => {
    const problems = hazardProblems(CLIFF, { ...measured, naive: 41.97 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/not the fixture's/);
  });

  test("the delta may differ by one boundary sample, but not by two", () => {
    const step = CLIFF.energy / 1440;
    expect(hazardProblems(CLIFF, { ...measured, ctrDelta: CLIFF.energy - step })).toEqual([]);
    expect(
      hazardProblems(CLIFF, { ...measured, ctrDelta: CLIFF.energy - step * 2 }).join(" "),
    ).toMatch(/one sample step/);
  });

  test("the naive answer being right is NOT enough — a lost reset is still a finding", () => {
    expect(hazardProblems(CLIFF, { ...measured, resets: 0 }).join(" ")).toMatch(
      /0 resets after replay, 1 in truth/,
    );
  });

  test("reports every failing claim at once rather than stopping at the first", () => {
    expect(hazardProblems(CLIFF, { naive: 1, ctrDelta: 9999, resets: 0 })).toHaveLength(3);
  });

  test("a negative-energy day is scored on magnitude, so the step is never negative", () => {
    const negative = { ...CLIFF, energy: -41.97, naive: -64_280.97 };
    expect(hazardProblems(negative, { naive: -64_280.97, ctrDelta: -41.97, resets: 1 })).toEqual(
      [],
    );
  });
});

describe("spanProblems", () => {
  test("an exact whole-span total is clean", () => {
    expect(spanProblems("total_energy", 2519.942, 2519.942)).toEqual([]);
  });

  test("floating-point noise is not a finding", () => {
    expect(spanProblems("total_energy", 2519.942 + 1e-9, 2519.942)).toEqual([]);
  });

  test("a real drift says energy was lost or invented", () => {
    expect(spanProblems("total_energy", 2519.9, 2519.942).join(" ")).toMatch(/lost or invented/);
  });

  test("zero against zero is clean — an empty span is not a loss", () => {
    expect(spanProblems("total_energy", 0, 0)).toEqual([]);
  });
});

describe("noOpProblems and configProblems", () => {
  test("a re-run that wrote nothing is clean", () => {
    expect(noOpProblems({ chunks: [], seriesRows: 0 })).toEqual([]);
  });

  test("a re-run that wrote anything at all is a finding — that is a double insert", () => {
    expect(noOpProblems({ chunks: [{}], seriesRows: 100 }).join(" ")).toMatch(/not a no-op/);
    expect(noOpProblems({ chunks: [], seriesRows: 1 }).join(" ")).toMatch(/not a no-op/);
  });

  test("no config row in metrics_raw is the pass; one is the failure (#150)", () => {
    expect(configProblems(0)).toEqual([]);
    expect(configProblems(1).join(" ")).toMatch(/metrics_config_log/);
  });
});

/**
 * A connection double: answers each statement by the fragment that identifies
 * it, and records what it was asked. The queries themselves are proved by the
 * real run against the fixture; what is pinned here is the arithmetic and the
 * findings built on top of them.
 */
function fakeSql(answers: Array<[RegExp, unknown]>): {
  db: UnsafeSql;
  asked: { query: string; values?: unknown[] }[];
} {
  const asked: { query: string; values?: unknown[] }[] = [];
  return {
    asked,
    db: {
      async unsafe(query, values) {
        asked.push({ query, values });
        for (const [pattern, rows] of answers) if (pattern.test(query)) return rows;
        return [];
      },
    },
  };
}

describe("seedDimensions", () => {
  test("creates the plant and the device, and registers every metric key", async () => {
    const { db, asked } = fakeSql([
      [/insert into devices/, [{ id: 4 }]],
      [
        /insert into "metric_keys"/i,
        [
          { id: 1, key: "a" },
          { id: 2, key: "b" },
        ],
      ],
    ]);
    const deviceId = await seedDimensions(db, "deye-sg05lp3", [
      { key: "a", isCounter: true },
      { key: "b", isCounter: false },
    ]);
    expect(deviceId).toBe(4);
    expect(asked[0]?.query).toMatch(/insert into plants/);
    // The device carries the 1.2.0 inverter_id as its profile_id — that is the
    // mapping an operator supplies, and the whole reason replay takes a
    // resolved device id rather than guessing one.
    expect(asked[1]?.values).toEqual(["deye-sg05lp3"]);
    // Registration goes through the shipped upsert, never a second insert.
    expect(asked[2]?.query).toMatch(/on conflict \(key\) do update/i);
  });
});

describe("replayedEnergy", () => {
  const counter = (values: number[]) =>
    values.map((value, index) => ({
      time: new Date(Date.UTC(2026, 6, 28, 0, index)).toISOString(),
      value,
    }));

  test("turns replayed rows into per-day energy and counts the restarts", async () => {
    const { db } = fakeSql([[/from metrics_raw/, counter([10, 20, 5, 15])]]);
    const result = await replayedEnergy(db, 1, ["total_energy"]);
    // 10 -> 20 is +10; 20 -> 5 is a RESET worth 5; 5 -> 15 is +10.
    expect(result.energy).toHaveLength(1);
    expect(result.energy[0]?.energy).toBeCloseTo(25, 9);
    expect(result.restarts).toHaveLength(1);
  });

  test("asks per metric, scoped to the device", async () => {
    const { db, asked } = fakeSql([[/from metrics_raw/, []]]);
    await replayedEnergy(db, 9, ["a", "b"]);
    expect(asked).toHaveLength(2);
    expect(asked[0]?.values).toEqual([9, "a"]);
    expect(asked[1]?.values).toEqual([9, "b"]);
  });

  test("a metric with no replayed rows contributes nothing rather than a zero day", async () => {
    const { db } = fakeSql([[/from metrics_raw/, []]]);
    expect(await replayedEnergy(db, 1, ["a"])).toEqual({ energy: [], restarts: [] });
  });
});

describe("checkAggregates", () => {
  const truth = {
    tiers: {
      minute_rollups: {
        minBucket: "2026-06-28 00:00:00+00",
        maxBucket: "2026-08-26 23:59:00+00",
        count: 1,
        digest: null,
      },
      hourly_rollups: { minBucket: null, maxBucket: null, count: 0, digest: null },
      daily_rollups: { minBucket: null, maxBucket: null, count: 0, digest: null },
    },
    perMetricPerDayEnergy: [
      CLIFF,
      { ...CLIFF, day: "2026-07-29", naive: 30, resets: 0, energy: 30 },
    ],
  } as unknown as Parameters<typeof checkAggregates>[1];

  test("materializes parent before child and finds nothing wrong with a faithful replay", async () => {
    const { db, asked } = fakeSql([
      [/max_value - d\.min_value/, [{ naive: CLIFF.naive, ctr_delta: 41.942, resets: 1 }]],
      [/rollup\(d\.ctr\)/, [{ ctr_delta: CLIFF.energy + 30 }]],
    ]);
    expect(await checkAggregates(db, truth, 1)).toEqual([]);
    const refreshes = asked.filter((a) => a.query.includes("refresh_continuous_aggregate"));
    expect(refreshes.map((r) => r.query.match(/'(\w+_rollups)'/)?.[1])).toEqual([
      "hourly_rollups",
      "daily_rollups",
    ]);
  });

  test("refreshes BOUNDED — a NULL, NULL refresh would make the check unable to fail", async () => {
    const { db, asked } = fakeSql([
      [/max_value - d\.min_value/, [{ naive: CLIFF.naive, ctr_delta: 41.942, resets: 1 }]],
      [/rollup\(d\.ctr\)/, [{ ctr_delta: CLIFF.energy + 30 }]],
    ]);
    await checkAggregates(db, truth, 1);
    const refresh = asked.find((a) => a.query.includes("refresh_continuous_aggregate"));
    expect(refresh?.query).not.toMatch(/NULL/i);
    expect(refresh?.values).toEqual(["2026-06-28 00:00:00+00", "2026-08-26 23:59:00+00"]);
  });

  test("reports a replay whose reset day drifted", async () => {
    const { db } = fakeSql([
      [/max_value - d\.min_value/, [{ naive: 41.97, ctr_delta: 41.942, resets: 1 }]],
      [/rollup\(d\.ctr\)/, [{ ctr_delta: CLIFF.energy + 30 }]],
    ]);
    expect((await checkAggregates(db, truth, 1)).join(" ")).toMatch(/not the fixture's/);
  });

  test("reports a whole-span total that drifted, which is energy genuinely lost", async () => {
    const { db } = fakeSql([
      [/max_value - d\.min_value/, [{ naive: CLIFF.naive, ctr_delta: 41.942, resets: 1 }]],
      [/rollup\(d\.ctr\)/, [{ ctr_delta: 0 }]],
    ]);
    expect((await checkAggregates(db, truth, 1)).join(" ")).toMatch(/lost or invented/);
  });

  test("says so when the day bucket the ground truth names is simply absent after replay", async () => {
    const { db } = fakeSql([[/max_value - d\.min_value/, []]]);
    expect((await checkAggregates(db, truth, 1)).join(" ")).toMatch(/no daily bucket/);
  });

  test("refuses to pass when the ground truth records no reset at all", async () => {
    const toothless = {
      ...(truth as object),
      perMetricPerDayEnergy: [{ metric: "a", day: "d", energy: 1, naive: 1, resets: 0 }],
    } as Parameters<typeof checkAggregates>[1];
    expect((await checkAggregates(db0(), toothless, 1)).join(" ")).toMatch(/no counter reset/);
  });

  test("says so when the ground truth has no minute window to bound the refresh with", async () => {
    const windowless = {
      ...(truth as object),
      tiers: { minute_rollups: { minBucket: null, maxBucket: null, count: 0, digest: null } },
    } as Parameters<typeof checkAggregates>[1];
    expect((await checkAggregates(db0(), windowless, 1)).join(" ")).toMatch(
      /no minute-tier window/,
    );
  });
});

const db0 = (): UnsafeSql => fakeSql([]).db;

describe("classifyProfile", () => {
  test("asks the PROFILE where each metric goes, never a key prefix (#150)", async () => {
    const { metrics, configKeys, inverterId } = await classifyProfile();
    expect(inverterId).toBe("deye-sg05lp3");
    expect(metrics).toHaveLength(105);
    // 39 of 105: the writable registers plus the time-of-use schedule. The
    // number is asserted so a profile change that silently moved a register
    // between the hypertable and the change-log shows up here.
    expect(configKeys).toHaveLength(39);
    expect(configKeys).toContain("settings.workmode");
    expect(configKeys).toContain("timeofuse.soc.1");
    // Every config key is a real metric, and no config key is a counter — an
    // energy total in the change-log would have no delta to read.
    const byKey = new Map(metrics.map((m) => [m.key, m]));
    for (const key of configKeys) expect(byKey.get(key)?.isCounter).toBe(false);
  });

  test("counters are the kWh totals, which is what daily_rollups' counter_agg is for", async () => {
    const { metrics } = await classifyProfile();
    const counters = metrics.filter((m) => m.isCounter).map((m) => m.key);
    expect(counters).toContain("total_energy");
    expect(counters).toContain("day_energy");
    expect(counters).not.toContain("battery.soc");
    // 13 counters x 60 days is the 780 metric-days the ground truth records.
    expect(counters).toHaveLength(13);
  });
});

describe("sampleProblems", () => {
  const pair = {
    bucket: "2026-07-28T12:00:00Z",
    avgValue: 3800.5,
    time: "2026-07-28T12:00:00Z",
    value: 3800.5,
    durMs: 60_000,
  };

  test("a faithful minute row is clean", () => {
    expect(sampleProblems("minute", [pair])).toEqual([]);
  });

  test("refuses to pass on an empty sample — a check over nothing proves nothing", () => {
    expect(sampleProblems("minute", []).join(" ")).toMatch(/no bucket\/row pairs/);
  });

  test("catches a row stamped anywhere but the bucket's start", () => {
    expect(sampleProblems("minute", [{ ...pair, time: "2026-07-28T12:01:00Z" }]).join(" ")).toMatch(
      /the mapping says 2026-07-28T12:00:00/,
    );
  });

  test("catches a value that is not the bucket's mean — e.g. max_value by mistake", () => {
    expect(sampleProblems("minute", [{ ...pair, value: 4000 }]).join(" ")).toMatch(
      /row value 4000/,
    );
  });

  test("catches the wrong tier's width in dur_ms", () => {
    expect(sampleProblems("hourly", [{ ...pair, durMs: 60_000 }]).join(" ")).toMatch(
      /dur_ms 60000, the mapping says 3600000/,
    );
  });

  test("a row that exists for a bucket with no mean is itself the finding", () => {
    expect(sampleProblems("minute", [{ ...pair, avgValue: null }]).join(" ")).toMatch(
      /carries no mean, yet a row exists/,
    );
  });
});

/** The pieces of a ground truth the verification steps read. */
const TRUTH = {
  fixture: { spanDays: 60, metricCount: 105 },
  tiers: {
    minute_rollups: {
      minBucket: "2026-06-28 00:00:00+00",
      maxBucket: "2026-08-26 23:59:00+00",
      count: 9_072_000,
      digest: "64d318eccb3dda61f7bfd74bd7123d26",
    },
  },
  perMetricPerDayEnergy: [CLIFF],
  restarts: [
    { metric: "total_energy", at: "2026-07-28T12:00:00.000Z", valueBefore: 1, valueAfter: 0 },
  ],
} as unknown as Parameters<typeof verifySource>[2];

const replayedOf = (db: UnsafeSql): Replayed => ({
  target: db,
  options: OPTS,
  truth: TRUTH,
  deviceId: 1,
  inverterId: "deye-sg05lp3",
  configKeys: ["settings.workmode"],
});

describe("verifySource", () => {
  const tierRow = (over: Record<string, unknown> = {}) => [
    {
      minBucket: "2026-06-28 00:00:00+00",
      maxBucket: "2026-08-26 23:59:00+00",
      count: 9_072_000,
      digest: "64d318eccb3dda61f7bfd74bd7123d26",
      ...over,
    },
  ];

  test("a copy identical to the committed digest is clean", async () => {
    const { db } = fakeSql([[/FROM legacy_minute_rollups/i, tierRow()]]);
    expect(await verifySource(db as never, OPTS, TRUTH)).toEqual([]);
  });

  test("reads the LEGACY relation, not the 2.0.0 aggregate of the same tier", async () => {
    const { db, asked } = fakeSql([[/FROM legacy_minute_rollups/i, tierRow()]]);
    await verifySource(db as never, OPTS, TRUTH);
    expect(asked[0]?.query).toContain("FROM legacy_minute_rollups");
  });

  test("a drifted digest is the finding — the copy is not the fixture's data", async () => {
    const { db } = fakeSql([[/FROM legacy_minute_rollups/i, tierRow({ digest: "deadbeef" })]]);
    expect((await verifySource(db as never, OPTS, TRUTH)).join(" ")).toMatch(/digest/);
  });

  test("a copy that lost buckets is reported by count", async () => {
    const { db } = fakeSql([[/FROM legacy_minute_rollups/i, tierRow({ count: 10 })]]);
    expect((await verifySource(db as never, OPTS, TRUTH)).join(" ")).toMatch(
      /9072000 buckets before/,
    );
  });
});

describe("verifyConfigRouting", () => {
  test("clean when no config row reached the hypertable", async () => {
    const { db } = fakeSql([
      [/from metrics_raw/, [{ n: "0" }]],
      [/from metrics_config_log/, [{ n: "174" }]],
    ]);
    expect(await verifyConfigRouting(replayedOf(db))).toEqual([]);
  });

  test("binds the config keys as placeholders, never as an array literal", async () => {
    const { db, asked } = fakeSql([[/from metrics_raw/, [{ n: "0" }]]]);
    await verifyConfigRouting(replayedOf(db));
    expect(asked[0]?.query).toContain("mk.key in ($1)");
    expect(asked[0]?.values).toEqual(["settings.workmode"]);
  });

  test("a config row in metrics_raw is the finding", async () => {
    const { db } = fakeSql([[/from metrics_raw/, [{ n: "5" }]]]);
    expect((await verifyConfigRouting(replayedOf(db))).join(" ")).toMatch(/5 config rows/);
  });
});

describe("verifyEnergy", () => {
  test("compares the replayed rows against the ground truth and passes when they agree", async () => {
    // The increment across midnight is the cliff day's truth, and the drop back
    // to zero is the one counter restart the ground truth records.
    const { db } = fakeSql([
      [
        /from metrics_raw/,
        [
          { time: "2026-07-27T23:59:00Z", value: 0 },
          { time: "2026-07-28T00:00:00Z", value: CLIFF.energy },
          { time: "2026-07-28T00:01:00Z", value: 0 },
        ],
      ],
    ]);
    expect(await verifyEnergy(replayedOf(db))).toEqual([]);
  });

  test("a replayed series with the wrong energy is the finding", async () => {
    const { db } = fakeSql([
      [
        /from metrics_raw/,
        [
          { time: "2026-07-27T23:59:00Z", value: 0 },
          { time: "2026-07-28T00:00:00Z", value: 99 },
        ],
      ],
    ]);
    expect((await verifyEnergy(replayedOf(db))).join(" ")).toMatch(/before, 99 after/);
  });

  test("a replay that lost the counter entirely is reported, not passed over", async () => {
    const { db } = fakeSql([[/from metrics_raw/, []]]);
    const problems = await verifyEnergy(replayedOf(db));
    expect(problems.join(" ")).toMatch(/missing after/);
    expect(problems.join(" ")).toMatch(/restarts: 1 before, 0 after/);
  });
});

describe("verifySampledRows", () => {
  test("joins source buckets to replayed rows and checks them against the mapping", async () => {
    const { db, asked } = fakeSql([
      [
        /legacy_minute_rollups/,
        [
          {
            bucket: "2026-07-28T12:00:00Z",
            avgValue: 3800.5,
            time: "2026-07-28T12:00:00Z",
            value: 3800.5,
            durMs: 60_000,
          },
        ],
      ],
    ]);
    expect(await verifySampledRows(replayedOf(db))).toEqual([]);
    expect(asked[0]?.values).toEqual([1, "deye-sg05lp3", "total_energy"]);
  });

  test("no joined pair at all is a finding rather than a pass", async () => {
    const { db } = fakeSql([[/legacy_minute_rollups/, []]]);
    expect((await verifySampledRows(replayedOf(db))).join(" ")).toMatch(/no bucket\/row pairs/);
  });
});

describe("replay", () => {
  /** The replay client's own double: enough for runReplay to plan two days. */
  const client = (rows: number) => {
    const seen: string[] = [];
    return {
      seen,
      client: {
        async query(text: string, values?: readonly unknown[]) {
          seen.push(text.trim().split("\n")[0]?.trim() ?? "");
          if (text.includes("min(b."))
            return { rows: [{ from: "2026-07-01T00:00:00Z", to: "2026-07-01T23:59:00Z" }] };
          if (text.includes("insert into metrics_raw")) return { rows: [{ n: String(rows) }] };
          if (text.includes("select chunk_start") && seen.filter((t) => t === "commit").length > 0)
            return { rows: [{ chunk_start: "2026-07-01T00:00:00Z" }] };
          void values;
          return { rows: [] };
        },
      },
    };
  };

  test("runs the span and finds nothing wrong when the re-run is a no-op", async () => {
    const { client: c } = client(155_520);
    expect(await replay(c, OPTS, { sourceId: "deye-sg05lp3", deviceId: 1 }, [])).toEqual([]);
  });

  test("reports a re-run that wrote rows — that would be a double insert", async () => {
    // This double never records a completed chunk, so the second run replays
    // the same day again: exactly the failure the watermark exists to prevent.
    const seen: string[] = [];
    const c = {
      async query(text: string) {
        seen.push(text);
        if (text.includes("min(b."))
          return { rows: [{ from: "2026-07-01T00:00:00Z", to: "2026-07-01T23:59:00Z" }] };
        if (text.includes("insert into metrics_raw")) return { rows: [{ n: "10" }] };
        return { rows: [] };
      },
    };
    expect((await replay(c, OPTS, { sourceId: "x", deviceId: 1 }, [])).join(" ")).toMatch(
      /not a no-op/,
    );
  });
});

describe("report", () => {
  /** `report` writes the findings for an operator; the suite does not need them. */
  const quiet = async (run: () => number | Promise<number>) => {
    const real = console.error;
    console.error = () => {};
    try {
      return await run();
    } finally {
      console.error = real;
    }
  };

  test("no findings is exit 0", async () => {
    expect(await quiet(() => report([]))).toBe(0);
  });

  test("any finding is exit 1", async () => {
    expect(await quiet(() => report(["something drifted"]))).toBe(1);
  });

  test("a flood of findings is truncated rather than printed in full", async () => {
    const lines: string[] = [];
    const real = console.error;
    console.error = (line: string) => lines.push(line);
    try {
      expect(report(Array.from({ length: 100 }, (_, i) => `finding ${i}`))).toBe(1);
    } finally {
      console.error = real;
    }
    expect(lines).toHaveLength(41);
    expect(lines.at(-1)).toMatch(/60 more/);
  });
});

describe("main", () => {
  test("--help prints the help and succeeds without touching a database", async () => {
    const real = console.log;
    const lines: string[] = [];
    console.log = (line: string) => lines.push(line);
    try {
      expect(await main(["--help"])).toBe(0);
    } finally {
      console.log = real;
    }
    expect(lines.join(" ")).toMatch(/replay-rehearsal\.ts/);
  });

  test("a bad argument becomes an exit code, not an unhandled rejection", async () => {
    const real = console.error;
    console.error = () => {};
    try {
      expect(await main(["--nonsense"])).toBe(1);
    } finally {
      console.error = real;
    }
  });
});
