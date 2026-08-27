import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SIDE_TABLES,
  SNAPSHOT_SQL,
  buildSnapshotSql,
  cli,
  type Snapshot,
  compareSnapshots,
  compareStreamCounts,
  main,
  readSnapshot,
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

// ---------------------------------------------------------------------------
// The CLI: which file is read, which flags reach the comparison, what exit code
// a given pair of snapshots earns. This is the layer a CI job actually invokes,
// so a wrong exit code here is a green build over a broken restore.
// ---------------------------------------------------------------------------

/** Capture what a body writes to the two console streams, and restore them. */
function captureConsole(body: () => number): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const realLog = console.log;
  const realError = console.error;
  console.log = (...args: unknown[]) => void out.push(args.join(" "));
  console.error = (...args: unknown[]) => void err.push(args.join(" "));
  try {
    return { code: body(), out, err };
  } finally {
    console.log = realLog;
    console.error = realError;
  }
}

describe("compareRollup: a bucket that was not there before", () => {
  test("a bucket that appeared out of nowhere after restore is a finding", () => {
    const before = snapshot();
    const after = snapshot();
    after.rollups.minute_rollups = [
      ...after.rollups.minute_rollups,
      { bucket: "2026-08-02T00:00:00Z", deviceId: 1, metricId: 7, avg: 9, max: 9, min: 9 },
    ];
    const problems = compareSnapshots(before, after, { expectRawLoss: false });
    expect(problems).toContain(
      "minute_rollups: bucket appeared out of nowhere after restore: 2026-08-02T00:00:00Z|1|7",
    );
  });
});

describe("readSnapshot", () => {
  test("parses a snapshot written as JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "db-parity-read-"));
    const path = join(dir, "snap.json");
    const snap = snapshot();
    writeFileSync(path, JSON.stringify(snap));
    expect(readSnapshot(path)).toEqual(snap);
  });

  test("a snapshot file that is not there throws rather than reading as empty", () => {
    expect(() => readSnapshot(join(tmpdir(), "db-parity-absent-snapshot.json"))).toThrow();
  });
});

describe("main", () => {
  /** Write a before/after pair to disk and return their paths. */
  function pair(before: Snapshot, after: Snapshot): [string, string] {
    const dir = mkdtempSync(join(tmpdir(), "db-parity-main-"));
    const beforePath = join(dir, "before.json");
    const afterPath = join(dir, "after.json");
    writeFileSync(beforePath, JSON.stringify(before));
    writeFileSync(afterPath, JSON.stringify(after));
    return [beforePath, afterPath];
  }

  test("two identical snapshots are parity, exit 0", () => {
    const [b, a] = pair(snapshot(), snapshot());
    const { code, out, err } = captureConsole(() => main([b, a]));
    expect(code).toBe(0);
    expect(out).toEqual(["restore parity: identical"]);
    expect(err).toEqual([]);
  });

  test("a mismatch exits 1 and names every problem on stderr", () => {
    const after = snapshot({ rawRows: 12 });
    after.tables.tariffs = 1;
    const [b, a] = pair(snapshot(), after);
    const { code, out, err } = captureConsole(() => main([b, a]));
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err[0]).toBe("restore parity: 2 mismatch(es)");
    expect(err.join("\n")).toContain("tariffs: 2 rows before, 1 after");
    expect(err.join("\n")).toContain("metrics_raw: 700000 raw rows before, 12 after");
    // Every problem is listed, not just counted.
    expect(err).toHaveLength(3);
  });

  test("no arguments at all is a usage error, exit 2 — never a silent pass", () => {
    const { code, err } = captureConsole(() => main([]));
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("usage: db-parity.ts");
  });

  test("one path without the other is a usage error, not a comparison", () => {
    const [b] = pair(snapshot(), snapshot());
    const { code, err } = captureConsole(() => main([b]));
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("usage: db-parity.ts");
  });

  test("flags alone, with no positional paths, is still a usage error", () => {
    const { code } = captureConsole(() => main(["--expect-raw-loss", "--require-data"]));
    expect(code).toBe(2);
  });

  test("--expect-raw-loss turns a vanished raw window from a failure into the requirement", () => {
    const [b, a] = pair(snapshot(), snapshot({ rawRows: 0 }));
    expect(captureConsole(() => main([b, a])).code).toBe(1);
    expect(captureConsole(() => main([b, a, "--expect-raw-loss"])).code).toBe(0);
  });

  test("--expect-raw-loss fails when the raw window SURVIVED — the exclusion broke", () => {
    const [b, a] = pair(snapshot(), snapshot());
    const { code, err } = captureConsole(() => main([b, a, "--expect-raw-loss"]));
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("expected the raw window to be empty after restore");
  });

  test("--require-data refuses a comparison of two empty databases", () => {
    const [b, a] = pair(EMPTY, EMPTY);
    // Without the flag two empty snapshots are trivially identical.
    expect(captureConsole(() => main([b, a])).code).toBe(0);
    const { code, err } = captureConsole(() => main([b, a, "--require-data"]));
    expect(code).toBe(1);
    expect(err.join("\n")).not.toBe("");
  });

  test("--across-migration allows MORE compressed chunks but never fewer", () => {
    const [b, more] = pair(snapshot(), snapshot({ compressedChunks: 9 }));
    expect(captureConsole(() => main([b, more])).code).toBe(1);
    expect(captureConsole(() => main([b, more, "--across-migration"])).code).toBe(0);

    const [b2, fewer] = pair(snapshot(), snapshot({ compressedChunks: 2 }));
    const { code, err } = captureConsole(() => main([b2, fewer, "--across-migration"]));
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("compressed chunks: 6 before, 2 after");
  });

  test("flags may precede the paths — position does not decide which file is which", () => {
    const [b, a] = pair(snapshot(), snapshot({ rawRows: 0 }));
    expect(captureConsole(() => main(["--expect-raw-loss", b, a])).code).toBe(0);
    // Reversed, the "before" is the empty one and raw loss is not satisfied.
    expect(captureConsole(() => main(["--expect-raw-loss", a, b])).code).toBe(1);
  });
});

describe("cli", () => {
  test("--print-sql prints the snapshot query and exits 0, running no comparison", () => {
    const { code, out } = captureConsole(() => cli(["--print-sql"]));
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(SNAPSHOT_SQL);
  });

  test("without --print-sql the arguments go to the comparison", () => {
    const { code, err } = captureConsole(() => cli([]));
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("usage: db-parity.ts");
  });
});

describe("compareStreamCounts", () => {
  test("identical counts are parity", () => {
    expect(compareStreamCounts({ minute: 100, raw: 20 }, { minute: 100, raw: 20 })).toEqual([]);
  });

  test("a SHORTFALL is reported with both numbers — that is a row that did not travel", () => {
    const problems = compareStreamCounts({ minute: 100 }, { minute: 99 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("100");
    expect(problems[0]).toContain("99");
  });

  test("a SURPLUS is reported too — an export that duplicates is the worse failure", () => {
    // A double count does not error anywhere downstream; it just reports a wrong
    // kWh figure months later. More rows than the source held is never fine.
    expect(compareStreamCounts({ minute: 100 }, { minute: 101 })[0]).toMatch(/101/);
  });

  test("a stream the actual side does not carry at all is reported as absent", () => {
    expect(compareStreamCounts({ minute: 100 }, {})[0]).toMatch(/no minute/i);
  });

  test("ZERO expected and zero actual is parity, not an absence", () => {
    // An empty database exports zero rows, and that must compare clean.
    expect(compareStreamCounts({ minute: 0, raw: 0 }, { minute: 0, raw: 0 })).toEqual([]);
  });

  test("zero expected but rows present is reported", () => {
    expect(compareStreamCounts({ daily: 0 }, { daily: 5 })[0]).toMatch(/5/);
  });

  test("streams only the ACTUAL side names are ignored — expected is the contract", () => {
    expect(compareStreamCounts({ minute: 1 }, { minute: 1, hourly: 7 })).toEqual([]);
  });

  test("an empty expectation compares clean over anything", () => {
    expect(compareStreamCounts({}, { minute: 5 })).toEqual([]);
  });
});
