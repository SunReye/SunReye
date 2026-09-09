/**
 * READING the live horizons, and the memo around the read.
 *
 * `./history-horizon.test.ts` owns the RULE — which ranges are refusable at which
 * tier. This file owns everything between that rule and the database, and each of
 * these is a way to get the rule right and still ship #154:
 *
 *  * the CATALOG SHAPE. `drop_after` arrives as text through both drivers, and a
 *    string where a number belongs makes every comparison silently false — the
 *    refusal simply stops happening. `null` (kept forever) and `0` are opposites
 *    and must not collapse into each other.
 *  * the MIGRATION DOCUMENT. `app_settings.value` legitimately holds the record as
 *    a JSON STRING, and reading it as `{}` reports "no migration happened here" on
 *    a database in the middle of one — which is exactly the instance whose
 *    month-to-date figure would then be answered from a fraction of its window.
 *  * the MEMO. It caches the catalog, but `now` is re-read on every hit, because
 *    the retention horizon slides with the clock and a 30-second-old `now` lets a
 *    range through 30 seconds after it stopped being complete.
 *  * the REFUSAL BODY, whose `error` marker is what callers key on — an ordinary
 *    validation 422 lives on the same endpoints, so the status code cannot be the
 *    signal.
 *
 * The two statements themselves are proved by executing them, in
 * `apps/server/db-tests/history-horizon.test.ts`.
 */
import { afterEach, describe, expect, test } from "bun:test";

import {
  type HorizonIo,
  historyLimits,
  horizonIo,
  invalidateHistoryLimits,
  readHistoryLimits,
  refuseIncompleteRange,
} from "./history-horizon-live";

/** The memo is module state; every test starts without one. */
afterEach(() => invalidateHistoryLimits());

interface Seen {
  jobReads: number;
  recordReads: number;
}

const AT = new Date("2026-08-27T12:00:00.000Z");

function fake(over: Partial<HorizonIo> = {}): { io: HorizonIo; seen: Seen; clock: { now: Date } } {
  const seen: Seen = { jobReads: 0, recordReads: 0 };
  const clock = { now: AT };
  return {
    seen,
    clock,
    io: {
      retentionJobs: async () => {
        seen.jobReads++;
        return [];
      },
      migrationDocument: async () => {
        seen.recordReads++;
        return undefined;
      },
      now: () => clock.now,
      ...over,
    },
  };
}

describe("readHistoryLimits", () => {
  test("reads drop_after as DAYS, not as the text the catalog returns", async () => {
    // `"90" < 90` is false and `Number("90") < 90` is false too — but every
    // arithmetic comparison downstream is on the number, and a string there makes
    // the refusal quietly stop happening.
    const { io } = fake({
      retentionJobs: async () => [
        { hypertable_name: "minute_rollups", days: "90" },
        { hypertable_name: "metrics_raw", days: "1825.5" },
      ],
    });
    const limits = await readHistoryLimits(io);
    expect(limits.retention).toEqual([
      { hypertableName: "minute_rollups", dropAfterDays: 90 },
      { hypertableName: "metrics_raw", dropAfterDays: 1825.5 },
    ]);
  });

  test("a policy with no drop_after is KEPT FOREVER, which is not zero", async () => {
    // `daily_rollups` ships with no retention at all. Reading that as 0 would
    // refuse every read of the one tier that holds the whole history.
    const { io } = fake({
      retentionJobs: async () => [{ hypertable_name: "daily_rollups", days: null }],
    });
    expect((await readHistoryLimits(io)).retention[0]?.dropAfterDays).toBeNull();
  });

  test("an instance with no retention policies at all has no horizon from retention", async () => {
    const { io } = fake();
    expect((await readHistoryLimits(io)).retention).toEqual([]);
  });

  test("stamps the limits with the clock, because the horizon slides with it", async () => {
    const { io } = fake();
    expect((await readHistoryLimits(io)).now).toEqual(AT);
  });

  test("a database that never ran a 1.x migration withholds nothing", async () => {
    const { io } = fake({ migrationDocument: async () => undefined });
    expect((await readHistoryLimits(io)).migrationFrom).toBeNull();
  });

  test("an incomplete migration withholds everything before the cutover", async () => {
    const { io } = fake({
      migrationDocument: async () => ({
        stage: "cutover",
        cutoverAt: "2026-08-01T00:00:00.000Z",
      }),
    });
    expect((await readHistoryLimits(io)).migrationFrom).toEqual(
      new Date("2026-08-01T00:00:00.000Z"),
    );
  });

  test("a record stored AS A JSON STRING is still read as the record", async () => {
    // Every `app_settings` row in the 1.2.0 fixture is in exactly this shape, and
    // bun's SQL driver writes new ones that way too. Reading it as `{}` would
    // report "no migration here" on a database in the middle of one.
    const { io } = fake({
      migrationDocument: async () =>
        JSON.stringify({ stage: "cutover", cutoverAt: "2026-08-01T00:00:00.000Z" }),
    });
    expect((await readHistoryLimits(io)).migrationFrom).toEqual(
      new Date("2026-08-01T00:00:00.000Z"),
    );
  });

  test("a document that is not a record at all withholds nothing rather than taking the dashboard down", async () => {
    // Refusing every read over a bookkeeping field that failed to parse would be a
    // worse outcome than the one this guard exists to prevent.
    const { io } = fake({ migrationDocument: async () => "not a document" });
    expect((await readHistoryLimits(io)).migrationFrom).toBeNull();
  });

  test("a finished migration withholds nothing", async () => {
    const { io } = fake({
      migrationDocument: async () => ({ stage: "verified", cutoverAt: "2026-08-01T00:00:00.000Z" }),
    });
    expect((await readHistoryLimits(io)).migrationFrom).toBeNull();
  });
});

describe("historyLimits memo", () => {
  test("the catalog is read once, not once per chart load", async () => {
    const { io, seen } = fake();
    await historyLimits(io);
    await historyLimits(io);
    await historyLimits(io);
    expect(seen.jobReads).toBe(1);
    expect(seen.recordReads).toBe(1);
  });

  test("but `now` is re-read on every hit, because the horizon slides with the clock", async () => {
    // A 30-second-old `now` would let a range through 30 seconds after it stopped
    // being complete.
    const { io, clock } = fake();
    await historyLimits(io);
    clock.now = new Date(AT.getTime() + 5_000);
    expect((await historyLimits(io)).now).toEqual(clock.now);
  });

  test("the memo expires, so a finished backfill stops being reported as pending on its own", async () => {
    const { io, seen, clock } = fake();
    await historyLimits(io);
    clock.now = new Date(AT.getTime() + 30_001);
    await historyLimits(io);
    expect(seen.jobReads).toBe(2);
  });

  test("a read one tick inside the TTL is still served from the memo", async () => {
    const { io, seen, clock } = fake();
    await historyLimits(io);
    clock.now = new Date(AT.getTime() + 29_999);
    await historyLimits(io);
    expect(seen.jobReads).toBe(1);
  });

  test("invalidating makes the next read immediate, for the code that KNOWS the horizon moved", async () => {
    const { io, seen } = fake();
    await historyLimits(io);
    invalidateHistoryLimits();
    await historyLimits(io);
    expect(seen.jobReads).toBe(2);
  });
});

describe("refuseIncompleteRange", () => {
  const migrating = (): Partial<HorizonIo> => ({
    migrationDocument: async () => ({ stage: "cutover", cutoverAt: "2026-08-01T00:00:00.000Z" }),
  });

  test("a range wholly inside what this instance holds is not refused", async () => {
    const { io } = fake(migrating());
    const refusal = await refuseIncompleteRange(
      "day",
      { from: new Date("2026-08-10T00:00:00.000Z"), to: AT },
      io,
    );
    expect(refusal).toBeNull();
  });

  test("a month-to-date range that begins before the cutover is refused, loudly", async () => {
    // #154: a partial month-to-date figure reads as authoritative, which is worse
    // than no figure at all.
    const { io } = fake(migrating());
    const refusal = await refuseIncompleteRange(
      "day",
      { from: new Date("2026-07-25T00:00:00.000Z"), to: AT },
      io,
    );
    expect(refusal).not.toBeNull();
    // The BODY marker is the signal callers key on: an ordinary validation 422
    // lives on the same endpoints, so the status code cannot be it.
    expect(refusal?.error).toBe("history_incomplete");
    expect(refusal?.reason).toBe("migration-pending");
    expect(refusal?.tier).toBe("day");
    // The oldest instant that CAN be answered — what the UI offers to clamp to.
    expect(refusal?.from).toBe("2026-08-01T00:00:00.000Z");
    expect(refusal?.message).toContain("Answering it would return a real but incomplete number");
  });

  test("a range refused for retention says so, and names the tier that was asked for", async () => {
    const { io } = fake({
      retentionJobs: async () => [{ hypertable_name: "minute_rollups", days: "7" }],
    });
    const refusal = await refuseIncompleteRange(
      "minute",
      { from: new Date("2026-08-01T00:00:00.000Z"), to: AT },
      io,
    );
    expect(refusal?.reason).toBe("retention");
    expect(refusal?.tier).toBe("minute");
  });

  test("the same range at a coarser tier, whose retention is longer, is allowed", async () => {
    // Getting the tier-to-relation map backwards would enforce somebody else's
    // horizon; this is that mistake seen from the route's side.
    const { io } = fake({
      retentionJobs: async () => [{ hypertable_name: "minute_rollups", days: "7" }],
    });
    expect(
      await refuseIncompleteRange(
        "day",
        { from: new Date("2026-08-01T00:00:00.000Z"), to: AT },
        io,
      ),
    ).toBeNull();
  });
});

/**
 * The WIRING to the two catalog reads.
 *
 * One line each, and each of them only ever runs against a real database — so
 * `rows[0]` handed on instead of `rows[0].value` is a defect nothing else here
 * would see.
 */
describe("horizonIo", () => {
  const over = (rows: unknown[][]) => {
    const executed: unknown[] = [];
    return {
      executed,
      io: horizonIo({
        execute: async (query) => {
          executed.push(query);
          return { rows: rows.shift() ?? [] };
        },
      }),
    };
  };

  test("hands back the retention job rows the catalog returned", async () => {
    const { io } = over([[{ hypertable_name: "minute_rollups", days: "90" }]]);
    expect(await io.retentionJobs()).toEqual([{ hypertable_name: "minute_rollups", days: "90" }]);
  });

  test("the migration document is the row's VALUE, not the row", async () => {
    const { io } = over([[{ value: { stage: "cutover" } }]]);
    expect(await io.migrationDocument()).toEqual({ stage: "cutover" });
  });

  test("an instance that has no migration row at all yields no document", async () => {
    const { io } = over([[]]);
    expect(await io.migrationDocument()).toBeUndefined();
  });

  test("its clock is the real one, which is what makes the horizon slide", () => {
    const { io } = over([]);
    expect(io.now().getTime()).toBeGreaterThan(new Date("2026-01-01T00:00:00Z").getTime());
  });
});
