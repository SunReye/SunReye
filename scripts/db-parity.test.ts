import { describe, expect, test } from "bun:test";
import {
  SIDE_TABLES,
  SNAPSHOT_SQL,
  buildSnapshotSql,
  type Snapshot,
  compareSnapshots,
  rollupKey,
} from "./db-parity";

/** A snapshot with one bucket per rollup and one row in every side table. */
function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  const bucket = "2026-08-01T00:00:00Z";
  // The int2 identity, as of 2.0.0. It was `inverterId: "deye-sg05lp3"` — a
  // PROFILE id — which is the bug the re-key fixed.
  const row = { bucket, deviceId: 1, metricId: 7, avg: 1.5, max: 3, min: 0 };
  return {
    rollups: {
      minute_rollups: [{ ...row }],
      hourly_rollups: [{ ...row }],
      daily_rollups: [{ ...row }],
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
  tables: {},
  digests: {},
  rawRows: 0,
  compressedChunks: 0,
  policies: [],
};

describe("rollupKey", () => {
  test("keys a row by bucket, device and metric so order cannot matter", () => {
    const row = snapshot().rollups.minute_rollups[0]!;
    expect(rollupKey(row)).toBe("2026-08-01T00:00:00Z|1|7");
  });

  test("two devices reporting the same metric in the same bucket are different rows", () => {
    // The whole point of the re-key: under the profile id these two collided
    // into one series, and one silently overwrote the other's history.
    const a = snapshot().rollups.minute_rollups[0]!;
    expect(rollupKey({ ...a, deviceId: 2 })).not.toBe(rollupKey(a));
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
    expect(problems).toContain("2026-08-01T00:00:00Z|1|7");
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
 * 1.x's second aggregate family — `weighted_*_rollups`, and the migration gate
 * that compared it against the unweighted originals — is gone from this file
 * along with the aggregates themselves. 2.0.0 collapsed both generations into one
 * that is right from birth (`packages/db/src/timescale/0000_baseline.sql`), so
 * there is no shadow family for a parity check to reconcile and no per-bucket
 * source preference to prove correct.
 *
 * What replaced those tests, and is more important than any of them: the
 * dimension tables are now in {@link SIDE_TABLES}. A restore that brought back
 * every rollup bucket and lost `devices` or `metric_keys` would leave every
 * bucket naming an integer that resolves to nothing — and a parity check keyed on
 * ids alone cannot see that, which is exactly why the digests are checked too.
 */
describe("the dimension spine is part of parity", () => {
  test("every dimension table is a side table whose loss is caught", () => {
    for (const table of ["plants", "connections", "devices", "batteries", "metric_keys"]) {
      expect(SIDE_TABLES as readonly string[]).toContain(table);
    }
  });

  test("losing the devices table is a mismatch, not a silent success", () => {
    const before = snapshot({ tables: { devices: 2 }, digests: { devices: "d1" } });
    const after = snapshot({ tables: {}, digests: {} });
    const problems = compareSnapshots(before, after, { expectRawLoss: false }).join("\n");
    expect(problems).toContain("devices");
  });

  test("devices coming back with different CONTENT is a mismatch even at the same count", () => {
    // The failure that matters: two rows restored, but the slugs or profile ids
    // rebound to different ids, so every reading changes meaning.
    const before = snapshot({ tables: { devices: 2 }, digests: { devices: "d1" } });
    const after = snapshot({ tables: { devices: 2 }, digests: { devices: "d2" } });
    expect(compareSnapshots(before, after, { expectRawLoss: false }).join("\n")).toContain(
      "content digest",
    );
  });
});

/**
 * A pre-2.0.0 database is missing tables the current schema has (`spot_prices`,
 * `forecast_correction_cells` do not exist in addon 1.2.0 at all), so the
 * snapshot has to be *takeable* on the old side — a snapshot that cannot be
 * taken proves nothing, and the pre-migration one is the only irreplaceable one.
 * An absent table therefore snapshots as null, and null carries the meaning
 * "there was nothing here to compare", not "zero rows".
 */
describe("absent side tables", () => {
  test("a table absent before the migration is not compared, and may appear after", () => {
    const before = snapshot({
      tables: { app_settings: 4, spot_prices: null },
      digests: { app_settings: "a1", spot_prices: null },
    });
    const after = snapshot({
      tables: { app_settings: 4, spot_prices: 17 },
      digests: { app_settings: "a1", spot_prices: "z9" },
    });
    expect(compareSnapshots(before, after, { expectRawLoss: false })).toEqual([]);
  });

  test("a table that was there before and is absent after is a finding", () => {
    const before = snapshot({ tables: { app_settings: 4 }, digests: { app_settings: "a1" } });
    const after = snapshot({ tables: { app_settings: null }, digests: { app_settings: null } });
    expect(compareSnapshots(before, after, { expectRawLoss: false }).join(" ")).toMatch(
      /app_settings.*missing/,
    );
  });

  test("an absent table is still not the same as an empty one", () => {
    const before = snapshot({ tables: { app_settings: 0 }, digests: { app_settings: "e0" } });
    const after = snapshot({ tables: { app_settings: null }, digests: { app_settings: "e0" } });
    expect(compareSnapshots(before, after, { expectRawLoss: false }).length).toBeGreaterThan(0);
  });

  test("the snapshot SQL guards every side table, so a missing one cannot fail the query", () => {
    for (const table of SIDE_TABLES) {
      expect(SNAPSHOT_SQL).toContain(`to_regclass('public."${table}"')`);
    }
  });
});

/**
 * The rollup arrays are the whole point of a restore comparison and completely
 * infeasible for a two-month fixture: 60 days of per-minute buckets across 105
 * metrics is 9.07 M rows, and `json_agg`-ing them into one value is an
 * out-of-memory error, which is exactly how it was found.
 */
describe("buildSnapshotSql", () => {
  test("the default snapshot still aggregates every bucket", () => {
    const sql = buildSnapshotSql();
    expect(sql).toBe(SNAPSHOT_SQL);
    expect(sql).toContain("FROM minute_rollups) r");
  });

  test("without rollups the tiers are present but empty, so the shape is unchanged", () => {
    const sql = buildSnapshotSql({ includeRollups: false });
    expect(sql).not.toContain("FROM minute_rollups) r");
    for (const tier of ["minute_rollups", "hourly_rollups", "daily_rollups"]) {
      expect(sql).toContain(`'${tier}', '[]'::json`);
    }
    // The parts that are cheap at any scale must still be there.
    expect(sql).toContain("compressedChunks");
    expect(sql).toContain("timescaledb_information.jobs");
    expect(sql).toContain(`to_regclass('public."app_settings"')`);
  });

  test("the weighted views are dropped too — they are the same unbounded shape", () => {
    const sql = buildSnapshotSql({ includeRollups: false });
    expect(sql).not.toContain("weighted_sum / nullif");
  });
});
