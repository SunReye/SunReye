/**
 * The background job scheduler, peeled out of the runtime so it owns the arm /
 * teardown of every recurring job and post-boot kick — and can be tested with a
 * fake clock, no runtime and no real timers around it.
 *
 * The runtime hands it a list of jobs at start: the scheduler arms each one's
 * interval (and its optional one-shot kick) and keeps the handles so a later
 * stop clears every one. It is idempotent while running — a second start (a
 * re-boot that re-points the source, say) arms nothing new, so the schedules
 * never stack — and stop leaves it re-startable, so a restart re-arms them.
 *
 * It owns no cadence of its own (the caller decides how often each job runs)
 * and never runs the jobs itself; it only arms the clock. Every timer primitive
 * is injectable so a test drives it against a recording fake; the default wiring
 * is the process globals, resolved at call time so a test that patches them
 * (as the runtime suite does) still sees its own.
 */

/** The clock primitives the scheduler arms against; defaults to the globals. */
export interface SchedulerTimers {
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

/** One recurring job: its work, its cadence, and an optional post-boot kick. */
export interface ScheduledJob {
  /** The work to run on every interval tick (and once on the kick, if set). */
  run: () => void;
  /** The recurring cadence, ms. */
  intervalMs: number;
  /** Optional one-shot delay after start before an extra, earlier run, ms. */
  kickMs?: number;
}

export interface JobScheduler {
  /**
   * Arm every job's interval and any post-boot kick. Idempotent while running:
   * a second call before {@link JobScheduler.stop} arms nothing new, so the
   * schedules never stack.
   */
  start(jobs: ScheduledJob[]): void;
  /** Clear every armed interval and pending kick; leaves the scheduler re-startable. */
  stop(): void;
}

export interface JobSchedulerDeps {
  /** Clock primitives to arm against; defaults to the process globals. */
  timers?: SchedulerTimers;
}

// Wrap (rather than capture) the globals so `setInterval`/`clearInterval`
// resolve at call time — a suite that patches them for timer capture then sees
// its own, exactly as bare calls in the runtime did before this peel.
const defaultTimers: SchedulerTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearInterval: (handle) => clearInterval(handle),
  clearTimeout: (handle) => clearTimeout(handle),
};

/**
 * Build a job scheduler. Every mutable field is closure-local — no module-level
 * state, so a second instance is independent.
 */
export function createJobScheduler(deps: JobSchedulerDeps = {}): JobScheduler {
  const timers = deps.timers ?? defaultTimers;
  /** One teardown thunk per armed timer; non-empty exactly while running. */
  let teardown: (() => void)[] = [];

  function start(jobs: ScheduledJob[]): void {
    // Already running — arming again would stack a second copy of every job.
    if (teardown.length > 0) return;
    for (const job of jobs) {
      const interval = timers.setInterval(job.run, job.intervalMs);
      teardown.push(() => timers.clearInterval(interval));
      if (job.kickMs !== undefined) {
        const kick = timers.setTimeout(job.run, job.kickMs);
        teardown.push(() => timers.clearTimeout(kick));
      }
    }
  }

  function stop(): void {
    for (const clear of teardown) clear();
    teardown = [];
  }

  return { start, stop };
}
