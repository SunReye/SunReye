import { describe, expect, test } from "bun:test";

import { createBackfillTask } from "./backfill-task";

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
