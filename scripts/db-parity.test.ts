import { describe, expect, test } from "bun:test";
import {
  type Snapshot,
  type WeightedRollupName,
  compareSnapshots,
  rollupKey,
  weightedMatchesLegacy,
} from "./db-parity";

/** A snapshot with one bucket per rollup and one row in every side table. */
function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  const bucket = "2026-08-01T00:00:00Z";
  const row = { bucket, inverterId: "inv1", metric: "pv_power", avg: 1.5, max: 3, min: 0 };
  return {
    rollups: {
      minute_rollups: [{ ...row }],
      hourly_rollups: [{ ...row }],
      daily_rollups: [{ ...row }],
    },
    weightedRollups: {
      weighted_minute_rollups: [],
      weighted_hourly_rollups: [],
      weighted_daily_rollups: [],
    },
    tables: { app_settings: 4, user: 1, tariffs: 2, installed_profiles: 1 },
    digests: { app_settings: "a1", user: "b2", tariffs: "c3", installed_profiles: "d4" },
    rawRows: 700_000,
    compressedChunks: 6,
    policies: [
      "policy_refresh_continuous_aggregate:minute_rollups",
      "policy_compression:metrics_raw",
    ],
    ...overrides,
  };
}

const EMPTY: Snapshot = {
  rollups: { minute_rollups: [], hourly_rollups: [], daily_rollups: [] },
  weightedRollups: {
    weighted_minute_rollups: [],
    weighted_hourly_rollups: [],
    weighted_daily_rollups: [],
  },
  tables: {},
  digests: {},
  rawRows: 0,
  compressedChunks: 0,
  policies: [],
};

describe("rollupKey", () => {
  test("keys a row by bucket, inverter and metric so order cannot matter", () => {
    const row = snapshot().rollups.minute_rollups[0]!;
    expect(rollupKey(row)).toBe("2026-08-01T00:00:00Z|inv1|pv_power");
  });
});

describe("compareSnapshots", () => {
  test("an identical full-mode restore reports no mismatch", () => {
    expect(compareSnapshots(snapshot(), snapshot(), { expectRawLoss: false })).toEqual([]);
  });

  test("row order in a rollup is irrelevant", () => {
    const extra = {
      bucket: "2026-08-02T00:00:00Z",
      inverterId: "inv1",
      metric: "pv_power",
      avg: 2,
      max: 4,
      min: 1,
    };
    const before = snapshot();
    before.rollups.minute_rollups = [before.rollups.minute_rollups[0]!, { ...extra }];
    const after = snapshot();
    after.rollups.minute_rollups = [{ ...extra }, after.rollups.minute_rollups[0]!];
    expect(compareSnapshots(before, after, { expectRawLoss: false })).toEqual([]);
  });

  test("a missing rollup bucket is reported per rollup and per key", () => {
    const after = snapshot({ rollups: { ...snapshot().rollups, hourly_rollups: [] } });
    const problems = compareSnapshots(snapshot(), after, { expectRawLoss: false }).join("\n");
    expect(problems).toContain("hourly_rollups");
    expect(problems).toContain("2026-08-01T00:00:00Z|inv1|pv_power");
  });

  test("a drifted rollup value is reported even when the row counts match", () => {
    const after = snapshot();
    after.rollups.daily_rollups[0]!.avg = 1.6;
    const problems = compareSnapshots(snapshot(), after, { expectRawLoss: false }).join("\n");
    expect(problems).toContain("daily_rollups");
    expect(problems).toContain("avg");
  });

  test("float noise below the epsilon is not a mismatch", () => {
    const after = snapshot();
    after.rollups.daily_rollups[0]!.avg = 1.5 + 1e-12;
    expect(compareSnapshots(snapshot(), after, { expectRawLoss: false })).toEqual([]);
  });

  test("a null metric value on one side only is a mismatch", () => {
    const after = snapshot();
    after.rollups.minute_rollups[0]!.min = null;
    expect(compareSnapshots(snapshot(), after, { expectRawLoss: false }).join("\n")).toContain(
      "min",
    );
  });

  test("null on both sides is parity", () => {
    const before = snapshot();
    before.rollups.minute_rollups[0]!.min = null;
    const after = snapshot();
    after.rollups.minute_rollups[0]!.min = null;
    expect(compareSnapshots(before, after, { expectRawLoss: false })).toEqual([]);
  });

  test("a differing side-table row count is reported", () => {
    const after = snapshot({ tables: { ...snapshot().tables, tariffs: 1 } });
    expect(compareSnapshots(snapshot(), after, { expectRawLoss: false }).join("\n")).toContain(
      "tariffs",
    );
  });

  test("a side table missing entirely after restore is reported", () => {
    const tables = { ...snapshot().tables };
    delete tables.installed_profiles;
    expect(
      compareSnapshots(snapshot(), snapshot({ tables }), { expectRawLoss: false }).join("\n"),
    ).toContain("installed_profiles");
  });

  test("equal counts but a differing content digest is reported", () => {
    const after = snapshot({ digests: { ...snapshot().digests, app_settings: "zz" } });
    expect(compareSnapshots(snapshot(), after, { expectRawLoss: false }).join("\n")).toContain(
      "app_settings",
    );
  });

  test("a continuous-aggregate policy missing after restore is reported", () => {
    const after = snapshot({ policies: ["policy_compression:metrics_raw"] });
    expect(compareSnapshots(snapshot(), after, { expectRawLoss: false }).join("\n")).toContain(
      "policy_refresh_continuous_aggregate:minute_rollups",
    );
  });

  test("an extra policy after restore is not a failure", () => {
    const after = snapshot({ policies: [...snapshot().policies, "policy_retention:metrics_raw"] });
    expect(compareSnapshots(snapshot(), after, { expectRawLoss: false })).toEqual([]);
  });

  test("full mode: lost raw rows are a failure", () => {
    expect(
      compareSnapshots(snapshot(), snapshot({ rawRows: 0 }), { expectRawLoss: false }).join("\n"),
    ).toContain("raw");
  });

  test("full mode: a lost compressed chunk is a failure", () => {
    expect(
      compareSnapshots(snapshot(), snapshot({ compressedChunks: 0 }), {
        expectRawLoss: false,
      }).join("\n"),
    ).toContain("compressed");
  });

  test("excluded mode: raw rows are expected to be zero and that is not a failure", () => {
    const after = snapshot({ rawRows: 0, compressedChunks: 0 });
    expect(compareSnapshots(snapshot(), after, { expectRawLoss: true })).toEqual([]);
  });

  test("excluded mode: raw rows surviving means the exclusion silently stopped working", () => {
    expect(compareSnapshots(snapshot(), snapshot(), { expectRawLoss: true }).join("\n")).toContain(
      "expected the raw window to be empty",
    );
  });

  test("excluded mode still requires every rollup bucket", () => {
    const after = snapshot({ rawRows: 0, rollups: { ...snapshot().rollups, minute_rollups: [] } });
    expect(compareSnapshots(snapshot(), after, { expectRawLoss: true }).join("\n")).toContain(
      "minute_rollups",
    );
  });

  test("an empty database on both sides is parity", () => {
    expect(compareSnapshots(EMPTY, EMPTY, { expectRawLoss: false })).toEqual([]);
  });

  test("with requireData, a fixture that never produced rollup rows fails loudly", () => {
    expect(
      compareSnapshots(EMPTY, EMPTY, { expectRawLoss: false, requireData: true }).join("\n"),
    ).toContain("no rollup rows");
  });

  test("with requireData, a fixture with no compressed chunk fails loudly", () => {
    const before = snapshot({ compressedChunks: 0 });
    expect(
      compareSnapshots(before, snapshot({ compressedChunks: 0 }), {
        expectRawLoss: false,
        requireData: true,
      }).join("\n"),
    ).toContain("no compressed chunk");
  });
});

/**
 * The weighted aggregates (#116) enter the snapshot for two separate jobs.
 *
 * 1. Restore parity: they hold materialized buckets like any other aggregate, so
 *    a dump that loses them is a data loss the restore gate must catch.
 * 2. The migration gate: applying the weighted-rollup migration to a database
 *    that already holds more than 7 days of history must leave every legacy
 *    bucket byte-identical (a recreate is forbidden — see 0000_bootstrap.sql)
 *    while the weighted side legitimately appears from nothing.
 */
const WEIGHTED: readonly WeightedRollupName[] = [
  "weighted_minute_rollups",
  "weighted_hourly_rollups",
  "weighted_daily_rollups",
];

/** A snapshot whose weighted aggregates mirror the legacy ones bucket for bucket. */
function weighted(overrides: Partial<Snapshot> = {}): Snapshot {
  const base = snapshot();
  return {
    ...base,
    weightedRollups: {
      weighted_minute_rollups: base.rollups.minute_rollups.map((r) => ({ ...r })),
      weighted_hourly_rollups: base.rollups.hourly_rollups.map((r) => ({ ...r })),
      weighted_daily_rollups: base.rollups.daily_rollups.map((r) => ({ ...r })),
    },
    ...overrides,
  };
}

/** The same snapshot as `weighted()` but with no weighted buckets at all. */
const noWeighted = (): Snapshot =>
  weighted({
    weightedRollups: {
      weighted_minute_rollups: [],
      weighted_hourly_rollups: [],
      weighted_daily_rollups: [],
    },
  });

describe("compareSnapshots — weighted aggregates in a restore", () => {
  test("an identical restore of a database holding weighted buckets is parity", () => {
    expect(compareSnapshots(weighted(), weighted(), { expectRawLoss: false })).toEqual([]);
  });

  test("a lost weighted bucket is a mismatch, named by its aggregate", () => {
    const after = weighted({
      weightedRollups: { ...weighted().weightedRollups, weighted_hourly_rollups: [] },
    });
    expect(compareSnapshots(weighted(), after, { expectRawLoss: false }).join("\n")).toContain(
      "weighted_hourly_rollups",
    );
  });

  test("a drifted weighted average is a mismatch even when the counts match", () => {
    const after = weighted();
    after.weightedRollups.weighted_daily_rollups[0]!.avg = 99;
    expect(compareSnapshots(weighted(), after, { expectRawLoss: false }).join("\n")).toContain(
      "weighted_daily_rollups",
    );
  });

  test("a snapshot taken before the migration (no weighted views) is still comparable", () => {
    expect(compareSnapshots(noWeighted(), noWeighted(), { expectRawLoss: false })).toEqual([]);
  });
});

describe("compareSnapshots — the migration gate", () => {
  test("weighted buckets appearing from nothing is expected, and legacy parity still required", () => {
    expect(
      compareSnapshots(noWeighted(), weighted(), {
        expectRawLoss: false,
        expectWeightedBackfill: true,
      }),
    ).toEqual([]);
  });

  test("a migration that recreated a legacy aggregate is still caught", () => {
    // This is the constraint the whole design exists to respect: metrics_raw has
    // 7-day retention, so a drop/recreate can only re-materialize the last 7
    // days and silently destroys every older bucket.
    const after = weighted({ rollups: { ...weighted().rollups, hourly_rollups: [] } });
    expect(
      compareSnapshots(noWeighted(), after, {
        expectRawLoss: false,
        expectWeightedBackfill: true,
      }).join("\n"),
    ).toContain("hourly_rollups");
  });

  test("a legacy value that drifted by more than float noise is caught", () => {
    const after = weighted();
    after.rollups.minute_rollups[0]!.avg = 1.5000001;
    expect(
      compareSnapshots(noWeighted(), after, {
        expectRawLoss: false,
        expectWeightedBackfill: true,
      }).join("\n"),
    ).toContain("minute_rollups");
  });

  test("compression running during the migration is expected — #134 arms policies that had none", () => {
    // hourly_rollups and daily_rollups had no compression configuration at all,
    // so applying the migration legitimately compresses chunks that were never
    // compressible before. A *gain* is the point of the change.
    const after = weighted({ compressedChunks: 11 });
    expect(
      compareSnapshots(noWeighted(), after, {
        expectRawLoss: false,
        expectWeightedBackfill: true,
      }),
    ).toEqual([]);
  });

  test("losing a compressed chunk is still a failure, migration or not", () => {
    const after = weighted({ compressedChunks: 1 });
    expect(
      compareSnapshots(noWeighted(), after, {
        expectRawLoss: false,
        expectWeightedBackfill: true,
      }).join("\n"),
    ).toContain("compressed");
  });

  test("a migration that created the views but materialized nothing fails loudly", () => {
    // Otherwise the gate is trivially green: no weighted rows means nothing was
    // proved about the weighting, and the read cutover would silently serve the
    // legacy side forever.
    expect(
      compareSnapshots(noWeighted(), noWeighted(), {
        expectRawLoss: false,
        expectWeightedBackfill: true,
      }).join("\n"),
    ).toContain("no weighted");
  });
});

describe("weightedMatchesLegacy", () => {
  /**
   * The safety property of the whole migration: while every `dur_ms` is NULL the
   * aggregates read `coalesce(dur_ms, 1)`, so the weighted mean is *exactly* the
   * legacy plain mean. Any bucket where the two disagree, over unweighted data,
   * is a bug in the aggregate definition — and it is checked per bucket rather
   * than in aggregate, because a compensating pair of errors would cancel.
   */
  test("mirrored aggregates agree on every shared bucket", () => {
    expect(weightedMatchesLegacy(weighted())).toEqual([]);
  });

  test("a disagreeing bucket is reported with both values", () => {
    const s = weighted();
    s.weightedRollups.weighted_hourly_rollups[0]!.avg = 2.5;
    const problems = weightedMatchesLegacy(s).join("\n");
    expect(problems).toContain("2.5");
    expect(problems).toContain("1.5");
  });

  test("float noise below the epsilon is not a disagreement", () => {
    const s = weighted();
    s.weightedRollups.weighted_hourly_rollups[0]!.avg = 1.5 + 1e-12;
    expect(weightedMatchesLegacy(s)).toEqual([]);
  });

  test("a bucket the weighted side does not reach is not compared — that is the whole design", () => {
    // The weighted aggregate can only be materialized as far back as metrics_raw
    // reaches. A year-old bucket exists only in the legacy view, and its absence
    // from the weighted view is correct, not a mismatch.
    expect(weightedMatchesLegacy(noWeighted())).toEqual([]);
  });

  test("a weighted bucket with no legacy counterpart is reported", () => {
    // The legacy aggregates are still refreshed, so the weighted side can never
    // hold a bucket the legacy side does not. If it does, one of the two refresh
    // policies has stopped running.
    const s = weighted();
    s.rollups.daily_rollups = [];
    expect(weightedMatchesLegacy(s).join("\n")).toContain("weighted_daily_rollups");
  });

  test("a NULL weighted average is a disagreement with a real legacy one", () => {
    // `nullif(weight, 0)` produces NULL for a degenerate bucket. Over unweighted
    // data every weight is the row count, which is never 0 for a bucket that
    // exists, so a NULL here means the weight column stopped being summed.
    const s = weighted();
    s.weightedRollups.weighted_minute_rollups[0]!.avg = null;
    expect(weightedMatchesLegacy(s).join("\n")).toContain("weighted_minute_rollups");
  });

  test("every tier is checked, not just the first that happens to match", () => {
    const s = weighted();
    for (const name of WEIGHTED) s.weightedRollups[name][0]!.avg = 42;
    expect(weightedMatchesLegacy(s)).toHaveLength(WEIGHTED.length);
  });
});
