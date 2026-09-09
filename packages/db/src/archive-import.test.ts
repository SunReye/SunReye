/**
 * THE IMPORT DECISIONS, without a database.
 *
 * The statements themselves are proved by running them
 * (`apps/server/db-tests/archive.test.ts`) and the whole round trip by
 * `scripts/archive-round-trip.ts`. What is here is everything the importer has to
 * DECIDE, and each of these decisions has a silent failure mode:
 *
 *  * WHICH TIER GOES WHERE. A `raw` row is inserted; a bucket row goes through
 *    the replay. Mixing them up is either a lost hour of hold or a double count.
 *  * WHETHER TO PROCEED AT ALL. An import into a span the target already holds
 *    rows for is a double count with no error, so it is refused. An import of an
 *    archive already fully imported is a no-op, so it must be recognised.
 *  * WHAT RETENTION WILL DO TO THE ROWS. Retention runs on imported rows too.
 *    Anything older than `drop_after` is DELETED by the next job — not rejected
 *    at insert — and an operator who was not told that loses the history twice.
 */
import { describe, expect, test } from "bun:test";

import {
  BATCH_ROWS,
  batchWriter,
  STAGE_TABLE,
  archiveSourceId,
  batchesOf,
  overlapVerdict,
  retentionWarning,
  stageColumns,
} from "./archive-import";
import { buildManifest, emptyStreamCounts } from "./archive";

const manifest = (over: Partial<Parameters<typeof buildManifest>[0]> = {}) =>
  buildManifest({
    createdAt: new Date("2026-08-27T10:00:00Z"),
    source: {
      app: "2.0.0",
      drizzleTag: "t",
      drizzleWhen: 1,
      timescaleFiles: ["0000_baseline.sql"],
    },
    plantTimeZone: "Europe/Berlin",
    streams: { ...emptyStreamCounts(), minute: 100, raw: 20 },
    span: { from: new Date("2026-06-28T00:00:00Z"), to: new Date("2026-08-27T00:00:00Z") },
    devices: ["deye-1"],
    metrics: ["pv.power"],
    ...over,
  });

describe("archiveSourceId", () => {
  test("is stable for the same archive content", () => {
    expect(archiveSourceId(manifest())).toBe(archiveSourceId(manifest()));
  });

  test("ignores createdAt — re-exporting an unchanged database is the same source", () => {
    // Otherwise a second export of the same history would be a second source, and
    // its rows would land on top of the first import's instead of being skipped.
    expect(archiveSourceId(manifest({ createdAt: new Date("2027-01-01T00:00:00Z") }))).toBe(
      archiveSourceId(manifest()),
    );
  });

  test("differs when the SPAN differs — more history is genuinely a new source", () => {
    expect(
      archiveSourceId(
        manifest({
          span: { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-08-27T00:00:00Z") },
        }),
      ),
    ).not.toBe(archiveSourceId(manifest()));
  });

  test("differs when the row counts differ", () => {
    expect(
      archiveSourceId(manifest({ streams: { ...emptyStreamCounts(), minute: 101, raw: 20 } })),
    ).not.toBe(archiveSourceId(manifest()));
  });

  test("differs when the DEVICES differ", () => {
    expect(archiveSourceId(manifest({ devices: ["other"] }))).not.toBe(archiveSourceId(manifest()));
  });

  test("is prefixed so it can never collide with the in-place upgrade's own source", () => {
    // Two sources replaying into one database must not see each other's watermarks.
    expect(archiveSourceId(manifest())).toStartWith("archive:");
  });
});

describe("overlapVerdict", () => {
  const clean = {
    overlappingRows: 0,
    completedDevices: 0,
    expectedDevices: 1,
    partialChunks: 0,
    force: false,
  };

  test("a clean target proceeds", () => {
    expect(overlapVerdict(clean)).toEqual({ action: "proceed" });
  });

  test("an archive already imported IN FULL is a NO-OP, not an error", () => {
    // Every device the archive names carries a completion marker. Redoing the
    // import would double every row; failing would make a retry look broken.
    expect(
      overlapVerdict({ ...clean, overlappingRows: 500, completedDevices: 2, expectedDevices: 2 }),
    ).toEqual({ action: "skip", reason: expect.stringContaining("already imported in full") });
  });

  test("a PARTIALLY completed import is REFUSED, not skipped — this is the hole that bit", () => {
    // The bucket arm writes one watermark per UTC day AS IT GOES, so "some
    // watermarks exist" means some progress, never completion. Reading it as
    // completion is how a half-finished import gets skipped on the retry that was
    // supposed to fix it, leaving a chart quietly short and the importer saying
    // "nothing to do".
    const verdict = overlapVerdict({
      ...clean,
      overlappingRows: 100,
      partialChunks: 30,
      completedDevices: 0,
      expectedDevices: 1,
    });
    expect(verdict.action).toBe("refuse");
    expect(verdict.reason).toMatch(/INCOMPLETE/);
  });

  test("markers for SOME devices but not all is also incomplete", () => {
    const verdict = overlapVerdict({
      ...clean,
      overlappingRows: 100,
      completedDevices: 1,
      expectedDevices: 3,
    });
    expect(verdict.action).toBe("refuse");
    expect(verdict.reason).toMatch(/1 of 3/);
  });

  test("rows in the span from something ELSE is refused, and says how many", () => {
    const verdict = overlapVerdict({ ...clean, overlappingRows: 1234 });
    expect(verdict.action).toBe("refuse");
    expect(verdict.reason).toContain("1234");
    // The recourse has to be in the message: an operator holding one archive and
    // one bad day should not have to read this file.
    expect(verdict.reason).toMatch(/--force/);
  });

  test("--force proceeds over an overlap, and says it is accepting duplicates", () => {
    const verdict = overlapVerdict({ ...clean, overlappingRows: 1234, force: true });
    expect(verdict.action).toBe("proceed");
    expect(verdict.reason).toMatch(/duplicate/i);
  });

  test("--force does NOT re-import an archive already done — a skip is not an overlap", () => {
    // `--force` means "accept duplicates over a foreign span", not "write this
    // file twice". The completion check runs first for exactly that reason.
    expect(
      overlapVerdict({
        ...clean,
        overlappingRows: 1,
        completedDevices: 1,
        expectedDevices: 1,
        force: true,
      }).action,
    ).toBe("skip");
  });

  test("an archive naming NO devices never claims to be already imported", () => {
    // Zero markers out of zero devices is vacuously "all of them"; treating that
    // as done would make an empty archive skip on its first import.
    expect(overlapVerdict({ ...clean, expectedDevices: 0 }).action).toBe("proceed");
  });
});

describe("retentionWarning", () => {
  const now = new Date("2026-08-27T00:00:00Z");

  test("history inside the retention window is not warned about", () => {
    expect(
      retentionWarning({
        oldest: new Date("2026-06-28T00:00:00Z"),
        rawRetentionDays: 1825,
        now,
      }),
    ).toBeNull();
  });

  test("history OLDER than raw retention is warned about, loudly and with numbers", () => {
    // Retention runs on imported rows too. The next job DELETES them; the insert
    // does not reject them, so nothing else would ever tell the operator.
    const warning = retentionWarning({
      oldest: new Date("2019-01-01T00:00:00Z"),
      rawRetentionDays: 1825,
      now,
    });
    expect(warning).toContain("1825");
    expect(warning).toMatch(/delete|dropped/i);
    expect(warning).toContain("2019-01-01");
  });

  test("the boundary day itself is not warned about", () => {
    const oldest = new Date(now.getTime() - 1825 * 86_400_000 + 1000);
    expect(retentionWarning({ oldest, rawRetentionDays: 1825, now })).toBeNull();
  });

  test("one second past the boundary IS warned about", () => {
    const oldest = new Date(now.getTime() - 1825 * 86_400_000 - 1000);
    expect(retentionWarning({ oldest, rawRetentionDays: 1825, now })).not.toBeNull();
  });

  test("no retention policy at all means nothing can be dropped", () => {
    expect(
      retentionWarning({ oldest: new Date("1999-01-01T00:00:00Z"), rawRetentionDays: null, now }),
    ).toBeNull();
  });

  test("an empty archive has no oldest row and no warning", () => {
    expect(retentionWarning({ oldest: null, rawRetentionDays: 1825, now })).toBeNull();
  });
});

describe("batchesOf", () => {
  test("splits at the batch size", () => {
    const batches = [
      ...batchesOf(
        Array.from({ length: 25 }, (_, i) => i),
        10,
      ),
    ];
    expect(batches.map((b) => b.length)).toEqual([10, 10, 5]);
  });

  test("an empty input yields no batches — an empty VALUES list is a syntax error", () => {
    expect([...batchesOf([], 10)]).toEqual([]);
  });

  test("an input shorter than one batch is one batch", () => {
    expect([...batchesOf([1, 2], 10)]).toEqual([[1, 2]]);
  });

  test("the default batch stays under Postgres's 65535 parameter ceiling", () => {
    // metrics_raw takes five parameters a row; a batch that overflowed would fail
    // only on the largest import, i.e. the one that matters.
    expect(BATCH_ROWS * 5).toBeLessThan(65_535);
  });
});

describe("the staging contract with the replay", () => {
  test("every bucket tier stages into its own relation, and the names are bare identifiers", () => {
    for (const tier of ["minute", "hourly", "daily"] as const) {
      expect(STAGE_TABLE[tier]).toMatch(/^[a-z_][a-z0-9_]*$/);
      expect(STAGE_TABLE[tier].length).toBeLessThanOrEqual(63);
    }
    // Distinct: one relation per tier is what lets `runReplay` pick the finest
    // covering tier per day exactly as it does for the in-place upgrade.
    expect(new Set(Object.values(STAGE_TABLE)).size).toBe(3);
  });

  test("the column names handed to the replay are the archive's own field names", () => {
    // `LegacyColumns` exists so this transport can name its own columns rather
    // than pretend to be 1.2.0's rollups. Keeping the archive's names means one
    // fewer mapping to get wrong.
    expect(stageColumns()).toEqual({
      bucket: "time",
      sourceId: "device_slug",
      metric: "metric_key",
      value: "value",
    });
  });
});

describe("batchWriter", () => {
  /** Records what each insert was handed, so batching is observable. */
  const spy = () => {
    const batches: number[][] = [];
    return {
      batches,
      insert: async (rows: readonly number[]) => {
        batches.push([...rows]);
        return rows.length;
      },
    };
  };

  test("flushes when the batch fills, and not before", async () => {
    const { batches, insert } = spy();
    const writer = batchWriter(insert, 3);
    await writer.push(1);
    await writer.push(2);
    expect(batches).toEqual([]);
    await writer.push(3);
    expect(batches).toEqual([[1, 2, 3]]);
  });

  test("the final flush writes the remainder", async () => {
    const { batches, insert } = spy();
    const writer = batchWriter(insert, 3);
    await writer.push(1);
    await writer.flush();
    expect(batches).toEqual([[1]]);
    expect(writer.written).toBe(1);
  });

  test("an EMPTY flush issues no statement — `INSERT … VALUES ()` is a syntax error", async () => {
    // The common case: the final flush of an empty stream, i.e. an empty archive.
    const { batches, insert } = spy();
    const writer = batchWriter(insert, 3);
    await writer.flush();
    await writer.flush();
    expect(batches).toEqual([]);
    expect(writer.written).toBe(0);
  });

  test("a batch is never handed the same row twice", async () => {
    const { batches, insert } = spy();
    const writer = batchWriter(insert, 2);
    for (const n of [1, 2, 3, 4, 5]) await writer.push(n);
    await writer.flush();
    expect(batches).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches.flat()).toEqual([1, 2, 3, 4, 5]);
    expect(writer.written).toBe(5);
  });

  test("written counts what the INSERT reported, not what was pushed", async () => {
    // A row the database refused must not be counted as written — that count is
    // what the manifest check compares against.
    const writer = batchWriter<number>(async () => 0, 2);
    await writer.push(1);
    await writer.push(2);
    expect(writer.written).toBe(0);
  });
});
