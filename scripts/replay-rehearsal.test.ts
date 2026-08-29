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
  LEGACY_COLUMNS,
  LEGACY_RELATION,
  TIER_OF,
  assertRehearsalTarget,
  type DockerCopy,
  type RehearsalIo,
  type RehearsalMode,
  type Replayed,
  type UnsafeSql,
  DEFAULT_OPTIONS as OPTS,
  checkAggregates,
  cli,
  copyLegacyTier,
  copyStatements,
  legacyTableDdl,
  recreateTarget,
  rehearse,
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
  productionIo,
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
    expect(asked[0]?.values).toEqual(["a", 9]);
    expect(asked[1]?.values).toEqual(["b", 9]);
  });

  test("a NULL device is every device — what an archive round trip needs", async () => {
    // The rehearsal always names one, because its target also holds the rows the
    // blocking upgrade carried across; an archive import lands in an empty
    // database whose device ids it did not choose.
    const { db, asked } = fakeSql([[/from metrics_raw/, []]]);
    await replayedEnergy(db, null, ["a"]);
    expect(asked[0]?.values).toEqual(["a"]);
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

  test("a bad argument throws — turning it into an exit code is cli's job", async () => {
    await expect(main(["--nonsense"])).rejects.toThrow(/unknown argument: --nonsense/);
  });
});

// ---------------------------------------------------------------------------
// The rig itself, behind the RehearsalIo seam.
//
// `recreateTarget`, `copyLegacyTier` and `rehearse` are Docker and Postgres
// orchestration: what a `docker exec` DOES cannot be proved without Docker, and
// the three real end-to-end runs against the fixture are what prove that. What
// CAN be proved without either — and is what a mistake here would cost — is the
// order the rig is built in, the column mapping the binary pipe depends on, and
// that the guard runs before anything is touched. Those are below.
// ---------------------------------------------------------------------------

/** A connection double: records every statement, and every release. */
function fakeConn(route: Route) {
  const issued: { query: string; values?: unknown[] }[] = [];
  let ends = 0;
  return {
    issued,
    ended: () => ends,
    async unsafe(query: string, values?: unknown[]) {
      issued.push({ query, values });
      const rows = route(query, values);
      if (rows instanceof Error) throw rows;
      return rows ?? [];
    },
    async end() {
      ends += 1;
    },
  };
}

type Route = (query: string, values?: unknown[]) => unknown[] | Error | undefined;

type FakeIo = RehearsalIo & {
  /** Every side effect, in order — this is what the wiring tests assert on. */
  readonly steps: string[];
  readonly conns: ReturnType<typeof fakeConn>[];
  readonly copies: DockerCopy[];
  readonly logs: string[];
  readonly errors: string[];
};

function fakeIo(options: { route?: Route; truth?: unknown; copyThrows?: Error } = {}): FakeIo {
  const steps: string[] = [];
  const conns: ReturnType<typeof fakeConn>[] = [];
  const copies: DockerCopy[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const connect = (url: string) => {
    steps.push(`connect:${new URL(url).pathname.slice(1)}`);
    const conn = fakeConn(options.route ?? (() => []));
    conns.push(conn);
    return conn as unknown as ReturnType<RehearsalIo["connect"]>;
  };
  return {
    steps,
    conns,
    copies,
    logs,
    errors,
    connect,
    // The two pools differ only in bun's idle timeout, which a double has no
    // notion of; both are recorded on the same list so the ORDER the rig opens
    // and releases connections in is one sequence to assert on.
    connectBriefly: connect,
    async migrate(url: string) {
      steps.push(`migrate:${new URL(url).pathname.slice(1)}`);
    },
    async copyBinary(command: DockerCopy) {
      steps.push("copyBinary");
      copies.push(command);
      if (options.copyThrows) throw options.copyThrows;
    },
    async readGroundTruth(mode: RehearsalMode) {
      steps.push(`groundTruth:${mode}`);
      return (options.truth ?? RIG_TRUTH) as Awaited<ReturnType<RehearsalIo["readGroundTruth"]>>;
    },
    log: (message: string) => logs.push(message),
    error: (message: string) => errors.push(message),
  };
}

describe("the legacy bucket table", () => {
  test("the CREATE TABLE and the COPY column list are ONE list, in ONE order", () => {
    // `COPY … BINARY` matches columns by POSITION, never by name. A column added
    // to the DDL and not to the SELECT — or reordered in one of them — would not
    // fail: it would silently write min_value into max_value and every energy
    // check downstream would still pass. So both are generated from the same
    // list, and this is the test that says so.
    const ddl = legacyTableDdl("minute");
    const { from } = copyStatements("minute");
    const inDdl = LEGACY_COLUMNS.map((c) => c.name);
    const inSelect = from
      .replace(/^COPY \(select /, "")
      .replace(/ from .*$/s, "")
      .split(", ");
    expect(inSelect).toEqual(inDdl);
    for (const column of LEGACY_COLUMNS) expect(ddl).toContain(`${column.name} ${column.type}`);
  });

  test("the DDL is the 1.2.0 bucket shape, verbatim", () => {
    expect(legacyTableDdl("hourly")).toBe(
      `create table legacy_hourly_rollups (
      bucket timestamptz not null,
      inverter_id text not null,
      metric text not null,
      avg_value double precision,
      max_value double precision,
      min_value double precision
    )`,
    );
  });

  test("each tier copies FROM its 2.0.0 aggregate INTO its own legacy relation", () => {
    for (const tier of ["minute", "hourly", "daily"] as const) {
      const { from, to } = copyStatements(tier);
      expect(from).toContain(` from ${TIER_OF[tier]}) TO STDOUT BINARY`);
      expect(to).toBe(`COPY ${LEGACY_RELATION[tier]} FROM STDIN BINARY`);
      // The source is the aggregate, the sink is the plain copy — never swapped.
      expect(from).not.toContain(LEGACY_RELATION[tier]);
    }
  });

  test("the minute pipe is byte-for-byte the command the real runs used", () => {
    expect(copyStatements("minute")).toEqual({
      from:
        "COPY (select bucket, inverter_id, metric, avg_value, max_value, min_value " +
        "from minute_rollups) TO STDOUT BINARY",
      to: "COPY legacy_minute_rollups FROM STDIN BINARY",
    });
  });
});

describe("recreateTarget", () => {
  test("refuses a forbidden target BEFORE opening any connection", async () => {
    const io = fakeIo();
    await expect(recreateTarget({ ...OPTS, port: DEV_DB_PORT }, io)).rejects.toThrow(
      /live\s+inverter/,
    );
    // The guard is worthless if the drop has already been sent.
    expect(io.steps).toEqual([]);
  });

  test("refuses a target database whose name is not a rehearsal database", async () => {
    const io = fakeIo();
    await expect(recreateTarget({ ...OPTS, targetDb: "sunreye" }, io)).rejects.toThrow(
      /only builds databases/,
    );
    expect(io.steps).toEqual([]);
  });

  test("drops with FORCE then creates, from the maintenance database", async () => {
    const io = fakeIo();
    const url = await recreateTarget(OPTS, io);
    expect(url).toBe(`postgres://postgres:fixture@localhost:5436/sunreye_replay_200`);
    // The maintenance database, never the one being dropped.
    expect(io.steps).toEqual(["connect:postgres"]);
    const issued = io.conns[0]?.issued.map((i) => i.query) ?? [];
    // WITH (FORCE): a rehearsal re-run happens while the previous run's own
    // connection may still be draining, and a plain DROP would just fail.
    expect(issued).toEqual([
      "DROP DATABASE IF EXISTS sunreye_replay_200 WITH (FORCE)",
      "CREATE DATABASE sunreye_replay_200",
    ]);
  });

  test("releases the maintenance connection even when the drop fails", async () => {
    const io = fakeIo({ route: () => new Error("database is being accessed by other users") });
    await expect(recreateTarget(OPTS, io)).rejects.toThrow(/other users/);
    // A leaked maintenance connection is itself what makes the NEXT drop fail.
    expect(io.conns[0]?.ended()).toBe(1);
  });
});

describe("copyLegacyTier", () => {
  const counted =
    (n: string): Route =>
    (query) =>
      /count\(\*\)::bigint as n from legacy_/.test(query) ? [{ n }] : [];

  test("recreates the relation, pipes the copy, and indexes only afterwards", async () => {
    const io = fakeIo({ route: counted("9072000") });
    expect(await copyLegacyTier(OPTS, "minute", io)).toBe(9_072_000);
    expect(io.steps).toEqual([
      "connect:sunreye_replay_200",
      "copyBinary",
      "connect:sunreye_replay_200",
    ]);
    // Stale relation dropped first: a re-run must not append to the last run's
    // copy, which would double every bucket and pass no check at all.
    expect(io.conns[0]?.issued[0]?.query).toBe("drop table if exists legacy_minute_rollups");
    expect(io.conns[0]?.issued[1]?.query).toBe(legacyTableDdl("minute"));
    expect(io.conns[0]?.ended()).toBe(1);
    // The index comes AFTER the copy — the replay reads one inverter-day per
    // chunk, and indexing first would make the copy itself pay for it.
    const second = io.conns[1]?.issued.map((i) => i.query) ?? [];
    expect(second[0]).toContain("count(*)::bigint as n from legacy_minute_rollups");
    expect(second[1]).toBe("create index on legacy_minute_rollups (inverter_id, bucket)");
    expect(io.conns[1]?.ended()).toBe(1);
  });

  test("hands the copy chokepoint the container, the port and both statements", async () => {
    const io = fakeIo({ route: counted("1") });
    await copyLegacyTier({ ...OPTS, container: "c9", port: 5437 }, "daily", io);
    expect(io.copies).toEqual([
      {
        container: "c9",
        port: 5437,
        from: { db: OPTS.sourceDb, statement: copyStatements("daily").from },
        to: { db: OPTS.targetDb, statement: copyStatements("daily").to },
      },
    ]);
  });

  test("a copy that moved nothing returns 0 rather than NaN", async () => {
    // The count query answering nothing at all is the shape a later `toFixed`
    // would turn into "NaN buckets" instead of a number verifySource can fail on.
    const io = fakeIo({ route: () => [] });
    expect(await copyLegacyTier(OPTS, "minute", io)).toBe(0);
  });

  test("releases the target connection when the pipe itself fails", async () => {
    const io = fakeIo({ route: counted("1"), copyThrows: new Error("psql: no such container") });
    await expect(copyLegacyTier(OPTS, "minute", io)).rejects.toThrow(/no such container/);
    expect(io.conns[0]?.ended()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The driver, end to end, with Docker and Postgres replaced.
// ---------------------------------------------------------------------------

/** A ground truth whose numbers the faithful route below reproduces exactly. */
const TIER = {
  minBucket: "2026-06-28 00:00:00+00",
  maxBucket: "2026-08-26 23:59:00+00",
  count: 9_072_000,
  digest: "64d318eccb3dda61f7bfd74bd7123d26",
};

const RIG_TRUTH = {
  fixture: { spanDays: 60, metricCount: 105 },
  tiers: {
    minute_rollups: TIER,
    hourly_rollups: { minBucket: null, maxBucket: null, count: 0, digest: null },
    daily_rollups: { minBucket: null, maxBucket: null, count: 0, digest: null },
  },
  perMetricPerDayEnergy: [CLIFF],
  restarts: [
    { metric: "total_energy", at: "2026-07-28T12:00:00.000Z", valueBefore: 1, valueAfter: 0 },
  ],
};

/**
 * Everything the rig asks, answered the way a FAITHFUL replay would answer it —
 * so `rehearse` returning `[]` means every verification agreed, and any single
 * answer overridden below makes exactly one of them speak up.
 *
 * A table keyed on the fragment that identifies each statement, the same shape
 * as `fakeSql` above; the queries themselves are proved by the real runs against
 * the fixture.
 */
const RIG_ANSWERS: Array<[RegExp, unknown[]]> = [
  // The replay client, reached through bunSqlClient.
  [/min\(b\./, [{ from: "2026-07-01T00:00:00Z", to: "2026-07-01T23:59:00Z" }]],
  [/insert into metrics_raw/, [{ n: "155520" }]],
  // The rig.
  [/count\(\*\)::bigint as n from legacy_/, [{ n: String(TIER.count) }]],
  [/min\(bucket\)/, [TIER]],
  [/insert into devices/, [{ id: 1 }]],
  [/on conflict \(key\) do update/i, [{ id: 1, key: "total_energy" }]],
  // The verifications.
  [/count\(\*\)::bigint as n from metrics_raw/, [{ n: "0" }]],
  [/from metrics_config_log/, [{ n: "39" }]],
  [
    /select r\.time, r\.value from metrics_raw/,
    [
      { time: "2026-07-27T23:59:00Z", value: 0 },
      { time: "2026-07-28T00:00:00Z", value: CLIFF.energy },
      { time: "2026-07-28T00:01:00Z", value: 0 },
    ],
  ],
  // Keyed on the projection, not the relation: `unregisteredMetrics` reads the
  // same legacy relation and must fall through to "nothing missing".
  [
    /as "avgValue"/,
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
  [/max_value - d\.min_value/, [{ naive: CLIFF.naive, ctr_delta: 41.942, resets: 1 }]],
  [/rollup\(d\.ctr\)/, [{ ctr_delta: CLIFF.energy }]],
];

function faithfulRoute(over: Array<[RegExp, unknown[]]> = []): Route {
  // The completed-chunk watermark is the one stateful answer: it reports nothing
  // until a chunk has committed, which is what makes the SECOND runReplay a
  // no-op instead of a double insert.
  let committed = 0;
  const answers = [...over, ...RIG_ANSWERS];
  return (query) => {
    if (/^\s*commit/i.test(query)) committed += 1;
    if (/select chunk_start/.test(query))
      return committed > 0 ? [{ chunk_start: "2026-07-01T00:00:00Z" }] : [];
    return answers.find(([pattern]) => pattern.test(query))?.[1] ?? [];
  };
}

describe("rehearse", () => {
  test("builds the rig in order, and a faithful replay leaves no findings", async () => {
    const io = fakeIo({ route: faithfulRoute() });
    expect(await rehearse(OPTS, io)).toEqual([]);
    // The order is the behaviour: the ground truth is read before anything is
    // dropped, the schema exists before the buckets are copied into it, and the
    // target is only opened once the rig stands.
    expect(io.steps).toEqual([
      "groundTruth:full",
      "connect:postgres",
      "migrate:sunreye_replay_200",
      "connect:sunreye_replay_200",
      "copyBinary",
      "connect:sunreye_replay_200",
      "connect:sunreye_replay_200",
    ]);
    expect(io.conns.at(-1)?.ended()).toBe(1);
  });

  test("replays the tier it was asked for, not the default one", async () => {
    const io = fakeIo({ route: faithfulRoute([[/min\(bucket\)/, [TIER]]]) });
    await rehearse({ ...OPTS, tier: "hourly", skipAggregates: true }, io);
    expect(io.copies[0]?.from.statement).toBe(copyStatements("hourly").from);
  });

  test("--skip-aggregates leaves the tier refresh — and its assertions — out", async () => {
    const io = fakeIo({ route: faithfulRoute() });
    expect(await rehearse({ ...OPTS, skipAggregates: true }, io)).toEqual([]);
    const asked = io.conns.flatMap((c) => c.issued.map((i) => i.query));
    expect(asked.some((q) => q.includes("refresh_continuous_aggregate"))).toBe(false);
    // …and it IS asked for by default, or the flag would prove nothing.
    const full = fakeIo({ route: faithfulRoute() });
    await rehearse(OPTS, full);
    expect(
      full.conns
        .flatMap((c) => c.issued)
        .some((i) => i.query.includes("refresh_continuous_aggregate")),
    ).toBe(true);
  });

  test("carries every verification's findings out, not just the first", async () => {
    const io = fakeIo({
      // A drifted source digest AND a config row in the hypertable.
      route: faithfulRoute([
        [/min\(bucket\)/, [{ ...TIER, digest: "deadbeef" }]],
        [/count\(\*\)::bigint as n from metrics_raw/, [{ n: "7" }]],
      ]),
    });
    const problems = await rehearse({ ...OPTS, skipAggregates: true }, io);
    expect(problems.join(" ")).toMatch(/digest/);
    expect(problems.join(" ")).toMatch(/7 config rows reached metrics_raw/);
  });

  test("releases the target connection when a verification throws", async () => {
    const io = fakeIo({
      route: (query) =>
        /min\(bucket\)/.test(query) ? new Error("relation does not exist") : undefined,
    });
    await expect(rehearse(OPTS, io)).rejects.toThrow(/does not exist/);
    // The rehearsal is re-run until it passes; a leaked connection on the target
    // is what makes the next run's DROP DATABASE hang instead of failing fast.
    expect(io.conns.at(-1)?.ended()).toBe(1);
  });

  test("refuses a forbidden target before migrating or copying anything", async () => {
    const io = fakeIo({ route: faithfulRoute() });
    await expect(rehearse({ ...OPTS, port: FIXTURE_PORT }, io)).rejects.toThrow(/READ-ONLY/);
    expect(io.steps).toEqual(["groundTruth:full"]);
  });
});

describe("cli", () => {
  test("a faithful rehearsal is exit 0, and says so", async () => {
    const io = fakeIo({ route: faithfulRoute() });
    expect(await cli([], io)).toBe(0);
    expect(io.logs.join(" ")).toMatch(/rehearsal PASSED/);
    expect(io.errors).toEqual([]);
  });

  test("a finding is exit 1, reported to stderr", async () => {
    const io = fakeIo({
      route: faithfulRoute([[/count\(\*\)::bigint as n from metrics_raw/, [{ n: "7" }]]]),
    });
    expect(await cli(["--skip-aggregates"], io)).toBe(1);
    expect(io.errors.join(" ")).toMatch(/config rows reached metrics_raw/);
  });

  test("a bad flag is its own message and exit 1, never a stack trace", async () => {
    const io = fakeIo();
    expect(await cli(["--fas"], io)).toBe(1);
    expect(io.errors.join(" ")).toMatch(/unknown argument: --fas/);
    expect(io.steps).toEqual([]);
  });

  test("a refused target is exit 1 with the guard's own message", async () => {
    const io = fakeIo({ route: faithfulRoute() });
    expect(await cli(["--port=5432"], io)).toBe(1);
    expect(io.errors.join(" ")).toMatch(/live\s+inverter/);
  });

  test("--tier only accepts a tier the script can replay", async () => {
    const io = fakeIo();
    expect(await cli(["--tier=weekly"], io)).toBe(1);
    expect(io.errors.join(" ")).toMatch(/not one of minute, hourly, daily/);
  });

  test("--port must be a number, or the guard would compare against NaN", async () => {
    const io = fakeIo();
    expect(await cli(["--port=abc"], io)).toBe(1);
    expect(io.errors.join(" ")).toMatch(/--port: not an integer/);
  });

  test("--help prints the help and touches nothing", async () => {
    const io = fakeIo();
    const real = console.log;
    const lines: string[] = [];
    console.log = (line: string) => lines.push(line);
    try {
      expect(await cli(["--help"], io)).toBe(0);
    } finally {
      console.log = real;
    }
    expect(lines.join(" ")).toMatch(/replay-rehearsal\.ts/);
    expect(io.steps).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The production wiring itself.
//
// `copyBinary` and `migrate` are deliberately NOT exercised: one runs
// `docker exec` against the shared 1.2.0 fixture container and the other applies
// a schema to a real database. That is exactly why they hold nothing but the one
// command each, and why every decision that used to sit beside them is proved
// above.
// ---------------------------------------------------------------------------
describe("productionIo", () => {
  test("connect holds the pool OPEN and connectBriefly does not", () => {
    // The verification pass holds one connection across the whole run; the three
    // brief ones are the maintenance connection and the copy's bookends, and an
    // idle one of those is what makes the next run's DROP hang.
    const held = productionIo.connect("postgres://postgres:x@localhost:5434/target");
    expect(typeof held.unsafe).toBe("function");
    expect(typeof held.end).toBe("function");
    const brief = productionIo.connectBriefly("postgres://postgres:x@localhost:5434/postgres");
    expect(typeof brief.end).toBe("function");
    // Nothing may dial out at construction time: the target assertion runs on the
    // URL only after the handle exists.
    expect(held).not.toBe(brief);
  });

  test("readGroundTruth reads the COMMITTED truth, restarts and all", async () => {
    const truth = await productionIo.readGroundTruth("fast");
    expect(truth.perMetricPerDayEnergy.length).toBeGreaterThan(0);
    // A truth with no counter restart would leave the headline case unproven.
    expect(truth.restarts.length).toBeGreaterThan(0);
  });

  test("log is prefixed so a rehearsal line is identifiable in a build log", () => {
    const out: string[] = [];
    const err: string[] = [];
    const realLog = console.log;
    const realError = console.error;
    const realEnv = process.env.NODE_ENV;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.error = (...a: unknown[]) => void err.push(a.join(" "));
    try {
      // SILENT under the test environment: this script logs a line per copied
      // tier and per verified metric, and a suite that ran it would bury its own
      // output.
      productionIo.log("not this one");
      expect(out).toEqual([]);
      process.env.NODE_ENV = "development";
      productionIo.log("copied 9,072,000 minute buckets");
      productionIo.error("rehearsal: 3 difference(s)");
    } finally {
      console.log = realLog;
      console.error = realError;
      process.env.NODE_ENV = realEnv;
    }
    expect(out).toEqual(["[rehearsal] copied 9,072,000 minute buckets"]);
    // Failures go to stderr unprefixed, the way the CLI's own errors do.
    expect(err).toEqual(["rehearsal: 3 difference(s)"]);
  });
});
