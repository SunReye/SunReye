/**
 * THE IN-PLACE UPGRADE'S EXECUTION HALF, against a recording double.
 *
 * `./upgrade-120.test.ts` covers the decisions that need no database at all —
 * the classification, the baseline plan, the replay ceiling. Every statement
 * below is proved by EXECUTING it (`apps/server/db-tests/upgrade.test.ts` against
 * a restored addon-1.2.0 fixture, and `scripts/upgrade-rehearsal.ts` end to end).
 *
 * What is here is the part in between, which neither of those two layers proves
 * cheaply: what this module does with the ROWS a statement hands back, and what
 * it REFUSES to do at all.
 *
 *  * a database carrying more than one `inverter_id` is refused, not halved;
 *  * the source id falls back from the retained raw window to the BUCKETS, which
 *    is the only thing that saves an addon that was offline longer than raw
 *    retention;
 *  * the migration record survives being stored as a JSON STRING, which is what
 *    every `app_settings` row on a real 1.2.0 database actually is;
 *  * the legacy objects are dropped AGGREGATES FIRST, so no `DROP … CASCADE` ever
 *    goes near the one copy of the history.
 *
 * `UpgradeClient` is structurally `pg.Client`'s `query`, which is exactly why it
 * can be driven from here. NO TEST BELOW ASSERTS ON STATEMENT TEXT.
 */
import { describe, expect, test } from "bun:test";

import type { CatalogState } from "./upgrade-120";
import { MIGRATION_KEY } from "./upgrade-state";
import {
  type UpgradeClient,
  carryLegacyRaw,
  dropLegacyStatements,
  pgUpgradeClient,
  readLegacyCadenceMs,
  readMigrationRecord,
  runBlockingUpgrade,
} from "./upgrade-120-run";

interface Answers {
  /** Relations `readCatalog` finds. */
  relations?: string[];
  /** `metrics_raw`'s columns — a legacy-shaped one carries `inverter_id`. */
  rawColumns?: string[];
  /** `min`/`max` of the retained legacy raw. */
  rawWindow?: { from: string | null; to: string | null };
  /** Distinct `inverter_id` in the retained legacy raw. */
  rawSourceIds?: string[];
  /** Distinct `inverter_id` in the legacy MINUTE tier. */
  bucketSourceIds?: string[];
  /** Inter-sample gaps, ms, as the cadence query returns them. */
  gaps?: (number | string)[];
  /** `app_settings.value` for the migration key, verbatim. */
  record?: unknown;
  /** Rows the replay's staged read reports for a chunk. */
  replayRows?: number;
}

const rows = (list: unknown[]) => ({ rows: list });

/**
 * Dispatch as a TABLE rather than a chain of `if`s — the shape
 * `./replay-run.test.ts` established. Order matters: the cadence query and the
 * raw window both read `metrics_raw_legacy`.
 */
const ROUTES: [RegExp, (a: Answers, text: string, values: readonly unknown[]) => unknown[]][] = [
  [/from pg_class .*relkind in/s, (a) => (a.relations ?? []).map((name) => ({ name }))],
  [/relkind = 'i'/, () => []],
  [/from pg_constraint/, () => []],
  [
    /from information_schema\.columns/,
    (a) => (a.rawColumns ?? []).map((c) => ({ t: "metrics_raw", c })),
  ],
  [/with sample as/, (a) => (a.gaps ?? []).map((gap) => ({ gap }))],
  [/^select min\(time\)/, (a) => [a.rawWindow ?? { from: null, to: null }]],
  [
    /distinct inverter_id .* from legacy_minute_rollups/s,
    (a) => (a.bucketSourceIds ?? []).map((id) => ({ id })),
  ],
  [/distinct inverter_id/, (a) => (a.rawSourceIds ?? []).map((id) => ({ id }))],
  [/from app_settings where key/, (a) => (a.record === undefined ? [] : [{ value: a.record }])],
  // The replay's own statements: enough for one chunk to run.
  [/^select min\(b\./, (a) => [a.replayRows === undefined ? { from: null, to: null } : a.window]],
  [/not exists \(select 1 from/, () => []],
  [/^select chunk_start from/, () => []],
  [/^with ins as \(/, (a) => [{ n: a.replayRows ?? 0 }]],
];

function fake(answers: Answers & { window?: unknown } = {}): {
  client: UpgradeClient;
  statements: string[];
} {
  const statements: string[] = [];
  const client: UpgradeClient = {
    async query(text, values = []) {
      const trimmed = text.trim();
      statements.push(trimmed);
      const route = ROUTES.find(([pattern]) => pattern.test(trimmed));
      return rows(route ? route[1](answers as Answers, trimmed, values) : []);
    },
  };
  return { client, statements };
}

/** A catalog holding a 1.2.0 database that has already been renamed. */
const RENAME_DONE: Answers = {
  relations: ["metrics_raw_legacy", "legacy_minute_rollups", "app_settings", "metrics_raw"],
  rawColumns: ["time", "value", "dur_ms", "device_id", "metric_id"],
};

const baselineInput = {
  baselineStatements: [] as string[],
  baseline: { when: 1_756_000_000_000, hash: "sha256:baseline" },
};

describe("readLegacyCadenceMs", () => {
  test("the MEDIAN gap, which is what a poll sample's duration is", async () => {
    // The median rather than the mean: a restarted addon leaves one enormous gap,
    // and a mean would stamp every sample of the week with it.
    const { client } = fake({ gaps: [1000, 1000, 1000, 3_600_000, 1000] });
    expect(await readLegacyCadenceMs(client)).toBe(1000);
  });

  test("gaps arriving as strings are still numbers — the driver decides which", async () => {
    const { client } = fake({ gaps: ["5000", "5000", "5000"] });
    expect(await readLegacyCadenceMs(client)).toBe(5000);
  });

  test("a raw window with no pair of samples has NO cadence, rather than a made-up one", async () => {
    // `null` writes no duration at all, which is honest; a guessed cadence would
    // claim a hold the data does not support.
    const { client } = fake({ gaps: [] });
    expect(await readLegacyCadenceMs(client)).toBeNull();
  });
});

describe("runBlockingUpgrade: the source id", () => {
  test("is READ from the retained raw window, never configured", async () => {
    // 1.2.0 stamped `inverterId = profile.id`, so the value is whatever that
    // install's profile was called — asking an operator to type it is asking them
    // to guess.
    const { client } = fake({
      ...RENAME_DONE,
      rawWindow: { from: "2026-08-20T00:00:00Z", to: "2026-08-27T00:00:00Z" },
      rawSourceIds: ["deye.sun-12k"],
    });
    const result = await runBlockingUpgrade(client, baselineInput);
    expect(result?.record.sourceId).toBe("deye.sun-12k");
    expect(result?.record.legacyRawFrom).toBe("2026-08-20T00:00:00.000Z");
    expect(result?.record.stage).toBe("cutover");
  });

  test("falls back to the BUCKETS when retention has dropped every raw chunk", async () => {
    // An addon stopped for longer than 1.2.0's seven-day raw retention comes back
    // with an empty raw window and two months of buckets. Losing the source id
    // there would leave the whole history unreplayable.
    const { client } = fake({
      ...RENAME_DONE,
      rawWindow: { from: null, to: null },
      rawSourceIds: [],
      bucketSourceIds: ["deye.sun-12k"],
    });
    const result = await runBlockingUpgrade(client, baselineInput);
    expect(result?.record.sourceId).toBe("deye.sun-12k");
    expect(result?.record.legacyRawFrom).toBeNull();
  });

  test("MORE THAN ONE is refused rather than halved — 1.2.0 could not produce it", async () => {
    // Each distinct id is a separate physical device, and mapping them to the new
    // `devices` rows is not something this upgrade can guess.
    const { client } = fake({
      ...RENAME_DONE,
      rawWindow: { from: "2026-08-20T00:00:00Z", to: "2026-08-27T00:00:00Z" },
      rawSourceIds: ["deye.sun-12k", "sigen.hybrid"],
    });
    await expect(runBlockingUpgrade(client, baselineInput)).rejects.toThrow(
      /2 distinct inverter_id values \(deye\.sun-12k, sigen\.hybrid\)/,
    );
  });

  test("a database with NO history at all still upgrades, with a null source id", async () => {
    const { client } = fake({ ...RENAME_DONE, rawWindow: { from: null, to: null } });
    const result = await runBlockingUpgrade(client, baselineInput);
    expect(result?.record.sourceId).toBeNull();
  });
});

describe("runBlockingUpgrade: which database it acts on at all", () => {
  test("a fresh or already-2.0.0 install falls straight through", async () => {
    // What lets this sit unconditionally in `./migrate.ts`'s chain instead of
    // behind a flag somebody has to remember to set.
    const { client, statements } = fake({
      relations: ["metrics_raw", "app_settings"],
      rawColumns: ["time", "value", "dur_ms", "device_id", "metric_id"],
    });
    expect(await runBlockingUpgrade(client, baselineInput)).toBeNull();
    // It read the catalog and stopped: nothing was renamed, stamped or recorded.
    expect(statements.some((text) => text.startsWith("alter"))).toBe(false);
    expect(statements.some((text) => text.includes("drizzle"))).toBe(false);
  });

  test("BOTH generations of metrics_raw is REFUSED — there is no safe guess", async () => {
    // Picking one would either migrate the empty table (losing everything) or
    // double-count. The only safe output is a stop with an instruction.
    const { client, statements } = fake({
      relations: ["metrics_raw", "metrics_raw_legacy", "app_settings"],
      rawColumns: ["time", "inverter_id", "metric", "value"],
    });
    await expect(runBlockingUpgrade(client, baselineInput)).rejects.toThrow(
      /BOTH a legacy-shaped metrics_raw/,
    );
    expect(statements.some((text) => text.includes("remove_"))).toBe(false);
  });

  test("a 1.2.0 database detaches its POLICIES before it renames anything", async () => {
    // A retention policy FOLLOWS a rename, so detaching afterwards would have to
    // know the legacy names — and detaching at all is what stops the old minute
    // tier's 90-day retention from eating the history mid-upgrade.
    const logged: string[] = [];
    const { client } = fake({
      relations: ["metrics_raw", "minute_rollups", "app_settings"],
      rawColumns: ["time", "inverter_id", "metric", "value"],
      rawWindow: { from: "2026-08-20T00:00:00Z", to: "2026-08-27T00:00:00Z" },
      rawSourceIds: ["deye.sun-12k"],
    });
    const result = await runBlockingUpgrade(client, {
      ...baselineInput,
      logger: { log: (message) => logged.push(message) },
    });
    const applied = result?.applied ?? [];
    const firstRename = applied.findIndex((text) => text.startsWith("alter"));
    const lastDetach = applied.reduce(
      (last, text, index) => (text.includes("remove_") ? index : last),
      -1,
    );
    expect(lastDetach).toBeGreaterThanOrEqual(0);
    expect(firstRename).toBeGreaterThan(lastDetach);
    expect(logged[0]).toContain("detaching its policies");
  });
});

describe("readMigrationRecord", () => {
  const record = {
    stage: "cutover",
    cutoverAt: "2026-08-27T10:00:00.000Z",
    sourceId: "deye.sun-12k",
    legacyRawFrom: "2026-08-20T00:00:00.000Z",
    legacyRawTo: "2026-08-27T00:00:00.000Z",
    replayTo: "2026-08-20T00:00:00.000Z",
  };

  test("reads the record a previous step wrote", async () => {
    const { client } = fake({ record });
    expect(await readMigrationRecord(client)).toMatchObject({
      stage: "cutover",
      sourceId: "deye.sun-12k",
    });
  });

  test("a record stored AS A JSON STRING is still read — that is the real 1.2.0 shape", async () => {
    // Every `app_settings` row on a real 1.2.0 database is a jsonb string holding
    // the document. Reading it as `{}` would report "no migration happened here"
    // on a database in the middle of one, and the resume path would restart the
    // whole backfill with no source id.
    const { client } = fake({ record: JSON.stringify(record) });
    expect(await readMigrationRecord(client)).toMatchObject({ sourceId: "deye.sun-12k" });
  });

  test("no row at all is the NEVER-MIGRATED default, not a crash", async () => {
    const { client } = fake({});
    expect((await readMigrationRecord(client)).stage).toBe("none");
  });

  test("a row this build cannot read falls back to the default rather than half of it", async () => {
    // A partially-readable record is the worst outcome: it would license a step to
    // resume from a watermark it invented.
    const { client } = fake({ record: { stage: "not a stage this build knows" } });
    expect((await readMigrationRecord(client)).stage).toBe("none");
  });

  test("the record lives under the one key both schema generations share", async () => {
    const { client, statements } = fake({});
    await readMigrationRecord(client);
    // `app_settings` is writable BEFORE the 2.0.0 baseline has created anything,
    // which is why the record lives there and not in a table of its own.
    expect(statements.some((text) => text.includes("app_settings"))).toBe(true);
    expect(MIGRATION_KEY.length).toBeGreaterThan(0);
  });
});

describe("carryLegacyRaw", () => {
  test("goes through the shared replay, stamping the MEASURED cadence as the hold", async () => {
    // A poll sample's duration is the poll interval, not a bucket width — and it
    // is the same statements, the same identity join and the same
    // one-transaction-per-day watermark as every other row movement in 2.0.0.
    const { client } = fake({
      replayRows: 86_400,
      // The last raw sample of the day; the replay treats a raw row's `time` as a
      // bucket start, so the window ends one minute later, exactly at midnight.
      window: { from: "2026-08-20T00:00:00Z", to: "2026-08-20T23:59:00Z" },
    });
    const result = await carryLegacyRaw(client, {
      sourceId: "deye.sun-12k",
      deviceId: 1,
      durMs: 1000,
    });
    expect(result.seriesRows).toBe(86_400);
    expect(result.chunks).toHaveLength(1);
    expect(result.gaps).toEqual([]);
  });

  test("an empty retained window carries nothing and reports nothing", async () => {
    const { client } = fake({});
    const result = await carryLegacyRaw(client, {
      sourceId: "deye.sun-12k",
      deviceId: 1,
      durMs: null,
    });
    expect(result.seriesRows).toBe(0);
    expect(result.chunks).toEqual([]);
  });
});

describe("dropLegacyStatements", () => {
  const state = (names: string[]): CatalogState => ({
    relations: new Set(names),
    indexes: new Set<string>(),
    constraints: new Set<string>(),
    columns: new Map<string, Set<string>>(),
  });

  test("the AGGREGATES go first and the hypertable LAST", async () => {
    // Dropping the hypertable while an aggregate still depends on it would need
    // `CASCADE`, and a `DROP … CASCADE` on the one copy of the history is not a
    // statement worth having in the codebase.
    const statements = dropLegacyStatements(
      state([
        "metrics_raw_legacy",
        "legacy_minute_rollups",
        "legacy_hourly_rollups",
        "legacy_daily_rollups",
      ]),
    );
    expect(statements).toEqual([
      "drop materialized view legacy_minute_rollups",
      "drop materialized view legacy_hourly_rollups",
      "drop materialized view legacy_daily_rollups",
      "drop table metrics_raw_legacy",
    ]);
  });

  test("only what is actually there is dropped — a half-dropped database is resumable", async () => {
    expect(dropLegacyStatements(state(["legacy_daily_rollups"]))).toEqual([
      "drop materialized view legacy_daily_rollups",
    ]);
  });

  test("nothing left to drop is an empty list, not a failing statement", async () => {
    expect(dropLegacyStatements(state(["metrics_raw", "app_settings"]))).toEqual([]);
  });
});

describe("pgUpgradeClient", () => {
  test("hands the statement and its parameters to pg and returns the rows", async () => {
    const seen: { text: string; values: unknown[] | undefined }[] = [];
    const client = pgUpgradeClient({
      query: async (text: string, values?: unknown[]) => {
        seen.push({ text, values });
        return { rows: [{ n: 1 }] };
      },
    } as never);
    const result = await client.query("select $1", [42]);
    expect(seen).toEqual([{ text: "select $1", values: [42] }]);
    expect(result.rows).toEqual([{ n: 1 }]);
  });

  test("a statement with no parameters passes UNDEFINED, not an empty array", async () => {
    // `pg` treats an empty values array as a prepared statement with no
    // parameters, which some DDL will not accept.
    const seen: (unknown[] | undefined)[] = [];
    const client = pgUpgradeClient({
      query: async (_text: string, values?: unknown[]) => {
        seen.push(values);
        return { rows: [] };
      },
    } as never);
    await client.query("create schema if not exists drizzle");
    expect(seen).toEqual([undefined]);
  });
});
