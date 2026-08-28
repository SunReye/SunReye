import { describe, expect, test } from "bun:test";

import {
  REFRESH_ORDER,
  type CoverageRow,
  compareCoverage,
  configLeak,
  refreshCall,
  refreshWindows,
} from "./backfill";

const span = (from: string, to: string) => ({ start: new Date(from), end: new Date(to) });

describe("REFRESH_ORDER", () => {
  test("hourly is refreshed before daily, because daily READS hourly", () => {
    // A child materialized from a parent bucket the parent has not finished is
    // silently wrong: the daily bucket keeps whatever partial hours existed when
    // it ran, and no later refresh of hourly revisits it.
    expect(REFRESH_ORDER.indexOf("hourly_rollups")).toBeLessThan(
      REFRESH_ORDER.indexOf("daily_rollups"),
    );
  });

  test("all three tiers are refreshed — a policy will never reach replayed history", () => {
    // Refresh POLICIES only cover their recent `start_offset` (3 hours, 3 days).
    // Nothing in the background will ever materialize a bucket from two months
    // ago, so the backfill has to do it by hand.
    expect([...REFRESH_ORDER].sort()).toEqual([
      "daily_rollups",
      "hourly_rollups",
      "minute_rollups",
    ]);
  });
});

describe("refreshWindows", () => {
  test("a short span is one window, padded by a bucket on each side", () => {
    const windows = refreshWindows(
      span("2026-08-01T00:00:00Z", "2026-08-03T00:00:00Z"),
      "daily_rollups",
      7,
    );
    expect(windows).toHaveLength(1);
    expect(windows[0]?.start.toISOString()).toBe("2026-07-31T00:00:00.000Z");
    expect(windows[0]?.end.toISOString()).toBe("2026-08-04T00:00:00.000Z");
  });

  test("a trailing remainder shorter than one bucket is merged, not left as its own window", () => {
    // The production 1.2.0 span, exactly: the new `metrics_raw` ran
    // 2026-07-12T00:00Z -> 2026-08-14T19:37:42Z after the carry and replay.
    // Padded by a day each side and cut into 7-day steps, the remainder is
    // 19h37m — and `refresh_continuous_aggregate` REFUSES a window narrower than
    // one bucket ("The refresh window must cover at least one bucket of data"),
    // which aborted the real upgrade after eight minutes of work with the data
    // already carried. The tail must still be covered, so the remainder merges
    // into the window before it rather than being dropped.
    const windows = refreshWindows(
      span("2026-07-12T00:00:00Z", "2026-08-14T19:37:42.178Z"),
      "daily_rollups",
      7,
    );
    for (const w of windows) {
      expect(w.end.getTime() - w.start.getTime()).toBeGreaterThanOrEqual(86_400_000);
    }
    // Still contiguous, and still reaches the padded end — a merge that trimmed
    // the tail would leave the last day unmaterialized, which is the failure the
    // narrow window was trying to avoid.
    expect(windows.at(-1)?.end.toISOString()).toBe("2026-08-15T19:37:42.178Z");
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]?.start.getTime()).toBe(windows[i - 1]?.end.getTime());
    }
  });

  test("a span shorter than one bucket is still refreshable, because the padding covers it", () => {
    // The invariant is "no window narrower than one bucket", not "no short
    // span": a 30-minute span padded by a day on each side spans two days, which
    // Postgres accepts. Returning nothing here would leave those buckets
    // unmaterialized for no reason.
    const windows = refreshWindows(
      span("2026-08-01T00:00:00Z", "2026-08-01T00:30:00Z"),
      "daily_rollups",
      7,
    );
    expect(windows).toHaveLength(1);
    expect(windows[0]!.end.getTime() - windows[0]!.start.getTime()).toBeGreaterThanOrEqual(
      86_400_000,
    );
  });

  test("a long span is chunked, so a kill loses one chunk rather than the run", () => {
    const windows = refreshWindows(
      span("2026-06-28T00:00:00Z", "2026-08-27T00:00:00Z"),
      "minute_rollups",
      7,
    );
    expect(windows.length).toBe(9);
    // Contiguous: a gap between two windows is a band of buckets no refresh ever
    // covers, and nothing would report it.
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]?.start.getTime()).toBe(windows[i - 1]?.end.getTime());
    }
  });

  test("the chunks span the whole padded window, first to last", () => {
    const windows = refreshWindows(
      span("2026-06-28T00:00:00Z", "2026-08-27T00:00:00Z"),
      "hourly_rollups",
      7,
    );
    expect(windows[0]?.start.toISOString()).toBe("2026-06-27T23:00:00.000Z");
    expect(windows.at(-1)?.end.toISOString()).toBe("2026-08-27T01:00:00.000Z");
  });

  test("an empty span refreshes nothing rather than everything", () => {
    // `refresh_continuous_aggregate(x, NULL, NULL)` advances the watermark past
    // everything; an accidental empty span must never become that.
    expect(
      refreshWindows(span("2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z"), "daily_rollups"),
    ).toEqual([]);
  });

  test("a reversed span refreshes nothing", () => {
    expect(
      refreshWindows(span("2026-08-05T00:00:00Z", "2026-08-01T00:00:00Z"), "daily_rollups"),
    ).toEqual([]);
  });
});

describe("refreshCall", () => {
  test("the window is BOUNDED — never NULL, NULL", () => {
    const call = refreshCall(
      "hourly_rollups",
      span("2026-08-01T00:00:00Z", "2026-08-08T00:00:00Z"),
    );
    expect(call.text).toContain("refresh_continuous_aggregate");
    expect(call.text).not.toContain("NULL");
    expect(call.params).toEqual(["2026-08-01T00:00:00.000Z", "2026-08-08T00:00:00.000Z"]);
  });

  test("the tier is a literal, not a parameter — a relation name cannot be bound", () => {
    expect(
      refreshCall("daily_rollups", span("2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z")).text,
    ).toContain("'daily_rollups'");
  });

  test("a tier name that is not one of ours is refused rather than interpolated", () => {
    expect(() =>
      // @ts-expect-error — the point is the runtime guard behind the type.
      refreshCall(
        "minute_rollups; drop table metrics_raw",
        span("2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z"),
      ),
    ).toThrow();
  });
});

describe("compareCoverage", () => {
  const row = (partial: Partial<CoverageRow> = {}): CoverageRow => ({
    metric: "pv_power",
    day: "2026-07-01",
    legacyBuckets: 1440,
    newBuckets: 1440,
    legacyMean: 1234.5,
    newMean: 1234.5,
    newSpread: 0,
    ...partial,
  });

  test("bucket-for-bucket, mean-for-mean agreement is no finding", () => {
    expect(compareCoverage([row()])).toEqual([]);
  });

  test("a day the replay under-filled is a finding naming the metric and the day", () => {
    const problems = compareCoverage([row({ newBuckets: 1439 })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("pv_power");
    expect(problems[0]).toContain("2026-07-01");
    expect(problems[0]).toContain("1439");
  });

  test("a day with MORE new buckets than legacy is a finding too — that is a double write", () => {
    // The one error a replay must never make. It would look like more data.
    expect(compareCoverage([row({ newBuckets: 2880 })])).toHaveLength(1);
  });

  test("a mean the replay did not preserve is a finding", () => {
    // Replay's whole claim is that the bucket's MEAN survives to the bit.
    expect(compareCoverage([row({ newMean: 1234.6 })])).toHaveLength(1);
  });

  test("float noise within a relative epsilon is not a finding", () => {
    expect(compareCoverage([row({ newMean: 1234.5 + 1e-10 })])).toEqual([]);
  });

  test("a zero mean on both sides is agreement, not a division by zero", () => {
    // A PV string at night and a battery at rest both measure zero.
    expect(compareCoverage([row({ legacyMean: 0, newMean: 0 })])).toEqual([]);
  });

  test("a zero mean against a non-zero one IS a finding", () => {
    expect(compareCoverage([row({ legacyMean: 0, newMean: 5 })])).toHaveLength(1);
  });

  test("a negative mean is compared like any other — export power is signed", () => {
    expect(compareCoverage([row({ legacyMean: -3000, newMean: -3000 })])).toEqual([]);
    expect(compareCoverage([row({ legacyMean: -3000, newMean: 3000 })])).toHaveLength(1);
  });

  test("a bucket whose min and max differ is a double write the count cannot see", () => {
    // Two rows inside one minute produce ONE bucket, so the count agrees and the
    // mean can too. The spread is the only thing that shows it.
    const problems = compareCoverage([row({ newSpread: 12.5 })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("double write");
  });

  test("an unknown spread is not a finding — an old row may carry none", () => {
    expect(compareCoverage([row({ newSpread: null })])).toEqual([]);
  });

  test("a day present in legacy and absent from the new tier is the loudest finding", () => {
    const problems = compareCoverage([row({ newBuckets: 0, newMean: null, newSpread: null })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/no new buckets|0 after/i);
  });

  test("NO ROWS AT ALL is a finding, not a pass", () => {
    // A comparison over nothing proves nothing, and this is the gate that lets
    // the only copy of two months of history be dropped.
    expect(compareCoverage([])).toHaveLength(1);
  });
});

describe("configLeak", () => {
  test("nothing in the hypertable is nothing to report", () => {
    expect(configLeak(0)).toEqual([]);
  });

  test("one leaked configuration row is a finding, naming the issue", () => {
    const problems = configLeak(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("metrics_config_log");
    expect(problems[0]).toContain("#150");
  });

  test("the count is reported, so the size of the leak is visible", () => {
    expect(configLeak(1_412_315)[0]).toContain("1412315");
  });
});
