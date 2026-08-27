import { describe, expect, test } from "bun:test";

import type { BackfillInput } from "@SunReye/db/backfill";
import type { UpgradeClient } from "@SunReye/db/upgrade-120-run";
import { noMigration } from "@SunReye/db/upgrade-state";

import {
  type BackfillIo,
  type BackfillWiring,
  backfillIo,
  createBackfillTask,
  runMigrationBackfill,
} from "./backfill-task";

/** What the io seam was asked to do, in order. */
interface Seen {
  warned: { message: string; fields: Record<string, unknown> }[];
  info: { message: string; fields: Record<string, unknown> }[];
  inputs: BackfillInput[];
  invalidated: number;
  connections: string[];
}

/** The connection the double hands the driver. It is never asked anything. */
const client = {
  query: async () => {
    throw new Error("runMigrationBackfill must not issue SQL of its own");
  },
} as unknown as UpgradeClient;

const result = () => ({
  carried: { seriesRows: 12 } as never,
  replayed: { seriesRows: 34 } as never,
  refreshed: 2,
  record: { ...noMigration, stage: "backfilled" as const },
  elapsedMs: 1_234,
});

/** A run this test can settle by hand, so the in-flight window is observable. */
function deferred(): { promise: Promise<void>; settle: (error?: Error) => void } {
  let settle!: (error?: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    settle = (error) => (error ? reject(error) : resolve());
  });
  return { promise, settle };
}

describe("createBackfillTask", () => {
  test("the first start runs it, and reports that it started", () => {
    let runs = 0;
    const task = createBackfillTask({ run: async () => void runs++ });
    expect(task.start()).toBe("started");
    expect(runs).toBe(1);
  });

  test("a SECOND start while the first is in flight starts nothing", async () => {
    // The reason this is single-flight and not merely idempotent: the backfill is
    // 170 seconds of replay over shared `replay_progress` watermarks, and two
    // copies racing them is the one way to lose a chunk that both think the other
    // recorded. A double-click on "Migrate now" must not be able to do that.
    let runs = 0;
    const gate = deferred();
    const task = createBackfillTask({
      run: () => {
        runs++;
        return gate.promise;
      },
    });
    expect(task.start()).toBe("started");
    expect(task.start()).toBe("already-running");
    expect(task.start()).toBe("already-running");
    expect(runs).toBe(1);
    expect(task.running()).toBe(true);

    gate.settle();
    await gate.promise;
    // A microtask for the `finally` that clears the flag.
    await Promise.resolve();
    expect(task.running()).toBe(false);
  });

  test("once it has finished, it can be started again — a resume is a new run", async () => {
    // The backfill is resumable by design (it is killable by a Supervisor timeout
    // or a power cut), so "run it again" is the recovery path, not a mistake.
    let runs = 0;
    const task = createBackfillTask({ run: async () => void runs++ });
    task.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(task.start()).toBe("started");
    expect(runs).toBe(2);
  });

  test("a THROWN run clears the flag and is reported, not swallowed into a wedge", async () => {
    // Nothing awaits `start()`, so a rejection has nowhere to surface. If the flag
    // survived the throw, the button would say "already running" forever and the
    // only fix would be a restart.
    const errors: unknown[] = [];
    const gate = deferred();
    const task = createBackfillTask({
      run: () => gate.promise,
      onError: (error) => errors.push(error),
    });
    task.start();
    gate.settle(new Error("connection terminated"));
    await gate.promise.catch(() => {});
    await Promise.resolve();
    expect(task.running()).toBe(false);
    expect((errors[0] as Error).message).toBe("connection terminated");
    expect(task.start()).toBe("started");
  });

  test("an absent error reporter is not a crash — the throw is simply dropped", async () => {
    const gate = deferred();
    const task = createBackfillTask({ run: () => gate.promise });
    task.start();
    gate.settle(new Error("boom"));
    await gate.promise.catch(() => {});
    await Promise.resolve();
    expect(task.running()).toBe(false);
  });
});

/**
 * The real backfill's WIRING, through the io seam.
 *
 * `runMigrationBackfill` issues no SQL of its own — it resolves where the history
 * may be written, opens a connection of its own, hands the driver its input and
 * reports what came back. None of that needs a Postgres, and three of its
 * decisions are ones an operator feels directly:
 *
 *  * it REFUSES rather than guessing when there is nowhere to write, and says
 *    which of the two reasons it was;
 *  * it never opens a connection on a refusal, because the refusal is knowable
 *    before one;
 *  * it INVALIDATES the history-horizon memo when it is done, or month-to-date
 *    reads keep being refused for the memo's TTL after the data they need landed.
 *
 * The statements are proved against a real database by
 * `apps/server/db-tests/upgrade.test.ts` and end to end by
 * `scripts/upgrade-phases.ts`.
 */
describe("runMigrationBackfill", () => {
  const target = { id: 4, profileId: "profile-a", role: "inverter" as const };

  const io = (over: Partial<BackfillIo> = {}): { io: BackfillIo; seen: Seen } => {
    const seen: Seen = { warned: [], info: [], inputs: [], invalidated: 0, connections: [] };
    return {
      seen,
      io: {
        databaseUrl: () => "postgres://example/db",
        readRecord: async () => ({ ...noMigration, stage: "backfilled", sourceId: "profile-a" }),
        readPlant: async () => ({ id: 1 }),
        readDevices: async () => [target],
        withClient: async (url, body) => {
          seen.connections.push(url);
          return body(client);
        },
        readCadenceMs: async () => 5_000,
        runBackfill: async (_client, backfillInput) => {
          seen.inputs.push(backfillInput);
          return result();
        },
        invalidate: () => void seen.invalidated++,
        warn: (message, fields) => seen.warned.push({ message, fields }),
        info: (message, fields) => seen.info.push({ message, fields }),
        ...over,
      },
    };
  };

  test("refuses, without connecting, when provisioning never created a plant", async () => {
    const { io: deps, seen } = io({ readPlant: async () => null });
    await runMigrationBackfill([], deps);
    expect(seen.warned[0]?.fields.reason).toBe("no-plant");
    expect(seen.connections).toEqual([]);
    expect(seen.inputs).toEqual([]);
  });

  test("refuses, without connecting, when no device may be attributed the history", async () => {
    // An install whose only device is a CONTROLLER has nothing an inverter's
    // history belongs to. Writing it somewhere plausible is the worse outcome.
    const { io: deps, seen } = io({ readDevices: async () => [] });
    await runMigrationBackfill([], deps);
    expect(seen.warned[0]?.fields.reason).toBe("no-device");
    expect(seen.connections).toEqual([]);
  });

  test("a refusal asks for no devices at all when there is no plant to ask about", async () => {
    let asked = 0;
    const { io: deps } = io({
      readPlant: async () => null,
      readDevices: async () => {
        asked++;
        return [target];
      },
    });
    await runMigrationBackfill([], deps);
    expect(asked).toBe(0);
  });

  test("hands the driver the resolved device, the profile's config keys and the measured cadence", async () => {
    // `configKeys` must be the PROFILE's own answer: getting it wrong does not
    // fail, it quietly routes configuration registers back into the hypertable.
    const { io: deps, seen } = io();
    await runMigrationBackfill(["settings.mode"], deps);
    expect(seen.connections).toEqual(["postgres://example/db"]);
    expect(seen.inputs[0]?.deviceId).toBe(4);
    expect(seen.inputs[0]?.configKeys).toEqual(["settings.mode"]);
    expect(seen.inputs[0]?.rawDurMs).toBe(5_000);
  });

  test("a database with no measurable legacy cadence writes no duration rather than a guess", async () => {
    const { io: deps, seen } = io({ readCadenceMs: async () => null });
    await runMigrationBackfill([], deps);
    expect(seen.inputs[0]?.rawDurMs).toBeNull();
  });

  test("the driver's progress lines reach the operator's log", async () => {
    const { io: deps, seen } = io({
      runBackfill: async (_client, backfillInput) => {
        backfillInput.logger?.log("carried 1,000 retained raw rows");
        return result();
      },
    });
    await runMigrationBackfill([], deps);
    expect(seen.info.some((entry) => entry.fields.line === "carried 1,000 retained raw rows")).toBe(
      true,
    );
  });

  test("reports what landed, and forgets the horizon memo so month-to-date reads open up", async () => {
    const { io: deps, seen } = io();
    await runMigrationBackfill([], deps);
    const done = seen.info.at(-1);
    expect(done?.fields).toMatchObject({
      carried: 12,
      replayed: 34,
      refreshed: 2,
      stage: "backfilled",
    });
    expect(seen.invalidated).toBe(1);
  });

  test("a run with nothing carried or replayed reports zeroes rather than undefined", async () => {
    const { io: deps, seen } = io({
      runBackfill: async () => ({ ...result(), carried: null, replayed: null }),
    });
    await runMigrationBackfill([], deps);
    expect(seen.info.at(-1)?.fields).toMatchObject({ carried: 0, replayed: 0 });
  });

  test("a record that says the migration is already done says so, and still opens the horizon", async () => {
    // The button cannot know the state; `runBackfill` decides it from the record
    // and answers `null`. That is a normal outcome, not a failure.
    const { io: deps, seen } = io({ runBackfill: async () => null });
    await runMigrationBackfill([], deps);
    expect(seen.info.at(-1)?.message).toContain("nothing to backfill");
    expect(seen.invalidated).toBe(1);
  });

  test("a driver that throws propagates, so the task's error handler sees it", async () => {
    // `createBackfillTask` above is what clears the in-flight flag on a throw; a
    // rejection swallowed here would wedge the button instead.
    const { io: deps, seen } = io({
      runBackfill: async () => {
        throw new Error("connection terminated");
      },
    });
    await expect(runMigrationBackfill([], deps)).rejects.toThrow("connection terminated");
    // The memo is left alone: the 30 s TTL reopens it, and claiming a horizon
    // moved after a failed run would be the wrong claim to make.
    expect(seen.invalidated).toBe(0);
  });
});

/**
 * The WIRING, which is a thing that can be wrong on its own.
 *
 * Every member here is one line, and every one of them is a line that would only
 * be run on a real migration — the path with no second attempt. A `readDevices`
 * handed the wrong id, or a `migrationDocument` handed the row instead of its
 * `value`, is a defect no statement is wrong about.
 */
describe("backfillIo", () => {
  const wiring = (over: Partial<BackfillWiring> = {}) => {
    const executed: unknown[] = [];
    const logged: { level: string; message: string }[] = [];
    const rows: unknown[][] = [];
    const io = backfillIo({
      database: {
        execute: async (query) => {
          executed.push(query);
          return { rows: rows.shift() ?? [] };
        },
      },
      databaseUrl: () => "postgres://example/db",
      logger: {
        warn: (message) => logged.push({ level: "warn", message }),
        info: (message) => logged.push({ level: "info", message }),
      },
      ...over,
    });
    return { io, executed, logged, rows };
  };

  test("reads the connection string LATE, not at import time", () => {
    // The addon's `DATABASE_URL` is not known when this module is loaded.
    let url = "postgres://first/db";
    const { io } = wiring({ databaseUrl: () => url });
    url = "postgres://second/db";
    expect(io.databaseUrl()).toBe("postgres://second/db");
  });

  test("the migration record is read from the row's VALUE, not from the row", async () => {
    // Handing the row itself to the parser reports "no migration here" on every
    // instance in the middle of one — which is the instance the guard is for.
    const { io, rows } = wiring();
    rows.push([{ value: { stage: "cutover", sourceId: "profile-a" } }]);
    const record = await io.readRecord();
    expect(record.stage).toBe("cutover");
    expect(record.sourceId).toBe("profile-a");
  });

  test("an install with no plant row reads as no plant, not as a crash", async () => {
    const { io } = wiring();
    expect(await io.readPlant()).toBeNull();
  });

  test("the plant and its devices are read through the SAME client", async () => {
    // Two clients would be two views of one database, and the device the history
    // is attributed to would be resolved against a plant that may not be the one
    // that was read.
    const { io, executed } = wiring();
    await io.readPlant();
    await io.readDevices(9);
    expect(executed).toHaveLength(2);
  });

  test("the driver runs against a connection of its own, which is closed afterwards", async () => {
    // Not the shared pool: every chunk is an explicit begin/commit, and a pool
    // may put the two halves on different backends.
    const opened: string[] = [];
    let closed = 0;
    const { io } = wiring({
      connect: (url) => {
        opened.push(url);
        return {
          connect: async () => {},
          query: async () => ({ rows: [] }),
          end: async () => void closed++,
        };
      },
    });
    const seen = await io.withClient("postgres://example/db", async (client) => client !== null);
    expect(seen).toBe(true);
    expect(opened).toEqual(["postgres://example/db"]);
    expect(closed).toBe(1);
  });

  test("the cadence read goes to the handed-in client", async () => {
    const { io } = wiring();
    const client = { query: async () => ({ rows: [{ gap: 5000 }, { gap: 5000 }] }) };
    expect(await io.readCadenceMs(client)).toBe(5_000);
  });

  test("the driver is handed the same client, and decides for itself when there is nothing to do", async () => {
    const { io } = wiring();
    const client = { query: async () => ({ rows: [{ value: { stage: "none" } }] }) };
    expect(await io.runBackfill(client, { deviceId: 1, rawDurMs: null })).toBeNull();
  });

  test("invalidating the horizon memo is wired, and is not an error to call", () => {
    const { io } = wiring();
    expect(io.invalidate()).toBeUndefined();
  });

  test("both log levels reach the logger, and stay distinct", () => {
    const { io, logged } = wiring();
    io.warn("nowhere to write", {});
    io.info("starting", {});
    expect(logged).toEqual([
      { level: "warn", message: "nowhere to write" },
      { level: "info", message: "starting" },
    ]);
  });
});
