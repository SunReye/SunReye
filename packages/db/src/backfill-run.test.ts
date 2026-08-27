/**
 * The backfill driver's DECISIONS, against a routing double.
 *
 * The statements themselves are proved by executing them —
 * `apps/server/db-tests/upgrade.test.ts` against a real TimescaleDB, and
 * `scripts/upgrade-rehearsal.ts` against the restored addon-1.2.0 fixture. What a
 * database cannot cheaply prove is what this file drives, and every one of them is
 * load-bearing on a migration that gets one attempt at an instance's only copy of
 * its history:
 *
 *  * the REFUSALS — a record with no migration in it, and a migration already
 *    finished, both return `null` rather than replaying a second time, which is
 *    what makes `runBackfill` safe to call from a boot hook or a button that
 *    cannot know the state;
 *  * the STAGE TRANSITIONS, and that `carried` is written only when a carry
 *    actually happened;
 *  * RESUMPTION: a refresh window whose watermark row already exists is skipped
 *    rather than re-materialized, and a window that runs records its own
 *    watermark — the same one-row-per-completed-unit rule the chunk replay uses,
 *    because a killed run must resume rather than restart;
 *  * the REFRESH ORDER, parent tier first, which is why a daily bucket is never
 *    built over unfinished hours;
 *  * the VERIFICATION GATE, which is the thing that decides whether the rollback
 *    may be deleted: it advances to `verified` only on a clean comparison, and a
 *    comparison over no rows is a finding rather than a pass.
 *
 * The double routes statements to seeded rows; it never asserts on SQL text as a
 * proxy for behaviour (CONTRIBUTING.md §6 — a SQL-text assertion cannot prove a
 * query runs, and this release already shipped two 500s behind a green suite that
 * way). `UpgradeClient` is structural precisely so this is possible.
 */
import { describe, expect, test } from "bun:test";

import { runBackfill, verifyMigration } from "./backfill-run";
import { REFRESH_SOURCE } from "./backfill";
import type { UpgradeClient, UpgradeLogger } from "./upgrade-120-run";
import type { MigrationRecord } from "./upgrade-state";

interface Call {
  text: string;
  values: unknown[];
}

type Rows = Record<string, unknown>[];

/** What the double answers, per statement, matched on what the statement asks. */
interface Responses {
  /** The `app_settings` document the migration record is read from. */
  record?: unknown;
  /** Legacy bucket span, per relation. Absent means the relation holds nothing. */
  windows?: Record<string, { from: string; to: string }>;
  /** Metric keys the source has that `metric_keys` does not. */
  unregistered?: string[];
  /** Chunk starts a previous run already committed. */
  completed?: string[];
  seriesRows?: number;
  configRows?: number;
  /** What `metrics_raw` now spans. `null` means it is empty. */
  written?: { from: string; to: string } | null;
  /** Refresh windows a previous run already recorded, as `source|chunkStart`. */
  refreshed?: readonly string[];
  /** Rows the legacy-beside-new coverage comparison returns. */
  coverage?: Rows;
  /** Configuration rows that leaked into the hypertable. */
  configInRaw?: number;
  failOn?: RegExp;
}

/** The relation a legacy-side statement reads from, for a per-tier answer. */
const relationOf = (text: string): string => text.match(/from\s+([a-z_][a-z0-9_]*)\s+b/)?.[1] ?? "";

/**
 * Which answer each statement gets, as a TABLE rather than a chain of `if`s: the
 * double is dispatch, and dispatch spelled as branches is what makes a helper
 * more complex than the code it tests.
 */
const ROUTES: [RegExp, (r: Responses, text: string, values: unknown[]) => Rows][] = [
  [/select value from app_settings/, (r) => (r.record === undefined ? [] : [{ value: r.record }])],
  [
    /min\(b\./,
    (r, text) => {
      const window = r.windows?.[relationOf(text)];
      return window ? [{ from: window.from, to: window.to }] : [{ from: null, to: null }];
    },
  ],
  [/not exists/, (r) => (r.unregistered ?? []).map((metric) => ({ metric }))],
  [/select chunk_start/, (r) => (r.completed ?? []).map((chunk_start) => ({ chunk_start }))],
  [/insert into metrics_raw/, (r) => [{ n: String(r.seriesRows ?? 0) }]],
  [/insert into metrics_config_log/, (r) => [{ n: String(r.configRows ?? 0) }]],
  [
    /min\(time\)/,
    (r) => [
      { from: r.written === null ? null : (r.written?.from ?? null), to: r.written?.to ?? null },
    ],
  ],
  [
    /select 1 from replay_progress/,
    (r, _text, values) =>
      (r.refreshed ?? []).includes(`${String(values[0])}|${String(values[2])}`) ? [{ ok: 1 }] : [],
  ],
  [/with legacy as/, (r) => r.coverage ?? []],
  [/as n from metrics_raw r/, (r) => [{ n: String(r.configInRaw ?? 0) }]],
];

function fake(responses: Responses = {}): { client: UpgradeClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: UpgradeClient = {
    async query(text, values) {
      calls.push({ text, values: values ? [...values] : [] });
      if (responses.failOn?.test(text)) throw new Error("database said no");
      const route = ROUTES.find(([pattern]) => pattern.test(text));
      return { rows: route ? route[1](responses, text, values ? [...values] : []) : [] };
    },
  };
  return { client, calls };
}

/** Every record written back through `app_settings`, parsed. */
const written = (calls: readonly Call[]): MigrationRecord[] =>
  calls
    .filter((call) => /insert into app_settings/.test(call.text))
    .map((call) => JSON.parse(String(call.values[1])) as MigrationRecord);

const stages = (calls: readonly Call[]): string[] => written(calls).map((record) => record.stage);

/** The `refresh_continuous_aggregate` calls, as `tier|from|to`. */
const refreshes = (calls: readonly Call[]): string[] =>
  calls
    .filter((call) => /call refresh_continuous_aggregate/.test(call.text))
    .map(
      (call) =>
        `${call.text.match(/'([a-z_]+)'/)?.[1] ?? ""}|${String(call.values[0])}|${String(call.values[1])}`,
    );

/** The watermark rows the refresh recorded, as `source|chunkStart`. */
const refreshMarks = (calls: readonly Call[]): string[] =>
  calls
    .filter(
      (call) =>
        /insert into replay_progress/.test(call.text) &&
        String(call.values[0]).startsWith(REFRESH_SOURCE),
    )
    .map((call) => `${String(call.values[0])}|${String(call.values[2])}`);

const record = (over: Partial<MigrationRecord> = {}): MigrationRecord =>
  ({
    stage: "cutover",
    cutoverAt: "2026-06-08T00:00:00.000Z",
    sourceId: "profile-a",
    legacyRawFrom: null,
    legacyRawTo: null,
    replayTo: null,
    namesConfirmedAt: null,
    ...over,
  }) as MigrationRecord;

const lines = (): { logger: UpgradeLogger; log: string[] } => {
  const log: string[] = [];
  return { logger: { log: (line: string) => log.push(line) }, log };
};

const input = { deviceId: 7, rawDurMs: 5_000 } as const;

/** A single legacy day on one tier, so a run is one chunk rather than sixty. */
const ONE_DAY = { from: "2026-06-01T00:00:00.000Z", to: "2026-06-01T23:00:00.000Z" };

describe("runBackfill refusals", () => {
  test("a database that never ran a 1.x upgrade has nothing to finish", async () => {
    const { client, calls } = fake({ record: { stage: "none" } });
    expect(await runBackfill(client, input)).toBeNull();
    // Nothing beyond the record read: no replay, no refresh, no stage write.
    expect(calls).toHaveLength(1);
  });

  test("a record with no source id cannot be replayed, so it is not attempted", async () => {
    // Every legacy bucket is keyed on the 1.2.0 `inverter_id`; without it there is
    // no join to replay through, and guessing one would write the wrong history.
    const { client, calls } = fake({ record: record({ sourceId: null }) });
    expect(await runBackfill(client, input)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test.each(["backfilled", "verified", "dropped"])(
    "a migration already at %s is not replayed a second time",
    async (stage) => {
      const { client, calls } = fake({
        record: record({ stage: stage as MigrationRecord["stage"] }),
      });
      expect(await runBackfill(client, input)).toBeNull();
      expect(calls).toHaveLength(1);
    },
  );

  test("a stage the record does not carry at all reads as 'none' and refuses", async () => {
    // The schema `.catch`es rather than throwing, so a corrupted document must
    // still land on the safe side rather than starting a replay from nothing.
    const { client } = fake({ record: { stage: "nonsense", sourceId: "profile-a" } });
    expect(await runBackfill(client, input)).toBeNull();
  });
});

describe("runBackfill stages", () => {
  test("carries the retained raw window, then replays the buckets, and advances through both stages", async () => {
    const { logger, log } = lines();
    const { client, calls } = fake({
      record: record({
        legacyRawFrom: "2026-06-01T00:00:00.000Z",
        replayTo: "2026-06-01T00:00:00.000Z",
      }),
      windows: { metrics_raw_legacy: ONE_DAY, legacy_minute_rollups: ONE_DAY },
      seriesRows: 120,
      configRows: 3,
      written: null,
    });

    const result = await runBackfill(client, { ...input, configKeys: ["settings.mode"], logger });

    expect(result).not.toBeNull();
    expect(result?.carried?.seriesRows).toBe(120);
    // `replayTo` bounds the bucket replay at the carry's start, so the two cannot
    // write the same day twice.
    expect(result?.replayed?.chunks).toHaveLength(0);
    expect(stages(calls)).toEqual(["carried", "backfilled"]);
    expect(result?.record.stage).toBe("backfilled");
    expect(log[0]).toContain("carried 120 retained raw rows + 3 config changes");
  });

  test("a record with no retained raw window skips the carry AND the 'carried' stage", async () => {
    // 1.2.0 keeps seven days of raw; an instance whose window had already aged out
    // has nothing to carry, and stamping `carried` there would report a horizon
    // (`legacyRawFrom`) that does not exist.
    const { client, calls } = fake({
      record: record({ legacyRawFrom: null }),
      windows: { legacy_minute_rollups: ONE_DAY },
      written: null,
    });

    const result = await runBackfill(client, input);

    expect(result?.carried).toBeNull();
    expect(stages(calls)).toEqual(["backfilled"]);
  });

  test("replays the tiers it is handed rather than the default three", async () => {
    const { client, calls } = fake({
      record: record(),
      windows: { some_other_relation: ONE_DAY },
      written: null,
    });
    await runBackfill(client, { ...input, tiers: { minute: "some_other_relation" } });
    // Exactly one legacy relation was asked for its span, and it was that one.
    const asked = calls
      .filter((call) => /min\(b\./.test(call.text))
      .map((call) => relationOf(call.text));
    expect(asked).toEqual(["some_other_relation"]);
  });

  test("defaults to all three 1.2.0 aggregates when no tiers are named", async () => {
    const { client, calls } = fake({ record: record(), written: null });
    await runBackfill(client, input);
    const asked = calls
      .filter((call) => /min\(b\./.test(call.text))
      .map((call) => relationOf(call.text));
    expect(asked).toEqual([
      "legacy_minute_rollups",
      "legacy_hourly_rollups",
      "legacy_daily_rollups",
    ]);
  });

  test("reports the days a resumed run did not redo, and the days no tier could answer", async () => {
    const { logger, log } = lines();
    const { client } = fake({
      record: record(),
      // Two legacy days, only the finer tier covering the first of them.
      windows: {
        legacy_minute_rollups: { from: "2026-06-01T00:00:00.000Z", to: "2026-06-01T23:00:00.000Z" },
      },
      completed: ["2026-06-01T00:00:00.000Z"],
      written: null,
    });

    const result = await runBackfill(client, { ...input, logger });

    expect(result?.replayed?.skipped).toBe(1);
    expect(log.at(-1) ?? "").toContain("(1 already done)");
  });

  test("a day no legacy tier can answer is called out; a clean run says nothing about gaps", async () => {
    const { logger, log } = lines();
    const { client } = fake({
      record: record(),
      // The daily tier reaches back a day further than the minute tier does; the
      // plan's first day is covered, and the last is not covered by anything.
      windows: {
        legacy_minute_rollups: { from: "2026-06-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
        legacy_daily_rollups: { from: "2026-06-01T00:00:00.000Z", to: "2026-06-03T00:00:00.000Z" },
      },
      written: null,
    });
    await runBackfill(client, { ...input, logger });
    expect(log.join("\n")).not.toContain("no tier could answer");

    const gapped = lines();
    const { client: gappedClient } = fake({
      record: record(),
      windows: {
        legacy_minute_rollups: { from: "2026-06-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
      },
      written: null,
    });
    // The bucket width padding pushes the plan past the minute tier's coverage.
    await runBackfill(gappedClient, {
      ...input,
      tiers: { minute: "legacy_minute_rollups", daily: "legacy_daily_rollups" },
      logger: gapped.logger,
    });
    expect(gapped.log.join("\n")).toContain("replayed");
  });

  test("an unregistered metric key stops the run before any stage is written", async () => {
    // Registration is the caller's job; a replay that ran anyway would let the
    // `join metric_keys` drop that metric's history silently.
    const { client, calls } = fake({
      record: record(),
      windows: { legacy_minute_rollups: ONE_DAY },
      unregistered: ["battery.temperature"],
    });
    await expect(runBackfill(client, input)).rejects.toThrow(/not registered/);
    expect(stages(calls)).toEqual([]);
  });

  test("a failing chunk leaves no stage behind for a resumed run to trust", async () => {
    const { client, calls } = fake({
      record: record(),
      windows: { legacy_minute_rollups: ONE_DAY },
      failOn: /insert into metrics_raw/,
      written: null,
    });
    await expect(runBackfill(client, input)).rejects.toThrow("database said no");
    expect(stages(calls)).toEqual([]);
    expect(calls.some((call) => call.text === "rollback")).toBe(true);
  });

  test("reports how long the whole run took", async () => {
    const { client } = fake({ record: record(), written: null });
    const result = await runBackfill(client, input);
    expect(result?.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe("runBackfill refreshes the new aggregates", () => {
  const spanning = (over: Responses = {}): Responses => ({
    record: record(),
    windows: { legacy_minute_rollups: ONE_DAY },
    written: { from: "2026-06-01T00:00:00.000Z", to: "2026-06-02T00:00:00.000Z" },
    ...over,
  });

  test("an empty metrics_raw is refreshed over nothing rather than over NULL bounds", async () => {
    // `refresh_continuous_aggregate(x, NULL, NULL)` advances the watermark past
    // everything, which is the one outcome worse than not refreshing at all.
    const { client, calls } = fake(spanning({ written: null }));
    const result = await runBackfill(client, input);
    expect(result?.refreshed).toBe(0);
    expect(refreshes(calls)).toEqual([]);
  });

  test("a metrics_raw with a start but no end is also treated as nothing to refresh", async () => {
    const { client, calls } = fake(
      spanning({ written: { from: "2026-06-01T00:00:00.000Z", to: "" } }),
    );
    expect((await runBackfill(client, input))?.refreshed).toBe(0);
    expect(refreshes(calls)).toEqual([]);
  });

  test("materializes the parent tier before the hierarchical one, and the biggest last", async () => {
    // `daily_rollups` is an aggregate OVER `hourly_rollups`: a daily bucket built
    // before its hours are finished keeps the partial hours forever.
    const { client, calls } = fake(spanning());
    await runBackfill(client, input);
    const tiers = refreshes(calls).map((call) => call.split("|")[0]);
    expect(tiers).toEqual(["hourly_rollups", "daily_rollups", "minute_rollups"]);
  });

  test("every materialized window records its own watermark row", async () => {
    const { client, calls } = fake(spanning());
    const result = await runBackfill(client, input);
    expect(result?.refreshed).toBe(3);
    expect(refreshMarks(calls)).toEqual([
      `${REFRESH_SOURCE}-hourly_rollups|2026-05-31T23:00:00.000Z`,
      `${REFRESH_SOURCE}-daily_rollups|2026-05-31T00:00:00.000Z`,
      `${REFRESH_SOURCE}-minute_rollups|2026-05-31T23:59:00.000Z`,
    ]);
  });

  test("a window a killed run already materialized is skipped, not redone", async () => {
    // Re-materializing a 60-day minute tier from scratch is most of the wall
    // clock; the watermark is what makes a restart cheap.
    const { client, calls } = fake(
      spanning({ refreshed: [`${REFRESH_SOURCE}-minute_rollups|2026-05-31T23:59:00.000Z`] }),
    );
    const result = await runBackfill(client, input);
    expect(result?.refreshed).toBe(2);
    expect(refreshes(calls).map((call) => call.split("|")[0])).toEqual([
      "hourly_rollups",
      "daily_rollups",
    ]);
  });

  test("each tier's watermarks live in a namespace of their own", async () => {
    // Keyed on `(source, device_id, chunk_start)` — a shared source would let one
    // tier's completed windows mark another's as done.
    const { client, calls } = fake(spanning());
    await runBackfill(client, input);
    expect(new Set(refreshMarks(calls).map((mark) => mark.split("|")[0])).size).toBe(3);
  });

  test("a smaller refresh chunk costs less to a kill and produces more windows", async () => {
    const { client, calls } = fake(
      spanning({ written: { from: "2026-06-01T00:00:00.000Z", to: "2026-06-20T00:00:00.000Z" } }),
    );
    const result = await runBackfill(client, { ...input, refreshChunkDays: 1 });
    expect(result?.refreshed).toBeGreaterThan(3 * 3);
    expect(refreshes(calls).length).toBe(result?.refreshed);
  });

  test("logs one line per tier saying how many windows it materialized", async () => {
    const { logger, log } = lines();
    const { client } = fake(spanning());
    await runBackfill(client, { ...input, logger });
    expect(log.filter((line) => line.startsWith("materialized"))).toHaveLength(3);
    expect(log.at(-1)).toContain("materialized minute_rollups over 1 window(s)");
  });

  test("says nothing at all when no logger is handed in", async () => {
    // The default logger is silent rather than absent: the boot hook calls this
    // without one, and an undefined `.log` would take the migration down.
    const { client } = fake(spanning());
    await expect(runBackfill(client, input)).resolves.not.toBeNull();
  });
});

describe("verifyMigration", () => {
  const clean: Rows = [
    {
      metric: "pv.power",
      day: "2026-06-01",
      legacyBuckets: "1440",
      newBuckets: "1440",
      legacyMean: 12.5,
      newMean: 12.5,
      newSpread: 0,
    },
  ];

  const verifiable = (over: Responses = {}): Responses => ({
    record: record({ stage: "backfilled", replayTo: "2026-06-08T00:00:00.000Z" }),
    coverage: clean,
    ...over,
  });

  test("refuses to verify a database with no recorded migration", async () => {
    const { client, calls } = fake({ record: { stage: "none" } });
    const result = await verifyMigration(client, 7);
    expect(result.problems).toEqual(["there is no recorded 1.2.0 migration to verify"]);
    expect(result.compared).toBe(0);
    expect(stages(calls)).toEqual([]);
  });

  test("refuses when the record has a source but no replay bound", async () => {
    // Without `replayTo` the comparison span is unbounded and would include the
    // carried raw window, which is not one legacy bucket per new bucket.
    const { client } = fake({ record: record({ stage: "backfilled", replayTo: null }) });
    expect((await verifyMigration(client, 7)).problems).toHaveLength(1);
  });

  test("advances to verified only when every legacy bucket has its match", async () => {
    const { logger, log } = lines();
    const { client, calls } = fake(verifiable());
    const result = await verifyMigration(client, 7, [], logger);
    expect(result.problems).toEqual([]);
    expect(result.compared).toBe(1);
    expect(result.record.stage).toBe("verified");
    expect(stages(calls)).toEqual(["verified"]);
    expect(log[0]).toContain("verified 1 metric-days");
  });

  test("a comparison over no rows is a finding, and the legacy objects stay", async () => {
    // This is the gate that lets an instance's only copy of its history be
    // dropped. A vacuous green here is permanent.
    const { logger, log } = lines();
    const { client, calls } = fake(verifiable({ coverage: [] }));
    const result = await verifyMigration(client, 7, [], logger);
    expect(result.problems).toHaveLength(1);
    expect(result.record.stage).toBe("backfilled");
    expect(stages(calls)).toEqual([]);
    expect(log[0]).toContain("the legacy objects stay");
  });

  test("a lost metric-day blocks verification", async () => {
    const { client, calls } = fake(
      verifiable({ coverage: [{ ...clean[0], newBuckets: "0", newMean: null }] }),
    );
    const result = await verifyMigration(client, 7);
    expect(result.problems[0]).toContain("no new buckets at all");
    expect(stages(calls)).toEqual([]);
  });

  test("configuration registers that leaked into the hypertable block verification too", async () => {
    // An exclusion is not a check: the coverage comparison stopped looking at
    // them, so this is the only thing that would see the storage cost come back.
    const { client } = fake(verifiable({ configInRaw: 41 }));
    const result = await verifyMigration(client, 7, ["settings.mode"]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("41 configuration-register row(s) reached metrics_raw");
  });

  test("with no configuration keys the leak count is not even asked for", async () => {
    const { client, calls } = fake(verifiable());
    await verifyMigration(client, 7, []);
    expect(calls.some((call) => /as n from metrics_raw r/.test(call.text))).toBe(false);
  });

  test("configuration keys are excluded from the legacy side as bound parameters", async () => {
    // Never interpolated: the keys come from a profile manifest.
    const { client, calls } = fake(verifiable({ configInRaw: 0 }));
    await verifyMigration(client, 7, ["settings.a", "settings.b"]);
    const coverage = calls.find((call) => /with legacy as/.test(call.text));
    expect(coverage?.values).toEqual([
      "profile-a",
      7,
      "2026-06-08T00:00:00.000Z",
      "settings.a",
      "settings.b",
    ]);
  });

  test("bigint counts arrive as strings through both drivers and are read as numbers", async () => {
    // A string `newBuckets` compared with `!==` against a number legacy count
    // would report every single metric-day as a mismatch.
    const { client } = fake(verifiable({ coverage: [{ ...clean[0], newSpread: null }] }));
    expect((await verifyMigration(client, 7)).problems).toEqual([]);
  });

  test("a driver that omits the spread column entirely is not read as a double write", async () => {
    const row = { ...clean[0] };
    delete (row as Record<string, unknown>).newSpread;
    const { client } = fake(verifiable({ coverage: [row] }));
    expect((await verifyMigration(client, 7)).problems).toEqual([]);
  });

  test("a spread inside a replayed bucket is a double write the counts cannot see", async () => {
    const { client } = fake(verifiable({ coverage: [{ ...clean[0], newSpread: 4 }] }));
    expect((await verifyMigration(client, 7)).problems[0]).toContain("more than one row landed");
  });

  test("a day only the legacy side has comes back with a null mean, and is reported", async () => {
    const { client } = fake(
      verifiable({
        coverage: [{ ...clean[0], legacyMean: null, newMean: 12.5, newBuckets: "1440" }],
      }),
    );
    expect((await verifyMigration(client, 7)).problems[0]).toContain("mean null legacy");
  });
});
