/**
 * The round-trip harness's own decisions — chiefly the TARGET PINNING, which is
 * the one part of a script that drops databases that must not be discovered to be
 * wrong by running it.
 *
 * Port 5432 is the developer's dev database, SHARED WITH A LIVE GRID-TIED
 * INVERTER, and port 5433 is the fixture container the whole wave depends on.
 * Both are refused; the reporting helpers are here because a wrong figure in the
 * report is how a slow feature gets called fast.
 */
import { describe, expect, test } from "bun:test";

import {
  DEFAULTS,
  DEV_DB_PORT,
  HELP,
  SHARED_FIXTURE_PORT,
  assertRoundTripTarget,
  humanBytes,
  parseArgs,
  throughput,
} from "./archive-round-trip";

const url = (port: number, db = "sunreye_archive_target") =>
  `postgres://postgres:postgres@localhost:${port}/${db}`;

describe("assertRoundTripTarget", () => {
  test("REFUSES the dev database's port — it is shared with a live inverter", () => {
    expect(() => assertRoundTripTarget(url(DEV_DB_PORT))).toThrow(/live grid-tied inverter/);
  });

  test("REFUSES the shared fixture's port — it is read-only and expensive to rebuild", () => {
    expect(() => assertRoundTripTarget(url(SHARED_FIXTURE_PORT))).toThrow(/read-only/);
  });

  test("refuses the dev port whatever the database is called", () => {
    // The port is the fact, not the name: `postgres` on 5432 is the same server.
    expect(() => assertRoundTripTarget(url(DEV_DB_PORT, "anything"))).toThrow();
  });

  test("allows a port of the operator's own", () => {
    expect(() => assertRoundTripTarget(url(5441))).not.toThrow();
    expect(() => assertRoundTripTarget(url(5555))).not.toThrow();
  });

  test("the default port is not one of the refused ones", () => {
    expect(DEFAULTS.port).not.toBe(DEV_DB_PORT);
    expect(DEFAULTS.port).not.toBe(SHARED_FIXTURE_PORT);
    expect(() => assertRoundTripTarget(url(DEFAULTS.port))).not.toThrow();
  });

  test("the help text names both refused ports, so nobody has to read the source", () => {
    expect(HELP).toContain(String(DEV_DB_PORT));
    expect(HELP).toContain(String(SHARED_FIXTURE_PORT));
  });
});

describe("parseArgs", () => {
  test("no arguments is the documented default", () => {
    expect(parseArgs([])).toEqual(DEFAULTS);
  });

  test("--port, --source and --target are read", () => {
    const options = parseArgs(["--port", "5442", "--source", "src", "--target", "dst"]);
    expect(options.port).toBe(5442);
    expect(options.sourceDb).toBe("src");
    expect(options.targetDb).toBe("dst");
  });

  test("--mode accepts fast and falls back to full for anything else", () => {
    expect(parseArgs(["--mode", "fast"]).mode).toBe("fast");
    expect(parseArgs(["--mode", "nonsense"]).mode).toBe("full");
  });

  test("--keep is a flag and does not swallow the next argument", () => {
    const options = parseArgs(["--keep", "--port", "5442"]);
    expect(options.keep).toBe(true);
    expect(options.port).toBe(5442);
  });

  test("the source and target must be different databases by default", () => {
    // Exporting from and importing into one database would compare a database
    // against itself and pass over anything.
    expect(DEFAULTS.sourceDb).not.toBe(DEFAULTS.targetDb);
  });
});

describe("humanBytes", () => {
  test("bytes stay bytes", () => {
    expect(humanBytes(0)).toBe("0 B");
    expect(humanBytes(512)).toBe("512 B");
  });

  test("the real measured archive reads as tens of megabytes, not as a raw integer", () => {
    expect(humanBytes(55_617_590)).toBe("53 MB");
  });

  test("a small value keeps two decimals so a ratio is not rounded to nothing", () => {
    expect(humanBytes(1536)).toBe("1.50 kB");
  });

  test("gigabytes are the ceiling — nothing here produces terabytes", () => {
    expect(humanBytes(1_421_583_309)).toEndWith(" GB");
  });
});

describe("throughput", () => {
  test("rows per second, rounded", () => {
    expect(throughput(9_072_000, 52_200)).toBe(173_793);
  });

  test("zero elapsed is null rather than Infinity — a report must not print Infinity", () => {
    expect(throughput(100, 0)).toBeNull();
    expect(throughput(100, -1)).toBeNull();
  });

  test("zero rows is zero, not null", () => {
    expect(throughput(0, 1000)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// THE PHASES, through the IO seam.
//
// Every connection, file and log line goes through `RoundTripIo`, so the ORDER of
// the phases, what each one refuses, the arithmetic in the report and the exit
// code are all provable here. What a real `counter_agg` or a real `COPY` does is
// not, and is not claimed to be: that is what running this script against the
// real fixture proves, and the fixture is the only thing that can.
// ---------------------------------------------------------------------------

import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExportResult } from "../packages/db/src/archive-export";
import type { ImportResult } from "../packages/db/src/archive-import";
import { emptyStreamCounts } from "../packages/db/src/archive";
import {
  type GroundTruth,
  type ProfileDoc,
  type Run,
  type RoundTripIo,
  PROBLEMS_SHOWN,
  comparePhase,
  countSourceRows,
  exportPhase,
  importPhase,
  importedEnergy,
  main,
  productionIo,
  profileVocabulary,
  recreateTarget,
  reportTarget,
} from "./archive-round-trip";

interface Answer {
  /** Rows a statement gets back, matched on the relation it counts. */
  counts?: Record<string, number>;
  /** Counter readings, per metric, for `importedEnergy`. */
  readings?: Record<string, { time: string; value: number }[]>;
}

interface Seam {
  io: RoundTripIo;
  logs: string[];
  errors: string[];
  helps: string[];
  connected: string[];
  migrated: string[];
  removed: string[];
  made: string[];
  exports: unknown[];
  imports: unknown[];
  /** Databases whose pool was closed, in the order they were closed. */
  closed: string[];
}

const PROFILE: ProfileDoc = {
  id: "sample.profile",
  metrics: [
    { key: "total.energy", unit: "kWh" },
    { key: "pv.power", unit: "W" },
  ],
};

const truthOf = (over: Partial<GroundTruth> = {}): GroundTruth => ({
  tiers: { minute: { count: 10 } },
  perMetricPerDayEnergy: [],
  restarts: [],
  ...over,
});

const exportResult = (over: Partial<ExportResult> = {}): ExportResult => ({
  path: "/tmp/archive.tar.gz",
  barren: [],
  bytes: 1024,
  uncompressedBytes: 10_240,
  manifest: {
    format: "sunreye-archive",
    formatVersion: 1,
    createdAt: "2026-08-27T10:00:00.000Z",
    source: { app: "1.2.0-legacy", drizzleTag: null, drizzleWhen: null, timescaleFiles: [] },
    plantTimeZone: "Europe/Berlin",
    streams: { ...emptyStreamCounts(), minute: 10 },
    rows: 10,
    span: { from: "2026-08-20T00:00:00.000Z", to: "2026-08-21T00:00:00.000Z" },
    devices: ["1"],
    metrics: ["pv.power"],
  },
  plan: {
    chunks: [
      {
        tier: "minute",
        start: new Date("2026-08-20T00:00:00.000Z"),
        end: new Date("2026-08-21T00:00:00.000Z"),
      },
    ],
    gaps: [],
  },
  elapsedMs: 500,
  ...over,
});

const importResult = (over: Partial<ImportResult> = {}): ImportResult => ({
  manifest: exportResult().manifest,
  inserted: { ...emptyStreamCounts(), minute: 10 },
  replays: [],
  problems: [],
  skipped: null,
  elapsedMs: 250,
  ...over,
});

/** The relation a statement counts, for a double that answers per tier. */
const relationOf = (query: string): string => query.match(/from ([a-z_]+)/)?.[1] ?? "";

/**
 * Which seeded rows a statement is asking for. Two shapes reach the double: the
 * per-counter reading scan, and a `count(*)` over one relation.
 */
function rowsFor(answer: Answer, query: string, values: readonly unknown[]): unknown[] {
  if (query.includes("from metrics_raw r")) {
    return answer.readings?.[String(values[0])] ?? [];
  }
  if (query.includes("count(*)")) {
    return [{ n: String(answer.counts?.[relationOf(query)] ?? 0) }];
  }
  return [];
}

function seam(
  answer: Answer = {},
  over: Partial<RoundTripIo> & { exported?: ExportResult; imported?: ImportResult } = {},
): Seam {
  const state: Omit<Seam, "io"> = {
    logs: [],
    errors: [],
    helps: [],
    connected: [],
    migrated: [],
    removed: [],
    made: [],
    exports: [],
    imports: [],
    closed: [],
  };
  const { exported, imported, ...io } = over;
  const seamIo: RoundTripIo = {
    connect(url) {
      const database = new URL(url).pathname.slice(1);
      state.connected.push(database);
      return {
        async unsafe(query, values) {
          return rowsFor(answer, query, values ?? []);
        },
        async end() {
          state.closed.push(database);
        },
      };
    },
    async migrate(url) {
      state.migrated.push(new URL(url).pathname.slice(1));
    },
    readGroundTruth: async () => truthOf(),
    readProfile: async () => PROFILE,
    async exportArchive(_client, request) {
      state.exports.push(request);
      return exported ?? exportResult();
    },
    async importArchive(_client, request) {
      state.imports.push(request);
      return imported ?? importResult();
    },
    async openArchive() {
      return {
        manifest: exportResult().manifest,
        config: null,
        members: [],
        lines: async function* () {},
        close: async () => {},
      };
    },
    async mkdir(path) {
      state.made.push(path);
    },
    async remove(path) {
      state.removed.push(path);
    },
    sizeOf: async () => 55_617_590,
    log: (message) => state.logs.push(message),
    help: (text) => state.helps.push(text),
    error: (message) => state.errors.push(message),
    ...io,
  };
  return { io: seamIo, ...state };
}

const runOf = (io: RoundTripIo, over: Partial<Run> = {}): Run => ({
  options: { ...DEFAULTS },
  workRoot: "/tmp/work",
  archivePath: "/tmp/work/sunreye-export.tar.gz",
  truth: truthOf(),
  vocabulary: { profileId: "sample.profile", metricKeys: [], counters: [] },
  ...over,
});

describe("profileVocabulary", () => {
  test("the counter class comes from the FIXTURE's own shapes, not from a guess", async () => {
    // Deriving it any other way would let the export and the committed truth
    // disagree about which series `counter_agg` belongs on — the 1532x error
    // wearing a different hat.
    const { io } = seam();
    const vocabulary = await profileVocabulary("fast", io);
    expect(vocabulary.profileId).toBe("sample.profile");
    expect(vocabulary.metricKeys).toEqual([
      { key: "total.energy", isCounter: true },
      { key: "pv.power", isCounter: false },
    ]);
    expect(vocabulary.counters).toEqual(["total.energy"]);
  });
});

describe("recreateTarget", () => {
  test("drops, creates, and only THEN applies the baseline", async () => {
    const { io, connected, migrated, closed } = seam();
    const url = await recreateTarget({ ...DEFAULTS }, io);
    expect(url).toContain(DEFAULTS.targetDb);
    // The maintenance connection is to `postgres`, never to the database being
    // dropped — a connection to it is what makes the DROP hang.
    expect(connected).toEqual(["postgres"]);
    expect(closed).toEqual(["postgres"]);
    expect(migrated).toEqual([DEFAULTS.targetDb]);
  });

  test("REFUSES to recreate anything on the dev database's port", async () => {
    const { io, connected } = seam();
    await expect(recreateTarget({ ...DEFAULTS, port: DEV_DB_PORT }, io)).rejects.toThrow(
      /live grid-tied inverter/,
    );
    expect(connected).toEqual([]);
  });
});

describe("countSourceRows", () => {
  test("sums the source's rows per tier over the days the plan gave that tier", async () => {
    // Per chunk rather than per tier: the plan deliberately gives the last days to
    // raw, so the minute tier's buckets are NOT all exported and comparing against
    // the whole tier would fail for the right reason with the wrong message.
    const { io } = seam({ counts: { minute_rollups: 7, metrics_raw: 3 } });
    const totals = await countSourceRows(
      { ...DEFAULTS },
      [
        {
          tier: "minute",
          start: new Date("2026-08-20T00:00:00Z"),
          end: new Date("2026-08-21T00:00:00Z"),
        },
        {
          tier: "minute",
          start: new Date("2026-08-21T00:00:00Z"),
          end: new Date("2026-08-22T00:00:00Z"),
        },
        {
          tier: "raw",
          start: new Date("2026-08-22T00:00:00Z"),
          end: new Date("2026-08-23T00:00:00Z"),
        },
      ],
      io,
    );
    expect(totals).toEqual({ minute: 14, raw: 3 });
  });

  test("a tier this script has no relation for is skipped, not counted as zero", async () => {
    const { io } = seam({ counts: { minute_rollups: 7 } });
    const totals = await countSourceRows(
      { ...DEFAULTS },
      [{ tier: "weekly", start: new Date(0), end: new Date(1) }],
      io,
    );
    expect(totals).toEqual({});
  });

  test("the source connection is closed even when a statement throws", async () => {
    const state = seam();
    const io: RoundTripIo = {
      ...state.io,
      connect(url) {
        const handle = state.io.connect(url);
        return { unsafe: async () => Promise.reject(new Error("no")), end: handle.end };
      },
    };
    await expect(
      countSourceRows({ ...DEFAULTS }, [{ tier: "raw", start: new Date(0), end: new Date(1) }], io),
    ).rejects.toThrow();
    expect(state.closed).toHaveLength(1);
  });
});

describe("importedEnergy", () => {
  test("one query per counter, through the same energyOf the truth was written with", async () => {
    const { io } = seam({
      readings: {
        "total.energy": [
          { time: "2026-08-20T00:00:00Z", value: 10 },
          { time: "2026-08-20T12:00:00Z", value: 15 },
          // A lifetime counter that loses its total mid-afternoon: the increment
          // since the reset is what counts, and max-minus-min is not.
          { time: "2026-08-20T15:00:00Z", value: 2 },
        ],
      },
    });
    const db = io.connect("postgres://postgres:postgres@localhost:5441/t");
    const { energy, restarts } = await importedEnergy(db, ["total.energy"]);
    expect(energy).toHaveLength(1);
    expect(energy[0]?.energy).toBeCloseTo(7, 6);
    expect(energy[0]?.resets).toBe(1);
    expect(restarts).toEqual([
      {
        metric: "total.energy",
        at: "2026-08-20T15:00:00.000Z",
        valueBefore: 15,
        valueAfter: 2,
      },
    ]);
  });

  test("no counters means no queries and no rows", async () => {
    const { io } = seam();
    const db = io.connect("postgres://postgres:postgres@localhost:5441/t");
    expect(await importedEnergy(db, [])).toEqual({ energy: [], restarts: [] });
  });
});

describe("exportPhase", () => {
  test("reads the LEGACY arm with the fixture's vocabulary and reports the file", async () => {
    const state = seam();
    const result = await exportPhase(
      runOf(state.io, {
        vocabulary: {
          profileId: "sample.profile",
          metricKeys: [{ key: "pv.power", isCounter: false }],
          counters: [],
        },
      }),
      state.io,
    );
    expect(state.exports).toHaveLength(1);
    expect(state.exports[0]).toMatchObject({
      source: "legacy",
      profileId: "sample.profile",
      metricKeys: [{ key: "pv.power", isCounter: false }],
      appVersion: "1.2.0-legacy",
    });
    expect(result.problems).toEqual([]);
    expect(result.streams).toEqual({ raw: 0, minute: 10, hourly: 0, daily: 0 });
    // The compression ratio is the number that decides whether this is usable on a
    // 2 GB box, so it is reported rather than left to be worked out.
    expect(state.logs.join("\n")).toContain("10.0x compression");
    expect(state.logs.join("\n")).toContain("1 day-chunk(s), 0 gap(s)");
    // The source connection is closed before anything else happens.
    expect(state.closed).toHaveLength(1);
  });

  test("a BARREN chunk is a problem, not a log line", async () => {
    // A planned day that produced nothing is the exact shape of the bug that
    // silently dropped a whole day of a native export.
    const state = seam(
      {},
      {
        exported: exportResult({
          barren: [
            {
              tier: "minute",
              start: new Date("2026-08-20T00:00:00Z"),
              end: new Date("2026-08-21T00:00:00Z"),
              reason: "that tier's values are all NULL for it",
            },
          ],
        }),
      },
    );
    const result = await exportPhase(runOf(state.io), state.io);
    expect(result.problems).toEqual(["2026-08-20: that tier's values are all NULL for it"]);
  });

  test("a manifest that reads back DIFFERENTLY from the file is a problem", async () => {
    // The archive has to be readable as a file by something that did not write it.
    const state = seam(
      {},
      {
        async openArchive() {
          return {
            manifest: { ...exportResult().manifest, rows: 9 },
            config: null,
            members: [],
            lines: async function* () {},
            close: async () => {},
          };
        },
      },
    );
    const result = await exportPhase(runOf(state.io), state.io);
    expect(result.problems).toEqual([
      "manifest read back from the file claims 9 rows, the export reported 10",
    ]);
  });

  test("progress from the exporter is logged as it happens", async () => {
    const state = seam(
      {},
      {
        async exportArchive(_client, request) {
          request.onProgress?.({
            tier: "minute",
            window: {
              start: new Date("2026-08-20T00:00:00Z"),
              end: new Date("2026-08-21T00:00:00Z"),
            },
            rows: 5,
            total: 5,
          });
          return exportResult();
        },
      },
    );
    await exportPhase(runOf(state.io), state.io);
    expect(state.logs.some((line) => line.includes("minute 2026-08-20..2026-08-21"))).toBe(true);
  });

  test("the source connection is closed even when the export throws", async () => {
    const state = seam(
      {},
      {
        exportArchive: async () => {
          throw new Error("export died");
        },
      },
    );
    await expect(exportPhase(runOf(state.io), state.io)).rejects.toThrow("export died");
    expect(state.closed).toHaveLength(1);
  });
});

describe("importPhase", () => {
  test("the importer's progress is logged as it happens, rows only when there are rows", async () => {
    const state = seam(
      {},
      {
        async importArchive(_client, request) {
          request.onProgress?.({ stage: "readings", rows: 1_234 });
          request.onProgress?.({ stage: "refresh", rows: 0 });
          return importResult();
        },
      },
    );
    const db = state.io.connect("postgres://postgres:postgres@localhost:5441/t");
    await importPhase(runOf(state.io), db, state.io);
    expect(state.logs).toContain("  readings: 1,234 rows");
    // A stage with no rows to report says so by saying nothing, rather than "0".
    expect(state.logs).toContain("  refresh");
  });

  test("an import's own NOTES are logged, never counted as differences", async () => {
    // A retention warning or a config oddity is a note. Letting one fail the run
    // would make the script red for something that is not a data difference — the
    // verdict is the energy comparison.
    const state = seam(
      {},
      {
        imported: importResult({
          problems: ["the archive's oldest reading is past retention"],
          replays: [
            {
              chunks: [],
              skipped: 2,
              seriesRows: 10,
              configRows: 1,
              gaps: [],
              elapsedMs: 5,
            },
          ],
        }),
      },
    );
    const db = state.io.connect("postgres://postgres:postgres@localhost:5441/t");
    expect(await importPhase(runOf(state.io), db, state.io)).toEqual([]);
    const logged = state.logs.join("\n");
    expect(logged).toContain("note: the archive's oldest reading is past retention");
    expect(logged).toContain("2 skipped");
  });
});

describe("reportTarget", () => {
  test("reports the hypertable and every tier a human wants to see", async () => {
    const state = seam({
      counts: {
        metrics_raw: 9_072_000,
        minute_rollups: 151_200,
        hourly_rollups: 2_520,
        daily_rollups: 105,
      },
    });
    const db = state.io.connect("postgres://postgres:postgres@localhost:5441/t");
    await reportTarget(db, state.io);
    expect(state.logs).toEqual([
      "TARGET metrics_raw: 9,072,000 rows",
      "TARGET minute_rollups: 151,200 buckets",
      "TARGET hourly_rollups: 2,520 buckets",
      "TARGET daily_rollups: 105 buckets",
    ]);
  });
});

describe("comparePhase", () => {
  const truth = truthOf({
    perMetricPerDayEnergy: [
      { metric: "total.energy", day: "2026-08-20", energy: 41.971, naive: 64_280.971, resets: 1 },
    ],
    restarts: [
      {
        metric: "total.energy",
        at: "2026-08-20T15:00:00.000Z",
        valueBefore: 15,
        valueAfter: 2,
      },
    ],
  });

  test("THE HEADLINE: the reset day is named, with the naive figure beside the truth", async () => {
    const state = seam({
      readings: {
        "total.energy": [
          { time: "2026-08-20T00:00:00Z", value: 0 },
          { time: "2026-08-20T12:00:00Z", value: 64_280.971 },
          { time: "2026-08-20T15:00:00Z", value: 41.971 },
        ],
      },
    });
    const problems = await comparePhase(
      runOf(state.io, {
        truth,
        vocabulary: { profileId: "p", metricKeys: [], counters: ["total.energy"] },
      }),
      state.io.connect("postgres://postgres:postgres@localhost:5441/t"),
      state.io,
    );
    const hazard = state.logs.find((line) => line.startsWith("RESET HAZARD"));
    expect(hazard).toContain("total.energy on 2026-08-20");
    expect(hazard).toContain("1532x");
    // The measured series above really does total 64280.971 + 41.971 of increments
    // rather than 41.971, so the comparison FAILS — which is the point: a wrong
    // round trip is reported, not smoothed over.
    expect(problems.length).toBeGreaterThan(0);
  });

  test("a truth with no reset hazard worth naming logs none", async () => {
    const state = seam();
    await comparePhase(
      runOf(state.io, {
        truth: truthOf({
          perMetricPerDayEnergy: [
            { metric: "pv.power", day: "2026-08-20", energy: 10, naive: 10.5, resets: 0 },
          ],
        }),
      }),
      state.io.connect("postgres://postgres:postgres@localhost:5441/t"),
      state.io,
    );
    expect(state.logs.some((line) => line.startsWith("RESET HAZARD"))).toBe(false);
  });
});

describe("main", () => {
  test("--help prints the documentation unprefixed and touches no database", async () => {
    const state = seam();
    expect(await main(["--help"], state.io)).toBe(0);
    expect(state.helps).toEqual([HELP]);
    expect(state.connected).toEqual([]);
  });

  test("a clean run exits 0 and says so", async () => {
    const state = seam({ counts: { minute_rollups: 10 } });
    expect(await main([], state.io)).toBe(0);
    expect(state.logs.at(-1)).toContain("no differences");
  });

  test("the phases run in order: export, then recreate, then import, then compare", async () => {
    const state = seam({ counts: { minute_rollups: 10 } });
    await main([], state.io);
    // The target is recreated AFTER the export, so a failed export cannot cost the
    // operator the database they were importing into.
    const order = state.logs.map((line) => line.split(":")[0]);
    expect(order.indexOf("EXPORT")).toBeLessThan(
      order.findIndex((line) => line.startsWith("recreated")),
    );
    expect(state.migrated).toEqual([DEFAULTS.targetDb]);
    expect(state.imports).toHaveLength(1);
  });

  test("REFUSES before anything else when the SOURCE is on a pinned port", async () => {
    const state = seam();
    await expect(main(["--port", String(SHARED_FIXTURE_PORT)], state.io)).rejects.toThrow(
      /read-only/,
    );
    expect(state.made).toEqual([]);
    expect(state.connected).toEqual([]);
  });

  test("the scratch directory is removed on a plain run", async () => {
    const state = seam({ counts: { minute_rollups: 10 } });
    await main([], state.io);
    expect(state.removed).toEqual(state.made);
  });

  test("--keep leaves the archive and reports where it is, in human bytes", async () => {
    const state = seam({ counts: { minute_rollups: 10 } });
    await main(["--keep"], state.io);
    expect(state.removed).toEqual([]);
    expect(
      state.logs.some((line) => line.includes("archive kept at") && line.includes("53 MB")),
    ).toBe(true);
  });

  test("--out writes where the operator said and keeps the scratch beside it", async () => {
    const state = seam({ counts: { minute_rollups: 10 } });
    await main(["--out", "/tmp/mine.tar.gz"], state.io);
    expect(state.made).toEqual(["/tmp/mine.tar.gz.work"]);
    expect(state.exports[0]).toMatchObject({ out: "/tmp/mine.tar.gz" });
    expect(state.removed).toEqual([]);
  });

  test("a row-count difference between source and archive exits 1 and is spelled out", async () => {
    // The manifest says what the archive carries; the source says what it should
    // have carried. A silent difference here is a missing month.
    const state = seam({ counts: { minute_rollups: 11 } });
    expect(await main([], state.io)).toBe(1);
    expect(state.errors[0]).toContain("1 problem(s)");
    expect(state.errors[1]).toContain("the source holds 11 row(s)");
  });

  test("a flood of problems is truncated with a count, not dumped in full", async () => {
    const many = Array.from({ length: PROBLEMS_SHOWN + 5 }, (_, i) => ({
      tier: "minute",
      start: new Date(Date.UTC(2026, 0, i + 1)),
      end: new Date(Date.UTC(2026, 0, i + 2)),
      reason: `barren ${i}`,
    }));
    const state = seam(
      { counts: { minute_rollups: 10 } },
      { exported: exportResult({ barren: many }) },
    );
    expect(await main([], state.io)).toBe(1);
    expect(state.errors).toHaveLength(1 + PROBLEMS_SHOWN + 1);
    expect(state.errors.at(-1)).toBe("  ... and 5 more");
  });

  test("the target connection is closed even when the comparison throws", async () => {
    const state = seam(
      { counts: { minute_rollups: 10 } },
      {
        imported: importResult(),
      },
    );
    const io: RoundTripIo = {
      ...state.io,
      importArchive: async () => {
        throw new Error("import died");
      },
    };
    await expect(main([], io)).rejects.toThrow("import died");
    // Every pool the run opened: the source, the per-chunk count, the maintenance
    // connection and the target itself.
    expect(state.closed).toEqual([
      DEFAULTS.sourceDb,
      DEFAULTS.sourceDb,
      "postgres",
      DEFAULTS.targetDb,
    ]);
  });
});

// ---------------------------------------------------------------------------
// The production wiring itself.
//
// Only the parts that can run without side effects. `migrate` is deliberately
// NOT exercised: it opens a connection and applies a schema, and there is no URL
// it could be pointed at here that is not either a real database or a hang. That
// is exactly why it holds nothing but the dynamic import and the one call.
// ---------------------------------------------------------------------------
describe("productionIo", () => {
  test("connect builds a handle without dialing out", () => {
    // Nothing may connect at construction time: `recreateTarget` calls
    // `assertRoundTripTarget` on the URL only after the handle exists.
    const handle = productionIo.connect("postgres://postgres:postgres@localhost:5441/nothing");
    expect(typeof handle.unsafe).toBe("function");
    expect(typeof handle.end).toBe("function");
  });

  test("readProfile reads the profile that ships in the repo", async () => {
    const profile = await productionIo.readProfile();
    expect(typeof profile.id).toBe("string");
    expect(profile.metrics.length).toBeGreaterThan(0);
  });

  test("readGroundTruth reads the COMMITTED truth, which is the whole point", async () => {
    const truth = await productionIo.readGroundTruth("fast");
    expect(truth.perMetricPerDayEnergy.length).toBeGreaterThan(0);
    // A truth with no restart would make the headline case unproven.
    expect(truth.restarts.length).toBeGreaterThan(0);
  });

  test("mkdir creates nested scratch, sizeOf measures a file, remove takes it away", async () => {
    const root = join(tmpdir(), `round-trip-io-${process.pid}-${Date.now()}`);
    const nested = join(root, "deeper");
    await productionIo.mkdir(nested);
    await Bun.write(join(nested, "archive.tar.gz"), "0123456789");
    expect(await productionIo.sizeOf(join(nested, "archive.tar.gz"))).toBe(10);
    await productionIo.remove(root);
    expect(await Bun.file(join(nested, "archive.tar.gz")).exists()).toBe(false);
    // Removing what is already gone is not an error: the run may have failed
    // before the directory existed.
    await expect(productionIo.remove(root)).resolves.toBeUndefined();
  });

  test("log is prefixed, help is not, and errors go to stderr", () => {
    const out: string[] = [];
    const err: string[] = [];
    const realLog = console.log;
    const realError = console.error;
    const realEnv = process.env.NODE_ENV;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.error = (...a: unknown[]) => void err.push(a.join(" "));
    try {
      // The progress log is SILENT under the test environment: this script logs a
      // line per export window, and a suite that ran it would bury its own output.
      productionIo.log("silent here");
      expect(out).toEqual([]);
      process.env.NODE_ENV = "development";
      productionIo.log("exporting 9,072,000 rows");
      productionIo.help("archive-round-trip.ts — ...");
      productionIo.error("round trip: 3 problem(s)");
    } finally {
      console.log = realLog;
      console.error = realError;
      process.env.NODE_ENV = realEnv;
    }
    expect(out).toEqual(["[round-trip] exporting 9,072,000 rows", "archive-round-trip.ts — ..."]);
    expect(err).toEqual(["round trip: 3 problem(s)"]);
  });
});
