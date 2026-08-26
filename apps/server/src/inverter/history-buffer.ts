/**
 * The batched history write buffer, peeled out of the runtime so it can own its
 * boundaries — the cap, the oldest-row drop, the re-queue-on-error — and be
 * tested without a runtime, a poll loop, or a database around it.
 *
 * The DB is purely the history store — live monitoring is served from
 * `liveState`/WebSocket in memory — so *when* rows land is invisible to every
 * feature. Accumulating many polls into one transaction collapses the
 * commit/fsync/WAL churn that dominates SSD write wear (TBW) at 1 Hz, for zero
 * functional change. Worst case a crash loses the buffered window of *history*
 * (never live data, never corruption) — an acceptable trade for telemetry.
 *
 * The buffer owns no timer: the runtime arms the flush cadence and calls
 * {@link HistoryBuffer.flush} on the tick, before a source swap, and at
 * shutdown. Every collaborator (the commit, the logger) is injected, so
 * a second instance shares nothing and a test drives it against in-memory
 * doubles.
 */

// Type-only `import()` query, inlined into the public signature below: the
// buffer pulls in no runtime dependency on the db package — the commit is
// injected, so the module stays a pure, self-contained collaborator (and a test
// needs no `mock.module`).

/** One buffered history row (long form: one metric per tick). */
export type MetricRow = (typeof import("@SunReye/db/schema/metrics").metricsRaw)["$inferInsert"];

/** The one failure path the buffer logs; kept minimal so any logger satisfies it. */
export interface HistoryLogger {
  error(template: string, values?: Record<string, unknown>): void;
}

export interface HistoryBufferDeps<Row> {
  /**
   * Write one batch in a single transaction. A callback rather than a
   * `(store, table)` pair: the buffer never needed the drizzle handle, only
   * "commit these rows", and naming the table in its own signature is what tied
   * it to one table. Two buffers over two tables now differ by their callback
   * instead of by a copy of this file — the timeseries rows and the config
   * change-log have the same batching problem and want the same solution.
   */
  commit(rows: Row[]): Promise<unknown>;
  /** Structured logger for the one flush-failure line. */
  logger: HistoryLogger;
  /**
   * Hard cap on buffered rows so a prolonged DB outage can't grow memory without
   * bound; past this the oldest rows are dropped. Defaults to 100 000.
   */
  maxPending?: number;
}

export interface HistoryBuffer<Row = MetricRow> {
  /** Queue rows for the next flush; eager-flush if the buffer is at its cap. */
  enqueue(rows: Row[]): void;
  /** Write the buffered rows in a single transaction (no-op when empty/in-flight). */
  flush(): Promise<void>;
  /** How many rows are currently buffered. */
  readonly pending: number;
  /**
   * Rows the cap has discarded since this buffer was built, cumulative.
   *
   * Exported rather than merely logged: a cap that quietly eats history is
   * indistinguishable from a cap that never fires, and "the buffer is fine" is
   * not a measurement. The wear harness reads this beside the write figures, so a
   * run that dropped rows cannot be reported as a clean one.
   */
  readonly dropped: number;
}

/**
 * Build a history write buffer. Every mutable field is closure-local — no
 * module-level state, so a second instance is independent.
 */
export function createHistoryBuffer<Row>(deps: HistoryBufferDeps<Row>): HistoryBuffer<Row> {
  const { commit, logger } = deps;
  const maxPending = deps.maxPending ?? 100_000;
  let pending: Row[] = [];
  let flushing = false;
  let dropped = 0;

  function enqueue(rows: Row[]): void {
    for (const row of rows) pending.push(row);
    // Guards against a mis-set (very long) flush interval or a stalled flush
    // producing one enormous transaction; the timer handles the normal path.
    if (!flushing && pending.length >= maxPending) void flush();
  }

  async function flush(): Promise<void> {
    if (flushing || pending.length === 0) return;
    flushing = true;
    const batch = pending;
    pending = [];
    try {
      await commit(batch);
    } catch (error) {
      // Re-queue (oldest first) so a transient DB blip doesn't drop history, but
      // never past the cap — trim the oldest if we're over.
      pending = batch.concat(pending);
      if (pending.length > maxPending) {
        const overflow = pending.length - maxPending;
        pending = pending.slice(-maxPending);
        // Logged the first time only, then counted: at 1 Hz a line per drop
        // buries every other line in the file — the same reason the poll loop
        // rate-limits its error. The count stays readable either way.
        if (dropped === 0) {
          logger.error("history buffer at its cap: {dropped} oldest row(s) dropped", {
            dropped: overflow,
          });
        }
        dropped += overflow;
      }
      logger.error("history flush failed, {count} rows queued: {error}", {
        count: pending.length,
        error,
      });
    } finally {
      flushing = false;
    }
  }

  return {
    enqueue,
    flush,
    get pending() {
      return pending.length;
    },
    get dropped() {
      return dropped;
    },
  };
}
