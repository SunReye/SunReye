/**
 * The replay executor's CONTROL FLOW, against a recording double.
 *
 * The statements themselves are proved by executing them —
 * `apps/server/db-tests/replay.test.ts` against a real TimescaleDB, and
 * `scripts/replay-rehearsal.ts` against the real addon-1.2.0 fixture. What a
 * database cannot cheaply prove is the ORDER and the REFUSALS, and both are
 * load-bearing on a migration that gets one attempt:
 *
 *  * a chunk's rows and its watermark row commit together, or the chunk is rolled
 *    back with no watermark at all;
 *  * an unregistered metric key stops the run BEFORE anything is written, rather
 *    than half way through;
 *  * chunks run in ascending time order, which is what makes the config arm's
 *    "last value before this chunk" lookup exact rather than approximate.
 *
 * `ReplayClient` is structural precisely so this file can drive all of it without
 * a database.
 */
import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import {
  type ReplayClient,
  type ReplayRequest,
  bunSqlClient,
  completedChunks,
  metricKeyWriter,
  readTierWindows,
  replayChunk,
  runReplay,
  unregisteredMetrics,
} from "./replay-run";

interface Call {
  text: string;
  values: unknown[];
}

/** What the double answers, per statement, matched on what the statement is. */
interface Responses {
  windows?: (relation: string) => Record<string, unknown>[];
  unregistered?: (relation: string) => Record<string, unknown>[];
  completed?: Record<string, unknown>[];
  seriesRows?: number;
  configRows?: number;
  failOn?: RegExp;
}

/** The relation a statement reads from, for a double that answers per tier. */
const relationOf = (text: string): string => text.match(/from\s+([a-z_][a-z0-9_]*)\s+b/)?.[1] ?? "";

/**
 * Which answer each statement gets, as a TABLE rather than a chain of `if`s: the
 * double is dispatch, and dispatch spelled as branches is what makes a helper
 * more complex than the code it tests.
 */
const ROUTES: [RegExp, (r: Responses, text: string) => unknown[]][] = [
  [/min\(b\./, (r, text) => r.windows?.(relationOf(text)) ?? []],
  [/not exists/, (r, text) => r.unregistered?.(relationOf(text)) ?? []],
  [/select chunk_start/, (r) => r.completed ?? []],
  [/insert into metrics_raw/, (r) => [{ n: String(r.seriesRows ?? 0) }]],
  [/insert into metrics_config_log/, (r) => [{ n: String(r.configRows ?? 0) }]],
];

function fake(responses: Responses = {}): { client: ReplayClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: ReplayClient = {
    async query(text, values) {
      calls.push({ text, values: values ? [...values] : [] });
      if (responses.failOn?.test(text)) throw new Error("database said no");
      const route = ROUTES.find(([pattern]) => pattern.test(text));
      return { rows: route ? route[1](responses, text) : [] };
    },
  };
  return { client, calls };
}

const texts = (calls: readonly Call[]): string[] =>
  calls.map((call) => call.text.trim().split("\n")[0]?.trim() ?? "");

const request = (over: Partial<ReplayRequest> = {}): ReplayRequest => ({
  source: "legacy",
  relations: { minute: "legacy_minute_rollups" },
  identity: { sourceId: "profile-id", deviceId: 7 },
  ...over,
});

describe("bunSqlClient", () => {
  test("hands the statement and its parameters to bun's SQL and returns the rows", async () => {
    const seen: { query: string; values?: unknown[] }[] = [];
    const client = bunSqlClient({
      unsafe: async (query, values) => {
        seen.push({ query, values });
        return [{ n: "3" }];
      },
    });
    const result = await client.query("select $1", [42]);
    expect(seen).toEqual([{ query: "select $1", values: [42] }]);
    expect(result.rows).toEqual([{ n: "3" }]);
  });

  test("a statement with no parameters still passes an empty list", async () => {
    const seen: unknown[][] = [];
    const client = bunSqlClient({
      unsafe: async (_query, values) => {
        seen.push(values as unknown[]);
        return [];
      },
    });
    await client.query("begin");
    expect(seen).toEqual([[]]);
  });

  test("a driver that answers with something other than rows yields no rows, not a crash", async () => {
    const client = bunSqlClient({ unsafe: async () => undefined });
    expect((await client.query("commit")).rows).toEqual([]);
  });
});

describe("metricKeyWriter", () => {
  test("renders a drizzle statement to text and positional parameters", async () => {
    const { client, calls } = fake();
    const result = await metricKeyWriter(client).execute(sql`select ${"a"}, ${2}`);
    expect(calls[0]?.text).toBe("select $1, $2");
    expect(calls[0]?.values).toEqual(["a", 2]);
    expect(result.rows).toEqual([]);
  });
});

describe("readTierWindows", () => {
  test("ends the window one bucket WIDTH past the last bucket", async () => {
    // A bucket stamped 23:00 covers up to 00:00. Treating max(bucket) as the end
    // would leave the last hour of history unreplayed on every run.
    const { client } = fake({
      windows: () => [{ from: "2026-06-01T00:00:00Z", to: "2026-07-31T23:00:00Z" }],
    });
    const windows = await readTierWindows(
      client,
      request({ relations: { hourly: "legacy_hourly_rollups" } }),
    );
    expect(windows).toEqual([
      {
        tier: "hourly",
        from: new Date("2026-06-01T00:00:00Z"),
        to: new Date("2026-08-01T00:00:00Z"),
      },
    ]);
  });

  test("omits a tier that holds nothing for this source rather than inventing an empty window", async () => {
    const { client } = fake({
      windows: (relation) =>
        relation === "legacy_minute_rollups"
          ? [{ from: "2026-06-01T00:00:00Z", to: "2026-06-01T00:01:00Z" }]
          : [{ from: null, to: null }],
    });
    const windows = await readTierWindows(
      client,
      request({ relations: { minute: "legacy_minute_rollups", daily: "legacy_daily_rollups" } }),
    );
    expect(windows.map((w) => w.tier)).toEqual(["minute"]);
  });

  test("a tier that answers no row at all is omitted too", async () => {
    const { client } = fake({ windows: () => [] });
    expect(await readTierWindows(client, request())).toEqual([]);
  });

  test("scopes every read to the source id", async () => {
    const { client, calls } = fake({ windows: () => [] });
    await readTierWindows(client, request());
    expect(calls[0]?.values).toEqual(["profile-id"]);
  });

  test("reads the column names it is given, not 1.2.0's, when a source has its own", async () => {
    const { client, calls } = fake({ windows: () => [] });
    await readTierWindows(
      client,
      request({
        columns: { bucket: "ts", sourceId: "src", metric: "name", value: "mean" },
      }),
    );
    expect(calls[0]?.text).toContain("min(b.ts)");
    expect(calls[0]?.text).toContain("b.src = $1");
  });

  test("refuses a relation or column name that is not a bare identifier", async () => {
    const { client } = fake();
    await expect(
      readTierWindows(client, request({ relations: { minute: "a; drop" } })),
    ).rejects.toThrow(/identifier/);
    await expect(
      readTierWindows(
        client,
        request({ columns: { bucket: "b UNION", sourceId: "s", metric: "m", value: "v" } }),
      ),
    ).rejects.toThrow(/identifier/);
  });
});

describe("unregisteredMetrics", () => {
  test("collects the keys no dimension row exists for, deduplicated and sorted", async () => {
    const { client } = fake({
      unregistered: (relation) =>
        relation === "legacy_minute_rollups"
          ? [{ metric: "z.gone" }, { metric: "a.gone" }]
          : [{ metric: "a.gone" }],
    });
    const missing = await unregisteredMetrics(
      client,
      request({ relations: { minute: "legacy_minute_rollups", hourly: "legacy_hourly_rollups" } }),
      ["minute", "hourly"],
    );
    expect(missing).toEqual(["a.gone", "z.gone"]);
  });

  test("is empty when every key resolves", async () => {
    const { client } = fake();
    expect(await unregisteredMetrics(client, request(), ["minute"])).toEqual([]);
  });

  test("refuses to ask about a tier no relation is configured for", async () => {
    const { client } = fake();
    await expect(unregisteredMetrics(client, request(), ["daily"])).rejects.toThrow(
      /no relation configured for tier daily/,
    );
  });
});

describe("completedChunks", () => {
  test("normalizes whatever the driver returns to ISO instants", async () => {
    const { client } = fake({
      completed: [
        { chunk_start: new Date("2026-07-01T00:00:00Z") },
        { chunk_start: "2026-07-02 00:00:00+00" },
      ],
    });
    expect([...(await completedChunks(client, request()))].sort()).toEqual([
      "2026-07-01T00:00:00.000Z",
      "2026-07-02T00:00:00.000Z",
    ]);
  });

  test("is keyed by source AND device, so two replays cannot see each other's days", async () => {
    const { client, calls } = fake();
    await completedChunks(client, request());
    expect(calls[0]?.values).toEqual(["legacy", 7]);
  });
});

const chunk = {
  tier: "minute" as const,
  start: new Date("2026-07-01T00:00:00Z"),
  end: new Date("2026-07-02T00:00:00Z"),
};

describe("replayChunk", () => {
  test("writes the rows AND the watermark inside one transaction, in that order", async () => {
    const { client, calls } = fake({ seriesRows: 155_520, configRows: 3 });
    const result = await replayChunk(client, request({ configKeys: ["settings.a"] }), chunk);
    expect(texts(calls)).toEqual([
      "begin",
      "with ins as (",
      "with src as (",
      "insert into replay_progress",
      "commit",
    ]);
    expect(result.seriesRows).toBe(155_520);
    expect(result.configRows).toBe(3);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test("skips the config statement entirely when the profile stores nothing as config", async () => {
    const { client, calls } = fake({ seriesRows: 10 });
    const result = await replayChunk(client, request(), chunk);
    expect(texts(calls)).toEqual([
      "begin",
      "with ins as (",
      "insert into replay_progress",
      "commit",
    ]);
    expect(result.configRows).toBe(0);
  });

  test("the watermark row carries the span, the tier and the counts", async () => {
    const { client, calls } = fake({ seriesRows: 12 });
    await replayChunk(client, request(), chunk);
    const progress = calls.find((call) => call.text.includes("insert into replay_progress"));
    expect(progress?.values.slice(0, 7)).toEqual([
      "legacy",
      7,
      "2026-07-01T00:00:00.000Z",
      "2026-07-02T00:00:00.000Z",
      "minute",
      12,
      0,
    ]);
  });

  test("carries the tier's width as dur_ms — an hourly chunk claims an hour, not a minute", async () => {
    const { client, calls } = fake();
    await replayChunk(client, request({ relations: { hourly: "legacy_hourly_rollups" } }), {
      ...chunk,
      tier: "hourly",
    });
    const insert = calls.find((call) => call.text.includes("insert into metrics_raw"));
    expect(insert?.values[4]).toBe(3_600_000);
  });

  test("a failing insert ROLLS BACK and never commits, so the chunk keeps no watermark", async () => {
    const { client, calls } = fake({ failOn: /insert into metrics_raw/ });
    await expect(replayChunk(client, request(), chunk)).rejects.toThrow("database said no");
    expect(texts(calls)).toEqual(["begin", "with ins as (", "rollback"]);
    expect(texts(calls)).not.toContain("commit");
  });

  test("a failing WATERMARK write rolls the rows back with it — neither half can survive alone", async () => {
    const { client, calls } = fake({ failOn: /insert into replay_progress/ });
    await expect(replayChunk(client, request(), chunk)).rejects.toThrow("database said no");
    expect(texts(calls).at(-1)).toBe("rollback");
  });
});

describe("runReplay", () => {
  const windows = () => [{ from: "2026-07-01T00:00:00Z", to: "2026-07-02T23:59:00Z" }];

  test("does nothing at all when no tier holds anything for this source", async () => {
    const { client, calls } = fake({ windows: () => [] });
    const result = await runReplay(client, request());
    expect(result).toEqual({
      chunks: [],
      skipped: 0,
      seriesRows: 0,
      configRows: 0,
      gaps: [],
      elapsedMs: 0,
    });
    expect(texts(calls)).not.toContain("begin");
  });

  test("plans a chunk per day, runs them in ascending order and sums the rows", async () => {
    const { client, calls } = fake({ windows, seriesRows: 100, configRows: 1 });
    const seen: string[] = [];
    const result = await runReplay(client, request({ configKeys: ["settings.a"] }), {
      onChunk: (done, index, total) =>
        seen.push(`${index + 1}/${total} ${done.start.toISOString()}`),
    });
    // The window ends 2026-07-02T23:59 plus one minute, so the span is exactly
    // two days: the last bucket's own width is what closes it.
    expect(result.chunks.map((c) => c.start.toISOString())).toEqual([
      "2026-07-01T00:00:00.000Z",
      "2026-07-02T00:00:00.000Z",
    ]);
    expect(result.seriesRows).toBe(200);
    expect(result.configRows).toBe(2);
    expect(result.skipped).toBe(0);
    expect(seen).toEqual(["1/2 2026-07-01T00:00:00.000Z", "2/2 2026-07-02T00:00:00.000Z"]);
    expect(texts(calls).filter((t) => t === "commit")).toHaveLength(2);
  });

  test("subtracts the chunks a previous run committed and reports them as skipped", async () => {
    const { client } = fake({
      windows,
      seriesRows: 100,
      completed: [{ chunk_start: "2026-07-01T00:00:00Z" }],
    });
    const result = await runReplay(client, request());
    expect(result.skipped).toBe(1);
    expect(result.chunks.map((c) => c.start.toISOString())).toEqual(["2026-07-02T00:00:00.000Z"]);
  });

  test("a finished source replays nothing on a re-run", async () => {
    const { client, calls } = fake({
      windows,
      completed: [{ chunk_start: "2026-07-01T00:00:00Z" }, { chunk_start: "2026-07-02T00:00:00Z" }],
    });
    const result = await runReplay(client, request());
    expect(result.chunks).toEqual([]);
    expect(result.skipped).toBe(2);
    expect(texts(calls)).not.toContain("begin");
  });

  test("refuses BEFORE writing anything when a source metric is unregistered", async () => {
    const { client, calls } = fake({ windows, unregistered: () => [{ metric: "gone.metric" }] });
    await expect(runReplay(client, request())).rejects.toThrow(
      /not registered in metric_keys.*gone\.metric/s,
    );
    expect(texts(calls)).not.toContain("begin");
  });

  test("honours an explicit span rather than the tier's whole window", async () => {
    const { client } = fake({ windows, seriesRows: 5 });
    const result = await runReplay(
      client,
      request({ from: new Date("2026-07-02T06:00:00Z"), to: new Date("2026-07-02T12:00:00Z") }),
    );
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.end.toISOString()).toBe("2026-07-02T12:00:00.000Z");
  });

  test("reports a day no tier covers as a gap instead of writing a short history in silence", async () => {
    const { client } = fake({ windows, seriesRows: 5 });
    const result = await runReplay(
      client,
      request({ from: new Date("2026-06-29T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") }),
    );
    expect(result.gaps.map((g) => g.start.toISOString())).toEqual([
      "2026-06-29T00:00:00.000Z",
      "2026-06-30T00:00:00.000Z",
    ]);
    expect(result.chunks).toHaveLength(1);
  });

  test("checks only the tiers the plan actually uses", async () => {
    // A `daily` relation that covers nothing must not be scanned for unknown
    // metric keys: on a real database that is a full pass over the tier.
    const { client, calls } = fake({
      windows: (relation) =>
        relation === "legacy_minute_rollups"
          ? windows()
          : [{ from: "2020-01-01T00:00:00Z", to: "2020-01-01T00:00:00Z" }],
      seriesRows: 1,
    });
    await runReplay(
      client,
      request({
        relations: { minute: "legacy_minute_rollups", daily: "legacy_daily_rollups" },
        from: new Date("2026-07-01T00:00:00Z"),
        to: new Date("2026-07-02T00:00:00Z"),
      }),
    );
    const scans = calls.filter((call) => call.text.includes("not exists"));
    expect(scans).toHaveLength(1);
    expect(scans[0]?.text).toContain("legacy_minute_rollups");
  });
});
