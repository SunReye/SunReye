/**
 * The batched history write buffer in isolation: no runtime, no poll loop, no
 * database. The store and the logger are injected in-memory doubles, so every
 * assertion is about the buffer's own decisions — what it batches, when it
 * flushes on its own, what it re-queues after a failed transaction, and what it
 * drops once it is full.
 *
 * There is no `mock.module` here on purpose: the buffer imports nothing at
 * runtime (its collaborators are constructor-injected), so a plain fake is all
 * it takes to drive it.
 */

import { beforeEach, describe, expect, test } from "bun:test";

import { createHistoryBuffer, type HistoryBuffer, type MetricRow } from "./history-buffer";

/** A promise plus its resolver, for parking the injected transaction mid-flight. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Let every pending microtask (and any 0 ms timer) run. */
const settle = () => Bun.sleep(0);

/** One history row; only the metric key needs to vary between rows. */
const row = (metric: string, value = 0): MetricRow => ({ inverterId: "plant-1", metric, value });

/** `count` rows named `m0…m{count-1}`, in order. */
const rows = (count: number): MetricRow[] => Array.from({ length: count }, (_, i) => row(`m${i}`));

// --- injected doubles ------------------------------------------------------

/** Batches handed to `store.insert(table).values(...)`, in commit order. */
let inserted: MetricRow[][] = [];
/** When set, the next transaction rejects with this message, then clears itself. */
let insertError: string | null = null;
/** When set, a transaction parks here until released — a slow/blocked commit. */
let insertGate: { promise: Promise<void>; release: () => void } | null = null;
/** Failure lines the buffer logged, in order. */
let logged: { template: string; values: Record<string, unknown> }[] = [];

const store = {
  insert: () => ({
    values: async (batch: MetricRow[]) => {
      if (insertGate) await insertGate.promise;
      if (insertError) {
        const message = insertError;
        insertError = null;
        throw new Error(message);
      }
      inserted.push(batch);
    },
  }),
} as unknown as Parameters<typeof createHistoryBuffer>[0]["store"];

const logger = {
  error: (template: string, values: Record<string, unknown> = {}) => {
    logged.push({ template, values });
  },
};

/** The table is an opaque token to the buffer — it only forwards it to the store. */
const table = {} as unknown as Parameters<typeof createHistoryBuffer>[0]["table"];

const make = (maxPending?: number): HistoryBuffer =>
  createHistoryBuffer({ store, table, logger, maxPending });

beforeEach(() => {
  inserted = [];
  insertError = null;
  insertGate = null;
  logged = [];
});

describe("the history write buffer", () => {
  test("buffers enqueued rows and commits them in one transaction", async () => {
    const buffer = make();
    buffer.enqueue([row("a"), row("b")]);
    expect(buffer.pending).toBe(2);
    // Nothing has hit the store yet — that is the whole point of the buffer.
    expect(inserted).toHaveLength(0);

    await buffer.flush();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.map((r) => r.metric)).toEqual(["a", "b"]);
    expect(buffer.pending).toBe(0);
  });

  test("flushing an empty buffer is a no-op, not an empty transaction", async () => {
    const buffer = make();

    await buffer.flush();

    expect(inserted).toHaveLength(0);
    expect(logged).toHaveLength(0);
  });

  test("enqueueing across flushes accumulates only the rows not yet committed", async () => {
    const buffer = make();
    buffer.enqueue([row("a")]);
    await buffer.flush();
    buffer.enqueue([row("b")]);
    buffer.enqueue([row("c")]);

    expect(buffer.pending).toBe(2);
    await buffer.flush();

    expect(inserted.map((batch) => batch.map((r) => r.metric))).toEqual([["a"], ["b", "c"]]);
  });

  test("a second flush during a slow transaction does not open a concurrent one", async () => {
    const buffer = make();
    buffer.enqueue([row("a")]);
    const gate = deferred();
    insertGate = gate;

    // The first flush takes the batch and parks inside the transaction…
    const first = buffer.flush();
    // …while more rows arrive. A second flush must return early, not commit them.
    buffer.enqueue([row("b")]);
    await buffer.flush();
    expect(inserted).toHaveLength(0);
    expect(buffer.pending).toBe(1);

    gate.release();
    await first;
    expect(inserted.map((batch) => batch.map((r) => r.metric))).toEqual([["a"]]);

    // The rows buffered during the transaction wait for the next flush.
    await buffer.flush();
    expect(inserted.map((batch) => batch.map((r) => r.metric))).toEqual([["a"], ["b"]]);
  });

  test("a rejected transaction re-queues its rows, oldest first, for the next flush", async () => {
    const buffer = make();
    buffer.enqueue([row("a"), row("b")]);
    insertError = "deadlock detected";

    await buffer.flush();

    expect(inserted).toHaveLength(0);
    expect(logged[0]?.template).toBe("history flush failed, {count} rows queued: {error}");
    expect(logged[0]?.values.count).toBe(2);
    expect(buffer.pending).toBe(2);

    await buffer.flush();

    expect(inserted.map((batch) => batch.map((r) => r.metric))).toEqual([["a", "b"]]);
  });

  test("re-queued rows keep their place ahead of rows buffered during the failed flush", async () => {
    const buffer = make();
    buffer.enqueue([row("a")]);
    const gate = deferred();
    insertGate = gate;
    const first = buffer.flush(); // parks with batch [a], pending emptied
    buffer.enqueue([row("b")]); // arrives while the transaction is in flight

    insertError = "connection reset";
    gate.release();
    await first;

    // [a] re-queued ahead of [b]: the batch concatenates before later arrivals.
    expect(buffer.pending).toBe(2);
    await buffer.flush();
    expect(inserted.map((batch) => batch.map((r) => r.metric))).toEqual([["a", "b"]]);
  });

  test("eager-flushes at its cap instead of waiting to be asked", async () => {
    const buffer = make(3);
    buffer.enqueue(rows(2));
    expect(inserted).toHaveLength(0); // below the cap: still waiting

    buffer.enqueue(rows(1));
    await settle();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toHaveLength(3);
    expect(buffer.pending).toBe(0);
  });

  test("the default cap is 100 000 rows", async () => {
    const buffer = make();
    buffer.enqueue(rows(99_999));
    await settle();
    expect(inserted).toHaveLength(0); // one short of the cap

    buffer.enqueue([row("last")]);
    await settle();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toHaveLength(100_000);
  });

  test("a full buffer does not open a second transaction while one is in flight", async () => {
    const buffer = make(2);
    const gate = deferred();
    insertGate = gate;

    buffer.enqueue(rows(2)); // hits the cap, eager-flush parks in the transaction
    await settle();
    buffer.enqueue([row("x"), row("y")]); // refills to the cap while flushing
    await settle();

    // Only the first batch is (about to be) committed; the refill must wait.
    gate.release();
    await settle();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toHaveLength(2);
    expect(buffer.pending).toBe(2);
  });

  test("past the cap the oldest rows are dropped, so an outage cannot grow memory", async () => {
    const buffer = make(2);
    insertError = "database is not accepting connections";

    buffer.enqueue([row("old"), row("mid"), row("new")]); // three rows, cap of two
    await settle();

    // The flush failed and re-queued, but trimmed to the cap: the oldest fell off.
    expect(logged[0]?.values.count).toBe(2);
    expect(buffer.pending).toBe(2);

    await buffer.flush();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.map((r) => r.metric)).toEqual(["mid", "new"]);
  });
});
