import { describe, expect, test } from "bun:test";

import {
  BUCKET_RELATION,
  type HistoryTier,
  type RetentionRow,
  incompleteRangeProblem,
  retentionDaysFor,
} from "./history-horizon";

const NOW = new Date("2026-08-27T12:00:00Z");

describe("BUCKET_RELATION", () => {
  test("every readable tier names the relation that actually answers it", () => {
    // If a bucket named the wrong relation the guard would enforce SOMEBODY
    // ELSE's retention: the minute tier keeps 90 days and the hourly one 3650,
    // so getting it backwards either refuses valid reads or lets partial ones
    // through — the exact defect it exists to stop.
    expect(BUCKET_RELATION).toEqual({
      raw: "metrics_raw",
      minute: "minute_rollups",
      hour: "hourly_rollups",
      day: "daily_rollups",
    });
  });
});

describe("retentionDaysFor", () => {
  const rows: RetentionRow[] = [
    { hypertableName: "metrics_raw", dropAfterDays: 1825 },
    { hypertableName: "minute_rollups", dropAfterDays: 90 },
    { hypertableName: "hourly_rollups", dropAfterDays: 3650 },
  ];

  test("a tier with a policy reports its drop_after", () => {
    expect(retentionDaysFor(rows, "minute")).toBe(90);
    expect(retentionDaysFor(rows, "raw")).toBe(1825);
  });

  test("a tier with NO policy is kept forever, which is not zero", () => {
    // `daily_rollups` has no retention policy at all. Reading that as 0 would
    // refuse every read of the one tier that holds the whole history.
    expect(retentionDaysFor(rows, "day")).toBeNull();
  });

  test("an empty catalog means no retention anywhere, not retention of nothing", () => {
    expect(retentionDaysFor([], "minute")).toBeNull();
  });

  test("a zero-day policy is honoured as zero", () => {
    expect(
      retentionDaysFor([{ hypertableName: "minute_rollups", dropAfterDays: 0 }], "minute"),
    ).toBe(0);
  });
});

describe("incompleteRangeProblem", () => {
  const limits = {
    now: NOW,
    retention: [
      { hypertableName: "metrics_raw", dropAfterDays: 1825 },
      { hypertableName: "minute_rollups", dropAfterDays: 90 },
    ] satisfies RetentionRow[],
    migrationFrom: null as Date | null,
  };

  const ask = (tier: HistoryTier, from: string, to: string, over: Partial<typeof limits> = {}) =>
    incompleteRangeProblem(
      tier,
      { from: new Date(from), to: new Date(to) },
      { ...limits, ...over },
    );

  test("a window inside every horizon is answered", () => {
    expect(ask("minute", "2026-08-01T00:00:00Z", "2026-08-27T00:00:00Z")).toBeNull();
  });

  test("a MINUTE window older than the minute tier's 90 days is refused — #154", () => {
    // "A dataset request beyond retention should fail loudly, not silently
    // downgrade resolution." Answering it returns real buckets for the part that
    // survived and nothing for the rest, as one number.
    const problem = ask("minute", "2026-01-01T00:00:00Z", "2026-08-27T00:00:00Z");
    expect(problem?.reason).toBe("retention");
    expect(problem?.boundary.toISOString()).toBe("2026-05-29T12:00:00.000Z");
  });

  test("the SAME window at day resolution is answered — retention is per tier", () => {
    // `daily_rollups` has no retention policy, so the year-long window is whole.
    // This is the pair that makes the guard per-tier rather than global.
    expect(ask("day", "2026-01-01T00:00:00Z", "2026-08-27T00:00:00Z")).toBeNull();
  });

  test("a window that opens before a PENDING migration's cutover is refused", () => {
    // THE hazard: a month-to-date figure whose window opens before the cutover
    // returns a real but INCOMPLETE number that reads as authoritative.
    const problem = ask("day", "2026-08-01T00:00:00Z", "2026-08-28T00:00:00Z", {
      migrationFrom: new Date("2026-08-27T09:00:00Z"),
    });
    expect(problem?.reason).toBe("migration-pending");
    expect(problem?.message).toContain("2026-08-27");
  });

  test("the migration beats retention when it is the more restrictive", () => {
    const problem = ask("minute", "2026-01-01T00:00:00Z", "2026-08-28T00:00:00Z", {
      migrationFrom: new Date("2026-08-27T09:00:00Z"),
    });
    expect(problem?.reason).toBe("migration-pending");
  });

  test("a finished migration refuses nothing on its own", () => {
    expect(ask("day", "2020-01-01T00:00:00Z", "2026-08-28T00:00:00Z")).toBeNull();
  });

  test("a reversed window is not a partial window — it is empty by construction", () => {
    // The route's own validation owns that; this guard must not turn it into a
    // confusing story about missing history.
    expect(ask("minute", "2026-08-27T00:00:00Z", "2026-08-01T00:00:00Z")).toBeNull();
  });

  test("a window that starts exactly at the horizon is complete", () => {
    expect(ask("minute", "2026-05-29T12:00:00Z", "2026-08-27T00:00:00Z")).toBeNull();
  });

  test("the refusal names the tier, so the operator can widen the bucket instead", () => {
    const problem = ask("minute", "2026-01-01T00:00:00Z", "2026-08-27T00:00:00Z");
    expect(problem?.tier).toBe("minute");
  });
});
