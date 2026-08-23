import { describe, expect, test } from "bun:test";
import { type Snapshot, compareSnapshots, rollupKey } from "./db-parity";

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
