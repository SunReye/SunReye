import { describe, expect, test } from "bun:test";

import { createChangeEncoder, type EncodedRow } from "./change-encoder";

/**
 * The encoder decides what history exists, so these tests are written as
 * properties rather than row counts. A row count alone is the trap: the naive
 * implementation — comparing each sample against the *previous sample* instead
 * of against the last value it stored — keeps fewer rows and looks better by
 * that measure while the stored series wanders arbitrarily far from the truth.
 */

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 7, 26, 12, 0, 0);

/** A minute-aligned encoder with one deadband, or none. */
const encoder = (deadband?: number, over = ["m"]) =>
  createChangeEncoder({
    deadbandFor: (metric) => (over.includes(metric) ? deadband : undefined),
  });

/** Feed a series of `[offsetMs, value]` readings; collect every row emitted. */
function feed(
  enc: ReturnType<typeof encoder>,
  readings: [number, number][],
  metric = "m",
): EncodedRow[] {
  const rows: EncodedRow[] = [];
  for (const [offset, value] of readings) {
    rows.push(...enc.observe(metric, new Date(T0 + offset), value));
  }
  return rows;
}

/**
 * `feed`, then close the encoder — the *completed* history, which is what a
 * chart of the past and the aggregates both read. The still-open interval is
 * deliberately included: leaving it out measures a mid-flight view in which the
 * reader has not yet been told the current value, and the error bound below is a
 * statement about stored history, not about a partially-flushed buffer.
 */
function feedAndClose(
  enc: ReturnType<typeof encoder>,
  readings: [number, number][],
  metric = "m",
): EncodedRow[] {
  const rows = feed(enc, readings, metric);
  return [...rows, ...enc.close(new Date(T0 + readings[readings.length - 1]![0]))];
}

/** A reading every `stepMs` for `count` samples, valued by `f`. */
const series = (count: number, stepMs: number, f: (i: number) => number): [number, number][] =>
  Array.from({ length: count }, (_, i) => [i * stepMs, f(i)]);

/**
 * The largest error the stored series would show against the true samples, if a
 * reader carried the last stored value forward — which is exactly what the
 * frontend and the time-weighted aggregate both do.
 */
function worstCarryForwardError(readings: [number, number][], rows: EncodedRow[]): number {
  const stored = rows.map((r) => ({ ms: r.time.getTime(), value: r.value }));
  let worst = 0;
  for (const [offset, truth] of readings) {
    const ms = T0 + offset;
    // The row in force at this instant: the last one that started at or before it.
    let held: number | undefined;
    for (const s of stored) {
      if (s.ms <= ms) held = s.value;
    }
    if (held !== undefined) worst = Math.max(worst, Math.abs(truth - held));
  }
  return worst;
}

describe("change-only encoding", () => {
  test("a constant series emits exactly one row per bucket, never zero", () => {
    // 5 minutes of a dead-flat signal at 3 s: 100 samples, 5 rows. The boundary
    // *is* the heartbeat — there is no separate timer to arm or to get wrong.
    const rows = feed(
      encoder(),
      series(100, 3000, () => 42),
    );
    expect(rows).toHaveLength(4); // the 5th interval is still open
    expect(rows.every((r) => r.value === 42)).toBe(true);
    expect(rows.every((r) => r.durMs === MINUTE)).toBe(true);
  });

  test("every stored interval lies inside one bucket, and a bucket's durations sum to its width", () => {
    // This is what makes the weighted mean exact rather than approximately
    // weighted: no interval is credited to a bucket it partly belongs to.
    const rows = feed(
      encoder(),
      series(60, 3000, (i) => i),
    );
    for (const row of rows) {
      const start = row.time.getTime();
      expect(Math.floor(start / MINUTE)).toBe(Math.floor((start + row.durMs - 1) / MINUTE));
    }
    const firstBucket = rows.filter((r) => r.time.getTime() < T0 + MINUTE);
    expect(firstBucket.reduce((sum, r) => sum + r.durMs, 0)).toBe(MINUTE);
  });

  test("a change is stored with the duration the previous value actually held", () => {
    const rows = feed(encoder(), [
      [0, 10],
      [3000, 10],
      [6000, 20],
    ]);
    expect(rows).toEqual([{ time: new Date(T0), value: 10, durMs: 6000 }]);
  });

  test("no row is emitted while nothing changes inside a bucket", () => {
    expect(
      feed(encoder(), [
        [0, 10],
        [3000, 10],
        [6000, 10],
      ]),
    ).toEqual([]);
  });

  // --- the deadband's reference -------------------------------------------

  test("a ramp in sub-threshold steps is stored once cumulative drift reaches the threshold", () => {
    // THE test. Each step is 0.4 below a 1.0 threshold, so a naive per-sample
    // comparison stores NOTHING and passes any assertion that only counts rows.
    const readings = series(20, 1000, (i) => 100 + i * 0.4);
    const rows = feedAndClose(encoder(1), readings);
    expect(rows.length).toBeGreaterThan(0);
    expect(worstCarryForwardError(readings, rows)).toBeLessThanOrEqual(1);
  });

  test("the carry-forward error never exceeds the threshold, for a drifting signal", () => {
    // Asserted as a bound rather than a row count: the bound is the property
    // that makes "1 V deadband" mean "never wrong by more than 1 V".
    const readings = series(240, 1000, (i) => 230 + 2.6 * Math.sin(i / 17) + 0.9 * Math.sin(i / 3));
    const rows = feedAndClose(encoder(1), readings);
    expect(worstCarryForwardError(readings, rows)).toBeLessThanOrEqual(1);
    // …and it is really filtering: a row per sample would also satisfy the bound.
    expect(rows.length).toBeLessThan(readings.length / 3);
  });

  test("the reference resets to the value that was stored, not to the one before it", () => {
    const rows = feed(encoder(1), [
      [0, 100],
      [1000, 101.5], // stored; reference becomes 101.5
      [2000, 102.4], // +0.9 from 101.5 — inside the band
      [3000, 102.6], // +1.1 from 101.5 — stored
    ]);
    expect(rows.map((r) => r.value)).toEqual([100, 101.5]);
  });

  test("a sawtooth oscillating just under the threshold about a fixed mean stores nothing extra", () => {
    // The counterpart case: an implementation that reset its reference too
    // eagerly would store on every swing.
    const rows = feed(
      encoder(1),
      series(120, 1000, (i) => 50 + (i % 2 === 0 ? 0 : 0.9)),
    );
    expect(rows).toHaveLength(1); // the bucket boundary, nothing else
    expect(rows[0]?.durMs).toBe(MINUTE);
  });

  test("a change exactly equal to the threshold is stored — the boundary is inclusive", () => {
    expect(
      feed(encoder(1), [
        [0, 10],
        [1000, 11],
      ]),
    ).toHaveLength(1);
  });

  // --- what must never be filtered ---------------------------------------

  test("with no deadband every change is stored, including a counter restart", () => {
    // A counter dropping to 0 is a device swap or a firmware reset. Swallowing
    // it as "within the band" would bill the whole lifetime total to one bucket
    // the next time it is read.
    const rows = feed(encoder(undefined), [
      [0, 11_000],
      [1000, 11_000],
      [2000, 0],
    ]);
    expect(rows.map((r) => r.value)).toEqual([11_000]);
  });

  test("a deadband is applied only to the metric it was authored for", () => {
    const enc = encoder(50, ["noisy"]);
    expect(
      feed(
        enc,
        [
          [0, 0],
          [1000, 10],
        ],
        "noisy",
      ),
    ).toEqual([]);
    expect(
      feed(
        enc,
        [
          [0, 0],
          [1000, 10],
        ],
        "counter",
      ),
    ).toHaveLength(1);
  });

  test("exact zero and a negative value are stored and are distinguishable", () => {
    const rows = feed(encoder(), [
      [0, 5],
      [1000, 0],
      [2000, -5],
    ]);
    expect(rows.map((r) => r.value)).toEqual([5, 0]);
  });

  // --- gaps ---------------------------------------------------------------

  test("a silence longer than the tolerance is a gap, not a held value", () => {
    // "Unchanged" and "unknown" must not become the same thing: the value is
    // credited to the end of its own bucket at most, and the hour of silence
    // gets no row at all.
    const rows = feed(encoder(), [
      [0, 42],
      [3600_000, 42],
    ]);
    expect(rows).toEqual([{ time: new Date(T0), value: 42, durMs: MINUTE }]);
  });

  test("the first reading after a gap starts a fresh interval at its own timestamp", () => {
    const rows = feed(encoder(), [
      [0, 42],
      [3600_000, 42],
      [3600_000 + MINUTE, 42],
    ]);
    expect(rows.at(-1)).toEqual({
      time: new Date(T0 + 3600_000),
      value: 42,
      durMs: MINUTE,
    });
  });

  test("a reading that arrives out of order restarts rather than emitting a negative duration", () => {
    const rows = feed(encoder(), [
      [10_000, 5],
      [0, 6],
      [3000, 7],
    ]);
    expect(rows.every((r) => r.durMs > 0)).toBe(true);
  });

  // --- boundaries in wall-clock terms ------------------------------------

  test("bucket alignment is epoch-based, so midnight and a DST change are not special", () => {
    // Europe/Berlin springs forward at 01:00 UTC on 2026-03-29. Alignment never
    // consults a local offset, so the interval closes on the same boundary it
    // would on any other day — which is why there is no DST case to get wrong.
    const dst = Date.UTC(2026, 2, 29, 0, 59, 58);
    const enc = encoder();
    enc.observe("m", new Date(dst), 7);
    const rows = enc.observe("m", new Date(dst + 4000), 7);
    expect(rows).toEqual([{ time: new Date(dst), value: 7, durMs: 2000 }]);

    const midnight = Date.UTC(2026, 7, 26, 23, 59, 58);
    enc.observe("mid", new Date(midnight), 7);
    expect(enc.observe("mid", new Date(midnight + 4000), 7)).toEqual([
      { time: new Date(midnight), value: 7, durMs: 2000 },
    ]);
  });

  test("a boundary and a change between the same two readings emit both rows", () => {
    const rows = feed(encoder(), [
      [58_000, 10],
      [62_000, 20],
    ]);
    expect(rows).toEqual([
      { time: new Date(T0 + 58_000), value: 10, durMs: 2000 },
      { time: new Date(T0 + MINUTE), value: 10, durMs: 2000 },
    ]);
  });

  // --- closing out --------------------------------------------------------

  test("close emits the interval still open, so a restart loses nothing", () => {
    const enc = encoder();
    feed(enc, [[0, 42]]);
    expect(enc.close(new Date(T0 + 30_000))).toEqual([
      { metric: "m", time: new Date(T0), value: 42, durMs: 30_000 },
    ]);
    expect(enc.openCount).toBe(0);
  });

  test("close never credits a value past its own bucket", () => {
    const enc = encoder();
    feed(enc, [[0, 42]]);
    expect(enc.close(new Date(T0 + 3600_000))[0]?.durMs).toBe(MINUTE);
  });

  test("close on a fresh encoder emits nothing", () => {
    expect(encoder().close(new Date(T0))).toEqual([]);
  });

  test("a metric is only remembered while it has an interval open", () => {
    const enc = encoder();
    feed(enc, [[0, 1]], "a");
    feed(enc, [[0, 1]], "b");
    expect(enc.openCount).toBe(2);
  });
});
