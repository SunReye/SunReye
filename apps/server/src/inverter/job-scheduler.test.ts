/**
 * The background job scheduler in isolation: no runtime, no real clock. The
 * timer primitives are injected recording fakes, so every assertion is about
 * the scheduler's own decisions — what it arms, that it never stacks a second
 * copy while running, and that a stop clears every handle it opened.
 *
 * There is no `mock.module` here on purpose: the scheduler imports nothing at
 * runtime (its clock is constructor-injected), so a plain fake is all it takes.
 * One case runs against the real globals to prove the default wiring arms and
 * tears down without error.
 */

import { describe, expect, test } from "bun:test";

import { createJobScheduler, type ScheduledJob, type SchedulerTimers } from "./job-scheduler";

// --- a recording clock -----------------------------------------------------

interface Armed {
  kind: "interval" | "timeout";
  fn: () => void;
  ms: number;
  handle: number;
}

/** A fake clock that records every arm and clear, and can fire a timer by hand. */
function recordingTimers() {
  let nextHandle = 1;
  const armed: Armed[] = [];
  const cleared: number[] = [];
  const timers: SchedulerTimers = {
    setInterval: (fn, ms) => {
      const handle = nextHandle++;
      armed.push({ kind: "interval", fn, ms, handle });
      return handle as unknown as ReturnType<typeof setInterval>;
    },
    setTimeout: (fn, ms) => {
      const handle = nextHandle++;
      armed.push({ kind: "timeout", fn, ms, handle });
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearInterval: (handle) => {
      cleared.push(handle as unknown as number);
    },
    clearTimeout: (handle) => {
      cleared.push(handle as unknown as number);
    },
  };
  return { timers, armed, cleared };
}

/** A job whose `run` bumps a counter, so a fired tick is observable. */
function countingJob(over: Partial<ScheduledJob> = {}): ScheduledJob & { calls: () => number } {
  let calls = 0;
  return {
    run: () => {
      calls++;
    },
    intervalMs: 60_000,
    ...over,
    calls: () => calls,
  };
}

describe("the background job scheduler", () => {
  test("arms one interval per job at its cadence", () => {
    const clock = recordingTimers();
    const scheduler = createJobScheduler({ timers: clock.timers });

    scheduler.start([
      { run: () => {}, intervalMs: 5000 },
      { run: () => {}, intervalMs: 30_000 },
    ]);

    const intervals = clock.armed.filter((t) => t.kind === "interval");
    expect(intervals.map((t) => t.ms)).toEqual([5000, 30_000]);
    // No job asked for a kick, so no one-shot timer was armed.
    expect(clock.armed.some((t) => t.kind === "timeout")).toBe(false);
  });

  test("a job that asks for a kick also arms a one-shot at its delay", () => {
    const clock = recordingTimers();
    const scheduler = createJobScheduler({ timers: clock.timers });

    scheduler.start([{ run: () => {}, intervalMs: 30_000, kickMs: 500 }]);

    expect(clock.armed.map((t) => [t.kind, t.ms])).toEqual([
      ["interval", 30_000],
      ["timeout", 500],
    ]);
  });

  test("a job without a kick arms no one-shot timer", () => {
    const clock = recordingTimers();
    const scheduler = createJobScheduler({ timers: clock.timers });

    scheduler.start([{ run: () => {}, intervalMs: 1000 }]);

    expect(clock.armed).toHaveLength(1);
    expect(clock.armed[0]?.kind).toBe("interval");
  });

  test("both the interval tick and the kick run the job's work", () => {
    const clock = recordingTimers();
    const scheduler = createJobScheduler({ timers: clock.timers });
    const job = countingJob({ kickMs: 500 });

    scheduler.start([job]);
    // Nothing fires by itself; drive the recorded callbacks by hand.
    clock.armed.find((t) => t.kind === "interval")?.fn();
    clock.armed.find((t) => t.kind === "timeout")?.fn();

    expect(job.calls()).toBe(2);
  });

  test("a second start before stop arms nothing new, so schedules never stack", () => {
    const clock = recordingTimers();
    const scheduler = createJobScheduler({ timers: clock.timers });
    const jobs: ScheduledJob[] = [{ run: () => {}, intervalMs: 5000, kickMs: 500 }];

    scheduler.start(jobs);
    scheduler.start(jobs);

    expect(clock.armed).toHaveLength(2); // one interval + one kick, not four
  });

  test("stop clears every armed interval and pending kick", () => {
    const clock = recordingTimers();
    const scheduler = createJobScheduler({ timers: clock.timers });

    scheduler.start([
      { run: () => {}, intervalMs: 5000 },
      { run: () => {}, intervalMs: 30_000, kickMs: 500 },
    ]);
    const handles = clock.armed.map((t) => t.handle);

    scheduler.stop();

    expect(clock.cleared.sort()).toEqual(handles.sort());
  });

  test("after a stop it can be started again, re-arming the schedules", () => {
    const clock = recordingTimers();
    const scheduler = createJobScheduler({ timers: clock.timers });
    const jobs: ScheduledJob[] = [{ run: () => {}, intervalMs: 5000 }];

    scheduler.start(jobs);
    scheduler.stop();
    scheduler.start(jobs);

    expect(clock.armed.filter((t) => t.kind === "interval")).toHaveLength(2);
  });

  test("starting with no jobs arms nothing and stop is still a no-op", () => {
    const clock = recordingTimers();
    const scheduler = createJobScheduler({ timers: clock.timers });

    scheduler.start([]);
    expect(clock.armed).toHaveLength(0);

    scheduler.stop();
    expect(clock.cleared).toHaveLength(0);
  });

  test("against the real clock the default wiring arms and tears down cleanly", async () => {
    // No injected timers: exercises the default globals path. Cadences are far
    // longer than the test, so nothing fires on its own before the teardown.
    const scheduler = createJobScheduler();
    const job = countingJob({ intervalMs: 3_600_000, kickMs: 3_600_000 });

    scheduler.start([job]);
    scheduler.stop();
    await Bun.sleep(0);

    expect(job.calls()).toBe(0);
  });
});
